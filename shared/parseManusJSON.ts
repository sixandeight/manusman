/**
 * Centralized Manus response parser.
 *
 * Single source of truth for extracting structured card data from Manus API
 * responses. Used by ManusHelper (main process) and importable by renderer
 * via preload if needed.
 *
 * Pipeline: raw text → try JSON → try line format → try prose fallback → result
 */

import { parseLineFormat } from "./parseLineFormat"

// ── Display schemas ────────────────────────────────────────
// Required fields per display type. If missing, we fill defaults.

const DISPLAY_SCHEMAS: Record<string, { required: string[]; defaults: Record<string, any> }> = {
  stat_card: {
    required: ["value", "label"],
    defaults: { value: "—", label: "Unknown", sentiment: "neutral", trend: [] },
  },
  comparison: {
    required: ["metrics"],
    defaults: { us_name: "Us", them_name: "Them", metrics: [], verdict: "" },
  },
  profile: {
    required: ["name"],
    defaults: { name: "Unknown", role: "", company: "", details: [], sentiment: "neutral", summary: "" },
  },
  verdict: {
    required: ["verdict"],
    defaults: { claim: "", verdict: "unverifiable", confidence: "low", evidence: "", source: "" },
  },
  checklist: {
    required: ["title"],
    defaults: { title: "Checklist", context: [], items: [] },
  },
  pipeline: {
    required: ["stages"],
    defaults: { client: "Unknown", stages: [], current_stage: 0, deal_value: "", risk: "medium" },
  },
  chart: {
    required: ["datasets"],
    defaults: { chart_type: "bar", title: "", datasets: [], labels: [] },
  },
  slides: {
    required: ["slides"],
    defaults: { title: "", slides: [] },
  },
}

const VALID_DISPLAY_TYPES = new Set(Object.keys(DISPLAY_SCHEMAS))

// ── JSON repair ────────────────────────────────────────────

/**
 * Fix common LLM JSON errors before parsing.
 * Each repair is targeted — we don't try to be a full JSON5 parser.
 */
export function repairJSON(text: string): string {
  let s = text

  // Strip code fences
  s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```$/, "").trim()

  // Fix "key">value → "key":value  (Manus typo)
  s = s.replace(/"(\w+)">([\d.]+)/g, '"$1":$2')

  // Fix single quotes → double quotes (only around keys/string values)
  // Careful: don't break apostrophes inside strings
  s = s.replace(/'/g, '"')

  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([\]}])/g, '$1')

  // Fix unquoted keys: { key: "val" } → { "key": "val" }
  s = s.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')

  // Fix NaN, undefined, Infinity → null (after colons AND inside arrays)
  s = s.replace(/:\s*(NaN|undefined|Infinity|-Infinity)\b/g, ': null')
  s = s.replace(/(?<=[\[,])\s*(NaN|undefined|Infinity|-Infinity)\b/g, ' null')

  // Fix missing comma between key-value pairs: }"key" → },"key"
  s = s.replace(/}(\s*)"(\w)/g, '},$1"$2')

  return s
}

// ── JSON extraction strategies ─────────────────────────────

/**
 * Try to extract a JSON object from text using multiple strategies.
 * Returns the parsed object or null.
 */
function extractJSON(text: string): any | null {
  // Strategy 0: try raw parse first — avoids repairJSON breaking valid JSON
  // (e.g. apostrophes in values get turned into double quotes by repair)
  try {
    const raw = JSON.parse(text.trim())
    if (raw && typeof raw === "object") return raw
  } catch {}

  const cleaned = repairJSON(text)

  // Strategy 1: parse after repair (fixes single-quoted keys, trailing commas, etc.)
  try {
    const parsed = JSON.parse(cleaned)
    if (parsed && typeof parsed === "object") return parsed
  } catch {}

  // Strategy 2: extract ```json ... ``` block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1].trim()
    // Try raw parse first (avoids repairJSON breaking apostrophes)
    try { return JSON.parse(inner) } catch {}
    try {
      const repaired = repairJSON(inner)
      return JSON.parse(repaired)
    } catch {}
  }

  // Strategy 3: find first balanced { } containing "display"
  const displayIdx = text.indexOf('"display"')
  if (displayIdx >= 0) {
    const braceIdx = text.lastIndexOf('{', displayIdx)
    if (braceIdx >= 0) {
      let depth = 0
      for (let i = braceIdx; i < text.length; i++) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') {
          depth--
          if (depth === 0) {
            const slice = text.substring(braceIdx, i + 1)
            // Try raw parse first
            try { return JSON.parse(slice) } catch {}
            try {
              const repaired = repairJSON(slice)
              return JSON.parse(repaired)
            } catch { break }
          }
        }
      }
    }
  }

  // Strategy 4: find ANY balanced { } (Manus sometimes omits "display" key name)
  const firstBrace = text.indexOf('{')
  if (firstBrace >= 0 && firstBrace !== (text.indexOf('"display"') >= 0 ? text.lastIndexOf('{', text.indexOf('"display"')) : -1)) {
    let depth = 0
    for (let i = firstBrace; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') {
        depth--
        if (depth === 0) {
          const slice = text.substring(firstBrace, i + 1)
          // Try raw parse first
          try {
            const parsed = JSON.parse(slice)
            if (parsed && typeof parsed === "object") return parsed
          } catch {}
          try {
            const repaired = repairJSON(slice)
            const parsed = JSON.parse(repaired)
            if (parsed && typeof parsed === "object") return parsed
          } catch { break }
        }
      }
    }
  }

  return null
}

// ── Validation ─────────────────────────────────────────────

/**
 * Validate parsed JSON against display schema.
 * Fills in missing required fields with safe defaults.
 * Returns validated object with `_valid: true/false` flag.
 */
function validateDisplayData(data: any): any {
  if (!data || typeof data !== "object") return null

  // Normalize display field
  const display = data.display?.toLowerCase?.()?.trim?.()
  if (!display || !VALID_DISPLAY_TYPES.has(display)) {
    // Try to infer display type from fields present
    const inferred = inferDisplayType(data)
    if (inferred) {
      data.display = inferred
    } else {
      return { ...data, _valid: false }
    }
  } else {
    data.display = display
  }

  const schema = DISPLAY_SCHEMAS[data.display]
  if (!schema) return { ...data, _valid: false }

  // Check required fields BEFORE filling defaults
  // (defaults are for optional fields — required ones must come from Manus)
  const hasRequired = schema.required.every(field => {
    const val = data[field]
    if (Array.isArray(val)) return val.length > 0
    return val !== undefined && val !== null && val !== ""
  })

  // Fill missing optional fields with defaults
  for (const [key, defaultVal] of Object.entries(schema.defaults)) {
    if (data[key] === undefined || data[key] === null) {
      data[key] = defaultVal
    }
  }

  return { ...data, _valid: hasRequired }
}

/**
 * Infer display type from the fields present in the data.
 */
function inferDisplayType(data: any): string | null {
  if (data.verdict !== undefined && data.claim !== undefined) return "verdict"
  if (data.stages !== undefined) return "pipeline"
  if (data.slides !== undefined) return "slides"
  if (data.datasets !== undefined || data.chart_type !== undefined) return "chart"
  if (data.us_name !== undefined || data.them_name !== undefined) return "comparison"
  if (data.items !== undefined && data.title !== undefined) return "checklist"
  if (data.name !== undefined && (data.role !== undefined || data.company !== undefined)) return "profile"
  if (data.value !== undefined && data.label !== undefined) return "stat_card"
  return null
}

// ── Fallback: extract structure from prose ──────────────────

/**
 * When JSON extraction fails completely, try to pull key-value pairs
 * from prose text and build a fallback card.
 */
function buildFallbackCard(text: string, toolName?: string): any {
  // Extract lines that look like "Key: Value" or "- Item"
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const fields: Array<{ label: string; value: string }> = []
  const bullets: string[] = []

  for (const line of lines.slice(0, 10)) {
    const kvMatch = line.match(/^([A-Z][\w\s]{1,30}):\s*(.+)$/i)
    if (kvMatch) {
      fields.push({ label: kvMatch[1].trim(), value: kvMatch[2].trim() })
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      bullets.push(line.slice(2).trim())
    }
  }

  if (fields.length === 0 && bullets.length === 0) {
    return null
  }

  // Build a checklist-style fallback
  return {
    display: "checklist",
    title: toolName ? `${toolName.toUpperCase()} Result` : "Result",
    context: fields.slice(0, 5).map(f => ({ text: `${f.label}: ${f.value}`, priority: "medium" })),
    items: bullets.slice(0, 5).map(b => ({ text: b, checked: false })),
    _valid: true,
    _fallback: true,
  }
}

// ── Public API ─────────────────────────────────────────────

export interface ParseResult {
  /** Parsed and validated card data, or null if extraction failed entirely */
  data: any | null
  /** Whether the data passed schema validation */
  valid: boolean
  /** Whether we used a fallback strategy */
  fallback: boolean
  /** Raw text that was parsed */
  rawText: string
  /** Parse errors encountered */
  errors: string[]
}

/**
 * Parse a Manus API response text into validated card data.
 *
 * This is the ONLY function the rest of the codebase should call
 * for Manus JSON extraction.
 */
export function parseManusResponse(text: string, toolName?: string): ParseResult {
  const errors: string[] = []

  if (typeof text !== "string") {
    const coerced = text == null ? "" : String(text)
    return { data: null, valid: false, fallback: false, rawText: coerced, errors: ["Non-string input"] }
  }

  if (!text.trim()) {
    return { data: null, valid: false, fallback: false, rawText: text, errors: ["Empty response"] }
  }

  // PRIMARY PATH: line format. This is what the prompt asks for.
  const lineResult = parseLineFormat(text)
  if (lineResult) {
    return { data: { ...lineResult, _valid: true }, valid: true, fallback: false, rawText: text, errors: [] }
  }

  // JSON compat: if Manus ignored the prompt and returned JSON anyway, handle it
  const extracted = extractJSON(text)
  if (extracted) {
    const validated = validateDisplayData(extracted)
    if (validated?._valid) {
      return { data: validated, valid: true, fallback: false, rawText: text, errors }
    }
    errors.push(`JSON extracted but missing required fields for display="${validated?.display}"`)
    return { data: validated, valid: false, fallback: false, rawText: text, errors }
  }

  // Last resort: try to extract structure from prose
  errors.push("Response was neither line format nor JSON")
  const fallback = buildFallbackCard(text, toolName)
  if (fallback) {
    return { data: fallback, valid: true, fallback: true, rawText: text, errors }
  }

  return { data: null, valid: false, fallback: false, rawText: text, errors: [...errors, "Could not parse response"] }
}

// Re-export for testing
export { extractJSON, validateDisplayData, inferDisplayType, buildFallbackCard }
