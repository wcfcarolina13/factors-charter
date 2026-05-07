# Strip PWA Live-AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PWA build deterministic-only (mobile-first, zero AI setup friction) while leaving the artifact runtime path byte-identical.

**Architecture:** Strip `src/llm/` and `src/settings/` from the PWA. Refactor `callClaude` so PWA mode short-circuits to the existing deterministic fallback (no dynamic import). Remove all SettingsPanel surface area from `factors_charter.jsx`. Tighten CSP. Audit all 7 generator fallbacks into `DESIGN_NOTES.md` as the post-ship expansion backlog.

**Tech Stack:** React 18, Vite 5, vite-plugin-pwa, Vitest, Cloudflare Pages.

**Reference spec:** [docs/superpowers/specs/2026-05-07-strip-pwa-live-ai-design.md](../specs/2026-05-07-strip-pwa-live-ai-design.md)

---

## Task 1: Inventory deterministic fallbacks

**Files:**
- Read: `factors_charter.jsx:4001-4310` (all 7 generators)

This task is read-only investigation. Output is captured for use in Task 7 (audit) and Task 2 (patches if needed). No commit at the end of this task.

The seven generators to inventory:

| Generator | Defined at | Notes |
|---|---|---|
| `genVoyageEncounter` | line ~4001 | Called on every voyage |
| `genOutcome` | line ~4044 | Called after every choice in encounters |
| `genLetter` | line ~4095 | Called when an auto-letter triggers |
| `genIndiamanLetterPayload` | line ~4156 | Called for the quarterly Indiaman cadence |
| `genPursueThread` | line ~4200 | Called when player pursues an open thread |
| `genArrivalVignette` | line ~4254 | Called on first arrival at each port |
| `genAwayDigest` | line ~4280 | Called when player returns from a long voyage |

- [ ] **Step 1: Read each generator block**

For each generator, read the function body and capture:
- The exact `fallback` value (string, object, or absent)
- What `call.parsed` is expected to contain on success
- Whether the function returns sensibly when `call.parsed` is null
- An estimate of how many distinct fallback outputs exist (often: 1, because fallbacks are typically a single inline string/object)
- The variety axes (e.g. does it differ by port? by faction? by ship state?)

Use `Read` with offset/limit on `factors_charter.jsx`, one chunk per generator (~50 lines each).

- [ ] **Step 2: Identify any release-blocker generators**

A generator is a release blocker if, in PWA mode after live-AI is stripped, it would:
- Throw an exception
- Return null / undefined where the caller expects an object
- Return an obviously broken placeholder (e.g. `"TODO"`, empty string when caller renders it as prose)

A single coherent fallback string is **not** a blocker — that's cosmetic thinness, fine to defer.

- [ ] **Step 3: Capture audit data structurally**

Produce a temporary audit table (in scratch / memory / a draft TODO) for each generator:

```
Generator: gen<Name>
Pool size: N
Variety axes: <list>
Felt quality: H/M/L (note)
Call frequency: <estimate per 3-year charter>
Expansion priority: H/M/L
Target on expansion: <rough number>
Release blocker: yes/no (if yes: why)
```

This data lands in `DESIGN_NOTES.md` in Task 7. Carry it forward.

---

## Task 2: Patch any release-blocker fallbacks

**Files:**
- Modify: `factors_charter.jsx` (only if Task 1 surfaced blockers)

If Task 1 found zero blockers, **skip this task entirely and proceed to Task 3.**

If blockers exist, patch each one with a minimal coherent fallback. The fallback must:
- Not throw
- Return the same shape the caller expects (match what `call.parsed` would have looked like)
- Be period-appropriate prose (1720s logbook tone — see `CLAUDE.md` aesthetic palette)

- [ ] **Step 1: For each blocker, write the minimal patch**

Show the before/after for each blocker. Example shape (no blocker assumed concrete here — fill in from Task 1):

```jsx
// Before:
const result = call.parsed; // throws downstream when null

// After:
const fallback = { prose: 'The wind held. We made our reckoning by the chart.', flags: {}, hooks: [] };
const result = call.parsed || fallback;
```

- [ ] **Step 2: Re-read the modified region to verify the edit applied cleanly**

- [ ] **Step 3: Run JSX parser sanity check**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); try { p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines'); } catch(e) { console.log('ERR:',e.message); process.exit(1); }"
```

Expected: `PARSE OK <N> lines`.

- [ ] **Step 4: Commit**

```bash
git add factors_charter.jsx
git commit -m "fix(generators): patch release-blocker fallbacks before PWA live-AI strip"
```

---

## Task 3: Refactor `callClaude` to short-circuit in PWA mode

**Files:**
- Modify: `factors_charter.jsx:3647-3670`

The current `callClaude` does a dynamic `import('./src/llm/index.js')` in PWA mode. After this refactor, PWA mode returns the empty-result shape directly so the existing `call.parsed || fallback` pattern in every generator picks the fallback.

- [ ] **Step 1: Replace the function body**

Edit `factors_charter.jsx` lines 3647-3670:

```jsx
// Artifact mode: window.storage exists and the host bridges Anthropic auth/CORS.
// PWA mode: no live AI; return an empty result so callers fall through to deterministic content.
// Returns: { parsed, raw, prompt, startedAt, endedAt, error }.
async function callClaude(prompt) {
  const isArtifactMode = typeof window !== 'undefined' && !!window.storage;
  if (isArtifactMode) {
    return legacyAnthropicCall(prompt);
  }
  const now = Date.now();
  return {
    parsed: null,
    raw: '',
    prompt,
    startedAt: now,
    endedAt: now,
    error: 'PWA deterministic mode — no live AI',
  };
}
```

- [ ] **Step 2: Run the JSX parser sanity check**

Same command as Task 2 Step 3. Expected: `PARSE OK`.

- [ ] **Step 3: Verify no remaining references to `src/llm/`**

```bash
grep -n "src/llm" factors_charter.jsx
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add factors_charter.jsx
git commit -m "refactor(callClaude): short-circuit PWA mode to deterministic fallback"
```

---

## Task 4: Strip SettingsPanel surface from `factors_charter.jsx`

**Files:**
- Modify: `factors_charter.jsx` (multiple regions — see steps)

This task removes all UI and state related to the AI provider settings panel.

- [ ] **Step 1: Remove the top-of-file lazy import block (lines 1-14)**

Replace:

```jsx
import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';

const isPwaMode = typeof window !== 'undefined' && !window.storage;
const SettingsPanel = isPwaMode
  ? lazy(() => import('./src/settings/SettingsPanel.jsx'))
  : null;
const settingsConfigured = () => {
  if (!isPwaMode) return true;
  try {
    return !!localStorage.getItem('factor_charter_llm_config_v1');
  } catch {
    return false;
  }
};
```

With:

```jsx
import React, { useState, useEffect, useRef } from 'react';

const isPwaMode = typeof window !== 'undefined' && !window.storage;
```

(`lazy` and `Suspense` are no longer imported. `SettingsPanel` and `settingsConfigured` are deleted. `isPwaMode` is preserved — other code may still gate on it for other purposes.)

- [ ] **Step 2: Remove the first-launch banner (lines ~5186-5203 of the unedited file)**

Find the `{/* FIRST-LAUNCH BANNER */}` block and delete it entirely:

```jsx
{/* FIRST-LAUNCH BANNER */}
{isPwaMode && !settingsConfigured() && (
  <div style={{ /* ... */ }}>
    <strong>Set up an AI provider to begin.</strong>{' '}
    <button onClick={onOpenSettings} style={{ /* ... */ }}>Open Settings</button>
  </div>
)}
```

- [ ] **Step 3: Remove the title-screen Settings button (lines ~5225-5238 of unedited)**

Find and delete:

```jsx
{isPwaMode && (
  <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
    <button
      onClick={onOpenSettings}
      style={{ /* ... */ }}
    >
      ⚙ Settings
    </button>
  </div>
)}
```

- [ ] **Step 4: Remove `onOpenSettings` prop from TitleScreen signature**

Edit the `TitleScreen` function signature (line ~5043):

```jsx
// Before:
function TitleScreen({ saves, onNewGame, onContinue, onRestore, onDeleteSlot, onOpenSettings }) {

// After:
function TitleScreen({ saves, onNewGame, onContinue, onRestore, onDeleteSlot }) {
```

- [ ] **Step 5: Remove the in-game ☰ Menu Settings entry (lines ~7232-7240)**

Find and delete:

```jsx
{isPwaMode && (
  <button
    className="ghost-button"
    style={{ width: '100%', textAlign: 'left', marginBottom: '0.3rem' }}
    onClick={() => { setMenuOpen(false); onOpenSettings && onOpenSettings(); }}
  >
    ⚙ Settings
  </button>
)}
```

- [ ] **Step 6: Remove `onOpenSettings` prop from GameHub and Header signatures**

Edit `GameHub` signature (line ~5351):

```jsx
// Before:
function GameHub({ gs, setGs, lastSavedAt, onReturnToTitle, onSuccession, onRenewal, onOpenSettings }) {

// After:
function GameHub({ gs, setGs, lastSavedAt, onReturnToTitle, onSuccession, onRenewal }) {
```

Edit `Header` signature (line ~7003):

```jsx
// Before:
function Header({ gs, onReturnToTitle, onSuccession, onRenewal, onOpenSettings }) {

// After:
function Header({ gs, onReturnToTitle, onSuccession, onRenewal }) {
```

Edit the `<Header>` JSX inside `GameHub` (line ~6248) to drop the `onOpenSettings` prop:

```jsx
// Before:
<Header gs={gs} onReturnToTitle={onReturnToTitle} onSuccession={onSuccession} onRenewal={onRenewal} onOpenSettings={onOpenSettings} />

// After:
<Header gs={gs} onReturnToTitle={onReturnToTitle} onSuccession={onSuccession} onRenewal={onRenewal} />
```

- [ ] **Step 7: Remove `showSettings` state + the two Settings overlay mounts in the root component**

Edit the root component (around line 9050):

```jsx
// Before:
const [showSettings, setShowSettings] = useState(false);
```

Delete that line.

Edit the title-phase render (lines ~9150-9168) to remove the Settings overlay block AND the `onOpenSettings` prop on `<TitleScreen>`:

```jsx
// Before:
<TitleScreen
  saves={savesIndex}
  onNewGame={handleNewGame}
  onContinue={handleContinue}
  onRestore={handleRestore}
  onDeleteSlot={handleDeleteSlot}
  onOpenSettings={() => setShowSettings(true)}
/>
{showSettings && SettingsPanel && (
  <div style={{ /* ... */ }}>
    <Suspense fallback={null}>
      <SettingsPanel onClose={() => setShowSettings(false)} />
    </Suspense>
  </div>
)}

// After:
<TitleScreen
  saves={savesIndex}
  onNewGame={handleNewGame}
  onContinue={handleContinue}
  onRestore={handleRestore}
  onDeleteSlot={handleDeleteSlot}
/>
```

Edit the game-phase render (lines ~9191-9205) similarly:

```jsx
// Before:
<>
  <GameHub gs={gs} setGs={setGs} lastSavedAt={lastSavedAt} onReturnToTitle={handleReturnToTitle} onSuccession={handleSuccession} onRenewal={handleRenewal} onOpenSettings={() => setShowSettings(true)} />
  {showSettings && SettingsPanel && (
    <div style={{ /* ... */ }}>
      <Suspense fallback={null}>
        <SettingsPanel onClose={() => setShowSettings(false)} />
      </Suspense>
    </div>
  )}
</>

// After:
<GameHub gs={gs} setGs={setGs} lastSavedAt={lastSavedAt} onReturnToTitle={handleReturnToTitle} onSuccession={handleSuccession} onRenewal={handleRenewal} />
```

(The fragment `<>...</>` collapses to a single root element when there's only one child — keep it as just the `<GameHub />` element.)

- [ ] **Step 8: Final references check**

```bash
grep -nE "SettingsPanel|onOpenSettings|showSettings|setShowSettings|settingsConfigured|factor_charter_llm_config_v1|src/llm|src/settings" factors_charter.jsx
```

Expected: no output. Every reference should be gone.

- [ ] **Step 9: Run JSX parser sanity check**

Same parser command as before. Expected `PARSE OK`.

- [ ] **Step 10: Commit**

```bash
git add factors_charter.jsx
git commit -m "refactor(jsx): remove SettingsPanel surface area + first-launch AI banner"
```

---

## Task 5: Delete `src/llm/` and `src/settings/`

**Files:**
- Delete: `src/llm/anthropic.js`, `src/llm/ollama.js`, `src/llm/index.js`
- Delete: `src/llm/anthropic.test.js`, `src/llm/ollama.test.js`, `src/llm/index.test.js`
- Delete: `src/settings/SettingsPanel.jsx`, `src/settings/store.js`, `src/settings/store.test.js`

- [ ] **Step 1: Remove the files via git**

```bash
git rm -r src/llm src/settings
```

Expected: 9 files removed. Empty parent directories are also removed by `git rm -r`.

- [ ] **Step 2: Verify the directory is gone**

```bash
ls src/
```

Expected: only `main.jsx` remains in `src/`.

- [ ] **Step 3: Run tests to confirm clean state**

```bash
npm test
```

Expected: `No test files found, exiting with code 1` OR Vitest's "no tests" output. Both are acceptable — the project no longer has tests, and that's intentional. (If Vitest exits non-zero with "no test files," that's expected; flag if it's any other error.)

- [ ] **Step 4: Run the build to confirm the JSX still compiles**

```bash
npm run build
```

Expected: build succeeds. The `dist/assets/SettingsPanel-*.js` chunk should be **gone**. The main chunk should be slightly smaller (no dispatcher / providers in the dependency graph).

Note the new chunk hashes for verification later.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete src/llm and src/settings — PWA no longer needs them"
```

---

## Task 6: Tighten CSP `connect-src` in `public/_headers`

**Files:**
- Modify: `public/_headers`

- [ ] **Step 1: Read current file**

```bash
cat public/_headers
```

Note the existing `Content-Security-Policy` line.

- [ ] **Step 2: Edit the `connect-src` directive**

Change:

```
connect-src 'self' https://api.anthropic.com https://api.github.com https://fonts.googleapis.com https://fonts.gstatic.com http://localhost:* http://127.0.0.1:*;
```

To:

```
connect-src 'self' https://api.github.com https://fonts.googleapis.com https://fonts.gstatic.com;
```

(Removed: `https://api.anthropic.com`, `http://localhost:*`, `http://127.0.0.1:*`. Kept: `'self'`, `api.github.com` for the still-shipping GitHub backup feature, Google Fonts.)

Also remove the trailing comment block about future LLM providers (no longer relevant for the PWA path):

```
# If a future LLM provider is added (OpenRouter, Groq, Gemini, Together AI),
# extend connect-src above with that provider's API origin.
```

- [ ] **Step 3: Rebuild to copy `_headers` into `dist/`**

```bash
npm run build
cat dist/_headers | grep -i content-security
```

Expected: shows the tightened `connect-src`.

- [ ] **Step 4: Commit**

```bash
git add public/_headers
git commit -m "chore(headers): tighten CSP connect-src after PWA live-AI strip"
```

---

## Task 7: Add pool audit to `DESIGN_NOTES.md`

**Files:**
- Modify: `DESIGN_NOTES.md` (append a new dated section)

- [ ] **Step 1: Read DESIGN_NOTES.md to find the right insertion point**

```bash
head -20 DESIGN_NOTES.md
```

Find the conventional structure of the document. Insert the audit either at the top (latest first) or wherever the project's existing convention places dated entries. If unclear, place it right after the title heading.

- [ ] **Step 2: Write the audit section**

Insert the following block (filling in `<...>` with the data captured in Task 1):

```markdown
## Deterministic Pool Audit — 2026-05-07

Captured at the moment live-AI was stripped from the PWA player path. Every entry is the static fallback that PWA players will see; live-AI in the artifact runtime is unaffected. Update by playthrough — if a generator's fallback feels repetitive after several charters, lower its felt-quality grade and bump expansion priority.

### genVoyageEncounter
- Pool size: <N>
- Variety axes: <list>
- Felt quality: <H/M/L> — <note>
- Call frequency: <estimate per 3-year charter>
- Expansion priority: <H/M/L>
- Target pool on expansion: <rough number>
- Release blocker?: <yes/no>

### genOutcome
- Pool size: <N>
...

### genLetter
...

### genIndiamanLetterPayload
...

### genPursueThread
...

### genArrivalVignette
...

### genAwayDigest
...
```

Each of the 7 generators gets its own block, populated from Task 1's inventory.

- [ ] **Step 3: Commit**

```bash
git add DESIGN_NOTES.md
git commit -m "docs(design): add 2026-05-07 deterministic pool audit"
```

---

## Task 8: Update `CLAUDE.md`, `README.md`, `CHANGELOG.md`

**Files:**
- Modify: `CLAUDE.md` (Runtime targets + Development & deploy sections)
- Modify: `README.md` (drop AI provider config from quickref)
- Modify: `CHANGELOG.md` (new entry)

- [ ] **Step 1: Update `CLAUDE.md` "Runtime targets" section**

Find the section starting `### Runtime targets` and replace with:

```markdown
### Runtime targets

The same `factors_charter.jsx` runs in two environments, with diverged AI behavior:

- **PWA build** (Vite + Cloudflare Pages): **deterministic only.** No live AI. Every generator (`genVoyageEncounter`, `genOutcome`, etc.) falls through to its inline fallback. No setup, no API keys, no provider configuration. Mobile-first.
- **Claude artifact** (legacy): host injects Anthropic credentials and bridges CORS. `callClaude` detects this path via `window.storage` and falls through to `legacyAnthropicCall`. Useful as a dev / playtest sandbox; not the player target.

Parity between runtimes is opportunistic. Game logic, content tables, and generators all live in the shared `factors_charter.jsx` so both runtimes get them automatically. PWA-only affordances (settings UIs, asset richness, etc.) are fine to add and won't appear in artifact — that's expected.
```

- [ ] **Step 2: Update `CLAUDE.md` "Development & deploy" section if it references the LLM dispatcher**

Remove any mentions of "configure provider in Settings," BYO key flows, or "src/llm/." Keep `npm run dev`, `npm run build`, `npm test`, `npx vite preview`, Cloudflare auto-deploy.

- [ ] **Step 3: Update `CLAUDE.md` "Adding an LLM provider" section if it still exists**

Delete it entirely. Adding live-AI providers to the PWA is no longer in scope. If the user wants live-AI in artifact, they edit `legacyAnthropicCall` inline.

- [ ] **Step 4: Update `README.md`**

Open `README.md`. Remove any sections that walk through configuring a live-AI provider, setting up Ollama, or BYO Anthropic keys. The play / develop / architecture quickref stays; the "first launch" instructions become "open the live URL or `npm run dev`."

- [ ] **Step 5: Append to `CHANGELOG.md`**

Insert a new dated entry at the top:

```markdown
## 2026-05-07 — Strip live-AI from PWA

PWA goes deterministic-only. Removed `src/llm/` (Anthropic + Ollama providers, dispatcher, all LLM tests) and `src/settings/` (SettingsPanel + store + tests). `callClaude` now short-circuits in PWA mode so every generator falls through to its inline fallback. Title-screen Settings button, in-game ☰ Menu Settings entry, and "Set up an AI provider to begin" first-launch banner all removed. CSP `connect-src` tightened — dropped `api.anthropic.com`, localhost / 127.0.0.1. Artifact runtime unchanged. Pool audit captured in `DESIGN_NOTES.md` as the post-ship expansion backlog.
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md CHANGELOG.md
git commit -m "docs: refresh CLAUDE.md, README.md, CHANGELOG.md for deterministic-only PWA"
```

---

## Task 9: Replace `HANDOFF.md`

**Files:**
- Modify: `HANDOFF.md` (full rewrite — the previous handoff was for the PWA port, now stale)

- [ ] **Step 1: Read existing `HANDOFF.md` for any deferred items still relevant**

```bash
cat HANDOFF.md
```

Items still pending after this PR:
- `#1` lazy-load mid-game views — no longer urgent (bundle dropped without React vendor weighting on app changes); leave noted but lower priority
- `#3` polished PWA icons — still pending, manifest validation still flags placeholder
- `#5` custom domain — still pending, optional
- `#7` Trusted Types / fuller CSP — partially addressed this round; trusted-types still deferred
- The new follow-on: pool expansion (drives from `DESIGN_NOTES.md` audit)

- [ ] **Step 2: Write the new `HANDOFF.md`**

Replace with:

```markdown
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

### Added / changed
- `callClaude` short-circuits in PWA mode — returns the empty-result shape directly so callers fall through to fallback
- CSP `connect-src` tightened: dropped `api.anthropic.com`, `localhost:*`, `127.0.0.1:*`. Kept `api.github.com`, Google Fonts
- `DESIGN_NOTES.md` gets a dated **Deterministic Pool Audit** section — per-generator inventory + expansion priorities. This is the backlog for ongoing pool work.
- `CLAUDE.md` "Runtime targets" rewritten

### Reference docs
- Design spec: `docs/superpowers/specs/2026-05-07-strip-pwa-live-ai-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-07-strip-pwa-live-ai.md`

---

## Deferred items — pick up here

### 1. Pool expansion (the new main backlog)

`DESIGN_NOTES.md` has the per-generator audit. Pick the highest-priority generator (likely `genVoyageEncounter` or `genArrivalVignette` — both are called often and have thin fallbacks), use the artifact runtime as your authoring environment (play, capture good outputs from the live AI, paste them into the JSX as expanded fallback pools), and update the audit entry as you ship more snippets.

Authoring workflow: run a charter in artifact, save the manuscript JSON (it captures `aiLog`), feed promising outputs through Claude Code in this repo to extend the pool literals, commit. Each expansion commit can/should reference the audit entry.

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
```

- [ ] **Step 3: Commit**

```bash
git add HANDOFF.md
git commit -m "docs: refresh HANDOFF for deterministic-only PWA + pool expansion backlog"
```

---

## Task 10: Local verification (build + preview)

**Files:**
- None modified

- [ ] **Step 1: Clean build**

```bash
rm -rf dist node_modules/.vite
npm run build 2>&1 | tail -20
```

Expected:
- Build succeeds
- `dist/assets/index-*.js` chunk is **smaller** than the previous build (no dispatcher / providers / SettingsPanel)
- No `dist/assets/SettingsPanel-*.js` chunk
- `dist/_headers` shows the tightened CSP
- PWA precache reports an entry count one or two lower than before (the SettingsPanel chunk and its map are gone)

- [ ] **Step 2: Local preview smoke test**

```bash
npx vite preview &
PREVIEW_PID=$!
sleep 2
curl -s -o /dev/null -w "preview / %{http_code}\n" http://localhost:4173/
kill $PREVIEW_PID 2>/dev/null
```

Expected: `preview / 200`. (For deeper verification, open `http://localhost:4173/` in a real browser, confirm title screen renders with no AI banner, click "Begin," confirm a voyage encounter triggers and renders fallback prose, watch DevTools Network tab for any failed fetch — there should be none to `api.anthropic.com` or `localhost:11434`.)

- [ ] **Step 3: JSX parser final check**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); try { p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines'); } catch(e) { console.log('ERR:',e.message); }"
```

Expected: `PARSE OK <N> lines`. Note the new line count (will be smaller than 9208 — by ~80-120 lines from the removals).

- [ ] **Step 4: Final references sweep**

```bash
grep -rE "src/llm|src/settings|SettingsPanel|settingsConfigured|onOpenSettings|showSettings|factor_charter_llm_config_v1" factors_charter.jsx src/ public/ docs/superpowers/ 2>/dev/null | grep -v "^docs/superpowers/specs/\|^docs/superpowers/plans/\|^Binary"
```

Expected: no matches (the spec / plan files reference these names in narrative context — that's fine; everything else should be clean).

If any matches show up outside spec/plan docs, fix them before pushing.

---

## Task 11: Push

**Files:**
- None — git push only

- [ ] **Step 1: Confirm clean working tree**

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 2: Show what's about to push**

```bash
git log --oneline origin/main..HEAD
```

Expected: 6-9 commits from this PR's tasks (one per task that included a commit; Task 2 may be skipped).

- [ ] **Step 3: Push**

```bash
git push origin main
```

Expected: success. Cloudflare Pages auto-deploys within ~1 minute.

---

## Task 12: Live verification

**Files:**
- None

- [ ] **Step 1: Wait for deploy + curl the headers**

```bash
sleep 60
curl -sI https://factors-charter.pages.dev/ | grep -iE "^(content-security|http/)"
```

Expected: `HTTP/2 200`, and the CSP `connect-src` line shows the tightened set (no `api.anthropic.com`, no `localhost:*`).

- [ ] **Step 2: Confirm no SettingsPanel chunk on the live site**

```bash
curl -s https://factors-charter.pages.dev/ | grep -oE '/assets/[^"]+\.js' | sort -u
```

Expected: only `index-*.js` and `react-vendor-*.js`. No `SettingsPanel-*.js`.

- [ ] **Step 3: Core URLs still 200**

```bash
curl -s -o /dev/null -w "/                      %{http_code}\n" https://factors-charter.pages.dev/
curl -s -o /dev/null -w "/manifest.webmanifest  %{http_code}\n" https://factors-charter.pages.dev/manifest.webmanifest
curl -s -o /dev/null -w "/sw.js                 %{http_code}\n" https://factors-charter.pages.dev/sw.js
```

Expected: all 200.

- [ ] **Step 4: Bradley's manual smoke (cannot be automated)**

Bradley loads `https://factors-charter.pages.dev` in his browser:
- Title screen renders, no AI banner
- "Begin" leads into the game
- A voyage encounter triggers and shows fallback prose (1720s tone, coherent — even if repetitive)
- DevTools Console: no errors, no CSP violation messages, no failed fetches to anthropic / localhost
- Optional: load the JSX as an artifact in Claude.ai — confirm `legacyAnthropicCall` path still works (live-AI prose generates as before)

Report any anomalies and patch them as a follow-up commit.

---

## Done

PWA is deterministic-only on `main`. Pool expansion is the next backlog (driven by `DESIGN_NOTES.md`). Artifact runtime untouched.
