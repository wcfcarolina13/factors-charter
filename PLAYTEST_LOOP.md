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
