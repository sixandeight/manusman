import { describe, it, expect } from "vitest"
import { normalizeCardData, num, str, arr, clamp } from "./normalizeCardData"

// ── Helpers ────────────────────────────────────────────────

describe("num", () => {
  it("converts string numbers", () => expect(num("8")).toBe(8))
  it("passes through numbers", () => expect(num(42)).toBe(42))
  it("returns fallback for NaN", () => expect(num("abc")).toBe(0))
  it("returns fallback for null", () => expect(num(null)).toBe(0))
  it("returns fallback for Infinity", () => expect(num(Infinity)).toBe(0))
})

describe("str", () => {
  it("passes strings through", () => expect(str("hi")).toBe("hi"))
  it("converts numbers", () => expect(str(42)).toBe("42"))
  it("returns fallback for null", () => expect(str(null, "x")).toBe("x"))
  it("returns fallback for undefined", () => expect(str(undefined, "x")).toBe("x"))
})

describe("arr", () => {
  it("passes arrays through", () => expect(arr([1, 2])).toEqual([1, 2]))
  it("returns empty for null", () => expect(arr(null)).toEqual([]))
  it("returns empty for string", () => expect(arr("hi")).toEqual([]))
  it("applies map function", () => expect(arr(["1", "2"], Number)).toEqual([1, 2]))
})

describe("clamp", () => {
  it("clamps below min", () => expect(clamp(-5, 0, 10)).toBe(0))
  it("clamps above max", () => expect(clamp(15, 0, 10)).toBe(10))
  it("passes through in range", () => expect(clamp(5, 0, 10)).toBe(5))
})

// ── stat_card ──────────────────────────────────────────────

describe("normalize stat_card", () => {
  it("normalizes clean data", () => {
    const result = normalizeCardData({ display: "stat_card", value: "$5B", label: "Revenue", sentiment: "positive", trend: [1, 2, 3] })
    expect(result.value).toBe("$5B")
    expect(result.trend).toEqual([1, 2, 3])
  })

  it("coerces string trend values to numbers", () => {
    const result = normalizeCardData({ display: "stat_card", value: "100", label: "Test", trend: ["1", "2", "3"] })
    expect(result.trend).toEqual([1, 2, 3])
  })

  it("handles missing trend", () => {
    const result = normalizeCardData({ display: "stat_card", value: "100", label: "Test" })
    expect(result.trend).toEqual([])
  })

  it("defaults bad sentiment to neutral", () => {
    const result = normalizeCardData({ display: "stat_card", value: "x", label: "y", sentiment: "amazing" })
    expect(result.sentiment).toBe("neutral")
  })
})

// ── comparison ─────────────────────────────────────────────

describe("normalize comparison", () => {
  it("clamps scores to 0-10", () => {
    const result = normalizeCardData({
      display: "comparison",
      metrics: [{ label: "Speed", us_score: 15, them_score: -2 }],
    })
    expect(result.metrics[0].us_score).toBe(10)
    expect(result.metrics[0].them_score).toBe(0)
  })

  it("coerces string scores", () => {
    const result = normalizeCardData({
      display: "comparison",
      metrics: [{ label: "Speed", us_score: "8", them_score: "6" }],
    })
    expect(result.metrics[0].us_score).toBe(8)
    expect(result.metrics[0].them_score).toBe(6)
  })

  it("caps at 6 metrics", () => {
    const metrics = Array.from({ length: 10 }, (_, i) => ({ label: `M${i}`, us_score: 5, them_score: 5 }))
    const result = normalizeCardData({ display: "comparison", metrics })
    expect(result.metrics.length).toBe(6)
  })

  it("handles null metrics", () => {
    const result = normalizeCardData({ display: "comparison", metrics: null })
    expect(result.metrics).toEqual([])
  })
})

// ── verdict ────────────────────────────────────────────────

describe("normalize verdict", () => {
  it("normalizes verdict aliases", () => {
    expect(normalizeCardData({ display: "verdict", verdict: "partial", claim: "x" }).verdict).toBe("partially_true")
    expect(normalizeCardData({ display: "verdict", verdict: "TRUE", claim: "x" }).verdict).toBe("true")
    expect(normalizeCardData({ display: "verdict", verdict: "FALSE", claim: "x" }).verdict).toBe("false")
  })

  it("defaults unknown verdict to unverifiable", () => {
    expect(normalizeCardData({ display: "verdict", verdict: "maybe", claim: "x" }).verdict).toBe("unverifiable")
  })

  it("defaults bad confidence", () => {
    expect(normalizeCardData({ display: "verdict", verdict: "true", claim: "x", confidence: "super" }).confidence).toBe("medium")
  })
})

// ── chart ──────────────────────────────────────────────────

describe("normalize chart", () => {
  it("coerces dataset values to numbers", () => {
    const result = normalizeCardData({
      display: "chart", chart_type: "bar",
      datasets: [{ name: "Rev", values: ["10", "20", "NaN"] }],
    })
    expect(result.datasets[0].values).toEqual([10, 20, 0])
  })

  it("defaults chart_type to bar", () => {
    const result = normalizeCardData({ display: "chart", datasets: [{ values: [1] }] })
    expect(result.chart_type).toBe("bar")
  })

  it("preserves donut type", () => {
    const result = normalizeCardData({ display: "chart", chart_type: "donut", datasets: [{ values: [1] }] })
    expect(result.chart_type).toBe("donut")
  })
})

// ── pipeline ───────────────────────────────────────────────

describe("normalize pipeline", () => {
  it("clamps current_stage to valid range", () => {
    const result = normalizeCardData({
      display: "pipeline", stages: ["A", "B", "C"], current_stage: 99,
    })
    expect(result.current_stage).toBe(2) // max index
  })

  it("handles negative current_stage", () => {
    const result = normalizeCardData({
      display: "pipeline", stages: ["A", "B"], current_stage: -1,
    })
    expect(result.current_stage).toBe(0)
  })

  it("defaults risk to medium", () => {
    const result = normalizeCardData({ display: "pipeline", stages: ["A"], risk: "extreme" })
    expect(result.risk).toBe("medium")
  })
})

// ── slides ─────────────────────────────────────────────────

describe("normalize slides", () => {
  it("caps slides at 8", () => {
    const slides = Array.from({ length: 12 }, (_, i) => ({ heading: `S${i}`, bullets: [] as string[] }))
    const result = normalizeCardData({ display: "slides", slides })
    expect(result.slides.length).toBe(8)
  })

  it("caps bullets at 6 per slide", () => {
    const result = normalizeCardData({
      display: "slides",
      slides: [{ heading: "X", bullets: Array.from({ length: 10 }, (_, i) => `B${i}`) }],
    })
    expect(result.slides[0].bullets.length).toBe(6)
  })
})

// ── passthrough ────────────────────────────────────────────

describe("passthrough", () => {
  it("returns null/undefined as-is", () => {
    expect(normalizeCardData(null)).toBeNull()
    expect(normalizeCardData(undefined)).toBeUndefined()
  })

  it("passes through unknown display types", () => {
    const data = { display: "future_type", foo: "bar" }
    expect(normalizeCardData(data)).toEqual(data)
  })
})
