# Strip Live-AI from PWA — Design

**Date:** 2026-05-07
**Status:** Design approved, ready for implementation plan

---

## Problem

The PWA build of *The Factor's Charter* currently routes prose generation through an opt-in live-AI provider (Anthropic BYO key, or Ollama on localhost). Configuring this is heavy for any user — API key on a phone, mixed-content rules for localhost Ollama, CORS configuration, model selection, billing concerns. The setup wall blocks mobile-first onboarding.

Live-AI in the PWA also creates ongoing maintenance friction: provider divergence, CSP that has to allow many origins, settings UI state bugs (one of which surfaced this session and was patched in `5d07e0a`).

The artifact runtime (`claude.ai`) does not have this problem — it gets free Claude integration via the host. Live-AI is a natural fit there.

## Decisions Anchored

1. **Live-AI fate (player path):** strip from PWA entirely. The artifact path keeps `legacyAnthropicCall` inline, byte-identical to its current behavior.
2. **Artifact role:** legacy / passive. Still compiles and runs, but is not a feature target. Parity is opportunistic — when divergence becomes a felt problem, we notice.
3. **Sequencing:** ship the structural cut now, plus a generator-by-generator pool audit captured in `DESIGN_NOTES.md`. Cosmetic pool thinness is deferred; functional gaps (no fallback, broken fallback) are release blockers patched in this same PR.

## Scope

### In scope (this PR)

- Delete `src/llm/` and `src/settings/` from the PWA build
- Refactor `callClaude` in `factors_charter.jsx` so PWA mode short-circuits to the deterministic fallback path
- Remove SettingsPanel surface area from title-screen footer and in-game `☰ Menu`
- Remove the first-launch "Set up an AI provider to begin" banner
- Tighten CSP `connect-src` in `public/_headers` (drop `api.anthropic.com`, `localhost`, `127.0.0.1`)
- Add a dated pool audit to `DESIGN_NOTES.md` covering all six generators
- Patch any generator with a non-functional fallback (release blocker)
- Refresh `CLAUDE.md`, `README.md`, `CHANGELOG.md`; replace `HANDOFF.md` with one for this work

### Out of scope (separate work)

- Pool expansion itself — the audit drives this as ongoing work
- Polished PWA icons (deferred handoff item #3)
- New gameplay features
- Visual / asset-richness improvements (now structurally unblocked, but not started here)
- Custom domain
- Future LLM provider integrations (item #6) — moot in PWA after this PR

## Architecture Changes

### Files deleted

| Path | Reason |
|---|---|
| `src/llm/anthropic.js` | Anthropic provider — PWA only, no longer needed |
| `src/llm/ollama.js` | Ollama provider — PWA only, no longer needed |
| `src/llm/index.js` | Provider dispatcher — PWA only |
| `src/llm/anthropic.test.js` | Tests for deleted module |
| `src/llm/ollama.test.js` | Tests for deleted module |
| `src/llm/index.test.js` | Tests for deleted module |
| `src/settings/SettingsPanel.jsx` | AI provider config UI — PWA only |
| `src/settings/store.js` | Settings persistence — PWA only |
| `src/settings/store.test.js` | Tests for deleted module |

The `src/llm/` and `src/settings/` directories become empty and are removed.

### Edits in `factors_charter.jsx`

- Remove the top-of-file `lazy(() => import('./src/settings/SettingsPanel.jsx'))` block
- Refactor `callClaude`: artifact mode → `legacyAnthropicCall` (unchanged); PWA mode → return the deterministic-fallback signal directly (no dynamic import)
- Remove all `<Suspense>` wrappers around `<SettingsPanel>`
- Remove the title-screen footer Settings button
- Remove the in-game `☰ Menu` Settings entry
- Remove the "Set up an AI provider to begin" first-launch banner gate
- Remove `settingsConfigured` helper and any other helpers that exclusively serve the removed UI
- Remove any state vars / handlers that become unreferenced after the cut

### Things that stay exactly as-is

- `legacyAnthropicCall` body and the artifact runtime path
- All six generators (`genVoyageEncounter`, `genOutcome`, `genLetter`, `genArrivalVignette`, `genAwayDigest`, `genIndiamanLetterPayload`) and their deterministic fallback bodies
- Save format, save migration funnel (`ensureShape`), all gameplay
- All content tables (`COMMODITIES`, `PORTS`, `LORE`, `SCRIPTED_ARRIVALS`, `MAJOR_COMMITMENTS`, etc.)
- Cloudflare Pages deploy pipeline
- Vite vendor split, sourcemaps, security headers (other than the `connect-src` tightening)
- The aria-labels added in `9173d86`

## Pool Audit Format

A new section in `DESIGN_NOTES.md`, dated 2026-05-07, with one block per generator:

```
### gen<Name>
- Pool size: N distinct snippets / templates
- Variety axes: keyed by [destination, faction, ship-condition, ...]
- Felt quality: H/M/L — short prose note
- Call frequency: estimate per 3-year charter
- Expansion priority: H/M/L (= frequency × thinness)
- Target pool on expansion: rough number
- Release blocker?: yes/no
```

The six generators each get a block. The audit is a living document — Bradley updates it as he plays and notices gaps; expansion work cites and clears entries.

**Release blocker rule:** if any generator's fallback returns null, throws, or returns obviously broken / placeholder content in PWA mode, it is patched in this same PR. Cosmetic thinness is fine to defer; functional gaps are not.

## CSP Tightening

`public/_headers` `Content-Security-Policy` `connect-src` directive becomes:

```
connect-src 'self' https://api.github.com https://fonts.googleapis.com https://fonts.gstatic.com
```

Removed origins: `https://api.anthropic.com`, `http://localhost:*`, `http://127.0.0.1:*`.

Kept origins: `api.github.com` (GitHub backup feature still ships in the JSX), Google Fonts. Modest Lighthouse Best Practices improvement.

## Migration

Existing PWA users who configured Anthropic or Ollama have a `factor_charter_llm_config_v1` key in localStorage. After this change no code reads it. The orphan key is left in place — harmless, sub-kilobyte, not worth a one-time cleanup migration. Game saves (`factor_save_*`, `factor_saves_index`) are untouched.

## Verification

Pre-push:
1. `npm run build` produces a clean `dist/` — no `SettingsPanel-*.js` chunk, smaller main chunk
2. JSX parser sanity check on the edited monolith
3. `npx vite preview` locally — title screen loads with no AI banner, "Begin" leads straight into the game, a voyage triggers the deterministic fallback path, DevTools shows no console errors and no failed fetches

Post-push:
4. `curl -sI https://factors-charter.pages.dev/` — confirm CSP `connect-src` is tightened
5. Manifest + service worker still 200
6. One artifact smoke test from Bradley: load the JSX as an artifact in Claude.ai, confirm `legacyAnthropicCall` still works (manual)

## Doc Updates

- **CLAUDE.md** — "Runtime targets" section rewritten: PWA = deterministic-only, artifact = legacy live-AI, parity is opportunistic, asset-richness now unblocked
- **HANDOFF.md** — replaced with a fresh handoff for this work
- **README.md** — provider config sections removed from the dev quickref
- **CHANGELOG.md** — entry for this cut
- **DESIGN_NOTES.md** — receives the new dated pool audit section
