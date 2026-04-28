# CLAUDE.md — The Factor's Charter

This document is for any future Claude session picking up work on this project. Read it before touching the code.

---

## What this is

**The Factor's Charter** is a text-based mobile RPG built as a single-file React artifact. The player is a junior Factor (trading-company agent) named by them, posted to Bayan-Kor, a vaguely Southeast-Asian colonial frontier station in the early 1720s. They have a 3-year charter to ship 400cwt of pepper and 200cwt of cinnamon to London, navigating six factions (Honourable Company, Crown, the Rajah, the Brotherhood/pirates, the Mission, and the Dutch).

**Inspirations cited by the user (Bradley):** Robinson Crusoe (solitude, improvisation, the journal voice), Sunless Sea (atmosphere, prose-driven encounters), Morrowind's House Hlaalu and the Raven Rock / East Empire Company storyline (mercantile bureaucracy, faction politics), Civilization (long-arc compounding decisions). The aesthetic touchstone is a 1720s leather-bound logbook.

**Tone target:** dry, observational, period-appropriate. Sensory detail (heat, salt, mildew, palm oil, gunsmoke). Slight melancholy, occasional dark humor. No anachronisms — no "okay," no modern idiom. Names of people and ships should sound period-plausible. The narrator is the player's own hand, writing in their journal.

---

## Where the code lives

Single file: **`/mnt/user-data/outputs/factors_charter.jsx`**

Roughly 2,500 lines, single React component tree, default export `FactorsCharter`. Renders as a Claude.ai artifact. The file is monolithic by design — easier to ship as a single artifact, easier to keep in one place. Don't fragment it.

---

## Tech stack & runtime constraints

- **React JSX artifact** — uses `useState`, `useEffect`, `useRef` from React. No router. No external state.
- **Anthropic API** for generative prose: `claude-sonnet-4-20250514` via `https://api.anthropic.com/v1/messages`. Called from inside the artifact for voyage encounters, outcomes, letters, arrivals, and away-digests. Each generator has a deterministic fallback if the API fails.
- **Storage:** `window.storage` (artifact persistent storage) with `localStorage` fallback. Wrapped in a `safeStorage` helper at the bottom of the file. All save operations are try/catch'd — assume nothing about availability.
- **No Tailwind.** Some early code used Tailwind class names (`max-w-4xl`, `mx-auto`, `px-4`, etc.) but they don't reliably apply in the artifact runtime. Use inline styles for sizing and spacing. Some semantic classes (`display`, `parchment`, `wax-button`, `ghost-button`, `cols-2`, `trade-row`, `ink-fade-in`, `quill-cursor`, `fleuron`) ARE defined in the inline `<style>` block inside `<Page>` — those work. Anything else from Tailwind probably won't.
- **Mobile-first.** The user plays this on a phone in the Claude app. Two-column layouts must collapse cleanly. Use `grid-template-columns: repeat(auto-fit, minmax(...))` not media queries — the iframe's reported viewport is unreliable.

---

## Code architecture (top to bottom)

1. **Constants**: `COMMODITIES` (9), `PORTS` (4: Bayan-Kor home, Kota Pinang, Port St. Eustace, The Pelican's Nest), `FACTIONS` (6), `BUILDINGS` (6).
2. **`makeInitialState(name)`**: returns the starting `gs` object. **Pre-populates two letters** in the inbox (Director letter + Wilbraham's papers) and one open thread (the teak concession hook).
3. **Game state (`gs`) shape**:
   ```
   { day, location, player, money, goods, reputation, crew, npcs,
     outpost, awayLog, quotas, daysRemaining,
     journal[], letters[], hooks[], visited[],
     seenOpening, lettersGenerated, firstLetterPresented }
   ```
4. **`tickDays(gs, days)`**: pure home-station simulation engine. Drives outpost build queues and away-log accrual.
5. **AI helpers**: `SYSTEM_PROMPT`, `callClaude`, `stateContext`, `genVoyageEncounter`, `genOutcome(gs, prose, choice, opts)`, `genLetter`, `genArrivalVignette`, `genAwayDigest`. All have fallbacks. The system prompt contains a **WORLD GROUNDING** section that constrains hallucinations.
6. **`safeStorage`**: get/set/delete with dual backend.
7. **Vignettes**: 8 hand-drawn SVG line illustrations (`PinnaceVignette`, `HorizonVignette`, `HarborVignette`, `DeskVignette`, `SealVignette`, `MessengerVignette`, `HourglassVignette`, `ChartVignette`). Each uses direct SVG presentation attributes on `<g>` (not CSS style — CSS inheritance for SVG was unreliable). `pickVignette(msg)` keyword-matches loading messages to vignettes.
8. **`Loading`** component renders the matched vignette above the loading text.
9. **Components**: `Page`, `Fleuron`, `TitleScreen`, `OpeningSequence`, `GameHub`, `Header`, `Tabs`, `JournalView`, `LedgerView`, `MapView`, `PortView`, `OutpostView`, `AwayDigestScreen`, `LettersView`, `ChangesSummary`, `ProvisionsDrawer`.
10. **Root**: `FactorsCharter` (default export). Always lands on the title screen first — never auto-resumes.

---

## Critical conventions and patterns

### World grounding (do not violate)
The system prompt explicitly states: home-station characters (Mr. Hodge the clerk, Sgt. Dass, the Vizier, Reverend Pyke at the Mission) only appear at Bayan-Kor or in correspondence. They cannot be encountered at Kota Pinang, Port St. Eustace, or The Pelican's Nest. The Mission is at Bayan-Kor — it is not a separate port. New characters in voyage scenes must be properly introduced (a passing captain, a passenger, a castaway).

If the AI starts hallucinating these — e.g. "you visit the Reverend at Port St. Eustace" — tighten the per-call prompt's `SCENE CONSTRAINT` line. Don't try to fix it post-hoc in code.

### Letters are instant
Letter responses do **not** advance time. The `genOutcome` helper takes an `opts.isLetter` flag that tells the model to set `days: 0`, and `handleLetterResponse` belt-and-suspenders strips `days` from the result before applying. Don't break this — the user noticed and complained when phantom days appeared.

### Inbox style
All letters (read AND unread) stay visible in the Letters tab. The Journal page shows a persistent "Latest correspondence" card that adapts: bold red wax for unread, subtle "Re-read" for read. The first Director letter auto-opens after the prologue via `firstLetterPresented` flag. Tapping the card opens the letter directly (one tap, not two).

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

### Editing the file
- **Always use `view` or `bash grep` to verify content before `str_replace`.** The file evolves rapidly and prior context may be stale.
- **Run a parser sanity check after edits**:
  ```
  node -e "const p=require('/tmp/node_modules/@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('/mnt/user-data/outputs/factors_charter.jsx','utf8'); try { p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK'); } catch(e) { console.log('ERR:',e.message); }"
  ```
- **Use `present_files`** to surface the updated file to the user after each substantive edit.

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

## World-building feedstock

Read `WORLD_NOTES.md` at the repo root before any session that touches narrative or new content. It's Bradley's notebook — inspirations, names he likes, anti-patterns, open hooks in plain English, and a record of which real-world references have already been transposed into the fictional SE-Asian setting (e.g. Bacalar → Tanjung Cermin). When new entries appear in the "INSPIRATIONS PENDING" section, translate them: usually one or more of `LORE`, `PORTS`, an auto-letter sender, an event hook. Never copy a real-world place 1:1 — always transpose for the world's geography.

The runtime `LORE` registry in `factors_charter.jsx` is the bridge: lore entries are surfaced to the AI in `stateContext` only when their triggers (location, flag, faction standing, visited) match. Keep entries tight (2–4 short sentences) — every line costs prompt budget on every relevant call.

---

## When in doubt

Ship a fix and surface the file. Don't re-design. Don't add features the user didn't ask for. Don't write long prose responses on a small phone screen. Mirror his tone — direct, dry, no fluff.
