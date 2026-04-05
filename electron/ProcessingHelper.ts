// ProcessingHelper.ts

import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import { ManusHelper, ManusResult } from "./ManusHelper"
import { TranscriptionHelper } from "./TranscriptionHelper"
import fs from "fs"
import { pickIntelExample } from "../shared/queryClassifier"
import dotenv from "dotenv"
import path from "path"

dotenv.config({ path: path.resolve(__dirname, "../../.env") })

const DEMO_MODE = process.env.DEMO_MODE === "true"
console.log(`[ProcessingHelper] DEMO_MODE = ${DEMO_MODE}`)

// Line-format display types — much simpler for LLMs to produce correctly
const DISPLAY_FORMATS = `Available DISPLAY types and their fields:

stat_card — a big number with trend
  DISPLAY: stat_card
  VALUE: (the main number or stat)
  LABEL: (what the number means)
  SENTIMENT: positive | negative | neutral
  TREND: (comma-separated numbers, oldest to newest)
  SOURCE: (where you found this)

comparison — side-by-side scores
  DISPLAY: comparison
  US: (first entity name)
  THEM: (second entity name)
  METRIC: (label) | (us_score 0-10) | (them_score 0-10)
  METRIC: (repeat for each metric, up to 6)
  VERDICT: (one-line summary of who wins)

profile — person or company snapshot
  DISPLAY: profile
  NAME: (person or company)
  ROLE: (title or type)
  COMPANY: (company name, if person)
  DETAIL: (key fact — repeat up to 5 lines)
  SENTIMENT: positive | negative | neutral
  SUMMARY: (one-line takeaway)

verdict — fact check result
  DISPLAY: verdict
  CLAIM: (what was claimed)
  VERDICT: true | false | partially_true | unverifiable
  CONFIDENCE: high | medium | low
  EVIDENCE: (what proves or disproves it)
  SOURCE: (where you verified)

checklist — briefing with action items
  DISPLAY: checklist
  TITLE: (heading)
  SUBTITLE: (optional context line)
  CONTEXT: (key fact) | high | medium | low
  CONTEXT: (repeat for key facts)
  ITEM: (action item — repeat for each)

pipeline — deal stages
  DISPLAY: pipeline
  CLIENT: (company name)
  STAGES: (stage1) | (stage2) | (stage3) | ...
  CURRENT: (stage index, 0-based)
  VALUE: (deal value)
  RISK: low | medium | high
  NEXT: (next action)
  DUE: (when)
  BLOCKER: (what's blocking, if any)

chart — bar or donut
  For bar charts:
    DISPLAY: chart
    CHART_TYPE: bar
    TITLE: (chart title)
    NAME: (dataset name)
    VALUES: (num) | (num) | (num) | ...
    LABELS: (label) | (label) | (label) | ...
    COLOR: blue | green | red | orange | purple
    SUMMARY: (one-line insight)
  For donut charts:
    DISPLAY: chart
    CHART_TYPE: donut
    TITLE: (chart title)
    SEGMENT: (label) | (value) | (color)
    SEGMENT: (repeat for each slice)
    SUMMARY: (one-line insight)

slides — meeting prep deck
  DISPLAY: slides
  TITLE: (deck title)
  SLIDE: (heading) | (bullet) | (bullet) | (bullet)
  SLIDE: (repeat for each slide, 3-5 slides)`

// System prompt — unified for both demo and production
const MANUS_SYSTEM = `SYSTEM: You are the research engine inside Manusman — a transparent overlay on a consultant's screen during live calls.

The user pressed a keybind. You get: a QUERY (what they typed), optionally a TRANSCRIPT (last 30s of their mic), and optionally a SCREENSHOT. If transcript conflicts with query, trust the transcript — it's what's actually being discussed.

You MUST respond using ONLY the labeled-line format below. NOTHING ELSE.

RULES — OBEY ALL OF THESE:
1. First line of your response MUST be "DISPLAY: <type>"
2. Every line after that MUST be "KEY: value"
3. NO prose. NO explanations. NO "here are the results". NO markdown. NO JSON.
4. If you write ANYTHING other than KEY: value lines, the system crashes.
5. Repeated keys become lists. Pipe | separates columns.
6. Pick the DISPLAY type that best fits the query.

${DISPLAY_FORMATS}

CONTEXT: This renders as a card they glance at for 3-5 seconds. It fades after 30s. Be thorough — include 5-7 details per card, real numbers with trends, multiple data points. Fill every available field for the display type. Numbers > adjectives. New info > background. No hallucinated entities.

${DEMO_MODE
  ? `MODE: Use training knowledge ONLY. No browsing. No tools. No searching. Answer instantly. Be specific — real numbers, real names, real trends. Never hedge.`
  : `MODE: Research using the web. If connectors unavailable, skip silently. No apologies.`}

REMEMBER: Your ENTIRE response must be KEY: value lines starting with DISPLAY:. Nothing else.`

// ── Example pools — each call randomly picks one for format variety
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

const EXAMPLES: Record<string, string[]> = {
  intel: [
    // Company → chart
    `Input: Stripe
Output:
DISPLAY: chart
CHART_TYPE: bar
TITLE: Stripe Valuation ($B)
NAME: Valuation
VALUES: 20 | 36 | 95 | 50 | 91.5
LABELS: 2019 | 2020 | 2021 | 2022 | 2024
COLOR: purple
SUMMARY: $91.5B valuation, $1T+ TPV, profitable since 2024`,
    // Company → profile
    `Input: Anthropic
Output:
DISPLAY: profile
NAME: Anthropic
ROLE: AI Safety Lab
COMPANY: Anthropic
DETAIL: Founded 2021 by ex-OpenAI
DETAIL: $18B valuation (Series E)
DETAIL: Claude model family
DETAIL: Amazon + Google invested
SENTIMENT: positive
SUMMARY: Leading AI safety company, enterprise focus, growing fast`,
    // Person → profile
    `Input: Jensen Huang
Output:
DISPLAY: profile
NAME: Jensen Huang
ROLE: CEO & Co-founder
COMPANY: NVIDIA
DETAIL: Founded NVIDIA 1993
DETAIL: $3.4T market cap
DETAIL: Drives AI chip strategy
SENTIMENT: positive
SUMMARY: Visionary CEO leading the AI infrastructure revolution`,
    // Comparison → comparison
    `Input: Stripe vs Adyen
Output:
DISPLAY: comparison
US: Stripe
THEM: Adyen
METRIC: Developer Experience | 9 | 6
METRIC: Enterprise Features | 7 | 9
METRIC: Global Coverage | 8 | 8
METRIC: Pricing Transparency | 8 | 5
VERDICT: Stripe wins on developer experience, Adyen stronger in enterprise`,
    // Meeting prep → checklist
    `Input: prep for Tesla call
Output:
DISPLAY: checklist
TITLE: Call Prep: Tesla
SUBTITLE: EV leader, $800B+ market cap
CONTEXT: Q4 deliveries beat estimates | high
CONTEXT: Cybertruck production ramping | medium
CONTEXT: FSD v12 rollout expanding | medium
ITEM: Ask about fleet pricing
ITEM: Discuss API integration timeline`,
    // Market/stat → stat_card
    `Input: OpenAI ARR
Output:
DISPLAY: stat_card
VALUE: $13B
LABEL: OpenAI Annualized Revenue
SENTIMENT: positive
TREND: 0.2, 1.3, 3.4, 13
SOURCE: Internal estimates, 2024`,
    // Market share → donut
    `Input: cloud market share
Output:
DISPLAY: chart
CHART_TYPE: donut
TITLE: Cloud Infrastructure Market Share
SEGMENT: AWS | 31 | orange
SEGMENT: Azure | 24 | blue
SEGMENT: GCP | 11 | red
SEGMENT: Others | 34 | gray
SUMMARY: AWS leads at 31%, Azure closing gap at 24%`,
  ],
  deal_status: [
    `Input: Deal status for Snowflake
Output:
DISPLAY: pipeline
CLIENT: Snowflake
STAGES: Prospecting | Discovery | Proposal | Negotiation | Closed
CURRENT: 3
VALUE: $2M ARR
RISK: medium
NEXT: Final pricing review
DUE: Next week
BLOCKER: Legal review pending`,
    `Input: Deal status for Acme Corp
Output:
DISPLAY: checklist
TITLE: Deal Status: Acme Corp
SUBTITLE: $500K opportunity, early stage
CONTEXT: Initial demo completed last Tuesday | high
CONTEXT: Budget approved for Q3 | medium
CONTEXT: Competing with Salesforce bid | high
ITEM: Send technical requirements doc
ITEM: Schedule security review call`,
  ],
  prep: [
    `Input: Screenshot of calendar invite for Snowflake Q3 Review
Output:
DISPLAY: slides
TITLE: Prep: Snowflake Q3 Review
SLIDE: Company Snapshot | $2.1B ARR, 30% YoY growth | Consumption-based pricing | Cortex AI platform launching
SLIDE: Key People | Sridhar Ramaswamy, CEO | Chris Degnan, CRO | Benoit Dageville, Co-founder
SLIDE: Talking Points | Ask about Cortex AI adoption | Discuss credit vs commit model | Probe competitive response to Databricks
SLIDE: Watch Out | Consumption growth slowing | CFO transition announced | Enterprise renewal cycle`,
    `Input: Screenshot of LinkedIn profile
Output:
DISPLAY: slides
TITLE: Prep: Meeting with Jensen Huang
SLIDE: Who | Jensen Huang, CEO & Co-founder | NVIDIA, founded 1993 | Net worth ~$158B
SLIDE: NVIDIA Now | $3.4T market cap | $130B revenue FY2025 | Blackwell GPU shipping
SLIDE: Talking Points | AI infrastructure roadmap | Sovereign AI partnerships | CUDA ecosystem moat
SLIDE: Watch Out | Export controls to China | AMD MI300X competition | Customer concentration risk`,
  ],
  live_fact_check: [
    `Input: Did OpenAI raise $10B from Microsoft?
Output:
DISPLAY: verdict
CLAIM: OpenAI raised $10B from Microsoft
VERDICT: true
CONFIDENCE: high
EVIDENCE: Microsoft confirmed a $10B investment in OpenAI in Jan 2023
SOURCE: Microsoft blog`,
    `Input: Is Stripe profitable?
Output:
DISPLAY: stat_card
VALUE: $2B+
LABEL: Stripe Net Revenue (Profitable since 2024)
SENTIMENT: positive
TREND: 0.8, 1.2, 1.6, 2.1
SOURCE: WSJ, 2024`,
    `Input: Did Google acquire DeepMind for $500M?
Output:
DISPLAY: verdict
CLAIM: Google acquired DeepMind for $500M
VERDICT: partially_true
CONFIDENCE: high
EVIDENCE: Google acquired DeepMind in 2014 for approximately £400M (~$625M), not $500M
SOURCE: Financial Times`,
  ],
}

// 4 tools — same path for demo and production (MODE toggle in MANUS_SYSTEM handles the difference)
const TOOL_PROMPTS: Record<string, (args: Record<string, string>, transcript?: string) => string> = {
  intel: (args, transcript) => {
    const ctx = transcript ? `\nTRANSCRIPT (last 30s of user's mic): "${transcript}"\n` : ""
    return `${MANUS_SYSTEM}\n\nYou are a consulting intelligence analyst. Your client is on a live call and needs instant intel. Analyze the input — it could be a company name, a person, a comparison ("X vs Y"), meeting prep ("prep for X call"), a market question, or a specific stat. Pick the DISPLAY type that best fits what you find. Make it glanceable in 5 seconds.\n\nExample:\n${pickIntelExample(args.query, EXAMPLES.intel)}\n${ctx}\nInput: ${args.query}\nOutput:\nDISPLAY:`
  },

  deal_status: (args, transcript) => {
    const ctx = transcript ? `\nTRANSCRIPT (last 30s of user's mic): "${transcript}"\n` : ""
    return `${MANUS_SYSTEM}\n\nYou are a deal desk analyst. Your client needs to know where a deal stands — pipeline stage, value, risk, blockers, and next steps. If you don't have real CRM data, construct the most plausible status based on public information.\n\nExample:\n${pick(EXAMPLES.deal_status)}\n${ctx}\nInput: Deal status for ${args.client_name}\nOutput:\nDISPLAY:`
  },

  prep: (args, transcript) => {
    const ctx = transcript ? `\nTRANSCRIPT (last 30s of user's mic): "${transcript}"\n` : ""
    return `${MANUS_SYSTEM}\n\nYou are a meeting prep analyst. Your client is about to enter a call. Look at the screenshot — it might show a calendar invite, email, LinkedIn profile, or website. Generate a series of prep slides they can flick through during the call. Return 3-5 slides covering: overview, key people, talking points, and risks/watchouts.\n\nExample:\n${pick(EXAMPLES.prep)}\n${ctx}\nInput: ${args.context || "See attached screenshot"}\nOutput:\nDISPLAY:`
  },

  live_fact_check: (args, transcript) => {
    const ctx = transcript ? `\nTRANSCRIPT (last 30s of user's mic): "${transcript}"\n` : ""
    return `${MANUS_SYSTEM}\n\nYou are a real-time fact-checker. Someone just made a claim during a live call — verify it immediately. Clear verdict, evidence, confidence. Your client needs to know in 3 seconds.\n\nExample:\n${pick(EXAMPLES.live_fact_check)}\n${ctx}\nInput: ${args.claim}\nOutput:\nDISPLAY:`
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
