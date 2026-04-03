# Passive Listener + Slides Prep — Design Spec

## Overview

Two features:

1. **Passive Listener** — auto-triggers intel cards when entities are detected in the mic transcript. Runs every 3s, regex-based entity extraction, cooldown-gated.
2. **Slides Prep** — new Ctrl+3 keybind that takes a screenshot and returns a swipeable meeting prep card with multiple slides. Replaces the old "Who Is This" tool.

## New Keybind Layout

| Key | Tool | Type | Input |
|-----|------|------|-------|
| Ctrl+1 | intel | text | Company, person, or topic |
| Ctrl+2 | deal_status | text | Client name |
| Ctrl+3 | prep | screenshot | Takes screenshot, generates slides |
| Ctrl+4 | live_fact_check | screenshot | Claim to verify |
| Passive | intel (auto) | transcript | Triggered by entity detection |

## Module A: Passive Listener

### Purpose

Automatically detect entities mentioned during a live call and proactively surface intel cards without the user pressing a keybind.

### Architecture

New file: `src/components/ManusTools/PassiveListener.ts`

Exports a hook: `usePassiveListener(micChunksRef, onTrigger)`

```
Every 3s:
  1. Grab last ~12 mic chunks (3s of audio)
  2. Transcribe via Groq (fast, ~0.3s for 3s of audio)
  3. Regex scan for entities:
     - Capitalized multi-word: /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g
     - Company suffixes: /\b\w+\s+(Inc|Corp|Ltd|AI|Labs|Tech)\b/gi
     - Stat triggers: /(how much|what's their|revenue|valuation|worth|market cap)/i
  4. Check cooldowns:
     - Per-entity: skip if seen within 60s
     - Global: skip if ANY auto-card fired within 10s
     - Max visible: skip if 3+ auto-cards on screen
  5. Fire onTrigger(entity) → calls handleToolSubmit("intel", { query: entity })
```

### Cooldown map

```typescript
cooldowns: Map<string, number>  // entity (lowercase) → timestamp of last trigger
lastGlobalTrigger: number       // timestamp of last auto-trigger (any entity)
autoCardCount: number           // passed in from parent, tracks visible auto-cards
```

### Auto-card visual distinction

Auto-triggered cards get an `isAuto: true` flag on the Card object. In the card header, a small "AUTO" badge appears next to the tool label in a muted color. Same card style, physics, and fade lifecycle otherwise.

### Integration in Queue.tsx

```typescript
const handleAutoTrigger = useCallback((entity: string) => {
  handleToolSubmit("intel", { query: entity }, undefined, true) // true = isAuto
}, [handleToolSubmit])

usePassiveListener(micChunksRef, handleAutoTrigger)
```

## Module B: Slides Display Format

### Purpose

A new display format for meeting prep — multiple slides within a single card, navigable with arrow keys.

### JSON Schema

```json
{
  "display": "slides",
  "title": "Prep: Meeting with Stripe",
  "slides": [
    { "heading": "Company Overview", "bullets": ["$91.5B valuation", "Payments infra"] },
    { "heading": "Key People", "bullets": ["Patrick Collison, CEO", "John Collison, President"] },
    { "heading": "Talking Points", "bullets": ["Ask about enterprise pricing", "Mention our API integration"] },
    { "heading": "Risks", "bullets": ["Adyen gaining enterprise share", "Regulatory pressure in EU"] }
  ]
}
```

### Rendering

```
Card width: 520px (wider than normal 480px complete cards)

┌─────────────────────────────────────────────┐
│ PREP                                      x │
├─────────────────────────────────────────────┤
│ Prep: Meeting with Stripe                   │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ Company Overview                        │ │
│ │                                         │ │
│ │ • $91.5B valuation                      │ │
│ │ • Payments infrastructure               │ │
│ │ • 5M+ businesses on platform            │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│              ● ○ ○ ○                        │
└─────────────────────────────────────────────┘

Navigation: left/right arrow keys when card is hovered/focused
Dots: filled for current slide, hollow for others
Slide transition: simple opacity fade (no sliding animation)
```

### PresetRenderer addition

New `SlidesPreset` component added to the switch in PresetRenderer:

```typescript
case "slides": return <SlidesPreset d={data} color={color} />
```

SlidesPreset manages its own `currentSlide` state. Listens for ArrowLeft/ArrowRight keyboard events when the card is hovered (via onMouseEnter/onMouseLeave to add/remove the event listener).

## Module C: Prep Tool

### Keybind

Ctrl+3 → takes screenshot → sends to Manus with prep prompt.

Replaces `who_is_this`. The `who_is_this` tool, its examples, colors, labels, and placeholders are removed.

### Prompt

```
You are a meeting prep analyst. Your client is about to enter a call. 
Look at the screenshot — it might show a calendar invite, email, 
LinkedIn profile, or website. Generate a series of prep slides they 
can flick through during the call.

Return 3-5 slides covering: overview, key people, talking points, 
and risks/watchouts. Each slide has a heading and 3-5 bullet points.
```

### Few-shot examples

```
Input: Screenshot of calendar invite for "Q3 Review with Snowflake"
Output: {"display":"slides","title":"Prep: Snowflake Q3 Review","slides":[
  {"heading":"Company Snapshot","bullets":["$2.1B ARR, 30% YoY growth","Consumption-based pricing model","Cortex AI platform launching"]},
  {"heading":"Key People","bullets":["Sridhar Ramaswamy, CEO (since Feb 2024)","Chris Degnan, CRO","Benoit Dageville, Co-founder & President of Products"]},
  {"heading":"Talking Points","bullets":["Ask about Cortex AI adoption metrics","Discuss credit consumption vs commit model","Probe competitive response to Databricks"]},
  {"heading":"Watch Out","bullets":["Consumption growth slowing vs prior quarters","CFO transition announced last month","Enterprise contract renewal cycle"]}
]}
```

## File Changes

### New files

| File | Purpose |
|------|---------|
| `src/components/ManusTools/PassiveListener.ts` | usePassiveListener hook — 3s interval, regex, cooldowns |

### Modified files

| File | Changes |
|------|---------|
| `electron/shortcuts.ts` | Ctrl+3 → "prep" (screenshot), remove who_is_this |
| `electron/ipcHandlers.ts` | Update screenshotTools: remove who_is_this, add prep |
| `electron/ProcessingHelper.ts` | Add "prep" tool prompt + examples, remove who_is_this, update ManusToolName |
| `src/_pages/Queue.tsx` | Wire usePassiveListener, pass autoCardCount, add isAuto to handleToolSubmit |
| `src/components/Queue/QueueCommands.tsx` | Button "3 Prep" replaces "3 Who?", update keybind list |
| `src/components/ManusTools/RadialLayout.tsx` | Add "prep" to colors/labels/placeholders, remove who_is_this, add isAuto flag + AUTO badge |
| `src/components/ManusTools/PresetRenderer.tsx` | Add SlidesPreset component with arrow navigation + dots |

## Data Flow

### Passive listener flow

```
Mic recording (always on)
  → every 3s: grab last 12 chunks
  → transcribe via Groq (~0.3s)
  → regex extract entities
  → cooldown check (60s entity, 10s global, max 3 visible)
  → fire intel tool with entity
  → card appears with "AUTO" badge
  → same fade lifecycle (30s → delete)
```

### Prep flow

```
User presses Ctrl+3
  → screenshot taken
  → card created (phase: pending, no text input needed)
  → Manus receives screenshot + prep prompt
  → returns { display: "slides", slides: [...] }
  → renders as wider card (520px) with slide navigation
  → user flicks through slides with arrow keys while hovered
```
