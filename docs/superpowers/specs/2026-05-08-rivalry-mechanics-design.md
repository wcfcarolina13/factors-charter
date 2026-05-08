# Rivalry Mechanics — Design

**Date:** 2026-05-08
**Status:** Design approved, ready for implementation plan
**Backlog item:** DESIGN_NOTES.md backlog #11 — the only design-shape gameplay item left after the 2026-05-08 reconciliation

---

## Problem

The game ships a minimal rivalry surface today: one named rival (`HARDACRE` at Bencoolen) whose deterministic tonnage is referenced inline in the Court's quarterly nag letters via `rivalLine(s)`, plus a cosmetic `rivalRisk: true` badge on Eustace's MapView card. That's it. The player feels Court pressure from their own quota, but no real *competitive* pressure — the world doesn't have other Factors with their own trajectories, fortunes, and reversals.

The DESIGN_NOTES backlog framed this as "periodic news of other Factors' returns" on the Port Royale 4 model. The goal is not a competitive league sim but a felt *news rhythm*: rivals exist, their fortunes turn, and their turns affect the player materially — through Court pressure, port commodity prices, household poaching opportunities, and intelligence the player can buy into.

This spec describes a **mechanically-interactive** rivalry subsystem at the "v1-rich" level: Read + Trade arbitrage + Staff poaching + Intel buy. Sponsoring rival downfalls (sabotage) is deliberately out of scope, deferred to a future Session.

## Decisions Anchored (during brainstorm)

### Engagement level

| Decision | Choice |
|---|---|
| Rivals are atmospheric vs. interactive | **Mechanically interactive** — rivals' fortunes affect player Court pressure, port prices, household opportunities; player can buy intelligence to front-run events |
| Sabotage in v1 | **No** — deferred. Adds large political surface; v1 stays inside reactive levers. |

### Cast

| Decision | Choice |
|---|---|
| Cast size | **Three rivals** across three faction lanes |
| Hardacre | **Existing.** EIC factor at Bencoolen / Fort Marlborough. Voice: steady plodder, slightly insecure. Already in code. |
| Dutch rival | **Promote ter Borch.** Existing AUTO_SENDERS entry. Senior VOC factor at Eustace; Boom serves under him as junior. Boom's trade pass is implicitly a junior end-run. |
| Country trader | **New: Mr. Lowji Nusserwanji at Bombay.** Parsi shipowner. Period-accurate (Wadia shipbuilding dynasty was real). Distinctive voice: formal mercantile English with Zoroastrian-cultural touches. Bombay is a new offstage place. |

### Arc structure

| Decision | Choice |
|---|---|
| Arc shape | **News rhythm — trajectory + punctuating events.** No multi-step plots per rival. The questline pattern (Cylinder, Faulke, Pale Man, Wilbraham, Dryden) is already saturated. Rivalry should feel *different* from the inbox's existing shape. |
| Cadence | **Medium — 6–8 events per charter total** (~2–3 per rival), avg ~150-day spacing, with 60-day random offset. |
| Plus baseline | The existing `rivalLine` extends to all 3 rivals, in every quarterly nag (4×/charter). |

### Levers

| Lever | In v1 | Mechanism summary |
|---|---|---|
| Read (Court pressure) | Yes | Numeric `rivalPressure` 0–100 shifts nag-letter tone band ±1 step |
| Trade arbitrage | Yes | Events carry an optional `priceWindow`; pushed into `gs.priceWindows`; consulted by port econ helpers |
| Staff poaching | Yes | Some events offer `newAcquaintances` choice (hire defected rival staff for £X + monthly wage) |
| Intel buy | Yes | Three channels (Brotherhood / Vizier / Cama) preview the next event in a rival's queue, plant a flag the next event reads to swap in "anticipated" prose |
| Sabotage | **No (deferred)** | — |

### Intel channels (one per rival)

| Channel | Rival | Cost | Cadence | Plumbing |
|---|---|---|---|---|
| Brotherhood (Anonymous Hand) | Hardacre | £40–80 | 2/charter, gated `pirates ≥ +5`, 60-day spacing | Extends existing AUTO_SENDERS entry |
| The Vizier | ter Borch | Unspoken favour (plants `vizierBoonOwed` if not already set) | 1–2/charter, gated `visited Eustace ≥ 2` | New scripted letter, mirrors `makeBrotherhoodLetter` |
| Mr. Cama (Bombay) | Lowji | Cash | 2–3/charter, gated `day ≥ 60` | New AUTO_SENDERS entry — cast 6 → 7 |

## Scope

### In scope

- New `gs.rivals` shape (3 named rivals with state, standing 0–100, eventsFired, lastEventDay) added through `ensureShape`
- New `gs.priceWindows: []` array for arbitrage windows; auto-cleanup in `tickDays`
- New `gs.rivalPressure: number` recomputed each tick
- New `RIVALS` top-level registry constant — per-rival baseline trajectory function + intel-channel binding
- New `RIVAL_EVENTS` top-level registry — pool of event templates per rival; **target ~6 templates per rival, 18 total** for v1 (see §9 Risks for scope-down option)
- Extension of `rivalLine(s)` → `rivalsLines(s)` returning a multi-rival snippet for quarterly nags
- New `computeRivalPressure(s)` helper
- Extension of `makeQuarterlyNagLetter` tone-band selection to consume `rivalPressure`
- New `pickRivalEvent(s)` helper — eligibility filtering, weighted-random rival selection, no-repeats, graceful exhaustion
- New `tickDays` block: rival-event scheduler + `priceWindows` cleanup + `rivalPressure` recompute
- New scripted-letter helper `makeVizierIntelLetter(s)` (Vizier intel channel)
- New AUTO_SENDERS entry for Mr. Cama (Bombay correspondent)
- Extension of pirates AUTO_SENDERS entry's letter pool to include 2 Hardacre-intel offerings
- Port econ helpers (`portStocks` lookup, sell/buy multipliers) updated to consult `gs.priceWindows`
- Migration: `ensureShape` populates `gs.rivals`, `gs.priceWindows`, `gs.rivalPressure` for existing saves
- Tests: pool eligibility, `computeRivalPressure` edge cases, pool-size sufficiency over 1080-day sim, `priceWindow` apply+expire, intel-buy flag → next-event "anticipated" branch

### Out of scope

- **Sabotage / sponsored downfall.** Deferred. Brotherhood-bribe / Court-tip / customs-tip surfaces would double the political-consequence code and risk slipping into a full questline.
- **Per-rival multi-step questlines.** Explicitly rejected during brainstorm. If a Hardacre downfall arc is wanted later, it lands as a *new* questline alongside Cylinder/Pale Man/Wilbraham, not within rivalry.
- **A "Rivals" UI tab.** Rivalry surfaces only through the inbox and the Court's letters. No Standings panel; no Comparative Returns view. Stays consistent with the rest of the game's prose-only rhythm.
- **Mechanical rivalry between the 3 rivals themselves.** Each rival's trajectory is independent. No cross-rival events ("Hardacre and ter Borch fight over a cargo"). Possible future expansion.

## Architecture

### Data model

**`gs.rivals` shape** (added by `ensureShape`):

```js
gs.rivals = {
  hardacre: {
    name: 'Mr. Hardacre',
    station: 'Bencoolen',
    faction: 'company',
    pepper: 0,                  // tonnage shipped (deterministic baseline + event modifiers)
    cinnamon: 0,
    standing: 50,               // 0-100; events shift it
    state: 'steady',            // 'rising' | 'steady' | 'troubled' | 'broken'
    eventsFired: [],            // event template keys; prevents repeats
    lastEventDay: 0,
  },
  terborch: {
    name: 'Mynheer ter Borch',
    station: 'Port St. Eustace',
    faction: 'dutch',
    standing: 50,
    state: 'steady',
    eventsFired: [],
    lastEventDay: 0,
  },
  lowji: {
    name: 'Mr. Lowji Nusserwanji',
    station: 'Bombay',
    faction: null,              // country trader, off Company books
    standing: 50,
    state: 'steady',
    eventsFired: [],
    lastEventDay: 0,
  },
};
```

Hardacre's `pepper`/`cinnamon` track tonnage explicitly because the existing `rivalLine` compares against the player's quota directly. Ter Borch and Lowji use only `standing` since neither competes for EIC quota; their numbers shape *their* trajectories, not the player's quota tone.

`gs.priceWindows: []` — array of `{ port, commodity, sellMult?, buyMult?, expiresDay }`. Multiple windows can stack (multiplicative).

`gs.rivalPressure: number` — 0–100, recomputed each `tickDays` call.

`gs.rivalPressureModifiers: []` — array of `{ delta, fromDay, lifetimeDays }` populated when an event fires; consumed by `computeRivalPressure` with linear decay; auto-pruned when expired.

### `RIVALS` registry

```js
const RIVALS = [
  { key: 'hardacre', baselineFn: hardacreBaseline,    intelChannel: 'brotherhood' },
  { key: 'terborch', baselineFn: terBorchBaseline,    intelChannel: 'vizier' },
  { key: 'lowji',    baselineFn: lowjiBaseline,       intelChannel: 'cama' },
];
```

Baseline functions advance each rival's deterministic state on Indiaman calls. Hardacre's existing `hardacreReckoning(visits)` becomes `hardacreBaseline(s)` and writes back to `s.rivals.hardacre.pepper/cinnamon`. Ter Borch and Lowji similarly tick `standing` toward their archetype's natural slope.

### `RIVAL_EVENTS` registry

Per-rival pool of event templates. Each template:

```js
{
  key: 'hardacre-fire',                            // unique
  rival: 'hardacre',
  minDay: 180, maxDay: 720,
  preconditions: (s) => !s.rivals.hardacre.eventsFired.includes('hardacre-fire'),
  build: (s, opts) => ({                           // returns letter object
    id: ..., from: '...', subject: '...',
    body: opts.anticipated ? '...' : '...',        // intel-buy plant swaps body
    responses: [
      { label: 'Take advantage; reroute the Albatross to Bencoolen',
        seed: '...',
        fixedOutcome: { ..., changes: { ... } } },
      { label: 'Note it; press on',
        seed: '...',
        fixedOutcome: { ..., changes: { ... } } },
    ],
  }),
  standingAfter: 'troubled',                       // optional state transition
  standingDelta: -20,                              // optional standing shift
  priceWindow: { port: 'Bencoolen', commodity: 'pepper',
                 sellMult: 1.3, buyMult: 0.8, days: 60 },
  pressureDelta: -10,                              // optional rivalPressure modifier
  pressureLifetime: 60,                            // days the modifier decays over
}

**Defaults if pressure fields omitted:** setback events default `pressureDelta: -8, pressureLifetime: 60`; windfall events default `+8, 60`. Templates can override.
```

**Pool size for v1: 6 templates per rival × 3 rivals = 18 templates.** See §9 for the 12-template scope-down fallback.

### Cadence — `tickDays` integration

New block (after existing one-off scripted-letter triggers):

```js
// Initialize first-event day with a 0–60-day jitter on first tick
if (!s.flags?.firstRivalEventDay && !s.charterClosed) {
  s.flags = { ...(s.flags || {}), firstRivalEventDay: 60 + Math.floor(Math.random() * 60) };
}

if (s.day >= (s.flags?.nextRivalEventDay ?? s.flags.firstRivalEventDay)
    && !s.charterClosed) {
  const event = pickRivalEvent(s);
  if (event) {
    const letter = event.build(s, { anticipated: !!s.flags?.[`${event.rival}IntelPlant`] });
    insertLetter(s, letter);
    s.rivals[event.rival].eventsFired.push(event.key);
    if (event.standingAfter) s.rivals[event.rival].state = event.standingAfter;
    if (event.standingDelta) s.rivals[event.rival].standing =
      Math.max(0, Math.min(100, s.rivals[event.rival].standing + event.standingDelta));
    s.rivals[event.rival].lastEventDay = s.day;
    if (event.priceWindow) {
      s.priceWindows = [...(s.priceWindows || []), {
        ...event.priceWindow, expiresDay: s.day + event.priceWindow.days,
      }];
    }
    if (s.flags?.[`${event.rival}IntelPlant`]) {
      const flagsNext = { ...(s.flags || {}) };
      delete flagsNext[`${event.rival}IntelPlant`];
      s.flags = flagsNext;
    }
  }
  s.flags = {
    ...(s.flags || {}),
    nextRivalEventDay: s.day + 90 + Math.floor(Math.random() * 60),
  };
}

// Cleanup expired priceWindows
s.priceWindows = (s.priceWindows || []).filter(w => w.expiresDay > s.day);

// Recompute rivalPressure
s.rivalPressure = computeRivalPressure(s);
```

`pickRivalEvent(s)` selection logic:
1. Filter `RIVAL_EVENTS` by `minDay ≤ s.day ≤ maxDay`, `preconditions(s) === true`, and event not already in `s.rivals[rival].eventsFired`
2. Apply 240-day clustering cap: if 3+ rival events have fired in the last 240 days, return null
3. Weighted-random by rival, where weight = `(s.day - s.rivals[rival].lastEventDay)` so each rival fires roughly equally
4. From the chosen rival's eligible pool, random pick

If all pools exhausted: return null; the next 90+60-day window gets re-rolled. No error.

### `computeRivalPressure(s)` formula sketch

```
pressure = 50 (baseline)
  + 10 × (Hardacre's pepper progress relative to player's pepper quota %)
  + 10 × (Hardacre's cinnamon progress relative to player's cinnamon quota %)
  +  5 × (terborch.standing - 50) / 50
  +  5 × (lowji.standing    - 50) / 50
  + Σ recent-event modifiers (decaying linearly over 60 days from event firing)
clamped to [0, 100]
```

Recent-event modifiers are read from a small `gs.rivalPressureModifiers: [{ delta, fromDay, lifetimeDays }]` array, populated when an event fires (the event template carries `pressureDelta` and `pressureLifetime` or defaults).

`makeQuarterlyNagLetter` tone-band override: existing logic computes a band from `nothingYet`/`onTrack`/`finalStretch`. After that band selection, if `s.rivalPressure > 70`, escalate one step (pleased→reminding, reminding→pointed, pointed→dismayed). If `< 30`, soften one step. `nothingYet` and `finalStretch` short-circuits stay first; the rivalPressure shift only modifies the *non-edge* bands (`onTrack` and "quarterly reminder").

### Intel buy plumbing

Three intel-letter producers, each gated and capped per-charter:

```js
// In tickDays scripted-letter triggers:

// Brotherhood Hand intel — extends pirates AUTO_SENDERS entry
//   2 letters per charter; gates: pirates ≥ +5; 60-day spacing
//   On accept: -£40 to -£80, sets s.flags.hardacreIntelPlant = true
//   On decline: small pirate rep cost

// Vizier intel
//   1-2 per charter; gates: visited Eustace ≥ 2 times; 90-day spacing
//   On accept: plants vizierBoonOwed = true (if not already set), sets s.flags.terborchIntelPlant = true
//   On decline: small rajah rep neutral / -1

// Mr. Cama (Bombay)
//   2-3 per charter; gates: day ≥ 60; 75-day spacing
//   On accept: -£20 to -£60, sets s.flags.lowjiIntelPlant = true
//   On decline: no cost (Cama just keeps writing)
```

When the next event for that rival fires, `event.build(s, { anticipated: true })` returns a richer body ("As you anticipated, Mr. Hardacre's brigantine has gone aground at Pulau Tonang…"). The plant flag is consumed on event firing.

### Mr. Cama AUTO_SENDERS entry

```js
{
  key: 'cama',
  from: 'Mr. Pestonji Cama, of the Bombay establishment',
  faction: null,
  mood: 'a careful Parsi shipping clerk, second to a great house, offering small pieces of news for small pieces of money — formal mercantile English with the occasional Zoroastrian touchstone',
  weight: 2,
  gate: (s) => s.day >= 60,
}
```

Cama's letters use the per-sender template pool pattern that other AUTO_SENDERS use. Three templates per pool (matching the existing Wexley / Faulke / Pyke / Hand / ter Borch / Dryden cadence): two of the three Cama templates carry intel-buy responses; one is pure ambient (a small request for £5 or news of his son's apprenticeship).

## Cross-cutting behavior

### Save migration

`ensureShape(gs)` adds, in order:

```js
if (!next.rivals) {
  next.rivals = makeInitialRivals();   // pre-populates 3 rivals at standing 50, state 'steady', empty eventsFired
}
if (!next.priceWindows) next.priceWindows = [];
if (next.rivalPressure === undefined) next.rivalPressure = 50;
if (!next.rivalPressureModifiers) next.rivalPressureModifiers = [];
```

Old saves load cleanly with rivals at default state. Their first rival event fires at `firstRivalEventDay = 60-120` from the moment they next launch, regardless of charter day — *acceptable*, because rivalry is being added mid-charter for them.

### Successor / renewal

`makeSuccessorState` and `makeRenewedState` should reset `gs.rivals` to `makeInitialRivals()` (fresh trajectories for the new Factor) but **preserve `companyFaction`** if set, since that's player-Faction state, not rival state. `priceWindows` and `rivalPressureModifiers` reset to empty.

### `rivalRisk` cosmetic badge

The existing Eustace `rivalRisk: true` MapView badge is retained as flavor and remains correct (ter Borch is now a richer rival there).

## Testing

| Test | What it covers |
|---|---|
| Pool eligibility | `pickRivalEvent` filters by minDay/maxDay/preconditions/eventsFired |
| No repeats | Same template never fires twice for the same charter |
| Graceful exhaustion | When all eligible templates used, `pickRivalEvent` returns null without error |
| 240-day cap | More than 3 rival events in a 240-day window does not happen |
| `computeRivalPressure` | Edge cases: all rivals broken (pressure floor), all rivals ahead (pressure ceiling), mid-charter mixed |
| Pool size sufficiency | Force-run 1080-day simulation; verify event count is in [6, 12] |
| `ensureShape` migration | Loading a save without `gs.rivals` populates defaults; loading with old shape does not double-populate |
| `priceWindow` apply | Port stock/buy-sell multipliers consult active windows |
| `priceWindow` expiry | Cleanup removes expired entries; multiple stacking windows compose multiplicatively |
| Intel-buy plant | `hardacreIntelPlant` flag → next Hardacre event fires `anticipated: true` body branch; flag is consumed on firing |
| Successor reset | `makeSuccessorState` produces a fresh `gs.rivals` |
| Renewal reset | `makeRenewedState` produces a fresh `gs.rivals` |

Prose itself is hand-reviewed, not unit-tested.

## Risks / known unknowns

1. **18 event templates is the largest content cost.** PWA is deterministic — every template body, response prose, and journal line is hand-written. Estimated effort: 4–8 hours of writing alone, separate from the structural code. **Scope-down fallback:** ship 4 templates per rival (12 total) for v1; add the remaining 6 in a follow-up content commit. Risk if scoped down: pool exhaustion appears earlier in long charters; cap to 4–6 events instead of 6–8.

2. **`priceWindows` touches port-econ helpers** that this spec hasn't read line-by-line. Risk of unforeseen interactions with existing `portStocks` per-day stock regen, sell/buy multiplier composition, and the Dutch trade-pass tax-rate halving. **Mitigation:** the implementation plan (writing-plans phase) should begin with a spike — read `PortView`, `getPortBuyPrice`, `getPortSellPrice`, and `tickDays` portStocks regen, and draft the precise integration point before writing event templates.

3. **`rivalPressure` tone-band shift could fight existing nag-letter logic.** `nothingYet` and `finalStretch` short-circuits must stay first; rivalPressure only shifts the *middle* bands. Needs careful conditional ordering and a unit test that exercises each of the 6 combinations (`{nothingYet/finalStretch/onTrack/quarterly} × {high/normal/low pressure}`).

4. **Cama's AUTO_SENDERS gate may need refinement.** With cast 6 → 7 and existing weights summing to 15, Cama at weight 2 takes ~13% of auto-letter slots. Could feel too frequent for a "Bombay correspondent." Implementation may need to lower his weight to 1, or gate him further (`day ≥ 90`).

5. **ter Borch's promotion to "senior factor" is an implicit retcon.** WORLD_NOTES describes him in AUTO_SENDERS as a Calvinist trader voice — the promotion to senior VOC factor at Eustace is consistent with his existing voice but should land in WORLD_NOTES.md as a noted character extension. The implementation plan should include a small WORLD_NOTES entry under "INSPIRATIONS LANDED" describing the promotion.

## Open questions for implementation plan

These can be resolved during the writing-plans phase, not in the spec:

- Exact `priceWindow` interaction with the Dutch trade-pass duty halving — multiplicative or additive?
- Whether ter Borch's promotion warrants a one-time scripted letter to the player ("the senior factor at Eustace begs leave to introduce himself") or whether it's purely backgrounded — current spec assumes backgrounded.
- Whether Cama gets a portrait/lore entry in `LORE` registry alongside Lowji — the lore-cap-3-per-prompt budget should not be strained.

---

*End of design.*
