# Bundle Slimming — Implementation Plan

**Date:** 2026-05-09
**Spec:** `docs/superpowers/specs/2026-05-09-bundle-slimming-design.md`
**Branch:** `feat/bundle-slimming` (off `main` — note: image-gen migration is in flight on `feat/pollinations-fix` and is independent; this branch will need a trivial rebase if pollinations-fix lands first)
**Defaults applied** (no separate confirmation gate):
1. Artifact-path fallback **kept** (5-LOC `window.storage` detection prefixes absolute URL)
2. Phase 2 (code-splitting) **deferred** until bundle measurement post-Phase 1
3. Branch name `feat/bundle-slimming`

---

## Phase 1 — Plate extraction (the whole job)

The plan is one phase. Phase 2 only happens if measurements after this branch say it's needed.

### Step 1.1 — Extract base64 → binary files

Write `/tmp/extract-plates.mjs` that:
1. Reads `factors_charter.jsx`.
2. Matches the six `const PLATE_(VII|VIII|IX|X|XI|XII)_DATA = "data:image/jpeg;base64,(.*)";` declarations with a single regex.
3. For each match, decodes the base64 payload to bytes.
4. Sniffs the first 4 bytes for magic (JPEG = `FF D8 FF`, PNG = `89 50 4E 47`); writes to `public/plates/plate-{vii|viii|...}.{jpg|png}` accordingly.
5. Prints `<filename> <size-on-disk>` for each.

`mkdir -p public/plates` first.

**Verification:** `file public/plates/*.jpg` reports `JPEG image data`. Total bytes-on-disk should be ~610 KB (base64 has ~33 % overhead, so 814 KB of base64 → ~610 KB of binary).

### Step 1.2 — Rewrite the constants in `factors_charter.jsx`

Replace lines 6490–6495 (the six long `const PLATE_*_DATA = "data:..."` lines) with six new short lines, plus an artifact-runtime fallback shim **above** the constants. After the comment block at lines 6483–6488 (the comment is updated to reflect the new architecture):

```js
// Curated period-engraved plates served as static assets at /plates/.
// The set is small — six plates hand-matched by keyword to specific
// scene types. ImagePlate renders a small button that expands to show
// the matched plate inline; pickPlate scores plates by keyword hits in
// the prose, returning the best match or null. New plates: drop
// public/plates/plate-{name}.jpg, add a new const, add an entry in
// ART_PLATES.

// In the legacy artifact runtime (`window.storage` is present), local
// asset paths don't resolve — the artifact iframe has no /plates/. Fall
// back to absolute URLs against the live PWA so the plates still load.
// In the PWA itself (`window.storage` undefined → safeStorage uses
// localStorage), relative paths resolve normally and CF Pages serves
// them with normal HTTP caching, and the SW runtime cache (see
// vite.config.js) makes second encounter instant.
const PLATE_BASE = (typeof window !== 'undefined' && window.storage)
  ? 'https://factors-charter.pages.dev/plates/'
  : '/plates/';

const PLATE_VII  = `${PLATE_BASE}plate-vii.jpg`;
const PLATE_VIII = `${PLATE_BASE}plate-viii.jpg`;
const PLATE_IX   = `${PLATE_BASE}plate-ix.jpg`;
const PLATE_X    = `${PLATE_BASE}plate-x.jpg`;
const PLATE_XI   = `${PLATE_BASE}plate-xi.jpg`;
const PLATE_XII  = `${PLATE_BASE}plate-xii.jpg`;
```

Then update the `ART_PLATES` array (lines 6498–6503): rename the `src` references from `PLATE_VII_DATA` → `PLATE_VII`, etc. (six replacements, one per row).

`pickPlate` and `ImagePlate` need no other changes — `ImagePlate` already does `<img src={plate.src}>` and that just becomes a path string instead of a data URL.

**Verification:** `grep -c "PLATE_.*_DATA" factors_charter.jsx` returns `0`. JSX parser still passes.

### Step 1.3 — Workbox runtime caching for `/plates/`

Edit `vite.config.js`. Inside the `workbox: { runtimeCaching: [...] }` array, append:

```js
{
  urlPattern: ({ url }) => url.pathname.startsWith('/plates/'),
  handler: 'CacheFirst',
  options: {
    cacheName: 'plates',
    expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 30 },
    cacheableResponse: { statuses: [0, 200] },
  },
},
```

Also extend `workbox.globPatterns` from `['**/*.{js,css,html,png,svg,woff2}']` to also match `jpg` so the existing `/icon-*.png` precaching survives but plates are explicitly *excluded* from precache. Easiest path: add `globIgnores: ['plates/**']` to the workbox block.

**Verification:** `npm run build` shows the precache count drops by 0 entries (plates were never in precache anyway since they didn't exist) — but the **main JS chunk** drops from ~1,213 KB to **<450 KB**. The Vite "chunks > 500 KB" warning disappears. `dist/sw.js` references `runtime` cache, not precache, for `/plates/`.

### Step 1.4 — Unit test for pickPlate behaviour

`pickPlate` lives in the JSX monolith and there's no infrastructure for testing it directly there. Two options:

- **Option A (cheap):** Add a smoke assertion to the existing `src/util/illustration-cache.test.js` — but pickPlate isn't imported from `src/util`. Skip.
- **Option B (preferred):** Extract `ART_PLATES` and `pickPlate` to a new `src/util/plates.js`, import them back into `factors_charter.jsx`. Aligns with the existing pattern (`viewport.js`, `illustration-cache.js`, `playthrough-id.js`, etc.). Enables direct unit testing.

Going with **Option B**. The new file:

```js
// src/util/plates.js
const PLATE_BASE = (typeof window !== 'undefined' && window.storage)
  ? 'https://factors-charter.pages.dev/plates/'
  : '/plates/';

export const PLATES = [
  { id: 'plate-vii',  title: 'After the Squall', src: `${PLATE_BASE}plate-vii.jpg`, keywords: [...] },
  // ...
];

export function pickPlate(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  let best = null, bestCount = 0;
  for (const p of PLATES) {
    let count = 0;
    for (const kw of p.keywords) if (t.includes(kw)) count++;
    if (count > bestCount) { best = p; bestCount = count; }
  }
  return best;
}
```

`factors_charter.jsx` imports `{ pickPlate }` from `./src/util/plates.js` (mirror existing import pattern at the top of the file). The 6 `const PLATE_*_DATA` declarations and the `ART_PLATES` array are deleted from the JSX file. The `function pickPlate` definition is also deleted from the JSX file.

This keeps the JSX file 850 KB lighter on disk and ~600 KB lighter in the bundle while remaining functionally identical.

New test file `src/util/plates.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { pickPlate, PLATES } from './plates.js';

describe('pickPlate', () => {
  it('returns null for empty input', () => {
    expect(pickPlate('')).toBeNull();
    expect(pickPlate(null)).toBeNull();
    expect(pickPlate(undefined)).toBeNull();
  });

  it('returns null when no keywords match', () => {
    expect(pickPlate('utterly unmatched gibberish that hits no keyword')).toBeNull();
  });

  it('matches the squall plate on weather keywords', () => {
    const p = pickPlate('the squall passed and the gale slackened');
    expect(p).not.toBeNull();
    expect(p.id).toBe('plate-vii');
  });

  it('emits paths under /plates/', () => {
    for (const p of PLATES) {
      expect(p.src).toMatch(/\/plates\/plate-[a-z]+\.jpg$/);
    }
  });
});
```

**Verification:** `npm test` reports 75 → **79** tests across **7** files; all pass.

### Step 1.5 — Documentation

- `CLAUDE.md` "Code architecture (top to bottom)" item #1: change *"PLATE_*_DATA constants — six base64-inlined 1720s engravings"* to *"`pickPlate(text)` and `PLATES` live in `src/util/plates.js`; the six engravings are static JPEGs at `public/plates/plate-{vii..xii}.jpg`, served by CF Pages and runtime-cached by the SW."*
- `CHANGELOG.md`: new entry at top dated 2026-05-09 documenting the extraction. Include before/after byte counts from `npm run build`.
- `HANDOFF.md` "Deferred items" #2 ("Lazy-load mid-game views"): mark resolved, noting Phase 2 (code-splitting questline helpers) was deferred and will only be revisited if the bundle creeps back over 500 KB.
- `HANDOFF.md` "Architecture invariants": replace the historical claim about base64-inlined plates with the new path; add an item that `public/plates/*.jpg` are gitted binary assets; mention the artifact-runtime fallback.

### Step 1.6 — Verification gate

Run, in order:

```bash
node -e "..."          # JSX parser sanity check
npm test               # vitest 79/79
npm run build          # measure new bundle size
ls -la dist/assets/*.js public/plates/*.jpg dist/plates/*.jpg
npx vite preview &     # bring up the production build
# Open http://localhost:4173, start a charter, trigger a voyage encounter
# In Network tab: confirm /plates/plate-{x}.jpg returns 200 image/jpeg
# Reload — confirm second encounter hits the SW cache
```

Bundle size targets (must hit, otherwise re-evaluate Phase 2):
- Main JS chunk ≤ 450 KB
- Precache ≤ 600 KB
- Vite "chunks larger than 500 kB" warning gone

### Step 1.7 — Commit + push

Single commit on `feat/bundle-slimming`. Commit message:

```
refactor(bundle): extract base64 plates to public/plates/, drop ~800KB from JS bundle

The six PLATE_*_DATA base64-inlined JPEGs accounted for ~60% of
factors_charter.jsx (814 KB of 1,361 KB) and dominated the main JS
chunk (1.21 MB → ~450 KB after this change). Moved them to
public/plates/plate-{vii..xii}.jpg, served by Cloudflare Pages with a
Workbox CacheFirst runtime rule (max 6 entries, 30-day TTL).

Also extracted ART_PLATES + pickPlate from the JSX monolith into a new
src/util/plates.js, matching the existing src/util/* pattern. This
unblocks unit testing and trims the JSX file by ~830 KB on disk.

Artifact-runtime fallback: window.storage detection prefixes paths with
the absolute https://factors-charter.pages.dev/plates/ URL so the
legacy artifact target keeps working.

Tests 75 → 79; main bundle ~1,213 KB → ~XXX KB; precache ~1,331 KB → ~XXX KB.
Vite "chunks > 500 kB" warning cleared.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

Push the branch. Open PR description references the spec/plan docs.

---

## Risks & rollback

| Risk | Mitigation / rollback |
|---|---|
| Extraction script writes corrupted bytes | Magic-byte sniff before write; verify with `file` after; bundle build won't even run until paths resolve. Revert with `git restore`. |
| Artifact-path fallback misfires (window.storage detection wrong env) | Test in both modes pre-commit. The fallback is a 3-line `const PLATE_BASE = ... ? abs : rel`; if it ever causes trouble, drop it and accept artifact break. |
| Workbox config typo breaks SW build | Caught by `npm run build` pre-commit. |
| Phase 1 doesn't bring main < 500 KB | The math says it will (814 KB of 1,213 KB is the dominant cost), but if not, Phase 2 (code-splitting) becomes a follow-up branch. |
| Plate appears broken in production after deploy | CF Pages serves `public/` verbatim into `dist/`. If `dist/plates/*.jpg` aren't in the deployed artifact, double-check Vite's public-dir config (default is `public/`, no override). |

---

## Out of scope (explicit non-goals)

- Code-splitting questline letter helpers (Phase 2 — deferred)
- Code-splitting RIVAL_EVENTS / AUTO_SENDERS pools (Phase 2 — deferred)
- WebP/AVIF conversion of the plates (separate optimization, future)
- Replacing the engravings with new artwork (separate creative task)
- Touching the artifact runtime path beyond the absolute-URL fallback

---

## Definition of done

- [ ] `public/plates/plate-{vii..xii}.jpg` exist, validate as JPEG via `file`
- [ ] No `PLATE_*_DATA` references anywhere in repo (`grep -rn "PLATE_.*_DATA"` returns empty)
- [ ] `src/util/plates.js` exports `{ pickPlate, PLATES }`; JSX imports them
- [ ] `vite.config.js` has the runtime caching rule for `/plates/`
- [ ] `npm test` reports 79/79 passing
- [ ] `npm run build` main chunk ≤ 450 KB; warning gone
- [ ] CHANGELOG, CLAUDE.md, HANDOFF updated
- [ ] Branch pushed; ready to merge after manual playtest
