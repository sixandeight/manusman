/**
 * Normalize card data for safe rendering.
 *
 * Sits between parseManusJSON and PresetRenderer.
 * Ensures all fields are the correct type and safe to render
 * without null checks, NaN, or type coercion surprises.
 */

// ── Helpers ────────────────────────────────────────────────

/** Coerce to number, fallback to 0 */
function num(v: any, fallback = 0): number {
  const n = Number(v)
  return isFinite(n) ? n : fallback
}

/** Coerce to string */
function str(v: any, fallback = ""): string {
  if (v === null || v === undefined) return fallback
  return String(v)
}

/** Coerce to array — mapFn receives only the item, NOT the index */
function arr<T>(v: any, mapFn?: (item: any) => T): T[] {
  if (!Array.isArray(v)) return []
  return mapFn ? v.map((item) => mapFn(item)) : v
}

/** Clamp a number between min and max */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

// ── Normalizers per display type ───────────────────────────

function normalizeStatCard(d: any): any {
  return {
    display: "stat_card",
    value: str(d.value, "—"),
    label: str(d.label, "Unknown"),
    sentiment: ["positive", "negative", "neutral"].includes(d.sentiment) ? d.sentiment : "neutral",
    trend: arr(d.trend, num).filter((n: number) => isFinite(n)),
    context: str(d.context),
    source: str(d.source),
  }
}

function normalizeComparison(d: any): any {
  return {
    display: "comparison",
    us_name: str(d.us_name, "Us"),
    them_name: str(d.them_name, "Them"),
    metrics: arr(d.metrics, (m: any) => ({
      label: str(m.label, "Metric"),
      us_score: clamp(num(m.us_score), 0, 10),
      them_score: clamp(num(m.them_score), 0, 10),
    })).slice(0, 6),
    verdict: str(d.verdict),
  }
}

function normalizeProfile(d: any): any {
  return {
    display: "profile",
    name: str(d.name, "Unknown"),
    role: str(d.role),
    company: str(d.company),
    details: arr(d.details, str).slice(0, 5),
    sentiment: ["positive", "negative", "neutral"].includes(d.sentiment) ? d.sentiment : "neutral",
    summary: str(d.summary),
    deal_stage: d.deal_stage ? str(d.deal_stage) : undefined,
  }
}

function normalizeVerdict(d: any): any {
  const verdictMap: Record<string, string> = {
    true: "true", false: "false", partially_true: "partially_true",
    partial: "partially_true", unverifiable: "unverifiable",
  }
  return {
    display: "verdict",
    claim: str(d.claim, "Unknown claim"),
    verdict: verdictMap[str(d.verdict).toLowerCase()] || "unverifiable",
    confidence: ["high", "medium", "low"].includes(d.confidence) ? d.confidence : "medium",
    evidence: str(d.evidence),
    source: str(d.source),
  }
}

function normalizeChecklist(d: any): any {
  const prioritySet = new Set(["high", "medium", "low"])
  return {
    display: "checklist",
    title: str(d.title, "Checklist"),
    subtitle: str(d.subtitle),
    context: arr(d.context, (c: any) => ({
      text: str(c.text || c),
      priority: prioritySet.has(c.priority) ? c.priority : "medium",
    })).slice(0, 5),
    items: arr(d.items, (item: any) => ({
      text: str(item.text || item),
      checked: Boolean(item.checked),
    })).slice(0, 5),
  }
}

function normalizePipeline(d: any): any {
  const stages = arr(d.stages, str)
  const current = clamp(num(d.current_stage), 0, Math.max(0, stages.length - 1))
  return {
    display: "pipeline",
    client: str(d.client, "Unknown"),
    stages,
    current_stage: current,
    deal_value: str(d.deal_value),
    risk: ["low", "medium", "high"].includes(d.risk) ? d.risk : "medium",
    next_action: str(d.next_action),
    next_action_due: str(d.next_action_due),
    blockers: arr(d.blockers, str).slice(0, 3),
  }
}

function normalizeChart(d: any): any {
  const chartType = d.chart_type === "donut" ? "donut" : "bar"
  const datasets = arr(d.datasets, (ds: any) => ({
    name: str(ds.name),
    values: arr(ds.values, num),
    color: str(ds.color, "blue"),
    colors: arr(ds.colors, str),
    labels: arr(ds.labels, str),
  })).slice(0, 3) // max 3 datasets

  return {
    display: "chart",
    chart_type: chartType,
    title: str(d.title),
    datasets,
    labels: arr(d.labels, str),
    summary: str(d.summary),
  }
}

function normalizeSlides(d: any): any {
  return {
    display: "slides",
    title: str(d.title),
    slides: arr(d.slides, (s: any) => ({
      heading: str(s.heading, "Slide"),
      bullets: arr(s.bullets, str).slice(0, 6),
    })).slice(0, 8), // max 8 slides
  }
}

// ── Public API ─────────────────────────────────────────────

const NORMALIZERS: Record<string, (d: any) => any> = {
  stat_card: normalizeStatCard,
  comparison: normalizeComparison,
  profile: normalizeProfile,
  verdict: normalizeVerdict,
  checklist: normalizeChecklist,
  pipeline: normalizePipeline,
  chart: normalizeChart,
  slides: normalizeSlides,
}

/**
 * Normalize parsed card data for safe rendering.
 * Call this AFTER parseManusResponse, BEFORE PresetRenderer.
 *
 * Guarantees:
 * - All fields exist and are the correct type
 * - Numbers are finite (no NaN, Infinity)
 * - Arrays are actual arrays (never null/undefined)
 * - Strings are actual strings (never null/undefined)
 * - Scores are clamped to valid ranges
 * - Arrays are capped to reasonable lengths
 */
export function normalizeCardData(data: any): any {
  if (!data || typeof data !== "object" || !data.display) return data

  const normalizer = NORMALIZERS[data.display]
  if (!normalizer) return data // unknown display type, pass through

  return normalizer(data)
}

// Re-export helpers for testing
export { num, str, arr, clamp }
