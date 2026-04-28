# CHANGELOG

The Factor's Charter — a chronological log of what's shipped. Newest first.

---

## Session 6 — fix the export crash

### Fixed
- **Header menu downloads no longer tear down the artifact.** The "Download manuscript" / "Download AI log" buttons used `Blob` + `URL.createObjectURL` + `a.click()`, which on mobile inside the artifact iframe can navigate the iframe to the blob URL — indistinguishable from a crash to the player. Same root cause for the marginalia's "Download manuscript" / "Copy to clipboard" pair.
- **Marginalia exports no longer crash.** Replaced for the same reason.

### Changed
- New shared **`ExportModal`** component renders a fixed-position overlay containing the JSON in a select-on-focus textarea, attempts an automatic clipboard copy on open, and offers an explicit "Copy to clipboard" button with a long-press-to-copy fallback when clipboard is refused. Pure DOM, no navigation, safe inside any iframe.
- Header menu: "Download manuscript (JSON)" → **"Show manuscript (JSON)"**, "Download AI log" → **"Show AI log"**. Removed the standalone "Copy to clipboard" entry — the modal now handles copy itself.
- Marginalia: "Download manuscript" → **"Show manuscript"**. Removed the standalone "Copy to clipboard" — same reason.
- Begin-anew confirmation copy updated to reflect the new "show + copy" workflow.

---

## Session 5 — schema expansion, AI log, robust saves

### Added
- **AI generations are now persisted.** Every Sonnet exchange (voyage encounter, outcome, letter, arrival vignette, away digest) records a full entry into `gs.aiLog`: `{ type, day, location, prompt, raw, parsed, fallback, error, startedAt, endedAt, meta }`. Capped at the most-recent 500 entries via `pushAiLog` to stay under localStorage limits; manuscript download still includes whatever's there.
- **"Download AI log" button** in the header menu — exports just `gs.aiLog` as timestamped JSON for offline analysis (categorising encounter types, scoring AI prose, etc.).
- **Outcome schema is open at the edges.** `genOutcome`'s prompt now describes three optional fields the AI can use:
  - `shipDamage: { hull: 0–40, sails: 0–40 }` — applied via `applyOutcomeChangesPure`. Letter outcomes can never damage the ship, even if the model returns it (defensive guard in both prompt and code).
  - `newAcquaintances: [{ name, role, location, notes }]` — minor characters introduced by the AI. Stored on `gs.acquaintances` via `upsertAcquaintance`, which dedupes on name and merges notes.
  - `flags: { key: value }` — narrative flags merged into `gs.flags`. Sparse, lasting, queryable.
- **`stateContext` now feeds back acquaintances, flags, and ship condition** so the AI sees its own world-state additions on later calls. Continuity emerges naturally — characters introduced once may recur.
- **Acquaintances panel in the Ledger** showing the last 8 named figures, where you met them, and accumulated notes.
- **Open Matters strip in the Ledger** when any narrative flags are set.
- **Ship damage and "Met X" appear in the Of Note summary** after an encounter resolves.

### Changed
- `callClaude` returns a rich record `{ parsed, raw, prompt, startedAt, endedAt, error }` instead of just the parsed JSON. All gen* helpers were updated to return `{ result, log }` accordingly.
- Every AI call site in `GameHub` (`sailTo`, `handleEncounterChoice`, `handleLetterResponse`, `requestNewLetter`, `arriveAt`'s digest + arrival paths) now appends its log entry to `gs.aiLog`.
- `applyOutcomeChangesPure(state, changes, opts = {})` accepts an `isLetter` flag and routes around ship damage in letter contexts.
- `SYSTEM_PROMPT` got a new "WORLD STATE" section describing the optional fields and how Sonnet should use them.
- `ensureShape` now seeds `acquaintances: []`, `flags: {}`, `aiLog: []` for older saves.

### Notes
- The 500-entry log cap is mainly to protect localStorage; a typical playthrough won't reach it. If it ever does, the oldest entries roll off but the manuscript download still captures what's live.
- Schema-expansion is permissive on purpose: the AI is invited to plant state but not required to. Old fallbacks (when the API is down) still produce playable outcomes without any of the new fields.

---

## Session 4 — repair anywhere, money sinks

### Added
- **Refit at any port.** The slipway panel works at every port now, not only Bayan-Kor. Each away port has a `yard` quality (`fine` = Port St. Eustace, `middling` = Kota Pinang, `rough` = Pelican's Nest). Home stays special-cased: instant work at the existing flat rate (£1/pt with the Shipwright's Yard, £2/pt without).
- **Time as a refit cost.** Away refits run `tickDays` for the work, so the home colony lives on while you're stuck on the slipway, and away-events accumulate as usual.
- **Standing modifies cost and time** at non-home ports: cordial faction relations bring the price in (×0.75); hostile relations gouge you (up to ×1.4). `standingMult(rep)` table.
- **Expedite mechanic** — a single "rush" rate that applies to both repairs and construction:
  - **Refit (rush):** 1.5× cost, half the time.
  - **Rush the work** button per queued building: pays a 1.5× premium proportional to the days remaining and halves `daysLeft`. Repeatable until 1 day left.
- **Slipway UI** now shows yard quality, a faction-standing note when relevant, the points of damage to fix, and side-by-side Refit / Rush buttons.

### Changed
- `refitCost(gs)` replaced by structured `repairQuote(gs, opts)` returning `{ points, cost, days, yard, standingMult, ... }`. Both the panel and the handler use the same source of truth.
- `refitShip` is now async and accepts an `expedite` flag; it ticks `tickDays(quote.days)` and writes a journal entry naming the days spent.
- The "Ship Unfit" sail-block is no longer a dead-end: stranded at the Pelican's Nest with a wrecked hull is now a genuine money/time decision instead of a save-load problem.

### Notes
- Multi-level buildings, resource-as-payment for repairs, and faction loans are deferred to a later pass.

---

## Session 3 — scarcity pass

### Added
- **Ship as a first-class object** (`gs.ship`): `name`, `type` (pinnace), `holdCwt: 60`, `hull` and `sails` (0–100), `guns: 0`. `SHIP_TYPES` constant scaffolds future hulls.
- **Hold capacity / cargo weight.** Each commodity has a `weight` in cwt-equivalents. `cargoWeight(goods)` and `cargoCap(gs)` enforce a stowage cap on every purchase. "Buy max" replaces the old fixed Buy 10.
- **Finite port stocks.** Each port has `stockMax` and `restock` per commodity it sells. `gs.portStocks[port][commodity]` depletes on buy and replenishes daily via `tickDays`. Stock is shown on the Map and at the Wharf; exhausted stock disables Buy.
- **Voyage wear.** `applyVoyageWear(ship, days)` chips 1–3 hull and 1–3 sails per voyage day. Below `MIN_HULL_COND` / `MIN_SAIL_COND` (25), the master refuses to put to sea.
- **Slipway refit at Bayan-Kor.** New "THE SLIPWAY" panel on the In Port view. £2/point without the Shipwright's Yard, £1/point with it. Restores hull and sails to 100 instantly.
- **Ship readout in the Ledger.** New "THE PINNACE" card at the top of `LedgerView` with hold gauge and hull/sails bars.
- **Hold gauge in the Header second line** alongside money and days remaining.
- **Save migration via `ensureShape(gs)`** — older saves missing `ship` or `portStocks` get defaults on Continue / Restore so they don't crash. New shape still favors a clean Begin Anew for the full experience.

### Changed
- `tickDays` now clones and replenishes `portStocks` for every port each day.
- Map view's "they sell" row shows current stock and tags it "low" or "none" where relevant.
- Map view disables `Sail Here` and shows a red note when the ship is too damaged to sail.
- In Port view's Buy buttons respect money, hold remaining, and port stock simultaneously.

### Notes
- The AI outcome schema is unchanged this pass. Schema-expansion (so Sonnet can plant NPCs / damage / cargo events) is the planned second pass.

---

## Session 2 — late session

### Added
- **8 SVG vignettes** for loading screens: PinnaceVignette (sailing), HorizonVignette (uneventful voyage), HarborVignette (arrival), DeskVignette (away digest), SealVignette (letter reply), MessengerVignette (new letter), HourglassVignette (encounter outcome), ChartVignette (initial load). Hand-drawn line illustrations in sepia ink (`#5c1a08`), no fills, ~280×140 viewBox. Each uses direct SVG presentation attributes on `<g>` for reliable inheritance.
- **`pickVignette(msg)` keyword matcher** maps loading messages to the appropriate vignette.
- **Visible PinnaceVignette on title screen** as a permanent visual anchor and proof-of-rendering.
- **800ms minimum loading visibility** — wraps `setPending` in `GameHub` with a `useRef`-tracked start time. Prevents fast API responses from flashing vignettes too briefly to register.
- **Header `☰ Menu`** in-game with: Download manuscript (JSON), Copy to clipboard, Return to Title screen.
- **Title screen save management**: Continue (resume from save), Begin a New Charter (wipes save), Restore from Manuscript (paste JSON). Title screen is now always shown first — never auto-resumes.
- **Wilbraham's papers** as a second pre-populated inbox letter — a packet of journal entries from the previous Factor (his year and a half at Bayan-Kor, ending with Hodge's note of his death). Hints about the teak concession, the Vizier's Friday audiences, the Brotherhood prahu.
- **Pre-populated Director letter** in initial state, auto-opens after the prologue. Lifted `openLetterId` to `GameHub` so external triggers can open specific letters.
- **"Latest correspondence" card on Journal** — always visible regardless of read state. Bold red wax for unread (with "Read" button), subtle for read (with "Re-read"). One-tap to open the letter directly.
- **"Noted in your ledger" port trade info on the Chart view** — shows what each visited port buys and sells, with current prices and relative-advantage tags (cheap/fair/dear for sells, premium/good/modest for buys). Unvisited ports show "their goods are unknown to you."
- **`hooks: ['The inland teak concession — ter Borch wants it.']`** seeded in initial state from Wilbraham's papers.

### Changed
- **`cols-2` grid switched to `repeat(auto-fit, minmax(18rem, 1fr))`.** Container-relative responsive behavior, immune to artifact iframe viewport quirks. Previously used `@media min-width: 820px` which wasn't firing on mobile.
- **`trade-row` defaults to vertical stack**, only goes horizontal at `min-width: 600px`. Each commodity row has the name on top and buy/sell buttons in a row below — no more cramped horizontal layout on phones.
- **Begin Anew uses native `window.confirm()`** instead of inline 2-step confirmation. The inline version was easy to miss on mobile — looked like nothing happened. Native dialog is unmissable.
- **Tailwind width classes replaced with inline styles** throughout (`max-w-2xl`, `max-w-3xl`, `max-w-4xl` → explicit `style={{ maxWidth: '...rem', margin: '0 auto', padding: '...', width: '100%' }}`). Tailwind doesn't reliably apply in the artifact runtime.
- **Page wrapper now has `overflow-x: hidden` and `box-sizing: border-box`** globally as safety nets.
- **`ghost-button-sm` tightened**: padding `0.55rem`, font-size `0.78em`, `white-space: nowrap` to prevent text wrapping inside small buttons.
- **`SYSTEM_PROMPT` got a WORLD GROUNDING section** explicitly listing where each named character lives and forbidding the model from importing home-station characters into voyage scenes.
- **`genVoyageEncounter` and `genOutcome` got per-call SCENE CONSTRAINT lines** reinforcing the geographic rules.
- **`LettersView` converted to controlled component** — accepts `openLetterId` and `setOpenLetterId` from parent instead of holding internal state. Lets the Journal "Read" button or the post-prologue auto-open trigger letter detail directly.
- **`JournalView` accepts `openLetterById` prop** — Read button on the correspondence card now opens the letter in one tap, not two.

### Fixed
- **Phantom day passing in letter outcomes**. The AI sometimes invented `days: 1` in letter response outcomes, which the "Of Note" summary then displayed as "1 day passed" — but the actual game state didn't advance time. Now `handleLetterResponse` strips `days` from result before applying, AND passes `opts.isLetter: true` to `genOutcome` so the prompt itself instructs the model to set `days: 0`.
- **Geographic hallucinations** (e.g., "you visit Reverend Pyke at Kota Pinang"). Fixed via WORLD GROUNDING in system prompt + per-call SCENE CONSTRAINT.
- **First Director letter never opening**. Was previously generated async via `useEffect` in `GameHub` (race conditions, easy to miss). Now pre-populated in `makeInitialState` and force-opened after the opening sequence via `firstLetterPresented` flag.
- **Saves not resettable** without digging into marginalia. Title screen now always shows first, with a prominent "Begin a New Charter" button.
- **Loading screens flashing too fast to see vignettes** — fixed via 800ms minimum.

### Removed
- The old async `addFirstLetter` function and its `useEffect` in `GameHub` (made redundant by pre-population in initial state).
- The 2-step inline "Begin Anew" confirmation flow on title screen.
- `vignetteStroke` style object — replaced with direct SVG attributes on `<g>` elements.

---

## Session 1 — initial build (reconstructed from prior summary)

### Added
- **Title screen** with name input, period framing ("In the year of Our Lord one thousand seven hundred and twenty-one"), drop cap intro.
- **4-screen opening sequence** (A Sealed Packet → The Voyage → Bayan-Kor at Anchor → The Charter Begins) — Crusoe-style framing.
- **Game hub** with tabbed interface: Journal, Ledger, Voyage (Chart), In Port (or Outpost when at home), Letters.
- **9 commodities**: pepper, cinnamon, calico, silver, sandalwood, opium, rice, rum, saltpetre. Each with unit (cwt, bolt, ingot, log, chest, sack, barrel, keg) and base price.
- **4 ports**: Bayan-Kor (home), Kota Pinang, Port St. Eustace (Dutch), The Pelican's Nest (pirate). Each with `daysFromHome`, faction allegiance, buy/sell multipliers, and rep gates.
- **6 factions**: Honourable Company, Crown, Rajah, Brotherhood, Mission, Dutch. Each with a `repTone()` function for label.
- **6 outpost buildings**: stockade, counting_house, chapel, plantation, barracks, shipwright. Build queue at home with daysLeft tracker.
- **Deterministic price model**: `priceFor(port, commodity, day)` — base price × port multiplier × seasonal/daily fluctuation.
- **AI prose generation** via Anthropic Sonnet 4 API (`claude-sonnet-4-20250514`):
  - `genVoyageEncounter(gs, from, to)` — 3-4 sentence scene with 3 choices.
  - `genOutcome(gs, prose, choice)` — 2-3 sentence outcome with state changes.
  - `genLetter(gs)` — period-style letter with multiple-choice replies.
  - `genArrivalVignette(gs, port)` — atmospheric arrival prose.
  - `genAwayDigest(gs, log)` — what happened at home while away.
  Each with hardcoded fallback prose if API fails.
- **Save persistence** via `safeStorage` helper (window.storage with localStorage fallback). Auto-saves on every state change.
- **Manuscript export/import** via JSON download (Blob + anchor) and clipboard copy.
- **Mobile-first CSS** with `cols-2`, `trade-row`, `ghost-button-sm` semantic classes.
- **Reputation system** affecting port access and letter sender selection.
- **Quotas display** (400cwt pepper, 200cwt cinnamon, 1095 days remaining).
- **Open threads** (`hooks[]`) tracking narrative beats for the AI to reference.
- **Visited ports tracking** (`visited[]`).
- **NPC tracking** for Hodge (sobriety, loyalty, lastDrunk), Dass (loyalty, morale, health), Vizier (friendliness, scheming).
- **Tickdays simulation engine** for home-station progression while away.
- **AwayDigestScreen** showing what accrued during voyages.

### Aesthetic
- **Color palette**: cream parchment gradient (`#f0e3c4` → `#d9c596`), sealing-wax red (`#5c1a08`), brown ink (`#2a1a0a`), faded ink (`#6b4423`).
- **Typography**: IM Fell English SC (small-caps display), IM Fell English (italic), EB Garamond (body), loaded via Google Fonts.
- **Decorative**: `Fleuron` component, wax-seal glyphs (⁕ ⁂), parchment background gradient.

---

## Drive backup workflow

The "Factor's Charter" Drive folder (id `1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU`) is set up to receive game-state JSON backups. Workflow: user exports manuscript via header menu → pastes JSON in chat → Claude saves to Drive with timestamp. Untested in production yet.
