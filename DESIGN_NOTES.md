# DESIGN_NOTES.md — The Factor's Charter

A working notebook of design research, ideas surveyed, and decisions made.
This is *not* the same as `WORLD_NOTES.md` (which is Bradley's lore feedstock).
This is for Claude and Bradley together: where we're trying to take the game,
why, what we drew from, and what's deferred.

Newest research / decisions on top.

---

## Session 9 (post-merge): the day-100 slog problem

### Bradley's complaint
> "By day 100 unless you had great luck and made only perfect decisions, the
> game can feel like a slog with inevitable ruin ahead."

### Diagnosis
Not a missing-mechanic problem. A **rhythm and agency** problem. The loops
by day 100 are: voyage → trade → lodge → wait. The Indiaman call is the
only mid-game punctuation, and the player has limited levers between calls.
Adding more of the same won't fix it. What's needed:
- A *parallel* income stream (not just more of the same trade).
- *Multi-step* plots so the inbox feels like an evolving world, not a series
  of one-off scripted letters.
- *Inflection events* that demand decisions about the household / staff.
- A way for the *charter ending* to not feel like a brick wall.

### Sources scoured

#### Morrowind — East Empire Company / Raven Rock (Bloodmoon)
- **Internal company faction war.** Carnius Magius and Falco Galenus run
  rival visions of the colony. The player advances both until forced to side
  with one. → Lesson: the "Honourable Company" itself can have factions; the
  Director's letters could come to feel like one voice in a chorus.
- **Colony grows by quest, not by stat.** Building the mine, the smithy, the
  council hall each fires a multi-step quest with named NPCs arriving.
  → Lesson: every building completion should mean a *person arrives*, not
  just a stat bump.
- **Disputes mediate themselves into your inbox.** Settlers feud, you
  arbitrate, that's a quest. → Lesson: scale of the colony should generate
  friction.
- **A betrayal questline at the spine.** You accumulate small evidence over
  weeks until a confrontation. → Lesson: multi-step plots > single-letter
  hooks.

#### Tamriel Rebuilt
- **House Hlaalu's "small problems"** run to 8–12 quests of mid-tier weight,
  none essential, all optional, all paying out reputation + a small reward.
  → Lesson: the player needs a steady supply of *medium-stakes* matters that
  aren't the main quota or a one-off scripted hook.
- **Smuggling and gray trade are first-class income.** Moon-sugar, skooma,
  contraband. → Lesson: contraband isn't just flavour; it's a real economic
  alternative.
- **Patrons.** A noble takes interest in you, gives you missions, expects
  loyalty. → Lesson: the Vizier could become a recurring patron with multiple
  jobs, not just one teak letter.

#### Robinson Crusoe — how he actually made money
- The fortune from his **Brazilian sugar plantation** (off-stage) is the
  seed capital that makes his island survival civilised. → Lesson: an
  offstage estate / investment back home, periodically remitting funds.
- **Salvage from the wreck.** → Lesson: derelict ship encounters with
  salvageable cargo.
- **Goats, milk, leather, canoes, pottery** — local manufacture. → Lesson:
  the Factor's outpost could *produce* trade goods, not just rely on imports.

#### Period mercantile reality (Defoe, Dampier, the country traders)
- **Private cargo allowance.** Every Company servant got ~3–5 tons of free
  private trade per Indiaman voyage for their own account. **This is how
  Factors actually got rich.** Parallel to the quota and entirely missing
  from our game.
- **Diamonds, fine silk, lacquerware** — high-value, low-volume cargo classes
  that don't compete for hold space.
- **Bottomry loans.** Take a loan against a ship/cargo; if the ship sinks,
  the loan is forgiven. Leverage on a voyage.
- **Country trade.** Intra-Asian shipping (Indian cottons → Java for spices)
  was the *real* fortune-making. Already nominally in the game but
  underweight.

#### RTS / strategy of the vein
- **Patrician III / Rise of Venice** — **dynasties.** Your character ages out;
  your heir takes over; the world state persists. Solves "inevitable ruin"
  by making it survivable narratively.
- **Anno** — **production chains.** Goods aren't just bought; they're made
  from raw materials. Probably too heavy for our weight class but the
  principle (the godown isn't just a buffer; it's an input) is useful.
- **Crusader Kings 3** — **household as agents.** Hodge, Dass, the Vizier
  should have their own crises that fire on a schedule, not just stat ticks.
- **Port Royale 4** — **rivalries.** Other Factors at competing posts;
  periodic news of their tonnage. Competition pressure on top of quota.
- **Sunless Sea** (already cited) — *ambient threats and patrons*. Existing
  inspiration; reinforces the multi-step plot pattern.

### Four candidate moves (ordered by leverage)

#### 1. Private trade allowance — SHIPPING NOW
- Each Indiaman call also offers to ship up to N cwt of *any* commodity for
  the Factor's private account.
- Returns money 6 months later (next Indiaman) at a London markup.
- Period-accurate. Mechanically clean. Completely parallel to the quota
  loop. **This alone changes the income shape and gives a reason to push
  hold capacity beyond what the quota requires.**
- Highest leverage / smallest scope. Maybe a week of work.

#### 2. Multi-step questlines (Morrowind / TR pattern) — FIRST QUESTLINE SHIPPING NOW
- Promote the strongest open hooks (Carel / Brotherhood operative; the
  cylinder; Wilbraham's death; Pyke's suspicions about Hodge) into 3–4-step
  plots.
- Step one is a letter. Step two fires conditional on the first response and
  N days later. Step three is a port encounter or a final letter. Step four
  resolves with a real consequence — money, a faction shift, a permanent flag.
- The "Pursue a thread" action becomes the entry point for the player to
  advance these explicitly.
- **First questline shipped this session: Faulke + Brotherhood operative.**
  Three steps. Step 1 — Faulke proposes investigation. Step 2 — Faulke
  returns with the cove's location. Step 3 — Crown route or Brotherhood route,
  each with real consequence.

#### 3. Household crises — DEFERRED
- Once per ~120 days, one of Hodge / Dass / the Vizier hits a personal
  crisis that demands a choice.
- Hodge's relapse turning ruinous. Dass receiving a recall to Madras. The
  Vizier proposing his clerk's marriage.
- Each is a one-off scripted letter, deterministic outcomes, real stakes.
- Solves "the household is just stat ticks."

#### 4. Generational continuation — DEFERRED
- When the charter ends, the title screen offers "Take up the Charter — yr.
  successor."
- Same world state, fresh Factor name, new 3-year clock, the godown /
  brigantine / outpost / standing-with-factions all persist.
- Patrician's lesson: you don't lose; you continue.

---

## Open question: replacing / improving / adding staff

> Bradley asked: "Is there ever at any point a mechanic for replacing,
> improving, or adding assistance? such as the drunkard."

**No, not currently.** Hodge's sobriety/loyalty ticks affect tickDays
(construction speed, occasional incidents) but the player has zero levers
to act on it. Same for Dass. The crew is fixed at game start.

**Where this should land:** in the **household crises** track (#3 above).
Each crisis offers concrete choices that change staffing:
- Hodge: a serious relapse; player can dry him out (£X, time), send him
  home (he's gone, hire a sober but mediocre replacement), or accept it
  (drinking-Hodge stays as is — known quantity).
- Dass: Madras recall; player can pay the bribe (£X, he stays), let him go
  (a green sepoy replaces him), or *promote* him to a paid position
  (requires standing).
- Vizier: indirect — the marriage gambit threads back to the player as an
  obligation later.

**Hiring beyond the original three** could happen as part of the
*Raven-Rock-style colony quest tree*: when you build the Counting House,
a junior clerk arrives (Hodge's apprentice). When you build the Barracks,
a Sepoy corporal arrives (under Dass). Each named NPC.

**For now this is documented but not built.** Higher priority right now is
making the existing playthrough rhythm work via private trade and quest
chains. Staff levers come in the Session 10 batch.

---

## Anti-patterns we have ruled out

- **Production chains as the central economy.** Anno-style. Too heavy for
  the weight class; would crowd out the prose-and-decisions feel.
- **Real-time anything.** All time advances by player action.
- **Achievement / score mechanics.** Doesn't fit the journal voice.
- **Direct combat resolution at sea.** Combat happens *in prose* (AI
  encounters), with hull/sails as the only stat. Adding a tactical layer
  would change the genre.
- **More ports just for the sake of more ports.** Each port should have
  its own mechanical reason to exist.

---

## Backlog (ordered, roughly)

1. ~~Private trade allowance~~ (this session)
2. ~~Brotherhood operative questline~~ (this session)
3. **Cylinder / sealed-letter questlines** — the AI has plant strong "open this!" hooks that have no follow-up
4. **Household crises** — Hodge relapse, Dass recall, Vizier marriage
5. **Generational continuation** — successor charter on charter-end
6. **Rivalry mechanics** — periodic news of other Factors' returns
7. **Diamond / fine-goods cargo class** — high-value, low-weight specials
8. **Internal Company faction split** — a second Director voice contesting
   the official line; player accumulates standing with each
9. **Building → person arrives** — Counting House → junior clerk;
   Barracks → Sepoy corporal; Chapel → catechist
10. **Bottomry loans** — leverage a voyage with consequences if it sinks

Append additions below with a date stamp; I'll triage them in the next
session that touches gameplay.
