# PLAYTEST_LOOP.md — autonomous playtest-and-improve log

State for the `/loop` playtest session (started 2026-06-12). Goal: make the
game more **fun, addictive, and rewarding** while keeping its flavor — dry
1720s mercantile journal RPG, Sunless Sea / Morrowind-EEC / Crusoe tone,
mobile-first offline PWA. Brainstorm is self-directed (Bradley waived input).

**Restore point:** tag `checkpoint-pre-playtest-2026-06-12` (pushed).
Each improvement: playtest → scope → implement (TDD where pure) → verify live
→ commit → push only on Bradley's word (loop commits locally, batches pushes).

> Update this file every iteration: log what I observed, what I changed, and
> what's queued next. This is the loop's memory.

---

## Design lens — what makes THIS game addictive (within flavor)

Addictiveness levers that fit a prose-driven trading journal (not arcade dopamine):

1. **The "one more voyage" pull** — a satisfying short loop (sail → trade →
   pay off) that resolves in 1–2 voyages, nested inside the long quota arc.
   Needs a legible *payoff moment*, not just a number ticking.
2. **Variable, anticipated reward** — price windows (now surfaced), encounter
   outcomes, the illustration reward. Anticipation > the reward itself.
3. **Compounding progression** — outpost, brigantine, standing, godown. Early
   success should *snowball* visibly (Civ-style long arc).
4. **Goal gradient** — visible near-term targets ("£X to commission the
   brigantine") pull harder than a distant quota. Surface the next rung.
5. **Narrative pull-forward** — questlines/letters answering "what next."
6. **Legible risk-reward tension** — bottomry, contraband, pirate dealings:
   the temptation must be *felt*, the stakes clear before the choice.

Anti-flavor (avoid): arcade feedback, score/achievement spam, modern idiom,
real-time pressure, anything that breaks the quiet-ledger mood.

---

## Findings log (newest first)

### Iteration 14 — 2026-06-12 — capstone integration playthrough (CLEAN) → loop concluded

Fresh new-game run through the early game, verifying the 11 changes integrate
together (each was verified individually; this confirms they *flow*):

1. Opening → Director letter **auto-opens** ✓
2. Wilbraham's papers carry both quota intel + country-trade guidance ✓
3. Voyage to Kota Pinang — 4 days (3 + 1 encounter), pluralized right ✓
4. Buy pepper (42 cwt, £8/cwt) ✓
5. Return — **3 days** (the voyage-time fix holds; not the old 1-day bug) ✓
6. Lodge → toast "Lodged 42 cwt of Pepper — 42 of 400 secured for London" +
   HUD jumps **0→42/400** instantly ✓
7. First world letter arrives **day ~12**, warm: "Mrs. Eliza Wexley, your
   sister — Of Father's Health and a Matter in the Will"; next at day 43 ✓

Zero console errors. The early-game spine integrates cleanly — onboarding,
voyage-time, lodging beat, early pacing, warm first contact, and encounter
handling all work together in a real playthrough.

**→ Loop concluded here.** 11 genuine improvements shipped + 4 verified-good
confirmations over 14 iterations; the capstone confirms it all holds together.
The game is well-polished across its whole arc. Remaining items
(economic late-game tuning, faction-keyed encounter variants) are subjective /
content decisions that are Bradley's to make, not autonomous work. Re-runnable
anytime via `/loop`. Tests 165/165, build clean, all work on local `main`
(unpushed), checkpoint tag `checkpoint-pre-playtest-2026-06-12` as the backup.

### Iteration 13 — 2026-06-12 — economic pressure (verified reasonable; flagged for Bradley)

**Examined the numbers** (not a unilateral change — economy feel is Bradley's call):

- **Buy side is capped.** Kota Pinang pepper: stockMax 80, restock 0.7/day. You
  can't buy infinite pepper per visit, and frequent visits drain it faster than
  it refills. The hold (pinnace 60 / brigantine 180) and the **quota** contest
  the *same* pepper stock + hold space, so arbitrage and quota-filling trade off
  against each other — real opportunity cost.
- **Margins are modest.** Pepper base 12 → buy ~£8 at KP (×0.7), sell ~£17 at
  Eustace (×1.4) / ~£18 at Marlborough (×1.5) — minus Dutch duty and the longer
  KP→Eustace→home route. ~£400-500 per ~13-day arbitrage cycle, not the ~£3k I'd
  loosely guessed.
- **Sinks** total ~£4-5k/charter: buildings ~£1,070, brigantine £600-900, refit
  ~£2-3/point over ~50 voyages (~£2k). **No punishing recurring upkeep** — which
  is *deliberate*: Bradley's design explicitly avoided slog (the "day-100 slog"
  was about tedium, not too-little pressure).

**Conclusion:** money is a meaningful early/mid-game constraint, then yields to
time/quota pressure late — the normal trading-game arc (scarcity → power →
execution). No degenerate exploit (stock cap + contested resources gate it).
Mid-game money abundance is a design *choice*. **If Bradley wants more late-game
money tension**, the lever is a light recurring cost (household wages / building
upkeep) — but that risks reintroducing slog, so it's his call, not an autonomous
change. Flagged, not touched.

---

## Loop retrospective (after 13 iterations)

**11 genuine improvements shipped + 2 verified-good confirmations.** The game is
now well-polished across its whole arc. Reward beats (lodging, wealth, Indiaman,
brigantine, finale) all land in the Factor's voice; the spine (onboarding →
early letters → trade → finale → succession → renewal) presents every major
moment; the most frequent interaction (encounters) is varied; risk decisions are
legible. The last several iterations increasingly verify systems *good* — the
high-value autonomous work is essentially complete.

**Remaining items all need Bradley's input** (subjective/feel or content-tone):
economic late-game tension (above); faction-keyed encounter variants (content);
any further balance tuning. These shouldn't be done autonomously.

**Planned next:** one holistic fresh-eyes playthrough as a capstone QA pass
(verify the 11 changes integrate cleanly start-to-finish), then conclude the
active loop — re-runnable anytime via /loop.

### Iteration 12 — 2026-06-12 — prose scan + renewal verification (no code change)

Two verified-good checks; no warranted change — an honest result at the
polished tail of the loop.

- **Prose/text quality — verified CLEAN.** Systematic scan for double spaces,
  missing spaces after periods, doubled words ("the the"), common misspellings,
  and apostrophe inconsistency turned up nothing in the prose. 21 "your" (vs the
  period "yr.") are all in registers where standard English is correct — UI
  text, loading/flash messages, away-log narration, the sister's relationship
  label — while the letters and journal keep "yr." The text is carefully
  written; imposing "yr." on the UI/narration registers would be wrong.
- **Renewal path — verified GOOD.** Took the same-Factor second charter from a
  successful close: fresh 1095-day clock, `charterClosed` cleared, ship +
  buildings + money kept, and the "Yr. Charter Renewed" letter **auto-opens** —
  confirming the iter-10 `firstLetterPresented`-keyed fix covers renewal as well
  as succession.

**Loop standing:** 11 genuine improvements shipped; iterations 11-12 are now
mostly verifying systems *good*. The obvious high-value work is done. The one
deep question left that's playtest-answerable (not speculative): does money stay
a meaningful constraint mid/late-game, or does the pepper arbitrage
(buy ~£8 at Kota Pinang, sell ~£25 at Eustace/Marlborough → ~£3k/brigantine-run)
trivialize it? That's the next iteration's focus — observed, not assumed.

### Iteration 11 — 2026-06-12 — risk/reward levers (bottomry, contraband)

**Investigated:** the bottomry loan and the opium-smuggling contract — where
spicy, consequential decisions should live.

- **Bottomry — verified GOOD, no change.** The panel clearly states the bond
  amount, the repayment due (£principal × 1.25), that it falls due on the next
  return to Bayan-Kor, and the calamity-forgiveness condition. (Initially
  mis-read it as an empty paragraph — that was an artifact of my own
  `awk 'length<200'` filter dropping the long content line. **Lesson: filtered
  grep/sed reads hide long lines; re-read before concluding content is missing.**)
- **Opium contract — well-built, one small fix.** The Pale Man's contract is a
  genuine multi-step smuggling risk: lift at the Nest, drop at Eustace under a
  customs check (30% caught, → 5% with a trade pass, trimmed further by Dutch
  standing). The drop panel already shows the catch *likelihood* qualitatively
  ("risk is low" / "a real risk") — but not the *stakes*. → **Fix (verified
  live):** added a stakes line so the downside is visible before the
  irreversible choice: "If they find it: the cargo is forfeit, the contract
  void, and yr. standing with the Hollanders falls hard. There is no second
  telling of it." Informed-consent for the risk; both odds and consequence now
  legible.

**Loop status:** at iteration 11, most systems are verifying *good* — the game
is genuinely well-polished after the spine/reward/pacing/finale/encounter/
succession work. Improvements are now smaller and more occasional (the natural
tail of a productive loop). Remaining speculative items (economic rebalance,
faction-keyed encounters) would need playtest data or risk over-engineering, so
I'm holding off on those without a clear, verifiable win.

### Iteration 10 — 2026-06-12 — succession / second-charter freshness

**Played:** doctored a successful charter-end (brigantine + 4 buildings +
standing + £3000), took up a successor, inspected the second charter.

- **Succession mechanics — verified EXCELLENT, no change.** The "you don't
  lose, you continue" pillar works: the successor (Thomas Reed) inherits the
  brigantine (HOLD 0/180), all buildings (great-godown's 520 cap and all), full
  faction standing, 60% of the money (£1800), wealth-milestone flags, and the
  predecessor as a remembered acquaintance — while the clock, quota, hooks,
  trade books, rivals, and port stocks reset, and foreign ports become
  first-visits again for re-discovery. The successor Director letter is
  well-written, explicitly framing the inheritance and judging the
  predecessor's reputation by their returns. Genuinely strong replayability.
- **The one gap, shipped: the appointment letter didn't auto-present.** The
  *opening* auto-opens its first Director letter (the `firstLetterPresented`
  effect), but that effect had `[]` deps — mount-only — and GameHub never
  unmounts across succession, so the successor's appointment letter (the whole
  payoff of "you continue") sat as an unopened card on the hub. → **Fix
  (verified live):** keyed the effect on `[gs?.firstLetterPresented]` instead of
  `[]`. Succession and renewal both reset that flag to false, so the effect now
  re-fires and routes the player straight to the new appointment letter — the
  inheritance framing presents itself, mirroring the opening. Verified: the
  successor letter now auto-opens ("You inherit the godown…"), and the
  new-game opening still auto-opens too (no regression).

**Where the loop stands:** spine, frequent interactions, finale, and now the
replay path are all polished. The game's full arc — first charter through
succession into a second — presents every major beat properly.

### Iteration 9 — 2026-06-12 — voyage-encounter texture

**Investigated:** the most frequent interaction (25-65 encounters/charter).

**Finding (shipped): the 12 encounters are well-written, but pure-random
selection made them feel more repetitive than the pool size warranted** —
~1-in-12 chance of a jarring back-to-back repeat, and only 12 entries to draw
from over dozens of voyages.

→ **Fix (verified live):**
1. **Anti-repetition.** New `pickFallbackEncounter(gs.recentEncounters)` avoids
   the last 4 encounters (tracked by prose, recorded in sailTo). With a 16-entry
   pool and 4-deep memory, no encounter recurs within four voyages — the felt
   variety is far better than pure random. Verified: consecutive encounters came
   out distinct and the tracking list populated correctly.
2. **Pool 12 → 16.** Added four new encounters in the established voice with
   proper outcomeKeys + hint seeds: a **waterspout** (weather wonder), a
   **derelict with cargo** (salvage/windfall), a **fellow English country master
   hailing news** (social/price intel — plants a thread or gives a windfall
   figure), and a **topman fallen from the yards** (crew injury — care vs. time
   vs. a crew-grudge thread). Verified one (the topman) renders correctly in-game.

**Note:** multi-leg preview automation is unreliable (encounter/digest screens
stall the button loop, occasional 30s eval timeout) — verified via save-state
inspection instead, which is the robust path for voyage-sequence checks.

**Where the loop stands:** the game spine (onboarding → letters → trade →
lodging → wealth → Indiaman → brigantine → finale) and the most frequent
interaction (encounters) are now all polished. Remaining texture candidates:
second-charter/succession freshness; economic decision depth; encounter
*stakes* keyed to faction proximity (the deferred region/faction variation).

### Iteration 8 — 2026-06-12 — the charter-end finale

**Played:** doctored a near-end charter on the knighthood track (Crown 35,
quota 400/200) and triggered the close both mid-voyage and on a homecoming.

**Finding (shipped, HIGH impact): the game's single biggest moment landed as a
silent HUD flip.** The charter-end content is excellent — 7 distinct destiny
letters (knighthood / estate / Resident / Brotherhood / senior-factor / quiet
retirement / recall-disgrace), each a full period letter. But the *presentation*
fizzled: the charter can close mid-voyage at a foreign port, where **no
homecoming digest fires** — so the 3-year culmination (knighthood conferred!)
passed with the HUD silently flipping to "CHARTER CLOSED" and the climactic
letter sitting *unopened* in the inbox. Even on a homecoming, `charter-end`
wasn't in the digest priority list, so the prose fell through to generic
"godown standing, ledger half-kept."

→ **Fix (verified live, both paths):**
1. The charter-close stores the end letter's id on `charterClosed`; a GameHub
   effect auto-routes the player straight to that letter the moment the hub is
   clear (mirrors how the *opening* auto-opens its first Director letter). The
   rich destiny letter IS the ceremony — now it can't be missed. `presented`
   lives inside `charterClosed` so it's naturally per-charter (a successor's
   eventual close presents afresh).
2. Added a momentous `charter-end` away-digest branch ("Three years of heat and
   salt and figures come down to what is written within. You break the wax."),
   first in the priority list — it's the headline of any homecoming.
   Verified: foreign-port close → straight to the knighthood letter; homecoming
   close → momentous digest prose, then the letter auto-opens.

**The "make big moments land" arc is now complete across the whole game:**
onboarding → early letters → trade/lodging → wealth → Indiaman returns →
brigantine → and now the finale. Every major beat speaks in the Factor's voice.

**Next candidates:** with the spine polished, look at texture/variety —
voyage-encounter stakes, or whether a *second* charter (succession) feels
fresh, or economic decision depth.

### Iteration 7 — 2026-06-12 — early-game narrative pacing

**Investigated:** building-completion rewards, then early-game letter cadence.

- **Building completion — verified GOOD, no change.** All 8 buildings deliver
  a named NPC via BUILDING_ARRIVALS on completion (shown in the away digest),
  so each is a specific per-building beat. Won't over-egg with more celebration.
  (The "make big moments land" theme — lodging, wealth, Indiaman, brigantine —
  is now complete; building completion was already handled.)
- **Early-game narrative silence — the gap, shipped.** The inbox is this
  prose-game's narrative engine, but after the opening (Director + Wilbraham at
  day 1) **nothing new arrived until day 35** (first auto-letter), with the
  first scripted letter (teak) at day 60 and the Wilbraham mystery at day 100.
  That's ~34 days — 4-5 trade runs — of an inbox-silent world right when the
  player decides whether this is "a living world of correspondence" or "trading
  alone." → **Fix (verified live):** (1) first auto-letter cadence 35 → **12**
  (lands around the maiden voyage's return; subsequent 30-55d cadence
  unchanged, so no spam — next fired at day 64). (2) Biased the *first* contact
  (day < 25) to the warm faction-null senders (the sister, Capt. Faulke) rather
  than a wary rival sizing you up — verified: first letter is now "Mrs. Eliza
  Wexley, your sister — Concerning Yr. Long Silence", not ter Borch.

**Note:** automating multi-voyage playtests via preview_eval is flaky (encounter
screens interrupt the button-finding); single-step sails with explicit
`.closest('.parchment')` port matching are more reliable. Used for future iters.

### Iteration 6 — 2026-06-12 — the brigantine launch beat

**Investigated:** first-visit foreign-port discovery, then the brigantine launch.

- **Foreign-port discovery — verified GOOD, no change.** First visit gives an
  atmospheric vignette + optional scripted encounter, and — crucially — the
  Chart persistently shows visited ports' full trade info ("NOTED IN YOUR
  LEDGER": what they sell/buy, prices, cheap/dear tags, stock). So discovery
  has lasting planning value. Well-designed; left alone.
- **Brigantine launch — the biggest reward miss, shipped.** Launching the
  brigantine is the single largest upgrade in the game (pinnace 60cwt →
  brigantine 180cwt, 3× hold, +guns) — a transformation of the whole operation.
  But the launch pushed a `shipyard` awayLog event that **wasn't in the digest
  priority list**, so the homecoming prose fell through to generic "the godown
  standing, ledger half-kept." The most exciting moment in the game landed with
  generic prose and one buried ledger line.
  → **Fix (verified live):** (1) added a celebratory `shipyard` digest branch
  ("a trader on his own account, and the difference is the whole of the
  matter") + put `shipyard` in the priority list above indiaman; (2) the launch
  now also drops a journal *milestone* (wax-styled, like the wealth ones:
  "The Astrolabe is launched… Wilbraham never got so far"). Verified live: both
  fire on return. (3) Caught + fixed a factual slip — a digest line said "twice
  the burthen" when it's 3× (60→180); now "thrice."

**Pattern noticed across iters 3–6:** the game's *systems* are well-built, but
its *big moments* (lodging, wealth, the Indiaman's returns, the launch) kept
landing quietly. The through-line of this loop has been giving each major
payoff a felt beat in the Factor's voice. Likely remaining: building-completion
prose (does raising the Great Godown / Counting House feel like progress?), and
charter-end (the finale).

### Iteration 5 — 2026-06-12 — the homecoming digest & the Indiaman win

**Played:** engineered a rich return (building completing + Indiaman calling +
godown stock) and watched the away-digest screen.

- **Away-digest presentation — verified GOOD, no change.** My "wall of text"
  hypothesis was wrong. "UPON YOUR RETURN / Bayan-Kor in Your Absence" + an
  atmospheric prose intro + a clean dated house-ledger (stockade done, Lal the
  watchman arrived, the Indiaman lifted 30 pepper, a Hodge incident) reads as a
  real homecoming beat. Left alone — don't fix what isn't broken.
- **Indiaman reward-framing — the real miss, shipped.** When the Indiaman
  lifts your quota goods toward London, that's the player's *biggest recurring
  win*. But the digest prose pool had three entries — "You missed the Indiaman
  by some days", "figures yet to be reconciled", "returns to dispute" — all
  bureaucratic/near-miss, **picked at random regardless of whether the lift
  succeeded.** A 30-pepper shipment read as drudgery.
  → **Fix (verified live):** tagged the indiaman awayLog event with `lifted`
  (cwt shipped), split the pool into `indiaman_returns` (celebrates progress:
  "So much of the charter is now on the water, beyond recall and beyond
  dispute") and `indiaman_empty` (stings a bare-godown call). `pickAwayDigest
  Fallback` branches on whether any call actually lifted goods. Verified: a
  successful lift now shows the returns pool.

**Noted, not fixed (minor):**
- The "A line of squalls" prose is correct in source; "Aline" in `innerText`
  is a drop-cap float collapsing the space after a single-letter first word.
  The `::first-letter` has 0.1em right padding so it renders with a small gap —
  acceptable; not worth a CSS change touching every drop-cap.
- The private-consignment prompt fires on arrival at a *foreign* port when the
  Indiaman called at home while away — slightly disjointed from the home digest.
  Logic wrinkle; would need understanding the consignment timing before touching.

**Next candidates:** (a) first-visit foreign-port discovery beat; (b) encounter
stakes/variety; (c) whether the player always has a clear near-term anticipation.

### Iteration 4 — 2026-06-12 — milestone recognition (compounding feels good)

**Investigated:** goal-gradient (is the next ambition a visible target?) and
milestone recognition (is crossing a threshold ever marked?).

- **Goal-gradient — already decent, left alone.** The brigantine is well
  surfaced as an ambition: a dashed "A LARGER VESSEL" teaser when you lack the
  Shipwright's Yard (plants the desire + names the prerequisite), then a
  commission panel with cost, then an "ON THE STOCKS" progress bar. Buildings
  show cost in the Outpost tab. A unified "ambitions" list would be more gamey
  than flavorful — not worth it.
- **Milestone recognition — the gap, shipped.** Building completion is marked
  (away digest + named-NPC arrival), but **wealth — the clearest compounding
  metric — was entirely unmarked.** A Factor crossing into real merchant money
  (£1k, £2.5k, £5k, £10k) got nothing.
  → **Fix (verified live):** wealth milestones drop a once-only turning-point
  reflection in the Factor's journal, in his dry voice ("The strongbox passed
  a thousand pounds… I have begun to be a merchant, and not merely a clerk
  with a charter"). Rendered with a wax-red left border + ⁂ glyph so it reads
  as a beat, not a ledger line. Pure logic in `src/util/milestones.js`
  (`pendingWealthMilestones` / `seedWealthFlags`, 9 vitest cases; 156→165).
  Fired by a guarded `gs.money` effect in GameHub (flag = once-only guard).
  ensureShape seeds already-met thresholds silently so existing rich saves
  don't fire a retroactive run. Verified: fires exactly on the 960→1034
  crossing, once, with the wax styling; doesn't re-fire; doesn't fire
  retroactively on load.
- **Also (completing iter-3's pluralization):** the screenshot caught that the
  *journal* still said "Sold 5 barrel" while the toast said "barrels". Applied
  `unitLabel` to all four journal pushes (buy/sell/lodge/draw). Now consistent
  ("Sold 3 barrels of Rum"). Verified live.

**Queued:** "Aline of squalls" typo (one prose string). Next candidates:
(a) first-profitable-voyage or first-building milestones (extend the system if
it feels good in play); (b) the away-digest return — does coming back from a
long voyage to accumulated news feel rewarding or like a wall of text?

### Iteration 3 — 2026-06-12 — the quota-lodging payoff beat

**Tested:** doctored pepper into the hold, lodged it, watched the feedback.

**Finding (shipped, HIGH impact): lodging — the culmination of the whole quota
loop — was the weakest reward moment in the game.** A player sails 6 days,
spends most of their capital, comes home, lodges their first pepper, and gets:
(a) **no confirmation** (buy/sell toast, but lodge was silent), and (b) the
**headline quota number doesn't move** — "LONDON: PEPPER 0/400" stayed 0
because it showed *shipped* only; the lodged 50 sat as "awaiting" buried in
the In-Port row. The single number the player was told to fill ignored their
work until the Indiaman called months later.

→ **Fix (verified live):**
1. **Lodging toast**, quota-framed: *"Lodged 40 cwt of Pepper — 50 of 400
   secured for London."* The payoff lands at the moment the cargo goes in.
2. **HUD quota now counts secured = shipped + lodged**, relabeled "FOR
   LONDON". Lodging 40 jumped the HUD 10→50/400 instantly — the dopamine
   beat. Honest because the Indiaman lift is **uncapped** (it ships the whole
   godown at her next call, verified in tickDays), so lodged pepper is
   genuinely en route. Win condition + Court's reckoning + quarterly-nag math
   still run on *shipped* alone (unchanged); the Ledger/In-Port keep the
   shipped-vs-awaiting split for the detail.
3. `lodgeGoods` now returns the amount moved so the panel can confirm.

**Also (cleared a queued text-polish item):** added `unitLabel(commodity, n)`
— measure-abbrevs (cwt/oz/lb) stay singular, the rest pluralize. Fixed the
buy/sell/lodge toasts ("Sold 5 barrels of Rum", was "5 barrel"). Verified live.

**Still queued:** the "Aline of squalls" missing-space typo (one prose string).
Next iteration candidates: (a) goal-gradient — is the next ambition (brigantine,
buildings) ever surfaced as a *target*? (b) milestone recognition — first
£1000, first building, first quota tenth — does anything mark the moment?

### Iteration 2 — 2026-06-12 — full voyage round-trip → return-leg bug

**Played:** sold starting rum at home (£45), sailed to Kota Pinang, bought
52cwt pepper at £8 (£416), sailed home. Watched the time/cost of the loop.

**Finding (shipped, HIGH impact): return voyages were nearly free.**
`voyageDays(gs, port)` used only the *destination's* `daysFromHome`. Home's is
0 → `|| 1` → **every return to Bayan-Kor cost 1 day** regardless of how far you
sailed out. A Kota Pinang trip was 3 days out, 1 day back — gutting the
time-cost the map advertises ("3 days from Bayan-Kor") and flattening the
risk/reward of far ports (a 7-day Nest run was really only 8 days round-trip,
not 14). → **Fix:** leg cost = `max(origin.daysFromHome, destination.daysFromHome)`,
so the return costs what the outbound did. Verified live: KP round-trip is now
3 days each way (Day 5 → Day 9). This restores a core economic tension — far
ports are now real commitments, making the "where do I sail" decision matter.
Also fixed the "after 1 days" / "N days" pluralization on both arrival lines.

**Bugs spotted, queued for a batched text-polish pass (don't sprinkle commits):**
- Trade toast doesn't pluralize units: "Sold 5 barrel of Rum" → "barrels".
  COMMODITIES units are singular; needs a small `pluralize(unit, n)` helper
  applied at the toast + likely a few other unit render sites.
- "Aline of squalls runs along the horizon" — missing space in a voyage
  encounter prose string (source typo: "A line").

**Still pending (carried from iter 1): the lodging/quota payoff beat** — the
quota loop's reward is deferred + abstract (godown count, Indiaman later).
Worth a focused look: does lodging the first pepper *feel* like progress?


### Iteration 1 — 2026-06-12 — opening playthrough → onboarding intel

**Played:** fresh charter, full 4-beat prologue → Director letter → first port view.

**Finding A (shipped this iter): goal scent is thin in the first 5 minutes.**
A new player at Day 1 sees the quota (400 pepper / 200 cinnamon to London) but
home (Bayan-Kor) sells neither — it sells rice/sandalwood/camphor. To find the
quota path the player must: infer home doesn't sell it → open the map → read
each port blurb → notice "Kota Pinang, a pepper port" → sail 3 days. The
starting cargo (5 rum, 8 rice) has no explained purpose either. The Journal hub
offers no first-action scent; OPEN THREADS shows only the teak side-hook.
→ **Fix shipped:** wove two entries into **Wilbraham's papers** (the dead
predecessor's notebook, already the 2nd letter waiting) — in his dry voice,
conveying (1) the quota loop (pepper/cinnamon come cheap from Kota Pinang →
lodge in the godown → Indiaman lifts to London; "fill it before the ship calls
or she sails light") and (2) the country trade (rum/rice fetch little at home,
carry them where wanted — the Nest pays near double for rum; buy cheap/sell
dear; "let the quota be the floor, not the roof"). Diegetic, flavor-perfect,
rewards reading letters. Intel verified accurate vs. PORTS table. Commit below.

**Economic geography (reference, verified from PORTS):**
- Pepper/cinnamon **sourced** at Kota Pinang (0.7 / 0.85). **Bought** at Eustace
  (1.4 / 1.5) and Fort Marlborough (1.5 / 1.6). Quota path = source → godown →
  Indiaman → London (lodge, don't sell).
- Rum bought best at the Nest (1.7) / Tanjung Cermin (1.9); home buys it 1.4.
- Rice bought at the Nest (1.5) / Tanjung Cermin (1.6); not at home.

**Queued for next iterations (ranked):**
1. **"One more voyage" payoff legibility** (not yet playtested end-to-end) —
   sail Kota Pinang round-trip, feel whether a profitable run lands a *reward
   beat* or just a number change. Likely the next high-value fun lever.
2. **Goal-gradient surfacing** — is the next concrete rung (commission the
   brigantine? build X?) ever shown as a *target*, or only discovered? A
   visible "next ambition" could pull harder than the distant quota.
3. **Milestone recognition** — first lodged quota cwt, first £1000, first
   building — does anything mark the moment? Compounding should *feel* like it.
