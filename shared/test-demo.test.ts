/**
 * Demo mode prompt path test.
 *
 * Replicates the EXACT demo prompt flow from ProcessingHelper:
 *   DEMO_SYSTEM + DEMO_CONTEXT + example + "Input: ...\nOutput:\nDISPLAY:"
 *   → Kimi K2.5 API (not Manus)
 *   → parseManusResponse (tries JSON, line format, prose fallback)
 *   → normalizeCardData (type-safe fields for PresetRenderer)
 *   → validate every field the renderer touches
 *
 * Run: npx vitest run shared/test-demo.test.ts
 */
import { describe, it, expect } from "vitest"
import { parseManusResponse } from "./parseManusJSON"
import { normalizeCardData } from "./normalizeCardData"
import { pickIntelExample } from "./queryClassifier"
import dotenv from "dotenv"
import path from "path"

dotenv.config({ path: path.resolve(__dirname, "../.env") })

const KIMI_API_KEY = process.env.KIMI_API_KEY || ""
const skipIfNoKey = KIMI_API_KEY ? describe : describe.skip

// ── Replicate DEMO_SYSTEM from ProcessingHelper (line 115) ──

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
- Founded: 2019 by Nathan Osei (CTO) and Priya Sharma (CEO)
- ARR: $48M, 42% YoY growth
- Headcount: 320 (up from 210 last year)
- Series C: $85M raised (Sequoia led, Feb 2025)
- Valuation: $620M post-money
- Key product: "Rex Lens" — real-time analytics for enterprise ops
- Competitors: Palantir ($1.8M counter-bid), Databricks, ThoughtSpot
- NPS: 72 (industry avg: 45)
- Tech stack: Snowflake, AWS, dbt, Kubernetes

KEY PEOPLE:
- Priya Sharma, CEO & Co-founder — ex-McKinsey partner (7 yrs), Stanford MBA 2016. Aggressive expansion targets. Wants 3x ARR by 2027.
- Nathan Osei, CTO & Co-founder — ex-Google (led BigQuery team 2015-2019). Building "Rex AI" predictive module. Wants a joint case study with us.
- Rex Heng, VP of Strategy — ex-BCG (5 yrs, London office), joined Rex Corp Jan 2024. Leading consulting vertical expansion. YOUR PRIMARY CONTACT. Championing the deal internally.
- Lena Voss, CFO — ex-Stripe finance, joined Q1 2025. Cost-conscious. Pushing for profitability by Q4. THE ECONOMIC BUYER. Skeptical of per-seat pricing.
- Ayo Adeyemi, Head of Partnerships — manages channel/SI relationships. Friendly, wants co-marketing.

=== CONNECTED: Notion — Meeting Notes / Rex Corp ===

Mar 20, 2026: Rex demo'd Lens to EMEA leads. Positive reception. Asked about SSO integration timeline.
Mar 28, 2026: Lena Voss joined. Pushed back on per-seat pricing. Wants usage-based model. Priya Sharma backed our proposal.
Apr 1, 2026: Technical deep-dive with Nathan Osei. Confirmed API compatibility with our stack. He asked about joint case study. Rex mentioned Q2 board meeting — wants deal closed before then.

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
- Pipeline stage: Proposal → awaiting CFO sign-off
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

=== CONNECTED: Instagram — @priya.sharma.ceo ===

Bio: "CEO @RexCorp | Building the future of enterprise analytics"
Recent: Announced Singapore office opening (Jan 2026). Posted Series C celebration. Active thought leader — 12K followers.

=== DEAL STATUS ===

Risk: MEDIUM
- ✅ Champion (Rex) is strong
- ✅ Technical validation passed
- ⚠️ CFO wants ROI model before signing
- ⚠️ Palantir undercutting on price by $600K
- ⚠️ Board meeting Q2 — political pressure to close
- ✅ Phase 1 results were strong (4.7/5 satisfaction)
- Timeline: 14 days until decision deadline
`

// ── Few-shot examples (same array as ProcessingHelper.EXAMPLES.intel) ──

const INTEL_EXAMPLES = [
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
  `Input: OpenAI ARR
Output:
DISPLAY: stat_card
VALUE: $13B
LABEL: OpenAI Annualized Revenue
SENTIMENT: positive
TREND: 0.2, 1.3, 3.4, 13
SOURCE: Internal estimates, 2024`,
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
]

const DEAL_EXAMPLES = [
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
]

// ── Kimi API helper ──

async function callKimi(prompt: string): Promise<string> {
  const res = await fetch("https://api.moonshot.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${KIMI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "kimi-k2.5",
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Kimi API ${res.status}: ${body}`)
  }

  const data = await res.json()
  return data.choices[0].message.content
}

// ── Render validators (same as integration.test.ts) ──

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

// ── Helper: prepend DISPLAY: if the LLM didn't echo it ──
// The prompt ends with "Output:\nDISPLAY:" — the LLM may complete with just
// the value ("stat_card\n...") or echo the full key ("DISPLAY: stat_card\n...").
function prefixDisplay(raw: string): string {
  const trimmed = raw.trimStart()
  if (/^DISPLAY\s*:/i.test(trimmed)) return trimmed
  return "DISPLAY: " + trimmed
}

// ── Helper: run the full pipeline on Kimi response text ──

function runPipeline(rawText: string, toolName: string) {
  const parseResult = parseManusResponse(rawText, toolName)
  const normalized = parseResult.data ? normalizeCardData(parseResult.data) : null
  return { parseResult, normalized }
}

// ── Tests ──

skipIfNoKey("Demo mode prompt path (Kimi K2.5)", () => {

  it("Intel: Rex Corp → parseable card (stat_card or chart expected)", { timeout: 120000 }, async () => {
    // Build prompt exactly as ProcessingHelper.TOOL_PROMPTS.intel does in DEMO_MODE
    const query = "Rex Corp"
    const example = pickIntelExample(query, INTEL_EXAMPLES)
    const prompt = `${DEMO_SYSTEM}\n\n${DEMO_CONTEXT}\n\nExample:\n${example}\n\nInput: ${query}\nOutput:\nDISPLAY:`

    console.log("[DEMO] Sending intel query: Rex Corp")
    const rawText = prefixDisplay(await callKimi(prompt))
    console.log("[DEMO] Raw response (first 500 chars):", rawText.substring(0, 500))

    const { parseResult, normalized } = runPipeline(rawText, "intel")

    console.log("[DEMO] Parse valid:", parseResult.valid, "| errors:", parseResult.errors)
    console.log("[DEMO] Display type:", normalized?.display)

    expect(parseResult.valid).toBe(true)
    expect(normalized).not.toBeNull()
    expect(normalized.display).toBeTruthy()

    // Validate renderer fields
    const validator = RENDER_VALIDATORS[normalized.display]
    if (validator) {
      const renderErrors = validator(normalized)
      console.log("[DEMO] Render validation:", renderErrors.length === 0 ? "PASS" : renderErrors)
      expect(renderErrors).toEqual([])
    }

    console.log("[DEMO] Final card:", JSON.stringify(normalized).substring(0, 500))
  })

  it("Deal status: Rex Corp → pipeline or checklist", { timeout: 120000 }, async () => {
    // Build prompt exactly as ProcessingHelper.TOOL_PROMPTS.deal_status does in DEMO_MODE
    const clientName = "Rex Corp"
    const examplePool = DEAL_EXAMPLES
    const example = examplePool[Math.floor(Math.random() * examplePool.length)]
    const prompt = `${DEMO_SYSTEM}\n\n${DEMO_CONTEXT}\n\nExample:\n${example}\n\nInput: Deal status for ${clientName}\nOutput:\nDISPLAY:`

    console.log("[DEMO] Sending deal status query: Rex Corp")
    const rawText = prefixDisplay(await callKimi(prompt))
    console.log("[DEMO] Raw response (first 500 chars):", rawText.substring(0, 500))

    const { parseResult, normalized } = runPipeline(rawText, "deal_status")

    console.log("[DEMO] Parse valid:", parseResult.valid, "| errors:", parseResult.errors)
    console.log("[DEMO] Display type:", normalized?.display)

    expect(parseResult.valid).toBe(true)
    expect(normalized).not.toBeNull()
    expect(["pipeline", "checklist"]).toContain(normalized.display)

    // Validate renderer fields
    const validator = RENDER_VALIDATORS[normalized.display]
    if (validator) {
      const renderErrors = validator(normalized)
      console.log("[DEMO] Render validation:", renderErrors.length === 0 ? "PASS" : renderErrors)
      expect(renderErrors).toEqual([])
    }

    console.log("[DEMO] Final card:", JSON.stringify(normalized).substring(0, 500))
  })

  it("Person: Rex Heng → profile card", { timeout: 120000 }, async () => {
    // Build prompt exactly as ProcessingHelper.TOOL_PROMPTS.intel does in DEMO_MODE
    const query = "Rex Heng"
    const example = pickIntelExample(query, INTEL_EXAMPLES)
    const prompt = `${DEMO_SYSTEM}\n\n${DEMO_CONTEXT}\n\nExample:\n${example}\n\nInput: ${query}\nOutput:\nDISPLAY:`

    console.log("[DEMO] Sending person query: Rex Heng")
    const rawText = prefixDisplay(await callKimi(prompt))
    console.log("[DEMO] Raw response (first 500 chars):", rawText.substring(0, 500))

    const { parseResult, normalized } = runPipeline(rawText, "intel")

    console.log("[DEMO] Parse valid:", parseResult.valid, "| errors:", parseResult.errors)
    console.log("[DEMO] Display type:", normalized?.display)

    expect(parseResult.valid).toBe(true)
    expect(normalized).not.toBeNull()
    expect(normalized.display).toBe("profile")

    // Profile-specific checks: should contain Rex Heng data from DEMO_CONTEXT
    expect(normalized.name.toLowerCase()).toContain("rex")
    expect(normalized.details.length).toBeGreaterThan(0)

    // Validate renderer fields
    const validator = RENDER_VALIDATORS[normalized.display]
    if (validator) {
      const renderErrors = validator(normalized)
      console.log("[DEMO] Render validation:", renderErrors.length === 0 ? "PASS" : renderErrors)
      expect(renderErrors).toEqual([])
    }

    console.log("[DEMO] Final card:", JSON.stringify(normalized).substring(0, 500))
  })
})
