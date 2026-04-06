import { describe, it, expect } from "vitest"
import {
  parseManusResponse,
  repairJSON,
  extractJSON,
  validateDisplayData,
  inferDisplayType,
  buildFallbackCard,
} from "./parseManusJSON"

// ── repairJSON ─────────────────────────────────────────────

describe("repairJSON", () => {
  it("strips code fences", () => {
    const input = '```json\n{"display":"stat_card","value":"$5B"}\n```'
    expect(JSON.parse(repairJSON(input))).toEqual({ display: "stat_card", value: "$5B" })
  })

  it("fixes Manus >-instead-of-: typo", () => {
    const input = '{"score">6, "name":"test"}'
    const result = repairJSON(input)
    expect(result).toContain('"score":6')
  })

  it("removes trailing commas", () => {
    const input = '{"a":1, "b":2, }'
    expect(JSON.parse(repairJSON(input))).toEqual({ a: 1, b: 2 })
  })

  it("removes trailing comma before ]", () => {
    const input = '{"arr":[1, 2, 3, ]}'
    expect(JSON.parse(repairJSON(input))).toEqual({ arr: [1, 2, 3] })
  })

  it("fixes unquoted keys", () => {
    const input = '{display: "stat_card", value: "$5B"}'
    expect(JSON.parse(repairJSON(input))).toEqual({ display: "stat_card", value: "$5B" })
  })

  it("fixes NaN and undefined to null", () => {
    const input = '{"value": NaN, "score": undefined}'
    const parsed = JSON.parse(repairJSON(input))
    expect(parsed.value).toBeNull()
    expect(parsed.score).toBeNull()
  })

  it("handles already-valid JSON", () => {
    const input = '{"display":"profile","name":"Test"}'
    expect(JSON.parse(repairJSON(input))).toEqual({ display: "profile", name: "Test" })
  })
})

// ── extractJSON ────────────────────────────────────────────

describe("extractJSON", () => {
  it("parses clean JSON directly", () => {
    const input = '{"display":"stat_card","value":"$3.4T","label":"Apple Market Cap"}'
    const result = extractJSON(input)
    expect(result.display).toBe("stat_card")
    expect(result.value).toBe("$3.4T")
  })

  it("extracts JSON from code block", () => {
    const input = 'Here is the result:\n```json\n{"display":"verdict","verdict":"true","claim":"Test"}\n```\nHope this helps!'
    const result = extractJSON(input)
    expect(result.display).toBe("verdict")
    expect(result.verdict).toBe("true")
  })

  it("extracts JSON from prose with balanced braces", () => {
    const input = 'Based on my research, here is the data: {"display":"profile","name":"Jensen Huang","role":"CEO","company":"NVIDIA","details":["Founded 1993"],"sentiment":"positive"} Let me know if you need more.'
    const result = extractJSON(input)
    expect(result.display).toBe("profile")
    expect(result.name).toBe("Jensen Huang")
  })

  it("handles nested objects", () => {
    const input = '{"display":"chart","datasets":[{"name":"Revenue","values":[10,20,30]}],"labels":["2022","2023","2024"]}'
    const result = extractJSON(input)
    expect(result.datasets[0].values).toEqual([10, 20, 30])
  })

  it("returns null for non-JSON text", () => {
    expect(extractJSON("This is just a plain text response with no JSON")).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(extractJSON("")).toBeNull()
  })

  it("handles JSON with Manus typos", () => {
    const input = '{"display":"comparison","metrics":[{"label":"Price","us_score">8,"them_score">6}]}'
    const result = extractJSON(input)
    expect(result).not.toBeNull()
    expect(result.metrics[0].us_score).toBe(8)
  })

  it("handles JSON with trailing commas", () => {
    const input = '{"display":"stat_card","value":"$5B","label":"Revenue","trend":[1,2,3,],}'
    const result = extractJSON(input)
    expect(result.display).toBe("stat_card")
    expect(result.trend).toEqual([1, 2, 3])
  })

  it("extracts from multi-paragraph Manus response", () => {
    const input = `I've researched the topic for you.

Here are my findings about Stripe:

{"display":"chart","chart_type":"bar","title":"Stripe Valuation ($B)","datasets":[{"name":"Valuation","values":[20,36,95,50,91.5],"color":"purple"}],"labels":["2019","2020","2021","2022","2024"],"summary":"$91.5B valuation"}

I hope this information is useful for your call.`
    const result = extractJSON(input)
    expect(result.display).toBe("chart")
    expect(result.title).toBe("Stripe Valuation ($B)")
  })
})

// ── validateDisplayData ────────────────────────────────────

describe("validateDisplayData", () => {
  it("validates a complete stat_card", () => {
    const data = { display: "stat_card", value: "$3.4T", label: "Market Cap", sentiment: "positive", trend: [1, 2, 3] }
    const result = validateDisplayData(data)
    expect(result._valid).toBe(true)
    expect(result.display).toBe("stat_card")
  })

  it("fills defaults for missing optional fields", () => {
    const data = { display: "stat_card", value: "$3.4T", label: "Market Cap" }
    const result = validateDisplayData(data)
    expect(result._valid).toBe(true)
    expect(result.sentiment).toBe("neutral")
    expect(result.trend).toEqual([])
  })

  it("marks as invalid when required fields are missing", () => {
    const data = { display: "stat_card" } // missing value and label
    const result = validateDisplayData(data)
    expect(result._valid).toBe(false)
  })

  it("normalizes display type casing", () => {
    const data = { display: "STAT_CARD", value: "100", label: "Test" }
    const result = validateDisplayData(data)
    expect(result.display).toBe("stat_card")
    expect(result._valid).toBe(true)
  })

  it("validates verdict with all fields", () => {
    const data = { display: "verdict", claim: "X is true", verdict: "true", confidence: "high", evidence: "Source says so" }
    const result = validateDisplayData(data)
    expect(result._valid).toBe(true)
  })

  it("validates pipeline", () => {
    const data = { display: "pipeline", client: "Acme", stages: ["Lead", "Qualified", "Closed"], current_stage: 1 }
    const result = validateDisplayData(data)
    expect(result._valid).toBe(true)
    expect(result.risk).toBe("medium") // default
  })

  it("validates chart with datasets", () => {
    const data = { display: "chart", chart_type: "donut", datasets: [{ name: "Share", values: [31, 24] }] }
    const result = validateDisplayData(data)
    expect(result._valid).toBe(true)
  })

  it("validates slides", () => {
    const data = { display: "slides", title: "Meeting Prep", slides: [{ heading: "Overview", bullets: ["Point 1"] }] }
    const result = validateDisplayData(data)
    expect(result._valid).toBe(true)
  })

  it("returns null for non-object input", () => {
    expect(validateDisplayData(null)).toBeNull()
    expect(validateDisplayData("string")).toBeNull()
    expect(validateDisplayData(42)).toBeNull()
  })
})

// ── inferDisplayType ───────────────────────────────────────

describe("inferDisplayType", () => {
  it("infers verdict from claim + verdict fields", () => {
    expect(inferDisplayType({ claim: "x", verdict: "true" })).toBe("verdict")
  })

  it("infers pipeline from stages field", () => {
    expect(inferDisplayType({ stages: ["A", "B"] })).toBe("pipeline")
  })

  it("infers chart from datasets field", () => {
    expect(inferDisplayType({ datasets: [{ values: [1] }] })).toBe("chart")
  })

  it("infers chart from chart_type field", () => {
    expect(inferDisplayType({ chart_type: "bar" })).toBe("chart")
  })

  it("infers comparison from us_name field", () => {
    expect(inferDisplayType({ us_name: "Us", them_name: "Them" })).toBe("comparison")
  })

  it("infers checklist from title + items", () => {
    expect(inferDisplayType({ title: "Tasks", items: [] })).toBe("checklist")
  })

  it("infers profile from name + role", () => {
    expect(inferDisplayType({ name: "John", role: "CEO" })).toBe("profile")
  })

  it("infers stat_card from value + label", () => {
    expect(inferDisplayType({ value: "$5B", label: "Revenue" })).toBe("stat_card")
  })

  it("returns null for ambiguous data", () => {
    expect(inferDisplayType({ foo: "bar" })).toBeNull()
  })
})

// ── buildFallbackCard ──────────────────────────────────────

describe("buildFallbackCard", () => {
  it("extracts key-value pairs from prose", () => {
    const text = "Company: Stripe\nValuation: $91.5B\nFounded: 2010\nHQ: San Francisco"
    const result = buildFallbackCard(text, "intel")
    expect(result).not.toBeNull()
    expect(result.display).toBe("checklist")
    expect(result.context.length).toBe(4)
    expect(result.context[0].text).toContain("Stripe")
  })

  it("extracts bullet points", () => {
    const text = "Key findings:\n- Revenue growing 30% YoY\n- Expanding into Europe\n- New CEO appointed"
    const result = buildFallbackCard(text)
    expect(result.items.length).toBe(3)
    expect(result.items[0].text).toContain("Revenue growing")
  })

  it("returns null for text with no structure", () => {
    expect(buildFallbackCard("just some random text")).toBeNull()
  })

  it("handles mixed KV and bullets", () => {
    const text = "Revenue: $5B\n- Growing fast\n- Beat estimates\nEmployees: 10000"
    const result = buildFallbackCard(text)
    expect(result.context.length).toBe(2) // Revenue, Employees
    expect(result.items.length).toBe(2) // the bullets
  })
})

// ── parseManusResponse (integration) ───────────────────────

describe("parseManusResponse", () => {
  it("parses clean Manus JSON response", () => {
    const text = '{"display":"stat_card","value":"$3.4T","label":"Apple Market Cap","sentiment":"positive","trend":[2.1,2.5,2.8,3.4]}'
    const result = parseManusResponse(text)
    expect(result.valid).toBe(true)
    expect(result.fallback).toBe(false)
    expect(result.data.display).toBe("stat_card")
    expect(result.data.value).toBe("$3.4T")
  })

  it("parses JSON wrapped in code fences", () => {
    const text = '```json\n{"display":"profile","name":"Jensen Huang","role":"CEO","company":"NVIDIA","details":["Founded 1993"]}\n```'
    const result = parseManusResponse(text)
    expect(result.valid).toBe(true)
    expect(result.data.name).toBe("Jensen Huang")
  })

  it("parses JSON buried in prose", () => {
    const text = 'Here is your intel:\n\n{"display":"verdict","claim":"OpenAI raised $10B","verdict":"true","confidence":"high","evidence":"Microsoft confirmed"}\n\nLet me know if you need more.'
    const result = parseManusResponse(text)
    expect(result.valid).toBe(true)
    expect(result.data.display).toBe("verdict")
  })

  it("parses JSON with typos and repairs them", () => {
    const text = '{"display":"comparison","us_name":"Stripe","them_name":"Adyen","metrics":[{"label":"Price","us_score">8,"them_score">6}],"verdict":"Stripe wins",}'
    const result = parseManusResponse(text)
    expect(result.valid).toBe(true)
    expect(result.data.metrics[0].us_score).toBe(8)
  })

  it("falls back to prose extraction when no JSON found", () => {
    const text = "Company: Stripe\nValuation: $91.5 billion\nStatus: Private\n- Payment processing leader\n- Founded in 2010"
    const result = parseManusResponse(text, "intel")
    expect(result.valid).toBe(true)
    expect(result.fallback).toBe(true)
    expect(result.data.display).toBe("checklist")
  })

  it("returns errors for empty response", () => {
    const result = parseManusResponse("")
    expect(result.valid).toBe(false)
    expect(result.data).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("returns errors for unstructured text", () => {
    const result = parseManusResponse("just a plain sentence with no data")
    expect(result.valid).toBe(false)
    expect(result.data).toBeNull()
  })

  it("infers missing display type from fields", () => {
    const text = '{"name":"Jensen Huang","role":"CEO","company":"NVIDIA","details":["Founded 1993"],"sentiment":"positive"}'
    const result = parseManusResponse(text)
    expect(result.valid).toBe(true)
    expect(result.data.display).toBe("profile")
  })

  it("validates and fills defaults for partial data", () => {
    const text = '{"display":"pipeline","stages":["Lead","Closed"]}'
    const result = parseManusResponse(text)
    expect(result.valid).toBe(true)
    expect(result.data.client).toBe("Unknown") // default
    expect(result.data.risk).toBe("medium") // default
    expect(result.data.current_stage).toBe(0) // default
  })

  it("handles real Manus comparison response", () => {
    const text = '{"display":"comparison","us_name":"Stripe","them_name":"Adyen","metrics":[{"label":"Developer Experience","us_score":9,"them_score":6},{"label":"Enterprise Features","us_score":7,"them_score":9},{"label":"Global Coverage","us_score":8,"them_score":8},{"label":"Pricing Transparency","us_score":8,"them_score":5}],"verdict":"Stripe wins on developer experience, Adyen stronger in enterprise"}'
    const result = parseManusResponse(text)
    expect(result.valid).toBe(true)
    expect(result.data.metrics.length).toBe(4)
  })

  it("handles real Manus slides response", () => {
    const text = '{"display":"slides","title":"Prep: Snowflake Q3 Review","slides":[{"heading":"Company Snapshot","bullets":["$2.1B ARR, 30% YoY growth","Consumption-based pricing","Cortex AI platform launching"]},{"heading":"Key People","bullets":["Sridhar Ramaswamy, CEO","Chris Degnan, CRO"]},{"heading":"Talking Points","bullets":["Ask about Cortex AI adoption","Discuss credit vs commit model"]}]}'
    const result = parseManusResponse(text)
    expect(result.valid).toBe(true)
    expect(result.data.slides.length).toBe(3)
    expect(result.data.slides[0].heading).toBe("Company Snapshot")
  })
})
