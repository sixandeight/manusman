/**
 * Query classifier — picks the best few-shot example for a Manus tool query.
 *
 * Instead of random example selection (pick()), this matches the query
 * to the most relevant example based on query patterns.
 */

type QueryType = "person" | "company" | "comparison" | "stat" | "prep" | "market" | "general"

/**
 * Classify a query into a type based on patterns.
 * Used to pick the most relevant few-shot example.
 */
export function classifyQuery(query: string): QueryType {
  const q = query.trim().toLowerCase()

  // Comparison — "X vs Y", "X versus Y", "compare X and Y"
  if (/\bvs\.?\b|\bversus\b|\bcompare\b|\bcompared to\b/i.test(q)) {
    return "comparison"
  }

  // Prep — "prep for", "prepare for", "meeting with", "call with"
  if (/\bprep\b|\bprepare\b|\bmeeting\b|\bcall with\b|\bbriefing\b/i.test(q)) {
    return "prep"
  }

  // Market — broad market/industry questions (check BEFORE stat since "market share" is market, not stat)
  if (/\bmarket share\b|\bmarket landscape\b|\bindustry\b|\bsector\b|\blandscape\b/i.test(q)) {
    return "market"
  }

  // Stat/metric — queries asking for numbers, revenue, ARR, market cap, etc.
  if (/\b(arr|revenue|market cap|valuation|funding|raised|profit|growth|share price|stock|earnings)\b/i.test(q)) {
    return "stat"
  }

  // Person — starts with a capitalized name (2+ words, no company suffixes)
  // Heuristic: if the query is 2-3 capitalized words and no company indicators
  const words = query.trim().split(/\s+/)
  if (words.length >= 2 && words.length <= 4) {
    const allCapitalized = words.every(w => /^[A-Z]/.test(w))
    const hasCompanySuffix = /\b(inc|corp|ltd|llc|co|group|holdings|technologies|labs?)\b/i.test(q)
    if (allCapitalized && !hasCompanySuffix) {
      // Could be person or company — check for common person name patterns
      // If ≤3 words and no company indicators, lean toward person
      if (words.length <= 3) return "person"
    }
  }

  // Company — single capitalized word or known company patterns
  if (words.length <= 2 && /^[A-Z]/.test(query.trim())) {
    return "company"
  }

  return "general"
}

/**
 * Pick the best example index for a given query type.
 * Returns the index into the examples array, or -1 for random.
 */
export function pickBestExample(queryType: QueryType, exampleCount: number): number {
  // Intel examples are ordered: [chart, profile, profile, comparison, checklist, stat_card, donut]
  // These mappings correspond to the EXAMPLES.intel array in ProcessingHelper
  const INTEL_TYPE_MAP: Record<QueryType, number[]> = {
    company: [0, 1],     // chart or profile
    person: [2],         // person profile
    comparison: [3],     // comparison
    prep: [4],           // checklist
    stat: [5],           // stat_card
    market: [6],         // donut
    general: [-1],       // random fallback
  }

  const candidates = INTEL_TYPE_MAP[queryType] || [-1]
  const valid = candidates.filter(i => i >= 0 && i < exampleCount)
  if (valid.length === 0) return Math.floor(Math.random() * exampleCount)
  return valid[Math.floor(Math.random() * valid.length)]
}

/**
 * Pick the best example string for an intel query.
 * Drop-in replacement for pick(EXAMPLES.intel).
 */
export function pickIntelExample(query: string, examples: string[]): string {
  if (examples.length === 0) return ""
  const queryType = classifyQuery(query)
  const idx = pickBestExample(queryType, examples.length)
  return examples[idx]
}
