# Manusman

Real-time consulting overlay powered by Manus AI, Kimi K2.5, and Groq Whisper. Transparent fullscreen HUD for live calls, meetings, and research.

## Setup

```bash
git clone https://github.com/sixandeight/manusman.git
cd manusman
npm install
cp .env.example .env   # fill in your API keys
npm start
```

### API Keys

| Key | Service | Required |
|-----|---------|----------|
| `MANUS_API_KEY` | Manus AI (research tools) | Yes |
| `KIMI_API_KEY` | Kimi/Moonshot (chat + vision) | Yes |
| `GROQ_API_KEY` | Groq Whisper (mic transcription) | For mic features |
| `DEMO_MODE` | Set to `true` for demo with fake data | Optional |

## Keybinds

| Key | Tool | What it does |
|-----|------|-------------|
| Ctrl+1 | Intel | Company/person research |
| Ctrl+2 | Deal Status | Pipeline and deal tracking |
| Ctrl+3 | Prep | Meeting prep slides |
| Ctrl+4 | Fact Check | Live claim verification |
| Ctrl+B | Toggle | Show/hide overlay |
| Ctrl+H | Screenshot | Capture screen for analysis |
| Ctrl+R | Reset | Clear all cards |

## Demo Mode

Set `DEMO_MODE=true` in `.env` to run with pre-loaded context (Rex Corp scenario). No live API calls needed for Manus — uses training data to generate cards.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Onboarding](docs/ONBOARDING.md)

## License

ISC
