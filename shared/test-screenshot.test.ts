/**
 * Integration test: screenshot-attached tool flow.
 *
 * Tests the EXACT path that Ctrl+3 (prep) and Ctrl+4 (live_fact_check) take
 * when a screenshot is captured and sent as a base64 attachment to Manus API.
 *
 * This path was never tested before — we:
 *   1. Create a tiny valid PNG programmatically (1x1 red pixel)
 *   2. Encode it as data URI (same format ProcessingHelper uses)
 *   3. Send to Manus as an attachment with a slides prompt
 *   4. Poll until complete
 *   5. Parse through parseManusResponse + normalizeCardData
 *   6. Validate the result has a renderable display type
 *
 * Run: npx vitest run shared/test-screenshot.test.ts
 */
import { describe, it, expect } from "vitest"
import { parseManusResponse } from "./parseManusJSON"
import { normalizeCardData } from "./normalizeCardData"
import dotenv from "dotenv"
import path from "path"

dotenv.config({ path: path.resolve(__dirname, "../.env") })

const MANUS_API_KEY = process.env.MANUS_API_KEY || ""
const skipIfNoKey = MANUS_API_KEY ? describe : describe.skip

// ── Minimal valid PNG (1x1 red pixel) ────────────────────────
// Built from the raw PNG spec: signature + IHDR + IDAT + IEND

function createMinimalPNG(): Buffer {
  // PNG signature (8 bytes)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR chunk: 1x1, 8-bit RGB, no interlace
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(1, 0)   // width
  ihdrData.writeUInt32BE(1, 4)   // height
  ihdrData[8] = 8               // bit depth
  ihdrData[9] = 2               // color type: RGB
  ihdrData[10] = 0              // compression
  ihdrData[11] = 0              // filter
  ihdrData[12] = 0              // interlace
  const ihdr = makeChunk("IHDR", ihdrData)

  // IDAT chunk: zlib-compressed scanline (filter byte 0 + RGB red)
  // Raw scanline: [0x00, 0xFF, 0x00, 0x00] (filter=none, R=255, G=0, B=0)
  // We need to zlib-compress this
  const zlib = require("zlib")
  const rawScanline = Buffer.from([0, 255, 0, 0]) // filter byte + RGB
  const compressed = zlib.deflateSync(rawScanline)
  const idat = makeChunk("IDAT", compressed)

  // IEND chunk: empty
  const iend = makeChunk("IEND", Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

function makeChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const typeBuffer = Buffer.from(type, "ascii")
  const crcInput = Buffer.concat([typeBuffer, data])

  // CRC32 calculation
  const crc = crc32(crcInput)
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc >>> 0, 0)

  return Buffer.concat([length, typeBuffer, data, crcBuffer])
}

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return ~crc
}

// ── Manus API helpers (matches ManusHelper + integration.test.ts) ──

async function manusCreateWithAttachment(
  prompt: string,
  attachments: Array<{ filename: string; fileData: string }>
): Promise<string> {
  const res = await fetch("https://api.manus.ai/v1/tasks", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "API_KEY": MANUS_API_KEY,
      "Authorization": `Bearer ${MANUS_API_KEY}`,
    },
    body: JSON.stringify({ prompt, mode: "agent", attachments }),
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
      headers: {
        "accept": "application/json",
        "API_KEY": MANUS_API_KEY,
        "Authorization": `Bearer ${MANUS_API_KEY}`,
      },
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

    // Auto-continue on pending with output (same as ManusHelper)
    if (data.status === "pending") {
      const hasOutput = (data.output || []).some(
        (m: any) => m.role === "assistant" && m.content?.length > 0
      )
      if (hasOutput) {
        await fetch("https://api.manus.ai/v1/tasks", {
          method: "POST",
          headers: {
            "accept": "application/json",
            "content-type": "application/json",
            "API_KEY": MANUS_API_KEY,
            "Authorization": `Bearer ${MANUS_API_KEY}`,
          },
          body: JSON.stringify({
            taskId,
            prompt: "Continue. Output only the labeled lines.",
            mode: "speed",
          }),
        })
      }
    }

    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error("Timed out polling Manus")
}

// ── Prompt templates (same as ProcessingHelper) ──

const DISPLAY_FORMATS = `Available DISPLAY types and their fields:

slides — meeting prep deck
  DISPLAY: slides
  TITLE: (deck title)
  SLIDE: (heading) | (bullet) | (bullet) | (bullet)
  SLIDE: (repeat for each slide, 3-5 slides)

stat_card — a big number with trend
  DISPLAY: stat_card
  VALUE: (the main number or stat)
  LABEL: (what the number means)
  SENTIMENT: positive | negative | neutral

verdict — fact check result
  DISPLAY: verdict
  CLAIM: (what was claimed)
  VERDICT: true | false | partially_true | unverifiable
  CONFIDENCE: high | medium | low
  EVIDENCE: (proof)
  SOURCE: (where verified)

profile — person or company snapshot
  DISPLAY: profile
  NAME: (person or company)
  ROLE: (title or type)
  COMPANY: (company name)
  DETAIL: (key fact — repeat up to 5)
  SENTIMENT: positive | negative | neutral
  SUMMARY: (one-line takeaway)

checklist — briefing with action items
  DISPLAY: checklist
  TITLE: (heading)
  CONTEXT: (key fact) | high | medium | low
  ITEM: (action item — repeat)`

const SYSTEM_PROMPT = `SYSTEM: You are the research engine inside Manusman — a transparent overlay on a consultant's screen during live calls.

You return ONE structured response using labeled-line format. NOT JSON. Each line is KEY: value. Repeated keys become lists. Pipe | separates columns. No markdown, no fences, no prose.

${DISPLAY_FORMATS}

MODE: Research using the web.`

const PREP_EXAMPLE = `Input: Screenshot of calendar invite for Snowflake Q3 Review
Output:
DISPLAY: slides
TITLE: Prep: Snowflake Q3 Review
SLIDE: Company Snapshot | $2.1B ARR, 30% YoY growth | Consumption-based pricing | Cortex AI platform launching
SLIDE: Key People | Frank Slootman (CEO) retired, Sridhar Ramaswamy now CEO | Chris Degnan (CRO) | Grzegorz Czajkowski (EVP Product)
SLIDE: Talking Points | Cloud cost optimization trend | How Cortex competes with Databricks | Net revenue retention declining to 127%
SLIDE: Watch Outs | Slowing growth narrative | Databricks IPO comparisons | Heavy insider selling Q2`

// ── Pipeline simulation (same as integration.test.ts) ──

function simulateFullPipeline(texts: string[], toolName: string) {
  // Try every text block, pick the first one with valid data (matches ManusHelper logic)
  let bestText = ""
  let bestResult: ReturnType<typeof parseManusResponse> | null = null

  for (const text of texts) {
    const parsed = parseManusResponse(text, toolName)
    if (parsed.valid) {
      bestText = text
      bestResult = parsed
      break
    }
    // Also accept data with a known display type even if not fully valid
    if (parsed.data?.display && !bestResult) {
      bestText = text
      bestResult = parsed
    }
  }

  // Fallback: use last text block
  if (!bestText && texts.length > 0) {
    bestText = texts[texts.length - 1]
    bestResult = parseManusResponse(bestText, toolName)
  }

  if (!bestResult) bestResult = parseManusResponse("", toolName)

  const normalized = bestResult.data ? normalizeCardData(bestResult.data) : null

  // Debug: log all blocks with FULL content
  console.log(`[PIPELINE] ${texts.length} text blocks, bestText length: ${bestText.length}`)
  for (let i = 0; i < texts.length; i++) {
    const p = parseManusResponse(texts[i], toolName)
    console.log(`[PIPELINE] Block ${i}: valid=${p.valid}, fallback=${p.fallback}, display=${p.data?.display}, errors=${p.errors.join("; ")}`)
    console.log(`[PIPELINE] Block ${i} FULL (first 600 chars): ${texts[i].substring(0, 600)}`)
  }

  return { rawTexts: texts, bestText, parseResult: bestResult, normalized }
}

// ── Render validators (same as integration.test.ts) ──

const VALID_DISPLAY_TYPES = new Set([
  "stat_card", "comparison", "profile", "verdict",
  "checklist", "pipeline", "chart", "slides",
])

const RENDER_VALIDATORS: Record<string, (d: any) => string[]> = {
  slides: (d) => {
    const errs: string[] = []
    if (!Array.isArray(d.slides) || d.slides.length === 0) errs.push("slides must be non-empty array")
    for (const s of d.slides || []) {
      if (typeof s.heading !== "string") errs.push("slide.heading must be string")
      if (!Array.isArray(s.bullets)) errs.push("slide.bullets must be array")
    }
    return errs
  },
  verdict: (d) => {
    const errs: string[] = []
    if (typeof d.claim !== "string") errs.push("claim must be string")
    if (!["true", "false", "partially_true", "unverifiable"].includes(d.verdict)) errs.push(`bad verdict: ${d.verdict}`)
    if (!["high", "medium", "low"].includes(d.confidence)) errs.push(`bad confidence: ${d.confidence}`)
    return errs
  },
  stat_card: (d) => {
    const errs: string[] = []
    if (typeof d.value !== "string") errs.push("value must be string")
    if (typeof d.label !== "string") errs.push("label must be string")
    return errs
  },
  profile: (d) => {
    const errs: string[] = []
    if (typeof d.name !== "string" || !d.name) errs.push("name must be non-empty string")
    if (!Array.isArray(d.details)) errs.push("details must be array")
    return errs
  },
  checklist: (d) => {
    const errs: string[] = []
    if (typeof d.title !== "string") errs.push("title must be string")
    if (!Array.isArray(d.context)) errs.push("context must be array")
    if (!Array.isArray(d.items)) errs.push("items must be array")
    return errs
  },
  chart: (d) => {
    const errs: string[] = []
    if (!["bar", "donut"].includes(d.chart_type)) errs.push(`bad chart_type: ${d.chart_type}`)
    if (!Array.isArray(d.datasets) || d.datasets.length === 0) errs.push("datasets must be non-empty array")
    return errs
  },
  comparison: (d) => {
    const errs: string[] = []
    if (typeof d.us_name !== "string") errs.push("us_name must be string")
    if (typeof d.them_name !== "string") errs.push("them_name must be string")
    if (!Array.isArray(d.metrics)) errs.push("metrics must be array")
    return errs
  },
  pipeline: (d) => {
    const errs: string[] = []
    if (typeof d.client !== "string") errs.push("client must be string")
    if (!Array.isArray(d.stages)) errs.push("stages must be array")
    if (typeof d.current_stage !== "number") errs.push("current_stage must be number")
    return errs
  },
}

// ── The tests ────────────────────────────────────────────────

skipIfNoKey("Screenshot-attached tool flow", () => {

  it("PNG is valid and encodes to data URI like ProcessingHelper", () => {
    const png = createMinimalPNG()

    // Verify PNG signature
    expect(png[0]).toBe(137)
    expect(png[1]).toBe(80)  // P
    expect(png[2]).toBe(78)  // N
    expect(png[3]).toBe(71)  // G

    // Encode exactly like ProcessingHelper line 622
    const dataUri = `data:image/png;base64,${png.toString("base64")}`
    expect(dataUri).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/)

    console.log("[SCREENSHOT] PNG size:", png.length, "bytes")
    console.log("[SCREENSHOT] Data URI length:", dataUri.length, "chars")
    console.log("[SCREENSHOT] Data URI prefix:", dataUri.substring(0, 40) + "...")
  })

  it("Ctrl+3 prep: screenshot attachment → slides card", { timeout: 180000 }, async () => {
    // 1. Create the screenshot attachment exactly as ProcessingHelper does
    const png = createMinimalPNG()
    const dataUri = `data:image/png;base64,${png.toString("base64")}`
    const attachments = [{ filename: "screenshot.png", fileData: dataUri }]

    // 2. Build prompt (same as ProcessingHelper.TOOL_PROMPTS.prep)
    const prompt = `${SYSTEM_PROMPT}\n\nYou are a meeting prep analyst. Your client is about to enter a call. Look at the screenshot — it might show a calendar invite, email, LinkedIn profile, or website. Generate a series of prep slides they can flick through during the call. Return 3-5 slides covering: overview, key people, talking points, and risks/watchouts.\n\nExample:\n${PREP_EXAMPLE}\n\nInput: Screenshot shows a calendar invite for "Q1 Strategy Review with Stripe" scheduled for next week\nOutput:\nDISPLAY:`

    // 3. Send to Manus with attachment
    console.log("[SCREENSHOT] Creating Manus task with PNG attachment...")
    const taskId = await manusCreateWithAttachment(prompt, attachments)
    console.log("[SCREENSHOT] Task created:", taskId)

    // 4. Poll until complete
    await new Promise((r) => setTimeout(r, 2000))
    const { status, texts } = await manusPoll(taskId)
    console.log("[SCREENSHOT] Status:", status, "| text blocks:", texts.length)
    console.log("[SCREENSHOT] Raw response:", texts[texts.length - 1]?.substring(0, 400))

    expect(status).toBe("completed")
    expect(texts.length).toBeGreaterThan(0)

    // 5. Parse through the full pipeline
    const { normalized, parseResult } = simulateFullPipeline(texts, "prep")
    console.log("[SCREENSHOT] Parse valid:", parseResult.valid, "| errors:", parseResult.errors)
    console.log("[SCREENSHOT] Display type:", normalized?.display)

    expect(normalized).not.toBeNull()
    expect(normalized.display).toBeTruthy()
    expect(VALID_DISPLAY_TYPES.has(normalized.display)).toBe(true)

    // 6. Validate render-safety for whatever display type came back
    const validator = RENDER_VALIDATORS[normalized.display]
    if (validator) {
      const renderErrors = validator(normalized)
      console.log("[SCREENSHOT] Render validation:", renderErrors.length === 0 ? "PASS" : renderErrors)
      expect(renderErrors).toEqual([])
    }

    console.log("[SCREENSHOT] Final card:", JSON.stringify(normalized).substring(0, 500))
  })

  it("Ctrl+4 fact check: screenshot attachment accepted by API", { timeout: 180000 }, async () => {
    // This test validates the screenshot attachment flow works end-to-end:
    // - API accepts the base64 PNG attachment
    // - Task completes (doesn't error/reject the attachment)
    // - If structured data comes back, it parses correctly
    //
    // Note: Manus agent mode is non-deterministic. Sometimes the agent
    // acknowledges the task but returns prose instead of structured format.
    // We test the attachment acceptance firmly, parsing best-effort.

    // 1. Create screenshot attachment
    const png = createMinimalPNG()
    const dataUri = `data:image/png;base64,${png.toString("base64")}`
    const attachments = [{ filename: "screenshot.png", fileData: dataUri }]

    // 2. Build prompt (same as ProcessingHelper.TOOL_PROMPTS.live_fact_check)
    const FACT_CHECK_EXAMPLE = `Input: Did OpenAI raise $10B from Microsoft?
Output:
DISPLAY: verdict
CLAIM: OpenAI raised $10B from Microsoft
VERDICT: true
CONFIDENCE: high
EVIDENCE: Microsoft confirmed a $10B investment in Jan 2023
SOURCE: Microsoft blog`

    const prompt = `${SYSTEM_PROMPT}\n\nYou are a real-time fact-checker. Your client needs instant verification. Look at the screenshot and the claim. Return a clear verdict with evidence and confidence level.\n\nExample:\n${FACT_CHECK_EXAMPLE}\n\nInput: Is Apple's market cap over $3 trillion? (see screenshot for context)\nOutput:\nDISPLAY:`

    // 3. Send to Manus with attachment — this is the core assertion
    console.log("[SCREENSHOT] Creating fact-check task with PNG attachment...")
    const taskId = await manusCreateWithAttachment(prompt, attachments)
    console.log("[SCREENSHOT] Task created:", taskId)
    expect(taskId).toBeTruthy() // API accepted the attachment

    // 4. Poll until complete
    await new Promise((r) => setTimeout(r, 2000))
    const { status, texts } = await manusPoll(taskId)
    console.log("[SCREENSHOT] Fact-check status:", status, "| blocks:", texts.length)
    console.log("[SCREENSHOT] Raw:", texts[texts.length - 1]?.substring(0, 400))

    // Task must complete without error (attachment wasn't rejected)
    expect(status).toBe("completed")
    expect(texts.length).toBeGreaterThan(0)

    // 5. Best-effort parse — structured data is nice but the agent is flaky
    const { normalized, parseResult } = simulateFullPipeline(texts, "live_fact_check")
    console.log("[SCREENSHOT] Parse valid:", parseResult.valid, "| display:", normalized?.display)

    if (normalized && normalized.display) {
      // If we got structured data, validate it renders cleanly
      expect(VALID_DISPLAY_TYPES.has(normalized.display)).toBe(true)
      const validator = RENDER_VALIDATORS[normalized.display]
      if (validator) {
        const renderErrors = validator(normalized)
        console.log("[SCREENSHOT] Render validation:", renderErrors.length === 0 ? "PASS" : renderErrors)
        expect(renderErrors).toEqual([])
      }
      console.log("[SCREENSHOT] Final card:", JSON.stringify(normalized).substring(0, 500))
    } else {
      // Agent returned prose only — still a pass for attachment acceptance
      console.log("[SCREENSHOT] Agent returned prose (no structured data). Attachment was accepted, task completed. This is expected Manus flakiness.")
    }
  })
})
