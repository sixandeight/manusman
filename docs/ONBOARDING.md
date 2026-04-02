# Cluely — Onboarding Brief

## Setup

```
git clone https://github.com/sixandeight/cluely.git
cd cluely
npm install
cp .env.example .env     ← fill in your KIMI_API_KEY and MANUS_API_KEY
npm start
```

---

## Keybinds — Full Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        KEYBIND MAP                              │
│                                                                 │
│  ── OVERLAY CONTROL ──────────────────────────────────────────  │
│                                                                 │
│  Ctrl+B              Toggle overlay visibility                  │
│  Ctrl+Shift+Space    Center + show overlay                      │
│  Ctrl+R              Reset everything (clear all cards/queues)  │
│  Ctrl+Q              Quit app                                   │
│  Ctrl+Arrows         Move overlay window                        │
│                                                                 │
│  ── KIMI (fast, 2-3 seconds) ────────────────────────────────  │
│                                                                 │
│  Ctrl+H              Screenshot → auto-analyzed by Kimi         │
│  Ctrl+Enter          Process screenshot queue (detailed)        │
│  Chat box            Type anything → Kimi responds              │
│                                                                 │
│  ── MANUS TOOLS (deep, 30-120 seconds) ──────────────────────  │
│                                                                 │
│  Ctrl+1              Meeting Brief     ← type person/company    │
│  Ctrl+2              Company Snapshot  ← type company name      │
│  Ctrl+3              Deal Status       ← type client name       │
│  Ctrl+4              Number Lookup     ← type what stat to find │
│  Ctrl+5              Who Is This?      ← uses last screenshot   │
│  Ctrl+6              Fact Check        ← uses last screenshot   │
│  Ctrl+7              Competitive Intel ← uses last screenshot   │
│                                                                 │
│  Ctrl+1-4: opens input box, you type query, hit Enter           │
│  Ctrl+5-7: grabs last screenshot, opens input for extra context │
└─────────────────────────────────────────────────────────────────┘
```

---

## Rendering Policy — When Things Appear

```
STATE: IDLE (app just started)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  [Command Bar]  ← top-left, always visible                  │
│                                                             │
│                    (everything else transparent)             │
│                    (clicks pass through to desktop)          │
│                                                             │
│                                                             │
│  [Debug Status] ← bottom-left, shows current state          │
└─────────────────────────────────────────────────────────────┘


STATE: USER PRESSES Ctrl+2 (company_snapshot)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┌─────────────────────────────────────────────────────────────┐
│  [Command Bar]                                              │
│                                                             │
│                              ┌─────────────────────┐        │
│                              │ Company Snapshot     │        │
│                              │ ┌─────────────────┐ │        │
│                              │ │ Acme Corp█      │ │        │
│                              │ └─────────────────┘ │        │
│                              │       [Go] [Esc]    │        │
│                              └─────────────────────┘        │
│                                  ORANGE border              │
│  [Debug: prompt: company_snapshot]                           │
└─────────────────────────────────────────────────────────────┘


STATE: USER HITS ENTER (Manus working)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┌─────────────────────────────────────────────────────────────┐
│  [Command Bar]                                              │
│                                                             │
│                              ┌─────────────────────┐        │
│                              │ ● ● ● Researching   │        │
│                              │     company...       │        │
│                              └─────────────────────┘        │
│                                  YELLOW border              │
│                                                             │
│                         (progressive text appears as        │
│                          Manus sends partial results)       │
│                                                             │
│  [Debug: running: 1 | results: 0]                           │
└─────────────────────────────────────────────────────────────┘


STATE: MANUS RETURNS RESULT
━━━━━━━━━━━━━━━━━━━━━━━━━━━
┌─────────────────────────────────────────────────────────────┐
│  [Command Bar]                                              │
│                                                             │
│                              ┌─────────────────────┐        │
│                              │ COMPANY          [x] │       │
│                              │ ────────────────────  │       │
│                              │ Acme Corp is a       │        │
│                              │ Series B startup...  │        │
│                              │                      │        │
│                              │ View in Manus        │        │
│                              └─────────────────────┘        │
│                                  GREEN border               │
│                             CENTER CARD (largest)            │
│                                                             │
│  [Debug: running: 0 | results: 1]                           │
└─────────────────────────────────────────────────────────────┘


STATE: SECOND RESULT ARRIVES (first pushes to satellite)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┌─────────────────────────────────────────────────────────────┐
│  [Command Bar]                                              │
│                                                             │
│                    ┌────────────┐                            │
│                    │ Company    │ ← old result (satellite)   │
│                    │ Acme: B... │   smaller, 70% opacity     │
│                    └────────────┘   auto-fades after 30s     │
│                              ┌─────────────────────┐        │
│                              │ DEAL            [x] │        │
│                              │ ──────────────────── │        │
│                              │ Stage: Proposal     │        │
│                              │ Next: Send SOW      │        │
│                              └─────────────────────┘        │
│                             ← NEW result takes center       │
│                                                             │
│  [Debug: running: 0 | results: 2]                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Design Direction — JARVIS HUD

The overlay should feel like a heads-up display, not a chat app. Think Iron Man's JARVIS:

### What JARVIS gets right
- Information appears WHERE you need it, not in a sidebar
- Cards are translucent — you see through them to the real world
- Text is crisp, high-contrast against dark translucent backgrounds  
- Information is structured — not paragraphs, but **labeled fields**
- Things animate in/out smoothly — no jarring pop-ins
- Idle state is nearly invisible — only activates when needed

### Card Design Ideas

```
┌─ Current (debug mode) ──────────────────────────────┐
│  Flat colored borders, basic text dump               │
│  Functional but not polished                         │
└──────────────────────────────────────────────────────┘

┌─ Target: JARVIS-style card ─────────────────────────┐
│                                                      │
│  ╔══════════════════════════════════════════════════╗ │
│  ║  COMPANY ─────────────────── ● live  ──── [×]  ║ │
│  ║  ──────────────────────────────────────────────  ║ │
│  ║                                                  ║ │
│  ║  Acme Corp                                       ║ │
│  ║  ├─ Stage:     Series B                          ║ │
│  ║  ├─ Size:      150 employees                     ║ │
│  ║  ├─ Funding:   $45M (Sequoia)                    ║ │
│  ║  ├─ Industry:  Fintech                           ║ │
│  ║  └─ Last deal: Q2 2025, $120k                    ║ │
│  ║                                                  ║ │
│  ║  Recent: Launched enterprise tier last month      ║ │
│  ║                                                  ║ │
│  ║  ─────────────────────── View in Manus ────────  ║ │
│  ╚══════════════════════════════════════════════════╝ │
│                                                      │
│  • Dark translucent bg (rgba(10, 15, 30, 0.85))     │
│  • Thin colored left border (tool-specific color)    │
│  • Structured fields, not prose paragraphs           │
│  • Monospace for numbers/stats                       │
│  • Status indicator (● live / ● done / ● streaming)  │
│  • Subtle glow on the border color                   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Color per tool type

```
  who_is_this       ████  purple    #a78bfa
  meeting_brief     ████  green     #4ade80
  live_fact_check   ████  yellow    #facc15
  company_snapshot  ████  blue      #60a5fa
  deal_status       ████  orange    #fb923c
  competitive_intel ████  red       #f87171
  number_lookup     ████  cyan      #22d3ee
```

### Text hierarchy on cards

```
  LABEL          12px uppercase, 60% opacity, tracking-wider
  ────────       1px line, 10% white
  Key value      14px, white 90%, the main content
  ├─ Field:      14px, field name 50% opacity, value 90%
  Secondary      12px, white 60%, supporting info
  Link           12px, tool color, underline on hover
```

### Animation ideas

```
  Card appears:    slide in from right + fade in (300ms)
  Card dismissed:  fade out + scale down slightly (200ms)
  Satellite push:  current center slides to orbit position (500ms ease)
  Streaming text:  characters appear with slight delay (typewriter)
  Spinner:         pulsing dots + rotating border gradient
  Idle → active:   background dims slightly (10% black overlay behind cluster)
```

### Satellite chips (old results orbiting center)

```
  ┌──────────────────────┐
  │ COMPANY         [×]  │
  │ Acme: Series B, 150  │
  │ employees, fintech   │
  └──────────────────────┘
  
  • Max 120 chars, truncated
  • 70% opacity, fades to 0% over 30s
  • Click to expand back to center
  • Tool color as left border accent
```

---

## Architecture Summary

```
┌─ TWO INDEPENDENT PATHS ─────────────────────────────┐
│                                                      │
│  FAST (Kimi)                DEEP (Manus)             │
│  ──────────                 ──────────               │
│  Ctrl+H / Chat             Ctrl+1-7 / Buttons        │
│  2-3 second response       30-120 seconds            │
│  Chat bubbles              Radial cards              │
│  No external data          Notion + GDrive + Web      │
│  Good for: quick Q&A,      Good for: research,       │
│  screenshot analysis        data lookup, briefs       │
│                                                      │
│  They don't touch each other.                        │
└──────────────────────────────────────────────────────┘
```

## Key files to know

```
electron/ManusHelper.ts       ← Manus API (create, poll, parse, auto-continue)
electron/ProcessingHelper.ts  ← Prompt templates for all 7 tools
electron/LLMHelper.ts         ← Kimi API (chat, vision)
electron/WindowHelper.ts      ← Fullscreen transparent window
electron/shortcuts.ts         ← All keybind registration

src/components/ManusTools/    ← All the card/display components
  RadialLayout.tsx            ← The spotlight/radial positioning
  ToolPrompt.tsx              ← Input box when tool triggered
  ToolSpinner.tsx             ← Loading indicator
  ToolResultCard.tsx          ← Result display card

src/_pages/Queue.tsx          ← Main view, wires everything together
```

---

## What needs design work

1. **Card styling** — current cards are debug-colored boxes. Need JARVIS aesthetic.
2. **Top command bar** — needs to look integrated, not bolted on.
3. **Satellite behavior** — orbit positions, fade timing, expand-on-click.
4. **Progressive text rendering** — typewriter effect as Manus streams.
5. **Idle/active state transitions** — how the overlay feels when nothing is happening vs. when tools are running.
