# Two-Mode (Mobile + Desktop) with Cross-Device Save Sync — Design

**Date:** 2026-05-07
**Status:** Design approved, ready for implementation plans (one per subsystem)

---

## Problem

The PWA build of *The Factor's Charter* runs identically on every device. Mobile players get a cramped layout that "works" on desktop too, but the desktop's wider viewport and faster bandwidth go unused. And a charter started on phone cannot be picked up on desktop without manually exporting and importing the Manuscript JSON each time.

This design addresses both halves:

1. The PWA renders differently on mobile and desktop — same JSX, same gameplay, same content tables, but the desktop viewport unlocks two-column layouts and inline auto-generated illustrations alongside encounters.
2. A single charter can follow the player across devices via Cloudflare Pages Functions + KV, with silent sync on save and on launch, conflict handling when both devices have progressed offline, and no accounts.

The two-mode promise hinges on both halves. Layout-only without sync still feels like two unrelated games. Sync without layout-divergence wastes the upgrade desktop offers.

## Decisions Anchored (during brainstorm)

### Sync (Subsystem A)

| Decision | Choice |
|---|---|
| Sync scope per device | One synced charter at a time. Other save slots stay device-local. |
| Trigger model | Silent / automatic. Push debounced after every save; pull on launch when the cloud version is newer. |
| Opt-in flow | First-launch prompt on first save of a new charter; existing charters opt in via in-game menu. |
| Playthrough ID format | Themed human-readable: `<noun>-<modifier>-<maritime>-<4digits>`, e.g. `coral-monsoon-pelican-1923`. ~31 bits of entropy. |
| Conflict UX | Modal showing headline stats from both versions (day, money, location, latest journal entry) — player picks "Keep this device / Use cloud / Compare side-by-side". The discarded version auto-exports as a Manuscript JSON before the choice commits. |
| Backend | Cloudflare Pages Function at `factors-charter.pages.dev/api/save`, KV-backed, deployed alongside the Pages site. |
| Authentication | The playthrough ID is the secret. No accounts, no OAuth, no API keys. |
| Save expiration | 365 days from last push, renewing on each push. |
| Privacy | Plaintext save bodies in KV (game state is innocuous; no PII). |
| Rate limit | 60 req/min per IP server-side, runaway-client guard. |

### UX Divergence (Subsystem B)

| Decision | Choice |
|---|---|
| Mobile UI | Stays byte-identical to current. Mobile-first promise holds; desktop is purely additive. |
| Adaptive trigger | `(min-width: 1024px) and (pointer: fine)` — captures real desktop, excludes touch tablets. |
| Override | In-game `☰ Menu` toggle ("Compact view ⇄ Wide view"), remembered per device in localStorage. |
| Desktop views in scope | Letters reading pane, Map + Ledger side-by-side, Outpost three-pane, Encounters with inline illustration. All four. |
| Inline illustration triggers | Voyage encounters, arrival vignettes, letters. NOT outcomes (button-on-demand stays). |
| Illustration cache | localStorage, content-hash keyed, LRU at 50 entries per device, fall-back to existing button path on fetch failure. |
| Letter reading pane | List left, current letter right; default selection = newest unread on view enter; list scrolls independently. |

## Scope

### In scope (this spec, two implementation plans)

- Cloudflare Pages Function at `functions/api/save.js` with GET / PUT / rate-limit / TTL
- KV namespace setup + Pages binding
- Themed wordlist for ID generation (top-level const in `factors_charter.jsx`)
- Sync state machine and React hook
- `<SyncBadge>`, `<ConflictModal>`, `<FirstLaunchSyncPrompt>` UI
- Save-shape additions through `ensureShape`: `playthroughId`, `lastKnownCloudVersion`, `syncEnabled`
- "Sync this charter" entry in `☰ Menu` for retroactive enabling
- `useViewportMode()` hook, override toggle, localStorage persistence
- `<LettersDesktop>` (list + reading pane)
- `<DesktopOverview>` (Map + Ledger side-by-side)
- Desktop variant of `OutpostView` (three-pane grid)
- `<InlineIllustration>` component + `useIllustrationCache()` hook
- Pure-function vitest suite for ID generation, validation, and conflict detection
- Doc updates: `CLAUDE.md`, `README.md`, `CHANGELOG.md`, replace `HANDOFF.md`

### Out of scope (separate work)

- Background audio (separate future spec)
- Re-introduction of a full SettingsPanel (menu toggle suffices)
- Auto-illustrations on outcome screens
- Mobile UI changes
- Live multi-device presence ("your other device is currently playing")
- Save format breaking changes
- The `genLetter` faction × mood pool (still the top remaining audit item from earlier this session, orthogonal)
- A second Pages Function for any other API endpoint

## Sequencing

**Subsystem B (UX Divergence) ships first.** Subsystem A (Save Sync) ships second.

Reasons:

- B is pure JSX additions plus the existing Pollinations integration. Zero new infrastructure, zero new deploy units, zero new auth surface. Single `git push` deploys it.
- A introduces a new deploy unit (Pages Function + KV namespace) plus client state machinery and conflict UX. Higher coordination cost.
- Shipping B first means desktop is already richer when sync arrives, so the first time you "pick up on phone what I started on desktop," the desktop experience is already worth picking up. Sync becomes the payoff rather than the whole story.
- The two are independent — neither requires the other.

Each subsystem gets its own implementation plan via `writing-plans`.

## Architecture — Subsystem A (Save Sync)

### Server: `functions/api/save.js`

A single Cloudflare Pages Function file. Cloudflare's request router exposes it at `/api/save`. The Pages project must have a KV namespace bound to the binding name `SAVES_KV`.

**Endpoints:**

```
GET  /api/save?id=<playthrough-id>
  → 200 { body: <save-json>, version: <int>, savedAt: <iso8601> }
  → 404 if no key for this id
  → 400 if id format invalid
  → 429 if rate-limit exceeded

PUT  /api/save?id=<playthrough-id>
  Body: <save-json> (max 256 KB)
  → 200 { version: <new-int>, savedAt: <iso8601> }
  → 400 if id format invalid or body unreadable
  → 413 if body exceeds 256 KB
  → 429 if rate-limit exceeded
```

**KV layout:**

| Key | Value | TTL |
|---|---|---|
| `save:<id>` | `{ body, version, savedAt }` | 365 days, renewed on each PUT |
| `rate:<ip>` | counter | 60 seconds |

**ID format validation server-side** rejects anything that doesn't match the themed pattern; prevents random key spam. `version` is a monotonic counter incremented on each PUT; client uses it for conflict detection.

### Client: additions to `factors_charter.jsx`

**Top-level data:**

- `THEMED_WORDS` — three arrays of period-flavored vocabulary:
  - `nouns` (~64 entries: pelican, sloop, lagoon, monsoon, harbor, factor, wax, ledger, compass, sextant, ...)
  - `modifiers` (~64 entries: dry, slow, sealed, salt, leaden, brass, ...)
  - `maritime` (~64 entries: pepper, calico, cinnamon, opium, indigo, ...)
- ~64 × 64 × 64 × 10000 ≈ 2.6 billion combos (~31 bits)

**Pure functions:**

- `generatePlaythroughId()` → `string` (3 random words + 4-digit suffix, hyphen-joined)
- `isValidPlaythroughId(s)` → `boolean` (format check)
- `detectConflict(local, remote, lastKnown)` → `'none' | 'pull' | 'conflict'`
  - `'none'` if remote.version === lastKnown.version (no remote change since last sync)
  - `'pull'` if remote.version > lastKnown.version AND local.day === lastKnown.day (remote progressed; local didn't)
  - `'conflict'` if remote.version > lastKnown.version AND local.day > lastKnown.day (both progressed)

**React hook (`useSyncState(slot)`):**

State machine: `idle | pushing | pulling | conflict | error | offline`. Encapsulates:

- 5-second debounced push trigger (cancels prior pending push if a new save fires)
- Pull-on-launch logic (one fetch per app launch when sync enabled)
- last-known-cloud-version pointer (per charter, in localStorage `factor_save_<slot>_sync` JSON alongside the save)
- Methods: `enableSync(playthroughId)`, `pushNow()`, `pullNow()`, `resolveConflict(side)`

**UI components:**

- `<SyncBadge>` — small italic line in the in-game header strip, between Day/Location and the `☰` menu button. Shows: nothing if not synced; "synced" / "syncing…" / "offline" / "conflict" otherwise.
- `<ConflictModal>` — full-screen modal with the option-C side-by-side stats:

  ```
  Cloud has a different version of this charter.
  
  This device:                Cloud:
  Day 187                     Day 195
  £1,243                      £980
  at Bayan-Kor                at Port St. Eustace
  Latest entry: "The pepper   Latest entry: "A Brotherhood
  has come in."               letter waited on the desk."
  
  [ Keep this device's version ]  [ Use cloud's version ]  [ Compare side-by-side ]
  ```

  Whichever is discarded triggers an automatic Manuscript JSON download before the choice commits.

- `<FirstLaunchSyncPrompt>` — modal shown on first save of a new charter where `syncEnabled` is undefined:

  ```
  Sync this charter across devices?
  
  Yr. saves will live on Cloudflare's servers under an unguessable
  charter ID. Anyone with the ID can read or write the save; nothing
  is encrypted, but the ID is the secret. The Manuscript JSON export
  remains the canonical permanent backup either way.
  
  [ Yes, sync this charter ]  [ No, keep local-only ]
  ```

  Choice persists in `gs.syncEnabled`. If yes, `gs.playthroughId` is generated and stored.

### Save-shape additions

Through `ensureShape(gs)`:

```js
if (next.syncEnabled === undefined) next.syncEnabled = false;
if (next.playthroughId === undefined) next.playthroughId = null;
// lastKnownCloudVersion is per-slot, not per-gs; tracked separately:
//   localStorage[`factor_save_${slot}_sync`] = { lastKnownCloudVersion, lastSyncAt }
```

The per-slot sync metadata stays out of `gs` because it's device-local — re-importing a Manuscript on a fresh device should reset it, not carry over.

### Data flow on save (when synced)

```
setGs(next)
  ↓
autosave(next) → localStorage[`factor_save_${slot}`]
  ↓
useSyncState.scheduleSync()  (5s debounce; cancel prior pending)
  ↓ (5s later)
PUT /api/save?id=<playthroughId>  body = next
  ↓
on 200: localStorage[`factor_save_${slot}_sync`].lastKnownCloudVersion = response.version
        SyncBadge → "synced"
on 4xx/5xx/network error:
        SyncBadge → "offline (will retry on next save)"
        next save attempt re-queues the push
```

### Data flow on launch (when synced)

```
title screen mounts → render with local state
  ↓ (in background)
GET /api/save?id=<playthroughId>
  ↓
on 200:
  detectConflict(local, remote, lastKnown):
    'none'     → no-op
    'pull'     → setGs(remote.body); update lastKnownCloudVersion silently
    'conflict' → render <ConflictModal>; player resolves
on 404:
  charter exists locally but never pushed; treat as fresh push opportunity
  push immediately to seed the cloud copy
on 4xx/5xx/network error:
  SyncBadge → "offline"; player can still play; sync resumes when online
```

## Architecture — Subsystem B (UX Divergence)

### `useViewportMode()` hook

```js
function useViewportMode() {
  const [mode, setMode] = useState(() => detectInitialMode());
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px) and (pointer: fine)');
    const onChange = () => setMode(detectMode());
    mq.addEventListener('change', onChange);
    window.addEventListener('storage', onChange);  // override toggle changes from other tabs
    return () => {
      mq.removeEventListener('change', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return mode;  // 'mobile' | 'desktop'
}

function detectMode() {
  const override = localStorage.getItem('factor_view_override');
  if (override === 'mobile' || override === 'desktop') return override;
  const mq = window.matchMedia('(min-width: 1024px) and (pointer: fine)');
  return mq.matches ? 'desktop' : 'mobile';
}
```

`localStorage.factor_view_override` is `'mobile'`, `'desktop'`, or absent. The override toggle in `☰ Menu` writes it; clearing returns to auto.

### Branch points in `factors_charter.jsx`

Each existing view checks the mode and conditionally renders:

```jsx
function LettersView(props) {
  const mode = useViewportMode();
  if (mode === 'desktop') return <LettersDesktop {...props} />;
  // existing mobile single-column rendering
}
```

The four desktop variants:

- **`<LettersDesktop>`** — flex container, left pane is the existing inbox list, right pane renders the currently-selected letter with its `<InlineIllustration>` + response choices. Default selection on enter is the newest unread letter.
- **`<DesktopOverview>`** — wrapper that bundles `MapView` and `LedgerView` into a side-by-side grid. The existing tab navigation in mobile is replaced by this single combined view in desktop. (Other tabs — Letters, Outpost, Journal — remain accessible via the same tabs.)
- **`OutpostView` desktop branch** — internal split into three panes (Godown / Build queue / Acquaintances) using a CSS grid; mobile keeps the existing stacked layout.
- **`<InlineIllustration prose={...} />`** — used inside encounter rendering, arrival vignettes, and letter reading pane; calls `useIllustrationCache().getOrFetch(prose)` and renders the cached image, a loading placeholder, or the existing `<ImaginePanel>` button on fetch failure.

### Illustration cache

```js
const ILLUSTRATION_CACHE_KEY = 'factor_illustration_cache_v1';
const ILLUSTRATION_CACHE_MAX = 50;

function useIllustrationCache() {
  // hash(prompt) → { url, fetchedAt, viewedAt }
  // LRU eviction on every write: trim to 50 entries by viewedAt asc
  // getOrFetch(prose):
  //   const hash = stableHash(IMAGINE_STYLE_PREFIX + cleanProse(prose));
  //   if cache hit: update viewedAt, return { url, status: 'cached' }
  //   if cache miss: build pollinations URL, return { url, status: 'fetching' };
  //                  on <img> onLoad → cache.set(hash, ...)
  //                  on <img> onError → return { status: 'failed' }
  return { getOrFetch };
}
```

Hash function reuses the seed pattern already in `IllustrationModal` (`cleanProse.split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0)`) so the same prose deterministically produces the same image URL across cache lookups and across devices.

### Override toggle

In the in-game `☰ Menu`, a new entry between "Settings" (which doesn't exist anymore — between two existing entries, e.g. between "Show manuscript" and "Return to title"):

```jsx
<button onClick={onToggleViewMode}>
  {mode === 'mobile' ? '⊞ Wide view' : '☐ Compact view'}
</button>
```

`onToggleViewMode` writes the opposite of the current detected mode to `localStorage.factor_view_override`, fires a synthetic `storage` event for the hook to re-read, and closes the menu. Player can clear the override (return to auto-detect) by toggling back to the auto-matching mode.

## Migration

### From existing saves

`ensureShape` adds `syncEnabled = false` and `playthroughId = null` to any save without them. **No surprise modal.** Existing charters stay quiet until the player explicitly enables sync via the new `☰ Menu` entry "Sync this charter" — which appears only when `syncEnabled === false` and disappears once enabled.

### From new charters

First save of a new charter where `syncEnabled` is undefined triggers `<FirstLaunchSyncPrompt>`. Choice (yes/no) is stored in `gs.syncEnabled` immediately, before the first push fires. If yes, an ID is generated and stored at the same time.

### From a fresh device with an existing playthrough ID

Player taps "Pull from cloud" in a future entry path (or imports a Manuscript that contains the ID). Currently the spec covers only one path: the player exports their Manuscript on device 1, imports on device 2, the imported save retains `playthroughId` and `syncEnabled = true`, and on next launch the pull-on-launch logic fetches the cloud copy. This is enough for the use case; a "paste your charter ID to load" UI is deferred.

## Rollout

Two `git push`-to-main operations, ordered:

1. **Subsystem B deploy.** Single PR. Pure JSX additions. Cloudflare Pages auto-deploys. Verify on desktop browsers immediately.
2. **Subsystem A deploy.** Pre-deploy setup:
   - Create a KV namespace via Cloudflare dashboard or `wrangler kv:namespace create SAVES_KV`
   - In factors-charter Pages settings → Functions → KV namespace bindings: add `SAVES_KV` → the new namespace
   - Single PR with `functions/api/save.js`, the client hook + UI components, and the save-shape migration. Cloudflare Pages provisions the route automatically.
   - CSP `connect-src 'self'` already covers same-origin fetches; no header change.

Both deploys are reversible by simple `git revert`; neither breaks existing localStorage saves (the migration is additive only).

## Verification

### Subsystem B

| Check | Method |
|---|---|
| Mode detection | Resize browser between < 1024 and ≥ 1024 px; verify mode flips and views reflow |
| Override persistence | Toggle to Compact view on desktop; reload; verify still Compact |
| Letters reading pane | Open Letters view on desktop; click each letter, verify inbox stays + reading pane swaps |
| Map + Ledger combined | Open the desktop overview; verify both render and reflow at narrower widths |
| Outpost three-pane | Open Outpost on desktop; verify three columns; resize to mobile, verify stacked |
| Inline illustration cache | Trigger 60+ encounters; verify localStorage stays at 50 cache entries with oldest evicted |
| Illustration fallback | Disable network mid-encounter on desktop; verify graceful fallback to button |

### Subsystem A

| Check | Method |
|---|---|
| Local Pages Function | `wrangler pages dev` with KV stub; PUT then GET round-trips a save |
| ID format validation | PUT with malformed ID returns 400 |
| Rate limit | 65 PUTs in 60s from same IP; verify 60 succeed, 5 return 429 |
| Body size limit | PUT with 300 KB body returns 413 |
| Conflict detection | Manually edit `lastKnownCloudVersion` in localStorage to force divergence; verify modal appears with correct stats |
| Auto-export of loser | Resolve conflict; verify Manuscript JSON downloads before state changes |
| Pull on launch | Hand-edit cloud KV via wrangler; reload PWA; verify state replaces local silently when no conflict |
| First-launch prompt | Begin new charter; after first save, verify modal appears with Yes/No options |
| Retroactive enable | Existing charter; verify "Sync this charter" entry appears in `☰ Menu`; tap; verify same prompt; verify ID generated and first push fires |

### Pure-function tests (vitest)

Reintroduce vitest with a tiny config covering only:

- `generatePlaythroughId()` — format, uniqueness across N runs
- `isValidPlaythroughId(s)` — accepts valid, rejects malformed
- `detectConflict(local, remote, lastKnown)` — all three branches
- `cleanProse(s)` (existing util) — edge cases for hash stability

Five to ten tests total. Restoring vitest is a small inconvenience — but worth it for the pure correctness functions.

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| KV quota overrun | very low | low | Free tier (100k reads / 1k writes / 1GB) handles thousands of players |
| False-positive conflict | low | low (recoverable) | Auto-export of the loser means recovery is always available |
| ID collision between independent players | near-zero | low | 31-bit space; on rare collision, last-write-wins is acceptable |
| Pollinations.ai availability / latency | medium | low (graceful) | Cached entries persist; fetches fall back to button-on-demand |
| localStorage quota | low | medium | LRU at 50 entries + existing save-slot cap = bounded |
| Pages Function cold-start latency | low | low | 100-500ms first-fetch; player sees brief offline indicator |
| Worker bug causing data loss | low | high | Client retains local copy; auto-export on conflict resolution; spec includes pure-function tests for sync logic |
| Player on flaky mobile network | medium | low | Push retries on next save; pull-on-launch silently fails if no network |

## Cost

Free tier across the board:

- Cloudflare KV: 100k reads / 1k writes / 1GB storage per day on free plan
- Cloudflare Pages Functions: 100k requests / day on free plan
- Cloudflare Pages: 500 builds / month on free plan
- Pollinations.ai: free, rate-limited per their public terms

For a single-player game with the current audience scale, all four are well under their limits.

## Doc updates (in this PR)

- `CLAUDE.md` — add a "Two-mode rendering" section under runtime notes
- `README.md` — add a "Cross-device sync" line to the play quickref
- `CHANGELOG.md` — entry per subsystem ship
- `HANDOFF.md` — replaced after second subsystem ships
- `DESIGN_NOTES.md` — note this work as the answer to the "open questions" thread on multi-device play
