/**
 * Line-format parser.
 *
 * Converts a simple labeled-line format into display JSON.
 * This is the "human syntax" alternative to asking Manus for raw JSON.
 *
 * Format rules:
 *   KEY: value            → single field
 *   KEY: a | b | c        → pipe-separated columns (for metrics, stages, etc.)
 *   Repeated KEY lines    → collected into an array
 *   Blank lines           → ignored
 *   Lines without ":"     → ignored
 *
 * Example input:
 *   DISPLAY: comparison
 *   US: Stripe
 *   THEM: Adyen
 *   METRIC: Developer Experience | 9 | 6
 *   METRIC: Enterprise Features | 7 | 9
 *   VERDICT: Stripe wins on DX
 *
 * Output: { display: "comparison", us_name: "Stripe", them_name: "Adyen", metrics: [...], verdict: "..." }
 */

// ── Line parser ────────────────────────────────────────────

interface ParsedLines {
  /** Single-value fields: KEY → last value seen */
  fields: Record<string, string>
  /** Repeated fields: KEY → array of values */
  lists: Record<string, string[]>
}

function parseLines(text: string): ParsedLines {
  const fields: Record<string, string> = {}
  const lists: Record<string, string[]> = {}
  const seenKeys = new Set<string>()

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    // Find first colon (but not inside a URL like https://)
    const match = line.match(/^([A-Z_]+)\s*:\s*(.+)$/i)
    if (!match) continue

    const key = match[1].toUpperCase().trim()
    const value = match[2].trim()

    if (seenKeys.has(key)) {
      // Repeated key → push to list
      if (!lists[key]) lists[key] = [fields[key]] // promote first occurrence
      lists[key].push(value)
    } else {
      fields[key] = value
      seenKeys.add(key)
    }
  }

  return { fields, lists }
}

// ── Display type converters ────────────────────────────────

function toNum(s: string): number {
  const n = Number(s.trim())
  return isFinite(n) ? n : 0
}

function buildStatCard(f: Record<string, string>): any {
  return {
    display: "stat_card",
    value: f.VALUE || "—",
    label: f.LABEL || "Unknown",
    sentiment: f.SENTIMENT || "neutral",
    trend: f.TREND ? f.TREND.split(/[,|]/).map(s => toNum(s)) : [],
    context: f.CONTEXT || "",
    source: f.SOURCE || "",
  }
}

function buildComparison(f: Record<string, string>, l: Record<string, string[]>): any {
  const metricLines = l.METRIC || []
  return {
    display: "comparison",
    us_name: f.US || f.US_NAME || "Us",
    them_name: f.THEM || f.THEM_NAME || "Them",
    metrics: metricLines.map(line => {
      const parts = line.split('|').map(s => s.trim())
      return {
        label: parts[0] || "Metric",
        us_score: toNum(parts[1] || "5"),
        them_score: toNum(parts[2] || "5"),
      }
    }),
    verdict: f.VERDICT || "",
  }
}

function buildProfile(f: Record<string, string>, l: Record<string, string[]>): any {
  return {
    display: "profile",
    name: f.NAME || "Unknown",
    role: f.ROLE || "",
    company: f.COMPANY || "",
    details: l.DETAIL || l.DETAILS || [],
    sentiment: f.SENTIMENT || "neutral",
    summary: f.SUMMARY || "",
  }
}

function buildVerdict(f: Record<string, string>): any {
  return {
    display: "verdict",
    claim: f.CLAIM || "",
    verdict: (f.VERDICT || "unverifiable").toLowerCase(),
    confidence: (f.CONFIDENCE || "medium").toLowerCase(),
    evidence: f.EVIDENCE || "",
    source: f.SOURCE || "",
  }
}

function getList(f: Record<string, string>, l: Record<string, string[]>, ...keys: string[]): string[] {
  for (const k of keys) {
    if (l[k] && l[k].length > 0) return l[k]
    if (f[k]) return [f[k]] // single occurrence — promote to list
  }
  return []
}

function buildChecklist(f: Record<string, string>, l: Record<string, string[]>): any {
  const contextLines = getList(f, l, "CONTEXT", "FACT", "KEY")
  const itemLines = getList(f, l, "ITEM", "TODO", "ACTION")

  return {
    display: "checklist",
    title: f.TITLE || "Checklist",
    subtitle: f.SUBTITLE || "",
    context: contextLines.map(text => {
      // "High priority fact" or "fact | high"
      const parts = text.split('|').map(s => s.trim())
      return {
        text: parts[0],
        priority: (parts[1] || "medium").toLowerCase(),
      }
    }),
    items: itemLines.map(text => ({
      text: text.replace(/^\[[ x]?\]\s*/, ''), // strip checkbox syntax
      checked: text.startsWith('[x]'),
    })),
  }
}

function buildPipeline(f: Record<string, string>): any {
  const stages = (f.STAGES || "").split('|').map(s => s.trim()).filter(Boolean)
  return {
    display: "pipeline",
    client: f.CLIENT || "Unknown",
    stages,
    current_stage: toNum(f.CURRENT || f.CURRENT_STAGE || "0"),
    deal_value: f.VALUE || f.DEAL_VALUE || "",
    risk: (f.RISK || "medium").toLowerCase(),
    next_action: f.NEXT || f.NEXT_ACTION || "",
    next_action_due: f.DUE || f.NEXT_DUE || "",
    blockers: f.BLOCKER ? [f.BLOCKER] : [],
  }
}

function buildChart(f: Record<string, string>, l: Record<string, string[]>): any {
  const chartType = (f.CHART_TYPE || f.TYPE || "bar").toLowerCase()
  const labels = (f.LABELS || "").split('|').map(s => s.trim()).filter(Boolean)
  const values = (f.VALUES || "").split('|').map(s => toNum(s))

  // For donut: might have separate SEGMENT lines
  const segments = l.SEGMENT || l.SLICE || []
  if (segments.length > 0) {
    const segLabels: string[] = []
    const segValues: number[] = []
    const segColors: string[] = []
    for (const seg of segments) {
      const parts = seg.split('|').map(s => s.trim())
      segLabels.push(parts[0] || "")
      segValues.push(toNum(parts[1] || "0"))
      if (parts[2]) segColors.push(parts[2])
    }
    return {
      display: "chart",
      chart_type: "donut",
      title: f.TITLE || "",
      datasets: [{
        name: f.NAME || "Share",
        values: segValues,
        labels: segLabels,
        colors: segColors.length > 0 ? segColors : undefined,
      }],
      labels: segLabels,
      summary: f.SUMMARY || "",
    }
  }

  return {
    display: "chart",
    chart_type: chartType,
    title: f.TITLE || "",
    datasets: [{
      name: f.NAME || f.DATASET || "Data",
      values,
      color: f.COLOR || "blue",
    }],
    labels,
    summary: f.SUMMARY || "",
  }
}

function buildSlides(_f: Record<string, string>, l: Record<string, string[]>): any {
  // SLIDE lines contain "heading | bullet | bullet | bullet"
  const slideLines = l.SLIDE || []
  const slides = slideLines.map(line => {
    const parts = line.split('|').map(s => s.trim())
    return {
      heading: parts[0] || "Slide",
      bullets: parts.slice(1),
    }
  })

  return {
    display: "slides",
    title: _f.TITLE || "",
    slides,
  }
}

// ── Dispatch ───────────────────────────────────────────────

const BUILDERS: Record<string, (f: Record<string, string>, l: Record<string, string[]>) => any> = {
  stat_card: (f) => buildStatCard(f),
  stat: (f) => buildStatCard(f),
  comparison: buildComparison,
  compare: buildComparison,
  profile: (f, l) => buildProfile(f, l),
  verdict: (f) => buildVerdict(f),
  fact_check: (f) => buildVerdict(f),
  checklist: buildChecklist,
  pipeline: (f) => buildPipeline(f),
  deal: (f) => buildPipeline(f),
  chart: buildChart,
  bar: buildChart,
  donut: buildChart,
  slides: buildSlides,
  prep: buildSlides,
}

// ── Public API ─────────────────────────────────────────────

/**
 * Try to parse text as our simple line format.
 * Returns display JSON if successful, null if the text isn't in line format.
 */
export function parseLineFormat(text: string): any | null {
  if (!text || !text.trim()) return null

  const { fields, lists } = parseLines(text)

  // Must have a DISPLAY field to be line format
  const display = (fields.DISPLAY || fields.TYPE || "").toLowerCase().trim()
  if (!display) return null

  const builder = BUILDERS[display]
  if (!builder) return null

  return builder(fields, lists)
}

// Re-export for testing
export { parseLines }
