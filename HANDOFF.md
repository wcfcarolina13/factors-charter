# HANDOFF — The Factor's Charter

**Date:** 2026-05-06
**For:** Bradley (or a fresh Claude session) resuming this project
**Branch:** `main`
**Live build:** https://factors-charter.pages.dev (auto-deploys from `main`)
**Status:** PWA port shipped. Game playable as installable web app + still runnable as Claude artifact. Deferred polish items below.

> Previous handoff (Session 8, content/world work) archived in `git log` at commit `f6b47b6`. The world-content reference is now in `CLAUDE.md` and `CHANGELOG.md`.

---

## What shipped this session

**The Factor's Charter now runs as an installable PWA.** Same `factors_charter.jsx` monolith, plus a thin Vite scaffold around it. Inside Claude, it still runs as an artifact unchanged.

### New surface area
- `index.html`, `vite.config.js`, `src/main.jsx` — Vite + PWA scaffold
- `src/llm/{index,anthropic,ollama}.js` — pluggable LLM provider layer + dispatcher
- `src/llm/*.test.js` — Vitest, 19 tests covering store + dispatcher + providers
- `src/settings/{store,SettingsPanel}.{js,jsx}` — config storage + provider config UI
- `public/{icon-192,icon-512,icon-512-maskable}.png` — PWA icons (placeholder, see deferred)
- `public/robots.txt`, `meta description` in `index.html` — SEO basics
- `CLAUDE.md` "Runtime targets" + "Development & deploy" sections
- `README.md` rewritten for play / develop / architecture quick-ref

### One-line edit to the JSX
- `callClaude` now gates on `window.storage` to detect Claude-artifact mode. In artifact mode → `legacyAnthropicCall` (byte-identical to original). In PWA mode → dynamic import of `src/llm/index.js` → configured provider.
- Settings overlay surfaced from title-screen footer + in-game `☰ Menu`. First-launch banner ("Set up an AI provider to begin") shows only when no provider configured.

### Reference docs
- Spec: `docs/superpowers/specs/2026-05-05-pwa-port-design.md`
- Plan (15 tasks across 7 phases): `docs/superpowers/plans/2026-05-05-pwa-port.md`
- Lighthouse audit (post-fix): `docs/download.pdf`

### Lighthouse scores after quick-wins commit (`37fbcbc`)
| Category | Score |
|---|---|
| Performance | 68 |
| Accessibility | **100** |
| Best Practices | 96 |
| SEO | **100** |

Performance is gated by the 1.27 MB bundle on cold Slow 4G; TBT 0 ms, CLS 0.001, Speed Index 5.0 s. Real-device + warm SW cache is much faster.

---

## Deferred items — pick up here

### 1. Bundle splitting (biggest perf win)
**The 1.27 MB `dist/assets/index-*.js` is the JSX monolith plus React.** Lighthouse: "Reduce unused JavaScript — 445 KiB."

Constraint: CLAUDE.md says "the file is monolithic by design — easier to ship as a single artifact, easier to keep in one place. Don't fragment it." So we can't split the JSX itself.

What we CAN do without violating that:
- Lazy-load views that only render mid-game (`MapView`, `OutpostView`, `LedgerView`, `JournalView`, etc.) via `React.lazy()` + `Suspense`. Title screen → first view path stays in the main bundle; everything else becomes a chunk.
- Lazy-load AI helpers if they're heavy (the system prompt is large but inline so won't move the needle).
- Vite `manualChunks` config to push React/ReactDOM into a separate vendor chunk for better caching.

Estimated lift: Performance score from 68 → low/mid 80s. Worth it before any wider distribution.

### 2. Source maps in production
Lighthouse: "Missing source maps for large first-party JavaScript." One Vite config flag in `vite.config.js`:
```js
build: { sourcemap: true },
```
Trade-off: ~2× build output, exposes the unminified source. For a single-player game with no IP secrets, that's fine. Helps in-browser debugging of any future bug reports.

### 3. Polished PWA icons
Current icons are 192/512/maskable PNGs generated from a pure-Python solid-color circle (no glyph). They're valid but ugly. Options:
- Hand-design a wax-seal "⁂" or "❦" on parchment cream in Affinity / Figma, export at the three sizes.
- Or commission via image gen — feed it the palette (`#f0e3c4` parchment, `#5c1a08` sealing-wax red) and the typography brief (1720s logbook).
- Drop them into `public/icon-{192,512,512-maskable}.png`, push to main, Cloudflare rebuilds. Manifest already references them.

### 4. aria-labels on inner-game inputs
Title-screen inputs got aria-labels in this session. Lighthouse only audits the home page so it scored 100, but inner views still have unlabeled inputs at:
- `factors_charter.jsx:6432` — provider config field (already labeled correctly via `<label>` wrap; double-check)
- `factors_charter.jsx:6626` — number input for goods qty in trade rows
- `factors_charter.jsx:6804` — Imagine prompt textarea (readonly)
- `factors_charter.jsx:6965` — Manuscript export textarea (readonly)
- `factors_charter.jsx:7195` — Successor name input on charter-end screen
- `factors_charter.jsx:8370` — Ship naming input
- `factors_charter.jsx:8900` — Import textarea on in-game menu

Each needs a one-line `aria-label="..."` addition.

### 5. Custom domain (optional)
`factors-charter.pages.dev` works fine. If you want a custom domain, Cloudflare Pages → factors-charter → Custom domains → Set up a custom domain. CNAME or apex via Cloudflare DNS is one click.

### 6. Future LLM providers (the abstraction is ready)
The dispatcher is set up so adding a provider is just a new file + one registry entry:
```js
// src/llm/<name>.js
export const provider = { id, label, fields, call: async (...) => text };
// src/llm/index.js
const PROVIDERS = { anthropic, ollama, <name> };
```
Candidates that match Bradley's "cheaper or free" exploration:
- **OpenRouter** — aggregator with free Llama 3, Mistral 7B, etc. Headers similar to OpenAI.
- **Groq** — very fast Llama 3, generous free tier. OpenAI-compatible.
- **Google AI Studio (Gemini Flash)** — free tier. Different request shape.
- **Together AI** — many free models, OpenAI-compatible.
None are blocked; each is its own ~30-line file.

### 7. CSP / HSTS / COOP / Trusted Types (Best Practices score)
Lighthouse flags these for any site without explicit security headers. Cloudflare Pages can serve a `_headers` file in `public/` to set them. For a single-player static game with no auth or third-party iframes, the practical risk is minimal — but a strict CSP would close out the Best Practices category to 100. Not blocking.

---

## How to verify the project is healthy on resume

```bash
cd ~/pontus/factors-charter
git status                           # should be clean on main
npm install                          # if node_modules absent
npm test                             # 19/19 across 4 suites
npm run build                        # dist/ produced, PWA precache 12 entries
npx vite preview                     # localhost:4173, click around
```

JSX parser sanity check (run after any edit to `factors_charter.jsx`):
```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); try { p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines'); } catch(e) { console.log('ERR:',e.message); }"
```

Live deploy verification:
```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://factors-charter.pages.dev/
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://factors-charter.pages.dev/manifest.webmanifest
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://factors-charter.pages.dev/sw.js
```

---

## Architecture invariants (don't break)

- `factors_charter.jsx` stays at repo root (artifact compatibility).
- The `src/` tree is PWA-only. Artifact runtime never reaches it (`isPwaMode` + `lazy()` gating).
- `legacyAnthropicCall` body is byte-identical to the original `callClaude`. Don't drift it.
- `safeStorage` keys (`factor_save_*`, `factor_saves_index`) and the LLM config key (`factor_charter_llm_config_v1`) must not collide.
- All existing 7 callsites of `callClaude` use the unchanged `(prompt) => result` signature. Don't change the signature without updating callers.

---

## Bradley's working style (unchanged)

- Mobile, Claude app. Short responses preferred.
- "do that now", "ship it", "proceed", "keep going" — stop discussing, write code.
- "this doesn't work" — believe him; trace the actual error.
- Values period accuracy and dry tone over feature volume.
- Drive folder ("Factor's Charter", id `1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU`) is the canonical save backup channel.
- Has begun working locally on his Mac (`~/pontus/factors-charter`) in addition to artifact use. The PWA build serves both Mac and mobile from one URL now.

---

## Drive folder

**Folder:** "Factor's Charter"
**ID:** `1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU`
**URL:** https://drive.google.com/drive/folders/1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU

**Should contain:** `CLAUDE.md`, `CHANGELOG.md`, `HANDOFF.md`, `WORLD_NOTES.md`, `DESIGN_NOTES.md`, manuscript and AI-log JSON exports.
