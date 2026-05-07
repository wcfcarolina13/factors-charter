# CHANGELOG

The Factor's Charter — a chronological log of what's shipped. Newest first.

---

## 2026-05-07 — Cross-device save sync

A charter can now follow the player between devices. First save of a new charter prompts "Sync this charter across devices?"; on yes, an unguessable themed playthrough ID is generated (`pelican-salt-pepper-1923` style) and the save pushes to Cloudflare KV via `functions/api/save.js` (a Pages Function deployed alongside the site). On launch, the cloud version is checked: if newer, it silently replaces local; if both have progressed since the last sync, a conflict modal shows stats from each version and the player picks one — the discarded version auto-exports as a Manuscript JSON. Existing pre-sync charters can opt in via "⁂ Sync this charter" in the in-game `☰ Menu`.

Server-side: 60 req/min per IP rate limit, 256 KB body cap, 365-day TTL on saves (renews per push). No accounts; the playthrough ID is the secret.

The synced payload strips `gs.aiLog` (debug-only AI request/response history; not needed for play continuity) and is well under the body cap; pulled state is merged via `applyPull` to preserve the local `aiLog`.

Pure logic split into `src/util/playthrough-id.js` and `src/util/sync-conflict.js` with vitest coverage. Total tests now 33 across 4 files.

This completes the two-mode design from earlier today: same charter, two interaction modes (mobile / desktop), silent sync between them.

---

## 2026-05-07 — Desktop rendering mode

The PWA now adapts to viewport: on screens ≥1024 px with a pointer device, the layout unlocks two-column views — Letters with list + reading pane via `<LettersDesktop>`, Map + Ledger combined into a single Overview tab via `<DesktopOverview>`, Outpost in a three-pane grid (Standing / Under construction / Available). Voyage encounters, arrival vignettes, and letters render with an inline auto-generated period illustration drawn by Pollinations.ai and cached in localStorage (LRU at 50 entries, content-hash keyed).

Pure logic split into `src/util/`: `text.js` (stableHash, cleanProse), `viewport.js` (detectMode, setOverride), `illustration-cache.js` (getOrFetch, markLoaded, LRU eviction), `style-prefix.js` (single-source image-gen prefix). React hook `useViewportMode` and the new components (`<InlineIllustration>`, `<LetterReadingPane>`, `<LettersDesktop>`, `<DesktopOverview>`) live in the JSX monolith. Restored vitest with 17 pure-function tests across `text.test.js` and `illustration-cache.test.js`.

Override toggle in the in-game `☰ Menu` ("Compact view" / "Wide view"); persists per device. Mobile UI is byte-identical. The existing `<ImaginePanel>` button-on-demand path remains in both modes — `<InlineIllustration>` falls back to `null` on fetch failure and the button stays available.

Subsystem A (cross-device save sync via Cloudflare Pages Function + KV) is the next ship; spec at `docs/superpowers/specs/2026-05-07-two-mode-design.md`, no plan yet.

---

## 2026-05-07 — Pool expansions (cont’d): voyage encounters + away digest

Two more concerns from the audit closed:

- **`genVoyageEncounter`** — replaced the single squall-on-horizon fallback with a 12-entry pool covering weather, navigation, other vessels, maintenance, wildlife, and atmospheric scenes. Each has 2-3 sentences of period prose plus three labeled choices with tonal seeds. Random pick on every fallback. Original squall kept as the anchor entry.
- **`genAwayDigest`** — replaced the single "ledger half-kept" fallback with event-aware branched pools (raid / incident / indiaman / construction / harvest / letter / default), 18 entries total across 7 branches. `pickAwayDigestFallback` inspects `awayEvents` and routes to the most consequential branch — so a raid week gets raid prose, an Indiaman week gets Indiaman prose, etc. Closes the contextual-mismatch concern from the audit.

Four of the original five pool concerns are now addressed in same-day same-PR work. Remaining open: `genLetter` faction × mood templates (top priority — needs Bradley's tonal authoring for the six faction voices).

---

## 2026-05-07 — First pool expansions (post-strip)

The first two entries from the deterministic pool audit are closed:

- **`genOutcome`** — replaced the single fixed fallback with two 8-entry pools (encounter / letter-reply) of `{prose, journal}` pairs, picked at random. The "A day passed without consequence." permanent-journal repetition is gone. Highest-frequency generator (~50–130 calls per charter), so this is the most visible win.
- **`genArrivalVignette`** — replaced the single port-name-interpolated line with one distinctive vignette per port (Bayan-Kor / Kota Pinang / Port St. Eustace / The Pelican's Nest / Tanjung Cermin / Fort Marlborough), each leaning on its faction and lore. Once-per-port salience plus port-distinctive sensory detail.

Tone matches the existing fallback anchor — dry, observational, period. `DESIGN_NOTES.md` audit entries updated to reflect new pool sizes; remaining open items: `genLetter` (faction × mood pool) and `genAwayDigest` (event-log echo).

---

## 2026-05-07 — Strip live-AI from PWA

PWA goes deterministic-only. Removed `src/llm/` (Anthropic + Ollama providers, dispatcher, all LLM tests) and `src/settings/` (SettingsPanel + store + tests). `callClaude` now short-circuits in PWA mode so every generator falls through to its inline fallback. Title-screen Settings button, in-game ☰ Menu Settings entry, and "Set up an AI provider to begin" first-launch banner all removed. CSP `connect-src` tightened — dropped `api.anthropic.com`, localhost / 127.0.0.1. Artifact runtime unchanged. Pool audit captured in `DESIGN_NOTES.md` as the post-ship expansion backlog.

---

## Session 8 — port storage, the Indiaman, faction hooks, the brigantine, world-building scaffold

A long branch (`claude/port-storage-defense-JFty8`) that fixed a structural problem (the quota was unfillable: pinnace held 60 cwt, quota was 600 cwt) and built outward from there.

### Added — storage and defense at Bayan-Kor
- **Godown** at the home port: `gs.outpost.warehouse`, separate from the ship's hold. Base 120 cwt, +400 with a new **Great Godown** building (£140, 50 days). Pepper/cinnamon lodged here count toward the London quota.
- **Powder Magazine** building (£100, 35 days) — caps any single raid loss at 10%.
- **Lodge / Withdraw panel** at the Wharf at home, plus a `GodownPanel` showing current stocks and quota progress.
- **Raid event** in `tickDays`: opportunists can carry off a slice of stored pepper/cinnamon/silver/opium/sandalwood. Stockade halves the chance, Barracks halves it again, Magazine caps the loss.
- **Raid → scene** on return home: the most recent raid in the away-log surfaces as an interactive choice in `AwayDigestScreen` — pursue inland with Sgt. Dass, send word to the Vizier, or let it pass. Each calls `genOutcome` for prose and outcome.
- **Plantation harvest** routed to the godown (with overflow noted in the away-log).

### Added — the Indiaman cycle
- **East Indiaman call** every 180 days (six in the charter) lifts pepper/cinnamon from the godown back to London. `gs.quotas[k].have` repurposed as cumulative shipped tally.
- **Director letter** lands by the same packet — three deterministic tone variants (success / partial / empty), then asynchronously upgraded by AI via `genIndiamanLetterPayload` when the API is reachable. Deterministic fallback always shows first.
- **Quarterly Director nags** at `lastVisit + 90` (so day 90, 270, 450, …): four templated tones based on cumulative pace. Doubles letter density.
- **Charter end at day 0**: `gs.charterClosed = { day, outcome }` set, final Director letter (success / partial / failure recall), HUD swaps to "CHARTER CLOSED", title roster row labels expired charters. Indiaman, quarterly nags, auto-letters and the one-off triggers gate on `!charterClosed` so the world goes quiet.

### Added — the Brigantine
- **Country brigantine** as the next ship: 180 cwt hold (3× pinnace), wear 0.6–1.5 per voyage day vs 1.0–3.0 (Pegu teak), −1 day on legs of 4+ days, 6 guns. Period-accurate as the workhorse of the Company's intra-Asian "country trade."
- **Commission** at Bayan-Kor's Shipwright's Yard: £900 + 60 days. Pinnace stays in service while she's on the stocks; sold to a Bugis trader for £100 on launch. Cargo transfers automatically.
- **`voyageDays(gs, port)`** helper; `applyVoyageWear` reads ship-type wear ranges.

### Added — world-building feedstock
- **`LORE` registry** in `factors_charter.jsx` with `loreForState(gs)` — surfaced to the AI in `stateContext` as a "Local knowledge" line only when triggers (location, visited, flag, repAtLeast, always) match. Capped at 3 entries per prompt to protect token budget.
- **`WORLD_NOTES.md`** at the repo root: Bradley's notebook for tone touchstones, anti-patterns, inspirations landed (with cross-refs to LORE keys and code locations), inspirations pending, names worth keeping, open hooks in plain English. CLAUDE.md now requires reading it before any narrative session.
- **First port: Tanjung Cermin** — drawn from the Bacalar pirate-bay history (1648 English sack, 1652 Diego el Mulato, lagoon of seven colours, Spanish refortified 1727–33) and transposed into the SE-Asian setting with a Bugis-coded name and an old Portuguese fort. Gated on pirates ≥ +25 AND visited Pelican's Nest. Off the chart until then.
- **LORE entries** for Bayan-Kor, Kota Pinang, Port St. Eustace, the Pelican's Nest — 4–5 sentences each.

### Added — faction one-offs (the named-figure scripted-letter pattern)
Five of the six factions now have a one-time scripted letter from a named figure with three deterministic responses (`fixedOutcome` path, no AI on the mechanics):
- **Rajah / The Vizier** — the inland teak concession (the long-suspended Wilbraham hook). Three responses: take it for the Company (£120 tribute, brigantine drops to £600), sell on to ter Borch (+£200), decline. Trigger: day ≥ 60, Rajah ≥ +5.
- **Dutch / Mynheer Hendrik Boom** — the writ of free trade, in exchange for £250 tribute, a sealed packet to deliver east (plants the `carryingDutchPacket` hook), or a refusal. Holding the pass halves Dutch port duty regardless of standing — the lever above standing. Trigger: day ≥ 90, visited Eustace, Dutch ≥ −10.
- **Mission / Reverend Pyke** — a subscription for a small Mission school. Three levels (£100 generous, £30 modest, decline). Generous plants a hook for a recurring child of the school. Trigger: chapel built, day ≥ 100, Mission ≥ +5.
- **Brotherhood / Capt. Gerrit Maas** — a private compact for safe passage in the strait. £200 tribute halves voyage encounter chance (60% → 40%). Trigger: visited Pelican's Nest, day ≥ 75, pirates ≥ +5.
- **Crown / Capt. Edward Whitcombe of HMS Adventure** — intelligence on the Brotherhood, a £100 advance against Bombay credit, or a refusal. Trigger: day ≥ 120, has put into a foreign port.

### Added — scripted arrival encounters
- **`SCRIPTED_ARRIVALS` registry** + `pickArrivalEncounter(gs, dest)` helper + `ScriptedArrivalScreen` component. Curated, choice-driven moments at the wharf when a trigger matches. First entry is the **Dutch packet payoff** at the Pelican's Nest or Tanjung Cermin (a wharf-rat with a missing thumb meets the gangway): hand over clean, read the seal first (plants a Dutch ledger of English-pirate dealings hook), or cast it into the harbour (Boom won't forget).

### Added — auto-delivered correspondence
- The `Await the post` button and the marginalia `Conjure a letter` button removed. Letters now arrive on a schedule (~30–55 days) from a weighted, gated pool of senders: Mrs. Wexley, Capt. Faulke, Pyke (mission ≥ −10), the Anonymous Hand (pirates ≥ +5), ter Borch (dutch ≥ −25). Director and Vizier excluded from the auto pool — they have their own dedicated tracks.
- `genLetter` refactored to take an explicit sender; prompt sharpened to lean on `stateContext` (godown stocks, quota, brigantine on the stocks, teak concession holder).

### Added — header HUD strip + AI quota awareness
- Second info line in the Header: `GODOWN X/Y · LONDON: PEPPER N/400 · CINNAMON N/200`. Always visible.
- `stateContext` now includes the Factor's reckoning, Indiaman ETA, and charter days remaining. The AI can reference these in encounters and letters.

### Added — multi-save slots
- `factor_save_<id>` per slot, `factor_saves_index` lists them. Title screen renders a roster of every charter in progress (name, port, "Day X of Y" or "Charter closed", relative timestamp). Resume / strike-out per slot. Legacy `factor_save` migrates to a slot on first load and is removed.
- Begin Anew flow uses an inline confirmation panel (replaces the silent `window.confirm` swallowing on the artifact runtime).

### Added — four new SVG vignettes
- **GodownVignette**, **BrigantineVignette**, **IndiamanVignette**, **PalaceVignette** — single-colour line illustrations matching the existing eight. Wired into `pickVignette` by keyword.

### Changed — prompts
- `SYSTEM_PROMPT` tightened: prose discipline (concrete sensory detail over metaphor, ≤1 figurative comparison per passage); flags discipline (one flag per fact, no paired keys, only set if a later scene could reference); hooks discipline (refine existing threads before adding parallel ones).
- Voyage encounter prose trimmed 3–4 → 2–3 sentences. Generic "his ship" replaces hardcoded "the pinnace."
- `genOutcome` adds "concrete observation, avoid metaphor" hint.

### Changed — port arrivals
- First-visit-only AI vignettes. Revisits skip the call entirely.

### Changed — Dutch port duties
- **Port St. Eustace** levies a duty on every transaction. Base 10%, modulated by Dutch standing (cordial −25%, hostile +60%). Surfaced in the cargo banner, per-row prices, and journal entries.
- Holding `gs.flags.dutchTradePass` halves the rate outright — orthogonal to standing.

### Disabled
- **GitHub backup** hidden behind `ENABLE_GITHUB_BACKUP = false`. The artifact iframe's CSP allowlists `api.anthropic.com` but blocks `api.github.com`; every push fails with "Failed to fetch" before reaching GitHub. All underlying code (`GithubBackupModal`, `pushFileToGitHub`, config helpers) left intact — flip the flag when running outside Claude.

### Removed
- Manual `requestNewLetter` handler — letters now arrive on the auto schedule.

---

## Session 7 — GitHub backup

### Added
- **Direct push to GitHub** for manuscript and AI log, replacing the mobile-hostile copy/paste workflow.
  - Uses the GitHub Contents API (`PUT /repos/{owner}/{repo}/contents/{path}`), which supports CORS, so it works straight from the artifact iframe.
  - **`GithubBackupModal`** handles first-time setup (PAT, owner, repo, branch, path prefix) and per-save uploads.
  - PAT stored in its own `localStorage` key (`factor_github_config`) — never written into a manuscript export, so a manuscript can be safely pasted around without leaking credentials.
  - Manuscripts go to `{path}/manuscripts/factors-charter-day{day}-{ts}.json`. AI logs go to `{path}/ai-log/factors-charter-ai-log-day{day}-{ts}.json`. Each push uses a unique timestamp filename so no `sha` is needed and pushes never conflict with prior backups.
  - Status panel reports the URL of the pushed file on success and a hint for common failure modes (401 → token; 404 → repo/scope; 422 → name collision).
- **Header menu entry "↑ GitHub backup"** opens the modal. Label shows `owner/repo` once configured, otherwise `(configure)`.

### Why
Bradley's mobile setup makes copy-paste from textareas unreliable (Android often hides the copy menu) and blob downloads either silently navigate the iframe or do nothing useful. Pushing directly to a repo over HTTPS removes the local file step entirely.

### Token guidance
Use a **fine-grained personal access token** scoped to one repository, with **Contents: Read & write** permission. Don't reuse a classic token with broad scopes.

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
