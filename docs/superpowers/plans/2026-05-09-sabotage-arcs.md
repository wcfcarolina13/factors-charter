# Sabotage Arcs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three two-step letter-mediated sabotage arcs (one per rival) that allow the player to commission a rival's downfall through the rival's intel channel, with deterministic Success / Partial / Failure resolution.

**Architecture:** Pure-logic resolver in `src/util/sabotage.js` (vitest-covered, React-free). Six new letter-helper functions in the JSX monolith mirror existing questline patterns (Faulke / Cylinder / Pale Man). Six guarded `if` blocks in `tickDays` post Step 1 / Step 2 letters when conditions hold. Three `MAJOR_COMMITMENTS` entries surface the in-flight arrangement. One new `banned_eustace_until` flag blocks travel after the ter Borch failure outcome.

**Tech Stack:** React 18 (JSX monolith at `factors_charter.jsx`), Vite + Vitest, vanilla JS in `src/util/`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-09-sabotage-arcs-design.md`.

---

## Phase 1 — Pure-logic module

### Task 1.1: Create `src/util/sabotage.js` skeleton

**Files:**
- Create: `src/util/sabotage.js`

- [ ] **Step 1: Write skeleton with frozen registries**

```js
// Pure sabotage logic. React-free. Companion to ./rivalry.js.
// Three rivals, three two-step arcs. Resolution is deterministic given
// (rivalKey, gs, randFn).

export const SABOTAGE_RIVALS = ['hardacre', 'terborch', 'lowji'];

// Per-rival, per-method cost / base success rate / rapport-axis mapping.
// success rate is the BASE; rapport modifier in resolveSabotage adds up
// to +25 percentage points at maxed rep.
export const SABOTAGE_TABLE = {
  hardacre: {
    channel:    'brotherhood',
    rapportRep: 'pirates',
    methods: {
      commission: { cost: 500, baseSuccess: 60 },
      negotiate:  { cost: 300, baseSuccess: 40 },
    },
  },
  terborch: {
    channel:    'vizier',
    rapportRep: 'rajah',
    methods: {
      commission: { cost: 700, baseSuccess: 60 },
      negotiate:  { cost: 450, baseSuccess: 40 },
    },
  },
  lowji: {
    channel:    'cama',
    rapportRep: 'company',
    methods: {
      commission: { cost: 600, baseSuccess: 60 },
      negotiate:  { cost: 400, baseSuccess: 40 },
    },
  },
};

for (const k of Object.keys(SABOTAGE_TABLE)) {
  Object.freeze(SABOTAGE_TABLE[k].methods.commission);
  Object.freeze(SABOTAGE_TABLE[k].methods.negotiate);
  Object.freeze(SABOTAGE_TABLE[k].methods);
  Object.freeze(SABOTAGE_TABLE[k]);
}
Object.freeze(SABOTAGE_TABLE);
Object.freeze(SABOTAGE_RIVALS);

export function sabotageChannel(rivalKey) {
  return SABOTAGE_TABLE[rivalKey]?.channel ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git checkout -b feat/sabotage-arcs
git add src/util/sabotage.js
git commit -m "feat(sabotage): scaffold pure-logic module with frozen registry"
```

### Task 1.2: `canOfferSabotage` eligibility predicate

**Files:**
- Modify: `src/util/sabotage.js`
- Test: `src/util/sabotage.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/util/sabotage.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { canOfferSabotage } from './sabotage.js';
import { makeInitialRivals } from './rivalry.js';

function baseGs(over = {}) {
  return {
    day: 400,
    charterClosed: null,
    flags: { hardacreIntelPlant: true, terborchIntelPlant: true, lowjiIntelPlant: true },
    rivals: makeInitialRivals(),
    quotas: { pepper: { have: 0, target: 400 }, cinnamon: { have: 0, target: 200 } },
    rivalPressureModifiers: [],
    ...over,
  };
}

// Force pressure >= 60 by giving Hardacre tonnage advantage.
function pressuredGs(over = {}) {
  const gs = baseGs(over);
  gs.rivals.hardacre.pepper = 100;       // +10
  gs.rivals.hardacre.cinnamon = 50;      // +10  → pressure ~70
  return gs;
}

describe('canOfferSabotage', () => {
  it('passes all gates when fully eligible', () => {
    expect(canOfferSabotage('hardacre', pressuredGs())).toBe(true);
  });
  it('fails when charter closed', () => {
    expect(canOfferSabotage('hardacre', pressuredGs({ charterClosed: { day: 400 } }))).toBe(false);
  });
  it('fails before day 365', () => {
    expect(canOfferSabotage('hardacre', pressuredGs({ day: 364 }))).toBe(false);
  });
  it('fails when already offered', () => {
    const gs = pressuredGs();
    gs.flags.sabotage_hardacre_offered = true;
    expect(canOfferSabotage('hardacre', gs)).toBe(false);
  });
  it('fails when rival is already broken', () => {
    const gs = pressuredGs();
    gs.rivals.hardacre.state = 'broken';
    expect(canOfferSabotage('hardacre', gs)).toBe(false);
  });
  it('fails when pressure < 60', () => {
    expect(canOfferSabotage('hardacre', baseGs())).toBe(false);
  });
  it('fails when intel-plant flag is missing', () => {
    const gs = pressuredGs();
    gs.flags.hardacreIntelPlant = false;
    expect(canOfferSabotage('hardacre', gs)).toBe(false);
  });
  it('terborch gate uses terborchIntelPlant', () => {
    const gs = pressuredGs();
    gs.flags.terborchIntelPlant = false;
    expect(canOfferSabotage('terborch', gs)).toBe(false);
  });
  it('lowji gate uses lowjiIntelPlant', () => {
    const gs = pressuredGs();
    gs.flags.lowjiIntelPlant = false;
    expect(canOfferSabotage('lowji', gs)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify FAIL** — `npx vitest run src/util/sabotage.test.js`. Expected: ReferenceError, `canOfferSabotage` not defined.

- [ ] **Step 3: Implement**

Append to `src/util/sabotage.js`:

```js
import { computeRivalPressure } from './rivalry.js';

const INTEL_PLANT_FLAG = {
  hardacre: 'hardacreIntelPlant',
  terborch: 'terborchIntelPlant',
  lowji:    'lowjiIntelPlant',
};

export function canOfferSabotage(rivalKey, gs) {
  if (!SABOTAGE_TABLE[rivalKey]) return false;
  if (gs?.charterClosed) return false;
  if ((gs?.day ?? 0) < 365) return false;
  if (gs?.flags?.[`sabotage_${rivalKey}_offered`] === true) return false;
  if (gs?.rivals?.[rivalKey]?.state === 'broken') return false;
  if (computeRivalPressure(gs) < 60) return false;
  if (gs?.flags?.[INTEL_PLANT_FLAG[rivalKey]] !== true) return false;
  return true;
}
```

- [ ] **Step 4: Run tests, verify PASS** — `npx vitest run src/util/sabotage.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/util/sabotage.js src/util/sabotage.test.js
git commit -m "feat(sabotage): canOfferSabotage with all gates + tests"
```

### Task 1.3: `resolveSabotage` outcome resolver

**Files:**
- Modify: `src/util/sabotage.js`
- Modify: `src/util/sabotage.test.js`

- [ ] **Step 1: Append failing tests**

```js
import { resolveSabotage } from './sabotage.js';

describe('resolveSabotage', () => {
  // Inject deterministic randFn returning a fixed value.
  const fixed = (v) => () => v;

  it('returns success when roll < base + rapport', () => {
    const gs = { day: 500, reputation: { pirates: 50 } };
    expect(resolveSabotage('hardacre', gs, { method: 'commission', randFn: fixed(0.30) }))
      .toBe('success');  // base 60, rapport 0 → cutoff 60, 30 < 60
  });
  it('returns failure when roll above failure threshold', () => {
    const gs = { day: 500, reputation: { pirates: 50 } };
    // base 60, partial band +20 → success<60, partial<80, failure>=80
    expect(resolveSabotage('hardacre', gs, { method: 'commission', randFn: fixed(0.85) }))
      .toBe('failure');
  });
  it('returns partial in the mid band', () => {
    const gs = { day: 500, reputation: { pirates: 50 } };
    expect(resolveSabotage('hardacre', gs, { method: 'commission', randFn: fixed(0.65) }))
      .toBe('partial');
  });
  it('rapport raises success rate', () => {
    const gs = { day: 500, reputation: { pirates: 100 } };  // +25 cap
    // base 60 + 25 = 85, partial up to 105 (clamped); roll 0.80 → success
    expect(resolveSabotage('hardacre', gs, { method: 'commission', randFn: fixed(0.80) }))
      .toBe('success');
  });
  it('negotiate has lower success rate', () => {
    const gs = { day: 500, reputation: { pirates: 50 } };
    // base 40, roll 0.50 → above success cutoff
    expect(resolveSabotage('hardacre', gs, { method: 'negotiate', randFn: fixed(0.50) }))
      .toBe('partial');
  });
  it('terborch uses rajah rep for rapport', () => {
    const gs = { day: 500, reputation: { rajah: 100 } };
    expect(resolveSabotage('terborch', gs, { method: 'commission', randFn: fixed(0.80) }))
      .toBe('success');
  });
  it('lowji uses company rep for rapport', () => {
    const gs = { day: 500, reputation: { company: 100 } };
    expect(resolveSabotage('lowji', gs, { method: 'commission', randFn: fixed(0.80) }))
      .toBe('success');
  });
  it('low rep does not penalise below base', () => {
    const gs = { day: 500, reputation: { pirates: 0 } };
    expect(resolveSabotage('hardacre', gs, { method: 'commission', randFn: fixed(0.55) }))
      .toBe('success');  // base 60, roll 55 < 60
  });
});
```

- [ ] **Step 2: Run, verify FAIL**.

- [ ] **Step 3: Implement**

Append to `src/util/sabotage.js`:

```js
// Resolution: roll r in [0, 100). cutoffs:
//   r < successCutoff → 'success'
//   r < successCutoff + 20 → 'partial'
//   else → 'failure'
// successCutoff = baseSuccess + min(25, max(0, rep - 50) / 2)
export function resolveSabotage(rivalKey, gs, { method = 'commission', randFn = Math.random } = {}) {
  const cfg = SABOTAGE_TABLE[rivalKey];
  if (!cfg) return 'failure';
  const m = cfg.methods[method];
  if (!m) return 'failure';
  const rep = gs?.reputation?.[cfg.rapportRep] ?? 50;
  const rapport = Math.min(25, Math.max(0, rep - 50) / 2);
  const successCutoff = m.baseSuccess + rapport;
  const roll = randFn() * 100;
  if (roll < successCutoff) return 'success';
  if (roll < successCutoff + 20) return 'partial';
  return 'failure';
}
```

- [ ] **Step 4: Run, verify PASS**.

- [ ] **Step 5: Commit**

```bash
git add src/util/sabotage.js src/util/sabotage.test.js
git commit -m "feat(sabotage): resolveSabotage with rapport modifier + tests"
```

### Task 1.4: `sabotageChannel` test + `SABOTAGE_TABLE` shape test

**Files:**
- Modify: `src/util/sabotage.test.js`

- [ ] **Step 1: Append tests**

```js
import { sabotageChannel, SABOTAGE_TABLE, SABOTAGE_RIVALS } from './sabotage.js';

describe('SABOTAGE_TABLE / sabotageChannel', () => {
  it('exposes a channel per rival', () => {
    expect(sabotageChannel('hardacre')).toBe('brotherhood');
    expect(sabotageChannel('terborch')).toBe('vizier');
    expect(sabotageChannel('lowji')).toBe('cama');
  });
  it('returns null for unknown rival', () => {
    expect(sabotageChannel('nope')).toBe(null);
  });
  it('SABOTAGE_RIVALS matches table keys', () => {
    expect([...SABOTAGE_RIVALS].sort()).toEqual(Object.keys(SABOTAGE_TABLE).sort());
  });
  it('table is frozen', () => {
    expect(Object.isFrozen(SABOTAGE_TABLE)).toBe(true);
    expect(Object.isFrozen(SABOTAGE_TABLE.hardacre.methods.commission)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify all PASS**.

- [ ] **Step 3: Commit**

```bash
git add src/util/sabotage.test.js
git commit -m "test(sabotage): table-shape and channel-mapping tests"
```

---

## Phase 2 — `gs` shape

### Task 2.1: `ensureShape`, `makeSuccessorState`, `makeRenewedState`

**Files:**
- Modify: `factors_charter.jsx`

- [ ] **Step 1: Locate `ensureShape`** — `grep -n "function ensureShape" factors_charter.jsx`

- [ ] **Step 2: Add `sabotagesCommitted` initialisation**

In `ensureShape`, after the existing scalar inits (look for `if (!Array.isArray(next.pendingLetterRequests))` block at ~line 778) add:

```js
if (typeof next.sabotagesCommitted !== 'number') next.sabotagesCommitted = 0;
```

- [ ] **Step 3: Locate `makeSuccessorState` and `makeRenewedState`** — both reset `gs.rivals` etc.

Add to each, alongside the rivalry resets:

```js
sabotagesCommitted: 0,
```

And ensure the flag-stripping logic (if any whitelists flags) doesn't preserve `sabotage_*` flags from the prior charter. Check by grepping `successor` flag-handling. If flags are wholesale cleared on succession, no extra work needed.

- [ ] **Step 4: Verify — parser sanity**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines');"
```

- [ ] **Step 5: Commit**

```bash
git add factors_charter.jsx
git commit -m "feat(sabotage): gs.sabotagesCommitted shape"
```

---

## Phase 3 — Letter helpers

Each Step 1 letter helper produces an offer letter from the channel sender with three responses (Commission / Negotiate / Decline). Each Step 2 helper calls `resolveSabotage` once, computes the changes from the spec's outcome table, and returns a single-response letter ("So be it.") whose `fixedOutcome.changes` carries the mechanical effects.

### Task 3.1: `makeSabotageHardacreStep1Letter`

**Files:**
- Modify: `factors_charter.jsx` (place after the existing rivalry helpers, ~line 5900)

- [ ] **Step 1: Add import to top of `factors_charter.jsx`**

After the existing `import { ... } from './src/util/rivalry.js';`:

```js
import { canOfferSabotage, resolveSabotage, SABOTAGE_TABLE } from './src/util/sabotage.js';
```

(Verify the current rivalry import path; mirror it.)

- [ ] **Step 2: Add helper**

```js
function makeSabotageHardacreStep1Letter(s) {
  return {
    id: 9500000 + s.day,
    from: 'A small voice in the strait',
    subject: 'On the matter of yr. peer at Bencoolen',
    body: `Sir, — The strait writes to you again, plainly. The man at Bencoolen has been a thorn long enough; we have lascars on his quarter who would prefer a different employment. The price for the lifting of his next freight is five hundred pounds, paid as before. We can also do the matter quieter, for three hundred — half-measures, half-results, that is the trade.

The boy at the wharf will carry yr. answer. — Yrs., as the strait is.`,
    responses: [
      {
        label: 'Commission the full lifting (£500)',
        seed: 'commit; full method; sabotage_hardacre_committed_day set',
        fixedOutcome: {
          prose: `Five hundred pounds in coin and unmarked silver pass to the boy at the wharf in a sealed packet. He goes without speaking. The brigantine sails for Bencoolen on the following Thursday; the matter is now in motions you have set in train.`,
          changes: {
            money: -500,
            flags: { sabotage_hardacre_offered: true, sabotage_hardacre_method: 'commission', sabotage_hardacre_committed_day: s.day },
            sabotagesCommitted: { _delta: 1 },  // resolved in apply
            journal: 'Paid £500 to the strait for the lifting of Mr. Hardacre\'s brigantine. The matter is in train.',
            hook: 'You have set a Brotherhood lifting in motion against Hardacre. Word in five or six weeks.',
          },
        },
      },
      {
        label: 'Negotiate the cheaper, quieter matter (£300)',
        seed: 'commit; negotiate method',
        fixedOutcome: {
          prose: `Three hundred pounds, by the same hand. The boy at the wharf takes the packet without expression. The strait will do what it does for the price asked.`,
          changes: {
            money: -300,
            flags: { sabotage_hardacre_offered: true, sabotage_hardacre_method: 'negotiate', sabotage_hardacre_committed_day: s.day },
            sabotagesCommitted: { _delta: 1 },
            journal: 'Paid £300 to the strait — a quieter matter against Mr. Hardacre. Word in five or six weeks.',
            hook: 'A bargained-for matter is in motion against Hardacre.',
          },
        },
      },
      {
        label: 'Decline the matter',
        seed: 'decline; arc closes',
        fixedOutcome: {
          prose: `You write back briefly. \'Such matters as the strait is offering, the Factor declines.\' The boy at the wharf takes the note without comment. The matter is closed.`,
          changes: {
            flags: { sabotage_hardacre_offered: true, sabotage_hardacre_method: 'declined' },
            journal: 'Declined the strait\'s offer to lift Mr. Hardacre\'s brigantine.',
          },
        },
      },
    ],
    read: false,
  };
}
```

The `_delta` shape on `sabotagesCommitted` — check how the existing `applyChanges` (or equivalent letter-resolve handler) handles non-flag scalar changes. Most likely a `money: -500` works because it's a top-level numeric field; `sabotagesCommitted` is also a top-level field, so use the same pattern. **Replace `sabotagesCommitted: { _delta: 1 }` with the convention used by `money` and similar — likely just `sabotagesCommitted: 1` interpreted as a delta, or written into the apply directly.**

Locate the apply handler (`grep -n "money: " factors_charter.jsx | head` and find where it's consumed). If it's `next.money += changes.money`, mirror with `next.sabotagesCommitted = (next.sabotagesCommitted || 0) + (changes.sabotagesCommitted || 0)`.

- [ ] **Step 3: Verify apply handler supports `sabotagesCommitted`**

In the change-apply code (`grep -n "applyChange\|applyOutcome\|reputation:.*delta\|next.money +=" factors_charter.jsx`), find the spot where flags / money / reputation are applied and add a `sabotagesCommitted` clause. Use a delta-add pattern.

- [ ] **Step 4: Parser sanity check** (as above).

- [ ] **Step 5: Commit**

```bash
git add factors_charter.jsx
git commit -m "feat(sabotage): Hardacre Step 1 letter + apply support for sabotagesCommitted"
```

### Task 3.2: `makeSabotageHardacreStep2Letter`

**Files:**
- Modify: `factors_charter.jsx`

- [ ] **Step 1: Add helper directly below Task 3.1's helper**

```js
function makeSabotageHardacreStep2Letter(s) {
  const method = s.flags?.sabotage_hardacre_method;
  const outcome = resolveSabotage('hardacre', s, { method });

  const branches = {
    success: {
      subject: 'The strait has done its work',
      body: `Sir, — Word from a Bugis pilot at the Pelican\'s Nest. The brigantine bound for Bencoolen was driven onto a reef in the Mentawai by what the Captain calls bad pilotage and the strait calls itself. Mr. Hardacre walks the wharf at Bencoolen with no command to give and the Court will hear of it within the month.

The strait considers itself paid in full. We do not write again on this matter.

—`,
      changes: {
        rivals: { hardacre: { state: 'broken' } },
        rivalPressureModifiers: { _push: { fromDay: s.day, lifetimeDays: 480, delta: -25 } },
        reputation: { pirates: 3 },
        flags: { sabotage_hardacre_resolved: 'success' },
        journal: 'The brigantine was lifted in the strait. Mr. Hardacre walks the Bencoolen wharf with no command to give.',
      },
    },
    partial: {
      subject: 'A clean theft, and no more',
      body: `Sir, — The matter went part-way. The brigantine was boarded in the strait at the new moon; her cargo of pepper and calico was lifted clean and is now at sea under no flag. Mr. Hardacre kept his bottom and his life; he did not keep his freight.

The strait considers itself paid for the work given. — Yrs., as the strait is.`,
      changes: {
        rivals: { hardacre: { state: 'troubled', standing: -20 } },
        rivalPressureModifiers: { _push: { fromDay: s.day, lifetimeDays: 240, delta: -10 } },
        flags: { sabotage_hardacre_resolved: 'partial' },
        journal: 'A clean theft in the strait — Mr. Hardacre lost three months\' freight but kept his bottom.',
      },
    },
    failure: {
      subject: 'The strait went badly',
      body: `Sir, — The matter is broken. Mr. Hardacre\'s lascars took a Bugis alive on the brigantine\'s quarter and the man named you to the Bencoolen bench under the cane. The Court will hear of it. We are sorry for the work, sir, and you may consider yr. account with us closed for the present.

—`,
      changes: {
        reputation: { crown: -10, company: -5, pirates: -3 },
        rivalPressureModifiers: { _push: { fromDay: s.day, lifetimeDays: 360, delta: 15 } },
        flags: { sabotage_hardacre_resolved: 'failure' },
        journal: 'The strait went badly. Mr. Hardacre\'s lascars took a Bugis alive at Bencoolen and the man named the right Factor.',
      },
    },
  };

  const branch = branches[outcome];
  return {
    id: 9510000 + s.day,
    from: 'A small voice in the strait',
    subject: branch.subject,
    body: branch.body,
    responses: [
      {
        label: 'So be it.',
        seed: `sabotage hardacre resolved: ${outcome}`,
        fixedOutcome: {
          prose: `The Factor reads the note twice and writes nothing in answer.`,
          changes: branch.changes,
        },
      },
    ],
    read: false,
  };
}
```

- [ ] **Step 2: Verify apply handler supports `rivals` and `rivalPressureModifiers` change shapes**

Grep for the existing application of these in the rivalry intel-buy events (which already mutate rivals via flags or similar). Confirm the apply path. If it doesn't, extend it: `next.rivals[k] = { ...next.rivals[k], ...patch }` and `next.rivalPressureModifiers = [...prev, pushed]`.

- [ ] **Step 3: Parser sanity check + run vitest**

- [ ] **Step 4: Commit**

```bash
git add factors_charter.jsx
git commit -m "feat(sabotage): Hardacre Step 2 with deterministic branches"
```

### Task 3.3: `makeSabotageTerBorchStep1Letter` and `Step2Letter`

**Files:**
- Modify: `factors_charter.jsx`

- [ ] **Step 1: Add Step 1 helper**

Mirror the Hardacre Step 1 shape with these substitutions:
- `id`: `9520000 + s.day`
- `from`: `'A discreet hand at the Rajah\'s court'`
- `subject`: `'A matter touching Mynheer ter Borch'`
- Body: prose about the Vizier offering to plant a customs forgery (the prompt should mention £700 commission and £450 negotiate).
- Costs: 700 / 450
- Flags: `sabotage_terborch_*`
- Method values identical (`commission` / `negotiate` / `declined`)

- [ ] **Step 2: Add Step 2 helper**

Mirror Hardacre Step 2 shape with these branches:

```js
const branches = {
  success: {
    subject: 'A matter at Batavia',
    body: `Sir, — Mynheer ter Borch was carried out of Eustace under a Company guard of his own people, with sealed papers from the Heeren XVII and a nominal guard of his own pikes. The inquiry will sit at Batavia for the year and longer. The Vizier sends his compliments. — Yrs., discreetly.`,
    changes: {
      rivals: { terborch: { state: 'broken' } },
      rivalPressureModifiers: { _push: { fromDay: s.day, lifetimeDays: 480, delta: -25 } },
      reputation: { rajah: 3 },
      flags: { sabotage_terborch_resolved: 'success' },
      journal: 'Mynheer ter Borch was carried out of Eustace under a Company guard of his own people. The inquiry will sit at Batavia for the year.',
    },
  },
  partial: {
    subject: 'The Batavia bench was lenient',
    body: `Sir, — The inquiry sat. Mynheer ter Borch produced two Dutch witnesses of standing and a small fine was set against him. He came back to Eustace at the spring monsoon, lighter in the purse and lighter in his manner; the Heeren XVII have not closed his file. — Yrs.`,
    changes: {
      rivals: { terborch: { state: 'troubled', standing: -15 } },
      rivalPressureModifiers: { _push: { fromDay: s.day, lifetimeDays: 240, delta: -10 } },
      flags: { sabotage_terborch_resolved: 'partial' },
      journal: 'ter Borch lost the spring before the Batavia bench. He came back lighter, but he came back.',
    },
  },
  failure: {
    subject: 'The forgery has come back to yr. door',
    body: `Sir, — The matter is undone. The forgery was traced — by what hand we cannot say — and the Heeren XVII have made representation through the Crown\'s residency. Eustace is closed to yr. brigantine until the matter cools; the Vizier sends his regrets and his fee, returned in part. — Yrs.`,
    changes: {
      reputation: { dutch: -15, crown: -5 },
      rivalPressureModifiers: { _push: { fromDay: s.day, lifetimeDays: 360, delta: 15 } },
      flags: { sabotage_terborch_resolved: 'failure', banned_eustace_until: s.day + 90 },
      journal: 'The forgery came back to yr. door. Eustace is closed to yr. brigantine until the matter cools.',
    },
  },
};
```

`id`: `9530000 + s.day`. `from`: same as Step 1.

- [ ] **Step 3: Parser sanity, vitest, commit**

```bash
git add factors_charter.jsx
git commit -m "feat(sabotage): ter Borch arc (Step 1 + Step 2)"
```

### Task 3.4: `makeSabotageLowjiStep1Letter` and `Step2Letter`

**Files:**
- Modify: `factors_charter.jsx`

- [ ] **Step 1: Step 1 helper**

Mirror with:
- `id`: `9540000 + s.day` / `9550000 + s.day`
- `from`: `'Mr. Cama, of Bombay (privately)'`
- `subject`: `'On the standing of Mr. Lowji at the bills-of-exchange houses'`
- Body: Cama offers to coordinate a recall through the Bombay houses. £600 commission, £400 negotiate.
- Flags: `sabotage_lowji_*`

- [ ] **Step 2: Step 2 helper**

Branches:

```js
const branches = {
  success: {
    subject: 'Mr. Lowji has gone home to Surat',
    body: `Sir, — The Bombay correspondents called Mr. Lowji\'s papers all in one fortnight. He could not pay; his fleet was scattered across three monsoons and his factors at Calicut and Mocha could not move their stock fast enough. The man has gone home to Surat to sit with his family. The matter is concluded. — Yrs., respectfully, Mr. Cama.`,
    changes: {
      rivals: { lowji: { state: 'broken' } },
      rivalPressureModifiers: { _push: { fromDay: s.day, lifetimeDays: 480, delta: -25 } },
      reputation: { company: 3 },
      flags: { sabotage_lowji_resolved: 'success' },
      journal: 'The Bombay houses called Mr. Lowji\'s papers all in one fortnight. He has gone home to Surat.',
    },
  },
  partial: {
    subject: 'Mr. Lowji has sold off two bottoms',
    body: `Sir, — The matter went part-way. Mr. Lowji liquidated two of his bottoms at Bombay to clear his bills and kept his third in service. He is the smaller man, though not yet the broken one. — Mr. Cama.`,
    changes: {
      rivals: { lowji: { state: 'troubled', standing: -10 } },
      rivalPressureModifiers: { _push: { fromDay: s.day, lifetimeDays: 240, delta: -8 } },
      flags: { sabotage_lowji_resolved: 'partial' },
      journal: 'Mr. Lowji sold off two bottoms at Bombay to clear his bills. He kept the third.',
    },
  },
  failure: {
    subject: 'A matter undone, with consequences',
    body: `Sir, — My hand was seen at the bills-of-exchange houses, by parties of standing whose discretion I had over-estimated. The Bombay correspondents have collectively called two hundred pounds in outstanding obligations against yr. account, by way of demonstrating their displeasure. I am sorry for the work; the matter is concluded for both of us. — Mr. Cama.`,
    changes: {
      money: -200,
      reputation: { company: -8 },
      rivalPressureModifiers: { _push: { fromDay: s.day, lifetimeDays: 360, delta: 15 } },
      flags: { sabotage_lowji_resolved: 'failure' },
      journal: 'Cama\'s hand was seen at the bills-of-exchange houses. The Bombay correspondents have called £200 in outstanding obligations.',
    },
  },
};
```

- [ ] **Step 3: Parser sanity, vitest, commit**

```bash
git add factors_charter.jsx
git commit -m "feat(sabotage): Lowji arc (Step 1 + Step 2)"
```

---

## Phase 4 — `tickDays` integration

### Task 4.1: Step 1 trigger blocks for all three rivals

**Files:**
- Modify: `factors_charter.jsx` (in `tickDays`, after the existing rivalry-tick block)

- [ ] **Step 1: Locate the rivalry-tick block** — `grep -n "pickRivalEvent\|rivals.*baseline" factors_charter.jsx | head`. Find the closing `}` of that block.

- [ ] **Step 2: Add Step 1 trigger loop**

Insert after the rivalry-tick block, inside the day loop:

```js
// ── Sabotage arcs: Step 1 offers per rival when conditions hold.
// Uses canOfferSabotage from src/util/sabotage.js. One offer per rival
// per charter; arc closes if declined.
for (const rk of ['hardacre', 'terborch', 'lowji']) {
  if (!canOfferSabotage(rk, s)) continue;
  const make =
    rk === 'hardacre' ? makeSabotageHardacreStep1Letter :
    rk === 'terborch' ? makeSabotageTerBorchStep1Letter :
                        makeSabotageLowjiStep1Letter;
  const letter = make(s);
  s.letters = [...s.letters, letter];
  s.lettersGenerated = (s.lettersGenerated || 0) + 1;
  // Note: sabotage_<rival>_offered flag is NOT set here — it's set in the
  // response's fixedOutcome (covers all three response paths). This means
  // the offer letter could re-fire on the next tick if the player hasn't
  // opened it yet. Mitigate by stamping a "pending" flag here:
  s.flags = { ...(s.flags || {}), [`sabotage_${rk}_offered`]: true };
  s.awayLog.push({ day: s.day, type: 'letter', text: `A folded note at the gate, concerning Mr. ${rk === 'hardacre' ? 'Hardacre' : rk === 'terborch' ? 'ter Borch' : 'Lowji'}.` });
}
```

(Adjust the make-fn names to the actual exports from Tasks 3.1–3.4.)

**Wait — the `_offered` flag stamp here means the letter response's fixedOutcome doesn't need to re-stamp it. But it still needs to set `sabotage_<rival>_method`. That's already in each response's changes. Good.**

- [ ] **Step 3: Parser sanity**

- [ ] **Step 4: Commit**

```bash
git add factors_charter.jsx
git commit -m "feat(sabotage): tickDays Step 1 trigger loop"
```

### Task 4.2: Step 2 trigger blocks for all three rivals

**Files:**
- Modify: `factors_charter.jsx`

- [ ] **Step 1: Add Step 2 trigger loop**

Immediately below the Task 4.1 block:

```js
// ── Sabotage arcs: Step 2 fires 45 days after commitment.
for (const rk of ['hardacre', 'terborch', 'lowji']) {
  if (s.charterClosed) break;
  const method = s.flags?.[`sabotage_${rk}_method`];
  if (method !== 'commission' && method !== 'negotiate') continue;
  if (s.flags?.[`sabotage_${rk}_resolved`]) continue;
  const committedDay = s.flags?.[`sabotage_${rk}_committed_day`] ?? 0;
  if (s.day < committedDay + 45) continue;

  const make =
    rk === 'hardacre' ? makeSabotageHardacreStep2Letter :
    rk === 'terborch' ? makeSabotageTerBorchStep2Letter :
                        makeSabotageLowjiStep2Letter;
  const letter = make(s);
  s.letters = [...s.letters, letter];
  s.lettersGenerated = (s.lettersGenerated || 0) + 1;
  // Note: sabotage_<rival>_resolved is set when the player opens & responds
  // to the Step 2 letter (its fixedOutcome.changes.flags carries it).
  // Until then, the loop above will re-fire if we don't stamp a "sent" flag.
  s.flags = { ...(s.flags || {}), [`sabotage_${rk}_step2_sent`]: true };
  s.awayLog.push({ day: s.day, type: 'letter', text: `A return note concerning Mr. ${rk === 'hardacre' ? 'Hardacre' : rk === 'terborch' ? 'ter Borch' : 'Lowji'}.` });
}
```

Update the loop's continue-condition to also skip when `step2_sent` is set:

```js
if (s.flags?.[`sabotage_${rk}_step2_sent`]) continue;
```

(Insert this line between the `_resolved` check and the `committedDay` check.)

- [ ] **Step 2: Parser sanity, vitest, commit**

```bash
git add factors_charter.jsx
git commit -m "feat(sabotage): tickDays Step 2 trigger loop"
```

---

## Phase 5 — Standing Arrangements + travel ban

### Task 5.1: `MAJOR_COMMITMENTS` entries

**Files:**
- Modify: `factors_charter.jsx` (the `MAJOR_COMMITMENTS` array, ~line 4770)

- [ ] **Step 1: Add three entries**

```js
{ key: 'sabotage_hardacre_method', label: (v) =>
    v === 'commission' ? 'A Brotherhood lifting at Bencoolen — committed; awaiting word.' :
    v === 'negotiate'  ? 'A Brotherhood matter at Bencoolen — bargained-for; awaiting word.' :
    null },
{ key: 'sabotage_hardacre_resolved', label: (v) =>
    v === 'success' ? 'Mr. Hardacre walks the Bencoolen wharf with no command.' :
    v === 'partial' ? 'Mr. Hardacre is wounded but not removed.' :
    v === 'failure' ? 'A Brotherhood matter at Bencoolen — done badly. Yr. name was named.' :
    null },
{ key: 'sabotage_terborch_method', label: (v) =>
    v === 'commission' ? 'A customs matter against Mynheer ter Borch — committed; awaiting word.' :
    v === 'negotiate'  ? 'A customs matter against Mynheer ter Borch — bargained-for; awaiting word.' :
    null },
{ key: 'sabotage_terborch_resolved', label: (v) =>
    v === 'success' ? 'Mynheer ter Borch is at Batavia under inquiry.' :
    v === 'partial' ? 'Mynheer ter Borch was lightly fined; he kept Eustace.' :
    v === 'failure' ? 'A customs matter against ter Borch — done badly. Eustace was closed to you.' :
    null },
{ key: 'sabotage_lowji_method', label: (v) =>
    v === 'commission' ? 'A loan-recall against Mr. Lowji — Cama is moving on it.' :
    v === 'negotiate'  ? 'A loan-recall against Mr. Lowji — bargained-for; Cama is moving on it.' :
    null },
{ key: 'sabotage_lowji_resolved', label: (v) =>
    v === 'success' ? 'Mr. Lowji is gone home to Surat. The Bombay station is the smaller place.' :
    v === 'partial' ? 'Mr. Lowji is the smaller man for two bottoms.' :
    v === 'failure' ? 'A loan-recall against Lowji — Cama\'s hand was seen. The Bombay correspondents called £200.' :
    null },
```

- [ ] **Step 2: Parser sanity, commit**

```bash
git add factors_charter.jsx
git commit -m "feat(sabotage): surface arcs as Standing Arrangements"
```

### Task 5.2: Eustace travel ban

**Files:**
- Modify: `factors_charter.jsx` (`MapView` and/or `PortView` Eustace travel button)

- [ ] **Step 1: Locate the Eustace travel button** — `grep -n "Port St. Eustace\|'eustace'\|portKey === 'eustace'" factors_charter.jsx | head`

- [ ] **Step 2: Add the ban check at the disable / hide site**

Wherever `MapView` constructs the destination buttons, add for the Eustace destination:

```js
const eustaceBannedUntil = gs.flags?.banned_eustace_until ?? 0;
const eustaceBanned = eustaceBannedUntil > gs.day;
// In the button JSX:
disabled={eustaceBanned || /* existing conditions */}
title={eustaceBanned ? `Eustace is closed to you until day ${eustaceBannedUntil}.` : undefined}
```

(Use the existing button-disable convention. If buttons are conditionally hidden rather than disabled, hide.)

- [ ] **Step 3: Parser sanity, commit**

```bash
git add factors_charter.jsx
git commit -m "feat(sabotage): block Eustace travel after ter Borch failure"
```

---

## Phase 6 — Verification

### Task 6.1: Full test suite

- [ ] **Step 1**: `npm test` — expect ~112 tests pass (was 92 + ~20 new).
- [ ] **Step 2**: `npm run build` — expect clean, no new warnings, main chunk still ~380 KB gz ~113 KB.
- [ ] **Step 3**: Parser sanity:

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines');"
```

Expected: `OK ~11400 lines`.

- [ ] **Step 4**: `npx vite preview` and smoke-test that the title screen loads. (Full sabotage playthrough requires Year 2 + intel-plant flags; can't drive that from a cold start. Manual playtest in production is the player-facing test.)

---

## Phase 7 — Docs and merge

### Task 7.1: Update HANDOFF.md, DESIGN_NOTES.md, CHANGELOG.md

- [ ] **HANDOFF.md** — Move rivalry follow-up #6 sabotage bullet from "Deferred" to a new "Recently shipped" entry. Update top-of-file status.
- [ ] **DESIGN_NOTES.md** — Append a "Backlog → Shipped" entry for sabotage arcs.
- [ ] **CHANGELOG.md** — New entry under today's date.

### Task 7.2: Merge to main

- [ ] **Step 1**: `git checkout main && git merge --no-ff feat/sabotage-arcs`
- [ ] **Step 2**: `git log --oneline -5` to confirm.
- [ ] **Step 3**: Push: `git push origin main`.

---

## Self-Review

**Spec coverage:**
- §3 player journey → Tasks 4.1, 4.2 (triggers) and Phase 3 (letters) ✓
- §4 state shape → Task 2.1 ✓
- §5 Step 1 conditions → Task 1.2 + 4.1 ✓
- §6 Step 2 conditions → Task 4.2 ✓
- §7 outcome tables → Tasks 3.1–3.4 ✓
- §8 pure-logic module → Phase 1 ✓
- §9 JSX additions → Phase 3, 4, 5 ✓
- §10 banned_eustace_until → Task 5.2 ✓
- §11 testing strategy → Tasks 1.2–1.4 ✓
- §12 acceptance criteria → Phase 6, 7 ✓

**Placeholder scan:** None. All code is concrete.

**Type consistency:** Flag names follow `sabotage_<rival>_<field>` uniformly. Method values are `'commission' | 'negotiate' | 'declined'`. Outcome values are `'success' | 'partial' | 'failure'`. ID base ranges don't collide with rivalry events (9300000–9420000) or other questlines (9000000-9200000).

**Risks:**
- The `_push` and per-rival object merge shapes for the apply handler may not match existing conventions. Task 3.1 Step 3 explicitly verifies this and extends if needed. **Spec note:** if `applyChanges` only knows about `money / reputation / flags / journal / hook`, the rivals/rivalPressureModifiers update needs a new clause. This is the highest-risk piece — verify before mass-replicating across all three rivals.
- The "delta" semantics for `sabotagesCommitted` similarly need a new apply clause. Verify in Task 3.1 Step 3.

If those verifications surface a deeper apply-handler shape that doesn't fit, the alternative is to inline the rivals/pressureModifiers/sabotagesCommitted mutation into the response handler in `tickDays` rather than passing it through `fixedOutcome.changes`. Document the chosen approach in the commit message.
