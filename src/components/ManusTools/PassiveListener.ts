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

    // Deduplicate
    return [...new Set(entities.map(e => e.trim()))]
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
