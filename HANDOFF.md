# HANDOFF — The Factor's Charter

**Date:** 2026-05-09 (after rivalry mechanics + image-gen fix)
**For:** Bradley (or a fresh Claude session) resuming this project
**Branch:** `main`
**Live build:** https://factors-charter.pages.dev (auto-deploys from `main`)
**Status:** Rivalry mechanics shipped (closes the last design-shape backlog item). Image-gen path refactored to a robust fetch+blob pattern with explicit timeout. Tests 75/75; build clean.

> Previous handoff archived in `git log` at commit `57b883d`.

---

## What shipped this session (2026-05-08 → 2026-05-09)

A long span across two calendar days, but one continuous workflow:

1. **DESIGN_NOTES backlog reconciliation** — 8 of the 9 "deferred" backlog items were verified as already shipped during Sessions 9–10 (Cylinder questline, household crises, generational continuation, Crown-gated port, new commodities, fine-goods cargo, Internal Company faction split, Building→person arrivals, bottomry loans). The doc was pretending more was open than really was. Only #11 (rivalry mechanics) was genuinely open.

2. **Rivalry mechanics** — Three named rivals (Mr. Hardacre at Bencoolen, Mynheer ter Borch at Eustace, Mr. Lowji Nusserwanji at Bombay) with deterministic baseline trajectories + a per-rival template pool of 18 events. Four player-facing levers (read pressure, trade arbitrage, staff poaching, intel buy via three channels). 20 commits on `feat/rivalry-mechanics`, merged via `--no-ff` as `7a48210`. Detail in CHANGELOG.

3. **Image-gen fetch+blob refactor** — Players were consistently hitting "The in-game generator could not be reached" because Pollinations.ai responses take 10–15s for voyage-prose prompts, and `<img src={url}>` was tripping browser-internal abort heuristics. `IllustrationModal` + `InlineIllustration` now fetch via `fetch()` with 60s `AbortController` timeout, materialize as blob ObjectURL. CSP `_headers` updated: `blob:` added to `img-src`, `https://image.pollinations.ai` added to `connect-src`.

### Reference docs

- Rivalry spec: `docs/superpowers/specs/2026-05-08-rivalry-mechanics-design.md`
- Rivalry plan: `docs/superpowers/plans/2026-05-08-rivalry-mechanics.md`
- Image-gen diagnosis: `~/.claude/projects/-Users-roti/memory/project_pollinations_image_gen.md`
- DESIGN_NOTES.md — backlog reconciled at top of "Backlog (ordered, roughly)" section
- WORLD_NOTES.md — three new entries under "Inspirations Landed" for the rivals

---

## Deferred items — pick up here

### 1. Polished PWA icons (carried over)

Chrome's manifest validation still flags `icon-192.png`. Replacing the placeholder PNGs with hand-designed icons closes this out. Highest-priority cosmetic item.

### 2. ~~Lazy-load mid-game views~~ — shipped 2026-05-09

The diagnosis turned out different from the original framing. 60 % of the source was inlined base64 JPEGs in the six `PLATE_*_DATA` constants, not heavy code paths. Extracted them to `public/plates/*.jpg` with a Workbox runtime-cache rule. Main JS chunk dropped 1,214 → 380 KB; precache 1,331 → 518 KiB; gzipped transfer 744 → 113 KB. Phase 2 (code-splitting questline helpers / AUTO_SENDERS / RIVAL_EVENTS) deferred indefinitely — only revisit if the bundle creeps back over 500 KB.

### 3. Trusted Types in CSP

Closes out Lighthouse Best Practices. Not blocking.

### 4. Background audio for desktop mode

Period ambient (wind, wharf, quill) on desktop title and letter screens. Its own future spec.

### 5. Pollinations latency monitoring

The fetch+blob fix from 2026-05-09 wraps a 60s timeout around what's currently 10–15s typical Pollinations response time. If Pollinations degrades further (50s+), the timeout will fire and the player sees the failed-fetch message. Worth keeping an eye on; if it becomes routine, options:
- Bump timeout to 90s
- Add a retry-with-different-model fallback (Pollinations silently routes everything to Sana right now per Exif tags, but that may change)
- Migrate to a different image provider

### 6. Rivalry follow-ups (low priority, all flagged in code review)

- **Cama £5 school subscription** plants no tracking flag. The "warmer hand" prose is currently flavour-only; if a future Cama-loyalty mechanic is wanted, add `flags.camaSchoolPaid: true` in the Subscribe branch.
- **Sabotage lever** was deliberately deferred from the rivalry v1. If you want a fifth rivalry lever (sponsoring a rival's downfall via Brotherhood-bribe / customs-tip), it lands as a separate spec — the `gs.rivals[X].state = 'broken'` machinery already exists.
- **Dyad/triad rival events** — currently each rival's events are independent. Cross-rival events ("Hardacre and ter Borch fight over a cargo") would be a separate expansion.
- **Two-step `terborch-promotion-attempted` arc** — currently a single firing. Could become a 2-step arc (announcement → resolution) like Cylinder/Wilbraham.

### 7. ~~Sync UX polish~~ — all sub-items shipped 2026-05-07/08; remove from this list

---

## How to verify the project is healthy on resume

```bash
cd ~/pontus/factors-charter
git status
npm install
npm test                              # 75 tests across 6 files
npm run build
npx vite preview                      # http://localhost:4173/
```

JSX parser:

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines');"
```

Live deploy headers (verify CSP includes blob: in img-src and image.pollinations.ai in connect-src):

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

Image-gen quick check (any in-flight playtest, Network tab on click "Try in-game illustration"):
- `fetch` to `image.pollinations.ai/prompt/...` returns 200 with `Content-Type: image/jpeg`
- `<img src=blob:...>` mounts and loads from the blob
- 60s timeout never trips on a healthy connection

---

## Architecture invariants (don't break)

- `factors_charter.jsx` stays at repo root. Still monolithic by design (~11,260 lines after the 2026-05-09 plate extraction; was ~11,300).
- The six period engravings live as static JPEGs at `public/plates/plate-{vii..xii}.jpg` (~610 KB total, gitted). They are NOT in precache — Workbox runtime-caches them on first encounter via the `CacheFirst` rule in `vite.config.js`. Don't re-inline them as base64 — that's what we just spent 800 KB of bundle weight removing.
- `legacyAnthropicCall` body unchanged.
- Mobile UI byte-identical to its pre-PR state.
- `src/util/` is React-free pure logic. The React hooks (`useViewportMode`, `useSyncState`) and components live in the JSX monolith. Pure-logic modules now: `text.js`, `viewport.js`, `illustration-cache.js`, `style-prefix.js`, `playthrough-id.js`, `sync-conflict.js`, `rivalry.js`, `price-windows.js`, `plates.js`.
- `src/util/style-prefix.js` is the single source of truth for the image-gen style prefix.
- `src/util/rivalry.js` and `src/util/price-windows.js` are React-free; their `RIVALS_REGISTRY` and `RIVAL_KEYS` exports are `Object.freeze`d after `baselineFn` wiring — don't mutate them at runtime.
- The illustration cache key is `stableHash(cleanProse(prose))`. Pinned test enforces hash stability — bump `factor_illustration_cache_v1` to `_v2` if the hash function changes.
- Image fetch path is `fetch(url) → blob → URL.createObjectURL(blob)`, not direct `<img src=url>`. CSP requires `connect-src` to include `https://image.pollinations.ai` and `img-src` to include `blob:`. Cleanup via `URL.revokeObjectURL` in unmount effects.
- The playthrough ID format is `^[a-z]+-[a-z]+-[a-z]+-\d{4}$`. Both client and server validate. Wordlists in `src/util/playthrough-id.js` can be APPENDED (existing IDs unaffected) but not reordered or truncated.
- `gs` shape additions flow through `ensureShape`. Added in this session: `gs.rivals` (3 rivals, populated by `makeInitialRivals()`), `gs.priceWindows` (array), `gs.rivalPressure` (0–100), `gs.rivalPressureModifiers` (array). Per-slot sync pointer is device-local, NOT in `gs`.
- `aiLog` is intentionally stripped from the synced payload. On pull, `sync.applyPull(localGs, cloudBody)` merges so the local `aiLog` survives. Don't `setGs(remote.body)` directly — always go through `applyPull`.
- `makeSuccessorState` and `makeRenewedState` deliberately do NOT reset sync fields (`syncEnabled`, `playthroughId`, `syncPromptShown`). They DO reset rivalry fields (`rivals`, `priceWindows`, `rivalPressure`, `rivalPressureModifiers`) — fresh competitive curve per charter.
- Rivalry events use letter-id base ranges to avoid collisions: Hardacre `9400000+day` (with `9405000+day` for the fire event to avoid Dryden collision at `9400000+day`), ter Borch `9410000+day`, Lowji `9420000+day`, Vizier intel `9300000+day`.
- `priceFor(portKey, commodity, day, gs)` now takes an optional 4th `gs` argument; without it, the function is no-window-aware (defensive default = 1). Existing call sites in `MapView` / `PortView` pass `gs`.
- The `model=` parameter on Pollinations URLs is silently ignored at provider level (everything routes to Sana per Exif). Don't rely on it for variant images.

---

## Bradley's working style (unchanged)

- Plays on the Claude mobile app first; PWA on Cloudflare Pages second.
- Direct and terse. "Continue", "go with B", "merge" — short replies are the go-ahead, not requests for more discussion.
- Per-phase pause cadence on long implementations. Phase boundaries are real checkpoints; per-task is too noisy.
- Period-appropriate atmosphere matters; AI-generated prose that drifts toward modern idiom is rejected.
- Honest acknowledgement when something is broken beats optimistic claims.
- Drive folder for backups: `1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU` ("Factor's Charter").
