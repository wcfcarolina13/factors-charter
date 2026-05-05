# The Factor's Charter

A 1720s text-based mercantile RPG. Originally a Claude artifact; now also runs as an installable PWA.

## Play

- Live build: `https://factors-charter.pages.dev` (configure an AI provider in Settings to enable AI prose).
- Inside Claude: open `factors_charter.jsx` as an artifact.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173/
npm test         # Vitest
npm run build    # → dist/
```

## Architecture

- `factors_charter.jsx` — the game (single-file React monolith, runs both as artifact and as PWA entry).
- `src/main.jsx` — PWA entry point; mounts `FactorsCharter`.
- `src/llm/` — pluggable LLM providers (Anthropic, Ollama).
- `src/settings/` — config store + settings UI.
- `vite.config.js` — Vite + `vite-plugin-pwa`.

See `CLAUDE.md` for design conventions, world-building rules, and contribution patterns.
