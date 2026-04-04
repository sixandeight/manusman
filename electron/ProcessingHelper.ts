// ProcessingHelper.ts

import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import { ManusHelper, ManusResult } from "./ManusHelper"
import { TranscriptionHelper } from "./TranscriptionHelper"
import fs from "fs"
import { pickIntelExample } from "../shared/queryClassifier"
import dotenv from "dotenv"

dotenv.config()

const DEMO_MODE = process.env.DEMO_MODE === "true"

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

// System prompt — asks for line format, not JSON
const MANUS_SYSTEM = `SYSTEM: You are the research engine inside Manusman — a transparent overlay on a consultant's screen during live calls.

The user pressed a keybind. You get: a QUERY (what they typed), optionally a TRANSCRIPT (last 30s of their mic), and optionally a SCREENSHOT. If transcript conflicts with query, trust the transcript — it's what's actually being discussed.

You return ONE structured response using our labeled-line format (shown below). NOT JSON. Each line is KEY: value. Repeated keys become lists. Pipe | separates columns. No markdown, no fences, no prose — just the labeled lines.

The response renders as a card the consultant glances at for 3-5 seconds. Every field must earn its place.

Rules: Numbers > adjectives. New info > background. Skip what a senior consultant already knows. No hallucinated entities. Only answer about what was asked.

Pick the best DISPLAY type:

${DISPLAY_FORMATS}

MODE: Research using the web. If connectors unavailable, skip silently. No apologies.`

// ── Demo mode ──────────────────────────────────────────────
// Lean system prompt — no agency framing, no research instructions.
// Just: "here's the data, format it as a card."

const DEMO_SYSTEM = `Format a response using labeled lines. NOT JSON. Each line is KEY: value. Repeated keys become lists. Pipe | separates columns. No markdown, no fences, no prose.

${DISPLAY_FORMATS}

You have access to the user's connected workspace data (Notion, Google Drive, Instagram). The data is shown below. Use ONLY this data. Do not research, browse, or use external tools. Answer instantly.

When citing where information came from, tag the source realistically:
- Company/deal/people data → "Notion — Rex Corp workspace"
- Financial docs, proposals, contracts → "Google Drive — Q1 Shared Folder"
- Social/personal intel → "Instagram — @rexheng"
- Meeting notes → "Notion — Meeting Notes / Rex Corp"
- Market data → "Google Drive — Market Research 2026.xlsx"

DISPLAY HINTS — pick the type that matches the query pattern:
- Person name (e.g. "Rex Heng") → use profile. Include deal_stage if they're part of a deal.
- Company name alone (e.g. "Rex Corp") → use stat_card. Lead with ARR or valuation, show quarterly trend.
- "X vs Y" or comparison language → use comparison. Score 4-6 metrics, declare a winner.
- Market/industry/share query (e.g. "analytics market") → use chart with chart_type donut.
- Deal/status query → use pipeline. Show stages, current position, risk, blocker.
- Meeting/prep query → use slides. 4 slides: snapshot, key people, talking points, watch outs.
- Fact/claim to verify → use verdict. Bold TRUE/FALSE, cite the source doc.
- Action items / "what should I" → use checklist. Priority-tagged context + checkbox items.
These are hints, not rules — but follow them unless the data clearly fits a different type.`

const DEMO_CONTEXT = `
=== CONNECTED: Notion — CCN London / Rex Corp ===

COMPANY: Rex Corp
- Enterprise data analytics platform (SaaS)
- HQ: San Francisco | Offices: London, Singapore, Sydney
- Founded: 2019 by Nathan Karri (CTO) and Kiki Zhang (CEO)
- ARR: $48M, 42% YoY growth
- Headcount: 320 (up from 210 last year)
- Series C: $85M raised (Sequoia led, Feb 2025)
- Valuation: $620M post-money
- Key product: "Rex Lens" — real-time analytics for enterprise ops
- Competitors: Palantir ($1.8M counter-bid), Databricks, ThoughtSpot
- NPS: 72 (industry avg: 45)
- Tech stack: Snowflake, AWS, dbt, Kubernetes

KEY PEOPLE:
- Kiki Zhang, CEO & Co-founder — ex-McKinsey partner (7 yrs), Stanford MBA 2016. Aggressive expansion targets. Wants 3x ARR by 2027. Also handles finance — skeptical of per-seat pricing, wants usage-based.
- Nathan Karri, CTO & Co-founder — ex-Google (led BigQuery team 2015-2019). Building "Rex AI" predictive module. Wants a joint case study with us.
- Rex Heng, VP of Strategy — ex-BCG (5 yrs, London office), joined Rex Corp Jan 2024. Leading consulting vertical expansion. YOUR PRIMARY CONTACT. Championing the deal internally.

=== CONNECTED: Notion — Meeting Notes / Rex Corp ===

Mar 20, 2026: Rex demo'd Lens to EMEA leads. Positive reception. Asked about SSO integration timeline.
Mar 28, 2026: Kiki pushed back on per-seat pricing. Wants usage-based model. Rex backed our proposal internally.
Apr 1, 2026: Technical deep-dive with Nathan Karri. Confirmed API compatibility with our stack. He asked about joint case study. Rex mentioned Q2 board meeting — wants deal closed before then.

=== CONNECTED: Google Drive — Q1 Shared Folder ===

RexCorp_Phase1_Results.pdf:
- Phase 1 pilot: $180K, 3-month data migration audit — COMPLETED ✓
- Migrated 2.3TB across 14 data sources
- Reduced query latency by 62%
- Client satisfaction: 4.7/5

RexCorp_Phase2_Proposal.docx:
- Phase 2: $2.4M annual contract — full Lens deployment across EMEA ops
- Scope: 12 business units, 850 users, 3 data centers
- Timeline: 6-month rollout, go-live target Sept 2026
- Pipeline stage: Proposal → awaiting CEO sign-off
- Decision deadline: April 18, 2026

RexCorp_Competitive_Intel.xlsx:
- Palantir submitted $1.8M counter-proposal (stripped SSO, no APAC support, 18-month lock-in)
- Databricks quoted $2.1M but no professional services
- ThoughtSpot withdrew after Phase 1

=== CONNECTED: Google Drive — Market Research 2026.xlsx ===

Enterprise Analytics Market:
- TAM: $95B (2026), projected $142B by 2028
- Rex Corp market share: 1.2% (up from 0.6% in 2024)
- Palantir market share: 4.8%
- Growth segment: mid-market SaaS (Rex Corp's sweet spot)

Rex Corp Financials (public + estimates):
- Q1 2025: $11.2M rev (+38% YoY)
- Q2 2025: $12.8M rev (+44% YoY)
- Q3 2025: $13.1M rev (+40% YoY)
- Q4 2025: $14.5M rev (+46% YoY)
- Gross margin: 78%
- Burn: $3.2M/month (down from $4.1M)
- Runway: 18 months

=== CONNECTED: Instagram — @rexheng ===

Bio: "VP Strategy @RexCorp | ex-BCG | Data nerd | London → SF"
Recent: Posted about Rex Corp's Snowflake partnership (Feb 2026). Shared stage at SaaStr Annual. Follows our company page.
Style: Professional but approachable. Posts about data strategy, consulting life, occasional travel.

=== CONNECTED: Instagram — @kiki.zhang.ceo ===

Bio: "CEO @RexCorp | Building the future of enterprise analytics"
Recent: Announced Singapore office opening (Jan 2026). Posted Series C celebration. Active thought leader — 12K followers.

=== DEAL STATUS ===

Risk: MEDIUM
- ✅ Champion (Rex) is strong
- ✅ Technical validation passed
- ⚠️ Kiki (CEO) wants ROI model before signing
- ⚠️ Palantir undercutting on price by $600K
- ⚠️ Board meeting Q2 — political pressure to close
- ✅ Phase 1 results were strong (4.7/5 satisfaction)
- Timeline: 14 days until decision deadline
`

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

// 4 tools — transcript is passed in so it appears BEFORE Input/Output trigger
const TOOL_PROMPTS: Record<string, (args: Record<string, string>, transcript?: string) => string> = {
  intel: (args, transcript) => {
    if (DEMO_MODE) {
      return `${DEMO_SYSTEM}\n\n${DEMO_CONTEXT}\n\nExample:\n${pickIntelExample(args.query, EXAMPLES.intel)}\n\nInput: ${args.query}\nOutput:\nDISPLAY:`
    }
    const ctx = transcript ? `\nTRANSCRIPT (last 30s of user's mic): "${transcript}"\n` : ""
    return `${MANUS_SYSTEM}\n\nYou are a consulting intelligence analyst. Your client is on a live call and needs instant intel. Analyze the input — it could be a company name, a person, a comparison ("X vs Y"), meeting prep ("prep for X call"), a market question, or a specific stat. Pick the DISPLAY type that best fits what you find. Make it glanceable in 5 seconds.\n\nExample:\n${pickIntelExample(args.query, EXAMPLES.intel)}\n${ctx}\nInput: ${args.query}\nOutput:\nDISPLAY:`
  },

  deal_status: (args, transcript) => {
    if (DEMO_MODE) {
      return `${DEMO_SYSTEM}\n\n${DEMO_CONTEXT}\n\nExample:\n${pick(EXAMPLES.deal_status)}\n\nInput: Deal status for ${args.client_name}\nOutput:\nDISPLAY:`
    }
    const ctx = transcript ? `\nTRANSCRIPT (last 30s of user's mic): "${transcript}"\n` : ""
    return `${MANUS_SYSTEM}\n\nYou are a deal desk analyst. Your client needs to know where a deal stands — pipeline stage, value, risk, blockers, and next steps. If you don't have real CRM data, construct the most plausible status based on public information.\n\nExample:\n${pick(EXAMPLES.deal_status)}\n${ctx}\nInput: Deal status for ${args.client_name}\nOutput:\nDISPLAY:`
  },

  prep: (args, transcript) => {
    if (DEMO_MODE) {
      return `${DEMO_SYSTEM}\n\n${DEMO_CONTEXT}\n\nExample:\n${pick(EXAMPLES.prep)}\n\nInput: ${args.context || "Prep for upcoming Meridian meeting"}\nOutput:\nDISPLAY:`
    }
    const ctx = transcript ? `\nTRANSCRIPT (last 30s of user's mic): "${transcript}"\n` : ""
    return `${MANUS_SYSTEM}\n\nYou are a meeting prep analyst. Your client is about to enter a call. Look at the screenshot — it might show a calendar invite, email, LinkedIn profile, or website. Generate a series of prep slides they can flick through during the call. Return 3-5 slides covering: overview, key people, talking points, and risks/watchouts.\n\nExample:\n${pick(EXAMPLES.prep)}\n${ctx}\nInput: ${args.context || "See attached screenshot"}\nOutput:\nDISPLAY:`
  },

  live_fact_check: (args, transcript) => {
    if (DEMO_MODE) {
      return `${DEMO_SYSTEM}\n\n${DEMO_CONTEXT}\n\nExample:\n${pick(EXAMPLES.live_fact_check)}\n\nInput: ${args.claim}\nOutput:\nDISPLAY:`
    }
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
