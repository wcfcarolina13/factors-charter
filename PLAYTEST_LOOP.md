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
