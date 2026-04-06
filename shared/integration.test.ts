/**
 * Full end-to-end simulation.
 *
 * Replicates the EXACT flow from keybind press to renderable card:
 *
 *   1. Build prompt (same templates ProcessingHelper uses)
 *   2. Send to Manus API (same as ManusHelper.runTool)
 *   3. Poll until complete (same polling + auto-continue logic)
 *   4. Parse response (parseManusResponse — tries JSON, line format, prose)
 *   5. Normalize for rendering (normalizeCardData)
 *   6. Validate every field PresetRenderer would access
 *
 * Run: npx vitest run shared/integration.test.ts
 */
import { describe, it, expect } from "vitest"
import { parseManusResponse } from "./parseManusJSON"
import { normalizeCardData } from "./normalizeCardData"
import { pickIntelExample } from "./queryClassifier"
import dotenv from "dotenv"
import path from "path"

dotenv.config({ path: path.resolve(__dirname, "../.env") })

const MANUS_API_KEY = process.env.MANUS_API_KEY || ""
const skipIfNoKey = MANUS_API_KEY ? describe : describe.skip

// ── Replicate the EXACT prompt templates from ProcessingHelper ──

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
  VERDICT: (one-line summary)

profile — person or company snapshot
  DISPLAY: profile
  NAME: (person or company)
  ROLE: (title or type)
  COMPANY: (company name)
  DETAIL: (key fact — repeat up to 5)
  SENTIMENT: positive | negative | neutral
  SUMMARY: (one-line takeaway)

verdict — fact check result
  DISPLAY: verdict
  CLAIM: (what was claimed)
  VERDICT: true | false | partially_true | unverifiable
  CONFIDENCE: high | medium | low
  EVIDENCE: (proof)
  SOURCE: (where verified)

checklist — briefing with action items
  DISPLAY: checklist
  TITLE: (heading)
  CONTEXT: (key fact) | high | medium | low
  ITEM: (action item — repeat)

pipeline — deal stages
  DISPLAY: pipeline
  CLIENT: (company)
  STAGES: (stage1) | (stage2) | ...
  CURRENT: (0-based index)
  VALUE: (deal value)
  RISK: low | medium | high
  NEXT: (next action)

chart — bar or donut
  DISPLAY: chart
  CHART_TYPE: bar
  TITLE: (title)
  VALUES: (num) | (num) | ...
  LABELS: (label) | (label) | ...
  SUMMARY: (insight)

slides — meeting prep deck
  DISPLAY: slides
  TITLE: (deck title)
  SLIDE: (heading) | (bullet) | (bullet) | (bullet)`

const SYSTEM_PROMPT = `SYSTEM: You are the research engine inside Manusman — a transparent overlay on a consultant's screen during live calls.

You return ONE structured response using labeled-line format. NOT JSON. Each line is KEY: value. Repeated keys become lists. Pipe | separates columns. No markdown, no fences, no prose.

${DISPLAY_FORMATS}

MODE: Research using the web.`

// Same examples as ProcessingHelper
const INTEL_EXAMPLES = [
  `Input: Stripe\nOutput:\nDISPLAY: chart\nCHART_TYPE: bar\nTITLE: Stripe Valuation ($B)\nNAME: Valuation\nVALUES: 20 | 36 | 95 | 50 | 91.5\nLABELS: 2019 | 2020 | 2021 | 2022 | 2024\nCOLOR: purple\nSUMMARY: $91.5B valuation`,
  `Input: Jensen Huang\nOutput:\nDISPLAY: profile\nNAME: Jensen Huang\nROLE: CEO & Co-founder\nCOMPANY: NVIDIA\nDETAIL: Founded NVIDIA 1993\nDETAIL: $3.4T market cap\nSENTIMENT: positive\nSUMMARY: Visionary CEO leading AI infrastructure`,
]

const FACT_CHECK_EXAMPLE = `Input: Did OpenAI raise $10B from Microsoft?\nOutput:\nDISPLAY: verdict\nCLAIM: OpenAI raised $10B from Microsoft\nVERDICT: true\nCONFIDENCE: high\nEVIDENCE: Microsoft confirmed a $10B investment in Jan 2023\nSOURCE: Microsoft blog`

const DEAL_EXAMPLE = `Input: Deal status for Snowflake\nOutput:\nDISPLAY: pipeline\nCLIENT: Snowflake\nSTAGES: Prospecting | Discovery | Proposal | Negotiation | Closed\nCURRENT: 3\nVALUE: $2M ARR\nRISK: medium\nNEXT: Final pricing review`

// ── Manus API helpers (same logic as ManusHelper) ──

async function manusCreate(prompt: string): Promise<string> {
  const res = await fetch("https://api.manus.ai/v1/tasks", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "API_KEY": MANUS_API_KEY,
      "Authorization": `Bearer ${MANUS_API_KEY}`,
    },
    body: JSON.stringify({ prompt, mode: "agent" }),
  })
  if (!res.ok) throw new Error(`Manus create: ${res.status} ${await res.text()}`)
  const data = await res.json()
  const id = data.taskId || data.task_id || data.id
  if (!id) throw new Error(`No taskId in response: ${JSON.stringify(data)}`)
  return id
}

async function manusPoll(taskId: string): Promise<{ status: string; texts: string[] }> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const res = await fetch(`https://api.manus.ai/v1/tasks/${taskId}`, {
      headers: { "accept": "application/json", "API_KEY": MANUS_API_KEY, "Authorization": `Bearer ${MANUS_API_KEY}` },
    })
    const data = await res.json()

    if (data.status === "completed" || data.status === "failed" || data.status === "error") {
      const texts: string[] = []
      for (const msg of (data.output || []).filter((m: any) => m.role === "assistant")) {
        for (const block of msg.content || []) {
          if (block.text) texts.push(block.text)
        }
      }
      return { status: data.status, texts }
    }

    // Auto-continue on pending (same as ManusHelper.pollUntilComplete)
    if (data.status === "pending") {
      const hasOutput = (data.output || []).some((m: any) => m.role === "assistant" && m.content?.length > 0)
      if (hasOutput) {
        await fetch("https://api.manus.ai/v1/tasks", {
          method: "POST",
          headers: { "accept": "application/json", "content-type": "application/json", "API_KEY": MANUS_API_KEY, "Authorization": `Bearer ${MANUS_API_KEY}` },
          body: JSON.stringify({ taskId, prompt: "Continue. Output only the labeled lines.", mode: "speed" }),
        })
      }
    }

    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error("Timed out")
}

// ── Simulate the full pipeline exactly as RadialLayout does ──

function simulateFullPipeline(texts: string[], toolName: string) {
  // Step 1: ManusHelper.parseTaskResult picks the best text block
  // (scans all assistant messages, picks first valid one, falls back to last)
  let bestText = ""
  for (const text of texts) {
    const parsed = parseManusResponse(text, toolName)
    if (parsed.valid) { bestText = text; break }
  }
  if (!bestText && texts.length > 0) bestText = texts[texts.length - 1]

  // Step 2: RadialLayout.parseResultJSON
  const parseResult = parseManusResponse(bestText, toolName)

  // Step 3: normalizeCardData (sits between parser and PresetRenderer)
  const normalized = parseResult.data ? normalizeCardData(parseResult.data) : null

  return { rawTexts: texts, bestText, parseResult, normalized }
}

// ── Field validators per display type ──
// These check exactly what PresetRenderer accesses

const RENDER_VALIDATORS: Record<string, (d: any) => string[]> = {
  stat_card: (d) => {
    const errs: string[] = []
    if (typeof d.value !== "string") errs.push("value must be string")
    if (typeof d.label !== "string") errs.push("label must be string")
    if (!["positive", "negative", "neutral"].includes(d.sentiment)) errs.push(`bad sentiment: ${d.sentiment}`)
    if (!Array.isArray(d.trend)) errs.push("trend must be array")
    if (d.trend?.some((n: any) => typeof n !== "number" || !isFinite(n))) errs.push("trend has non-finite numbers")
    return errs
  },
  comparison: (d) => {
    const errs: string[] = []
    if (typeof d.us_name !== "string") errs.push("us_name must be string")
    if (typeof d.them_name !== "string") errs.push("them_name must be string")
    if (!Array.isArray(d.metrics)) errs.push("metrics must be array")
    for (const m of d.metrics || []) {
      if (typeof m.label !== "string") errs.push("metric.label must be string")
      if (typeof m.us_score !== "number" || !isFinite(m.us_score)) errs.push(`us_score not finite: ${m.us_score}`)
      if (typeof m.them_score !== "number" || !isFinite(m.them_score)) errs.push(`them_score not finite: ${m.them_score}`)
    }
    return errs
  },
  profile: (d) => {
    const errs: string[] = []
    if (typeof d.name !== "string" || !d.name) errs.push("name must be non-empty string")
    if (!Array.isArray(d.details)) errs.push("details must be array")
    if (d.details?.some((s: any) => typeof s !== "string")) errs.push("details items must be strings")
    return errs
  },
  verdict: (d) => {
    const errs: string[] = []
    if (typeof d.claim !== "string") errs.push("claim must be string")
    if (!["true", "false", "partially_true", "unverifiable"].includes(d.verdict)) errs.push(`bad verdict: ${d.verdict}`)
    if (!["high", "medium", "low"].includes(d.confidence)) errs.push(`bad confidence: ${d.confidence}`)
    return errs
  },
  checklist: (d) => {
    const errs: string[] = []
    if (typeof d.title !== "string") errs.push("title must be string")
    if (!Array.isArray(d.context)) errs.push("context must be array")
    if (!Array.isArray(d.items)) errs.push("items must be array")
    for (const c of d.context || []) {
      if (typeof c.text !== "string") errs.push("context.text must be string")
    }
    return errs
  },
  pipeline: (d) => {
    const errs: string[] = []
    if (typeof d.client !== "string") errs.push("client must be string")
    if (!Array.isArray(d.stages)) errs.push("stages must be array")
    if (typeof d.current_stage !== "number") errs.push("current_stage must be number")
    if (d.current_stage < 0 || d.current_stage >= Math.max(1, d.stages?.length || 1)) errs.push("current_stage out of range")
    if (!["low", "medium", "high"].includes(d.risk)) errs.push(`bad risk: ${d.risk}`)
    return errs
  },
  chart: (d) => {
    const errs: string[] = []
    if (!["bar", "donut"].includes(d.chart_type)) errs.push(`bad chart_type: ${d.chart_type}`)
    if (!Array.isArray(d.datasets) || d.datasets.length === 0) errs.push("datasets must be non-empty array")
    const ds = d.datasets?.[0]
    if (ds && (!Array.isArray(ds.values) || ds.values.length === 0)) errs.push("dataset.values must be non-empty")
    if (ds?.values?.some((n: any) => typeof n !== "number" || !isFinite(n))) errs.push("dataset.values has non-finite")
    return errs
  },
  slides: (d) => {
    const errs: string[] = []
    if (!Array.isArray(d.slides) || d.slides.length === 0) errs.push("slides must be non-empty array")
    for (const s of d.slides || []) {
      if (typeof s.heading !== "string") errs.push("slide.heading must be string")
      if (!Array.isArray(s.bullets)) errs.push("slide.bullets must be array")
    }
    return errs
  },
}

// ── The test ───────────────────────────────────────────────

skipIfNoKey("Full pipeline simulation", () => {

  it("Ctrl+1 intel: company query (Anthropic)", { timeout: 180000 }, async () => {
    // 1. Build prompt exactly like ProcessingHelper.TOOL_PROMPTS.intel
    const example = pickIntelExample("Anthropic", INTEL_EXAMPLES)
    const prompt = `${SYSTEM_PROMPT}\n\nYou are a consulting intelligence analyst. Your client is on a live call and needs instant intel. Pick the DISPLAY type that best fits.\n\nExample:\n${example}\n\nInput: Anthropic\nOutput:\nDISPLAY:`

    // 2. Send to Manus (same as ManusHelper.runTool)
    console.log("[SIM] Creating Manus task for: Anthropic")
    const taskId = await manusCreate(prompt)
    console.log("[SIM] Task created:", taskId)

    await new Promise(r => setTimeout(r, 2000))
    const { status, texts } = await manusPoll(taskId)
    console.log("[SIM] Manus status:", status, "| text blocks:", texts.length)
    console.log("[SIM] Raw response:", texts[texts.length - 1]?.substring(0, 300))

    expect(status).toBe("completed")
    expect(texts.length).toBeGreaterThan(0)

    // 3-5. Full pipeline simulation
    const { normalized, parseResult } = simulateFullPipeline(texts, "intel")
    console.log("[SIM] Parse valid:", parseResult.valid, "| errors:", parseResult.errors)
    console.log("[SIM] Display type:", normalized?.display)

    expect(normalized).not.toBeNull()
    expect(normalized.display).toBeTruthy()

    // 6. Validate every field the renderer would touch
    const validator = RENDER_VALIDATORS[normalized.display]
    if (validator) {
      const renderErrors = validator(normalized)
      console.log("[SIM] Render validation:", renderErrors.length === 0 ? "PASS" : renderErrors)
      expect(renderErrors).toEqual([])
    }

    console.log("[SIM] Final card:", JSON.stringify(normalized).substring(0, 400))
  })

  it("Ctrl+4 fact check: claim verification", { timeout: 180000 }, async () => {
    const prompt = `${SYSTEM_PROMPT}\n\nYou are a real-time fact-checker. Clear verdict, evidence, confidence.\n\nExample:\n${FACT_CHECK_EXAMPLE}\n\nInput: Is Nvidia worth more than $3 trillion?\nOutput:\nDISPLAY:`

    console.log("[SIM] Creating fact-check task")
    const taskId = await manusCreate(prompt)
    await new Promise(r => setTimeout(r, 2000))
    const { status, texts } = await manusPoll(taskId)

    console.log("[SIM] Fact-check status:", status, "| blocks:", texts.length)
    console.log("[SIM] Raw:", texts[texts.length - 1]?.substring(0, 300))

    expect(status).toBe("completed")

    const { normalized, parseResult } = simulateFullPipeline(texts, "live_fact_check")
    console.log("[SIM] Parsed:", parseResult.valid, "| display:", normalized?.display)

    if (normalized) {
      const validator = RENDER_VALIDATORS[normalized.display]
      if (validator) {
        const renderErrors = validator(normalized)
        console.log("[SIM] Render validation:", renderErrors.length === 0 ? "PASS" : renderErrors)
        expect(renderErrors).toEqual([])
      }
      console.log("[SIM] Final card:", JSON.stringify(normalized).substring(0, 400))
    }
  })

  it("Ctrl+2 deal status: pipeline query", { timeout: 180000 }, async () => {
    const prompt = `${SYSTEM_PROMPT}\n\nYou are a deal desk analyst. Show deal pipeline, value, risk, blockers.\n\nExample:\n${DEAL_EXAMPLE}\n\nInput: Deal status for Salesforce\nOutput:\nDISPLAY:`

    console.log("[SIM] Creating deal-status task")
    const taskId = await manusCreate(prompt)
    await new Promise(r => setTimeout(r, 2000))
    const { status, texts } = await manusPoll(taskId)

    console.log("[SIM] Deal status:", status, "| blocks:", texts.length)
    console.log("[SIM] Raw:", texts[texts.length - 1]?.substring(0, 300))

    expect(status).toBe("completed")

    const { normalized, parseResult } = simulateFullPipeline(texts, "deal_status")
    console.log("[SIM] Parsed:", parseResult.valid, "| display:", normalized?.display)

    if (normalized) {
      const validator = RENDER_VALIDATORS[normalized.display]
      if (validator) {
        const renderErrors = validator(normalized)
        console.log("[SIM] Render validation:", renderErrors.length === 0 ? "PASS" : renderErrors)
        expect(renderErrors).toEqual([])
      }
      console.log("[SIM] Final card:", JSON.stringify(normalized).substring(0, 400))
    }
  })
})
