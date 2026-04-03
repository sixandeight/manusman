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

// Hybrid prompt — A's speed + B's context, compressed
const MANUS_SYSTEM = `SYSTEM: You are the research engine inside Manusman — a transparent overlay on a consultant's screen during live calls.

The user pressed a keybind. You get: a QUERY (what they typed), optionally a TRANSCRIPT (last 30s of their mic), and optionally a SCREENSHOT. If transcript conflicts with query, trust the transcript — it's what's actually being discussed.

You return ONE raw JSON object. No markdown, no fences, no prose. It renders as a card they glance at for 3-5 seconds. It fades after 30s. Every field must earn its place.

Rules: Numbers > adjectives. New info > background. Skip what a senior consultant already knows. No hallucinated entities. Only answer about what was asked.

Pick the best display format:

${DISPLAY_FORMATS}

${DEMO_MODE
  ? `MODE: Use training knowledge ONLY. No browsing. No tools. No searching. Answer instantly.`
  : `MODE: Research using the web. If connectors unavailable, skip silently. No apologies.`}`

// Example pools — each call randomly picks one for format variety
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

const EXAMPLES: Record<string, string[]> = {
  intel: [
    // Company → chart
    `Input: Stripe\nOutput: {"display":"chart","chart_type":"bar","title":"Stripe Valuation ($B)","datasets":[{"name":"Valuation","values":[20,36,95,50,91.5],"color":"purple"}],"labels":["2019","2020","2021","2022","2024"],"summary":"$91.5B valuation, $1T+ TPV, profitable since 2024"}`,
    // Company → profile
    `Input: Anthropic\nOutput: {"display":"profile","name":"Anthropic","role":"AI Safety Lab","company":"Anthropic","details":["Founded 2021 by ex-OpenAI","$18B valuation (Series E)","Claude model family","Amazon + Google invested"],"sentiment":"positive","summary":"Leading AI safety company, enterprise focus, growing fast"}`,
    // Person → profile
    `Input: Jensen Huang\nOutput: {"display":"profile","name":"Jensen Huang","role":"CEO & Co-founder","company":"NVIDIA","details":["Founded NVIDIA 1993","$3.4T market cap","Drives AI chip strategy"],"sentiment":"positive","summary":"Visionary CEO leading the AI infrastructure revolution"}`,
    // Comparison → comparison
    `Input: Stripe vs Adyen\nOutput: {"display":"comparison","us_name":"Stripe","them_name":"Adyen","metrics":[{"label":"Developer Experience","us_score":9,"them_score":6},{"label":"Enterprise Features","us_score":7,"them_score":9},{"label":"Global Coverage","us_score":8,"them_score":8},{"label":"Pricing Transparency","us_score":8,"them_score":5}],"verdict":"Stripe wins on developer experience, Adyen stronger in enterprise"}`,
    // Meeting prep → checklist
    `Input: prep for Tesla call\nOutput: {"display":"checklist","title":"Call Prep: Tesla","subtitle":"EV leader, $800B+ market cap","context":[{"text":"Q4 deliveries beat estimates","priority":"high"},{"text":"Cybertruck production ramping","priority":"medium"},{"text":"FSD v12 rollout expanding","priority":"medium"}],"items":[{"text":"Ask about fleet pricing","checked":false},{"text":"Discuss API integration timeline","checked":false}]}`,
    // Market/stat → stat_card
    `Input: OpenAI ARR\nOutput: {"display":"stat_card","value":"$13B","label":"OpenAI Annualized Revenue","sentiment":"positive","trend":[0.2,1.3,3.4,13],"source":"Internal estimates, 2024","context":"Growing 4x YoY, 300M+ weekly ChatGPT users"}`,
    // Market share → donut
    `Input: cloud market share\nOutput: {"display":"chart","chart_type":"donut","title":"Cloud Infrastructure Market Share","datasets":[{"name":"Share","values":[31,24,11,34],"labels":["AWS","Azure","GCP","Others"],"colors":["orange","blue","red","gray"]}],"summary":"AWS leads at 31%, Azure closing gap at 24%"}`,
  ],
  deal_status: [
    `Input: Deal status for Snowflake\nOutput: {"display":"pipeline","client":"Snowflake","stages":["Prospecting","Discovery","Proposal","Negotiation","Closed"],"current_stage":3,"deal_value":"$2M ARR","risk":"medium","next_action":"Final pricing review","next_action_due":"Next week","blockers":["Legal review pending"]}`,
    `Input: Deal status for Acme Corp\nOutput: {"display":"checklist","title":"Deal Status: Acme Corp","subtitle":"$500K opportunity, early stage","context":[{"text":"Initial demo completed last Tuesday","priority":"high"},{"text":"Budget approved for Q3","priority":"medium"},{"text":"Competing with Salesforce bid","priority":"high"}],"items":[{"text":"Send technical requirements doc","checked":false},{"text":"Schedule security review call","checked":false}]}`,
  ],
  prep: [
    `Input: Screenshot of calendar invite for Snowflake Q3 Review\nOutput: {"display":"slides","title":"Prep: Snowflake Q3 Review","slides":[{"heading":"Company Snapshot","bullets":["$2.1B ARR, 30% YoY growth","Consumption-based pricing","Cortex AI platform launching"]},{"heading":"Key People","bullets":["Sridhar Ramaswamy, CEO","Chris Degnan, CRO","Benoit Dageville, Co-founder"]},{"heading":"Talking Points","bullets":["Ask about Cortex AI adoption","Discuss credit vs commit model","Probe competitive response to Databricks"]},{"heading":"Watch Out","bullets":["Consumption growth slowing","CFO transition announced","Enterprise renewal cycle"]}]}`,
    `Input: Screenshot of LinkedIn profile\nOutput: {"display":"slides","title":"Prep: Meeting with Jensen Huang","slides":[{"heading":"Who","bullets":["Jensen Huang, CEO & Co-founder","NVIDIA, founded 1993","Net worth ~$158B"]},{"heading":"NVIDIA Now","bullets":["$3.4T market cap","$130B revenue FY2025","Blackwell GPU shipping"]},{"heading":"Talking Points","bullets":["AI infrastructure roadmap","Sovereign AI partnerships","CUDA ecosystem moat"]},{"heading":"Watch Out","bullets":["Export controls to China","AMD MI300X competition","Customer concentration risk"]}]}`,
  ],
  live_fact_check: [
    `Input: Did OpenAI raise $10B from Microsoft?\nOutput: {"display":"verdict","claim":"OpenAI raised $10B from Microsoft","verdict":"true","confidence":"high","evidence":"Microsoft confirmed a $10B investment in OpenAI in Jan 2023","source":"Microsoft blog"}`,
    `Input: Is Stripe profitable?\nOutput: {"display":"stat_card","value":"$2B+","label":"Stripe Net Revenue (Profitable since 2024)","sentiment":"positive","trend":[0.8,1.2,1.6,2.1],"source":"WSJ, 2024"}`,
    `Input: Did Google acquire DeepMind for $500M?\nOutput: {"display":"verdict","claim":"Google acquired DeepMind for $500M","verdict":"partially_true","confidence":"high","evidence":"Google acquired DeepMind in 2014 for approximately £400M (~$625M), not $500M","source":"Financial Times"}`,
  ],
}

// 4 tools — transcript is passed in so it appears BEFORE Input/Output trigger
const TOOL_PROMPTS: Record<string, (args: Record<string, string>, transcript?: string) => string> = {
  intel: (args, transcript) => {
    const ctx = transcript ? `\nTRANSCRIPT (last 30s of user's mic): "${transcript}"\n` : ""
    return `${MANUS_SYSTEM}\n\nYou are a consulting intelligence analyst. Your client is on a live call and needs instant intel. Analyze the input — it could be a company name, a person, a comparison ("X vs Y"), meeting prep ("prep for X call"), a market question, or a specific stat. Pick the display format that best fits what you find. Make it glanceable in 5 seconds.\n\nExample:\n${pick(EXAMPLES.intel)}\n${ctx}\nInput: ${args.query}\nOutput:`
  },

  deal_status: (args, transcript) => {
    const ctx = transcript ? `\nTRANSCRIPT (last 30s of user's mic): "${transcript}"\n` : ""
    return `${MANUS_SYSTEM}\n\nYou are a deal desk analyst. Your client needs to know where a deal stands — pipeline stage, value, risk, blockers, and next steps. If you don't have real CRM data, construct the most plausible status based on public information.\n\nExample:\n${pick(EXAMPLES.deal_status)}\n${ctx}\nInput: Deal status for ${args.client_name}\nOutput:`
  },

  prep: (args, transcript) => {
    const ctx = transcript ? `\nTRANSCRIPT (last 30s of user's mic): "${transcript}"\n` : ""
    return `${MANUS_SYSTEM}\n\nYou are a meeting prep analyst. Your client is about to enter a call. Look at the screenshot — it might show a calendar invite, email, LinkedIn profile, or website. Generate a series of prep slides they can flick through during the call. Return 3-5 slides covering: overview, key people, talking points, and risks/watchouts. Each slide has a heading and 3-5 bullet points.\n\nExample:\n${pick(EXAMPLES.prep)}\n${ctx}\nInput: ${args.context || "See attached screenshot"}\nOutput:`
  },

  live_fact_check: (args, transcript) => {
    const ctx = transcript ? `\nTRANSCRIPT (last 30s of user's mic): "${transcript}"\n` : ""
    return `${MANUS_SYSTEM}\n\nYou are a real-time fact-checker. Someone just made a claim during a live call — verify it immediately. Clear verdict, evidence, confidence. Your client needs to know in 3 seconds.\n\nExample:\n${pick(EXAMPLES.live_fact_check)}\n${ctx}\nInput: ${args.claim}\nOutput:`
  },
}

export type ManusToolName = "intel" | "deal_status" | "prep" | "live_fact_check"

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

    // Transcript is passed to prompt builder so it appears BEFORE Input/Output trigger
    const fullPrompt = promptBuilder(args, transcript || undefined)
    if (transcript) {
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
