# HANDOFF — The Factor's Charter

**Date:** 2026-05-10 (cross-device sync + image gallery + outcome bite + cache + PWA SW)
**For:** Bradley (or a fresh Claude session) resuming this project
**Branch:** `main`
**Live build:** https://factors-charter.pages.dev (auto-deploys from `main`)
**Status:** Five commits landed on `main` today. Tests **129/129**; build clean (main **415 KB / 122 KB gz**, precache **553 KiB**). JSX file is **12,480 lines**. Workers AI binding live; **R2 bucket binding still pending** (one-time dashboard step — see below).

> Previous handoff archived in `git log` at commit `5caf118`.

---

## What shipped today (2026-05-10)

Five commits, in order. Each was Bradley-confirmed before push.

### 1. Three-layer illustration cache — commit `279de4d`

`functions/api/illustrate.js` now serves through three cache tiers:

1. **`caches.default`** — POP-local edge cache (sub-100ms warm). Free.
2. **R2 bucket `ILLUSTRATIONS`** — persistent global, keyed by `sha256(prompt+seed)` under model+steps namespace. Set on miss via `caches.put` / `R2.put` in `waitUntil`. **Pending dashboard binding** — auto-detects `env.ILLUSTRATIONS` and falls through cleanly when unbound.
3. **Workers AI** — only on global first-ever miss for a (prompt, seed) pair.

Each response carries `x-illust-cache: edge | r2 | miss` for debugging. Once R2 is bound, neuron spend asymptotes to zero as the corpus saturates. See `R2_SETUP.md` for the dashboard step.

**Diagnosis path:** noticed via empirical measurement (5 sequential identical-URL hits returning ~5s TTFB each, no `cf-cache-status` header). Pages Functions don't auto-honor `cache-control: public, max-age=...` on responses — explicit `caches.default` is required. Documented in `HANDOFF.md` §5 prior to fix.

### 2. Voyage + pursue outcome bite — commit `e4cda5b`

Voyage encounters and pursue threads were producing "lose a day, nothing happened" outcomes regardless of choice. Three converging causes, all in the AI prompt + fallback layer (application code in `applyOutcomeChangesPure` was already correct):

- `genOutcome` prompt told the AI `"money: integer delta (often 0)"` and "Reputation deltas should be small. Only include factions that actually shift" — combined with the system prompt's "Be very sparing on flags," the AI defaulted to no change.
- `genOutcome` fallback returned a literal `{ money: 0, reputation: {}, goods: {} }` paired with prose like "A day passed without consequence."
- `genPursueThread` offered "Set the matter aside" as a default choice, AND `gs.hooks` had no removal mechanism — pursuing structurally couldn't close a thread.

Fix is pragmatist scope (no architectural redesign):

- `genOutcome` prompt: new CONSEQUENCE rule requiring ≥1 non-empty change for voyage/pursue outcomes; documented `closeHook` field; new `opts.isPursue` flag drives the closure clause.
- `genPursueThread` prompt: CHOICE DISCIPLINE rule (each choice must move the thread; at least one should resolve it).
- `FALLBACK_OUTCOME_ENCOUNTER`: rewrote all 8 entries with small bite (£8–30, ±1–3 rep, one shipDamage). Letter fallbacks unchanged.
- `concludeOutcome` pursue branch: when `outcome.changes.closeHook` is true, filter `encounter.thread` out of `gs.hooks`. Journal entry switches "Pursued" → "Settled."

Bradley confirmed working live (£18 bazaar outcome appeared on PWA after the deploy).

### 3. Factor-key cross-device sync — commit `6f76729`

Replaced the opt-in per-charter sync with implicit sync under a device-level "factor key." A new device opening the PWA can now see all of a player's existing charters via paste-the-key, instead of starting orphan charters in isolation.

- New `factor_key` lives in `localStorage` at `factor_key_v1` (NOT in `gs`). Auto-generated on first read via `ensureFactorKey()`. Same themed-string format as `playthroughId`.
- Every charter gets a `playthroughId` from birth in `ensureShape` — no opt-in step.
- All saves push to `save:<factorKey>:<playthroughId>` in Cloudflare KV. Per-record metadata (day, factorName, location, savedAt, version, charterClosed?) populated on PUT for fast listing.
- New endpoint `functions/api/factor-saves.js` — `GET ?key=K` returns charter manifests via `KV.list({ prefix: "save:K:" })`. Single KV op regardless of charter count.
- Title screen pulls remote charter list on mount, dedupes against local by playthroughId, surfaces remote-only charters in a new "⁂ ALSO UNDER YR. KEY" section with a "⁂ Pull to this device" button.
- In-game `☰ Menu` has new "⁂ Factor key (cross-device)" entry that opens `FactorKeyModal`: shows current key, copy to clipboard, paste a key from another device.
- `FirstLaunchSyncPrompt` deleted; `gs.syncEnabled` / `gs.syncPromptShown` kept defaulted-true purely for forward-compat (dead fields, can be cleaned up later).
- `useSyncState` rewrite: drops `gs.syncEnabled` gate; URLs built fresh per request via `buildSyncUrl`; new methods `pullFactorIndex()` and `pullCharterById()`.
- `summariseSlot` now includes `playthroughId` for the dedupe.
- `SyncBadge` gating updated to fire on `playthroughId` presence.

End-to-end live verified: PUT, GET, factor-saves listing, validation 400s.

### 4. Per-charter image gallery — commit `cfda979`

- `gs.illustrations[]` — capped LRU (60 entries) of every successful illustration the player has loaded. Each entry: `{ id, prose, fullPrompt, seed, url, day, capturedAt, viewedAt, regeneratedAt?, deletedByPlayer?, deletedAt? }`.
- Recording via new `IllustrationRecorderContext` — provided once at GameHub level (where `gs/setGs` live), consumed by `InlineIllustration` and `IllustrationModal`. No prop-drilling through every encounter / arrival / letter view.
- `GalleryModal` — opened from `☰ Menu → "✦ Image gallery (N)"`. Grid of `loading="lazy"` thumbnails so 60 × ~650 KB JPEGs don't fetch on open. Tap to enlarge → lightbox with full image, prose, seed, day, regenerated badge, and per-image actions.
- **Regenerate**: bumps seed via Knuth multiplicative mix into 31-bit positive range, rebuilds deterministic `/api/illustrate` URL, ALSO overrides device-local illustration cache via new `setCacheEntry` export so subsequent in-game encounters render the regenerated image.
- **Discard**: sticky soft-delete (`deletedByPlayer: true`). Recorder skips re-add for known ids regardless of flag, so re-encountering the scene won't silently resurface a discarded image. Discarded entries still count against the LRU cap.

### 5. Workbox `skipWaiting` + `clientsClaim` — commit `4cd054c`

Bradley hit the "old SW serving stale bundle" gotcha multiple times during the day's playtests. Without these flags, every new SW sat in `waiting` state until ALL existing PWA tabs unloaded — meaning each deploy required a full close-and-reopen before the new bundle was served.

- `skipWaiting: true` — new SW activates immediately on install
- `clientsClaim: true` — new SW takes control of already-open pages on next request

Net effect: future deploys land on one ordinary refresh, not three forced ones. Verified in built `dist/sw.js`.

---

## Image-gen deploy steps

### Workers AI `AI` binding — DONE (verified 2026-05-09)

```
$ curl -sI 'https://factors-charter.pages.dev/api/illustrate?prompt=a%20brigantine%20at%20anchor&seed=42'
HTTP/2 200
content-type: image/jpeg
cache-control: public, max-age=31536000, immutable
x-illust-cache: edge | r2 | miss
```

If you ever see `503 {"error":"AI binding not configured"}`, the binding has been removed; re-add at **Workers & Pages → factors-charter → Settings → Functions → Bindings**, name `AI`. Binding changes apply to subsequent function invocations — no redeploy needed.

### R2 `ILLUSTRATIONS` bucket binding — STILL PENDING ⚠️

The three-layer cache function detects `env.ILLUSTRATIONS` at runtime and falls through cleanly when unbound. The `caches.default` edge layer is fully active. **But until R2 is bound**, every cross-POP / cross-player miss re-runs Workers AI.

**Procedure** (~2 min):

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket** → name `factors-charter-illustrations`, location Automatic.
2. **Workers & Pages** → `factors-charter` → **Settings** → **Bindings** → **Add binding** → R2 bucket. Variable name **`ILLUSTRATIONS`** (uppercase, exactly), bucket = the one just created. Save.
3. Verify: cold render → `x-illust-cache: miss` → wait → second hit from any device should be `x-illust-cache: r2`. Full procedure in `R2_SETUP.md`.

### Save-sync KV `SAVES_KV` binding — DONE

Same KV namespace doubles for save sync, IP rate limiting, and (post the cache patch) is no longer needed for illustration caching. Already configured.

---

## Deferred items — pick up here

### 1. Polished PWA icons (carried over)

Chrome's manifest validation still flags `icon-192.png`. Replacing the placeholder PNGs with hand-designed icons closes this out. Highest-priority cosmetic item. Needs Bradley's aesthetic input — placeholder PNGs → 1720s-engraving-style icons.

> ⚠️ **SESSION POISONING — DO NOT READ THE ICON FILES.** Hit 3+ times. Reading `public/icon-*.png` (or any other PWA icon asset in this repo) into the conversation triggers a `400 Could not process image` cascade per `~/.claude/CLAUDE.md` §13 — likely an oversized / multi-image limit issue. Once it fires, every subsequent turn re-fails and the session is unrecoverable (`/compact`, `--fork-session`, `--resume` all stay broken).
>
> **Before any work on this item:**
> 1. `/rewind` checkpoint first.
> 2. Inspect with shell only: `sips -g pixelWidth -g pixelHeight -g format public/icon-192.png` and `ls -lh public/icon-*.png`. Do NOT `Read` them.
> 3. If >2000px on long edge or >5MB, downscale to a working copy: `sips -Z 1800 src.png --out src-small.png` before any image is added to the turn.
> 4. Prefer generating fresh icons from a tight cropped reference, one image per turn, path-referenced via `Read` only after sizing is verified.

There is also an `art/` directory of untracked PNG icon candidates (`art/file_*.png` × 30, plus `art/CATALOG.md`) sitting in the working tree. Same warning applies — verify dimensions with `sips` before reading.

### 2. R2 bucket dashboard binding (see "Image-gen deploy steps" above)

~2 minutes of dashboard work. Unlocks the cost savings the cache patch was designed for. Function works correctly without it (just falls through to Workers AI on cross-POP miss); binding it makes the corpus persistent and shared.

### 3. Trusted Types in CSP

Closes out Lighthouse Best Practices. Not blocking. Be aware: React 18 has sharp edges with TT — needs careful testing before deploy.

### 4. Background audio for desktop mode

Period ambient (wind, wharf, quill) on desktop title and letter screens. Its own future spec.

### 5. Rivalry follow-ups (low priority, all flagged in code review)

- **Cama £5 school subscription** plants no tracking flag. Add `flags.camaSchoolPaid: true` in the Subscribe branch if a future Cama-loyalty mechanic is wanted.
- **Dyad/triad rival events** — currently each rival's events are independent. Cross-rival events ("Hardacre and ter Borch fight over a cargo") would be a separate expansion.
- **Two-step `terborch-promotion-attempted` arc** — currently a single firing. Could become a 2-step arc.
- **Re-triggerable sabotage** — declined arcs are gone. A "channel comes back later with a better offer" mechanic could add a 180-day-delay re-offer gated on `sabotage_<rival>_method === 'declined'`.

### 6. Outcome / hook follow-ups (perfectionist scope, deferred from today's pragmatist patch)

Today's outcome-bite fix (commit `e4cda5b`) was scoped tight to the prompt + fallback layer. The bigger structural moves are deferred:

- **Curated `VOYAGE_ENCOUNTERS` registry with `fixedOutcome` per choice** — mirror of the scripted-letter pattern. Each fallback voyage encounter would carry its own three matched choice-outcome pairs with prose that flows from the setup, instead of the current contextless random-pool resolution. Bigger commit (~300-500 LOC mostly content authoring); needs Bradley sign-off on tone.
- **`gs.threads[]` structured replacement for `gs.hooks[]`** — `{id, label, status, fixedSteps?}` so closure / branching / scripted progression coexist with AI improvisation. Schema migration + hook-removal callsites. Medium effort.
- **Voyage encounters closing source threads** — currently only pursue can close hooks; voyage encounters can pull a thread but can't close it (the encounter doesn't track which thread the AI happened to pull in). Needs richer encounter schema.
- **Re-grade the deterministic pools** after several charters of play (per the 2026-05-07 audit in `DESIGN_NOTES.md` lines 12–98). All 7 generators got 2026-05-07 expansion; Bradley's playtests are the next data point.

### 7. ~~Cleanup: dead `gs.syncEnabled` / `gs.syncPromptShown` fields~~ — DONE

Verified removed (2026-06-09): the `ensureShape` comment at ~line 1033 records the deletion; no references remain in the file.

---

## How to verify the project is healthy on resume

```bash
cd ~/pontus/factors-charter
git status
npm install
npm test                              # 129 tests across 9 files
npm run build                         # main chunk ~415 KB, precache ~553 KiB, no warning
npx vite preview                      # http://localhost:4173/
```

JSX parser sanity check (the JSX file is 12,480 lines):

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines');"
```

Live deploy headers (verify CSP no longer references image.pollinations.ai):

```bash
curl -sI https://factors-charter.pages.dev/ | grep -i content-security
# expect: img-src 'self' data: blob:; connect-src 'self' https://api.github.com ...; (no pollinations.ai)
```

Workers AI illustration endpoint:

```bash
curl -sI 'https://factors-charter.pages.dev/api/illustrate?prompt=a%20brigantine%20at%20anchor&seed=42'
# expect: HTTP 200 + content-type: image/jpeg + cache-control: public, max-age=31536000, immutable
# also: x-illust-cache: edge | r2 | miss (which layer served the request — see R2_SETUP.md)
```

Plate static assets (post bundle-slimming):

```bash
curl -sI 'https://factors-charter.pages.dev/plates/plate-vii.jpg'
# expect: HTTP 200 + content-type: image/jpeg
```

Cross-device save sync (factor-key model):

```bash
KEY="pelican-salt-pepper-1234"; ID="brigantine-tarred-cinnamon-5678"
curl -X PUT "https://factors-charter.pages.dev/api/save?key=${KEY}&id=${ID}" \
  -H 'content-type: application/json' \
  -d '{"day": 1, "player": {"name": "Test"}, "playthroughId": "'"$ID"'"}'
curl "https://factors-charter.pages.dev/api/save?key=${KEY}&id=${ID}"
curl "https://factors-charter.pages.dev/api/factor-saves?key=${KEY}"
# expect: PUT 200 → version 1; GET 200 → body intact; factor-saves 200 → manifest list
```

Image-gen quick check (any in-flight playtest, Network tab on click "Try in-game illustration"):
- `fetch` to `/api/illustrate?prompt=…&seed=…` returns 200 with `Content-Type: image/jpeg`
- First hit takes 3–6s (Workers AI cold), repeats are sub-200ms (edge cache; R2 once bound)
- `x-illust-cache` header reports the serving layer
- `<img src=blob:...>` mounts and loads from the blob
- 60s timeout never trips on a healthy connection
- Open `☰ Menu → ✦ Image gallery` — the scene should now appear in the grid with day badge + prose snippet

---

## Architecture invariants (don't break)

- `factors_charter.jsx` stays at repo root. Still monolithic by design (~12,480 lines as of today).
- The six period engravings live as static JPEGs at `public/plates/plate-{vii..xii}.jpg` (~610 KB total, gitted). They are NOT in precache — Workbox runtime-caches them on first encounter via the `CacheFirst` rule in `vite.config.js`. **Don't re-inline them as base64.**
- `legacyAnthropicCall` body unchanged. Still wired up. Artifact runtime path is alive even though it's deprioritized vs. the PWA.
- Mobile UI byte-identical to its pre-PR state for non-illustrated paths.
- `src/util/` is React-free pure logic. Pure-logic modules: `text.js`, `viewport.js`, `illustration-cache.js`, `style-prefix.js`, `playthrough-id.js`, `sync-conflict.js`, `rivalry.js`, `price-windows.js`, `plates.js`, `sabotage.js`. The React hooks (`useViewportMode`, `useSyncState`) and components live in the JSX monolith.
- `src/util/style-prefix.js` is the single source of truth for the image-gen style prefix.
- `src/util/rivalry.js` and `src/util/price-windows.js` are React-free; their `RIVALS_REGISTRY` and `RIVAL_KEYS` exports are `Object.freeze`d after `baselineFn` wiring — don't mutate them at runtime.
- `src/util/plates.js` does `window.storage` detection to fall back to absolute `https://factors-charter.pages.dev/plates/` URLs in the legacy artifact runtime. Don't drop this.
- The illustration cache key is `stableHash(cleanProse(prose))`. Pinned test enforces hash stability — bump `factor_illustration_cache_v1` to `_v2` if the hash function changes.
- Image fetch path is `fetch(url) → blob → URL.createObjectURL(blob)`, not direct `<img src=url>`. URL is now same-origin (`/api/illustrate?…`); CSP `connect-src 'self'` and `img-src 'self' data: blob:` cover it. Cleanup via `URL.revokeObjectURL` in unmount effects.
- Workers AI binding `AI` is required at deploy time; the function fails closed with 503 if unbound. Guard with `if (!env.AI) return 503` (already done).
- The playthrough ID format is `^[a-z]+-[a-z]+-[a-z]+-\d{4}$`. Both client and server validate. Wordlists in `src/util/playthrough-id.js` can be APPENDED but not reordered or truncated.
- **Factor key uses the same regex and same wordlist.** The factor key namespaces all of a player's charters across devices; the playthrough id names a specific charter under that key. Both formats interchangeable for validation; the difference is purely semantic (key = "who", id = "which charter").
- `gs` shape additions flow through `ensureShape`. Today's additions: `gs.illustrations` (array, capped LRU 60). Earlier: `gs.rivals`, `gs.priceWindows`, `gs.rivalPressure`, `gs.rivalPressureModifiers`, `gs.sabotagesCommitted`, `gs.bottomry`. Per-slot sync pointer is device-local at `factor_save_<slot>_sync`, NOT in `gs`. **Factor key is device-local at `factor_key_v1`, NOT in `gs`** — moving a charter to a new device picks up that device's factor key.
- `aiLog` is intentionally stripped from the synced payload. On pull, `sync.applyPull(localGs, cloudBody)` merges so the local `aiLog` survives. Don't `setGs(remote.body)` directly — always go through `applyPull`.
- `makeSuccessorState` and `makeRenewedState` deliberately do NOT reset sync fields (`syncEnabled`, `playthroughId`, `syncPromptShown`) — same charter family stays on the same playthrough. They DO reset rivalry fields.
- Rivalry events use letter-id base ranges: Hardacre `9400000+day` (with `9405000+day` for the fire event), ter Borch `9410000+day`, Lowji `9420000+day`, Vizier intel `9300000+day`.
- `priceFor(portKey, commodity, day, gs)` takes an optional 4th `gs` argument; without it, no-window-aware (defensive default = 1).
- The Workers AI model is `@cf/black-forest-labs/flux-1-schnell` at 4 steps. Single-string change in `functions/api/illustrate.js` swaps to a different model. Bump the R2 key prefix in `r2Key()` at the same time so the new model gets a fresh R2 namespace.
- KV save records are keyed `save:<factorKey>:<playthroughId>` with sidecar metadata. The metadata includes `{day, daysRemaining, location, factorName, savedAt, version, charterClosed?}` — populated on PUT, read on `KV.list({prefix: "save:<factorKey>:"})` for the title-screen factor-saves discovery.
- `IllustrationRecorderContext` is provided once at GameHub level and consumed by `InlineIllustration` + `IllustrationModal`. Don't add new image components without consuming this context — they'd be invisible to the gallery.
- PWA SW now ships with `skipWaiting: true` + `clientsClaim: true`. New deploys activate on next refresh, not on full unload-and-reopen.

---

## Editing tips for next session

- **Don't try to `Read` the whole `factors_charter.jsx` in one go.** It's 12,480 lines (~600 KB). The Read tool's 25K-token limit will choke. Use targeted offset/limit or `awk 'NR==X, NR==Y'` for ranges, and `grep -n` for symbol lookups. Skip ranges with long lines using `awk 'length($0) < 500 && /pattern/'`.
- **Use the JSX parser sanity check after every substantive edit** — the harness reports successful writes even if the JSX is broken.
- **Always re-`Read` before editing** if the file has been touched in this session — Edit fails silently on stale `old_string`.
- **For surgical changes that span hundreds of base64-laden lines** (like the plate extraction), write a one-shot Node script that reads the file, makes assertions about anchor lines, then rewrites. Faster and safer than fighting Edit.
- **Bash output truncation is real:** if a `grep` matches a line containing a 150 KB base64 string, the entire match line is included in output. Use `awk 'length($0) < 500 && /pattern/'` to skip noise lines.
- **Don't `Read` the icon files in `public/` or `art/`** without first checking dimensions via `sips`. Session-poisoning hazard documented under deferred item #1.

---

## Bradley's working style (unchanged)

- Plays on the Claude mobile app first; PWA on Cloudflare Pages second. **As of 2026-05-10 also browser-on-mobile via the PWA URL — that's the cross-device sync use case the factor-key model now serves.**
- Direct and terse. "Continue", "go with B", "merge", "proceed" — short replies are the go-ahead, not requests for more discussion.
- Per-phase pause cadence on long implementations. Phase boundaries are real checkpoints; per-task is too noisy.
- Period-appropriate atmosphere matters; AI-generated prose that drifts toward modern idiom is rejected.
- Honest acknowledgement when something is broken beats optimistic claims.
- Drive folder for backups: `1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU` ("Factor's Charter").
