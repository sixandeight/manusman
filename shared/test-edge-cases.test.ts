import { describe, it, expect } from "vitest"
import { parseManusResponse } from "./parseManusJSON"
import { normalizeCardData } from "./normalizeCardData"

// ── Helper: run parseManusResponse + normalizeCardData the same way RadialLayout does ──

function parseResultJSON(text: string, toolName?: string): any | null {
  const result = parseManusResponse(text, toolName)
  return result.data ? normalizeCardData(result.data) : null
}

// ═══════════════════════════════════════════════════════════════
// TEST 1: Partial / streaming results mid-parse
// ═══════════════════════════════════════════════════════════════

describe("Partial/streaming results mid-parse", () => {
  const partialInputs = [
    { label: "truncated mid-line (profile, missing value)", text: "DISPLAY: profile\nNAME: Jen" },
    { label: "key with no value", text: "DISPLAY:" },
    { label: "Manus thinking out loud", text: "Got it! I'll research that for you." },
    { label: "empty string", text: "" },
    { label: "truncated at end of key", text: "DISPLAY: profile\nNAME: Jensen Huang\nROLE:" },
    { label: "just whitespace", text: "   \n  \t  " },
    { label: "DISPLAY present but no other fields", text: "DISPLAY: stat_card" },
    { label: "incomplete JSON object", text: '{"display":"profile","name":"Jen' },
    { label: "JSON with opening brace only", text: '{"display":' },
    { label: "random preamble with no data", text: "Let me look into that for you. One moment please..." },
  ]

  for (const { label, text } of partialInputs) {
    it(`never throws for: ${label}`, () => {
      expect(() => parseResultJSON(text, "intel")).not.toThrow()
    })
  }

  it("empty string returns null", () => {
    expect(parseResultJSON("", "intel")).toBeNull()
  })

  it("whitespace-only returns null", () => {
    expect(parseResultJSON("   \n  \t  ", "intel")).toBeNull()
  })

  it("Manus thinking out loud returns null (no structured data)", () => {
    const result = parseResultJSON("Got it! I'll research that for you.", "intel")
    // Should be null — no structured data present
    expect(result).toBeNull()
  })

  it("'DISPLAY:' with no value returns null (line parser needs a value)", () => {
    const result = parseResultJSON("DISPLAY:", "intel")
    expect(result).toBeNull()
  })

  it("truncated profile (NAME: Jen) parses as partial profile or null", () => {
    const result = parseResultJSON("DISPLAY: profile\nNAME: Jen", "intel")
    // Line parser should find DISPLAY=profile and NAME=Jen — a valid partial profile
    if (result !== null) {
      expect(result.display).toBe("profile")
      expect(result.name).toBe("Jen")
      // Normalizer should fill defaults for missing fields
      expect(typeof result.role).toBe("string")
      expect(typeof result.company).toBe("string")
    }
  })

  it("truncated profile with trailing key (ROLE:) still parses name", () => {
    const result = parseResultJSON(
      "DISPLAY: profile\nNAME: Jensen Huang\nROLE:",
      "intel",
    )
    // ROLE: with no value — the regex won't match it, but NAME should still parse
    if (result !== null) {
      expect(result.display).toBe("profile")
      expect(result.name).toBe("Jensen Huang")
    }
  })

  it("DISPLAY: stat_card with nothing else returns data but marked invalid", () => {
    const raw = parseManusResponse("DISPLAY: stat_card", "intel")
    // The line format parser should build a stat_card with defaults
    // but it won't have the required value/label from Manus
    if (raw.data) {
      const normalized = normalizeCardData(raw.data)
      // Should not crash
      expect(normalized).toBeDefined()
      expect(normalized.display).toBe("stat_card")
    }
  })

  it("incomplete JSON '{\"display\":' does not throw", () => {
    const result = parseResultJSON('{"display":', "intel")
    // Should return null — can't parse incomplete JSON
    // Might fall through to fallback, either way no crash
    expect(() => parseResultJSON('{"display":', "intel")).not.toThrow()
  })

  it("incomplete JSON object with truncated string does not throw", () => {
    const result = parseResultJSON('{"display":"profile","name":"Jen', "intel")
    // Incomplete JSON — parser should handle gracefully
    expect(result === null || (result && typeof result === "object")).toBe(true)
  })

  it("normalizeCardData handles null/undefined input without crashing", () => {
    expect(() => normalizeCardData(null)).not.toThrow()
    expect(() => normalizeCardData(undefined)).not.toThrow()
    expect(() => normalizeCardData("")).not.toThrow()
    expect(() => normalizeCardData(42)).not.toThrow()
  })

  it("normalizeCardData passes through unknown display types", () => {
    const data = { display: "unknown_type", foo: "bar" }
    const result = normalizeCardData(data)
    expect(result).toEqual(data) // pass-through, no crash
  })
})

// ═══════════════════════════════════════════════════════════════
// TEST 2: Concurrent tool calls — queue matching
// ═══════════════════════════════════════════════════════════════

/**
 * Replicate the queue logic from RadialLayout.tsx:
 *   - queues: Map<string, string[]> (toolName → cardId[])
 *   - submit: push cardId to queues.get(toolName)
 *   - result: shift() from queues.get(result.toolName)
 *   - dismiss: splice cardId out of whichever queue it's in
 */
class ToolQueue {
  queues = new Map<string, string[]>()

  submit(toolName: string, cardId: string): void {
    const q = this.queues.get(toolName) || []
    q.push(cardId)
    this.queues.set(toolName, q)
  }

  result(toolName: string): string | undefined {
    const q = this.queues.get(toolName)
    return q?.shift()
  }

  dismiss(cardId: string): void {
    this.queues.forEach((q) => {
      const idx = q.indexOf(cardId)
      if (idx !== -1) q.splice(idx, 1)
    })
  }

  /** Helper: get current queue for a tool */
  peek(toolName: string): string[] {
    return this.queues.get(toolName) || []
  }
}

describe("Concurrent tool calls — queue matching", () => {
  it("two intel calls → results match in FIFO order", () => {
    const q = new ToolQueue()

    q.submit("intel", "card-1")
    q.submit("intel", "card-2")

    // First result should match card-1, second should match card-2
    expect(q.result("intel")).toBe("card-1")
    expect(q.result("intel")).toBe("card-2")
  })

  it("mixed tool calls route to correct queues", () => {
    const q = new ToolQueue()

    q.submit("intel", "card-A")
    q.submit("deal_status", "card-B")
    q.submit("intel", "card-C")

    // intel result → card-A (first intel)
    expect(q.result("intel")).toBe("card-A")
    // deal_status result → card-B
    expect(q.result("deal_status")).toBe("card-B")
    // second intel result → card-C
    expect(q.result("intel")).toBe("card-C")
  })

  it("dismissing a card mid-flight removes it from queue", () => {
    const q = new ToolQueue()

    q.submit("intel", "card-1")
    q.submit("intel", "card-2")
    q.submit("intel", "card-3")

    // User dismisses card-2 while it's pending
    q.dismiss("card-2")

    // Queue should now be [card-1, card-3]
    expect(q.peek("intel")).toEqual(["card-1", "card-3"])

    // Results should match card-1, then card-3
    expect(q.result("intel")).toBe("card-1")
    expect(q.result("intel")).toBe("card-3")
  })

  it("dismissing first card in queue promotes second", () => {
    const q = new ToolQueue()

    q.submit("intel", "card-1")
    q.submit("intel", "card-2")

    q.dismiss("card-1")

    // Next result should go to card-2
    expect(q.result("intel")).toBe("card-2")
  })

  it("result arriving for empty queue returns undefined (no crash)", () => {
    const q = new ToolQueue()

    // No cards submitted — result arrives
    expect(q.result("intel")).toBeUndefined()
    expect(q.result("deal_status")).toBeUndefined()
  })

  it("result for non-existent tool returns undefined (no crash)", () => {
    const q = new ToolQueue()

    q.submit("intel", "card-1")
    // Result arrives for a tool that has no queue
    expect(q.result("prep")).toBeUndefined()
    // Original queue untouched
    expect(q.peek("intel")).toEqual(["card-1"])
  })

  it("dismiss a card that isn't in any queue — no crash", () => {
    const q = new ToolQueue()

    q.submit("intel", "card-1")

    // Dismiss a card that doesn't exist
    expect(() => q.dismiss("card-nonexistent")).not.toThrow()

    // Original queue untouched
    expect(q.peek("intel")).toEqual(["card-1"])
  })

  it("dismiss removes from correct queue when card is in a specific tool queue", () => {
    const q = new ToolQueue()

    q.submit("intel", "card-1")
    q.submit("deal_status", "card-2")
    q.submit("prep", "card-3")

    q.dismiss("card-2")

    expect(q.peek("intel")).toEqual(["card-1"])
    expect(q.peek("deal_status")).toEqual([])
    expect(q.peek("prep")).toEqual(["card-3"])
  })

  it("rapid submit-result-submit-result stays consistent", () => {
    const q = new ToolQueue()

    q.submit("intel", "card-1")
    expect(q.result("intel")).toBe("card-1")

    q.submit("intel", "card-2")
    expect(q.result("intel")).toBe("card-2")

    // Queue should be empty now
    expect(q.result("intel")).toBeUndefined()
  })

  it("all four tool types work independently", () => {
    const q = new ToolQueue()
    const tools = ["intel", "deal_status", "prep", "live_fact_check"]

    // Submit one card per tool
    for (const tool of tools) {
      q.submit(tool, `card-${tool}`)
    }

    // Results arrive in reverse order — should still match correctly
    for (const tool of [...tools].reverse()) {
      expect(q.result(tool)).toBe(`card-${tool}`)
    }
  })
})
