# Context-Aware Overlay — Design Spec

## Overview

Three modules that make Manusman context-aware and visually intelligent during live calls:

1. **Mic Buffer** — always-on 30s rolling mic capture, auto-transcribed via Groq Whisper and injected into every Manus tool call
2. **Physics Engine** — d3-force simulation replacing grid placement, with entity-based clustering and zone gravity
3. **Visual Polish** — framer-motion spring animations, auto-fade lifecycle (30s → fade → delete)

All three are independent modules plugging into the existing RadialLayout system.

---

## Module A: Mic Buffer

### Purpose

Capture the user's microphone continuously. When any tool keybind (Ctrl+1-7) is pressed, transcribe the last 30 seconds and attach the transcript as context to the Manus prompt.

### Architecture

```
Renderer process (Queue.tsx):
  getUserMedia({ audio: true })
    → MediaRecorder (chunks every 250ms)
    → circular buffer (keeps last 30s of audio chunks)

Main process (TranscriptionHelper.ts):
  IPC handler: "get-transcript"
    → receives audio buffer from renderer
    → sends to Groq Whisper API
    → returns transcript text

ProcessingHelper.ts:
  runManusTool() calls getTranscript() before building prompt
    → transcript appended to TOOL_PROMPTS output
```

### Transcript injection format

```
${existingToolPrompt}

LIVE CONTEXT (last 30 seconds of user's microphone):
"""
${transcriptText}
"""
Use this context to inform your response. The user is currently in a live conversation.
```

### API

- **Provider:** Groq (api.groq.com)
- **Model:** whisper-large-v3
- **Endpoint:** POST /openai/v1/audio/transcriptions (OpenAI-compatible)
- **Cost:** $0.0028/min (~$0.0014 per 30s call)
- **Latency:** ~0.3-0.5s for 30s of audio
- **Key:** `GROQ_API_KEY` in .env

### Behavior

- Mic starts recording on app launch. No toggle, no UI.
- If `GROQ_API_KEY` is missing, mic buffer does not start. Tools work exactly as before.
- If transcription fails (network error, empty audio), the tool runs without transcript. No error shown to user.
- Buffer is audio only — no transcript is stored persistently. Privacy: audio chunks are overwritten every 30s.

### New files

- `electron/TranscriptionHelper.ts` — Groq API client, buffer management
- IPC handlers in `electron/main.ts` for `get-transcript`
- Renderer-side mic capture setup in `src/_pages/Queue.tsx`

### Dependencies

- `groq-sdk` (npm)

### Future (out of scope)

- Screenshot auto-attached to every Ctrl+N keybind
- Configurable buffer length
- Deepgram or whisper.cpp as fallback providers

---

## Module B: Physics Engine

### Purpose

Replace the static `findOpenPosition()` grid with a d3-force simulation that:
- Positions cards around screen edges (center clear)
- Clusters related cards together via spring attraction
- Animates card movement with organic, drifty physics

### Architecture

```
PhysicsEngine.ts (new):
  d3-force simulation with:
    - forceCollide (prevent overlap)
    - forceManyBody (repulsion between all cards)
    - forceLink (attraction between linked cards)
    - custom forceZone (push cards toward edges)

RadialLayout.tsx (modified):
  - Cards read position from physics engine instead of findOpenPosition()
  - New cards added as nodes to simulation
  - Removed cards deleted from simulation
  - Entity linker runs on phase=complete
```

### Forces

| Force | Type | Parameters | Purpose |
|-------|------|-----------|---------|
| Repulsion | forceManyBody | strength: -60, distanceMax: 400 | Prevent overlap, spread cards |
| Attraction | forceLink | strength: 0.3, distance: 120 | Pull linked cards together |
| Zone gravity | custom | toward nearest edge | Keep center clear |
| Collision | forceCollide | radius: card diagonal/2 + 16px | Hard overlap prevention |

### Organic feel parameters

| Parameter | Value | Effect |
|-----------|-------|--------|
| velocityDecay | 0.2 | Cards glide, don't snap |
| alphaDecay | 0.008 | Slow settling |
| alphaTarget | 0.03 | Subtle ambient drift, never freezes |

### Zone layout

```
+------+----------+------+
|  NW  |    N     |  NE  |  <- cards dock here
+------+----------+------+
|      |          |      |
|  W   | EXCLUDED |  E   |  <- center always clear
|      |          |      |
+------+----------+------+
|  SW  |    S     |  SE  |  <- cards dock here
+------+----------+------+
```

Cards assigned to zones by order of creation. First card → NE, then E, SE, etc. Clustered cards share a zone and drift together within it.

### Entity linking (3 layers)

Runs when a card reaches phase=complete. Checks against all other live cards.

**Layer 1 — Structured field match (exact):**
Compare parsed JSON fields: `company`, `client`, `name`, `competitor_name`, `us_name`, `them_name`. Case-insensitive exact match.

**Layer 2 — Query text match:**
Compare the raw query strings. If one query is a substring of another, or they share a word longer than 3 characters (excluding stop words), link them.

**Layer 3 — Proper noun extraction:**
Scan result text for capitalized multi-word sequences (e.g. "Patrick Collison", "Series B"). If both cards share a proper noun, link them.

If any layer finds a match → add a spring link in d3-force. Cards drift together.

### No visible links

Clustering proximity is the only visual cue. No lines, no connectors.

### New files

- `src/components/ManusTools/PhysicsEngine.ts` — simulation, forces, entity linker

### Modified files

- `src/components/ManusTools/RadialLayout.tsx` — use physics positions, remove findOpenPosition()

### Dependencies

- `d3-force` (npm)

---

## Module C: Visual Polish

### Purpose

Add spring animations for card lifecycle and auto-fade with deletion.

### Card animation (framer-motion)

| Event | Animation | Spring config |
|-------|-----------|---------------|
| Card enters | opacity 0→1, scale 0.96→1, y +10→0 | tension: 100, friction: 18, mass: 2 |
| Card expands (complete) | width 300→480 | spring default |
| Card fades | opacity 1→0 over 15s | CSS transition |
| Card exits | scale 1→0.96, removed from DOM | AnimatePresence |

### Auto-fade lifecycle

```
phase=complete (result arrives)
  → start 30s timer

hover on card
  → reset timer to 30s
  → if currently fading, snap opacity back to 1

30s timer expires (no hover)
  → begin opacity transition 1→0 over 15s

hover during fade
  → snap to opacity 1, reset 30s timer

fade completes (opacity=0)
  → delete card from DOM
  → remove node from physics simulation
```

### Visual refinements

- Background: `rgba(0,0,0,0.75)` → `rgba(0,0,0,0.65)`
- Softer box shadow
- All position changes spring-animated (via physics engine + framer-motion)

### Modified files

- `src/components/ManusTools/RadialLayout.tsx` — fade timers, AnimatePresence wrapper
- `src/components/ManusTools/CardView.tsx` (if extracted) — motion.div wrapper

### Dependencies

- `framer-motion` (npm) — or `motion` (the renamed package)

---

## Integration summary

### New .env keys

```
GROQ_API_KEY=<groq api key>
```

### New npm dependencies

```
groq-sdk
d3-force
framer-motion
```

### New files

```
electron/TranscriptionHelper.ts
src/components/ManusTools/PhysicsEngine.ts
```

### Modified files

```
electron/ProcessingHelper.ts  — inject transcript into prompts
electron/main.ts              — IPC handlers for get-transcript
src/_pages/Queue.tsx           — mic capture setup
src/components/ManusTools/RadialLayout.tsx — physics positions, fade lifecycle, animations
```

### Data flow (complete)

```
App launches
  → mic starts recording (renderer)
  → physics simulation starts (renderer)

User presses Ctrl+1 (meeting_brief)
  → main process: get-transcript IPC → renderer sends 30s buffer
  → main process: Groq transcribes → transcript text
  → main process: buildArgs + transcript → Manus prompt
  → main process: Manus API call
  → renderer: new card added to physics sim (phase=input→pending)
  → renderer: card positioned by zone gravity + repulsion
  → result arrives: entity linker checks for links
  → if linked: spring attraction pulls cards together
  → 30s after result: fade begins
  → fade complete: card deleted, node removed from sim
```
