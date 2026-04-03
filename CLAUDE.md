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
Keybind (Ctrl+1-7)
  → Electron main process
  → ProcessingHelper builds prompt + attaches 30s mic transcript
  → Manus API (agent mode, async polling)
  → Result JSON with "display" field
  → Renderer parses + renders as visual card
```

Two AI paths:
- **Kimi K2.5** — fast chat, screenshot analysis (Ctrl+H)
- **Manus API** — deep research tools (Ctrl+1-7), returns structured JSON

## Keybinds

| Key | Tool | Card Header | Input |
|-----|------|-------------|-------|
| Ctrl+1 | meeting_brief | BRIEF | Person or company name |
| Ctrl+2 | company_snapshot | COMPANY | Company name |
| Ctrl+3 | deal_status | DEAL | Client name |
| Ctrl+4 | number_lookup | STAT | What stat to find |
| Ctrl+5 | who_is_this | PERSON | Context (+ screenshot) |
| Ctrl+6 | live_fact_check | FACT CHECK | Claim to verify (+ screenshot) |
| Ctrl+7 | competitive_intel | INTEL | Competitor name (+ screenshot) |

Utility: Ctrl+B toggle, Ctrl+H screenshot, Ctrl+R reset, Ctrl+Shift+Space center window.

## File Map

### Backend — `electron/`

Don't touch unless changing tool behavior, API integration, or keybinds.

| File | Purpose |
|------|---------|
| `main.ts` | App startup, AppState singleton, window creation |
| `ipcHandlers.ts` | All IPC message routing between renderer ↔ main |
| `shortcuts.ts` | Global keybind registration (Ctrl+1-7, Ctrl+B, etc.) |
| `ProcessingHelper.ts` | **Manus prompts live here.** Tool templates, few-shot examples, transcript injection |
| `ManusHelper.ts` | Manus API client — task creation, polling, JSON extraction |
| `LLMHelper.ts` | Kimi/Moonshot API client for chat and vision |
| `TranscriptionHelper.ts` | Groq Whisper — transcribes 30s mic buffer on tool trigger |
| `ScreenshotHelper.ts` | Screenshot capture and queue management |
| `WindowHelper.ts` | Transparent fullscreen overlay window config |
| `preload.ts` | Context bridge — exposes `window.electronAPI` to renderer |

### Frontend — `src/`

#### Designer Files (visual/UI work)

| File | What it controls |
|------|-----------------|
| `components/ManusTools/PresetRenderer.tsx` | **All 7 visual card types** — stat cards, bar charts, donut charts, comparison bars, profile cards, verdict badges, checklists, pipeline dots. This is where card visuals live. |
| `components/ManusTools/RadialLayout.tsx` | **Card container** — card appearance, sizing (300px input → 480px complete), opacity, drag handling, auto-fade lifecycle, framer-motion animations |
| `components/Queue/QueueCommands.tsx` | **Top-left command bar** — tool buttons (1-7), chat toggle, settings toggle, keybind reference |
| `index.css` | Global styles, Tailwind config, shimmer animation keyframes |

#### App Structure (usually don't need to touch)

| File | Purpose |
|------|---------|
| `_pages/Queue.tsx` | Main page — state management, IPC listeners, mic capture setup |
| `components/ManusTools/PhysicsEngine.ts` | d3-force simulation — card positioning, zone gravity, center repulsion |
| `components/ui/ModelSelector.tsx` | LLM model switching panel |
| `components/ui/toast.tsx` | Notification toasts |
| `App.tsx` | Root component, view routing |

#### Legacy (unused)

`components/ManusTools/presets/*.tsx` — old individual card components. All rendering is now in `PresetRenderer.tsx`. These files are dead code.

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

## Card Lifecycle

```
input (300px) → pending → thinking → complete (480px) → fade (30s) → deleted
                                         ↑
                                    hover resets fade timer
```

## Physics

Cards use d3-force simulation. Each card is assigned a zone (NE, E, SE, NW, W, SW, N, S). Zone gravity pulls cards to edges. Constant center repulsion keeps the middle clear. Cards repel each other (no attraction). Drag overrides physics permanently.

## Mic Transcription

Always-on. MediaRecorder captures mic at 250ms intervals into a rolling 30s buffer. On any Ctrl+1-7 press, buffer is sent to Groq Whisper, transcribed, and injected into the Manus prompt as `LIVE CONTEXT`.

## Prompt Structure

Each Manus call sends:
1. System prompt (shared) — JSON API role, all 7 display schemas as examples
2. Agency framing (per tool) — "You are a consulting analyst..."
3. Few-shot example (randomly rotated from pool of 2-3 per tool)
4. `Input: {query}\nOutput:` trigger

Demo mode (`DEMO_MODE=true`) tells Manus to skip web browsing and answer from training data.

## Conventions

- Stage specific files only, never `git add -A`
- Push to `sixandeight/cluely` remote, `main` branch
- `.env` is gitignored — never commit API keys
- Tailwind for styling, no CSS modules
- framer-motion for card enter/exit animations
- All card rendering goes through PresetRenderer, not individual preset files
