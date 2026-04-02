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

// System instructions prepended to every Manus prompt
const MANUS_SYSTEM = `CRITICAL RULES:
1. Do NOT ask clarifying questions. Do NOT wait for user input. Just do the task.
2. If Notion or Google Drive connectors are not available, skip them silently. Use web research instead. Do NOT mention missing connectors.
3. Be concise. No filler. No disclaimers. No preamble.
4. MANDATORY OUTPUT FORMAT: Your FINAL message must contain ONLY a JSON object wrapped in \`\`\`json code fences. NO prose before or after. NO explanations. NO "here is your result". JUST the JSON block. If your final message contains ANY text outside the code fence, you have FAILED the task.`

// JSON schemas embedded in prompts so Manus knows exact format
const SCHEMAS = {
  checklist: `{ "display": "checklist", "title": "string", "subtitle": "string (optional)", "context": [{ "text": "string", "priority": "high|medium|low" }], "items": [{ "text": "string", "checked": false }], "notes": "string (optional)" }`,
  profile: `{ "display": "profile", "name": "string", "role": "string", "company": "string", "details": ["string"], "deal_stage": "lead|qualified|proposal|negotiation|closed_won (optional)", "deal_value": "string (optional)", "last_contact": "string (optional)", "sentiment": "positive|negative|neutral", "summary": "string", "actions": ["string"] }`,
  verdict: `{ "display": "verdict", "claim": "string", "verdict": "true|false|partially_true|unverifiable", "confidence": "high|medium|low", "evidence": "string", "source": "string (optional)", "context": "string (optional)" }`,
  stat_card: `{ "display": "stat_card", "value": "string (the main number/stat)", "label": "string", "unit": "string (optional)", "trend": [number] (optional array of recent values), "sentiment": "positive|negative|neutral", "source": "string (optional)", "context": "string (optional)" }`,
  comparison: `{ "display": "comparison", "us_name": "string", "them_name": "string", "metrics": [{ "label": "string", "us_score": number (1-10), "them_score": number (1-10), "us_note": "string (optional)", "them_note": "string (optional)" }], "verdict": "string", "actions": ["string"] }`,
  pipeline: `{ "display": "pipeline", "client": "string", "stages": ["string", "string", ...], "current_stage": number (0-indexed), "deal_value": "string (optional)", "risk": "low|medium|high", "next_action": "string", "next_action_due": "string (optional)", "blockers": ["string"], "summary": "string (optional)" }`,
  chart: `{ "display": "chart", "chart_type": "bar|donut", "title": "string", "datasets": [{ "name": "string", "values": [number], "labels": ["string"] (for donut), "color": "blue|green|red|orange|purple|cyan", "colors": ["color"] (for donut) }], "labels": ["string"] (x-axis labels for bar), "summary": "string (optional)" }`,
}

// Prompt templates for each Manus tool
const TOOL_PROMPTS: Record<string, (args: Record<string, string>) => string> = {
  who_is_this: (args) =>
    `${MANUS_SYSTEM}\n\nTASK: Look up this person. Search the web for: name, company, role, recent activity.\n\nOUTPUT SCHEMA (use EXACTLY this format):\n${SCHEMAS.profile}\n\nContext: ${args.context || "See attached screenshot"}${args.name ? `\nName: ${args.name}` : ""}${args.company ? `\nCompany: ${args.company}` : ""}`,

  meeting_brief: (args) =>
    `${MANUS_SYSTEM}\n\nTASK: Prepare a meeting brief for: ${args.person_or_company}. Research them on the web. Find: recent news, key facts, talking points, potential topics.\n\nOUTPUT SCHEMA (use EXACTLY this format):\n${SCHEMAS.checklist}\n\nThe "context" array should contain key facts with priority. The "items" array should contain talking points/action items.${args.meeting_topic ? `\nMeeting topic: ${args.meeting_topic}` : ""}`,

  live_fact_check: (args) =>
    `${MANUS_SYSTEM}\n\nTASK: Fact-check this claim using the web. Find supporting or contradicting evidence.\n\nOUTPUT SCHEMA (use EXACTLY this format):\n${SCHEMAS.verdict}\n\nClaim: ${args.claim}${args.source_context ? `\nSource: ${args.source_context}` : ""}`,

  company_snapshot: (args) =>
    `${MANUS_SYSTEM}\n\nTASK: Research "${args.company_name}". Find: founding year, size, funding/valuation, industry, key metrics, recent news.\n\nOUTPUT SCHEMA — choose ONE based on the data:\nFor a key metric: ${SCHEMAS.stat_card}\nFor trend data over time: ${SCHEMAS.chart}\nUse chart with chart_type "bar" if you have values over time. Include "labels" for x-axis (e.g. years) and "datasets" with "values" array matching the labels.\n\nDefault to stat_card if unsure.${args.specific_focus ? `\nFocus on: ${args.specific_focus}` : ""}`,

  deal_status: (args) =>
    `${MANUS_SYSTEM}\n\nTASK: Research "${args.client_name}" and construct a plausible deal pipeline based on public information. Find: what stage the relationship might be at, recent interactions/news, potential blockers.\n\nOUTPUT SCHEMA (use EXACTLY this format):\n${SCHEMAS.pipeline}\n\nThe "stages" array should be e.g. ["Prospecting", "Qualified", "Proposal", "Negotiation", "Closed"]. Set "current_stage" to the 0-indexed position.`,

  competitive_intel: (args) =>
    `${MANUS_SYSTEM}\n\nTASK: Competitive intel on "${args.competitor_name}". Search web for: market position, strengths, weaknesses, pricing, recent moves.\n\nOUTPUT SCHEMA (use EXACTLY this format):\n${SCHEMAS.comparison}\n\n"us_name" should be "Us" and "them_name" should be "${args.competitor_name}". Each metric has us_score and them_score from 1-10. Include at least 4 metrics.${args.comparison_context ? `\nFocus: ${args.comparison_context}` : ""}${args.our_product ? `\nOur product: ${args.our_product}` : ""}`,

  number_lookup: (args) =>
    `${MANUS_SYSTEM}\n\nTASK: Find this number/stat: "${args.query}". Search the web.\n\nOUTPUT SCHEMA (use EXACTLY this format):\n${SCHEMAS.stat_card}\n\nIf there is trend data over time, include it in the "trend" array (recent values as numbers). "value" should be the main headline number as a string.${args.time_period ? `\nTime period: ${args.time_period}` : ""}${args.source_hint ? `\nLook in: ${args.source_hint}` : ""}`,
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
