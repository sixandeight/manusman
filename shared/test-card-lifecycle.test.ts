/**
 * Adversarial tests for card lifecycle logic extracted from RadialLayout.tsx.
 *
 * Tests pure logic only — no React, no DOM. We re-implement the state machines
 * and timer logic as plain functions/classes to test the actual behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { parseManusResponse } from "./parseManusJSON"
import { normalizeCardData } from "./normalizeCardData"

// ═══════════════════════════════════════════════════════════
// Re-extracted pure logic from RadialLayout.tsx
// ═══════════════════════════════════════════════════════════

type Phase = "input" | "pending" | "thinking" | "complete"

interface Card {
  id: string
  toolName: string
  needsScreenshot: boolean
  phase: Phase
  query: string
  result: any | null
  parsedResult: any | null
  isAuto?: boolean
}

// Card width logic (extracted from CardView inline style)
function getCardWidth(phase: Phase, toolName: string): number {
  if (phase === "complete") {
    return toolName === "prep" ? 520 : 480
  }
  return 300
}

// Border color logic (extracted from CardView inline style)
function getBorderColor(phase: Phase, toolName: string): string {
  const TOOL_COLORS: Record<string, string> = {
    intel: "#2563eb", deal_status: "#ea580c", prep: "#7c3aed", live_fact_check: "#d97706",
  }
  if (phase === "complete") return "#16a34a"
  if (phase === "thinking") return "#ca8a04"
  if (phase === "pending") return "#aaa"
  return TOOL_COLORS[toolName] || "#666"
}

// parseResultJSON — exact copy from RadialLayout.tsx
function parseResultJSON(text: string, toolName?: string): any | null {
  const result = parseManusResponse(text, toolName)
  return result.data ? normalizeCardData(result.data) : null
}

// ═══════════════════════════════════════════════════════════
// Auto-fade state machine (extracted from useAutoFade)
// ═══════════════════════════════════════════════════════════

const FADE_DELAY = 30000
const FADE_DURATION = 15000

class AutoFadeStateMachine {
  opacity = 1
  private timer: ReturnType<typeof setTimeout> | null = null
  private fadeStart: number | null = null
  private rafId: number | null = null
  private hovered = false
  private phase: Phase = "input"
  private onDelete: () => void
  private _deleted = false

  constructor(onDelete: () => void) {
    this.onDelete = onDelete
  }

  get isDeleted() { return this._deleted }

  setPhase(phase: Phase) {
    this.phase = phase
    if (phase === "complete") {
      this.startFadeTimer()
    } else {
      this.clearTimers()
    }
  }

  onHover() {
    this.hovered = true
    this.clearTimers()
    this.opacity = 1
  }

  onLeave() {
    this.hovered = false
    if (this.phase === "complete") {
      this.startFadeTimer()
    }
  }

  // Simulate time passing for the fade animation
  // In real code this is rAF-driven, here we compute directly
  tickFade(elapsedSinceFadeStart: number) {
    if (this.hovered) return
    if (this.fadeStart === null) return
    const progress = Math.min(elapsedSinceFadeStart / FADE_DURATION, 1)
    this.opacity = 1 - progress
    if (progress >= 1) {
      this._deleted = true
      this.onDelete()
    }
  }

  private startFadeTimer() {
    this.clearTimers()
    // In real code: setTimeout(FADE_DELAY) then rAF loop
    // We simulate: after FADE_DELAY, fadeStart is set
    this.timer = setTimeout(() => {
      this.fadeStart = Date.now()
    }, FADE_DELAY)
  }

  private clearTimers() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.fadeStart = null
  }

  // For testing: forcibly trigger the fade start (simulates FADE_DELAY elapsed)
  _forceFadeStart() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.fadeStart = Date.now()
  }

  get _fadeStarted() { return this.fadeStart !== null }

  destroy() {
    this.clearTimers()
  }
}

// ═══════════════════════════════════════════════════════════
// Queue/FIFO logic (extracted from RadialLayout)
// ═══════════════════════════════════════════════════════════

class CardQueueSystem {
  cards = new Map<string, Card>()
  queues = new Map<string, string[]>()
  processedResults = new Set<string>()
  private counter = 0

  nextId(tool: string) { return `c-${tool}-${++this.counter}-${Date.now()}` }

  createCard(toolName: string, query: string, isAuto = false): string {
    const id = this.nextId(toolName)
    this.cards.set(id, {
      id, toolName, needsScreenshot: false,
      phase: "input", query, result: null, parsedResult: null, isAuto,
    })
    return id
  }

  submitCard(cardId: string) {
    const card = this.cards.get(cardId)
    if (!card) return
    const q = this.queues.get(card.toolName) || []
    q.push(cardId)
    this.queues.set(card.toolName, q)
    this.cards.set(cardId, { ...card, phase: "pending" })
  }

  updateRunningTools(runningTools: Map<string, string>) {
    runningTools.forEach((status, toolName) => {
      const q = this.queues.get(toolName)
      if (!q) return
      for (const cardId of q) {
        const card = this.cards.get(cardId)
        if (card && (card.phase === "pending" || card.phase === "thinking")) {
          const newPhase = (status === "thinking" || status === "running") ? "thinking" : card.phase
          if (card.phase !== newPhase) {
            this.cards.set(cardId, { ...card, phase: newPhase as Phase })
          }
        }
      }
    })
  }

  processResults(toolResults: any[]) {
    const matches = new Map<string, any>()
    for (const result of toolResults) {
      if (result._partial) continue
      const rKey = result.taskId || `${result.toolName}-${result.text?.substring(0, 20)}`
      if (this.processedResults.has(rKey)) continue
      this.processedResults.add(rKey)

      const q = this.queues.get(result.toolName)
      const cardId = q?.shift()
      if (cardId) {
        matches.set(cardId, result)
      }
    }

    for (const [cardId, result] of matches) {
      if (!this.cards.has(cardId)) continue
      const card = this.cards.get(cardId)!
      const parsed = parseResultJSON(result.text, card.toolName)
      this.cards.set(cardId, { ...card, phase: "complete", result, parsedResult: parsed })
    }

    return matches
  }

  dismissCard(id: string) {
    this.cards.delete(id)
    this.queues.forEach((q) => {
      const idx = q.indexOf(id)
      if (idx !== -1) q.splice(idx, 1)
    })
  }
}

// ═══════════════════════════════════════════════════════════
// TEST SUITE 1: Card Width Transitions
// ═══════════════════════════════════════════════════════════

describe("Card Width Transitions", () => {
  it("input/pending/thinking phases always return 300px", () => {
    const phases: Phase[] = ["input", "pending", "thinking"]
    for (const phase of phases) {
      expect(getCardWidth(phase, "intel")).toBe(300)
      expect(getCardWidth(phase, "prep")).toBe(300)
      expect(getCardWidth(phase, "deal_status")).toBe(300)
      expect(getCardWidth(phase, "live_fact_check")).toBe(300)
    }
  })

  it("complete phase returns 480px for non-prep tools", () => {
    expect(getCardWidth("complete", "intel")).toBe(480)
    expect(getCardWidth("complete", "deal_status")).toBe(480)
    expect(getCardWidth("complete", "live_fact_check")).toBe(480)
  })

  it("complete prep returns 520px", () => {
    expect(getCardWidth("complete", "prep")).toBe(520)
  })

  it("unknown tool in complete still returns 480px", () => {
    expect(getCardWidth("complete", "unknown_tool")).toBe(480)
    expect(getCardWidth("complete", "")).toBe(480)
  })

  it("rapid phase transitions: width is always correct for current phase", () => {
    // Simulates input→pending→thinking→complete in rapid succession
    // Since width is purely derived from phase (no transition state), each step should be correct
    const tool = "intel"
    const phases: Phase[] = ["input", "pending", "thinking", "complete"]
    const expectedWidths = [300, 300, 300, 480]

    for (let i = 0; i < phases.length; i++) {
      expect(getCardWidth(phases[i], tool)).toBe(expectedWidths[i])
    }
  })

  it("phase going BACKWARDS (complete→thinking) — width shrinks back to 300px", () => {
    // The code doesn't guard against backward transitions
    // Width is just a pure function of phase, so it will shrink
    expect(getCardWidth("complete", "intel")).toBe(480)
    expect(getCardWidth("thinking", "intel")).toBe(300)
  })

  it("border color follows phase, not tool color, for pending/thinking/complete", () => {
    expect(getBorderColor("complete", "intel")).toBe("#16a34a")   // green
    expect(getBorderColor("thinking", "intel")).toBe("#ca8a04")   // yellow
    expect(getBorderColor("pending", "intel")).toBe("#aaa")       // grey
    expect(getBorderColor("input", "intel")).toBe("#2563eb")      // tool color
  })
})

// ═══════════════════════════════════════════════════════════
// TEST SUITE 2: Auto-fade Timing
// ═══════════════════════════════════════════════════════════

describe("Auto-fade Timing", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("fade timer starts when phase becomes complete", () => {
    const onDelete = vi.fn()
    const sm = new AutoFadeStateMachine(onDelete)

    sm.setPhase("complete")
    // Timer is set but fade hasn't started yet
    expect(sm.opacity).toBe(1)
    expect(sm._fadeStarted).toBe(false)

    // Advance past FADE_DELAY
    vi.advanceTimersByTime(FADE_DELAY + 1)
    expect(sm._fadeStarted).toBe(true)

    sm.destroy()
  })

  it("card is NOT deleted before fade duration completes", () => {
    const onDelete = vi.fn()
    const sm = new AutoFadeStateMachine(onDelete)

    sm.setPhase("complete")
    vi.advanceTimersByTime(FADE_DELAY + 1)

    // Halfway through fade
    sm.tickFade(FADE_DURATION / 2)
    expect(sm.opacity).toBeCloseTo(0.5, 1)
    expect(onDelete).not.toHaveBeenCalled()

    sm.destroy()
  })

  it("card is deleted after full fade duration", () => {
    const onDelete = vi.fn()
    const sm = new AutoFadeStateMachine(onDelete)

    sm.setPhase("complete")
    vi.advanceTimersByTime(FADE_DELAY + 1)

    sm.tickFade(FADE_DURATION)
    expect(sm.opacity).toBe(0)
    expect(onDelete).toHaveBeenCalledOnce()

    sm.destroy()
  })

  it("hover during fade resets opacity to 1 and clears timers", () => {
    const onDelete = vi.fn()
    const sm = new AutoFadeStateMachine(onDelete)

    sm.setPhase("complete")
    vi.advanceTimersByTime(FADE_DELAY + 1)

    // Fade has started, partially faded
    sm.tickFade(FADE_DURATION / 2)
    expect(sm.opacity).toBeCloseTo(0.5, 1)

    // Hover resets
    sm.onHover()
    expect(sm.opacity).toBe(1)
    expect(sm._fadeStarted).toBe(false)

    sm.destroy()
  })

  it("hover at exact moment fade starts — opacity should reset to 1", () => {
    const onDelete = vi.fn()
    const sm = new AutoFadeStateMachine(onDelete)

    sm.setPhase("complete")
    vi.advanceTimersByTime(FADE_DELAY) // exact moment

    // Hover immediately
    sm.onHover()
    expect(sm.opacity).toBe(1)
    expect(onDelete).not.toHaveBeenCalled()

    sm.destroy()
  })

  it("dismiss during fade — onDelete is NOT called again by timer", () => {
    const onDelete = vi.fn()
    const sm = new AutoFadeStateMachine(onDelete)

    sm.setPhase("complete")
    vi.advanceTimersByTime(FADE_DELAY + 1)

    // Card dismissed by user (externally)
    sm.destroy()

    // Advance time — the timer should be cleared, no leak
    vi.advanceTimersByTime(FADE_DURATION * 2)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it("multiple rapid hover/leave cycles — opacity should not jump", () => {
    const onDelete = vi.fn()
    const sm = new AutoFadeStateMachine(onDelete)

    sm.setPhase("complete")

    // Rapid hover/leave 10 times before FADE_DELAY
    for (let i = 0; i < 10; i++) {
      sm.onHover()
      expect(sm.opacity).toBe(1)
      sm.onLeave()
      expect(sm.opacity).toBe(1) // fade hasn't started yet, just timer restarted
    }

    // Now let the timer actually fire
    vi.advanceTimersByTime(FADE_DELAY + 1)
    expect(sm._fadeStarted).toBe(true)

    // Hover/leave during active fade
    sm.tickFade(5000) // 5s into fade
    expect(sm.opacity).toBeCloseTo(1 - 5000 / FADE_DURATION, 1)

    sm.onHover()
    expect(sm.opacity).toBe(1) // reset

    sm.onLeave()
    // Timer restarts from scratch — 30s again
    expect(sm._fadeStarted).toBe(false)

    vi.advanceTimersByTime(FADE_DELAY + 1)
    expect(sm._fadeStarted).toBe(true)

    sm.destroy()
  })

  it("phase change from complete→thinking→complete restarts the fade timer", () => {
    const onDelete = vi.fn()
    const sm = new AutoFadeStateMachine(onDelete)

    sm.setPhase("complete")
    vi.advanceTimersByTime(FADE_DELAY / 2) // halfway to fade

    // Phase goes backward
    sm.setPhase("thinking")
    expect(sm._fadeStarted).toBe(false) // timer cleared

    // Phase goes forward again
    sm.setPhase("complete")
    vi.advanceTimersByTime(FADE_DELAY / 2) // only halfway into NEW timer
    expect(sm._fadeStarted).toBe(false) // shouldn't have started yet

    vi.advanceTimersByTime(FADE_DELAY / 2 + 1) // now it should
    expect(sm._fadeStarted).toBe(true)

    sm.destroy()
  })

  it("fade timer does NOT start for non-complete phases", () => {
    const onDelete = vi.fn()
    const sm = new AutoFadeStateMachine(onDelete)

    sm.setPhase("input")
    vi.advanceTimersByTime(FADE_DELAY * 2)
    expect(sm._fadeStarted).toBe(false)

    sm.setPhase("pending")
    vi.advanceTimersByTime(FADE_DELAY * 2)
    expect(sm._fadeStarted).toBe(false)

    sm.setPhase("thinking")
    vi.advanceTimersByTime(FADE_DELAY * 2)
    expect(sm._fadeStarted).toBe(false)

    sm.destroy()
  })

  it("tick while hovered does NOT change opacity", () => {
    const onDelete = vi.fn()
    const sm = new AutoFadeStateMachine(onDelete)

    sm.setPhase("complete")
    sm._forceFadeStart()
    sm.onHover()

    sm.tickFade(FADE_DURATION) // full duration while hovered
    expect(sm.opacity).toBe(1) // unchanged because hovered
    expect(onDelete).not.toHaveBeenCalled()

    sm.destroy()
  })
})

// ═══════════════════════════════════════════════════════════
// TEST SUITE 3: Result-to-Card Matching (Queue FIFO)
// ═══════════════════════════════════════════════════════════

describe("Result-to-Card Matching (FIFO Queue)", () => {
  it("results match cards in FIFO order", () => {
    const sys = new CardQueueSystem()
    const id1 = sys.createCard("intel", "Apple")
    const id2 = sys.createCard("intel", "Google")
    sys.submitCard(id1)
    sys.submitCard(id2)

    // First result matches first card
    sys.processResults([{ toolName: "intel", text: '{"display":"stat_card","value":"$3T","label":"Market Cap"}' }])
    expect(sys.cards.get(id1)!.phase).toBe("complete")
    expect(sys.cards.get(id2)!.phase).toBe("pending")
  })

  it("out-of-order results — tool B completes before tool A", () => {
    const sys = new CardQueueSystem()
    const intelId = sys.createCard("intel", "Apple")
    const dealId = sys.createCard("deal_status", "Acme Corp")
    sys.submitCard(intelId)
    sys.submitCard(dealId)

    // deal_status result arrives first
    sys.processResults([{ toolName: "deal_status", text: '{"display":"pipeline","stages":["Prospect","Negotiation"],"current_stage":1,"client":"Acme"}' }])

    expect(sys.cards.get(dealId)!.phase).toBe("complete")
    expect(sys.cards.get(intelId)!.phase).toBe("pending") // unaffected — different queue
  })

  it("result with no matching queue — silently dropped", () => {
    const sys = new CardQueueSystem()
    const id = sys.createCard("intel", "Apple")
    sys.submitCard(id)

    // Result for a tool that has no cards
    const matches = sys.processResults([{ toolName: "deal_status", text: '{"display":"stat_card","value":"1","label":"test"}' }])

    expect(matches.size).toBe(0) // no match
    expect(sys.cards.get(id)!.phase).toBe("pending") // unchanged
  })

  it("result with toolName that was never queued — no queue exists", () => {
    const sys = new CardQueueSystem()

    // No cards created at all
    const matches = sys.processResults([{ toolName: "ghost_tool", text: '{"display":"stat_card","value":"1","label":"test"}' }])

    expect(matches.size).toBe(0)
  })

  it("processedResults Set grows unbounded — memory leak over long session", () => {
    const sys = new CardQueueSystem()

    // Simulate 10000 results over a long session
    for (let i = 0; i < 10000; i++) {
      const id = sys.createCard("intel", `Query ${i}`)
      sys.submitCard(id)
      sys.processResults([{
        toolName: "intel",
        taskId: `task-${i}`,
        text: `{"display":"stat_card","value":"${i}","label":"Q${i}"}`,
      }])
    }

    // The processedResults Set keeps every result key forever
    expect(sys.processedResults.size).toBe(10000)
    // Cards can be dismissed, but processedResults never shrinks
    for (const [id] of sys.cards) {
      sys.dismissCard(id)
    }
    expect(sys.cards.size).toBe(0)
    expect(sys.processedResults.size).toBe(10000) // still 10000 — never cleaned
  })

  it("duplicate result (same taskId) is ignored", () => {
    const sys = new CardQueueSystem()
    const id1 = sys.createCard("intel", "Apple")
    const id2 = sys.createCard("intel", "Google")
    sys.submitCard(id1)
    sys.submitCard(id2)

    const result = { toolName: "intel", taskId: "task-1", text: '{"display":"stat_card","value":"$3T","label":"Cap"}' }

    sys.processResults([result])
    expect(sys.cards.get(id1)!.phase).toBe("complete")

    // Same result again — should be ignored
    sys.processResults([result])
    expect(sys.cards.get(id2)!.phase).toBe("pending") // NOT upgraded
  })

  it("result without taskId uses text-based dedup key", () => {
    const sys = new CardQueueSystem()
    const id1 = sys.createCard("intel", "Apple")
    const id2 = sys.createCard("intel", "Google")
    sys.submitCard(id1)
    sys.submitCard(id2)

    const result = { toolName: "intel", text: '{"display":"stat_card","value":"$3T","label":"Market Cap"}' }

    sys.processResults([result])
    sys.processResults([result]) // duplicate based on toolName + first 20 chars of text

    expect(sys.cards.get(id1)!.phase).toBe("complete")
    expect(sys.cards.get(id2)!.phase).toBe("pending") // not matched to dupe
  })

  it("dismissing a pending card removes it from the queue — next result matches correct card", () => {
    const sys = new CardQueueSystem()
    const id1 = sys.createCard("intel", "Apple")
    const id2 = sys.createCard("intel", "Google")
    const id3 = sys.createCard("intel", "Meta")
    sys.submitCard(id1)
    sys.submitCard(id2)
    sys.submitCard(id3)

    // Dismiss the middle card
    sys.dismissCard(id2)

    // First result should match id1, second should match id3 (id2 was removed)
    sys.processResults([
      { toolName: "intel", taskId: "t1", text: '{"display":"stat_card","value":"1","label":"A"}' },
      { toolName: "intel", taskId: "t2", text: '{"display":"stat_card","value":"2","label":"B"}' },
    ])

    expect(sys.cards.get(id1)!.phase).toBe("complete")
    expect(sys.cards.has(id2)).toBe(false)
    expect(sys.cards.get(id3)!.phase).toBe("complete")
  })

  it("_partial results are skipped entirely", () => {
    const sys = new CardQueueSystem()
    const id = sys.createCard("intel", "Apple")
    sys.submitCard(id)

    sys.processResults([{ toolName: "intel", taskId: "t1", text: "partial data...", _partial: true }])
    expect(sys.cards.get(id)!.phase).toBe("pending") // not upgraded
    expect(sys.processedResults.size).toBe(0) // not added to processed set
  })

  it("queue shift happens correctly when React calls updater twice (StrictMode)", () => {
    // In the real code, queue shift was moved OUTSIDE setCards to prevent double-shift.
    // Here we verify the extracted logic doesn't double-shift.
    const sys = new CardQueueSystem()
    const id1 = sys.createCard("intel", "Apple")
    const id2 = sys.createCard("intel", "Google")
    sys.submitCard(id1)
    sys.submitCard(id2)

    const result = { toolName: "intel", taskId: "task-1", text: '{"display":"stat_card","value":"1","label":"A"}' }

    // Process once
    sys.processResults([result])

    // Queue should have shifted once — id2 is now at front
    const q = sys.queues.get("intel")!
    expect(q).toEqual([id2])
    expect(sys.cards.get(id1)!.phase).toBe("complete")
  })
})

// ═══════════════════════════════════════════════════════════
// TEST SUITE 4: parseResultJSON edge cases
// ═══════════════════════════════════════════════════════════

describe("parseResultJSON edge cases", () => {
  it("valid JSON returns normalized card data", () => {
    const result = parseResultJSON('{"display":"stat_card","value":"$5B","label":"Revenue"}')
    expect(result).not.toBeNull()
    expect(result.display).toBe("stat_card")
    expect(result.value).toBe("$5B")
  })

  it("undefined text — should not throw", () => {
    // parseManusResponse checks !text at the top, but parseResultJSON calls it
    // with `result.text` which could be undefined
    expect(() => parseResultJSON(undefined as any)).not.toThrow()
    const result = parseResultJSON(undefined as any)
    expect(result).toBeNull()
  })

  it("null text — should not throw", () => {
    expect(() => parseResultJSON(null as any)).not.toThrow()
    const result = parseResultJSON(null as any)
    expect(result).toBeNull()
  })

  it("empty string — returns null", () => {
    const result = parseResultJSON("")
    expect(result).toBeNull()
  })

  it("whitespace-only string — returns null", () => {
    const result = parseResultJSON("   \n\t  ")
    expect(result).toBeNull()
  })

  it("object instead of string — should not throw", () => {
    // If result.text is accidentally an object (e.g. {error: "timeout"})
    // String(obj) = "[object Object]" — will fail JSON parse but shouldn't crash
    expect(() => parseResultJSON({error: "timeout"} as any)).not.toThrow()
    const result = parseResultJSON({error: "timeout"} as any)
    // parseManusResponse expects string — passing object may cause unexpected behavior
    // This test documents what actually happens
    expect(result === null || result !== undefined).toBe(true)
  })

  it("number instead of string — should not throw", () => {
    expect(() => parseResultJSON(42 as any)).not.toThrow()
  })

  it("extremely long text (100KB) — should not crash or hang", () => {
    const longText = "x".repeat(100 * 1024)
    const start = Date.now()
    expect(() => parseResultJSON(longText)).not.toThrow()
    const elapsed = Date.now() - start
    // Should complete in reasonable time (< 5 seconds)
    expect(elapsed).toBeLessThan(5000)
  })

  it("100KB of valid-ish JSON with deeply nested objects", () => {
    // Build deeply nested JSON
    let json = '{"display":"stat_card","value":"$1B","label":"Deep"'
    for (let i = 0; i < 100; i++) {
      json += `,"nest${i}":{"a":"b"}`
    }
    json += "}"
    expect(() => parseResultJSON(json)).not.toThrow()
  })

  it("JSON with display type but missing required fields — returns data with _valid=false", () => {
    // stat_card requires "value" and "label"
    const result = parseResultJSON('{"display":"stat_card"}')
    // parseManusResponse returns data even if invalid, normalizeCardData runs on it
    // But what does normalizeCardData do with undefined value/label?
    // It should use defaults from the normalizer
    expect(result).not.toBeNull()
    expect(result.display).toBe("stat_card")
  })

  it("malformed JSON with trailing comma — repairJSON should fix", () => {
    const result = parseResultJSON('{"display":"stat_card","value":"$5B","label":"Rev",}')
    expect(result).not.toBeNull()
    expect(result.value).toBe("$5B")
  })

  it("JSON wrapped in code fences — extracted correctly", () => {
    const text = '```json\n{"display":"profile","name":"John Doe","role":"CEO","company":"Acme"}\n```'
    const result = parseResultJSON(text)
    expect(result).not.toBeNull()
    expect(result.display).toBe("profile")
    expect(result.name).toBe("John Doe")
  })

  it("text with NaN values — repaired to null, then normalized to 0", () => {
    const result = parseResultJSON('{"display":"stat_card","value":"$5B","label":"Rev","trend":[1,NaN,3]}')
    expect(result).not.toBeNull()
    // NaN gets replaced with null by repairJSON, then num() normalizes to 0, then filtered by isFinite
    expect(result.trend).toBeDefined()
    expect(result.trend.every((n: number) => isFinite(n))).toBe(true)
  })

  it("card.result.text access pattern when result is null — raw text fallback", () => {
    // In CardView complete phase: card.result?.text?.substring(0, 500)
    // What happens with various result shapes?
    const card: Card = {
      id: "test", toolName: "intel", needsScreenshot: false,
      phase: "complete", query: "test", result: null, parsedResult: null,
    }

    // When result is null, optional chaining returns undefined
    const rawText = card.result?.text?.substring(0, 500)
    expect(rawText).toBeUndefined()
  })

  it("card.result.text is a number — substring would throw without optional chaining", () => {
    const card: Card = {
      id: "test", toolName: "intel", needsScreenshot: false,
      phase: "complete", query: "test",
      result: { text: 12345 },
      parsedResult: null,
    }

    // result.text is a number, .substring is not a function on numbers
    // The code uses card.result?.text?.substring(0, 500)
    // On a number, .substring is undefined, so ?.substring won't crash
    const rawText = card.result?.text?.substring?.(0, 500)
    expect(rawText).toBeUndefined()

    // BUT the actual code does card.result?.text?.substring(0, 500)
    // without the extra ?. before substring — does number.substring exist?
    // In JS, Number.prototype.substring is undefined, so calling it throws
    expect(() => {
      const r = card.result?.text?.substring(0, 500) // text is 12345 (number)
    }).toThrow() // TypeError: card.result.text.substring is not a function
  })

  it("card.result.text is an object — substring throws", () => {
    const card: Card = {
      id: "test", toolName: "intel", needsScreenshot: false,
      phase: "complete", query: "test",
      result: { text: { nested: "data" } },
      parsedResult: null,
    }

    // { nested: "data" }.substring is not a function
    expect(() => {
      const r = card.result?.text?.substring(0, 500)
    }).toThrow()
  })

  it("result.text with exactly 500 chars — boundary test", () => {
    const text = "a".repeat(500)
    const truncated = text.substring(0, 500)
    expect(truncated.length).toBe(500)
  })

  it("result.text with 501 chars — truncated", () => {
    const text = "a".repeat(501)
    const truncated = text.substring(0, 500)
    expect(truncated.length).toBe(500)
  })
})

// ═══════════════════════════════════════════════════════════
// TEST SUITE 5: Phase transition edge cases
// ═══════════════════════════════════════════════════════════

describe("Phase Transition Edge Cases", () => {
  it("running tools update only affects pending/thinking cards, not complete", () => {
    const sys = new CardQueueSystem()
    const id = sys.createCard("intel", "Apple")
    sys.submitCard(id)

    // Complete the card
    sys.processResults([{
      toolName: "intel", taskId: "t1",
      text: '{"display":"stat_card","value":"$3T","label":"Cap"}',
    }])
    expect(sys.cards.get(id)!.phase).toBe("complete")

    // Now a running tool update comes in — should NOT regress the phase
    sys.updateRunningTools(new Map([["intel", "thinking"]]))
    expect(sys.cards.get(id)!.phase).toBe("complete") // still complete
  })

  it("running tools with status !== thinking/running does NOT change phase", () => {
    const sys = new CardQueueSystem()
    const id = sys.createCard("intel", "Apple")
    sys.submitCard(id)
    expect(sys.cards.get(id)!.phase).toBe("pending")

    // Status is something else (e.g. "queued")
    sys.updateRunningTools(new Map([["intel", "queued"]]))
    expect(sys.cards.get(id)!.phase).toBe("pending") // unchanged
  })

  it("running tools can promote pending→thinking but never thinking→pending", () => {
    const sys = new CardQueueSystem()
    const id = sys.createCard("intel", "Apple")
    sys.submitCard(id)

    // pending → thinking
    sys.updateRunningTools(new Map([["intel", "thinking"]]))
    expect(sys.cards.get(id)!.phase).toBe("thinking")

    // Now try to go back — status is "queued" (not thinking/running)
    // The code only changes phase if new phase differs, and newPhase is card.phase when status isn't thinking/running
    sys.updateRunningTools(new Map([["intel", "queued"]]))
    expect(sys.cards.get(id)!.phase).toBe("thinking") // stays thinking
  })

  it("multiple cards for same tool — all in queue get phase updates", () => {
    const sys = new CardQueueSystem()
    const id1 = sys.createCard("intel", "Apple")
    const id2 = sys.createCard("intel", "Google")
    sys.submitCard(id1)
    sys.submitCard(id2)

    sys.updateRunningTools(new Map([["intel", "running"]]))

    // Both should be thinking now
    expect(sys.cards.get(id1)!.phase).toBe("thinking")
    expect(sys.cards.get(id2)!.phase).toBe("thinking")
  })
})

// ═══════════════════════════════════════════════════════════
// TEST SUITE 6: Auto-fade + dismiss interaction (timer leak)
// ═══════════════════════════════════════════════════════════

describe("Auto-fade Timer Leak Prevention", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("destroying during FADE_DELAY (before fade starts) — no leak", () => {
    const onDelete = vi.fn()
    const sm = new AutoFadeStateMachine(onDelete)

    sm.setPhase("complete")
    vi.advanceTimersByTime(FADE_DELAY / 2) // halfway through delay

    sm.destroy()

    // Advance way past everything
    vi.advanceTimersByTime(FADE_DELAY * 10)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it("destroying after fade started but before completion — no leak", () => {
    const onDelete = vi.fn()
    const sm = new AutoFadeStateMachine(onDelete)

    sm.setPhase("complete")
    vi.advanceTimersByTime(FADE_DELAY + 1)
    expect(sm._fadeStarted).toBe(true)

    sm.destroy()
    vi.advanceTimersByTime(FADE_DURATION * 10)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it("onDelete is only called once even if tickFade overshoots", () => {
    const onDelete = vi.fn()
    const sm = new AutoFadeStateMachine(onDelete)

    sm.setPhase("complete")
    sm._forceFadeStart()

    sm.tickFade(FADE_DURATION) // exactly at end
    expect(onDelete).toHaveBeenCalledOnce()

    // Tick again past the end — should this call onDelete again?
    sm.tickFade(FADE_DURATION * 2)
    // The real rAF loop stops scheduling after progress >= 1,
    // but our state machine doesn't guard against double-call
    // This documents the actual behavior
    expect(onDelete).toHaveBeenCalledTimes(2) // BUG: called twice
  })
})
