# Sabotage Arcs — Design

**Date:** 2026-05-09
**Author:** Claude (with Bradley's go-ahead to proceed autonomously)
**Status:** Spec complete; implementation plan to follow.
**Predecessor spec:** `2026-05-08-rivalry-mechanics-design.md`

## 1. What this is

The 5th rivalry lever, deferred from v1 of the rivalry subsystem. Adds three two-step scripted arcs — one per rival — that let the player commission the rival's downfall through the same intel channel that feeds them rumours. The previous spec promised that "if a Hardacre downfall arc is wanted later, it lands as a *new* questline alongside Cylinder/Pale Man/Wilbraham, not within rivalry mechanics." That is what this is.

Three rivals, three arcs:

| Rival         | Channel     | Sabotage flavour                                                |
|---------------|-------------|-----------------------------------------------------------------|
| Hardacre      | Brotherhood | Bribe Maas to lift / sink the brigantine in the Mentawai Strait |
| ter Borch     | Vizier      | Plant a customs-forgery accusation, force a Batavia inquiry     |
| Lowji         | Cama        | Coordinated loan-recall through Bombay bills-of-exchange houses |

Each arc is structurally identical: a Step 1 letter from the channel sender offers the lever, the player commits or declines, and a Step 2 letter ~45 days later lands the resolution. Outcomes are deterministic given the player's choice + rival/channel state — no live AI dependency, no branching beyond what `fixedOutcome` already supports.

## 2. Why this shape (B over A and C)

- **A. One-shot lever in the rivalry subsystem.** Rejected: doesn't earn the political weight. Sabotage as a button next to "Read pressure" makes it cosmetic. The previous spec was explicit — sabotage doesn't belong in the rivalry registry, it belongs in the questline tradition.
- **B. Two-step scripted arc per rival. ✅ Chosen.** Mirrors the project's strongest content pattern (Cylinder, Pale Man, Faulke, Wilbraham). Each rival gets distinct flavour tied to their channel's actual capability. Three independent state machines, one shared shape.
- **C. Single 3-step Brotherhood questline that re-targets.** Rejected: collapses three rivals into one arc, sacrifices per-rival flavour, and forces the Brotherhood as the sole instrument of every downfall — which is wrong. ter Borch falls through court intrigue, not pirates.

## 3. Player journey

1. **Year 1** — sabotage is dormant. The player learns the rivals through baseline events.
2. **Year 2 onwards** — the channel sender writes once per rival, unprompted, when conditions are right (see §5). The Step 1 letter offers Commission / Negotiate / Decline. The pricing and rep-cost is laid out in the prose.
3. **~45 days later** — Step 2 lands. Outcome is determined at that moment by a deterministic roll (channel rep + rival standing + method). Three resolution branches (Success / Partial / Failure) carry distinct prose, mechanical effects, and one journal entry each.
4. **Charter end** — `gs.sabotagesCommitted` (count of committed arcs, regardless of outcome) is available for the final Director letter to flavour. No new charter-end branches are introduced; existing Crown / Company / Brotherhood standing already feeds the four destinies and is moved by the resolution outcomes.

## 4. State shape additions

All flags live under `gs.flags` per the established questline pattern. One running counter on `gs` itself.

```js
flags: {
  // Per-rival, three rivals (rival key in {hardacre, terborch, lowji}):
  sabotage_<rival>_offered:        bool,           // Step 1 sent
  sabotage_<rival>_method:         'commission' | 'negotiate' | 'declined',
  sabotage_<rival>_committed_day:  number,         // day Step 1 was answered (commission|negotiate)
  sabotage_<rival>_resolved:       'success' | 'partial' | 'failure',
}
sabotagesCommitted: number,                        // running count of commission|negotiate
```

`ensureShape` initialises `sabotagesCommitted = 0` and leaves the per-rival flags absent until used. New saves and old saves both work.

`makeSuccessorState` and `makeRenewedState` reset all sabotage flags and the counter — fresh competitive curve per charter (matches how the rivalry session reset rivalry fields).

## 5. Step 1 trigger conditions

Per rival, `tickDays` posts the Step 1 letter when **all** of:

- `!s.charterClosed`
- `s.day >= 365` (Year 2+; sabotage is not an early-game shortcut)
- `s.flags?.sabotage_<rival>_offered !== true` (one offer per rival per charter)
- `s.rivals?.[rival]?.state !== 'broken'` (don't offer to topple an already-toppled rival)
- `computeRivalPressure(s) >= 60` (the player is genuinely under pressure — toothless rivals don't earn an offer)
- **Channel rapport gate** (uniform across rivals): the channel's intel-plant flag must be set, meaning the player has previously bought intel through that channel. The channel doesn't escalate to a stranger.
  - Hardacre: `s.flags?.hardacreIntelPlant === true` (Brotherhood)
  - ter Borch: `s.flags?.terborchIntelPlant === true` (Vizier)
  - Lowji: `s.flags?.lowjiIntelPlant === true` (Cama)

The check happens once per day inside the existing `for (let i = 0; i < days; i++)` loop in `tickDays`, after the rivalry baseline tick. Rivals with their offered flag set are skipped.

## 6. Step 2 trigger conditions

Per rival:

- `!s.charterClosed`
- `s.flags?.sabotage_<rival>_method` is `'commission'` or `'negotiate'` (not `'declined'`)
- `s.flags?.sabotage_<rival>_resolved` is unset (Step 2 hasn't fired yet)
- `s.day >= sabotage_<rival>_committed_day + 45`

`makeSabotage<Rival>Step2Letter(s)` calls `resolveSabotage(rival, s)` once at letter-creation time and returns the appropriate branch's letter body. The resolved outcome is also written back to `gs.flags.sabotage_<rival>_resolved` immediately by the `tickDays` block, so the result is stable: even if the same letter were re-rendered, the resolved flag is read first and no second roll happens.

`resolveSabotage` accepts an optional `randFn` argument (`Math.random` by default) for test injection. This matches the pattern of preferring real `Math.random()` in the codebase while keeping the resolver vitest-friendly.

## 7. Outcome table (per rival)

Each Step 1 has three responses; **Decline** closes the arc, **Commission** and **Negotiate** progress it. Negotiate is cheaper but lower-success.

### 7a. Hardacre — Brotherhood-bribe

| Step 1 choice | £ cost | rep on Step 1                | Step 2 success base |
|---------------|--------|------------------------------|---------------------|
| Commission    | -£500  | none (covert)                | 60%                 |
| Negotiate     | -£300  | none                         | 40%                 |
| Decline       | 0      | none                         | (no Step 2)         |

Step 2 outcomes (success / partial / failure roll, modified by `+5 × max(0, pirates_rep − 50) / 10` for channel rapport):

- **Success** (top band): Brigantine driven onto a reef in the Mentawai Strait; Hardacre survives but his charter is in ruin. `rivals.hardacre.state = 'broken'`. `pressureModifier { delta: -25, lifetimeDays: 480 }`. `reputation: { pirates: +3 }`. Journal: "The brigantine was lifted in the strait. Mr. Hardacre walks the Bencoolen wharf with no command to give."
- **Partial** (mid band): Cargo lifted but ship and Hardacre survive. `rivals.hardacre.state = 'troubled'`; `rivals.hardacre.standing -= 20`. `pressureModifier { delta: -10, lifetimeDays: 240 }`. Journal: "A clean theft in the strait — Mr. Hardacre lost three months' freight but kept his bottom."
- **Failure** (low band): A bos'n caught the Bugis on deck and named the player at Bencoolen. `reputation: { crown: -10, company: -5, pirates: -3 }`. `pressureModifier { delta: +15, lifetimeDays: 360 }`. Journal: "The strait went badly. Mr. Hardacre's lascars took a Bugis alive at Bencoolen and the man named the right Factor."

### 7b. ter Borch — Vizier customs-forgery

| Step 1 choice | £ cost | rep on Step 1               | Step 2 success base |
|---------------|--------|-----------------------------|---------------------|
| Commission    | -£700  | none                        | 60%                 |
| Negotiate     | -£450  | none                        | 40%                 |
| Decline       | 0      | none                        | (no Step 2)         |

Modified by `+5 × max(0, rajah_rep − 50) / 10` for Vizier rapport.

- **Success**: ter Borch recalled to Batavia under a sealed VOC inquiry; will not return inside the charter. `rivals.terborch.state = 'broken'`. `pressureModifier { delta: -25, lifetimeDays: 480 }`. `reputation: { rajah: +3 }`. Journal: "Mynheer ter Borch was carried out of Eustace under a Company guard of his own people. The inquiry will sit at Batavia for the year."
- **Partial**: Inquiry opens, ter Borch is fined and cleared. `rivals.terborch.state = 'troubled'`; `rivals.terborch.standing -= 15`. `pressureModifier { delta: -10, lifetimeDays: 240 }`. Journal: "ter Borch lost the spring before the Batavia bench. He came back lighter, but he came back."
- **Failure**: The forgery is traced. `reputation: { dutch: -15, crown: -5 }`. `flags.banned_eustace_until = day + 90` (player blocked from Port St. Eustace for 90 days; PortView gates on this flag). `pressureModifier { delta: +15, lifetimeDays: 360 }`. Journal: "The forgery came back to yr. door. Eustace is closed to yr. brigantine until the matter cools."

### 7c. Lowji — Cama loan-recall

| Step 1 choice | £ cost | rep on Step 1               | Step 2 success base |
|---------------|--------|-----------------------------|---------------------|
| Commission    | -£600  | none                        | 60%                 |
| Negotiate     | -£400  | none                        | 40%                 |
| Decline       | 0      | none                        | (no Step 2)         |

Modified by `+5 × max(0, company_rep − 50) / 10` for Bombay rapport (Cama is a country trader operating from a Company station).

- **Success**: Lowji insolvent, retires to Surat. `rivals.lowji.state = 'broken'`. `pressureModifier { delta: -25, lifetimeDays: 480 }`. `reputation: { company: +3 }`. Journal: "The Bombay houses called Mr. Lowji's papers all in one fortnight. He has gone home to Surat."
- **Partial**: Lowji liquidates a portion of his fleet but recovers. `rivals.lowji.state = 'troubled'`; `rivals.lowji.standing -= 10`. `pressureModifier { delta: -8, lifetimeDays: 240 }`. Journal: "Mr. Lowji sold off two bottoms at Bombay to clear his bills. He kept the third."
- **Failure**: Cama's complicity exposed; the Bombay correspondents collectively call in £200 in outstanding obligations. `money: -200`. `reputation: { company: -8 }`. `pressureModifier { delta: +15, lifetimeDays: 360 }`. Journal: "Cama's hand was seen at the bills-of-exchange houses. The Bombay correspondents have called £200 in outstanding obligations."

## 8. Pure-logic module: `src/util/sabotage.js`

React-free, vitest-covered. Exports:

```js
export const SABOTAGE_RIVALS = ['hardacre', 'terborch', 'lowji'];

// Per-rival cost/effect tables keyed by method.
export const SABOTAGE_TABLE = { hardacre: {...}, terborch: {...}, lowji: {...} };

// Step-1 eligibility check. Returns true if all gates pass.
export function canOfferSabotage(rivalKey, gs) { ... }

// Step-2 resolution. Returns { outcome, mods } where outcome is
// 'success' | 'partial' | 'failure' and mods is the changes object the
// JSX letter helper applies. Deterministic given (rivalKey, gs):
// roll = hash(rivalKey, committed_day, gs.day) modulo 100.
export function resolveSabotage(rivalKey, gs) { ... }

// Helper: which channel sender writes for which rival.
export function sabotageChannel(rivalKey) { ... }  // 'brotherhood' | 'vizier' | 'cama'
```

`Object.freeze` the registry exports after construction (matches `RIVALS_REGISTRY` discipline in `rivalry.js`).

## 9. JSX-monolith additions

Six new letter helpers, alongside the existing questline helpers (placed after the rivalry letter helpers, ~line 5900):

- `makeSabotageHardacreStep1Letter(s)`, `makeSabotageHardacreStep2Letter(s)`
- `makeSabotageTerBorchStep1Letter(s)`, `makeSabotageTerBorchStep2Letter(s)`
- `makeSabotageLowjiStep1Letter(s)`, `makeSabotageLowjiStep2Letter(s)`

ID base ranges (avoid collision with existing rivalry events at 9300000–9420000):

- Hardacre Step 1: `9500000 + day`, Step 2: `9510000 + day`
- ter Borch Step 1: `9520000 + day`, Step 2: `9530000 + day`
- Lowji Step 1: `9540000 + day`, Step 2: `9550000 + day`

`tickDays` additions: six guarded `if` blocks (Step 1 + Step 2 per rival), placed after the existing rivalry tick. ~80 lines total.

Three `MAJOR_COMMITMENTS` entries surface a sabotage-in-flight as a Standing Arrangement:

```js
{ key: 'sabotage_hardacre_method', label: (v) =>
    v === 'commission' ? 'A Brotherhood matter at Bencoolen — committed; awaiting word.' :
    v === 'negotiate'  ? 'A Brotherhood matter at Bencoolen — bargained-for; awaiting word.' :
    null },
// (mirror for terborch / lowji)
```

The resolved-flag entries surface the outcome briefly, then fade after charter-end (existing pattern).

## 10. Open questions answered

- **Channel gates (§5).** Uniform `*IntelPlant` flag — the player must have previously bought intel through the channel. Gates the offer narratively (the channel knows the player) and mechanically (Year 2+ players who never engaged the intel-buy lever don't get an arc — that's the right consequence for skipping that lever).
- **Banned-from-Eustace gate (§7b failure).** Add a `flags.banned_eustace_until` check inside `MapView` when rendering the Eustace travel button. No prior `flags.banned_X` pattern exists; this is the first. The check is one line and a small visual treatment ("Eustace is closed to you until day N").
- **Concurrent sabotage attempts.** Allowed. Each rival is independent; the player can spend big money to commission all three. The cluster cap on rivalry events (3 events in 240 days) does NOT apply to sabotage — sabotage steps are not in the event pool.
- **Re-triggering after Decline.** Not supported. One offer per rival. The "decline" choice closes the arc.
- **AI prose drift risk.** The arcs are 100% deterministic (`fixedOutcome`-only). No live AI calls. The Step 2 letter body branches on the resolved outcome and emits hand-written prose. No risk of geographic hallucination.

## 11. Testing strategy

`src/util/sabotage.test.js` (vitest):

- `canOfferSabotage` — each gate independently (charter closed, day < 360, already offered, rival broken, pressure < 60, channel-specific gate failing). 9 cases.
- `resolveSabotage` — boundary tests at the 60% / 40% thresholds for each method × rival; rapport modifier raises success rate. ~9 cases.
- Determinism — `resolveSabotage` returns the same outcome on repeated calls with identical inputs. 1 case.
- Roll seeding — verify the hash function distributes across [0, 100) reasonably (statistical, 1000 samples). 1 case.

Total: ~20 new vitest cases. The JSX-side (letter helpers + tickDays guards) is exercised by the existing parser sanity check + manual playtest, consistent with project convention.

## 12. Acceptance criteria

- [ ] All vitest tests pass (existing 92 + ~20 new = ~112)
- [ ] `npm run build` passes; no new bundle warnings
- [ ] Parser sanity check passes on `factors_charter.jsx`
- [ ] Manual playtest: starting a fresh charter and using debug tools to fast-forward to day 365 with appropriate flags posts the first applicable Step 1 letter
- [ ] Each rival's Step 1 → Commission → Step 2 chain produces all three outcomes when the roll is forced (via test seam)
- [ ] HANDOFF.md, DESIGN_NOTES.md, CHANGELOG.md updated
- [ ] One bundled commit on a feature branch, merged `--no-ff` to main

## 13. Out of scope

- **Re-triggerable sabotage.** Once declined, the channel moves on. Future spec if wanted.
- **Mid-arc cancellation.** No "I changed my mind" between Step 1 commit and Step 2 resolution. The committed money is already in the channel's pocket.
- **Cross-rival sabotage events.** ("Hardacre and ter Borch fight over a cargo.") Already noted as a separate future expansion in HANDOFF.md.
- **Charter-end branches keyed on sabotage count.** `sabotagesCommitted` is exposed for prose flavour only; the four destinies remain keyed on the existing knighthood / mountfair / brotherhood-compact flags.
- **A new "Sabotage" UI affordance.** Sabotage is letter-mediated like every other questline. No tab, no panel.
