/**
 * PassiveListener logic tests — entity extraction + cooldown.
 * Extracted from the React hook for pure unit testing.
 */
import { describe, it, expect } from "vitest"

// ── Entity extraction (copied from PassiveListener.ts for testing) ──

function extractEntities(text: string): string[] {
  const entities: string[] = []

  // Capitalized multi-word: "Patrick Collison", "Goldman Sachs"
  const multiWord = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) || []
  entities.push(...multiWord)

  // Company suffixes: "Acme Inc", "DeepMind AI"
  const companySuffix = text.match(/\b\w+\s+(?:Inc|Corp|Ltd|AI|Labs|Tech)\b/gi) || []
  entities.push(...companySuffix)

  // Deduplicate
  return [...new Set(entities.map(e => e.trim()))]
}

describe("extractEntities", () => {
  it("extracts capitalized multi-word names", () => {
    const result = extractEntities("I spoke with Patrick Collison about Stripe.")
    expect(result).toContain("Patrick Collison")
  })

  it("extracts company names with suffixes", () => {
    const result = extractEntities("We should look at DeepMind AI and Acme Corp for the deal.")
    expect(result).toContain("DeepMind AI")
    expect(result).toContain("Acme Corp")
  })

  it("handles multiple entities in one transcript", () => {
    const result = extractEntities("Jensen Huang from Nvidia met with Sam Altman from OpenAI Labs.")
    expect(result).toContain("Jensen Huang")
    expect(result).toContain("Sam Altman")
    expect(result).toContain("OpenAI Labs")
  })

  it("deduplicates repeated mentions", () => {
    const result = extractEntities("Stripe Stripe Patrick Collison talked to Patrick Collison")
    const patrickCount = result.filter(e => e === "Patrick Collison").length
    expect(patrickCount).toBe(1)
  })

  it("returns empty array for lowercase text", () => {
    const result = extractEntities("we talked about pricing and the deal pipeline")
    expect(result).toEqual([])
  })

  it("skips single capitalized words (not multi-word)", () => {
    // "Stripe" alone won't match multi-word pattern, only suffix pattern
    const result = extractEntities("Stripe is doing well")
    // "Stripe" without suffix shouldn't match either pattern
    expect(result).toEqual([])
  })

  it("does NOT extract single-letter capitalized words like 'Series B'", () => {
    // Known limitation: regex requires [A-Z][a-z]+ so "B" alone doesn't match
    const result = extractEntities("They just closed Series B funding.")
    expect(result).not.toContain("Series B")
  })
})

// ── Cooldown logic (extracted from PassiveListener.ts) ──

const ENTITY_COOLDOWN = 60000
const GLOBAL_COOLDOWN = 10000
const MAX_AUTO_CARDS = 3

function checkCooldown(
  entity: string,
  cooldowns: Map<string, number>,
  lastGlobalTrigger: number,
  autoCardCount: number,
  now: number
): boolean {
  const key = entity.toLowerCase()
  if (now - lastGlobalTrigger < GLOBAL_COOLDOWN) return false
  if (autoCardCount >= MAX_AUTO_CARDS) return false
  const lastSeen = cooldowns.get(key)
  if (lastSeen && now - lastSeen < ENTITY_COOLDOWN) return false
  return true
}

describe("checkCooldown", () => {
  it("allows first entity with no cooldowns", () => {
    expect(checkCooldown("Stripe", new Map(), 0, 0, Date.now())).toBe(true)
  })

  it("blocks during global cooldown", () => {
    const now = Date.now()
    expect(checkCooldown("Stripe", new Map(), now - 5000, 0, now)).toBe(false) // 5s < 10s
  })

  it("allows after global cooldown expires", () => {
    const now = Date.now()
    expect(checkCooldown("Stripe", new Map(), now - 15000, 0, now)).toBe(true) // 15s > 10s
  })

  it("blocks when max auto-cards reached", () => {
    expect(checkCooldown("Stripe", new Map(), 0, 3, Date.now())).toBe(false)
  })

  it("blocks recently-seen entity", () => {
    const now = Date.now()
    const cooldowns = new Map([["stripe", now - 30000]]) // seen 30s ago < 60s cooldown
    expect(checkCooldown("Stripe", cooldowns, 0, 0, now)).toBe(false)
  })

  it("allows entity after cooldown expires", () => {
    const now = Date.now()
    const cooldowns = new Map([["stripe", now - 70000]]) // seen 70s ago > 60s cooldown
    expect(checkCooldown("Stripe", cooldowns, 0, 0, now)).toBe(true)
  })

  it("is case-insensitive", () => {
    const now = Date.now()
    const cooldowns = new Map([["stripe", now - 30000]])
    expect(checkCooldown("STRIPE", cooldowns, 0, 0, now)).toBe(false)
  })
})
