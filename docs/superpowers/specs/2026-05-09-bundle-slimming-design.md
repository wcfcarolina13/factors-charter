# Bundle Slimming — Design

**Date:** 2026-05-09
**Status:** Draft, awaiting Brad's approval before plan
**Backlog item:** HANDOFF.md "Deferred items" #2 — "Lazy-load mid-game views"

---

## Problem

The PWA's main JS chunk is **1.21 MB** (744 KB gzipped) and the precache is **1.33 MB**. On Brad's typical play surface — Mexican mobile network, cold load — that is felt as a noticeable wait before the title screen renders. The build emits the standard Vite warning ("Some chunks are larger than 500 kB after minification…") on every build.

The HANDOFF item framed this as "lazy-load mid-game views" — dynamic-importing questline letter helpers, AUTO_SENDERS pools, per-port arrival vignettes — on the theory that the heavy weight lives in code that only runs deep into a charter.

A measurement exposes that this framing was wrong:

| Source | Chars | KB |
|---|---:|---:|
| `factors_charter.jsx` total | 1,393,232 | 1,361 |
| Six `PLATE_*_DATA` base64 strings | 833,114 | **814** |
| Everything else | 560,118 | 547 |

**The six base64-inlined 1720s engravings are 60 % of the source file**, and PNG bytes don't shrink under gzip. They explain almost the entire bundle size. Splitting questline letter helpers or RIVAL_EVENTS pools would save maybe 20–50 KB each — rounding error against 814 KB of inlined PNG.

The right move is a single, surgical change: **stop inlining the plates as base64 strings; serve them as static PNG assets at `/plates/*.png`**.

---

## Decisions Anchored (need Brad's confirmation before plan)

### Approach

| Decision | Choice |
|---|---|
| Move plates to `public/plates/*.png` | **Yes.** Vite copies `public/` verbatim into `dist/`. CF Pages serves them with normal HTTP caching. |
| Keep `pickPlate(text)` matcher logic | **Yes.** Same keyword logic; only the return value changes from data-URL string to path string. |
| Filename convention | `plate-vii.png` … `plate-xii.png` (lowercase roman numerals matching the existing `PLATE_VII_DATA` constant suffix) |
| Inline thumbnails / placeholders | **No.** A plate appears in `<ImagePlate>` only after a player action that delays load expectation (opening a letter, finishing a voyage). Browser renders alt text or empty box for ~50–200 ms first paint; acceptable. |
| PWA precache the plates | **No.** Workbox runtime cache (`CacheFirst` for `/plates/`) instead. They're 814 KB total — keeps the install slim, full offline still works after first encounter of each plate. |
| Backwards-compat with the legacy artifact runtime | **Acknowledged break.** Artifact runtime can't `<img src="/plates/plate-vii.png">` resolve; needs absolute URL or the data URL it had before. CLAUDE.md already documents the artifact target as legacy. The `pickPlate` return path can fall back to absolute `https://factors-charter.pages.dev/plates/...` if `window.storage` is detected (artifact env), preserving the artifact path. |

### What about lazy-loading code chunks (the original HANDOFF framing)?

| Decision | Choice |
|---|---|
| Phase 2 split of questline letter helpers | **Defer.** After Phase 1 the bundle drops to ~400 KB main, and the warning probably clears. Code-splitting a monolithic file into dynamic-import boundaries adds complexity (artifact-path divergence widens further, `gs` flag conditions need care to not import twice). Re-evaluate after Phase 1 ships. |
| Phase 2 split of RIVAL_EVENTS / AUTO_SENDERS pools | **Defer.** Same reasoning. |
| Phase 2 split of SVG vignette components | **Defer.** They're small (~30 LOC each) and one is in flight at a time during loading screens. Splitting would mean a fetch flicker on the very loading screen meant to mask latency. |

If Phase 1 doesn't bring the bundle under the 500 KB warning, we revisit Phase 2.

---

## Scope

### In scope (Phase 1 — Plate extraction)

- Add `public/plates/plate-vii.png` … `plate-xii.png` (six files, ~135 KB each on disk after re-encoding base64 → bytes; saves ~25 % off the 814 KB JS-string footprint because base64 has 33 % overhead)
- Replace the six `const PLATE_*_DATA = "data:image/jpeg;base64,..."` declarations in `factors_charter.jsx` with path strings: `const PLATE_VII = '/plates/plate-vii.png'`, etc.
- Adjust `pickPlate(text)` to return the path string (no logic change beyond renaming the return source)
- Adjust `ImagePlate` component if needed (probably nothing — it just sets `<img src={...} />`)
- Update CSP `_headers`: `img-src 'self' data: blob:` already covers `/plates/*` since `'self'` matches same-origin. No CSP edit needed.
- Update PWA Workbox config in `vite.config.js` to:
  - Exclude `**/*.png` in `public/plates/` from precache (`globIgnores`)
  - Add a runtime caching rule: `CacheFirst` for paths matching `/plates/`, max 6 entries, 30-day TTL
- Add a unit test pinning `pickPlate('a heavy fog clears')` returns the expected path (mirror an existing test)
- Update CLAUDE.md "Code architecture (top to bottom)" item #1 to reflect the change ("six static PNGs at `public/plates/`, matched by `pickPlate`") instead of "base64-inlined"
- Re-build, verify the bundle warning is gone, document before/after sizes in CHANGELOG

### Optional in same PR (low effort)

- Artifact runtime fallback: `pickPlate` detects `window.storage` and emits absolute `https://factors-charter.pages.dev/plates/plate-vii.png` instead of the relative path, preserving artifact-mode functionality. ~5 LOC, no test impact, opt-in for whoever still uses the artifact path.

### Out of scope

- Code-splitting the JSX monolith into dynamic-import chunks (Phase 2, deferred — see Decisions Anchored above)
- Replacing the engravings with new artwork (separate task; player feedback satisfied with current set)
- Webp/avif conversion of the plates (PNG → WebP would give another ~30 % shrink, but adds picture-element complexity and the 814 KB → 600 KB for PNG-on-disk is already the dominant win; defer until / if it matters)
- Touching `RIVAL_EVENTS`, `AUTO_SENDERS`, `SCRIPTED_ARRIVALS`, questline letter helpers, or SVG vignettes — Phase 2 candidates only

---

## Implementation approach (high level — exact steps go in the plan)

1. **Extract.** Run a one-shot Node script to read each `PLATE_*_DATA` string, decode the base64 payload, write `public/plates/plate-{roman-numeral}.png`. Verify the bytes-on-disk match what `<img src="data:...">` was rendering before.
2. **Rewrite the constants.** Replace the six `const PLATE_*_DATA = "data:image/jpeg;base64,..."` blocks (currently lines ~6490+) with one-line `const PLATE_VII = '/plates/plate-vii.png'`. Net deletion: ~830 KB of JS source.
3. **Adjust `pickPlate`.** No structural change; the matcher returns whichever path constant was already returned, just at the renamed binding.
4. **Workbox config.** Edit `vite.config.js` `VitePWA` block to add `runtimeCaching: [{ urlPattern: /\/plates\//, handler: 'CacheFirst', options: { cacheName: 'plates', expiration: { maxEntries: 6, maxAgeSeconds: 60*60*24*30 } } }]` and `workbox.globIgnores: ['plates/**']`.
5. **Test.** `npm test` (existing suite + 1 new pin), `npm run build` (expect main JS chunk to drop ~67 %), `npx vite preview` and visually confirm a plate renders.
6. **Docs.** CLAUDE.md item #1, CHANGELOG entry with before/after byte counts, HANDOFF item #2 marked done.

---

## Testing

**Existing tests must still pass** (`75/75` baseline from this morning).

**New test** in a colocated file (probably `factors_charter.plate.test.js` since `pickPlate` lives in the JSX monolith — or, optionally, extract `pickPlate` and the `PLATE_*` constants into `src/util/plates.js` as a refactor; small file, would unblock unit testing without poking the monolith):

- `pickPlate('a heavy fog clears the masts')` returns `/plates/plate-{x}.png` (expected match)
- `pickPlate('utterly unmatched gibberish that hits no keyword')` returns the default plate path
- `pickPlate('')` returns the default plate path

**Manual verification before commit:**

- `npx vite preview` → start a charter → trigger a voyage encounter → confirm the plate renders
- Network tab shows a single GET to `/plates/plate-{x}.png` with `200 OK`, content-type `image/png`
- Reload the same encounter → second request hits the Workbox CacheFirst (status `from cache`)
- Build output: main chunk ≪ 500 KB, no Vite warning

---

## Risks

| Risk | Mitigation |
|---|---|
| Plate decoding produces a corrupted PNG (the data URL might be JPEG, not PNG, despite the constant naming convention) | The script can sniff the content-type from the data URL prefix and write the right extension. Probably `.jpeg`, not `.png` — first plate header is `/9j/...` which is JPEG magic. Filenames become `plate-vii.jpg` etc. Trivial fix. |
| First-encounter latency on Brad's mobile (no precache) | Plates are encountered only after user action that masks load (open a letter, complete a voyage). 814 KB total split across 6 files = ~135 KB each = sub-second on 4G. Workbox `CacheFirst` makes second encounter instant. |
| Artifact runtime breaks | Documented and mitigated via the optional `window.storage` detection fallback. Brad's primary path is the PWA per CLAUDE.md, so this is acceptable. |
| Missed reference to a `PLATE_*_DATA` constant outside of the six declarations | Grep before commit; refactor mechanically. Vitest + parser sanity check catch any stragglers. |
| The vite.config.js Workbox config change has a typo and breaks the SW build | Caught by `npm run build` pre-commit. |

---

## Success metrics

- **Bundle size**: main JS chunk drops from ~1,213 KB to **≤ 450 KB** (target). Vite "chunks larger than 500 kB" warning disappears.
- **Precache size**: drops from ~1,331 KB to **≤ 600 KB**. Service worker install transfer roughly halves.
- **Tests**: 75 → 76 (one new pin), all green.
- **Cold-load felt time**: subjective — Brad reports the title screen renders faster on his phone. Optional Lighthouse mobile run before/after.

---

## Open questions for Brad

1. **Artifact-path fallback** — keep it (5 LOC, opt-in for the legacy artifact target) or drop it (cleaner, accepts the artifact break)?
2. **Phase 2 trigger** — if Phase 1 lands the bundle below 500 KB, do you want to call it done, or proceed into questline-helper code-splitting anyway as a polish pass?
3. **Branch name** — `feat/bundle-slimming` or something else?

Once these are settled, I'll write the implementation plan in `docs/superpowers/plans/2026-05-09-bundle-slimming.md` matching the rivalry-mechanics plan style.
