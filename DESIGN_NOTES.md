# DESIGN_NOTES.md — The Factor's Charter

A working notebook of design research, ideas surveyed, and decisions made.
This is *not* the same as `WORLD_NOTES.md` (which is Bradley's lore feedstock).
This is for Claude and Bradley together: where we're trying to take the game,
why, what we drew from, and what's deferred.

Newest research / decisions on top.

---

## Audit triage — 2026-06-09

Three-lane code audit (game logic/gamefeel, mobile UI/UX, offline robustness)
run on re-orientation. Phase 1 (trade toast, days-remaining urgency, legacy
API timeout, cache quota trim) shipped same day — see CHANGELOG. Findings
below are **open**, ordered by judged value-for-effort within each lane.
Several audit claims were checked against code and found stale/wrong; they
are listed at the bottom so they don't get re-reported.

### Gamefeel / game logic (open)

1. ~~**Voyage profit/loss feedback**~~ — shipped 2026-06-09 as "The Trade
   Reckoning": per-commodity aggregates (`gs.tradeStats`, pure logic in
   `src/util/trade-stats.js`) surfaced in the Ledger with avg buy/sell,
   realized margin (duty counted against it), and a net-of-all-dealings
   total. Aggregate-level, not per-voyage/route — if route-level P&L is
   still wanted after play, that's a follow-up needing voyage-boundary
   tracking.
2. ~~**Price opacity**~~ — shipped 2026-06-12. PortView trade rows now carry
   a drift tag against the port's own fair rate ("cheap today" / "dear
   today" on sales; "fetches dear" / "fetches poorly" on purchases; silent
   inside ±6%), and event windows are attributed by name ("⁕ Lowji's calico
   glut moves this price — 30 days more") via new `label` fields on all six
   rivalry priceWindows. Helpers `activeWindowsFor` / `priceDrift` in
   `src/util/price-windows.js`. Bonus: the Counting House's promised
   "modestly improves your prices" is now real — 3% in the Factor's favour
   on both sides, folded into `priceFor` and the fair-rate reference.
3. ~~**Raid agency**~~ — shipped 2026-06-12 (note: the audit overstated
   this — an away-digest raid response choice already existed via
   `handleResolveRaid`). What was missing and now ships: a "THE NIGHT
   WATCH" posture card in OutpostView (which godown goods draw thieves,
   what the standing defenses do, what the next building would add), a
   departure warning on the chart when sailing from Bayan-Kor with a
   stocked, undefended godown, and corrected effect strings — stockade/
   barracks now state the real halving math (the barracks string falsely
   claimed a voyage-piracy effect). `RAID_TEMPTATIONS` + `raidPosture` are
   the single source shared with the tickDays roll. Pre-raid intelligence
   letters remain open as a content item if wanted later.
4. **Fine-goods balance check** (needs playtest data, not code yet) —
   diamonds/ambergris (near-zero weight, £150–200 base) are quota-exempt and
   may dominate late-game income. Gated to the Nest behind pirates rep, so
   maybe fine. Verify in Bradley's next charter before rebalancing.
5. **Charter-end pacing** (M) — no "final stretch" narrative beat. The HUD
   urgency cue (shipped) is cosmetic; a Director "Final Dispatch" letter at
   ~180 days with a quota reckoning would make the deadline diegetic.
6. **`flags.vizierBoonOwed` never pays off** (S) — set by the Vizier
   marriage counter-propose branch, read by nothing. One late-game letter
   helper + one `tickDays` gate closes it.
7. **Hooks staleness** (M) — `gs.hooks` entries persist indefinitely unless
   pursued to closure; no aging or nagging. Candidate: Director mentions
   long-open threads in quarterly letters.
8. **Acquaintances are decorative** (L) — roster surfaces in Ledger but only
   Faulke/Idris gate anything. Cheapest move: feed 1–2 relevant acquaintances
   into `stateContext` so AI prose references them (artifact path), and key
   1–2 scripted arrivals on roster membership.

### Mobile UI/UX (open)

9. ~~**Modal scroll-lock on iOS**~~ — shipped 2026-06-12 via shared
   `useModalChrome` hook (body overflow lock + Escape) applied to all five
   modals.
10. ~~**Escape-to-dismiss consistency**~~ — shipped 2026-06-12 with #9.
    ConflictModal deliberately gets scroll-lock only (forced choice — an
    accidental Escape would leave the saves silently diverged). GalleryModal
    Escape peels the lightbox first, then the modal.
11. ~~**Safe-area insets**~~ — shipped 2026-06-12; Page wrapper pads all
    four `env(safe-area-inset-*)` (resolve to 0 off-notch).
12. ~~**Tab-bar overflow cue**~~ — shipped 2026-06-12; right-edge parchment
    fade while more tabs sit off-screen, clears at scroll end
    (scroll/resize-tracked, not pure CSS — the page background gradient
    made the CSS scroll-shadow trick look like a band).
13. ~~**Trade button spacing**~~ — shipped 2026-06-12; gap 0.3 → 0.5rem.
14. **Unread-letter prominence** (S) — the journal's correspondence card
    distinguishes unread by wording/color only; a wax-red dot or bolder
    treatment would carry further. Tabs already badge a count.
15. **PWA icons** (carried over, needs Bradley's aesthetic input) — see
    HANDOFF deferred #1 and its session-poisoning warning.

### Offline / sync robustness (open)

16. ~~**Self-host the three fonts**~~ — shipped 2026-06-09. Latin woff2
    subsets vendored at `public/fonts/` (5 files, ~238 KB; EB Garamond is
    one variable file covering 400–600), precached by the SW, CSP tightened
    to drop Google Fonts entirely. The legacy artifact runtime keeps the
    Google @import via `window.storage` detection (same idiom as plates.js).
    Unused IM Fell DW Pica dropped from the import.
17. ~~**Sync-pointer seeding on remote pull**~~ — shipped 2026-06-12.
    Verified the failure: `handleResumeRemote` hydrated a new slot with no
    pointer, and `detectConflict` treats missing-pointer-with-remote as
    'conflict', so every relaunch after a cross-device pull fired a
    false-positive conflict modal. Now the pulled cloud metadata seeds
    `factor_save_<slot>_sync` directly (the sync hook is still keyed to the
    old slot at that moment, hence the direct write).
18. ~~**Sync-size pre-warning**~~ — shipped 2026-06-12. `useSyncState`
    tracks `sizeWarning` (payload > 200 KB of the 256 KB cap); SyncBadge
    shows "synced — grows heavy" in amber with a manuscript-export nudge in
    the tooltip.
19. **iOS ITP eviction nudge** (S–M) — localStorage saves can be evicted
    after 7 days of disuse in Safari-installed contexts. The factor-key cloud
    copy is the real mitigation; a title-screen nudge ("your key is your
    save — copy it somewhere") is the cheap insurance.
20. **SW update toast** (M) — `skipWaiting`+`clientsClaim` mean a deploy can
    swap code under a live session; `useRegisterSW`'s needRefresh hook could
    surface a quiet "a new printing is available — refresh" line.
21. **Offline indicator** (S) — no `navigator.onLine` surface anywhere;
    SyncBadge shows 'offline' only after a failed push. A small "ashore,
    no packet-boat" header hint when offline would set expectations for
    illustrations/sync.

### Online-enhancement seam (for the local-LLM plan, backlog)

`callClaude` is already the single chokepoint: every generator routes
through it and falls back deterministically on `{ parsed: null }`. The PWA
path returns the fallback unconditionally. When the desktop offload lands,
the seam is: a `factor_llm_endpoint` (+ model name) in localStorage, a
settings row in the ☰ Menu, and a branch in `callClaude` that POSTs the
prompt to an OpenAI-compatible endpoint with the same 20 s abort + fallback
discipline. No other code needs to know. Do NOT resurrect the removed
`src/llm/` provider framework for this — one branch is enough.

### Audit claims checked and rejected (don't re-report)

- "Quota progress not visible in HUD" — false; the header's third line shows
  GODOWN + LONDON pepper/cinnamon progress.
- "Sync failures are invisible" — overstated; `SyncBadge` in the header
  shows offline/error states (it is subtle, see #21).
- "Dead `gs.syncEnabled`/`syncPromptShown` fields need cleanup" (HANDOFF
  deferred #7) — already done in a prior session.
- "Gallery should store image bytes in localStorage" — rejected; 60 × ~650 KB
  JPEGs cannot fit localStorage quota. URL-keyed re-fetch through the
  three-layer server cache is the right design; offline gallery gaps are
  acceptable degradation.
- "Buy/sell silently no-op on failure" — mostly pre-gated; buttons disable
  when the trade can't happen. The real gap was missing success feedback
  (fixed today).

---

## Deterministic Pool Audit — 2026-05-07

Captured at the moment live-AI was stripped from the PWA player path. Every entry is the static fallback that PWA players will see; live-AI in the artifact runtime is unaffected. Update by playthrough — if a generator's fallback feels repetitive after several charters, lower its felt-quality grade and bump expansion priority. When you expand a pool, update the size and date.

**Inventory date:** 2026-05-07
**Inventoried by:** Phase 1 subagent during the strip-pwa-live-ai PR
**Release blockers found:** None — all 7 generators have functional fallbacks (the spec rule was "throws / returns null / returns broken placeholder"; cosmetic thinness deferred).

### genVoyageEncounter

- **Pool size:** 12 — expanded 2026-05-07 in commit `e74efb7`
- **Variety axes:** random pick across weather (squall, calm, fog), navigation (reef, shoaling), other vessels (distant sail, junk, pirate sloop), maintenance (pump leak), wildlife (whale), atmospheric (lights ashore, castaway timber), crew (sick boy in dead air). Anonymous crew throughout; no port/faction-keyed variation yet.
- **Felt quality:** M-H — distinct scenes with concrete sensory detail; original squall kept as the anchor entry. Re-grade after 2-3 charters.
- **Call frequency:** ~25–65 per 3-year charter
- **Expansion priority:** L (was H) — addressed in `e74efb7`
- **Target on next pass:** if still feels repetitive after several charters, key by region (Strait of Malacca / Bay of Bengal / open Indies water) — 12 entries × 3 regions = 36. Or layer faction variations atop existing scenes ("a low sloop" → "a Brotherhood sloop / a VOC patrol / a Crown frigate" depending on rep with each).
- **Release blocker?:** No

### genOutcome

- **Pool size:** 16 (8 encounter pairs + 8 letter-reply pairs of `{prose, journal}`) — expanded 2026-05-07
- **Variety axes:** `isLetter` selects which pool; random pick within the pool. `changes` shape unchanged.
- **Felt quality:** M — random pick across two branches removes the "same phrase every fallback" tell; tone matches the original anchor line. Cosmetic-thin still vs. live AI, but no longer the visible repetition it was. Re-grade after several charters.
- **Call frequency:** ~50–130 per charter (every encounter × some letter responses) — highest frequency of all generators
- **Expansion priority:** L (was H) — addressed in commit `1395a75`
- **Target on next pass:** if pools start to feel small under 100+ calls per charter, double each pool to 16 entries. Above that, consider keying by `choice.seed` so different choices yield different prose textures.
- **Release blocker?:** No

### genLetter

- **Pool size:** 18 (3 templates per sender × 6 senders) — expanded 2026-05-07 in commit `fb779ef`
- **Variety axes:** keyed by `sender.key`. Each sender has 3 distinct `{subject, body, responses[3]}` templates mirroring that sender's stated mood description in `AUTO_SENDERS`. Random pick within sender. The generic legacy fallback is preserved as a defensive default for senders without a pool entry.
- **Felt quality:** H — each template captures the sender's specific voice (Wexley familial / Faulke mariner-Brotherhood / Pyke pious-pastoral / Anonymous Hand quiet-pirates / ter Borch Calvinist-trader / Dryden private-Director). Response choices plant rep changes and narrative hooks consistent with the existing scripted-letter design pattern.
- **Call frequency:** ~8–20 auto-letters per charter
- **Expansion priority:** Done (was H) — addressed in `fb779ef`
- **Target on next pass:** if specific senders feel repetitive after several charters, double their individual pool to 6 entries; or layer a "first-time vs returning" axis (the first ter Borch letter could differ from his fifth). Not warranted yet.
- **Release blocker?:** No

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

- **Pool size:** 18 across 7 branches (raid: 3, incident: 3, indiaman: 3, construction: 2, harvest: 2, letter: 2, default: 3) — expanded 2026-05-07 in commit `4db5b84`
- **Variety axes:** event-aware. `pickAwayDigestFallback` inspects `awayEvents` and routes to the matching pool by priority (raid > incident > indiaman > construction > harvest > letter > default). Within branch, random pick.
- **Felt quality:** H — the contextual mismatch (generic prose firing after a raid) is closed. Each branch reads as a plausible journal entry for the kind of week the events describe.
- **Call frequency:** ~3–8 per charter (every return from a long voyage)
- **Expansion priority:** L (was M) — addressed in `4db5b84`
- **Target on next pass:** if a charter triggers many returns of the same branch (e.g. multiple raids), the within-branch pool may feel small; double the raid pool to 6 entries if so.
- **Release blocker?:** No

### Concerns flagged in this audit

These are cosmetic-thinness items deferred per the spec rule (only functional gaps were release blockers). They guide the post-ship pool-expansion priority order:

1. ~~**`genOutcome`** — the journal entry `"A day passed without consequence."` is inserted into the permanent in-game journal on every fallback.~~ **Addressed 2026-05-07 in commit `1395a75`** (8-entry random pools per branch).
2. ~~**`genArrivalVignette`** — single string for all 6 ports, fires once each.~~ **Addressed 2026-05-07 in commit `fbcbb52`** (per-port distinctive vignettes).
3. ~~**`genLetter`** — subject + body + response labels identical across all senders and moods.~~ **Addressed 2026-05-07 in commit `fb779ef`** (per-sender pools: 18 templates across 6 senders, mirroring each sender's stated mood description).
4. ~~**`genAwayDigest`** — ignores the event log just shown to the player.~~ **Addressed 2026-05-07 in commit `4db5b84`** (event-aware branched pools).
5. ~~**`genVoyageEncounter`** — single squall scene every voyage.~~ **Addressed 2026-05-07 in commit `e74efb7`** (12-entry random pool).

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

#### 3. Household crises — SHIPPED
- Once per charter, each of Hodge / Dass / the Vizier hits a personal crisis
  that demands a choice. Triggers in `tickDays` (`makeHodgeCrisisLetter` at
  1625, `makeDassRecallLetter` at 1704, `makeVizierMarriageLetter` at 1770).
- Hodge's relapse — 4 branches: reformed (£40 to the Reverend) / sent home
  (Mr. Tyler replaces him) / junior hired (Mr. Coombe joins) / accepted.
- Dass's recall — 3 branches: retained (£50 to Madras) / released (Lance
  Naik Anandan replaces him) / commissioned into the Rajah's service.
- Vizier's marriage gambit — 3 branches: stand for the family / decline /
  counter-propose for an open boon (`vizierBoonOwed`).
- Resolution flags read at HUD (8540), charter-end branching, and
  `makeSuccessorState`. Each branch's `newAcquaintances` lands a named NPC
  in the household roster.
- Solved "the household is just stat ticks."

#### 4. Generational continuation — SHIPPED
- When the charter ends, the title screen offers "Take up the Charter — yr.
  successor." `makeSuccessorState` (2941) carries forward standing, godown,
  brigantine, outpost, while resetting per-Factor state. `makeRenewedState`
  (3061) handles success-path renewal.
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

**Shipped via the household crises.** Each crisis returns a real staff
choice: Hodge can be reformed / sent home (Mr. Tyler) / paired with a junior
clerk (Mr. Coombe) / accepted as-is. Dass can be retained (£50) / released
(Lance Naik Anandan) / commissioned into the Rajah's service. The Vizier's
marriage gambit returns a held-open boon when counter-proposed. New named
NPCs land via `newAcquaintances` on resolution; the household HUD reads the
flags directly. Building completions deliver further named NPCs via
`BUILDING_ARRIVALS`.

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

**Reconciled 2026-05-08** — most items below shipped during Sessions 9–10
without a synchronous backlog update. Strikethroughs reflect what's
verifiably in `factors_charter.jsx`. Open items follow.

1. ~~Private trade allowance~~ (Session 9)
2. ~~Brotherhood operative questline~~ (Session 9 — Faulke 3-step chain)
3. ~~"Pursue a thread" action~~ (Session 9 — player-driven invocation of accumulated state)
4. ~~Curated period plates~~ (Session 9 — six 1720s engravings inlined as base64 with ImagePlate matcher)
5. ~~Cylinder / sealed-letter questlines~~ (Cylinder steps 1–2 at 1972/2027, Pale Man 1–2 at 2187/2244, Wilbraham 1–3 at 2350/2402/2532)
6. ~~Household crises~~ (Hodge / Dass / Vizier — see "Four candidate moves" #3 above)
7. ~~Generational continuation~~ (`makeSuccessorState` 2941, `makeRenewedState` 3061; charter-end Director letter)
8. ~~Crown-gated port~~ (Fort Marlborough / Bencoolen in `PORTS`)
9. ~~New commodities~~ (camphor, tobacco, pearls, diamonds, teak, indigo, ambergris, gambier — `COMMODITIES` is 16-strong)
10. ~~Fine-goods cargo class~~ (pearls / diamonds / ambergris — high value, near-zero weight)
11. ~~**Rivalry mechanics**~~ — shipped 2026-05-08 (rivalry v1: 3 rivals, baselines, 18 events, 4 levers) and 2026-05-09 (sabotage arcs: 5th lever, 3 two-step letter chains routed through the rivals' intel channels, deterministic resolution). The full surface is now in code; further additions (cross-rival events, re-triggerable sabotage, charter-end flavour wired off `gs.sabotagesCommitted`) are tracked in HANDOFF.md.
12. ~~Internal Company faction split~~ (Dryden's Speculative Bench → Lord Mountfair; `companyFaction` flag drives variant Director correspondence)
13. ~~Building → person arrives~~ (`BUILDING_ARRIVALS` at 498 — watchman, junior clerk, catechist, plantation overseer, sepoy corporal, shipwright, godown-keeper, master gunner)
14. ~~Bottomry loans~~ (`gs.bottomry` field at 960 — period-accurate leverage with sink-risk)

### Genuinely open

- ~~**#11 rivalry mechanics**~~ — closed 2026-05-09 with sabotage arcs (the
  v1 deferred 5th lever).
- Items collected since — append below.

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
