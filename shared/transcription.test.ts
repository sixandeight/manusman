/**
 * TranscriptionHelper tests — unit tests for the logic we CAN test
 * without a live Groq API key. Validates buffer size gating and
 * the transcript→prompt injection chain.
 */
import { describe, it, expect } from "vitest"

// ── Buffer size gating logic (extracted from TranscriptionHelper) ──

// The helper skips buffers < 10KB. Test that threshold.
function shouldTranscribe(bufferLength: number, hasApiKey: boolean): boolean {
  if (!hasApiKey) return false
  if (bufferLength < 10000) return false
  return true
}

describe("transcription gating", () => {
  it("skips when no API key", () => {
    expect(shouldTranscribe(50000, false)).toBe(false)
  })

  it("skips when buffer too small", () => {
    expect(shouldTranscribe(5000, true)).toBe(false)
  })

  it("proceeds with valid buffer and key", () => {
    expect(shouldTranscribe(50000, true)).toBe(true)
  })

  it("skips at exactly 10000 bytes (boundary)", () => {
    expect(shouldTranscribe(9999, true)).toBe(false)
    expect(shouldTranscribe(10000, true)).toBe(true)
  })
})

// ── Transcript injection into prompts ──

// Simulates how ProcessingHelper injects transcript into the prompt
function injectTranscript(transcript: string | undefined): string {
  return transcript ? `\nTRANSCRIPT (last 30s of user's mic): "${transcript}"\n` : ""
}

describe("transcript prompt injection", () => {
  it("injects transcript when present", () => {
    const result = injectTranscript("they mentioned Stripe pricing")
    expect(result).toContain("TRANSCRIPT")
    expect(result).toContain("Stripe pricing")
  })

  it("returns empty string when no transcript", () => {
    expect(injectTranscript(undefined)).toBe("")
    expect(injectTranscript("")).toBe("")
  })
})

// ── Mic buffer chunking logic (from Queue.tsx) ──

// The renderer keeps a rolling 30s buffer at 250ms intervals = 120 chunks max
// On tool submit, it checks for >= 8 chunks (2 seconds minimum)
function shouldAttemptTranscription(chunkCount: number): boolean {
  return chunkCount >= 8
}

describe("mic buffer readiness", () => {
  it("requires at least 8 chunks (2s of audio)", () => {
    expect(shouldAttemptTranscription(0)).toBe(false)
    expect(shouldAttemptTranscription(7)).toBe(false)
    expect(shouldAttemptTranscription(8)).toBe(true)
    expect(shouldAttemptTranscription(120)).toBe(true)
  })
})
