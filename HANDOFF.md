# HANDOFF — The Factor's Charter

**Date:** 2026-05-07 (after cross-device save sync)
**For:** Bradley (or a fresh Claude session) resuming this project
**Branch:** `main`
**Live build:** https://factors-charter.pages.dev (auto-deploys from `main`)
**Status:** The two-mode design is now fully shipped. Both Subsystem B (desktop rendering mode) and Subsystem A (cross-device save sync) are on `main`.

> Previous handoff archived in `git log` at commit `956e14b`.

---

## What shipped this session (the full day)

In one long session today, the project went from "PWA with live-AI provider config" to:

1. **Live-AI stripped from PWA** — deterministic-only player path; mobile-first onboarding fixed.
2. **Pool expansions** — every concern from the deterministic pool audit closed in same-day same-PR work: `genOutcome`, `genArrivalVignette`, `genVoyageEncounter`, `genAwayDigest`, and `genLetter` (per-sender pools, 18 templates × 6 senders).
3. **Desktop rendering mode** — `useViewportMode()` gates four desktop variants (Letters reading pane, Map+Ledger Overview, Outpost three-pane, encounters/arrivals/letters with inline illustrations from a content-hash-keyed cache).
4. **Cross-device save sync** — Cloudflare Pages Function + KV; themed playthrough IDs; silent push-on-save / pull-on-launch; conflict modal with auto-export of the loser; live-`gs` ref to avoid the launch-time-stale-closure bug; `aiLog` stripped from synced payload to stay under the 256 KB cap.

### Reference docs
- Spec (covers both subsystems): `docs/superpowers/specs/2026-05-07-two-mode-design.md`
- Plan B (UX divergence): `docs/superpowers/plans/2026-05-07-ux-divergence.md` — shipped
- Plan A (save sync): `docs/superpowers/plans/2026-05-07-save-sync.md` — shipped

---

## Deferred items — pick up here

### 1. Polished PWA icons

Chrome's manifest validation still flags `icon-192.png`. Replacing the placeholder PNGs with hand-designed icons closes this out.

### 2. Lazy-load mid-game views (lower priority)

The 1.13+ MB main chunk is still hefty. Lower priority than #1.

### 3. Trusted Types in CSP

Closes out Lighthouse Best Practices. Not blocking.

### 4. Background audio for desktop mode

Was deliberately deferred from the two-mode spec. Period ambient (wind, wharf, quill) on desktop title and letter screens. Its own future spec.

### 5. Sync UX polish (sub-items, all low priority)

- ~~Concurrent-pull race: `pullNow` lacks an `inFlight` guard~~ — **shipped 2026-05-07.** Separate `pullInFlight` ref guards `pullNow`; concurrent calls return `{ status: 'busy' }` (no-op for existing callers). Push and pull stay independent.
- ~~Conflict-detection sensitivity: `localStorage.setItem` failure silent in `writePointer`~~ — **shipped 2026-05-08.** `writePointer` now returns success/failure and surfaces failures via `setStatus('error')` + `setError(...)`. Avoids the silent-quota-failure → false-positive-conflict path.
- ~~Retroactive "Sync this charter" menu entry exposes raw `setGs` to `Header`~~ — **shipped 2026-05-08.** Replaced with focused `onEnableSync` callback; `setGs` removed from `Header` props entirely.

---

## How to verify the project is healthy on resume

```bash
cd ~/pontus/factors-charter
git status
npm install
npm test                              # 33 tests across 4 files
npm run build
npx vite preview                      # http://localhost:4173/
```

JSX parser:
```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines');"
```

Live deploy headers:
```bash
curl -sI https://factors-charter.pages.dev/ | grep -i content-security
```

Sync end-to-end (after the deploy lands):
```bash
# PUT a test save — use a unique ID so you don't clobber any real charter
curl -X PUT 'https://factors-charter.pages.dev/api/save?id=pelican-salt-pepper-1234' \
  -H 'content-type: application/json' \
  -d '{"day": 1, "test": true}'
# GET it back
curl 'https://factors-charter.pages.dev/api/save?id=pelican-salt-pepper-1234'
```

---

## Architecture invariants (don't break)

- `factors_charter.jsx` stays at repo root. Still monolithic by design.
- `legacyAnthropicCall` body unchanged.
- Mobile UI byte-identical to its pre-PR state.
- `src/util/` is React-free pure logic. The React hooks (`useViewportMode`, `useSyncState`) and components live in the JSX monolith.
- `src/util/style-prefix.js` is the single source of truth for the image-gen style prefix.
- The illustration cache key is `stableHash(cleanProse(prose))`. Pinned test enforces hash stability — bump `factor_illustration_cache_v1` to `_v2` if the hash function changes.
- The playthrough ID format is `^[a-z]+-[a-z]+-[a-z]+-\d{4}$`. Both client and server validate. Wordlists in `src/util/playthrough-id.js` can be APPENDED (existing IDs unaffected) but not reordered or truncated.
- `gs` shape additions (`syncEnabled`, `playthroughId`, `syncPromptShown`) flow through `ensureShape`. Per-slot sync pointer is device-local, NOT in `gs`.
- `aiLog` is intentionally stripped from the synced payload (debug-only, drives gs size past 256 KB late-game). On pull, `sync.applyPull(localGs, cloudBody)` merges so the local `aiLog` survives. Don't `setGs(remote.body)` directly — always go through `applyPull`.
- `makeSuccessorState` and `makeRenewedState` deliberately do NOT reset sync fields. The same player's sync choice persists across charter generations. If you change this, the prompt re-fires and the cloud copy gets orphaned under a new ID.

---

## Bradley's working style (unchanged)

(see prior handoffs — same as before)
