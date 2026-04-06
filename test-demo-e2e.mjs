/**
 * End-to-end demo mode test.
 * Builds the EXACT prompt ProcessingHelper builds in DEMO_MODE,
 * sends it to Manus, parses it, normalizes it.
 *
 * Run: node test-demo-e2e.mjs
 */
import dotenv from "dotenv"
dotenv.config()

const MANUS_API_KEY = process.env.MANUS_API_KEY

// ── Copy the exact DISPLAY_FORMATS from ProcessingHelper ──
const DISPLAY_FORMATS = `Available DISPLAY types and their fields:

stat_card — a big number with trend
  DISPLAY: stat_card
  VALUE: (the main number or stat)
  LABEL: (what the number means)
  SENTIMENT: positive | negative | neutral
  TREND: (comma-separated numbers, oldest to newest)
  SOURCE: (where you found this)

profile — person or company snapshot
  DISPLAY: profile
  NAME: (person or company)
  ROLE: (title or type)
  COMPANY: (company name, if person)
  DETAIL: (key fact — repeat up to 5 lines)
  SENTIMENT: positive | negative | neutral
  SUMMARY: (one-line takeaway)

pipeline — deal stages
  DISPLAY: pipeline
  CLIENT: (company name)
  STAGES: (stage1) | (stage2) | ...
  CURRENT: (stage index, 0-based)
  VALUE: (deal value)
  RISK: low | medium | high
  NEXT: (next action)

chart — bar or donut
  DISPLAY: chart
  CHART_TYPE: bar | donut
  TITLE: (chart title)
  VALUES: (num) | (num) | ...
  LABELS: (label) | (label) | ...
  SUMMARY: (insight)`

// ── DEMO_SYSTEM — exact copy from ProcessingHelper ──
const DEMO_SYSTEM = `You MUST respond using ONLY labeled lines. NOTHING ELSE.

RULES:
1. First line MUST be "DISPLAY: <type>"
2. Every line MUST be "KEY: value"
3. NO prose. NO explanations. NO markdown. NO JSON. If you write anything else, the system crashes.
4. Repeated keys become lists. Pipe | separates columns.

${DISPLAY_FORMATS}

You have access to the user's connected workspace data (Notion, Google Drive, Instagram). The data is shown below. Use ONLY this data. Do not research, browse, or use external tools. Answer instantly.

DISPLAY HINTS:
- Person name (e.g. "Rex Heng") -> use profile.
- Company name (e.g. "Rex Corp") -> use stat_card.
- Deal/status query -> use pipeline.`

// ── DEMO_CONTEXT — trimmed to the relevant bits ──
const DEMO_CONTEXT = `
=== CONNECTED: Notion — CCN London / Rex Corp ===

COMPANY: Rex Corp
- Enterprise data analytics platform (SaaS)
- HQ: San Francisco | Offices: London, Singapore, Sydney
- Founded: 2019 by Nathan Karri (CTO) and Kiki Zhang (CEO)
- ARR: $48M, 42% YoY growth
- Valuation: $620M post-money
- Key product: "Rex Lens" — real-time analytics for enterprise ops

KEY PEOPLE:
- Kiki Zhang, CEO & Co-founder — ex-McKinsey partner (7 yrs), Stanford MBA 2016.
- Nathan Karri, CTO & Co-founder — ex-Google (led BigQuery team 2015-2019). Building "Rex AI" predictive module.
- Rex Heng, VP of Strategy — ex-BCG (5 yrs, London office), joined Rex Corp Jan 2024. Leading consulting vertical expansion. YOUR PRIMARY CONTACT.

=== CONNECTED: Instagram — @rexheng ===
Bio: "VP Strategy @RexCorp | ex-BCG | Data nerd | London -> SF"
Recent: Posted about Rex Corp's Snowflake partnership (Feb 2026). Shared stage at SaaStr Annual.

=== CONNECTED: Google Drive — Q1 Shared Folder ===
RexCorp_Phase2_Proposal.docx:
- Phase 2: $2.4M annual contract — full Lens deployment across EMEA ops
- Pipeline stage: Proposal -> awaiting CEO sign-off
- Decision deadline: April 18, 2026

=== DEAL STATUS ===
Risk: MEDIUM
- Champion (Rex Heng) is strong
- Technical validation passed
- CFO wants ROI model before signing
- Palantir undercutting on price by $600K
- 14 days until decision deadline
`

const EXAMPLE = `Input: Jensen Huang
Output:
DISPLAY: profile
NAME: Jensen Huang
ROLE: CEO & Co-founder
COMPANY: NVIDIA
DETAIL: Founded NVIDIA 1993
DETAIL: $3.4T market cap
SENTIMENT: positive
SUMMARY: Visionary CEO leading AI infrastructure`

// ── Three queries to test ──
const QUERIES = [
  { name: "Person lookup", tool: "intel", input: "Rex Heng" },
  { name: "Company lookup", tool: "intel", input: "Rex Corp" },
  { name: "Deal status", tool: "deal_status", input: "Rex Corp" },
]

// ── Manus API ──
async function createTask(prompt) {
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
  const data = await res.json()
  return data.taskId || data.task_id || data.id
}

async function poll(taskId) {
  await new Promise(r => setTimeout(r, 2000))
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`https://api.manus.ai/v1/tasks/${taskId}`, {
      headers: { "accept": "application/json", "API_KEY": MANUS_API_KEY, "Authorization": `Bearer ${MANUS_API_KEY}` },
    })
    const data = await res.json()
    process.stdout.write(".")

    if (data.status === "completed" || data.status === "failed" || data.status === "error") {
      console.log(` ${data.status}`)
      const msgs = (data.output || []).filter(m => m.role === "assistant")
      const texts = []
      for (const msg of msgs) {
        for (const block of msg.content || []) {
          if (block.text) texts.push(block.text)
        }
      }
      return { status: data.status, texts }
    }

    if (data.status === "pending") {
      const hasOutput = (data.output || []).some(m => m.role === "assistant" && m.content?.length > 0)
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
  return { status: "timeout", texts: [] }
}

// ── Parse with real shared modules ──
const { parseManusResponse } = await import("./shared/parseManusJSON.ts")
const { normalizeCardData } = await import("./shared/normalizeCardData.ts")

// ── Run all 3 ──
for (const q of QUERIES) {
  console.log(`\n${"=".repeat(60)}`)
  console.log(`TEST: ${q.name} — "${q.input}"`)
  console.log("=".repeat(60))

  // Build exact demo prompt
  let prompt
  if (q.tool === "deal_status") {
    prompt = `${DEMO_SYSTEM}\n\n${DEMO_CONTEXT}\n\nInput: Deal status for ${q.input}\nOutput:\nDISPLAY:`
  } else {
    prompt = `${DEMO_SYSTEM}\n\n${DEMO_CONTEXT}\n\nExample:\n${EXAMPLE}\n\nInput: ${q.input}\nOutput:\nDISPLAY:`
  }

  console.log(`Prompt: ${prompt.length} chars`)

  const taskId = await createTask(prompt)
  console.log(`Task: ${taskId}`)
  process.stdout.write("Polling")

  const { status, texts } = await poll(taskId)
  const rawText = texts[texts.length - 1] || ""

  console.log(`\nRAW RESPONSE:\n${rawText}\n`)

  // Parse
  const parsed = parseManusResponse(rawText, q.tool)
  console.log(`PARSE: valid=${parsed.valid}, errors=[${parsed.errors.join(", ")}]`)

  if (parsed.data) {
    const card = normalizeCardData(parsed.data)
    console.log(`CARD: display=${card.display}`)
    console.log(JSON.stringify(card, null, 2))
  } else {
    console.log("CARD: FAILED — no data parsed")
  }
}
