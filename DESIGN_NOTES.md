# DESIGN_NOTES.md — The Factor's Charter

A working notebook of design research, ideas surveyed, and decisions made.
This is *not* the same as `WORLD_NOTES.md` (which is Bradley's lore feedstock).
This is for Claude and Bradley together: where we're trying to take the game,
why, what we drew from, and what's deferred.

Newest research / decisions on top.

---

## Deterministic Pool Audit — 2026-05-07

Captured at the moment live-AI was stripped from the PWA player path. Every entry is the static fallback that PWA players will see; live-AI in the artifact runtime is unaffected. Update by playthrough — if a generator's fallback feels repetitive after several charters, lower its felt-quality grade and bump expansion priority. When you expand a pool, update the size and date.

**Inventory date:** 2026-05-07
**Inventoried by:** Phase 1 subagent during the strip-pwa-live-ai PR
**Release blockers found:** None — all 7 generators have functional fallbacks (the spec rule was "throws / returns null / returns broken placeholder"; cosmetic thinness deferred).

### genVoyageEncounter

- **Pool size:** 1
- **Variety axes:** none (single fixed weather-and-course scene; no port / faction / ship-state variation)
- **Felt quality:** M — grammatically sound, period-plausible, but the squalls/wind/bosun image is genre-generic; no hooks, no crew names, no cargo reference
- **Call frequency:** ~25–65 per 3-year charter (60% encounter chance × ~1 voyage per 15 days)
- **Expansion priority:** H
- **Target on expansion:** 12–20 — cover weather / calm / other-vessels / fog / piracy threat as distinct scenario types, each varied by region
- **Release blocker?:** No (object is well-formed; caller at `factors_charter.jsx:5663` spreads it into encounter state without nullguard)

### genOutcome

- **Pool size:** 16 (8 encounter pairs + 8 letter-reply pairs of `{prose, journal}`) — expanded 2026-05-07
- **Variety axes:** `isLetter` selects which pool; random pick within the pool. `changes` shape unchanged.
- **Felt quality:** M — random pick across two branches removes the "same phrase every fallback" tell; tone matches the original anchor line. Cosmetic-thin still vs. live AI, but no longer the visible repetition it was. Re-grade after several charters.
- **Call frequency:** ~50–130 per charter (every encounter × some letter responses) — highest frequency of all generators
- **Expansion priority:** L (was H) — addressed in commit `1395a75`
- **Target on next pass:** if pools start to feel small under 100+ calls per charter, double each pool to 16 entries. Above that, consider keying by `choice.seed` so different choices yield different prose textures.
- **Release blocker?:** No

### genLetter

- **Pool size:** 1
- **Variety axes:** `sender.from` is used verbatim in the fallback subject line (FROM varies), but subject, body, and all 3 response labels are identical regardless of sender faction or mood
- **Felt quality:** L — the generic "A Matter Requiring Your Attention" / "I should wish to lay before you when next our paths cross" body carries no game-state content; sender mood is completely ignored; a player receiving the Brotherhood letter and the Director's letter through the same fallback will see identical text with only the FROM field different
- **Call frequency:** ~8–20 auto-letters per charter (quarterly + faction triggers), plus any manual `genLetter` calls
- **Expansion priority:** H
- **Target on expansion:** 5–8 per sender faction (6 factions × 3 mood states = up to 18 distinct templates)
- **Release blocker?:** No — caller at `factors_charter.jsx:5452` checks `!result.body` before inserting; fallback body is non-empty. Responses array is sanitized at `factors_charter.jsx:5464` with a hardcoded fallback, so even a truncated result won't break the interaction.

### genIndiamanLetterPayload

- **Pool size:** 0 (function returns `null` on failure — no static fallback prose)
- **Variety axes:** n/a
- **Felt quality:** n/a
- **Call frequency:** 4 per charter (quarterly Indiaman visits)
- **Expansion priority:** H (but architecture question noted below)
- **Target on expansion:** n/a — the null-return is intentional design; see release blocker note
- **Release blocker?:** No — when `genIndiamanLetterPayload` returns `null`, the caller (`factors_charter.jsx:5407–5413`) gracefully marks the letter `aiUpgraded: true` without replacing the body. The letter that lands in the inbox already has a fully-formed deterministic body from `makeIndiamanLetter` (`factors_charter.jsx:3149`), which has 3 branches (empty / light / on-track) with authentic period voice and correct numerical reckoning. The null path leaves that deterministic body in place — the player receives a real letter. The null-return pattern is intentional and the design is correct.

### genPursueThread

- **Pool size:** 1
- **Variety axes:** thread text is sliced into the fallback prose (first 120 chars), so the prose echoes the chosen thread — meaningfully better than a completely static fallback
- **Felt quality:** M — fallback reads: "You apply yourself to the matter — [thread] — but the day yields little beyond a confirmation of what was already supposed." Dry, in-period, and the "carry the matter to a confidant" choice is contextually reasonable; the three choices are generic but structurally valid
- **Call frequency:** ~0–30 per charter (player-driven; irregular)
- **Expansion priority:** M
- **Target on expansion:** the thread-echo pattern is already the right approach; real expansion is making the choices thread-aware rather than adding pool size
- **Release blocker?:** No (prose string + 3 choices with label+seed; caller at `factors_charter.jsx:5702` spreads the result into encounter state without nullguard)

### genArrivalVignette

- **Pool size:** 6 (one per port, lookup by port name) — expanded 2026-05-07
- **Variety axes:** keyed by port. Each entry leans on its faction and lore (Rajah's drum at Bayan-Kor, Sultan's harbormaster at Kota Pinang, Dutch corporal at Eustace, no flag at the Pelican's Nest, Portuguese fort at Tanjung Cermin, Union flag at Fort Marlborough). Defensive fallback to the old generic line for any port not in the lookup.
- **Felt quality:** H — once-per-port salience plus port-distinctive sensory detail. Closes the highest-value single fix.
- **Call frequency:** 6 per charter maximum (one per port, first-visit only)
- **Expansion priority:** Done (was H) — addressed in commit `fbcbb52`
- **Target on next pass:** none. If returning visits get their own (different) vignette in the future, that would be a new generator.
- **Release blocker?:** No

### genAwayDigest

- **Pool size:** 1
- **Variety axes:** none — "Returned to find the godown standing and the ledger half-kept. The work of catching up begins tomorrow." fires regardless of what actually happened during the voyage (raid, raid not resolved, goods movements, letter arrivals, etc.)
- **Felt quality:** L — ignores the actual away-log events entirely; the player just saw a detailed log of what happened, then reads completely generic return prose — the disconnect is noticeable
- **Call frequency:** ~3–8 per charter (every return from a long voyage with away-events)
- **Expansion priority:** M (less critical than `genOutcome`/`genLetter` since it fires less often and the event list is still shown on screen)
- **Target on expansion:** 3–5 variants keyed on raid presence, goods changes, letter arrivals; or a template approach that echoes the event summary
- **Release blocker?:** No — `AwayDigestScreen` at `factors_charter.jsx:8619` uses `{digest.prose && (...)}` — if prose is null the block is omitted silently; fallback is non-null so it renders; no crash path

### Concerns flagged in this audit

These are cosmetic-thinness items deferred per the spec rule (only functional gaps were release blockers). They guide the post-ship pool-expansion priority order:

1. ~~**`genOutcome`** — the journal entry `"A day passed without consequence."` is inserted into the permanent in-game journal on every fallback.~~ **Addressed 2026-05-07 in commit `1395a75`** (8-entry random pools per branch).
2. ~~**`genArrivalVignette`** — single string for all 6 ports, fires once each.~~ **Addressed 2026-05-07 in commit `fbcbb52`** (per-port distinctive vignettes).
3. **`genLetter`** — subject + body + response labels identical across all senders and moods. Visible the moment a player gets two fallback letters in a row. **Open — top remaining priority.**
4. **`genAwayDigest`** — ignores the event log just shown to the player. Contextual mismatch is noticeable, especially after a raid. **Open.**

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
3. ~~"Pursue a thread" action~~ (player-driven invocation of accumulated state — shipped)
4. ~~Curated period plates~~ (six 1720s engravings inlined as base64 with ImagePlate matcher)
5. **Cylinder / sealed-letter questlines** — the AI has planted strong "open this!" hooks that have no follow-up
6. **Household crises** — Hodge relapse, Dass recall, Vizier marriage
7. **Generational continuation** — successor charter on charter-end
8. **Crown-gated port** — mirrors the pirate progression; Royal Navy water station unlocks at Crown ≥ +10
9. **New commodities** — camphor (native), tobacco, coffee (Mocha-routed), indigo
10. **Fine-goods cargo class** — pearls, diamonds, bezoars: high-value, near-zero weight, occasional offers
11. **Rivalry mechanics** — periodic news of other Factors' returns
12. **Internal Company faction split** — a second Director voice contesting the official line
13. **Building → person arrives** — Counting House → junior clerk; Barracks → Sepoy corporal; Chapel → catechist
14. **Bottomry loans** — leverage a voyage with consequences if it sinks

Append additions below with a date stamp; I'll triage them in the next
session that touches gameplay.

---

## Session 9 (continued): commodity & port expansion

### What I'd add for variety, in priority

**New commodities** — period and place-appropriate for SE Asia 1720s:

| commodity | period rationale | where it would live |
|---|---|---|
| **Camphor** | native to Borneo / Sumatra; major regional trade staple; valuable | Bayan-Kor or Kota Pinang sells |
| **Tobacco** | Spanish/Portuguese-introduced, traded everywhere by 1720s | Eustace sells; Bayan-Kor buys |
| **Coffee** | Mocha-sourced; hot mid-1720s European market | Eustace sells (Dutch monopoly) |
| **Pearls** | high-value, near-zero weight; Persian Gulf or Malabar | random opportunity at any port; "fine goods" class |
| **Indigo** | Indian dyestuff, traded west | Kota Pinang sells |
| **Bezoar stones** | exotic curio; medical superstition; period | random at Kota Pinang or Tanjung Cermin |

Furs are not period-appropriate for SE Asia (no fur-bearing animals).
The spirit of "what else did Crusoe sell" lands as the **fine-goods
class** — pearls, diamonds, bezoars: low weight, high value, rare.

### Port unlock mechanism survey

Currently only pirate progression unlocks new ports. Gaps:
- **Crown axis:** no port. Should unlock once Crown ≥ +10 OR after Whitcombe's intelligence accepted.
- **Mission axis:** no port. A Catholic / Jesuit-affiliated trading station inland could unlock with Mission ≥ +15.
- **Late-game prestige:** a Chinese port (tea, porcelain) gated on brigantine + a quest. Long voyage.
- **Sub-locations** at existing ports — Kota Pinang's inland teak yard once concession held; Eustace's "back rooms" once trade pass held. Doesn't add new ports but adds depth.
