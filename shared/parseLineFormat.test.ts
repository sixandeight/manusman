import { describe, it, expect } from "vitest"
import { parseLineFormat, parseLines } from "./parseLineFormat"

// ── parseLines ─────────────────────────────────────────────

describe("parseLines", () => {
  it("extracts key-value pairs", () => {
    const { fields } = parseLines("NAME: Jensen Huang\nROLE: CEO")
    expect(fields.NAME).toBe("Jensen Huang")
    expect(fields.ROLE).toBe("CEO")
  })

  it("collects repeated keys into lists", () => {
    const { lists } = parseLines("DETAIL: Fact one\nDETAIL: Fact two\nDETAIL: Fact three")
    expect(lists.DETAIL).toEqual(["Fact one", "Fact two", "Fact three"])
  })

  it("ignores blank lines", () => {
    const { fields } = parseLines("NAME: Test\n\n\nROLE: CEO\n")
    expect(fields.NAME).toBe("Test")
    expect(fields.ROLE).toBe("CEO")
  })

  it("ignores lines without colons", () => {
    const { fields } = parseLines("This is just text\nNAME: Test\nMore text")
    expect(Object.keys(fields)).toEqual(["NAME"])
  })

  it("handles case-insensitive keys", () => {
    const { fields } = parseLines("display: stat_card\nValue: $5B")
    expect(fields.DISPLAY).toBe("stat_card")
    expect(fields.VALUE).toBe("$5B")
  })
})

// ── stat_card ──────────────────────────────────────────────

describe("stat_card", () => {
  it("parses a stat card", () => {
    const result = parseLineFormat(`
DISPLAY: stat_card
VALUE: $3.4T
LABEL: Apple Market Cap
SENTIMENT: positive
TREND: 2.1, 2.5, 2.8, 3.4
SOURCE: Yahoo Finance
    `)
    expect(result.display).toBe("stat_card")
    expect(result.value).toBe("$3.4T")
    expect(result.label).toBe("Apple Market Cap")
    expect(result.trend).toEqual([2.1, 2.5, 2.8, 3.4])
    expect(result.source).toBe("Yahoo Finance")
  })

  it("handles pipe-separated trend", () => {
    const result = parseLineFormat("DISPLAY: stat_card\nVALUE: 100\nLABEL: Test\nTREND: 10 | 20 | 30")
    expect(result.trend).toEqual([10, 20, 30])
  })

  it("accepts TYPE as alias for DISPLAY", () => {
    const result = parseLineFormat("TYPE: stat\nVALUE: $5B\nLABEL: Revenue")
    expect(result.display).toBe("stat_card")
    expect(result.value).toBe("$5B")
  })
})

// ── comparison ─────────────────────────────────────────────

describe("comparison", () => {
  it("parses a comparison", () => {
    const result = parseLineFormat(`
DISPLAY: comparison
US: Stripe
THEM: Adyen
METRIC: Developer Experience | 9 | 6
METRIC: Enterprise Features | 7 | 9
METRIC: Global Coverage | 8 | 8
VERDICT: Stripe wins on DX
    `)
    expect(result.display).toBe("comparison")
    expect(result.us_name).toBe("Stripe")
    expect(result.them_name).toBe("Adyen")
    expect(result.metrics.length).toBe(3)
    expect(result.metrics[0]).toEqual({ label: "Developer Experience", us_score: 9, them_score: 6 })
    expect(result.metrics[1]).toEqual({ label: "Enterprise Features", us_score: 7, them_score: 9 })
    expect(result.verdict).toBe("Stripe wins on DX")
  })

  it("handles US_NAME alias", () => {
    const result = parseLineFormat("DISPLAY: comparison\nUS_NAME: Us\nTHEM_NAME: Them\nMETRIC: Speed | 5 | 5")
    expect(result.us_name).toBe("Us")
  })
})

// ── profile ────────────────────────────────────────────────

describe("profile", () => {
  it("parses a profile", () => {
    const result = parseLineFormat(`
DISPLAY: profile
NAME: Jensen Huang
ROLE: CEO & Co-founder
COMPANY: NVIDIA
DETAIL: Founded NVIDIA 1993
DETAIL: $3.4T market cap
DETAIL: Drives AI chip strategy
SENTIMENT: positive
SUMMARY: Visionary CEO leading AI infrastructure
    `)
    expect(result.display).toBe("profile")
    expect(result.name).toBe("Jensen Huang")
    expect(result.role).toBe("CEO & Co-founder")
    expect(result.company).toBe("NVIDIA")
    expect(result.details).toEqual(["Founded NVIDIA 1993", "$3.4T market cap", "Drives AI chip strategy"])
    expect(result.summary).toBe("Visionary CEO leading AI infrastructure")
  })
})

// ── verdict ────────────────────────────────────────────────

describe("verdict", () => {
  it("parses a verdict", () => {
    const result = parseLineFormat(`
DISPLAY: verdict
CLAIM: OpenAI raised $10B from Microsoft
VERDICT: true
CONFIDENCE: high
EVIDENCE: Microsoft confirmed a $10B investment in Jan 2023
SOURCE: Microsoft blog
    `)
    expect(result.display).toBe("verdict")
    expect(result.verdict).toBe("true")
    expect(result.confidence).toBe("high")
    expect(result.evidence).toContain("$10B")
  })

  it("accepts fact_check as display alias", () => {
    const result = parseLineFormat("DISPLAY: fact_check\nCLAIM: test\nVERDICT: false\nCONFIDENCE: low")
    expect(result.display).toBe("verdict")
    expect(result.verdict).toBe("false")
  })
})

// ── checklist ──────────────────────────────────────────────

describe("checklist", () => {
  it("parses a checklist with context and items", () => {
    const result = parseLineFormat(`
DISPLAY: checklist
TITLE: Call Prep: Tesla
SUBTITLE: EV leader
CONTEXT: Q4 deliveries beat estimates | high
CONTEXT: Cybertruck ramping | medium
ITEM: Ask about fleet pricing
ITEM: Discuss API timeline
    `)
    expect(result.display).toBe("checklist")
    expect(result.title).toBe("Call Prep: Tesla")
    expect(result.context.length).toBe(2)
    expect(result.context[0]).toEqual({ text: "Q4 deliveries beat estimates", priority: "high" })
    expect(result.context[1]).toEqual({ text: "Cybertruck ramping", priority: "medium" })
    expect(result.items.length).toBe(2)
    expect(result.items[0].text).toBe("Ask about fleet pricing")
  })

  it("accepts TODO as alias for ITEM", () => {
    const result = parseLineFormat("DISPLAY: checklist\nTITLE: Test\nTODO: Do something")
    expect(result.items[0].text).toBe("Do something")
  })
})

// ── pipeline ───────────────────────────────────────────────

describe("pipeline", () => {
  it("parses a pipeline", () => {
    const result = parseLineFormat(`
DISPLAY: pipeline
CLIENT: Snowflake
STAGES: Prospecting | Discovery | Proposal | Negotiation | Closed
CURRENT: 3
VALUE: $2M ARR
RISK: medium
NEXT: Final pricing review
DUE: Next week
BLOCKER: Legal review pending
    `)
    expect(result.display).toBe("pipeline")
    expect(result.client).toBe("Snowflake")
    expect(result.stages).toEqual(["Prospecting", "Discovery", "Proposal", "Negotiation", "Closed"])
    expect(result.current_stage).toBe(3)
    expect(result.deal_value).toBe("$2M ARR")
    expect(result.risk).toBe("medium")
    expect(result.next_action).toBe("Final pricing review")
  })
})

// ── chart ──────────────────────────────────────────────────

describe("chart", () => {
  it("parses a bar chart", () => {
    const result = parseLineFormat(`
DISPLAY: chart
CHART_TYPE: bar
TITLE: Revenue by Year
NAME: Revenue
VALUES: 10 | 15 | 22 | 31
LABELS: 2021 | 2022 | 2023 | 2024
COLOR: blue
SUMMARY: Growing 3x in 4 years
    `)
    expect(result.display).toBe("chart")
    expect(result.chart_type).toBe("bar")
    expect(result.datasets[0].values).toEqual([10, 15, 22, 31])
    expect(result.labels).toEqual(["2021", "2022", "2023", "2024"])
  })

  it("parses a donut chart with segments", () => {
    const result = parseLineFormat(`
DISPLAY: chart
CHART_TYPE: donut
TITLE: Cloud Market Share
SEGMENT: AWS | 31 | orange
SEGMENT: Azure | 24 | blue
SEGMENT: GCP | 11 | red
SEGMENT: Others | 34 | gray
SUMMARY: AWS leads at 31%
    `)
    expect(result.display).toBe("chart")
    expect(result.chart_type).toBe("donut")
    expect(result.datasets[0].values).toEqual([31, 24, 11, 34])
    expect(result.datasets[0].labels).toEqual(["AWS", "Azure", "GCP", "Others"])
    expect(result.datasets[0].colors).toEqual(["orange", "blue", "red", "gray"])
  })
})

// ── slides ─────────────────────────────────────────────────

describe("slides", () => {
  it("parses slides", () => {
    const result = parseLineFormat(`
DISPLAY: slides
TITLE: Prep: Snowflake Q3 Review
SLIDE: Company Snapshot | $2.1B ARR | Consumption-based pricing | Cortex AI launching
SLIDE: Key People | Sridhar Ramaswamy, CEO | Chris Degnan, CRO
SLIDE: Talking Points | Ask about Cortex AI | Discuss credit model
    `)
    expect(result.display).toBe("slides")
    expect(result.slides.length).toBe(3)
    expect(result.slides[0].heading).toBe("Company Snapshot")
    expect(result.slides[0].bullets).toEqual(["$2.1B ARR", "Consumption-based pricing", "Cortex AI launching"])
    expect(result.slides[1].heading).toBe("Key People")
  })
})

// ── Edge cases ─────────────────────────────────────────────

describe("edge cases", () => {
  it("returns null for empty string", () => {
    expect(parseLineFormat("")).toBeNull()
  })

  it("returns null for plain text without DISPLAY", () => {
    expect(parseLineFormat("Just some random text about Stripe")).toBeNull()
  })

  it("returns null for JSON (not line format)", () => {
    expect(parseLineFormat('{"display":"stat_card","value":"$5B"}')).toBeNull()
  })

  it("returns null for unknown display type", () => {
    expect(parseLineFormat("DISPLAY: unknown_thing\nVALUE: test")).toBeNull()
  })
})
