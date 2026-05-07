# HANDOFF — The Factor's Charter

**Date:** 2026-05-07 (later same day, after the desktop-rendering work)
**For:** Bradley (or a fresh Claude session) resuming this project
**Branch:** `main`
**Live build:** https://factors-charter.pages.dev (auto-deploys from `main`)
**Status:** Desktop rendering mode shipped. Cross-device save sync (Subsystem A from the two-mode spec) is the next item — designed but not yet implemented; no plan written yet.

> Previous handoff archived in `git log` at commit `f996357`.

---

## What shipped this session

After the strip and the four pool expansions earlier today:

**Desktop rendering mode.** The PWA now adapts to viewport. Same `factors_charter.jsx`, same gameplay, same content — but on screens ≥1024 px with a pointer device, the layout unlocks two-column views and inline auto-generated period illustrations. Mobile UI is byte-identical to its pre-PR state.

### Added
- `useViewportMode()` hook + override key `factor_view_override` + Compact/Wide toggle in `☰ Menu`
- `<InlineIllustration>` component with content-hash-keyed illustration cache (LRU at 50 entries, localStorage backed)
- `<LetterReadingPane>` shared sub-component (mobile + desktop letter rendering both use it)
- `<LettersDesktop>` (inbox + reading pane, 24rem inbox, 320px illustration column, default selection = newest unread)
- `<DesktopOverview>` (Map + Ledger side-by-side, replaces both tabs with a single "Overview" tab on desktop)
- `OutpostView` three-pane variant (Standing / Under construction / Available)
- `effectiveTab` symmetric normalization (handles desktop ↔ mobile resize without persisting stale tab state)
- New `src/util/` tree: `text.js` (stableHash + cleanProse), `viewport.js` (detectMode + setOverride), `illustration-cache.js` (cache module + tests), `style-prefix.js` (single-source image-gen prefix shared between modal + cache)
- Restored vitest: 17 tests across `text.test.js` (9) and `illustration-cache.test.js` (8). Includes a pinned `stableHash` value test so accidental hash changes don't silently orphan everyone's illustration cache.

### Reference docs
- Design spec: `docs/superpowers/specs/2026-05-07-two-mode-design.md` (covers Subsystem B, which shipped, AND Subsystem A, which is the next item)
- Implementation plan: `docs/superpowers/plans/2026-05-07-ux-divergence.md` (Subsystem B only; A's plan still to be written)

---

## Deferred items — pick up here

### 1. Subsystem A: cross-device save sync (top priority)

Per the spec at `docs/superpowers/specs/2026-05-07-two-mode-design.md`. Cloudflare Pages Function at `functions/api/save.js` + KV namespace, themed-readable playthrough IDs (`coral-monsoon-pelican-1923` style), silent push-on-save / pull-on-launch / conflict modal with auto-export of the loser. Each save in `gs` gets `playthroughId`, `syncEnabled`, plus per-slot `lastKnownCloudVersion` in localStorage. First-launch sync prompt for new charters; retroactive enable for existing.

**Pre-deploy setup needed before the implementation plan can run:**
- Create KV namespace via Cloudflare dashboard or `wrangler kv:namespace create SAVES_KV`
- Bind the namespace to `SAVES_KV` in the factors-charter Pages project settings → Functions → KV namespace bindings

**Then write the implementation plan** via `superpowers:writing-plans` against the spec, and execute it via `superpowers:subagent-driven-development` (same flow as Subsystem B).

### 2. genLetter faction × mood pool (still open from earlier today)

The only remaining item from the deterministic pool audit. Faction voices need Bradley's tonal authoring. See `DESIGN_NOTES.md` "Concerns flagged" section.

### 3. Polished PWA icons

Chrome's manifest validation still flags `icon-192.png`. Replacing the placeholder PNGs with hand-designed icons closes this out. Manifest already references them.

### 4. Lazy-load mid-game views (lower priority)

The 1.13+ MB main chunk is still hefty. Lower priority than Subsystem A.

### 5. Trusted Types in CSP

Closes out Lighthouse Best Practices. Not blocking.

---

## How to verify the project is healthy on resume

```bash
cd ~/pontus/factors-charter
git status
npm install
npm test                              # 17 tests across 2 files
npm run build
npx vite preview                      # http://localhost:4173/
```

JSX parser:
```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines');"
```

Live deploy headers (CSP must include `https://image.pollinations.ai` in `img-src`):
```bash
curl -sI https://factors-charter.pages.dev/ | grep -i content-security
```

---

## Architecture invariants (don't break)

- `factors_charter.jsx` stays at repo root. Still monolithic by design.
- `legacyAnthropicCall` body unchanged.
- Mobile UI is byte-identical to its pre-desktop-mode state. Desktop affordances are purely additive and gated on `useViewportMode() === 'desktop'`.
- `src/util/` is React-free pure logic. The React hook `useViewportMode` and the React components (`<InlineIllustration>` etc.) live in the JSX monolith because they use React. Pure functions live in `src/util/`.
- `src/util/style-prefix.js` is the single source of truth for the image-gen style prefix. Both the cache module and the in-JSX `IllustrationModal` import it. Don't drift them.
- All gameplay, save format (`ensureShape`), content tables, and generators live in `factors_charter.jsx`.
- The illustration cache key is content-hashed via `stableHash(cleanProse(prose))`. The pinned test in `text.test.js` enforces hash stability — if you ever need to change the hash function, bump `factor_illustration_cache_v1` to `_v2` in `src/util/illustration-cache.js` so old caches don't get incorrectly served.

---

## Bradley's working style (unchanged)

- Mobile, Claude app for casual play. Desktop browser for development.
- "do that now", "ship it", "proceed", "keep going" — stop discussing, write code.
- "this doesn't work" — believe him; trace the actual error.
- Values period accuracy and dry tone over feature volume.
- Drive folder ("Factor's Charter", id `1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU`) is the canonical save backup channel.
- Now playing the PWA build at https://factors-charter.pages.dev primarily, on both mobile and desktop.
