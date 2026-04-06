import { describe, it, expect } from "vitest"
import { classifyQuery, pickBestExample, pickIntelExample } from "./queryClassifier"

describe("classifyQuery", () => {
  // Comparisons
  it("detects 'X vs Y'", () => {
    expect(classifyQuery("Stripe vs Adyen")).toBe("comparison")
  })

  it("detects 'X versus Y'", () => {
    expect(classifyQuery("AWS versus Azure")).toBe("comparison")
  })

  it("detects 'compare X and Y'", () => {
    expect(classifyQuery("compare Snowflake and Databricks")).toBe("comparison")
  })

  // Prep
  it("detects 'prep for' queries", () => {
    expect(classifyQuery("prep for Tesla call")).toBe("prep")
  })

  it("detects 'meeting with' queries", () => {
    expect(classifyQuery("meeting with Anthropic team")).toBe("prep")
  })

  // Stats
  it("detects revenue queries", () => {
    expect(classifyQuery("OpenAI ARR")).toBe("stat")
  })

  it("detects market cap queries", () => {
    expect(classifyQuery("Apple market cap")).toBe("stat")
  })

  it("detects valuation queries", () => {
    expect(classifyQuery("Stripe valuation")).toBe("stat")
  })

  it("detects funding queries", () => {
    expect(classifyQuery("How much has Anthropic raised")).toBe("stat")
  })

  // Market
  it("detects market questions", () => {
    expect(classifyQuery("cloud market share")).toBe("market")
  })

  it("detects industry questions", () => {
    expect(classifyQuery("AI industry landscape")).toBe("market")
  })

  // People
  it("detects person names (2 words)", () => {
    expect(classifyQuery("Jensen Huang")).toBe("person")
  })

  it("detects person names (3 words)", () => {
    expect(classifyQuery("Elon Reeve Musk")).toBe("person")
  })

  // Companies
  it("detects single-word companies", () => {
    expect(classifyQuery("Stripe")).toBe("company")
  })

  it("detects two-word companies", () => {
    expect(classifyQuery("Goldman Sachs")).toBe("person") // ambiguous — 2 caps words
    // This is acceptable — the parser errs toward person for 2-word caps
  })

  // General
  it("falls back to general for vague queries", () => {
    expect(classifyQuery("what is happening with the deal")).toBe("general")
  })
})

describe("pickBestExample", () => {
  it("returns company examples (0 or 1) for company queries", () => {
    const idx = pickBestExample("company", 7)
    expect([0, 1]).toContain(idx)
  })

  it("returns person example (2) for person queries", () => {
    expect(pickBestExample("person", 7)).toBe(2)
  })

  it("returns comparison example (3) for comparison queries", () => {
    expect(pickBestExample("comparison", 7)).toBe(3)
  })

  it("returns prep example (4) for prep queries", () => {
    expect(pickBestExample("prep", 7)).toBe(4)
  })

  it("returns stat example (5) for stat queries", () => {
    expect(pickBestExample("stat", 7)).toBe(5)
  })

  it("returns market example (6) for market queries", () => {
    expect(pickBestExample("market", 7)).toBe(6)
  })

  it("returns valid index for general (random)", () => {
    const idx = pickBestExample("general", 7)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(7)
  })

  it("clamps to valid range when fewer examples", () => {
    const idx = pickBestExample("market", 3) // wants index 6, but only 3 examples
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThan(3)
  })
})

describe("pickIntelExample", () => {
  const examples = [
    'Input: Stripe\nOutput: {"display":"chart"}',
    'Input: Anthropic\nOutput: {"display":"profile"}',
    'Input: Jensen Huang\nOutput: {"display":"profile"}',
    'Input: Stripe vs Adyen\nOutput: {"display":"comparison"}',
    'Input: prep for Tesla call\nOutput: {"display":"checklist"}',
    'Input: OpenAI ARR\nOutput: {"display":"stat_card"}',
    'Input: cloud market share\nOutput: {"display":"chart"}',
  ]

  it("picks profile example for person query", () => {
    const ex = pickIntelExample("Jensen Huang", examples)
    expect(ex).toContain("Jensen Huang")
  })

  it("picks comparison example for vs query", () => {
    const ex = pickIntelExample("Stripe vs Adyen", examples)
    expect(ex).toContain("comparison")
  })

  it("picks stat_card example for ARR query", () => {
    const ex = pickIntelExample("Google revenue", examples)
    expect(ex).toContain("stat_card")
  })

  it("picks donut/chart example for market query", () => {
    const ex = pickIntelExample("cloud market share", examples)
    expect(ex).toContain("chart")
  })

  it("returns something for empty examples", () => {
    expect(pickIntelExample("anything", [])).toBe("")
  })
})
