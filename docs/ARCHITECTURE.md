# Manusman — Consulting Assistant Overlay

## What This Is

Fullscreen transparent Electron overlay for real-time consulting assistance during calls, meetings, and email. Click-through everywhere except interactive UI zones.

## Stack

- **Electron** — fullscreen transparent overlay, always-on-top
- **React + Vite + Tailwind** — renderer UI
- **Kimi K2.5** (Moonshot AI) — fast chat, screenshot analysis
- **Manus API** — deep async tasks (Notion/GDrive lookups, research)

## Architecture

```
┌─ TRIGGERS ─────────────────────────────────────────────┐
│  Ctrl+H          screenshot → Kimi instant analysis    │
│  Ctrl+Enter      process screenshots via Kimi          │
│  Ctrl+1-4        keybind → text input → Manus tool     │
│  Ctrl+5-7        screenshot → Manus tool               │
│  Ctrl+B          toggle overlay visibility             │
│  Ctrl+R          reset all                             │
└────────────────────────────────────────────────────────┘
        │
        ▼
┌─ TWO PATHS ────────────────────────────────────────────┐
│                                                        │
│  FAST (Kimi):  screenshot/chat → 2-3s → chat bubble   │
│  DEEP (Manus): keybind → prompt → Manus API → poll    │
│                → result card (30-120s)                 │
│                                                        │
│  They don't touch each other.                          │
└────────────────────────────────────────────────────────┘
        │
        ▼
┌─ DISPLAY: Radial/Spotlight Layout ─────────────────────┐
│  • Fullscreen transparent, click-through               │
│  • Command bar: fixed top-left                         │
│  • Radial cluster: offset center-right (68%)           │
│  • Newest result = large center card                   │
│  • Older results orbit as satellite chips              │
│  • Satellites auto-fade after 30s                      │
│  • Multiple tools run in parallel                      │
└────────────────────────────────────────────────────────┘
```

## Manus Tools (7)

| # | Tool | Trigger | What Manus Does |
|---|------|---------|-----------------|
| Ctrl+1 | meeting_brief | keybind+text | Notion → past notes, open items, context |
| Ctrl+2 | company_snapshot | keybind+text | Web + Notion → company research card |
| Ctrl+3 | deal_status | keybind+text | Notion → pipeline stage, blockers |
| Ctrl+4 | number_lookup | keybind+text | GDrive + Notion → specific stat |
| Ctrl+5 | who_is_this | screenshot | Notion + web → person profile card |
| Ctrl+6 | live_fact_check | screenshot | GDrive + web → verify a claim |
| Ctrl+7 | competitive_intel | screenshot | GDrive + web → competitor comparison |

## Key Files

```
electron/
├── main.ts              App entry, AppState singleton
├── WindowHelper.ts      Fullscreen transparent window, click-through
├── LLMHelper.ts         Kimi/Moonshot API (chat + vision)
├── ManusHelper.ts       Manus API client (create task, poll, parse)
├── ProcessingHelper.ts  Routes triggers → Kimi or Manus, builds prompts
├── ipcHandlers.ts       All IPC between main ↔ renderer
├── preload.ts           Exposed APIs to renderer
├── shortcuts.ts         Global keybind registration
├── ScreenshotHelper.ts  Screenshot capture + queue

src/
├── App.tsx              Root, view routing, global types
├── _pages/Queue.tsx     Main view — command bar + radial overlay
├── _pages/Solutions.tsx Legacy solutions view (Kimi path)
├── components/ManusTools/
│   ├── RadialLayout.tsx   Radial spotlight display
│   ├── ToolPrompt.tsx     Text input for keybind tools
│   ├── ToolSpinner.tsx    "Researching..." status indicator
│   └── ToolResultCard.tsx Result card display
```

## Environment (.env)

```
KIMI_API_KEY=...          Moonshot AI key
KIMI_BASE_URL=https://api.moonshot.ai/v1
KIMI_MODEL=moonshot-v1-8k
MANUS_API_KEY=...         Manus agent API key
```

## Running

```bash
npm install
npm start        # dev mode
npm run dist     # production build
```

## Future (Out of Scope)

- **Live transcript**: Record user mic → pass as context to all Manus calls. Architecture has a `transcript` slot in every tool prompt template ready for this.
- **Partner's pipeline**: Button → Manus reads WhatsApp → writes to Notion DB (built separately)
