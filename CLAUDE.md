# CLAUDE.md — The Factor's Charter

This document is for any future Claude session picking up work on this project. Read it before touching the code.

---

## What this is

**The Factor's Charter** is a text-based mobile RPG built as a single-file React artifact. The player is a junior Factor (trading-company agent) named by them, posted to Bayan-Kor, a vaguely Southeast-Asian colonial frontier station in the early 1720s. They have a 3-year charter to ship 400cwt of pepper and 200cwt of cinnamon to London, navigating six factions (Honourable Company, Crown, the Rajah, the Brotherhood/pirates, the Mission, and the Dutch).

**Inspirations cited by the user (Bradley):** Robinson Crusoe (solitude, improvisation, the journal voice), Sunless Sea (atmosphere, prose-driven encounters), Morrowind's House Hlaalu and the Raven Rock / East Empire Company storyline (mercantile bureaucracy, faction politics), Civilization (long-arc compounding decisions). The aesthetic touchstone is a 1720s leather-bound logbook.

**Tone target:** dry, observational, period-appropriate. Sensory detail (heat, salt, mildew, palm oil, gunsmoke). Slight melancholy, occasional dark humor. No anachronisms — no "okay," no modern idiom. Names of people and ships should sound period-plausible. The narrator is the player's own hand, writing in their journal.

---

## Where the code lives

Single file: **`factors_charter.jsx`** at the repo root. When working inside the artifact, the same file lives at `/mnt/user-data/outputs/factors_charter.jsx` and must be presented to the user after each substantive edit.

~9,000 lines, single React component tree, default export `FactorsCharter`. Renders as a Claude.ai artifact. The file is monolithic by design — easier to ship as a single artifact, easier to keep in one place. Don't fragment it.

**Sibling docs at the repo root** (read before any session that touches their domain):
- `WORLD_NOTES.md` — Bradley's lore feedstock. Required reading before narrative work.
- `DESIGN_NOTES.md` — design research, sources scoured, decisions made, ordered backlog. Read before any gameplay-shape change.
- `CHANGELOG.md` — chronological log of what shipped, by session.
- `HANDOFF.md` — state of the most recent branch. Often ahead of CLAUDE.md.

---

## Tech stack & runtime constraints

- **React JSX artifact** — uses `useState`, `useEffect`, `useRef` from React. No router. No external state.
- **Anthropic API** for generative prose: `claude-sonnet-4-20250514` via `https://api.anthropic.com/v1/messages`. Called from inside the artifact for voyage encounters, outcomes, letters, arrivals, and away-digests. Each generator has a deterministic fallback if the API fails.
- **Storage:** `window.storage` (artifact persistent storage) with `localStorage` fallback. Wrapped in a `safeStorage` helper at the bottom of the file. All save operations are try/catch'd — assume nothing about availability.
- **No Tailwind.** Some early code used Tailwind class names (`max-w-4xl`, `mx-auto`, `px-4`, etc.) but they don't reliably apply in the artifact runtime. Use inline styles for sizing and spacing. Some semantic classes (`display`, `parchment`, `wax-button`, `ghost-button`, `cols-2`, `trade-row`, `ink-fade-in`, `quill-cursor`, `fleuron`) ARE defined in the inline `<style>` block inside `<Page>` — those work. Anything else from Tailwind probably won't.
- **Mobile-first.** The user plays this on a phone in the Claude app. Two-column layouts must collapse cleanly. Use `grid-template-columns: repeat(auto-fit, minmax(...))` not media queries — the iframe's reported viewport is unreliable.

### Runtime targets

The same `factors_charter.jsx` runs in two environments, with diverged AI behavior:

- **PWA build** (Vite + Cloudflare Pages, https://factors-charter.pages.dev): **deterministic only.** No live AI. Every generator (`genVoyageEncounter`, `genOutcome`, etc.) falls through to its inline fallback. No setup, no API keys, no provider configuration. Mobile-first.
- **Claude artifact** (legacy): host injects Anthropic credentials and bridges CORS. `callClaude` detects this path via `window.storage` and falls through to `legacyAnthropicCall`. Useful as a dev / playtest sandbox; not the player target going forward.

Parity between runtimes is opportunistic. Game logic, content tables, and generators all live in the shared `factors_charter.jsx` so both runtimes get them automatically. PWA-only affordances (settings UIs, asset richness, etc.) are fine to add and won't appear in artifact — that's expected.

### Two-mode rendering (PWA only)

The PWA renders differently on mobile and desktop, gated by `useViewportMode()` which reads `(min-width: 1024px) and (pointer: fine)` plus a localStorage override (`factor_view_override`) toggleable from the in-game `☰ Menu` ("Compact view" / "Wide view"). The hook returns `'mobile' | 'desktop'`.

- **Mobile** stays byte-identical to its pre-two-mode state. No new affordances.
- **Desktop** unlocks four wide-screen layouts:
  - **Letters**: list + reading pane via `<LettersDesktop>`. Inbox left, current letter right with inline illustration.
  - **Map + Ledger**: collapsed into a single Overview tab via `<DesktopOverview>` showing both side-by-side.
  - **Outpost**: three-pane grid (Standing structures / Under construction / Available for construction).
  - **Encounters / arrivals / letters**: render with an `<InlineIllustration prose={...} />` alongside the prose, drawn by Pollinations.ai. Cached in localStorage (LRU at 50 entries, content-hash keyed) so each scene draws the same image every time.

The pure logic is split out: `src/util/text.js` (stableHash, cleanProse), `src/util/viewport.js` (detectMode, setOverride), `src/util/illustration-cache.js` (LRU cache + getOrFetch + markLoaded), `src/util/style-prefix.js` (the single source of truth for the image-gen style prompt). The React hook `useViewportMode` and the components live in the JSX monolith because they use React.

The existing `<ImaginePanel>` button-on-demand path remains in both modes — `<InlineIllustration>` falls back to `null` on fetch failure and the button stays available.

### Cross-device save sync (PWA only)

A charter can opt into cross-device sync via a first-launch prompt or a "⁂ Sync this charter" entry in the in-game `☰ Menu`. When enabled, the save is pushed to a Cloudflare KV namespace via `functions/api/save.js` (deployed alongside the static site as a Pages Function), keyed by a themed playthrough ID like `pelican-salt-pepper-1923`. On launch, if the cloud has a newer version, it silently replaces local; if both have progressed since the last sync, a `<ConflictModal>` shows side-by-side stats and the player picks which to keep — the discarded version auto-exports as a Manuscript JSON download.

Pure logic (ID generation, conflict detection) lives in `src/util/playthrough-id.js` and `src/util/sync-conflict.js` with vitest coverage. The React state machine is `useSyncState(slot)` inside the JSX monolith. Per-charter sync metadata in `gs`: `syncEnabled`, `playthroughId`, `syncPromptShown`. Per-slot device-local pointer in localStorage at `factor_save_<slot>_sync`: `{ lastKnownCloudVersion, lastSyncAt, lastKnownDay }`. The synced payload strips `gs.aiLog` (debug-only history; not needed for play continuity) so the body stays well under the 256 KB server cap; pulled state is merged via `sync.applyPull(localGs, cloudBody)` to preserve the local `aiLog`.

Pre-deploy infrastructure (one-time): a Cloudflare KV namespace bound to `SAVES_KV` in the Pages project's Functions bindings. Already configured. CSP `connect-src 'self'` covers same-origin `/api/save` fetches.

---

## Code architecture (top to bottom)

1. **Registries (top-level constants)**:
   - `COMMODITIES` (16): pepper, cinnamon, calico, silver, sandalwood, opium, rice, rum, saltpetre, camphor, tobacco, pearls, diamonds, teak, indigo, ambergris, gambier. Pearls/diamonds/ambergris are the **fine-goods** class — high value, near-zero weight.
   - `PORTS` (6): Bayan-Kor (home), Kota Pinang, Port St. Eustace, The Pelican's Nest, Tanjung Cermin (gated), Fort Marlborough/Bencoolen (Crown).
   - `PORT_SUBLOCATIONS`: gated extra venues at existing ports (Kota Pinang's inland teak yard, Eustace's Dutch back rooms, the Nest's wreckers' market, the inland plantation warehouse). Surfaced in `PortView` only when their flag/concession unlocks.
   - `SHIP_TYPES` (pinnace, brigantine), `FACTIONS` (6), `BUILDINGS`, `BUILDING_ARRIVALS` (a building completion delivers a named NPC).
   - `AUTO_SENDERS`, `LORE`, `MAJOR_COMMITMENTS` (the surfaced "Standing Arrangements"), `SCRIPTED_ARRIVALS`.
   - `PLATE_*_DATA` constants — six base64-inlined 1720s engravings; `pickPlate(text)` keyword-matches prose; `ImagePlate` renders.
2. **`makeInitialState(name)`**: returns the starting `gs` object. Pre-populates two letters (Director appointment + Wilbraham's papers) and one open thread (the teak concession hook).
3. **Game state (`gs`) shape** (high level — `ensureShape(gs)` is the migration funnel for old saves):
   ```
   { day, location, player, money, goods, ship, portStocks,
     reputation, crew, npcs (hodge/dass/vizier with stat blocks),
     outpost (buildings/queue/warehouse), awayLog, quotas, daysRemaining,
     charterClosed, indiaman, shipCommission,
     lettersAuto, pendingLetterRequests,
     privateConsignment, privateTradeProceeds, bottomry,
     journal[], letters[], hooks[], visited[], acquaintances[],
     flags{}, aiLog[],
     seenOpening, lettersGenerated, firstLetterPresented }
   ```
4. **`tickDays(gs, days)`**: pure home-station simulation engine. Drives outpost build queues, away-log accrual, raid rolls, auto-letter scheduling, Indiaman/quarterly cadences, and one-off faction-letter triggers. Most new content lands here as a guarded `if` block.
5. **AI helpers**: `SYSTEM_PROMPT`, `callClaude`, `stateContext`, `genVoyageEncounter`, `genOutcome(gs, prose, choice, opts)`, `genLetter`, `genArrivalVignette`, `genAwayDigest`, `genIndiamanLetterPayload`. All have deterministic fallbacks. The system prompt contains **WORLD GROUNDING** and **PROSE / FLAGS / HOOKS DISCIPLINE** blocks.
6. **`safeStorage`**: get/set/delete with dual backend (`window.storage` → `localStorage`).
7. **Vignettes**: 12 hand-drawn SVG line illustrations (the original 8 plus `GodownVignette`, `BrigantineVignette`, `IndiamanVignette`, `PalaceVignette`). Direct SVG presentation attributes on `<g>` — CSS inheritance for SVG was unreliable. `pickVignette(msg)` keyword-matches loading messages.
8. **`Loading`** component renders the matched vignette above the loading text.
9. **Components**: `Page`, `Fleuron`, `ImagePlate`, `TitleScreen`, `OpeningSequence`, `GameHub`, `IllustrationModal`, `ImaginePanel`, `ExportModal`, `Header`, `Tabs`, `JournalView`, `PursueThreadPanel`, `LedgerView`, `MapView`, `PortView`, `GodownPanel`, `OutpostView`, `ScriptedArrivalScreen`, `AwayDigestScreen`, `LettersView`, `ChangesSummary`, `ProvisionsDrawer`.
10. **Root**: `FactorsCharter` (default export). Always lands on the title screen first — never auto-resumes. Title screen offers per-slot Continue / Renew (charter end, success/partial) / Take up successor / Strike out.

---

## Critical conventions and patterns

### World grounding (do not violate)
The system prompt explicitly states: home-station characters (Mr. Hodge the clerk, Sgt. Dass, the Vizier, Reverend Pyke at the Mission) only appear at Bayan-Kor or in correspondence. They cannot be encountered at Kota Pinang, Port St. Eustace, The Pelican's Nest, Tanjung Cermin, or Fort Marlborough. The Mission is at Bayan-Kor — it is not a separate port. New characters in voyage scenes must be properly introduced (a passing captain, a passenger, a castaway).

**Sublocations** (inland teak yard at Kota Pinang; Dutch back rooms at Eustace; wreckers' market at the Nest; the plantation warehouse) are **gated**: they only render in `PortView` when their unlocking flag/concession holds. Don't have the AI describe a sublocation the player hasn't unlocked.

If the AI starts hallucinating any of this — e.g. "you visit the Reverend at Port St. Eustace" — tighten the per-call prompt's `SCENE CONSTRAINT` line. Don't try to fix it post-hoc in code.

### Letters are instant
Letter responses do **not** advance time. The `genOutcome` helper takes an `opts.isLetter` flag that tells the model to set `days: 0`, and `handleLetterResponse` belt-and-suspenders strips `days` from the result before applying. Don't break this — the user noticed and complained when phantom days appeared.

### Inbox style
All letters (read AND unread) stay visible in the Letters tab. The Journal page shows a persistent "Latest correspondence" card that adapts: bold red wax for unread, subtle "Re-read" for read. The first Director letter auto-opens after the prologue via `firstLetterPresented` flag. Tapping the card opens the letter directly (one tap, not two).

### Multi-step questlines (the established pattern)
Long plots run as **chains of scripted letters with deterministic `fixedOutcome` branches**, not AI-improvised arcs. Each step is a `make<Name>StepN()` helper returning a letter object; the previous step's `fixedOutcome.changes` sets a flag (e.g. `flags.cylinderOpened = true`); the next step is triggered in `tickDays` gated on that flag plus a day delay. Branching happens at chosen steps via three response choices, each carrying its own `fixedOutcome`. Examples shipped: Faulke / Brotherhood operative (3 steps), the Oilskin Cylinder (2 steps, 3 branches), the Pale Man's Sealed Letter (2 steps, 3 branches), the Wilbraham Mystery (3 steps), Dryden's Speculative Bench → Lord Mountfair. Resolution flags (e.g. `companyFaction`, `mountfairPatron`) are read by the charter-end branching outcomes (knighthood, estate, Resident, Brotherhood). When extending a chain, mirror an existing one — don't invent a new shape.

### Scripted arrivals
`SCRIPTED_ARRIVALS` is a registry of curated wharf moments. Triggers: `flag`, `location`, `locationIn`, `repAtLeast`, `visited`. `pickArrivalEncounter(gs, dest)` picks the first match on arrival; `ScriptedArrivalScreen` renders deterministic prose + choices. Use this for *payoffs* of plot beats, not generic flavour — first-visit AI vignettes already cover atmosphere.

### Standing Arrangements
`MAJOR_COMMITMENTS` lists the small set of **player-visible** ongoing arrangements (Dutch trade pass, Brotherhood compact, teak concession, Pyke's school subscription, &c.). Each entry carries a label function over `gs`. Surfaced in the Ledger as "Standing Arrangements." Deliberately curated — do **not** auto-flatten every flag here, that's the AI-flag spam we explicitly suppressed.

### Vignettes
Loading screens have an enforced minimum visible duration of **800ms** via wrapped `setPending` in `GameHub`. This is non-negotiable — without it, fast API responses make the vignettes flash too briefly to register and the user thinks they're broken (user reported this).

If you need to add a new loading vignette: add the SVG component, add a keyword to `pickVignette`. Match keywords against the lowercased message text. Keep them keyword-broad so future loading messages pick up sensible illustrations automatically.

### Mobile layout
- **`cols-2` uses `grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr))`.** Container-relative, not viewport-dependent.
- **`trade-row` defaults to vertical stack**, only goes horizontal at `min-width: 600px`.
- **The page wrapper has `overflow-x: hidden` and `box-sizing: border-box` globally** as safety nets.
- Use inline `style={{ maxWidth: 'Xrem', margin: '0 auto', padding: '...', width: '100%' }}` for top-level containers. Don't trust Tailwind classes.

### Save persistence
- Saves go through `safeStorage` (window.storage → localStorage fallback).
- Title screen ALWAYS shows first. It detects an existing save and offers Continue / Begin Anew / Restore from Manuscript.
- The in-game header `☰ Menu` exposes Download manuscript (JSON file), Copy to clipboard, and Return to Title.
- Download manuscript creates a timestamped `.json` file via Blob + anchor click — works on mobile.
- Restore parses pasted JSON, validates structure (`parsed.gs.player`, `parsed.gs.day !== undefined`).

### Save shape evolution (`ensureShape`)
`ensureShape(gs)` is the migration funnel for old saves. New top-level fields go in as `if (!next.X) next.X = default`. Never read a `gs` field without going through `ensureShape` on load. When you can't migrate cleanly, the title screen's Begin Anew is the answer — tell the user to wipe.

### Charter end, renewal, succession
At `daysRemaining === 0` the charter closes: `gs.charterClosed = { day, outcome }` is set, a final Director letter lands, the HUD swaps to "CHARTER CLOSED", and Indiaman / quarterly nags / one-off triggers all gate on `!charterClosed`. The title screen surfaces two paths: **Renew** (same Factor, fresh 3-year clock — only on success/partial outcomes) and **Take up the Charter** as named successor (fresh Factor, world state persists: standing, godown, brigantine, outpost). The four narrative end-states (knighthood, estate, Resident, Brotherhood) are read off the questline-resolution flags accumulated through play.

### Editing the file
- **Always use `Read` or `grep` to verify content before `Edit`.** The file evolves rapidly and prior context may be stale.
- **Run a parser sanity check after edits**:
  ```
  node -e "const p=require('/tmp/node_modules/@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); try { p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines'); } catch(e) { console.log('ERR:',e.message); }"
  ```
- In an artifact session, **surface the updated file to the user** after each substantive edit.

---

## Common pitfalls (lessons learned)

1. **Tailwind classes that don't apply silently leave layouts broken.** `max-w-4xl mx-auto px-4 py-5` looks like it works but the artifact runtime doesn't include Tailwind. Replace with inline styles.
2. **Media queries can lie in artifact iframes.** The viewport reported to CSS doesn't match the visible screen. Use container-relative grid (`auto-fit minmax`).
3. **SVG `<g style={{ stroke, fill, ... }}>` doesn't reliably cascade in this environment.** Use direct attributes: `<g stroke="#5c1a08" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">`.
4. **Loading screens flash too fast without a minimum duration.** API responses can be sub-200ms. Enforce minimum 800ms visibility (already wired).
5. **The AI hallucinates geography aggressively.** Always include `SCENE CONSTRAINT` lines in per-call prompts, not just the system prompt.
6. **Old saves break when you change `makeInitialState` shape.** When adding new fields, the user must "Begin Anew" to wipe and reseed. The Title screen makes this easy. Tell them to wipe.
7. **Don't auto-resume from saves.** The title screen is the source of truth for save management. Auto-resuming breaks the user's mental model and makes wiping hard.
8. **`window.confirm` is more obvious than inline confirmation flows on mobile.** Used for Begin Anew. The user found inline 2-step confirms invisible.

---

## Aesthetic palette (do not drift)

- **Background**: cream parchment gradient `#f0e3c4` → `#e8d9b5` → `#d9c596`
- **Sealing-wax red**: `#5c1a08` (primary accent, headings, wax-button)
- **Brown ink**: `#2a1a0a` (body text)
- **Faded ink**: `#6b4423` (small caps, secondary text, italic asides)
- **Dark ink for italic**: `#4a3220`

**Typography**: IM Fell English SC (small-caps display), IM Fell English (body italic), EB Garamond (body roman). Loaded via Google Fonts inside the inline `<style>` (`FONT_IMPORT` constant).

**Decorative elements**: `Fleuron` (❦ or ❧ char), wax-seal "⁕" and "⁂" glyphs for section markers. Keep them sparing.

---

## The user (Bradley)

Plays on the Claude mobile app. Based in Guadalajara, Mexico. Builds an Obsidian vault at `/Users/roti/pontus/vault/`. Interested in systematic thinking, trading, web3, Bitcoin/sound money. Curated a 140-book reading list.

He's responsive and direct. Will say "this doesn't work" when something doesn't work. Will say "do that now" when he wants you to ship rather than discuss. **He values:**
- Shipping over discussing
- Mobile-friendly UX
- Period-appropriate atmosphere
- Substantive, not generic AI prose
- Honest acknowledgment when something is broken

He has a Drive folder for this project (id `1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU`, name "Factor's Charter") where save backups, handoff docs, and source files can live. He uses chat ↔ Drive round-trips for backup workflow: he pastes manuscript JSON in chat, you save it to Drive with a timestamp.

---

## World-building feedstock & design feedstock

**Narrative work** → read `WORLD_NOTES.md` first. It's Bradley's notebook — inspirations, names he likes, anti-patterns, open hooks in plain English, and a record of which real-world references have already been transposed into the fictional SE-Asian setting (e.g. Bacalar → Tanjung Cermin). When new entries appear in the "INSPIRATIONS PENDING" section, translate them: usually one or more of `LORE`, `PORTS`, an auto-letter sender, an event hook. Never copy a real-world place 1:1 — always transpose for the world's geography.

**Gameplay-shape work** (mechanics, new systems, rebalances) → read `DESIGN_NOTES.md` first. It's the joint design notebook: research surveyed (Morrowind/EEC, Tamriel Rebuilt, Robinson Crusoe, period mercantile reality, Patrician/Anno/CK3/Port Royale), candidate moves, anti-patterns ruled out, and an ordered backlog. Add to the backlog with a date stamp rather than chatting decisions away.

The runtime `LORE` registry in `factors_charter.jsx` is the bridge: lore entries are surfaced to the AI in `stateContext` only when their triggers (location, flag, faction standing, visited) match. Capped at 3 entries per prompt. Keep entries tight (2–4 short sentences) — every line costs prompt budget on every relevant call.

---

## Development & deploy

- `npm install` — bootstrap dependencies.
- `npm run dev` — Vite dev server at `http://localhost:5173/`.
- `npm test` — Vitest suite (no tests currently; `src/llm/` and `src/settings/` tests removed with those modules).
- `npm run build` — production bundle into `dist/`.
- `npx vite preview` — serve the production build locally for testing.
- Pushes to `main` auto-deploy via Cloudflare Pages → `factors-charter.pages.dev`.
- The artifact path is unaffected by any of this. Inside Claude, `factors_charter.jsx` continues to run as a single-file artifact.

---

## When in doubt

Ship a fix and surface the file. Don't re-design. Don't add features the user didn't ask for. Don't write long prose responses on a small phone screen. Mirror his tone — direct, dry, no fluff.
