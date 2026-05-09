# HANDOFF — The Factor's Charter

**Date:** 2026-05-09 (later same day — sabotage arcs + charter-end coda landed)
**For:** Bradley (or a fresh Claude session) resuming this project
**Branch:** `main`
**Live build:** https://factors-charter.pages.dev (auto-deploys from `main`)
**Status:** Five branches landed on `main` today. Tests **129/129**; build clean (main 399 KB / 118 KB gz). Workers AI binding action below is still pending.

> Previous handoff archived in `git log` at commit `145ad16`.

---

## What shipped this session (2026-05-08 → 2026-05-09)

Continuous workflow across two calendar days:

1. **DESIGN_NOTES backlog reconciliation** — 8 of 9 "deferred" backlog items verified as already shipped during Sessions 9–10. Only #11 (rivalry mechanics) was genuinely open.

2. **Rivalry mechanics** — Three named rivals (Hardacre at Bencoolen, ter Borch at Eustace, Lowji at Bombay) with deterministic baseline trajectories + per-rival template pool of 18 events. Four player-facing levers (read pressure, trade arbitrage, staff poaching, intel buy via three channels). Merged via `--no-ff` as `7a48210`. Closes the design-shape backlog.

2a. **Sabotage arcs (the 5th rivalry lever)** — Three two-step letter-mediated arcs, one per rival, each routed through the rival's existing intel channel. Step 1 lands when the player is in Year 2+, under genuine pressure (rivalPressure ≥ 60), and has a prior relationship with the channel (a new persistent `*IntelEverBought` flag set wherever the volatile `*IntelPlant` flag is set). Player chooses Commission / Negotiate / Decline; Step 2 fires 45 days later with a deterministic Success / Partial / Failure roll modulated by channel rapport. Outcomes flip the rival to `state: 'broken'` (success), apply pressure modifiers, and in the ter Borch failure case lock the player out of Eustace for 90 days via a new `flags.banned_eustace_until`. Pure-logic resolver in `src/util/sabotage.js` with 28 vitest cases. Spec: `docs/superpowers/specs/2026-05-09-sabotage-arcs-design.md`. Plan: `docs/superpowers/plans/2026-05-09-sabotage-arcs.md`.

3. **Image-gen fetch+blob refactor** (commit `4b83179`) — Pollinations responses take 10–15s; `<img src={url}>` was tripping browser-internal abort heuristics. Switched to `fetch()` + 60s `AbortController` + `URL.createObjectURL(blob)`.

4. **Image-gen migrated to Cloudflare Workers AI** (PR `feat/pollinations-fix`, merge `c6ada06`) — Probing Pollinations after #3 revealed they'd deprecated `flux` (only `sana` survives, transparently substituted) and clamped the free tier to **one in-flight request per IP**. Brad's residential IP in Guadalajara was hitting the throttle on every retry. New same-origin Pages Function `functions/api/illustrate.js` proxies `@cf/black-forest-labs/flux-1-schnell` via the Workers AI binding. CSP tightened: `image.pollinations.ai` dropped from `img-src` and `connect-src`.

5. **Bundle slimming** (PR `feat/bundle-slimming`, merge `71c4292`) — The HANDOFF item framed this as "lazy-load mid-game views," but a measurement showed 60 % of `factors_charter.jsx` was inlined base64 JPEGs (six `PLATE_*_DATA` constants = 814 KB of 1,361 KB). Code-splitting would've saved 20–50 KB; rounding error. Extracted plates to `public/plates/plate-{vii..xii}.jpg` with a Workbox `CacheFirst` runtime rule. `ART_PLATES` and `pickPlate` extracted to `src/util/plates.js`. Result: main JS chunk **1,214 → 380 KB** (gzip **744 → 113 KB**), precache **1,331 → 518 KiB**, Vite "chunks > 500 kB" warning gone.

6. **Hygiene pass** (PR `chore/hygiene-pass-2026-05-09`, merge `6a59672`) — Audit over `src/util/*`, `functions/*`, JSX monolith. Found one dead export (`OVERRIDE_KEY` in `viewport.js`) and one untested module (`viewport.js`). Dropped the export, added 9 vitest cases. Wider scan turned up zero TODO/FIXME/HACK markers, zero stray `console.log`, zero stale references. Codebase is clean.

### Reference docs

- Rivalry spec/plan: `docs/superpowers/specs/2026-05-08-rivalry-mechanics-design.md`, `docs/superpowers/plans/2026-05-08-rivalry-mechanics.md`
- Bundle slimming spec/plan: `docs/superpowers/specs/2026-05-09-bundle-slimming-design.md`, `docs/superpowers/plans/2026-05-09-bundle-slimming.md`
- Image-gen diagnosis (covers both fetch+blob and Workers AI migration): `~/.claude/projects/-Users-roti/memory/project_pollinations_image_gen.md`
- DESIGN_NOTES.md — backlog reconciled at top of "Backlog (ordered, roughly)"
- WORLD_NOTES.md — three new "Inspirations Landed" entries for the rivals

---

## Required deploy step (image-gen)

The Workers AI image-gen path is merged and serving in code, but the function fails closed with `503 {"error":"AI binding not configured"}` until you wire the binding:

1. Cloudflare dashboard → **Workers & Pages** → **factors-charter** → **Settings** → **Functions** → **Bindings**.
2. Add an **AI binding**: variable name `AI` (matches `env.AI` in `functions/api/illustrate.js`).
3. Save. (Binding changes apply to subsequent function invocations — no redeploy required.)
4. Verify:
   ```bash
   curl -sI 'https://factors-charter.pages.dev/api/illustrate?prompt=a%20brigantine%20at%20anchor&seed=42'
   # expect: HTTP 200 + content-type: image/png
   ```

If you skip this step, the in-game illustration shows the existing "could not be reached" message — same UX as the current broken state, no further regression.

---

## Deferred items — pick up here

### 1. Polished PWA icons (carried over)

Chrome's manifest validation still flags `icon-192.png`. Replacing the placeholder PNGs with hand-designed icons closes this out. Highest-priority cosmetic item. Needs Bradley's aesthetic input — placeholder PNGs → 1720s-engraving-style icons.

### 2. ~~Lazy-load mid-game views~~ — shipped 2026-05-09 (see "Bundle slimming")

Phase 2 (code-splitting questline helpers / RIVAL_EVENTS / AUTO_SENDERS / SVG vignettes) is **deferred indefinitely** — Phase 1's plate extraction got the main bundle to 380 KB, well below the 500 KB warning threshold. Only revisit if the bundle creeps back over.

### 3. Trusted Types in CSP

Closes out Lighthouse Best Practices. Not blocking. Be aware: React 18 has sharp edges with TT — needs careful testing before deploy.

### 4. Background audio for desktop mode

Period ambient (wind, wharf, quill) on desktop title and letter screens. Its own future spec.

### 5. Workers AI latency / cost monitoring

The Workers AI migration uses `@cf/black-forest-labs/flux-1-schnell` at 4 steps. flux-schnell typically renders in ~3–6s. Watch:
- Latency: if it creeps past 30s, the 60s client timeout still covers it but UX bites.
- Free tier: 10,000 neurons/day; flux-schnell costs ~24 neurons per generation, so ~400 free renders/day. Real player traffic is far below. Paid tier metered per-neuron.
- Edge cache hit rate: same prompt + seed → identical URL → CF caches with `max-age=31536000, immutable`. Hits should dominate after warmup.

If Workers AI regresses, fall back to a different model (e.g. `@cf/stabilityai/stable-diffusion-xl-base-1.0`) by changing the single string in `functions/api/illustrate.js`.

### 6. Rivalry follow-ups (low priority, all flagged in code review)

- **Cama £5 school subscription** plants no tracking flag. The "warmer hand" prose is currently flavour-only; if a future Cama-loyalty mechanic is wanted, add `flags.camaSchoolPaid: true` in the Subscribe branch.
- ~~**Sabotage lever**~~ — shipped 2026-05-09 (see "Sabotage arcs" under What shipped this session).
- **Dyad/triad rival events** — currently each rival's events are independent. Cross-rival events ("Hardacre and ter Borch fight over a cargo") would be a separate expansion.
- **Two-step `terborch-promotion-attempted` arc** — currently a single firing. Could become a 2-step arc (announcement → resolution) like Cylinder/Wilbraham.
- **Re-triggerable sabotage** — sabotage offers fire once per rival per charter; declined arcs are gone. If a "channel comes back later with a better offer" mechanic is wanted, add a 180-day-delay re-offer gated on `sabotage_<rival>_method === 'declined'`.
- ~~**Charter-end sabotage flavour**~~ — shipped 2026-05-09 (destiny-shaped coda appended to `makeCharterEndLetter` when `sabotagesCommitted >= 1`).

### 7. ~~Sync UX polish~~ — all sub-items shipped 2026-05-07/08

---

## How to verify the project is healthy on resume

```bash
cd ~/pontus/factors-charter
git status
npm install
npm test                              # 92 tests across 8 files
npm run build                         # main chunk ~380 KB, precache ~518 KiB, no warning
npx vite preview                      # http://localhost:4173/
```

JSX parser sanity check (the JSX file is 11,260 lines, no longer has the 156 KB single-line base64 blobs but still big):

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines');"
```

Live deploy headers (verify CSP no longer references image.pollinations.ai):

```bash
curl -sI https://factors-charter.pages.dev/ | grep -i content-security
# expect: img-src 'self' data: blob:; connect-src 'self' https://api.github.com ...; (no pollinations.ai)
```

Workers AI illustration endpoint (after the AI binding is configured — see "Required deploy step" above):

```bash
curl -sI 'https://factors-charter.pages.dev/api/illustrate?prompt=a%20brigantine%20at%20anchor&seed=42'
# expect: HTTP 200 + content-type: image/png + cache-control: public, max-age=31536000, immutable
```

Plate static assets (post bundle-slimming):

```bash
curl -sI 'https://factors-charter.pages.dev/plates/plate-vii.jpg'
# expect: HTTP 200 + content-type: image/jpeg
```

Sync end-to-end:

```bash
curl -X PUT 'https://factors-charter.pages.dev/api/save?id=pelican-salt-pepper-1234' \
  -H 'content-type: application/json' \
  -d '{"day": 1, "test": true}'
curl 'https://factors-charter.pages.dev/api/save?id=pelican-salt-pepper-1234'
```

Image-gen quick check (any in-flight playtest, Network tab on click "Try in-game illustration"):
- `fetch` to `/api/illustrate?prompt=…&seed=…` returns 200 with `Content-Type: image/png`
- First hit takes 3–6s (Workers AI cold), repeats are instant (CF edge cache)
- `<img src=blob:...>` mounts and loads from the blob
- 60s timeout never trips on a healthy connection

---

## Architecture invariants (don't break)

- `factors_charter.jsx` stays at repo root. Still monolithic by design (~11,260 lines after the 2026-05-09 plate extraction; was ~11,300).
- The six period engravings live as static JPEGs at `public/plates/plate-{vii..xii}.jpg` (~610 KB total, gitted). They are NOT in precache — Workbox runtime-caches them on first encounter via the `CacheFirst` rule in `vite.config.js`. **Don't re-inline them as base64** — that's what we just spent 800 KB of bundle weight removing.
- `legacyAnthropicCall` body unchanged. Still wired up at line ~4636 — the artifact runtime path is alive even though it's deprioritized vs. the PWA.
- Mobile UI byte-identical to its pre-PR state.
- `src/util/` is React-free pure logic. Pure-logic modules: `text.js`, `viewport.js`, `illustration-cache.js`, `style-prefix.js`, `playthrough-id.js`, `sync-conflict.js`, `rivalry.js`, `price-windows.js`, `plates.js`. The React hooks (`useViewportMode`, `useSyncState`) and components live in the JSX monolith.
- `src/util/style-prefix.js` is the single source of truth for the image-gen style prefix.
- `src/util/rivalry.js` and `src/util/price-windows.js` are React-free; their `RIVALS_REGISTRY` and `RIVAL_KEYS` exports are `Object.freeze`d after `baselineFn` wiring — don't mutate them at runtime.
- `src/util/plates.js` does `window.storage` detection to fall back to absolute `https://factors-charter.pages.dev/plates/` URLs in the legacy artifact runtime. Don't drop this — it's how the artifact target keeps working.
- The illustration cache key is `stableHash(cleanProse(prose))`. Pinned test enforces hash stability — bump `factor_illustration_cache_v1` to `_v2` if the hash function changes.
- Image fetch path is `fetch(url) → blob → URL.createObjectURL(blob)`, not direct `<img src=url>`. URL is now same-origin (`/api/illustrate?…`), so CSP `connect-src 'self'` and `img-src 'self' data: blob:` cover it without any third-party allowance. Cleanup via `URL.revokeObjectURL` in unmount effects.
- Workers AI binding `AI` is required at deploy time; the function fails closed with 503 if unbound. Do not assume it's bound — guard with `if (!env.AI) return 503` (already done).
- The playthrough ID format is `^[a-z]+-[a-z]+-[a-z]+-\d{4}$`. Both client and server validate. Wordlists in `src/util/playthrough-id.js` can be APPENDED (existing IDs unaffected) but not reordered or truncated.
- `gs` shape additions flow through `ensureShape`. From the rivalry session: `gs.rivals` (3 rivals, populated by `makeInitialRivals()`), `gs.priceWindows` (array), `gs.rivalPressure` (0–100), `gs.rivalPressureModifiers` (array). Per-slot sync pointer is device-local, NOT in `gs`.
- `aiLog` is intentionally stripped from the synced payload. On pull, `sync.applyPull(localGs, cloudBody)` merges so the local `aiLog` survives. Don't `setGs(remote.body)` directly — always go through `applyPull`.
- `makeSuccessorState` and `makeRenewedState` deliberately do NOT reset sync fields (`syncEnabled`, `playthroughId`, `syncPromptShown`). They DO reset rivalry fields — fresh competitive curve per charter.
- Rivalry events use letter-id base ranges: Hardacre `9400000+day` (with `9405000+day` for the fire event), ter Borch `9410000+day`, Lowji `9420000+day`, Vizier intel `9300000+day`.
- `priceFor(portKey, commodity, day, gs)` takes an optional 4th `gs` argument; without it, no-window-aware (defensive default = 1). Existing call sites in `MapView` / `PortView` pass `gs`.
- The Workers AI model is `@cf/black-forest-labs/flux-1-schnell` at 4 steps. Single-string change in `functions/api/illustrate.js` swaps to a different model.

---

## Editing tips for next session

- **Don't try to `Read` the whole `factors_charter.jsx` in one go.** It's 11,260 lines (~545 KB). The Read tool's 25K-token limit will choke. Use targeted offset/limit or `awk 'NR==X, NR==Y'` for ranges, and `grep -n` for symbol lookups. Skip ranges with long lines using `awk 'length($0) < 500 && /pattern/'`.
- **Use the JSX parser sanity check after every substantive edit** — the harness reports successful writes even if the JSX is broken.
- **Always re-`Read` before editing** if the file has been touched in this session — Edit fails silently on stale `old_string`.
- **For surgical changes that span hundreds of base64-laden lines** (like the plate extraction), write a one-shot Node script that reads the file, makes assertions about anchor lines, then rewrites. Faster and safer than fighting Edit.
- **Bash output truncation is real:** if a `grep` matches a line containing a 150 KB base64 string, the entire match line is included in output. Use `awk 'length($0) < 500 && /pattern/'` to skip noise lines.

---

## Bradley's working style (unchanged)

- Plays on the Claude mobile app first; PWA on Cloudflare Pages second.
- Direct and terse. "Continue", "go with B", "merge" — short replies are the go-ahead, not requests for more discussion.
- Per-phase pause cadence on long implementations. Phase boundaries are real checkpoints; per-task is too noisy.
- Period-appropriate atmosphere matters; AI-generated prose that drifts toward modern idiom is rejected.
- Honest acknowledgement when something is broken beats optimistic claims.
- Drive folder for backups: `1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU` ("Factor's Charter").
