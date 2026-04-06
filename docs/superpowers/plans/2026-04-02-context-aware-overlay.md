# Context-Aware Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add always-on mic transcription (Groq Whisper), physics-based card clustering (d3-force), and auto-fade card lifecycle (framer-motion) to the Manusman overlay.

**Architecture:** Three independent modules plugging into the existing RadialLayout system. Module A (TranscriptionHelper) captures mic audio and transcribes on-demand via Groq. Module B (PhysicsEngine) replaces static grid placement with force-directed simulation. Module C modifies RadialLayout to add spring animations and auto-fade-to-delete lifecycle.

**Tech Stack:** groq-sdk, d3-force, framer-motion, Web Audio API (getUserMedia)

---

## File Structure

```
NEW FILES:
  electron/TranscriptionHelper.ts    — Groq Whisper client, IPC handler
  src/components/ManusTools/PhysicsEngine.ts — d3-force simulation, entity linker, zone gravity

MODIFIED FILES:
  electron/ipcHandlers.ts            — add get-transcript IPC handler
  electron/preload.ts                — expose startMicCapture, getAudioBuffer IPC
  electron/ProcessingHelper.ts       — inject transcript into Manus prompts
  src/_pages/Queue.tsx               — start mic on mount, pass buffer via IPC
  src/components/ManusTools/RadialLayout.tsx — physics positions, framer-motion, auto-fade
  package.json                       — add groq-sdk, d3-force, framer-motion
```

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install npm packages**

```bash
cd /c/Users/natha/Desktop/free-cluely
npm install groq-sdk d3-force framer-motion
npm install -D @types/d3-force
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('groq-sdk'); require('d3-force'); require('framer-motion'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add groq-sdk, d3-force, framer-motion"
```

---

### Task 2: TranscriptionHelper — Groq Whisper client

**Files:**
- Create: `electron/TranscriptionHelper.ts`

- [ ] **Step 1: Create TranscriptionHelper**

```typescript
// electron/TranscriptionHelper.ts

import Groq from "groq-sdk"
import dotenv from "dotenv"
import fs from "fs"
import path from "path"
import os from "os"

dotenv.config()

export class TranscriptionHelper {
  private groq: Groq | null = null

  constructor() {
    const apiKey = process.env.GROQ_API_KEY
    if (apiKey) {
      this.groq = new Groq({ apiKey })
      console.log("[TranscriptionHelper] Initialized with Groq API key")
    } else {
      console.warn("[TranscriptionHelper] No GROQ_API_KEY — transcription disabled")
    }
  }

  public isConfigured(): boolean {
    return this.groq !== null
  }

  /**
   * Transcribe a raw audio buffer (webm/opus from MediaRecorder).
   * Writes to a temp file, sends to Groq, cleans up.
   */
  public async transcribe(audioBuffer: Buffer, mimeType: string = "audio/webm"): Promise<string> {
    if (!this.groq) {
      return ""
    }

    const ext = mimeType.includes("webm") ? ".webm" : mimeType.includes("mp4") ? ".mp4" : ".webm"
    const tmpPath = path.join(os.tmpdir(), `manusman-mic-${Date.now()}${ext}`)

    try {
      await fs.promises.writeFile(tmpPath, audioBuffer)

      const transcription = await this.groq.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: "whisper-large-v3",
        response_format: "text",
        language: "en",
      })

      const text = typeof transcription === "string" ? transcription : (transcription as any).text || ""
      console.log(`[TranscriptionHelper] Transcribed ${audioBuffer.length} bytes → ${text.length} chars`)
      return text.trim()
    } catch (error: any) {
      console.error("[TranscriptionHelper] Transcription failed:", error.message)
      return ""
    } finally {
      fs.promises.unlink(tmpPath).catch(() => {})
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /c/Users/natha/Desktop/free-cluely
npx tsc -p electron/tsconfig.json --noEmit
```

Expected: no errors (or only pre-existing ones)

- [ ] **Step 3: Commit**

```bash
git add electron/TranscriptionHelper.ts
git commit -m "feat: add TranscriptionHelper for Groq Whisper transcription"
```

---

### Task 3: Wire transcription into IPC + preload

**Files:**
- Modify: `electron/ipcHandlers.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Add IPC handler in ipcHandlers.ts**

Add after the existing `"get-last-screenshot-path"` handler (around line 223):

```typescript
  // Transcription — receive audio buffer from renderer, return transcript
  ipcMain.handle("transcribe-audio-buffer", async (_, audioData: ArrayBuffer, mimeType: string) => {
    try {
      const buffer = Buffer.from(audioData)
      const transcript = await appState.processingHelper.getTranscriptionHelper().transcribe(buffer, mimeType)
      return transcript
    } catch (error: any) {
      console.error("Error transcribing audio:", error)
      return ""
    }
  })
```

- [ ] **Step 2: Add preload exposure in preload.ts**

Add to the `electronAPI` object, after the `getLastScreenshotPath` line (around line 208):

```typescript
  // Transcription
  transcribeAudioBuffer: (audioData: ArrayBuffer, mimeType: string) =>
    ipcRenderer.invoke("transcribe-audio-buffer", audioData, mimeType),
```

Also add to the `ElectronAPI` interface at the top:

```typescript
  transcribeAudioBuffer: (audioData: ArrayBuffer, mimeType: string) => Promise<string>
```

- [ ] **Step 3: Expose TranscriptionHelper from ProcessingHelper**

In `electron/ProcessingHelper.ts`, add to the constructor (after the ManusHelper init around line 61):

```typescript
    // Initialize Transcription
    this.transcriptionHelper = new TranscriptionHelper()
```

Add the field declaration (around line 53):

```typescript
  private transcriptionHelper: TranscriptionHelper
```

Add the import at the top:

```typescript
import { TranscriptionHelper } from "./TranscriptionHelper"
```

Add the getter method (after `getManusHelper()` around line 213):

```typescript
  public getTranscriptionHelper() {
    return this.transcriptionHelper
  }
```

- [ ] **Step 4: Verify compilation**

```bash
npx tsc -p electron/tsconfig.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add electron/ipcHandlers.ts electron/preload.ts electron/ProcessingHelper.ts
git commit -m "feat: wire transcription IPC between main and renderer"
```

---

### Task 4: Mic capture in renderer + transcript injection into prompts

**Files:**
- Modify: `src/_pages/Queue.tsx`
- Modify: `electron/ProcessingHelper.ts`

- [ ] **Step 1: Add mic capture to Queue.tsx**

Add this hook inside the `Queue` component, after the existing state declarations (around line 45):

```typescript
  // Mic capture — always-on rolling 30s buffer
  const micChunksRef = useRef<Blob[]>([])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)

  useEffect(() => {
    let recorder: MediaRecorder | null = null

    const startMic = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" })
        mediaRecorderRef.current = recorder

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            micChunksRef.current.push(e.data)
            // Keep only last 30s worth of chunks (at 250ms intervals = 120 chunks)
            while (micChunksRef.current.length > 120) {
              micChunksRef.current.shift()
            }
          }
        }

        recorder.start(250) // chunk every 250ms
        console.log("[Mic] Recording started — 30s rolling buffer")
      } catch (err) {
        console.warn("[Mic] Could not start microphone:", err)
      }
    }

    startMic()

    return () => {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop()
      }
    }
  }, [])
```

- [ ] **Step 2: Modify the tool submit handler to include transcript**

Replace the existing `onToolSubmit` in the RadialLayout JSX (around line 390-392):

```typescript
        onToolSubmit={async (toolName, args, screenshotPath) => {
          // Grab mic buffer and transcribe before sending tool request
          let transcript = ""
          if (micChunksRef.current.length > 0) {
            try {
              const blob = new Blob(micChunksRef.current, { type: "audio/webm" })
              const arrayBuffer = await blob.arrayBuffer()
              transcript = await window.electronAPI.transcribeAudioBuffer(arrayBuffer, "audio/webm")
            } catch (err) {
              console.warn("[Mic] Transcription failed, proceeding without:", err)
            }
          }

          // Send tool request — transcript goes via IPC as extra arg
          window.electronAPI.runManusTool(toolName, { ...args, _transcript: transcript }, screenshotPath)
        }}
```

- [ ] **Step 3: Inject transcript into Manus prompts in ProcessingHelper.ts**

In `electron/ProcessingHelper.ts`, modify the `runManusTool` method. After the prompt is built from the template (around line 226), add:

```typescript
    // Extract and inject transcript if provided
    const transcript = args._transcript || ""
    delete args._transcript  // don't pass to template

    let fullPrompt = prompt
    if (transcript) {
      fullPrompt += `\n\nLIVE CONTEXT (last 30 seconds of user's microphone):\n"""\n${transcript}\n"""\nUse this context to inform your response. The user is currently in a live conversation.`
      console.log(`[ProcessingHelper] Injected ${transcript.length} chars of transcript`)
    }
```

Then change the `this.manusHelper.runTool()` call to use `fullPrompt` instead of `prompt`.

- [ ] **Step 4: Verify the app starts**

```bash
npm start
```

Expected: App launches, console shows `[Mic] Recording started — 30s rolling buffer` (browser may prompt for mic permission).

- [ ] **Step 5: Commit**

```bash
git add src/_pages/Queue.tsx electron/ProcessingHelper.ts
git commit -m "feat: always-on mic buffer with transcript injection into Manus prompts"
```

---

### Task 5: PhysicsEngine — d3-force simulation

**Files:**
- Create: `src/components/ManusTools/PhysicsEngine.ts`

- [ ] **Step 1: Create PhysicsEngine**

```typescript
// src/components/ManusTools/PhysicsEngine.ts

import {
  forceSimulation,
  forceManyBody,
  forceCollide,
  forceLink,
  forceX,
  forceY,
  Simulation,
  SimulationNodeDatum,
  SimulationLinkDatum,
} from "d3-force"

// ── Types ──────────────────────────────────────────

export interface PhysicsNode extends SimulationNodeDatum {
  id: string
  width: number
  height: number
  zone: string
}

export interface PhysicsLink extends SimulationLinkDatum<PhysicsNode> {
  source: string | PhysicsNode
  target: string | PhysicsNode
}

// ── Zone targets ───────────────────────────────────

const ZONE_ORDER = ["NE", "E", "SE", "NW", "W", "SW", "N", "S"]

function getZoneTarget(zone: string, screenW: number, screenH: number): { x: number; y: number } {
  const pad = 200 // how far from edge
  const targets: Record<string, { x: number; y: number }> = {
    NE: { x: screenW - pad, y: pad },
    E:  { x: screenW - pad, y: screenH / 2 },
    SE: { x: screenW - pad, y: screenH - pad },
    NW: { x: pad, y: pad },
    W:  { x: pad, y: screenH / 2 },
    SW: { x: pad, y: screenH - pad },
    N:  { x: screenW / 2, y: pad },
    S:  { x: screenW / 2, y: screenH - pad },
  }
  return targets[zone] || targets.NE
}

// ── Entity linker ──────────────────────────────────

const STOP_WORDS = new Set(["the", "and", "for", "with", "this", "that", "from", "have", "has", "been", "will", "not", "are", "was", "were"])

interface CardData {
  id: string
  toolName: string
  query: string
  parsedResult: any | null
  resultText: string
}

function extractEntityFields(parsed: any): string[] {
  if (!parsed) return []
  const fields = ["company", "client", "name", "competitor_name", "us_name", "them_name", "person_or_company"]
  const values: string[] = []
  for (const f of fields) {
    if (parsed[f] && typeof parsed[f] === "string") {
      values.push(parsed[f].toLowerCase())
    }
  }
  return values
}

function extractProperNouns(text: string): string[] {
  if (!text) return []
  const matches = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || []
  return matches.filter(m => m.length > 3).map(m => m.toLowerCase())
}

export function findLinks(cards: CardData[]): Array<{ source: string; target: string }> {
  const links: Array<{ source: string; target: string }> = []
  const seen = new Set<string>()

  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i]
      const b = cards[j]
      const key = [a.id, b.id].sort().join("-")
      if (seen.has(key)) continue

      let linked = false

      // Layer 1: structured field match
      const aFields = extractEntityFields(a.parsedResult)
      const bFields = extractEntityFields(b.parsedResult)
      if (aFields.some(f => bFields.includes(f))) {
        linked = true
      }

      // Layer 2: query text match
      if (!linked && a.query && b.query) {
        const aq = a.query.toLowerCase()
        const bq = b.query.toLowerCase()
        if (aq.includes(bq) || bq.includes(aq)) {
          linked = true
        } else {
          const aWords = aq.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w))
          const bWords = new Set(bq.split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)))
          if (aWords.some(w => bWords.has(w))) {
            linked = true
          }
        }
      }

      // Layer 3: proper nouns in result text
      if (!linked) {
        const aNouns = extractProperNouns(a.resultText)
        const bNouns = new Set(extractProperNouns(b.resultText))
        if (aNouns.some(n => bNouns.has(n))) {
          linked = true
        }
      }

      if (linked) {
        seen.add(key)
        links.push({ source: a.id, target: b.id })
      }
    }
  }

  return links
}

// ── Physics engine ─────────────────────────────────

export class PhysicsEngine {
  private simulation: Simulation<PhysicsNode, PhysicsLink>
  private nodes: PhysicsNode[] = []
  private links: PhysicsLink[] = []
  private screenW: number
  private screenH: number
  private zoneCounter = 0
  private nodeZones: Map<string, string> = new Map()
  private onTick: (positions: Map<string, { x: number; y: number }>) => void

  constructor(
    screenW: number,
    screenH: number,
    onTick: (positions: Map<string, { x: number; y: number }>) => void
  ) {
    this.screenW = screenW
    this.screenH = screenH
    this.onTick = onTick

    this.simulation = forceSimulation<PhysicsNode, PhysicsLink>()
      .velocityDecay(0.2)
      .alphaDecay(0.008)
      .alphaTarget(0.03)
      .force("charge", forceManyBody<PhysicsNode>().strength(-60).distanceMax(400))
      .force("collide", forceCollide<PhysicsNode>().radius(d => Math.max(d.width, d.height) / 2 + 16))
      .force("link", forceLink<PhysicsNode, PhysicsLink>().id(d => d.id).distance(120).strength(0.3))
      .force("zoneX", forceX<PhysicsNode>().x(d => getZoneTarget(d.zone, screenW, screenH).x).strength(0.05))
      .force("zoneY", forceY<PhysicsNode>().y(d => getZoneTarget(d.zone, screenW, screenH).y).strength(0.05))
      .on("tick", () => {
        const positions = new Map<string, { x: number; y: number }>()
        for (const node of this.nodes) {
          // Clamp to screen bounds
          const x = Math.max(16, Math.min(this.screenW - node.width - 16, node.x || 0))
          const y = Math.max(16, Math.min(this.screenH - node.height - 16, node.y || 0))
          node.x = x
          node.y = y
          positions.set(node.id, { x, y })
        }
        this.onTick(positions)
      })

    // Start paused — no nodes yet
    this.simulation.stop()
  }

  public addNode(id: string, width: number, height: number, linkedToId?: string): void {
    // Assign zone — share zone with linked node, or pick next
    let zone: string
    if (linkedToId && this.nodeZones.has(linkedToId)) {
      zone = this.nodeZones.get(linkedToId)!
    } else {
      zone = ZONE_ORDER[this.zoneCounter % ZONE_ORDER.length]
      this.zoneCounter++
    }
    this.nodeZones.set(id, zone)

    const target = getZoneTarget(zone, this.screenW, this.screenH)
    const node: PhysicsNode = {
      id,
      x: target.x + (Math.random() - 0.5) * 60,
      y: target.y + (Math.random() - 0.5) * 60,
      width,
      height,
      zone,
    }
    this.nodes.push(node)
    this.simulation.nodes(this.nodes)
    this.simulation.alpha(0.5).restart()
  }

  public removeNode(id: string): void {
    this.nodes = this.nodes.filter(n => n.id !== id)
    this.links = this.links.filter(l => {
      const s = typeof l.source === "string" ? l.source : (l.source as PhysicsNode).id
      const t = typeof l.target === "string" ? l.target : (l.target as PhysicsNode).id
      return s !== id && t !== id
    })
    this.nodeZones.delete(id)
    this.simulation.nodes(this.nodes)
    ;(this.simulation.force("link") as any)?.links(this.links)
    this.simulation.alpha(0.3).restart()
  }

  public updateNodeSize(id: string, width: number, height: number): void {
    const node = this.nodes.find(n => n.id === id)
    if (node) {
      node.width = width
      node.height = height
      this.simulation.alpha(0.2).restart()
    }
  }

  public updateLinks(newLinks: Array<{ source: string; target: string }>): void {
    this.links = newLinks as PhysicsLink[]

    // Make linked nodes share zones — move target to source's zone
    for (const link of newLinks) {
      const sourceZone = this.nodeZones.get(link.source)
      if (sourceZone) {
        this.nodeZones.set(link.target, sourceZone)
        const node = this.nodes.find(n => n.id === link.target)
        if (node) node.zone = sourceZone
      }
    }

    ;(this.simulation.force("link") as any)?.links(this.links)
    this.simulation.alpha(0.5).restart()
  }

  public destroy(): void {
    this.simulation.stop()
  }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd /c/Users/natha/Desktop/free-cluely
npx tsc --noEmit --jsx react-jsx --module esnext --moduleResolution bundler --target esnext --skipLibCheck --esModuleInterop src/components/ManusTools/PhysicsEngine.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ManusTools/PhysicsEngine.ts
git commit -m "feat: add PhysicsEngine with d3-force simulation and entity linking"
```

---

### Task 6: Integrate physics + framer-motion + auto-fade into RadialLayout

**Files:**
- Modify: `src/components/ManusTools/RadialLayout.tsx`

- [ ] **Step 1: Rewrite RadialLayout.tsx**

Replace the entire file with:

```typescript
import React, { useEffect, useState, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import PresetRenderer from "./PresetRenderer"
import { PhysicsEngine, findLinks } from "./PhysicsEngine"

// ── Types ───────────────────────────────────────────────

type Phase = "input" | "pending" | "thinking" | "complete"

interface Card {
  id: string
  toolName: string
  needsScreenshot: boolean
  phase: Phase
  query: string
  result: any | null
  parsedResult: any | null
}

const TOOL_COLORS: Record<string, string> = {
  who_is_this: "#7c3aed", meeting_brief: "#059669", live_fact_check: "#d97706",
  company_snapshot: "#2563eb", deal_status: "#ea580c", competitive_intel: "#dc2626", number_lookup: "#0891b2",
}
const TOOL_LABELS: Record<string, string> = {
  who_is_this: "PERSON", meeting_brief: "BRIEF", live_fact_check: "FACT CHECK",
  company_snapshot: "COMPANY", deal_status: "DEAL", competitive_intel: "INTEL", number_lookup: "STAT",
}
const INPUT_PLACEHOLDERS: Record<string, string> = {
  who_is_this: "Extra context (optional)...", meeting_brief: "Person or company name...",
  live_fact_check: "Claim to verify...", company_snapshot: "Company name...",
  deal_status: "Client name...", competitive_intel: "Competitor name...", number_lookup: "What stat to find...",
}

function buildArgs(toolName: string, input: string): Record<string, string> {
  switch (toolName) {
    case "meeting_brief": return { person_or_company: input }
    case "company_snapshot": return { company_name: input }
    case "deal_status": return { client_name: input }
    case "number_lookup": return { query: input }
    case "who_is_this": return { context: input || "See attached screenshot" }
    case "live_fact_check": return { claim: input }
    case "competitive_intel": return { competitor_name: input }
    default: return { query: input }
  }
}

let counter = 0
function nextId(tool: string) { return `c-${tool}-${++counter}-${Date.now()}` }

// Parse result JSON — extract JSON from anywhere in text
function parseResultJSON(text: string): any | null {
  if (!text) return null
  // Strategy 1: extract ```json ... ``` block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()) } catch {}
  }
  // Strategy 2: find { ... "display" ... } object
  const jsonMatch = text.match(/\{[\s\S]*"display"\s*:\s*"[^"]+[\s\S]*\}/)
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]) } catch {}
  }
  // Strategy 3: whole text as JSON
  try { return JSON.parse(text.trim()) } catch {}
  return null
}

// ── Auto-fade hook ─────────────────────────────────────

const FADE_DELAY = 30000   // 30s before fade starts
const FADE_DURATION = 15000 // 15s fade

function useAutoFade(
  phase: Phase,
  onDelete: () => void,
): { opacity: number; onHover: () => void; onLeave: () => void } {
  const [opacity, setOpacity] = useState(1)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeStartRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const hoveredRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    timerRef.current = null
    fadeStartRef.current = null
  }, [])

  const startFadeTimer = useCallback(() => {
    clearTimers()
    timerRef.current = setTimeout(() => {
      // Begin fade
      fadeStartRef.current = Date.now()
      const tick = () => {
        if (hoveredRef.current) return
        const elapsed = Date.now() - (fadeStartRef.current || Date.now())
        const progress = Math.min(elapsed / FADE_DURATION, 1)
        setOpacity(1 - progress)
        if (progress >= 1) {
          onDelete()
        } else {
          rafRef.current = requestAnimationFrame(tick)
        }
      }
      tick()
    }, FADE_DELAY)
  }, [clearTimers, onDelete])

  // Start timer when phase becomes complete
  useEffect(() => {
    if (phase === "complete") {
      startFadeTimer()
    }
    return clearTimers
  }, [phase, startFadeTimer, clearTimers])

  const onHover = useCallback(() => {
    hoveredRef.current = true
    clearTimers()
    setOpacity(1)
  }, [clearTimers])

  const onLeave = useCallback(() => {
    hoveredRef.current = false
    if (phase === "complete") {
      startFadeTimer()
    }
  }, [phase, startFadeTimer])

  return { opacity, onHover, onLeave }
}

// ── Card component ──────────────────────────────────────

const CardView: React.FC<{
  card: Card
  onSubmit: (id: string, tool: string, args: Record<string, string>, screenshot?: string) => void
  onDismiss: (id: string) => void
  onQueryChange: (id: string, q: string) => void
}> = ({ card, onSubmit, onDismiss, onQueryChange }) => {
  const color = TOOL_COLORS[card.toolName] || "#666"
  const label = TOOL_LABELS[card.toolName] || card.toolName
  const inputRef = useRef<HTMLInputElement>(null)

  const { opacity, onHover, onLeave } = useAutoFade(card.phase, () => onDismiss(card.id))

  useEffect(() => { if (card.phase === "input") inputRef.current?.focus() }, [card.phase])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const args = buildArgs(card.toolName, card.query)
    let ss: string | undefined
    if (card.needsScreenshot) ss = await window.electronAPI.getLastScreenshotPath() || undefined
    onSubmit(card.id, card.toolName, args, ss)
  }

  const phaseLabel = card.phase === "pending" ? "pending" : card.phase === "thinking" ? "thinking" : ""
  const parsed = card.parsedResult

  return (
    <div
      style={{ opacity, transition: "opacity 0.3s ease" }}
      onMouseEnter={() => {
        onHover()
        window.electronAPI.setIgnoreMouse(false)
      }}
      onMouseLeave={() => {
        onLeave()
        window.electronAPI.setIgnoreMouse(true)
      }}
    >
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "rgba(0, 0, 0, 0.65)",
          borderLeft: `3px solid ${color}`,
          boxShadow: `0 4px 20px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.06)`,
          width: card.phase === "complete" ? 480 : 300,
          transition: "width 400ms ease",
        }}
      >
        {/* Header — drag zone */}
        <div className="flex items-center justify-between px-4 h-8 cursor-grab">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>{label}</span>
            {card.phase !== "input" && card.phase !== "complete" && (
              <span className={`w-1.5 h-1.5 rounded-full ${card.phase === "thinking" ? "animate-pulse" : ""}`}
                style={{ background: card.phase === "thinking" ? "#facc15" : "#888" }} />
            )}
            {card.phase === "complete" && (
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#4ade80" }} />
            )}
          </div>
          <button onClick={() => onDismiss(card.id)} className="text-white/20 hover:text-white/40 text-xs leading-none">x</button>
        </div>

        {/* Input */}
        {card.phase === "input" && (
          <form onSubmit={submit} className="px-4 pb-3">
            <input ref={inputRef} value={card.query}
              onChange={e => onQueryChange(card.id, e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") onDismiss(card.id) }}
              placeholder={INPUT_PLACEHOLDERS[card.toolName]}
              className="w-full px-3 py-2 text-sm text-white bg-white/10 rounded-md border border-white/10 focus:outline-none focus:border-white/20 placeholder-white/30" />
          </form>
        )}

        {/* Pending / Thinking */}
        {(card.phase === "pending" || card.phase === "thinking") && (
          <div className="px-4 pb-3">
            {card.query && <div className="text-sm text-white/50 mb-2">{card.query}</div>}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full" style={{
                  background: `linear-gradient(90deg, transparent, ${color}88, transparent)`,
                  animation: `shimmer ${card.phase === "thinking" ? "1s" : "2.5s"} ease-in-out infinite`,
                  width: "100%",
                }} />
              </div>
              <span className="text-[10px] text-white/30">{phaseLabel}</span>
            </div>
          </div>
        )}

        {/* Complete — render preset */}
        {card.phase === "complete" && (
          <div className="px-4 pb-4 pt-1">
            {parsed?.display ? (
              <PresetRenderer data={parsed} color={color} />
            ) : (
              <div className="text-sm text-white/70 leading-relaxed">
                {card.result?.text?.substring(0, 500)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main layout ─────────────────────────────────────────

interface Props {
  toolResults: any[]
  runningTools: Map<string, string>
  activeToolPrompt: { toolName: string; needsScreenshot: boolean } | null
  onToolSubmit: (toolName: string, args: Record<string, string>, screenshotPath?: string) => void
  onToolCancel: () => void
  onDismissResult: (index: number) => void
}

const RadialLayout: React.FC<Props> = ({
  toolResults, runningTools, activeToolPrompt, onToolSubmit, onToolCancel, onDismissResult: _onDismissResult,
}) => {
  const [cards, setCards] = useState<Map<string, Card>>(new Map())
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map())
  const queues = useRef<Map<string, string[]>>(new Map())
  const processedResults = useRef<Set<string>>(new Set())
  const physicsRef = useRef<PhysicsEngine | null>(null)
  const dragOverride = useRef<Map<string, { x: number; y: number }>>(new Map())

  // Initialize physics engine
  useEffect(() => {
    const engine = new PhysicsEngine(
      window.innerWidth,
      window.innerHeight,
      (newPositions) => {
        setPositions(prev => {
          const next = new Map(prev)
          for (const [id, pos] of newPositions) {
            // Don't override dragged cards
            if (!dragOverride.current.has(id)) {
              next.set(id, pos)
            }
          }
          return next
        })
      }
    )
    physicsRef.current = engine
    return () => engine.destroy()
  }, [])

  // New prompt → create input card
  useEffect(() => {
    if (!activeToolPrompt) return
    const id = nextId(activeToolPrompt.toolName)
    setCards(prev => new Map(prev).set(id, {
      id, toolName: activeToolPrompt.toolName, needsScreenshot: activeToolPrompt.needsScreenshot,
      phase: "input", query: "", result: null, parsedResult: null,
    }))
    physicsRef.current?.addNode(id, 300, 80)
    onToolCancel()
  }, [activeToolPrompt])

  // Running tools → update existing cards phase
  useEffect(() => {
    setCards(prev => {
      const next = new Map(prev)
      let changed = false
      runningTools.forEach((status, toolName) => {
        const q = queues.current.get(toolName)
        if (!q) return
        for (const cardId of q) {
          const card = next.get(cardId)
          if (card && (card.phase === "pending" || card.phase === "thinking")) {
            const newPhase = (status === "thinking" || status === "running") ? "thinking" : card.phase
            if (card.phase !== newPhase) {
              next.set(cardId, { ...card, phase: newPhase as Phase })
              changed = true
            }
          }
        }
      })
      return changed ? next : prev
    })
  }, [runningTools])

  // Results → upgrade EXISTING card to complete + run entity linker
  useEffect(() => {
    if (toolResults.length === 0) return

    setCards(prev => {
      const next = new Map(prev)
      let changed = false

      for (const result of toolResults) {
        if (result._partial) continue
        const rKey = result.taskId || `${result.toolName}-${result.text?.substring(0, 20)}`
        if (processedResults.current.has(rKey)) continue
        processedResults.current.add(rKey)

        const q = queues.current.get(result.toolName)
        const cardId = q?.shift()
        if (cardId && next.has(cardId)) {
          const card = next.get(cardId)!
          const parsed = parseResultJSON(result.text)
          next.set(cardId, { ...card, phase: "complete", result, parsedResult: parsed })
          physicsRef.current?.updateNodeSize(cardId, 480, 300)
          changed = true
        }
      }

      // Run entity linker on all complete cards
      if (changed) {
        const cardData = Array.from(next.values())
          .filter(c => c.phase === "complete")
          .map(c => ({
            id: c.id,
            toolName: c.toolName,
            query: c.query,
            parsedResult: c.parsedResult,
            resultText: c.result?.text || "",
          }))
        const links = findLinks(cardData)
        physicsRef.current?.updateLinks(links)
      }

      return changed ? next : prev
    })
  }, [toolResults])

  const handleSubmit = useCallback((cardId: string, toolName: string, args: Record<string, string>, screenshot?: string) => {
    const q = queues.current.get(toolName) || []
    q.push(cardId)
    queues.current.set(toolName, q)
    setCards(prev => { const n = new Map(prev); const c = n.get(cardId); if (c) n.set(cardId, { ...c, phase: "pending" }); return n })
    onToolSubmit(toolName, args, screenshot)
  }, [onToolSubmit])

  const handleQuery = useCallback((id: string, q: string) => {
    setCards(prev => { const n = new Map(prev); const c = n.get(id); if (c) n.set(id, { ...c, query: q }); return n })
  }, [])

  const handleDismiss = useCallback((id: string) => {
    setCards(prev => { const n = new Map(prev); n.delete(id); return n })
    setPositions(prev => { const n = new Map(prev); n.delete(id); return n })
    physicsRef.current?.removeNode(id)
    dragOverride.current.delete(id)
  }, [])

  // Drag handler — override physics position while dragging
  const handleDrag = useCallback((id: string, x: number, y: number) => {
    dragOverride.current.set(id, { x, y })
    setPositions(prev => new Map(prev).set(id, { x, y }))
  }, [])

  const handleDragEnd = useCallback((id: string) => {
    // Release drag override — physics takes over again
    // (optional: keep manual position by not deleting from dragOverride)
    dragOverride.current.delete(id)
  }, [])

  return (
    <div className="fixed inset-0" style={{ pointerEvents: "none" }}>
      <AnimatePresence>
        {Array.from(cards.values()).map(card => {
          const pos = positions.get(card.id) || { x: window.innerWidth / 2, y: window.innerHeight / 2 }
          return (
            <motion.div
              key={card.id}
              className="absolute"
              style={{ left: pos.x, top: pos.y, pointerEvents: "auto", zIndex: 50 }}
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 100, damping: 18, mass: 2 }}
              onMouseDown={(e) => {
                // Drag by header (top 32px)
                const rect = e.currentTarget.getBoundingClientRect()
                if (e.clientY - rect.top > 32) return
                e.preventDefault()
                const startX = e.clientX
                const startY = e.clientY
                const startPos = { ...pos }
                window.electronAPI.setIgnoreMouse(false)
                const move = (ev: MouseEvent) => {
                  handleDrag(card.id, startPos.x + ev.clientX - startX, startPos.y + ev.clientY - startY)
                }
                const up = () => {
                  handleDragEnd(card.id)
                  document.removeEventListener("mousemove", move)
                  document.removeEventListener("mouseup", up)
                }
                document.addEventListener("mousemove", move)
                document.addEventListener("mouseup", up)
              }}
            >
              <CardView card={card} onSubmit={handleSubmit} onDismiss={handleDismiss} onQueryChange={handleQuery} />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

export default RadialLayout
```

- [ ] **Step 2: Verify the app builds and starts**

```bash
npm start
```

Expected: App launches. Pressing Ctrl+1 and typing a query should spawn a card that positions itself via physics toward the NE corner. Multiple cards should repel each other. Related cards (same query text) should cluster together. Cards should fade and delete 30s after result arrives.

- [ ] **Step 3: Commit**

```bash
git add src/components/ManusTools/RadialLayout.tsx
git commit -m "feat: physics-based card layout with clustering and auto-fade lifecycle"
```

---

### Task 7: Verify end-to-end flow

- [ ] **Step 1: Start the app**

```bash
cd /c/Users/natha/Desktop/free-cluely
npm start
```

- [ ] **Step 2: Test mic buffer**

Check console for `[Mic] Recording started — 30s rolling buffer`. Allow mic permission if prompted.

- [ ] **Step 3: Test tool with transcript**

Press Ctrl+1 (meeting_brief), type "Stripe", press Enter. Check Electron console for `[ProcessingHelper] Injected X chars of transcript`. The Manus prompt should include the `LIVE CONTEXT` block.

- [ ] **Step 4: Test physics positioning**

Trigger 3-4 tools. Cards should appear near screen edges, not stacked in a grid. Cards should glide smoothly when new ones appear.

- [ ] **Step 5: Test entity clustering**

Run "company snapshot: Stripe" then "deal status: Stripe". Both cards should drift toward each other and share a zone.

- [ ] **Step 6: Test auto-fade**

Wait 30s after a card result arrives without hovering. Card should fade over 15s then disappear. Hover during fade should snap it back to full opacity and reset the timer.

- [ ] **Step 7: Test drag override**

Drag a card by its header. It should move freely. After releasing, physics should gradually pull it back toward its zone (or it stays if drag override is kept).

- [ ] **Step 8: Final commit + push**

```bash
git add -A
git status  # verify only expected files
git commit -m "feat: context-aware overlay — mic buffer, physics layout, auto-fade"
git push
```
