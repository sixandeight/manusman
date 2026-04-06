---
name: Demo Mode Setup
description: Demo mode config — fictional Rex Corp scenario, Notion import files, DEMO_MODE=true in .env, hardcoded context in ProcessingHelper.ts
type: project
---

Demo mode uses a fictional consulting scenario to showcase all 8 card types.

**Scenario:** CCN London consulting for Rex Corp (enterprise SaaS analytics). Phase 2 proposal ($2.4M) pending CEO sign-off. Palantir counter-bidding.

**Key people (3 only):**
- Rex Heng — VP Strategy, primary contact, champion
- Kiki Zhang — CEO, economic buyer, wants ROI model
- Nathan Karri — CTO, technical ally, wants case study

**How it works:**
- `DEMO_MODE=true` in `.env` activates it
- `ProcessingHelper.ts` has `DEMO_SYSTEM` (lean prompt) + `DEMO_CONTEXT` (fake Notion/GDrive/Instagram data)
- Display hints in prompt nudge Manus toward the right card type per query pattern
- No agency framing in demo mode, no web research — uses injected context only
- Sources tagged as "Notion — Rex Corp workspace", "Google Drive — Q1 Shared Folder", "Instagram — @rexheng" etc.

**Notion import files:** `demo-notion/` folder at project root. Drag into Notion to create fake workspace pages. Structure:
- `Rex Corp — Summary.md` (top-level overview)
- `Rex Corp/` — Company Overview, Key People, Deal Tracker, Meeting Notes (3 entries)
- `Google Drive/` — Phase1 Results, Phase2 Proposal, Competitive Intel, Market Research

**Demo script (all keybinds):**
1. Ctrl+1 "Rex Heng" → profile card
2. Ctrl+1 "Rex Corp" → stat_card ($48M ARR + trend)
3. Ctrl+2 "Rex Corp" → pipeline (proposal stage, medium risk)
4. Ctrl+3 (anything) → slides (4 meeting prep slides)
5. Ctrl+1 "Rex Corp vs Palantir" → comparison (5 metrics)
6. Ctrl+4 "Rex Corp grew 42%" → verdict (TRUE)
7. Ctrl+1 "analytics market" → donut chart (market share)
8. Ctrl+1 "what should I ask" → checklist (action items)

**Why:** Built for product demos. Manus still runs but has all data pre-loaded so responses are fast, relevant, and always showcase the best card type.
