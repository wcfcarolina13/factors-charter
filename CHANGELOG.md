# CHANGELOG

The Factor's Charter — a chronological log of what's shipped. Newest first.

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
