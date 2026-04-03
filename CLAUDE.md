# Manusman

Real-time consulting overlay for live calls. Electron app with transparent fullscreen window, Manus AI agent for research, Kimi K2.5 for chat/vision, Groq Whisper for mic transcription.

## Quick Start

```bash
npm install
npm start        # runs vite + electron concurrently
```

Requires `.env` with: `KIMI_API_KEY`, `MANUS_API_KEY`, `GROQ_API_KEY`. Optional: `DEMO_MODE=true` for fast responses from training data.

## Architecture

```
Keybind (Ctrl+1-4) or Passive Listener
  → Electron main process
  → ProcessingHelper builds prompt + attaches 30s mic transcript
  → Manus API (agent mode, async polling)
  → Result JSON with "display" field
  → Renderer parses + renders as visual card on overlay
  → Card fades after 30s, deleted from DOM
```

Three AI paths:
- **Kimi K2.5** — fast chat, screenshot analysis (Ctrl+H)
- **Manus API** — research tools (Ctrl+1-4), returns structured JSON
- **Groq Whisper** — mic transcription, injected as context into Manus prompts

## Keybinds

| Key | Tool | Card Header | Input |
|-----|------|-------------|-------|
| Ctrl+1 | intel | INTEL | Company, person, or topic (text) |
| Ctrl+2 | deal_status | DEAL | Client name (text) |
| Ctrl+3 | prep | PREP | Takes screenshot → generates slides |
| Ctrl+4 | live_fact_check | FACT CHECK | Claim to verify (screenshot) |

Utility: Ctrl+B toggle, Ctrl+H screenshot, Ctrl+R reset, Ctrl+Shift+Space center window.

**Passive Listener:** Always running. Every 3s, checks mic transcript for entity mentions (company names, people). Auto-triggers intel cards with 60s per-entity cooldown, 10s global cooldown, max 3 auto-cards visible.

## File Map

### Backend — `electron/`

| File | Purpose |
|------|---------|
| `main.ts` | App startup, AppState singleton, window creation |
| `ipcHandlers.ts` | All IPC message routing between renderer ↔ main |
| `shortcuts.ts` | Global keybind registration (Ctrl+1-4) |
| `ProcessingHelper.ts` | **Manus prompts live here.** Tool templates, few-shot examples, transcript injection, display format schemas |
| `ManusHelper.ts` | Manus API client — task creation, polling, JSON extraction, typo repair |
| `LLMHelper.ts` | Kimi/Moonshot API client for chat and vision |
| `TranscriptionHelper.ts` | Groq Whisper — transcribes mic buffer on tool trigger |
| `ScreenshotHelper.ts` | Screenshot capture and queue management |
| `WindowHelper.ts` | Transparent fullscreen overlay window config |
| `preload.ts` | Context bridge — exposes `window.electronAPI` to renderer |

### Frontend — `src/`

#### Designer Files (visual/UI work)

| File | What it controls |
|------|-----------------|
| `components/ManusTools/PresetRenderer.tsx` | **All 8 visual card types** — stat cards, bar charts, donut charts, comparison bars, profile cards, verdict badges, checklists, pipeline dots, slides. |
| `components/ManusTools/RadialLayout.tsx` | **Card container** — card appearance, sizing, opacity, drag handling, auto-fade lifecycle, framer-motion animations |
| `components/Queue/QueueCommands.tsx` | **Top-left command bar** — tool buttons (1-4), chat toggle, settings toggle, keybind reference |
| `index.css` | Global styles, Tailwind config, shimmer animation keyframes |

#### App Logic

| File | Purpose |
|------|---------|
| `_pages/Queue.tsx` | Main page — state management, IPC listeners, mic capture, passive listener wiring |
| `components/ManusTools/PhysicsEngine.ts` | d3-force simulation — card positioning, zone gravity, center repulsion |
| `components/ManusTools/PassiveListener.ts` | Auto-trigger hook — 3s interval, regex entity extraction, cooldown management |

#### Legacy (unused)

`components/ManusTools/presets/*.tsx` — old individual card components. All rendering is now in `PresetRenderer.tsx`.

`renderer/` — original React app from the fork. Unused.

## Display Formats

Manus returns JSON with a `display` field. PresetRenderer switches on it:

| display | What it renders | Key fields |
|---------|----------------|------------|
| `stat_card` | Big number + trend bars | value, label, trend[], sentiment |
| `chart` | Bar chart or donut | chart_type, datasets[], labels[] |
| `comparison` | Dual progress bars per metric | us_name, them_name, metrics[] |
| `profile` | Name/role/company card | name, role, company, details[], sentiment |
| `verdict` | TRUE/FALSE badge | claim, verdict, confidence, evidence |
| `checklist` | Priority dots + checkbox items | title, context[], items[] |
| `pipeline` | Stage progress dots | client, stages[], current_stage, risk |
| `slides` | Swipeable meeting prep slides | title, slides[{heading, bullets[]}] |

Manus dynamically picks the best format based on the query. The intel tool can return any format. Each tool prompt includes rotating few-shot examples showing different formats.

## Card Lifecycle

```
input (300px) → pending → thinking → complete (480px, 520px for slides) → fade (30s) → deleted
                                         ↑
                                    hover resets fade timer
```

## Physics

d3-force simulation. Cards assigned to zones (NE, E, SE, NW, W, SW, N, S). Zone gravity pulls cards to edges. Constant center repulsion keeps the middle clear. Cards repel each other. Drag overrides physics permanently. No attraction between cards.

## Mic Transcription

Always-on. MediaRecorder captures mic at 250ms intervals into a rolling 30s buffer. On any Ctrl+1-4 press, buffer is sent to Groq Whisper, transcribed, and injected into the Manus prompt BEFORE the Input/Output trigger.

## Passive Listener

Runs every 3s. Grabs last 3s of mic audio, transcribes via Groq, regex-scans for entities (capitalized multi-word names, company suffixes). Checks cooldowns (60s per entity, 10s global, max 3 auto-cards). If new entity found, auto-fires intel tool. Auto-cards get an "AUTO" badge.

## Prompt Structure

Each Manus call sends:
1. System prompt (shared) — architecture context, JSON output rules, all display format examples
2. Mode — demo (training data only) or production (web research)
3. Agency framing (per tool) — "You are a consulting analyst..."
4. Few-shot example (randomly rotated from pool of 2-7 per tool)
5. Transcript (if available) — placed BEFORE the Input/Output trigger
6. `Input: {query}\nOutput:` trigger

## Conventions

- Stage specific files only, never `git add -A`
- Push to `sixandeight/cluely` remote, `main` branch
- `.env` is gitignored — never commit API keys
- Tailwind for styling
- framer-motion for card enter/exit animations
- All card rendering goes through PresetRenderer, not individual preset files
- Manus API: mode "agent" is faster and cheaper than "speed"
