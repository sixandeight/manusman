// ProcessingHelper.ts

import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import { ManusHelper, ManusResult } from "./ManusHelper"
import { TranscriptionHelper } from "./TranscriptionHelper"
import fs from "fs"
import dotenv from "dotenv"

dotenv.config()

const isDev = process.env.NODE_ENV === "development"
const isDevTest = process.env.IS_DEV_TEST === "true"
const MOCK_API_WAIT_TIME = Number(process.env.MOCK_API_WAIT_TIME) || 500
const DEMO_MODE = process.env.DEMO_MODE === "true"

// Shared display format examples (used in both modes)
const DISPLAY_FORMATS = `stat_card: {"display":"stat_card","value":"$3.4T","label":"Apple Market Cap","sentiment":"positive","trend":[2.1,2.5,2.8,3.4],"source":"Yahoo Finance"}
comparison: {"display":"comparison","us_name":"Us","them_name":"Competitor","metrics":[{"label":"Price","us_score":8,"them_score":6}],"verdict":"We lead on price"}
profile: {"display":"profile","name":"John","role":"CEO","company":"Acme","details":["Founded 2020","50 employees"],"sentiment":"positive","summary":"Growing fast"}
verdict: {"display":"verdict","claim":"X is true","verdict":"true","confidence":"high","evidence":"Source confirms X","source":"Reuters"}
checklist: {"display":"checklist","title":"Meeting Brief","context":[{"text":"Key fact","priority":"high"}],"items":[{"text":"Discuss pricing","checked":false}]}
pipeline: {"display":"pipeline","client":"Acme","stages":["Lead","Qualified","Proposal","Negotiation","Closed"],"current_stage":2,"deal_value":"$500K","risk":"medium","next_action":"Send proposal"}
chart: {"display":"chart","chart_type":"bar","title":"Revenue by Year","datasets":[{"name":"Revenue","values":[10,15,22,31],"color":"blue"}],"labels":["2021","2022","2023","2024"]}`

// Production: researches online. Demo: uses training data only (much faster).
const MANUS_SYSTEM = DEMO_MODE
  ? `You are a JSON API. Answer using your training knowledge ONLY. Do NOT browse the web. Do NOT use any tools. Do NOT search. Just answer immediately from what you already know. Output ONLY raw JSON. No markdown, no code fences, no prose.

Pick the display format that best fits:

${DISPLAY_FORMATS}

Rules: No browsing. No tool use. No searching. Answer instantly from memory. No clarifying questions. No apologies.`
  : `You are a JSON API. You research the question, then output ONLY raw JSON. No markdown, no code fences, no prose.

Pick the display format that best fits your findings:

${DISPLAY_FORMATS}

Rules: No clarifying questions. No waiting. If connectors unavailable, use web. No apologies.`

// Prompt templates — each uses few-shot pattern with "Input:/Output:" trigger
const TOOL_PROMPTS: Record<string, (args: Record<string, string>) => string> = {
  who_is_this: (args) =>
    `${MANUS_SYSTEM}\n\nExample:\nInput: Who is Jensen Huang?\nOutput: {"display":"profile","name":"Jensen Huang","role":"CEO & Co-founder","company":"NVIDIA","details":["Founded NVIDIA 1993","Net worth ~$120B","Drives AI chip strategy"],"sentiment":"positive","summary":"Visionary CEO leading AI revolution"}\n\nInput: ${args.context || "See attached screenshot"}${args.name ? ` ${args.name}` : ""}${args.company ? ` at ${args.company}` : ""}\nOutput:`,

  meeting_brief: (args) =>
    `${MANUS_SYSTEM}\n\nExample:\nInput: Meeting brief for Tesla\nOutput: {"display":"checklist","title":"Meeting Brief: Tesla","subtitle":"EV leader, $800B+ market cap","context":[{"text":"Q4 deliveries beat estimates","priority":"high"},{"text":"Cybertruck production ramping","priority":"medium"}],"items":[{"text":"Ask about fleet pricing","checked":false},{"text":"Discuss API integration timeline","checked":false}]}\n\nInput: Meeting brief for ${args.person_or_company}\nOutput:`,

  live_fact_check: (args) =>
    `${MANUS_SYSTEM}\n\nExample:\nInput: Did OpenAI raise $10B from Microsoft?\nOutput: {"display":"verdict","claim":"OpenAI raised $10B from Microsoft","verdict":"true","confidence":"high","evidence":"Microsoft confirmed a $10B investment in OpenAI in Jan 2023","source":"Microsoft blog"}\n\nInput: ${args.claim}\nOutput:`,

  company_snapshot: (args) =>
    `${MANUS_SYSTEM}\n\nExample:\nInput: Research Datadog\nOutput: {"display":"chart","chart_type":"bar","title":"Datadog Revenue ($M)","datasets":[{"name":"Revenue","values":[603,1029,1675,2128],"color":"purple"}],"labels":["2021","2022","2023","2024"],"summary":"$2.1B ARR, 26% YoY growth"}\n\nInput: Research ${args.company_name}\nOutput:`,

  deal_status: (args) =>
    `${MANUS_SYSTEM}\n\nExample:\nInput: Deal status for Snowflake\nOutput: {"display":"pipeline","client":"Snowflake","stages":["Prospecting","Discovery","Proposal","Negotiation","Closed"],"current_stage":3,"deal_value":"$2M ARR","risk":"medium","next_action":"Final pricing review","next_action_due":"Next week","blockers":["Legal review pending"]}\n\nInput: Deal status for ${args.client_name}\nOutput:`,

  competitive_intel: (args) =>
    `${MANUS_SYSTEM}\n\nExample:\nInput: Competitive intel on Snowflake\nOutput: {"display":"comparison","us_name":"Us","them_name":"Snowflake","metrics":[{"label":"Pricing","us_score":8,"them_score":5},{"label":"Performance","us_score":7,"them_score":8},{"label":"Ease of Use","us_score":9,"them_score":6},{"label":"Ecosystem","us_score":6,"them_score":9}],"verdict":"We win on price and UX, they win on ecosystem"}\n\nInput: Competitive intel on ${args.competitor_name}\nOutput:`,

  number_lookup: (args) =>
    `${MANUS_SYSTEM}\n\nExample:\nInput: What is Stripe's valuation?\nOutput: {"display":"stat_card","value":"$91.5B","label":"Stripe Valuation","sentiment":"positive","trend":[20,36,95,50,91.5],"source":"Secondary market data, 2024"}\n\nInput: ${args.query}\nOutput:`,
}

export type ManusToolName = "who_is_this" | "meeting_brief" | "live_fact_check" | "company_snapshot" | "deal_status" | "competitive_intel" | "number_lookup"

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper
  private manusHelper: ManusHelper
  private transcriptionHelper: TranscriptionHelper
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(appState: AppState) {
    this.appState = appState

    // Initialize Manus
    this.manusHelper = new ManusHelper()

    // Initialize Transcription
    this.transcriptionHelper = new TranscriptionHelper()

    // Check if user wants to use Ollama
    const useOllama = process.env.USE_OLLAMA === "true"
    const ollamaModel = process.env.OLLAMA_MODEL
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434"

    if (useOllama) {
      console.log("[ProcessingHelper] Initializing with Ollama")
      this.llmHelper = new LLMHelper(undefined, true, ollamaModel, ollamaUrl)
    } else {
      const apiKey = process.env.KIMI_API_KEY
      if (!apiKey) {
        throw new Error("KIMI_API_KEY not found in environment variables. Set KIMI_API_KEY or enable Ollama with USE_OLLAMA=true")
      }
      console.log("[ProcessingHelper] Initializing with Kimi/Moonshot")
      this.llmHelper = new LLMHelper(apiKey, false)
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.appState.getMainWindow()
    if (!mainWindow) return

    const view = this.appState.getView()

    if (view === "queue") {
      const screenshotQueue = this.appState.getScreenshotHelper().getScreenshotQueue()
      if (screenshotQueue.length === 0) {
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      // Check if last screenshot is an audio file
      const allPaths = this.appState.getScreenshotHelper().getScreenshotQueue();
      const lastPath = allPaths[allPaths.length - 1];
      if (lastPath.endsWith('.mp3') || lastPath.endsWith('.wav')) {
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START);
        this.appState.setView('solutions');
        try {
          const audioResult = await this.llmHelper.analyzeAudioFile(lastPath);
          mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, audioResult);
          this.appState.setProblemInfo({ problem_statement: audioResult.text, input_format: {}, output_format: {}, constraints: [], test_cases: [] });
          return;
        } catch (err: any) {
          console.error('Audio processing error:', err);
          mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, err.message);
          return;
        }
      }

      // NEW: Handle screenshot as plain text (like audio)
      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START)
      this.appState.setView("solutions")
      this.currentProcessingAbortController = new AbortController()
      try {
        const imageResult = await this.llmHelper.analyzeImageFile(lastPath);
        const problemInfo = {
          problem_statement: imageResult.text,
          input_format: { description: "Generated from screenshot", parameters: [] as any[] },
          output_format: { description: "Generated from screenshot", type: "string", subtype: "text" },
          complexity: { time: "N/A", space: "N/A" },
          test_cases: [] as any[],
          validation_type: "manual",
          difficulty: "custom"
        };
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo);
        this.appState.setProblemInfo(problemInfo);
      } catch (error: any) {
        console.error("Image processing error:", error)
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message)
      } finally {
        this.currentProcessingAbortController = null
      }
      return;
    } else {
      // Debug mode
      const extraScreenshotQueue = this.appState.getScreenshotHelper().getExtraScreenshotQueue()
      if (extraScreenshotQueue.length === 0) {
        console.log("No extra screenshots to process")
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_START)
      this.currentExtraProcessingAbortController = new AbortController()

      try {
        // Get problem info and current solution
        const problemInfo = this.appState.getProblemInfo()
        if (!problemInfo) {
          throw new Error("No problem info available")
        }

        // Get current solution from state
        const currentSolution = await this.llmHelper.generateSolution(problemInfo)
        const currentCode = currentSolution.solution.code

        // Debug the solution using vision model
        const debugResult = await this.llmHelper.debugSolutionWithImages(
          problemInfo,
          currentCode,
          extraScreenshotQueue
        )

        this.appState.setHasDebugged(true)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_SUCCESS,
          debugResult
        )

      } catch (error: any) {
        console.error("Debug processing error:", error)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_ERROR,
          error.message
        )
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  public cancelOngoingRequests(): void {
    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
    }

    this.appState.setHasDebugged(false)
  }

  public async processAudioBase64(data: string, mimeType: string) {
    // Directly use LLMHelper to analyze inline base64 audio
    return this.llmHelper.analyzeAudioFromBase64(data, mimeType);
  }

  // Add audio file processing method
  public async processAudioFile(filePath: string) {
    return this.llmHelper.analyzeAudioFile(filePath);
  }

  public getLLMHelper() {
    return this.llmHelper;
  }

  public getManusHelper() {
    return this.manusHelper;
  }

  public getTranscriptionHelper() {
    return this.transcriptionHelper
  }

  public async runManusTool(
    toolName: ManusToolName,
    args: Record<string, string>,
    screenshotPath?: string
  ): Promise<ManusResult & { toolName: string }> {
    const mainWindow = this.appState.getMainWindow()

    // Build prompt from template
    const promptBuilder = TOOL_PROMPTS[toolName]
    if (!promptBuilder) {
      throw new Error(`Unknown tool: ${toolName}`)
    }

    // Extract transcript BEFORE prompt builder sees args
    const transcript = args._transcript || ""
    delete args._transcript

    const prompt = promptBuilder(args)

    let fullPrompt = prompt
    if (transcript) {
      fullPrompt += `\n\nLIVE CONTEXT (last 30 seconds of user's microphone):\n"""\n${transcript}\n"""\nUse this context to inform your response. The user is currently in a live conversation.`
      console.log(`[ProcessingHelper] Injected ${transcript.length} chars of transcript`)
    }

    // Build attachments if screenshot provided
    let attachments: Array<{ filename: string; fileData: string }> | undefined
    if (screenshotPath) {
      try {
        const imageData = await fs.promises.readFile(screenshotPath)
        attachments = [{
          filename: "screenshot.png",
          fileData: `data:image/png;base64,${imageData.toString("base64")}`,
        }]
      } catch (err) {
        console.error("[ProcessingHelper] Failed to read screenshot for Manus:", err)
      }
    }

    console.log(`[ProcessingHelper] Running Manus tool: ${toolName}`, JSON.stringify(args))
    console.log(`[ProcessingHelper] Prompt: ${fullPrompt.substring(0, 200)}...`)

    // Notify renderer that a tool is running
    if (mainWindow) {
      mainWindow.webContents.send("manus-tool-started", { toolName, args })
    }

    try {
      const result = await this.manusHelper.runTool(
        toolName,
        fullPrompt,
        attachments,
        (status) => {
          console.log(`[ProcessingHelper] Manus ${toolName} status: ${status}`)
          if (mainWindow) {
            mainWindow.webContents.send("manus-tool-status", { toolName, status })
          }
        },
        (partial) => {
          console.log(`[ProcessingHelper] Manus ${toolName} partial: ${partial.text?.substring(0, 100)}...`)
          if (mainWindow) {
            mainWindow.webContents.send("manus-tool-partial", { ...partial, toolName })
          }
        }
      )

      console.log(`[ProcessingHelper] Manus ${toolName} COMPLETED: ${result.text?.substring(0, 200)}...`)

      // Send final result to renderer
      if (mainWindow) {
        mainWindow.webContents.send("manus-tool-result", result)
      }

      return result
    } catch (error: any) {
      console.error(`[ProcessingHelper] Manus ${toolName} FAILED:`, error.message)
      if (mainWindow) {
        mainWindow.webContents.send("manus-tool-error", { toolName, error: error.message })
      }
      throw error
    }
  }
}
