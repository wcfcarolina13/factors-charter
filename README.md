# The Factor's Charter

A 1720s text-based mercantile RPG. Originally a Claude artifact; now also runs as an installable PWA.

## Play

- Live build: `https://factors-charter.pages.dev` — open and play, no setup required.
- On desktop (≥1024 px wide, pointer device): wide-view layouts (Letters reading pane, Map + Ledger combined, Outpost three-pane) and inline period illustrations alongside scenes. Toggle Compact / Wide view from the in-game `☰ Menu`.
- Inside Claude: open `factors_charter.jsx` as an artifact (legacy; live-AI prose still works here via the artifact host).

## Develop

```bash
npm install
npm run dev      # http://localhost:5173/
npm run build    # → dist/
npx vite preview # serve production build locally
```

## Architecture

- `factors_charter.jsx` — the game (single-file React monolith, runs both as artifact and as PWA entry).
- `src/main.jsx` — PWA entry point; mounts `FactorsCharter`.
- `vite.config.js` — Vite + `vite-plugin-pwa`.

The PWA is deterministic-only. Every prose generator has an inline fallback and the live-AI path is short-circuited in PWA mode. The artifact runtime is unchanged — the host still bridges Anthropic credentials there.

See `CLAUDE.md` for design conventions, world-building rules, and contribution patterns.
