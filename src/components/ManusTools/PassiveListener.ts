// src/components/ManusTools/PassiveListener.ts

import { useEffect, useRef, useCallback } from "react"

interface PassiveListenerOptions {
  micChunksRef: React.MutableRefObject<Blob[]>
  onTrigger: (entity: string) => void
  onTranscript?: (text: string) => void  // surfaces live transcript text to UI
  autoCardCount: number
  enabled: boolean
}

const ENTITY_COOLDOWN = 60000    // 60s per entity
const GLOBAL_COOLDOWN = 10000    // 10s between any auto-trigger
const MAX_AUTO_CARDS = 3
const CHECK_INTERVAL = 3000      // check every 3s

// Phrases that match the capitalized multi-word regex but aren't real entities
const STOPWORDS = new Set([
  // Greetings & pleasantries
  "good morning", "good afternoon", "good evening", "good night",
  "thank you", "thanks so much", "nice to meet", "pleased to meet",
  "happy birthday", "happy holidays", "merry christmas", "happy new year",
  // Time & calendar
  "monday morning", "tuesday morning", "wednesday morning", "thursday morning",
  "friday morning", "saturday morning", "sunday morning",
  "last week", "next week", "last month", "next month", "last year", "next year",
  "last quarter", "next quarter", "first quarter", "second quarter", "third quarter", "fourth quarter",
  // Geography (not companies)
  "new york", "new jersey", "new zealand", "new delhi", "new england",
  "los angeles", "san francisco", "san diego", "san jose", "san antonio",
  "las vegas", "el paso", "hong kong", "south korea", "north korea",
  "south africa", "north america", "south america", "latin america",
  "united states", "united kingdom", "united nations", "united arab",
  "middle east", "southeast asia", "east coast", "west coast",
  "silicon valley", "wall street", "bay area",
  // Common business phrases
  "year over year", "month over month", "quarter over quarter",
  "let me know", "looking forward", "sounds good", "sounds great",
  "follow up", "circle back", "touch base", "heads up",
  "make sure", "moving forward", "going forward", "bottom line",
  "top line", "next steps", "action items", "key takeaways",
  "right now", "of course", "no problem", "all right",
  "by the way", "on the other hand", "at the end",
  "take care", "well done", "great job", "nice work",
])

// Common short all-caps words that are NOT company/org acronyms
const ACRONYM_STOPWORDS = new Set([
  "a", "i", "an", "am", "as", "at", "be", "by", "do", "go", "ha", "he",
  "hi", "if", "in", "is", "it", "me", "my", "no", "of", "oh", "ok", "on",
  "or", "so", "to", "up", "us", "we",
  "hr", "pm", "am", "tv", "vs", "mr", "ms", "dr", "jr", "sr",
  "the", "and", "but", "for", "not", "you", "all", "can", "had", "her",
  "was", "one", "our", "out", "are", "has", "his", "how", "its", "may",
  "new", "now", "old", "see", "way", "who", "did", "get", "got", "let",
  "say", "she", "too", "use", "yes", "yet",
  "also", "just", "than", "them", "been", "from", "have", "here", "into",
  "like", "make", "many", "some", "that", "them", "then", "they", "this",
  "very", "what", "when", "will", "with", "your", "each", "more", "much",
  "does", "done", "down", "even", "good", "well", "know",
  "okay", "yeah", "sure", "yep", "nah", "wow", "hey", "huh",
  "q1", "q2", "q3", "q4", "fy", "yoy", "mom", "qoq",
  "ceo", "cfo", "cto", "coo", "vp", "svp", "evp", "md",
  "roi", "kpi", "eod", "eow", "eta", "fyi", "asap", "rsvp",
  "usa", "nyc", "uk", "eu", "usd", "gdp", "api", "url", "pdf", "csv",
])

export function usePassiveListener({ micChunksRef, onTrigger, onTranscript, autoCardCount, enabled }: PassiveListenerOptions) {
  const cooldowns = useRef<Map<string, number>>(new Map())
  const lastGlobalTrigger = useRef(0)

  const extractEntities = useCallback((text: string): string[] => {
    const entities: string[] = []

    // Capitalized multi-word: "Patrick Collison", "Goldman Sachs", "Series B"
    const multiWord = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) || []
    entities.push(...multiWord)

    // Company suffixes: "Acme Inc", "DeepMind AI"
    const companySuffix = text.match(/\b\w+\s+(?:Inc|Corp|Ltd|AI|Labs|Tech)\b/gi) || []
    entities.push(...companySuffix)

    // Acronyms: "IBM", "AWS", "NVIDIA" — 2-4 uppercase letters not in stopword list
    const acronyms = text.match(/\b[A-Z]{2,4}\b/g) || []
    for (const acr of acronyms) {
      if (!ACRONYM_STOPWORDS.has(acr.toLowerCase())) {
        entities.push(acr)
      }
    }

    // Deduplicate, then filter out stopword phrases
    return [...new Set(entities.map(e => e.trim()))].filter(
      e => !STOPWORDS.has(e.toLowerCase())
    )
  }, [])

  const checkCooldown = useCallback((entity: string): boolean => {
    const now = Date.now()
    const key = entity.toLowerCase()

    // Global cooldown
    if (now - lastGlobalTrigger.current < GLOBAL_COOLDOWN) return false

    // Max visible auto-cards
    if (autoCardCount >= MAX_AUTO_CARDS) return false

    // Per-entity cooldown
    const lastSeen = cooldowns.current.get(key)
    if (lastSeen && now - lastSeen < ENTITY_COOLDOWN) return false

    return true
  }, [autoCardCount])

  useEffect(() => {
    if (!enabled) return

    const interval = setInterval(async () => {
      // Need at least 12 chunks (~3s of audio)
      if (micChunksRef.current.length < 12) return

      // Grab last 12 chunks (most recent 3s)
      const recentChunks = micChunksRef.current.slice(-12)

      try {
        const blob = new Blob(recentChunks, { type: "audio/webm" })
        const arrayBuffer = await blob.arrayBuffer()
        const transcript = await (window as any).electronAPI.transcribeAudioBuffer(arrayBuffer, "audio/webm")

        if (!transcript || transcript.length < 3) return

        // Surface transcript to UI
        if (onTranscript) onTranscript(transcript)

        const entities = extractEntities(transcript)

        for (const entity of entities) {
          if (entity.length < 4) continue  // skip short matches
          if (checkCooldown(entity)) {
            const now = Date.now()
            cooldowns.current.set(entity.toLowerCase(), now)
            lastGlobalTrigger.current = now
            console.log(`[PassiveListener] Auto-triggering intel for: "${entity}"`)
            onTrigger(entity)
            break  // only one trigger per check cycle
          }
        }
      } catch (err) {
        // Transcription failed — silently skip this cycle
      }
    }, CHECK_INTERVAL)

    return () => clearInterval(interval)
  }, [enabled, micChunksRef, onTrigger, extractEntities, checkCooldown])
}
