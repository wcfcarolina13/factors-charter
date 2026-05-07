# HANDOFF — The Factor's Charter

**Date:** 2026-05-07
**For:** Bradley (or a fresh Claude session) resuming this project
**Branch:** `main`
**Live build:** https://factors-charter.pages.dev (auto-deploys from `main`)
**Status:** PWA is deterministic-only and mobile-first. Live-AI lives only in the artifact runtime, as legacy. Pool expansion is the next chapter of work.

> Previous handoff (PWA port + deferred items) archived in `git log` at commit `6c22153`.

---

## What shipped this session

**The PWA player path is now deterministic-only.** Removed all live-AI plumbing from the PWA build. Players land on the title screen with no setup, no API key prompt, no provider configuration. Every prose generator (`genVoyageEncounter`, `genOutcome`, `genLetter`, `genIndiamanLetterPayload`, `genPursueThread`, `genArrivalVignette`, `genAwayDigest`) falls through to its inline fallback in PWA. Artifact runtime is byte-identical — `legacyAnthropicCall` still inline, host still bridges Anthropic.

### Removed
- `src/llm/` — Anthropic + Ollama providers, dispatcher, 15 tests
- `src/settings/` — SettingsPanel, store, 4 tests
- Title-screen ⚙ Settings button + in-game ☰ Menu Settings entry
- "Set up an AI provider to begin" first-launch banner
- All `<Suspense>` mounts of SettingsPanel + the lazy import
- `showSettings` / `setShowSettings` / `onOpenSettings` props throughout
- Dead `isPwaMode` constant (was preserved in the strip on the assumption other code still used it; verified no consumers remained)
- `docs/download.pdf` (stray Lighthouse audit from the previous session)

### Added / changed
- `callClaude` short-circuits in PWA mode — returns the empty-result shape directly so callers fall through to fallback
- CSP `connect-src` tightened: dropped `api.anthropic.com`, `localhost:*`, `127.0.0.1:*`. Kept `api.github.com` (GitHub backup feature still ships) and Google Fonts hosts.
- `DESIGN_NOTES.md` gets a dated **Deterministic Pool Audit** section — per-generator inventory + expansion priorities. This is the backlog for ongoing pool work.
- `CLAUDE.md` "Runtime targets" rewritten

### Reference docs
- Design spec: `docs/superpowers/specs/2026-05-07-strip-pwa-live-ai-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-07-strip-pwa-live-ai.md`

---

## Deferred items — pick up here

### 1. Pool expansion (the new main backlog)

`DESIGN_NOTES.md` has the per-generator audit. Four of the original five flagged concerns are already closed in same-day same-PR work. Only `genLetter` remains — it needs Bradley's tonal authoring.

1. ~~**`genOutcome` journal phrase.**~~ **Closed `1395a75`** — two 8-entry random pools (encounter / letter-reply) of `{prose, journal}` pairs.
2. ~~**`genArrivalVignette` per-port strings.**~~ **Closed `fbcbb52`** — six port-distinctive vignettes.
3. **`genLetter` faction × mood pool.** 6 factions × 3 moods = up to 18 templates. **Open — top priority.** Faction voices (Brotherhood, Crown, Mission, Dutch, Rajah, Company) are tonally distinct enough that Bradley should author or closely review each. Suggested workflow: open the artifact, trigger letters from each faction in different mood states, capture the live-AI outputs from `aiLog`, prune to a small canonical pool per faction, paste into a new `FALLBACK_LETTERS` table keyed by `[from][mood]`, modify `genLetter` to look up + random-pick within the bucket.
4. ~~**`genVoyageEncounter` scenario types.**~~ **Closed `e74efb7`** — 12-entry random pool covering weather / navigation / other vessels / maintenance / wildlife / atmospheric / crew.
5. ~~**`genAwayDigest` event-aware variants.**~~ **Closed `4db5b84`** — event-aware branched pools (raid / incident / indiaman / construction / harvest / letter / default), 18 entries across 7 branches via `pickAwayDigestFallback`.

Authoring workflow for the remaining genLetter work: run a charter in artifact mode (live-AI generates), capture promising prose into `aiLog`, save the manuscript JSON, paste into Claude Code in this repo to expand the pool literals, commit. Each expansion commit can/should reference the audit entry it clears.

### 2. Polished PWA icons (still pending from previous handoff #3)

Chrome's manifest validation flags `icon-192.png` as "not a valid image" even though `file` reports a valid PNG. The placeholders are RGB-only (no alpha), and Chrome's PWA validator wants alpha. Replacing all three (`192`, `512`, `512-maskable`) with hand-designed icons (wax-seal "⁂" or "❦" on parchment cream) would close this out. Manifest already references them.

### 3. Lazy-load mid-game views (was previous handoff #1)

The 1.13 MB main chunk is still hefty. The handoff #1 plan still applies but the impact is modest. Lower priority than pool expansion.

### 4. Custom domain (still optional, was #5)

`factors-charter.pages.dev` works fine. Cloudflare Pages → factors-charter → Custom domains if you want a vanity URL.

### 5. Trusted Types in CSP

Could add `require-trusted-types-for 'script'` to fully close out Lighthouse Best Practices. Needs verification that React 18 + the inline `<style>` blocks don't trip it. Not blocking.

---

## How to verify the project is healthy on resume

```bash
cd ~/pontus/factors-charter
git status                           # should be clean on main
npm install                          # if node_modules absent
npm run build                        # dist/ produced, no SettingsPanel chunk
npx vite preview                     # localhost:4173, click around — title → Begin → game
```

JSX parser sanity check (run after any edit to `factors_charter.jsx`):
```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); try { p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines'); } catch(e) { console.log('ERR:',e.message); }"
```

Live deploy verification:
```bash
curl -sI https://factors-charter.pages.dev/ | grep -i content-security
curl -s -o /dev/null -w "/manifest.webmanifest %{http_code}\n" https://factors-charter.pages.dev/manifest.webmanifest
curl -s -o /dev/null -w "/sw.js %{http_code}\n" https://factors-charter.pages.dev/sw.js
```

---

## Architecture invariants (don't break)

- `factors_charter.jsx` stays at repo root (artifact compatibility).
- `legacyAnthropicCall` body stays byte-identical to its current behavior — artifact users depend on it.
- The `src/` tree is PWA-only build infrastructure (currently just `main.jsx`). The artifact never reaches it.
- All gameplay, save format (`ensureShape`), content tables, and generators live in `factors_charter.jsx` — both runtimes inherit them automatically.
- `safeStorage` keys (`factor_save_*`, `factor_saves_index`) must not collide with anything else. The orphan `factor_charter_llm_config_v1` from the removed system is left in users' localStorage as harmless legacy.

---

## Bradley's working style (unchanged)

- Mobile, Claude app. Short responses preferred.
- "do that now", "ship it", "proceed", "keep going" — stop discussing, write code.
- "this doesn't work" — believe him; trace the actual error.
- Values period accuracy and dry tone over feature volume.
- Drive folder ("Factor's Charter", id `1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU`) is the canonical save backup channel.
- Now playing the PWA build at https://factors-charter.pages.dev primarily.
