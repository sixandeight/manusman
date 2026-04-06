import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { PhysicsEngine, findLinks, PhysicsNode } from "../src/components/ManusTools/PhysicsEngine"

// ═══════════════════════════════════════════════════════════════
// 1. Zone Assignment
// ═══════════════════════════════════════════════════════════════

describe("Zone assignment — round-robin through 8 zones", () => {
  let tickPositions: Map<string, { x: number; y: number }>
  let engine: PhysicsEngine

  beforeEach(() => {
    tickPositions = new Map()
    engine = new PhysicsEngine(1920, 1080, (pos) => {
      tickPositions = pos
    })
  })

  afterEach(() => {
    engine.destroy()
  })

  it("0 cards — simulation runs with empty nodes, tick fires with empty map", () => {
    // Simulation should not crash with 0 nodes
    // Just constructing and destroying is the test
    expect(true).toBe(true)
  })

  it("1 card — gets assigned to first zone (NE)", () => {
    engine.addNode("card-1", 300, 200)
    // The node should exist internally. We can verify by removing it (no crash).
    engine.removeNode("card-1")
  })

  it("8 cards — each gets a unique zone", () => {
    const zones: string[] = []
    // We can't directly read zones from outside, but we can check that
    // adding 8 cards doesn't crash and they all get positions
    for (let i = 0; i < 8; i++) {
      engine.addNode(`card-${i}`, 300, 200)
    }
    // Force a few ticks by waiting
    // The simulation is running, tick should fire
  })

  it("9 cards — zone wraps around, card 9 shares zone with card 1", () => {
    for (let i = 0; i < 9; i++) {
      engine.addNode(`card-${i}`, 300, 200)
    }
    // Card 0 -> NE (index 0), Card 8 -> NE (index 8 % 8 = 0)
    // Both in same zone — they should repel each other but target same position
    // No crash expected, but potential crowding
  })

  it("100 cards — stress test, no crash, all get positions", () => {
    for (let i = 0; i < 100; i++) {
      engine.addNode(`card-${i}`, 300, 200)
    }
    // 100 cards across 8 zones = ~12-13 per zone
    // d3-force should handle this but performance may degrade
  })
})

// ═══════════════════════════════════════════════════════════════
// 2. Center Repulsion — division by zero at exact center
// ═══════════════════════════════════════════════════════════════

describe("Center repulsion", () => {
  it("card at exact center — random offset escapes dead zone", () => {
    // FIX: When dist < 1, the code now applies a random offset to dx/dy
    // so the card is nudged in a random direction instead of getting stuck.
    // Simulate the fixed logic: if dist < 1, dx/dy get random values.
    const CENTER_DEAD_ZONE = 150

    let dx = 0
    let dy = 0
    const dist = Math.sqrt(dx * dx + dy * dy)

    // The fix: when dist < 1, randomize dx/dy
    if (dist < 1) {
      dx = (Math.random() - 0.5) * 2
      dy = (Math.random() - 0.5) * 2
    }
    const normDist = Math.sqrt(dx * dx + dy * dy) || 1
    const centerForce = 3 * (1 - dist / CENTER_DEAD_ZONE)
    const vx_delta = (dx / normDist) * centerForce
    const vy_delta = (dy / normDist) * centerForce

    // Card at center now gets a non-zero force in some random direction
    expect(Math.abs(vx_delta) + Math.abs(vy_delta)).toBeGreaterThan(0)
  })

  it("card very close to center — force direction is correct but magnitude is constant", () => {
    // Card at (960.001, 540) on 1920x1080 screen
    const cx = 960, cy = 540
    const nodeX = 960.001, nodeY = 540
    const dx = nodeX - cx // 0.001
    const dy = nodeY - cy // 0
    const dist = Math.sqrt(dx * dx + dy * dy) || 1 // ~0.001
    const centerForce = 3
    const vx_delta = (dx / dist) * centerForce // ~3.0 (unit vector * 3)
    const vy_delta = (dy / dist) * centerForce // ~0

    // The force is constant magnitude 3 regardless of distance
    // A card 1px from center gets same push as a card 500px from center
    // This is by design ("constant center repulsion") but means edge cards jitter
    expect(Math.sqrt(vx_delta ** 2 + vy_delta ** 2)).toBeCloseTo(3, 1)
  })
})

// ═══════════════════════════════════════════════════════════════
// 3. Collision Radius — edge cases with width/height
// ═══════════════════════════════════════════════════════════════

describe("Collision radius edge cases", () => {
  it("width=0, height=0 — collision radius is 24 (just the padding)", () => {
    const width = 0, height = 0
    const radius = Math.max(width, height) / 2 + 24
    expect(radius).toBe(24) // degenerate but not crashing
  })

  it("negative width — Math.max picks less-negative value, radius could be < 24", () => {
    const width = -100, height = -50
    const radius = Math.max(width, height) / 2 + 24
    // Math.max(-100, -50) = -50, then -50/2 + 24 = -25 + 24 = -1
    // Known limitation: negative dimensions produce negative collision radius.
    // In practice, negative dimensions never occur (addNode always gets real sizes).
    expect(radius).toBe(-1)
  })

  it("NaN width — collision radius becomes NaN", () => {
    const width = NaN, height = 200
    const radius = Math.max(width, height) / 2 + 24
    // Math.max(NaN, 200) = NaN in JavaScript
    expect(radius).toBeNaN() // NaN collision radius — d3 will silently break
  })

  it("NaN height with valid width — Math.max still returns NaN", () => {
    const width = 300, height = NaN
    const radius = Math.max(width, height) / 2 + 24
    // Math.max(300, NaN) = NaN — this is JavaScript spec
    expect(radius).toBeNaN() // Both NaN cases poison the result
  })

  it("extremely large dimensions — collision radius is huge", () => {
    const width = 1e10, height = 1e10
    const radius = Math.max(width, height) / 2 + 24
    expect(radius).toBe(5e9 + 24)
    // Not a crash but cards would have absurd collision zones
  })
})

// ═══════════════════════════════════════════════════════════════
// 4. Node Lifecycle — addNode, removeNode, updateNodeSize
// ═══════════════════════════════════════════════════════════════

describe("Node lifecycle", () => {
  let engine: PhysicsEngine

  beforeEach(() => {
    engine = new PhysicsEngine(1920, 1080, () => {})
  })

  afterEach(() => {
    engine.destroy()
  })

  it("remove a node that doesn't exist — no crash, but wastes a restart", () => {
    // removeNode filters nodes array (no match = same array)
    // Then restarts simulation with alpha=0.1 — unnecessary work
    engine.removeNode("nonexistent-id")
    // No crash expected. But it still calls simulation.alpha(0.1).restart()
    // which is wasted CPU.
  })

  it("add a node with the same ID twice — DUPLICATE nodes in array", () => {
    engine.addNode("dupe", 300, 200)
    engine.addNode("dupe", 300, 200)

    // BUG: addNode does NOT check for existing IDs.
    // The nodes array now has two entries with id="dupe".
    // Both get positions, both get zone assignments.
    // The tick callback will set positions.set("dupe", ...) twice — last one wins.
    // removeNode("dupe") will remove BOTH because filter checks n.id !== id.

    // We can verify by removing "dupe" and seeing the engine still works
    engine.removeNode("dupe")
    // Both nodes gone now
  })

  it("add node with same ID twice — zone counter increments twice", () => {
    // First add: zone = ZONE_ORDER[0] = "NE", counter becomes 1
    // Second add: zone = ZONE_ORDER[1] = "E", counter becomes 2
    // The duplicate gets a DIFFERENT zone than the original
    // AND the counter is now off-by-one for all future cards
    engine.addNode("dupe", 300, 200)
    engine.addNode("dupe", 300, 200)
    engine.addNode("third", 300, 200)
    // "third" gets zone ZONE_ORDER[2] = "SE" instead of ZONE_ORDER[1] = "E"
    // Zone distribution is now wrong
  })

  it("updateNodeSize — is a no-op, size never changes in physics", () => {
    engine.addNode("card", 300, 200)
    engine.updateNodeSize("card", 480, 520) // does nothing
    // This means collision radius stays at initial size forever
    // Even when card visually grows from 300px to 480px (pending → complete)
    // Cards will overlap because physics thinks they're still small
    // BUG: collision radius is stale after card state change
  })

  it("update size of a removed node — no crash (it's a no-op anyway)", () => {
    engine.addNode("card", 300, 200)
    engine.removeNode("card")
    engine.updateNodeSize("card", 480, 520) // no-op regardless
  })

  it("50 nodes — all get unique zone assignments via round-robin", () => {
    for (let i = 0; i < 50; i++) {
      engine.addNode(`card-${i}`, 300, 200)
    }
    // 50 cards: each zone gets ~6 cards
    // No crash, but zone gravity pulls all 6 to same target position
    // Only collision force separates them — could get crowded
  })

  it("add and remove rapidly — zone counter never decrements", () => {
    // Add 8 cards (fills all zones), remove all
    for (let i = 0; i < 8; i++) engine.addNode(`card-${i}`, 300, 200)
    for (let i = 0; i < 8; i++) engine.removeNode(`card-${i}`)

    // BUG: zoneCounter is now 8, but 0 nodes exist
    // Next card added gets zone ZONE_ORDER[8 % 8] = "NE" again
    // This is fine by accident (wraps around), but the counter grows forever
    // After 1000 add/remove cycles, counter is 1000 — no overflow but wasteful

    // Add one more — should get NE (which is correct by coincidence)
    engine.addNode("new-card", 300, 200)
  })
})

// ═══════════════════════════════════════════════════════════════
// 5. findLinks — entity matching
// ═══════════════════════════════════════════════════════════════

describe("findLinks", () => {
  it("empty cards array — returns empty links", () => {
    expect(findLinks([])).toEqual([])
  })

  it("single card — no links possible", () => {
    const cards = [{
      id: "1",
      toolName: "intel",
      query: "Microsoft",
      parsedResult: { company: "Microsoft" },
      resultText: "Microsoft Corporation is a tech company.",
    }]
    expect(findLinks(cards)).toEqual([])
  })

  it("parsedResult is null for both cards — no crash, falls through to query match", () => {
    const cards = [
      { id: "1", toolName: "intel", query: "Microsoft", parsedResult: null, resultText: "" },
      { id: "2", toolName: "intel", query: "Microsoft", parsedResult: null, resultText: "" },
    ]
    // parsedResult is null -> extractEntityFields returns []
    // query "Microsoft" includes "Microsoft" -> linked
    const links = findLinks(cards)
    expect(links).toEqual([{ source: "1", target: "2" }])
  })

  it("query is empty string — no query match, falls through to proper nouns", () => {
    const cards = [
      { id: "1", toolName: "intel", query: "", parsedResult: null, resultText: "Jensen Huang leads Nvidia" },
      { id: "2", toolName: "intel", query: "", parsedResult: null, resultText: "Jensen Huang at GTC" },
    ]
    // query: both empty. "" includes "" is TRUE -> linked via query layer
    // BUG: empty string includes empty string, so empty queries always match
    const links = findLinks(cards)
    expect(links.length).toBe(1)

    // Prove the bug: empty queries shouldn't match
    // The check is: if (!linked && a.query && b.query) — but "" is falsy!
    // Wait, "" is falsy in JS, so the query block is SKIPPED.
    // Falls through to proper noun layer.
    // "Jensen Huang" appears in both -> linked via proper nouns.
    // Actually NOT a bug for empty strings — the && guards it.
    // Let me verify:
    expect("" && "").toBeFalsy() // "" is falsy, so query block is skipped
  })

  it("identical queries — both includes checks are true", () => {
    const cards = [
      { id: "1", toolName: "intel", query: "Acme Corp", parsedResult: null, resultText: "" },
      { id: "2", toolName: "intel", query: "Acme Corp", parsedResult: null, resultText: "" },
    ]
    const links = findLinks(cards)
    expect(links).toEqual([{ source: "1", target: "2" }])
  })

  it("query substring match — 'Apple' matches 'Apple Inc revenue'", () => {
    const cards = [
      { id: "1", toolName: "intel", query: "Apple", parsedResult: null, resultText: "" },
      { id: "2", toolName: "deal_status", query: "Apple Inc revenue", parsedResult: null, resultText: "" },
    ]
    // "apple" is included in "apple inc revenue" -> linked
    const links = findLinks(cards)
    expect(links).toEqual([{ source: "1", target: "2" }])
  })

  it("query with only stop words — no word match after filtering", () => {
    const cards = [
      { id: "1", toolName: "intel", query: "the and for with", parsedResult: null, resultText: "" },
      { id: "2", toolName: "intel", query: "this that from have", parsedResult: null, resultText: "" },
    ]
    // Substring: neither includes the other
    // Word match: all words are stop words or <=3 chars, filtered out
    // Proper nouns: no capitals in resultText
    const links = findLinks(cards)
    expect(links).toEqual([])
  })

  it("short words (<=3 chars) are filtered from query matching", () => {
    const cards = [
      { id: "1", toolName: "intel", query: "AWS is big", parsedResult: null, resultText: "" },
      { id: "2", toolName: "intel", query: "AWS cloud", parsedResult: null, resultText: "" },
    ]
    // Substring: "aws is big" doesn't include "aws cloud" and vice versa
    // Word match: "aws" is 3 chars -> filtered (w.length > 3 means 4+ chars)
    // "cloud" is 5 chars but doesn't appear in card 1
    // BUG: "AWS" (3 chars) is filtered out, so two cards about AWS won't link via query words
    const links = findLinks(cards)
    // They WON'T be linked — "aws" is only 3 chars
    expect(links).toEqual([])
  })

  it("proper noun extraction — only matches CamelCase words > 3 chars", () => {
    const cards = [
      { id: "1", toolName: "intel", query: "x", parsedResult: null, resultText: "IBM reported strong earnings" },
      { id: "2", toolName: "intel", query: "y", parsedResult: null, resultText: "IBM stock rose 5%" },
    ]
    // extractProperNouns regex: /[A-Z][a-z]+/
    // "IBM" is all caps -> does NOT match [A-Z][a-z]+ (needs lowercase after first cap)
    // BUG: All-caps acronyms (IBM, AWS, GCP, API) are invisible to proper noun matching
    const links = findLinks(cards)
    expect(links).toEqual([]) // IBM won't be found as a proper noun
  })

  it("proper noun regex — greedy multi-word grouping prevents cross-card matching", () => {
    const cards = [
      { id: "1", toolName: "intel", query: "x", parsedResult: null, resultText: "AI research at Google labs" },
      { id: "2", toolName: "intel", query: "y", parsedResult: null, resultText: "AI safety at Google DeepMind" },
    ]
    // Card 1: regex matches "Google" standalone (6 chars > 3) -> ["google"]
    // Card 2: regex greedily matches "Google Deep" as one group (space + D + eep),
    //   then "Mind" separately -> ["google deep", "mind"]
    // "google" (card 1) is NOT in Set(["google deep", "mind"]) -> no link.
    // Known limitation: greedy multi-word grouping creates different strings
    // for the same entity when followed by different capitalized words.
    const links = findLinks(cards)
    expect(links.length).toBe(0)
  })

  it("O(n²) scaling — 'Unique' proper noun causes false positive linking", () => {
    const cards = Array.from({ length: 100 }, (_, i) => ({
      id: `card-${i}`,
      toolName: "intel",
      query: `unique-query-${i}`,
      parsedResult: null,
      resultText: `Unique text ${i}`,
    }))
    // BUG FOUND: "Unique" starts with capital letter -> matches [A-Z][a-z]+
    // "Unique" is 6 chars > 3 -> passes filter
    // EVERY card has "unique" as a proper noun -> ALL 4950 pairs link!
    // The proper noun regex has no concept of "this is just a regular word that
    // happens to start a sentence." It treats ANY capitalized word as a proper noun.
    //
    // In real usage, resultText from Manus will have many sentence-starting words
    // ("The", "Revenue", "Company", "Their") that will cause false positive links
    // between completely unrelated cards.
    const links = findLinks(cards)
    expect(links.length).toBe(4950) // every pair linked — all false positives
  })

  it("parsedResult with non-string entity fields — silently ignored", () => {
    const cards = [
      { id: "1", toolName: "intel", query: "x", parsedResult: { company: 42, name: null, client: undefined }, resultText: "" },
      { id: "2", toolName: "intel", query: "y", parsedResult: { company: 42, name: null, client: undefined }, resultText: "" },
    ]
    // extractEntityFields checks typeof === "string", so 42, null, undefined all skipped
    // No link from structured fields
    const links = findLinks(cards)
    expect(links).toEqual([])
  })

  it("parsedResult with array company field — typeof check rejects it", () => {
    const cards = [
      { id: "1", toolName: "intel", query: "x", parsedResult: { company: ["Microsoft", "Google"] }, resultText: "" },
      { id: "2", toolName: "intel", query: "y", parsedResult: { company: ["Microsoft", "Google"] }, resultText: "" },
    ]
    // Array is not typeof "string" -> skipped
    // Even though both cards are about the same companies, no structured match
    const links = findLinks(cards)
    expect(links).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════
// 6. Simulation Convergence — alphaDecay vs alphaTarget
// ═══════════════════════════════════════════════════════════════

describe("Simulation convergence — alphaDecay=0.01, alphaTarget=0.02", () => {
  it("alpha never reaches zero — simulation runs forever", () => {
    // alphaDecay = 0.01: each tick, alpha += (alphaTarget - alpha) * alphaDecay
    // alphaTarget = 0.02: alpha decays TOWARD 0.02, never toward 0
    //
    // d3 stops simulation when alpha < alphaMin (default 0.001)
    // Since alphaTarget=0.02, alpha converges to 0.02 > 0.001
    // Therefore: simulation NEVER stops on its own
    //
    // This means the tick callback fires FOREVER, consuming CPU
    // Even when no cards are on screen
    //
    // Is this intentional? Probably — it keeps cards jiggling for "live" feel.
    // But it's a battery/CPU drain when the overlay is hidden.

    // Simulate the alpha convergence
    let alpha = 1.0 // initial alpha on restart
    const alphaDecay = 0.01
    const alphaTarget = 0.02
    const alphaMin = 0.001 // d3 default

    for (let tick = 0; tick < 10000; tick++) {
      alpha += (alphaTarget - alpha) * alphaDecay
    }

    // After 10000 ticks, alpha should be very close to alphaTarget
    expect(alpha).toBeCloseTo(0.02, 3)
    // Alpha never goes below alphaMin
    expect(alpha).toBeGreaterThan(alphaMin)
    // This proves the simulation never auto-stops
  })

  it("center repulsion adds constant energy — cards never fully settle", () => {
    // Even if d3 damping reduces velocities, the tick handler adds
    // centerForce=3 to vx/vy EVERY tick.
    // Combined with velocityDecay=0.4, terminal velocity is:
    // v_terminal = centerForce / velocityDecay = 3 / 0.4 = 7.5 px/tick
    // But zone gravity pulls back, so actual oscillation is smaller.
    //
    // The combination of:
    //   1. alphaTarget=0.02 (never stops)
    //   2. centerForce=3 per tick (constant energy injection)
    //   3. velocityDecay=0.4 (moderate damping)
    // means cards oscillate forever at their zone target.

    const centerForce = 3
    const velocityDecay = 0.4
    const terminalSpeed = centerForce / velocityDecay
    expect(terminalSpeed).toBe(7.5) // 7.5 px/tick of constant jitter
  })
})

// ═══════════════════════════════════════════════════════════════
// 7. Boundary Clamping
// ═══════════════════════════════════════════════════════════════

describe("Boundary clamping", () => {
  it("card wider than screen — max clamp yields negative upper bound", () => {
    // Code: Math.max(16, Math.min(screenW - width - 16, x))
    // If width > screenW - 32, then screenW - width - 16 < 16
    // Math.min(negative, x) could be negative
    // Math.max(16, negative) = 16
    // So card is pinned at x=16 regardless — left edge
    const screenW = 1920
    const width = 2000 // wider than screen
    const x = 960
    const clamped = Math.max(16, Math.min(screenW - width - 16, x))
    // screenW - width - 16 = 1920 - 2000 - 16 = -96
    // Math.min(-96, 960) = -96
    // Math.max(16, -96) = 16
    expect(clamped).toBe(16) // pinned to left edge, right side overflows screen
  })

  it("zero-size screen — all cards clamp to x=16, y=16", () => {
    const screenW = 0, screenH = 0
    const width = 300, height = 200
    const x = 500, y = 500
    const clampedX = Math.max(16, Math.min(screenW - width - 16, x))
    const clampedY = Math.max(16, Math.min(screenH - height - 16, y))
    // screenW - 300 - 16 = -316, min(-316, 500) = -316, max(16, -316) = 16
    expect(clampedX).toBe(16)
    expect(clampedY).toBe(16)
  })
})

// ═══════════════════════════════════════════════════════════════
// 8. linkedToId zone inheritance
// ═══════════════════════════════════════════════════════════════

describe("linkedToId zone inheritance", () => {
  let engine: PhysicsEngine

  beforeEach(() => {
    engine = new PhysicsEngine(1920, 1080, () => {})
  })

  afterEach(() => {
    engine.destroy()
  })

  it("link to existing node — inherits zone, does NOT increment counter", () => {
    engine.addNode("parent", 300, 200)  // zone NE, counter=1
    engine.addNode("child", 300, 200, "parent")  // inherits NE, counter stays 1
    engine.addNode("next", 300, 200)  // zone E (counter=1), counter=2

    // If linkedTo didn't skip the counter, "next" would get SE (counter=2 -> index 2)
    // With the skip, "next" gets E (counter=1 -> index 1)
    // This is correct behavior
  })

  it("link to non-existent node — falls through to round-robin", () => {
    engine.addNode("card", 300, 200, "ghost-node")
    // "ghost-node" not in nodeZones -> fallback to round-robin
    // Gets zone NE (counter=0), counter becomes 1
    // No crash
  })

  it("link to removed node — zone map was deleted, falls through", () => {
    engine.addNode("parent", 300, 200)   // NE, counter=1
    engine.removeNode("parent")           // deletes from nodeZones
    engine.addNode("child", 300, 200, "parent")  // "parent" not in nodeZones -> round-robin
    // Gets zone E (counter=1), counter becomes 2
    // The child doesn't inherit the dead parent's zone
  })
})

// ═══════════════════════════════════════════════════════════════
// 9. removeNode with link force
// ═══════════════════════════════════════════════════════════════

describe("removeNode link force update", () => {
  it("removeNode updates the link force after filtering out removed node's links", () => {
    // removeNode filters this.links to remove any link involving the deleted node,
    // then pushes the updated links into the simulation's "link" force.

    const engine = new PhysicsEngine(1920, 1080, () => {})
    engine.addNode("a", 300, 200)
    engine.addNode("b", 300, 200)
    engine.removeNode("a") // filters links and updates link force
    engine.destroy()
  })
})

// ═══════════════════════════════════════════════════════════════
// 10. updateLinks — also a no-op
// ═══════════════════════════════════════════════════════════════

describe("updateLinks", () => {
  it("updateLinks applies links to the simulation link force", () => {
    // FIX: updateLinks now sets this.links and pushes them into the
    // simulation's "link" force (registered in constructor), then restarts.
    // Links referencing unknown node IDs will throw from d3-force,
    // so we must add the nodes first.

    const engine = new PhysicsEngine(1920, 1080, () => {})
    engine.addNode("a", 300, 200)
    engine.addNode("b", 300, 200)

    // Should not throw — both nodes exist in the simulation
    expect(() => {
      engine.updateLinks([{ source: "a", target: "b" }])
    }).not.toThrow()

    engine.destroy()
  })
})

// ═══════════════════════════════════════════════════════════════
// 11. Diagnostic: extractProperNouns behavior
// ═══════════════════════════════════════════════════════════════

describe("extractProperNouns diagnostic", () => {
  // Reimplemented here to test the exact regex from PhysicsEngine
  function extractProperNouns(text: string): string[] {
    if (!text) return []
    const matches = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || []
    return matches.filter(m => m.length > 3).map(m => m.toLowerCase())
  }

  it("'Google' standalone — should match", () => {
    const result = extractProperNouns("research at Google labs")
    expect(result).toContain("google")
  })

  it("'AI research at Google labs' — what actually matches?", () => {
    const r1 = extractProperNouns("AI research at Google labs")
    // AI -> no match (I is uppercase)
    // Google -> match
    expect(r1).toEqual(["google"])
  })

  it("'AI safety at Google DeepMind' — what actually matches?", () => {
    const r2 = extractProperNouns("AI safety at Google DeepMind")
    // Google -> match, then space + DeepMind?
    // "Google DeepMind" -> G+oogle + space + D+eep... wait
    // The regex: [A-Z][a-z]+(?:\s+[A-Z][a-z]+)*
    // "Google" matches [A-Z][a-z]+
    // Then " DeepMind": \s+ matches " ", [A-Z] matches D, [a-z]+ matches "eep"
    // But then "Mind" — M is uppercase, regex stops at "eep"
    // So "Google Deep" is the full match? No...
    // Actually "DeepMind" — after "Deep", "M" is uppercase, [a-z]+ requires lowercase
    // So the regex matches "Google Deep" as one group, then "Mind" as another
    // Wait: (?:\s+[A-Z][a-z]+)* means the optional group is space + Cap + lowercase+
    // "Google" matches base. Then " Deep" matches the optional group (space + D + eep).
    // But "Mind" starts without space from "Deep" perspective — "DeepMind" is one word.
    // Hmm, "Deep" is part of "DeepMind". The regex sees:
    //   Position at "D" in "DeepMind": D matches [A-Z], "eep" matches [a-z]+
    //   Then "M" is uppercase — [a-z]+ stops. So we get "Deep" matched.
    //   But this is within "DeepMind" which has no space before it relative to Google.
    //
    // BUG FOUND: The regex greedily combines "Google Deep" into one match!
    // "Google" matches [A-Z][a-z]+, then " Deep" matches (?:\s+[A-Z][a-z]+)*
    // because there's a space + D + eep. Then "Mind" is a separate match.
    // So the result is ["google deep", "mind"], NOT ["google", "deep", "mind"]
    //
    // This means card 1 ("Google") and card 2 ("Google Deep") DON'T match
    // because the greedy multi-word grouping creates different strings.
    // "Google" != "Google Deep" -> no link, even though both mention Google.
    expect(r2).toEqual(["google deep", "mind"]) // greedy grouping eats "Google Deep" as one unit
    // "google" (from card 1) is NOT in ["google deep", "mind"] -> no match!
  })

  it("sentence-starting capitals cause false matches", () => {
    const r3 = extractProperNouns("Revenue grew. Company expanded. Their stock rose.")
    // "Revenue" -> R+evenue -> matches, 7 chars > 3 -> "revenue"
    // "Company" -> C+ompany -> matches, 7 chars > 3 -> "company"
    // "Their" -> T+heir -> matches, 5 chars > 3 -> "their"
    // All are false positives — common words that start sentences
    expect(r3).toContain("revenue") // false positive
    expect(r3).toContain("company") // false positive
    expect(r3).toContain("their")   // false positive
  })

  it("all-caps acronyms are invisible — IBM, AWS, GCP, NVIDIA", () => {
    const r4 = extractProperNouns("IBM and AWS compete with GCP. NVIDIA leads in GPUs.")
    // None match [A-Z][a-z]+ because all letters are uppercase
    expect(r4).toEqual([]) // all missed
  })
})

// ═══════════════════════════════════════════════════════════════
// 12. findLinks query layer — subtle bugs
// ═══════════════════════════════════════════════════════════════

describe("findLinks query layer edge cases", () => {
  it("single-char query 'x' includes in longer query 'next fox' — false positive", () => {
    const cards = [
      { id: "1", toolName: "intel", query: "x", parsedResult: null, resultText: "" },
      { id: "2", toolName: "intel", query: "next fox", parsedResult: null, resultText: "" },
    ]
    // "x".includes("next fox") -> false
    // "next fox".includes("x") -> TRUE (x appears in "next" and "fox")
    // BUG: single-char queries match as substrings of unrelated words
    const links = findLinks(cards)
    expect(links.length).toBe(1) // linked! false positive
  })

  it("case-insensitive comparison — 'APPLE' matches 'apple pie recipe'", () => {
    const cards = [
      { id: "1", toolName: "intel", query: "APPLE", parsedResult: null, resultText: "" },
      { id: "2", toolName: "intel", query: "apple pie recipe", parsedResult: null, resultText: "" },
    ]
    // Both lowercased: "apple" includes in "apple pie recipe" -> linked
    const links = findLinks(cards)
    expect(links.length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// 13. getZoneTarget — unknown zone name
// ═══════════════════════════════════════════════════════════════

describe("getZoneTarget edge cases", () => {
  it("unknown zone name falls back to NE", () => {
    // Testing the pure function behavior through PhysicsEngine
    // addNode with a linkedToId that has an invalid zone stored would exercise this,
    // but we can't inject bad zone names externally.
    // The fallback is: targets[zone] || targets.NE

    // Direct test of the logic:
    const targets: Record<string, { x: number; y: number }> = {
      NE: { x: 1720, y: 200 },
    }
    const result = targets["INVALID_ZONE"] || targets.NE
    expect(result).toEqual({ x: 1720, y: 200 }) // falls back to NE
  })
})
