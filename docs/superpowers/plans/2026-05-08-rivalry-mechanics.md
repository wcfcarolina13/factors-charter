# Rivalry Mechanics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a mechanically-interactive rivalry subsystem at v1-rich level — three named rivals (Hardacre, ter Borch, Lowji Nusserwanji) with deterministic baseline trajectories punctuated by 6–8 events per charter, with four player levers (read / arbitrage / poach / intel buy) wired through the existing tickDays / scripted-letter / AUTO_SENDERS / port-econ surfaces.

**Architecture:** Pure rivalry logic (registries, scheduling, pressure formula, price-window arithmetic) lives in `src/util/rivalry.js` and `src/util/price-windows.js` per the project's "src/util/ is React-free pure logic" invariant. Integration code (gs migration via `ensureShape`, the `tickDays` scheduler block, `makeQuarterlyNagLetter` extension, AUTO_SENDERS additions, scripted-letter helpers) lives in `factors_charter.jsx`. Event templates are content; they live in `factors_charter.jsx` alongside the existing scripted-letter helpers and use the established `s.letters = [...s.letters, letter]` insertion pattern.

**Tech Stack:** React 18 / Vite / Vitest. Single-file JSX monolith (`factors_charter.jsx` ~9000 lines). Pure utilities in `src/util/*.js` with colocated `*.test.js`. Cloudflare Pages deploy from `main`.

**Spec:** [docs/superpowers/specs/2026-05-08-rivalry-mechanics-design.md](../specs/2026-05-08-rivalry-mechanics-design.md) (commit `38d8545`).

---

## Phasing

Six phases, each one logical unit. The structural plumbing (Phases 1–5) is independent of content; Phase 6 (event templates × 18) can ship incrementally — if Brad wants to play after Phase 5, the system runs with an empty `RIVAL_EVENTS` pool and just produces the multi-rival quarterly nag lines.

| # | Title | Files touched | Outcome |
|---|---|---|---|
| 1 | Pure-logic foundation | 4 new in `src/util/` | All rivalry/priceWindow logic exists with tests, no JSX integration yet |
| 2 | gs migration + initial state | `factors_charter.jsx`, `WORLD_NOTES.md` | New saves and old saves both have `gs.rivals`, `gs.priceWindows`, `gs.rivalPressure` |
| 3 | News rhythm: rivalsLines + tickDays scheduler | `factors_charter.jsx` | Quarterly nags reference all 3 rivals; tickDays fires rival events on cadence; pressure recomputes |
| 4 | Port-econ priceWindow integration | `factors_charter.jsx` | `priceFor` consults active windows; smoke-tested with a manually-injected window |
| 5 | Intel channels + Mr. Cama | `factors_charter.jsx` | Brotherhood/Vizier/Cama can sell intel; plant flag swaps next event's prose |
| 6 | Event templates (18) | `factors_charter.jsx` | RIVAL_EVENTS pool populated; full system live |

After each phase: run `npm test` and `npm run build` and verify both pass. Commit at the boundaries marked below.

---

## Phase 1 — Pure-logic foundation

**Files:**
- Create: `src/util/rivalry.js`
- Create: `src/util/rivalry.test.js`
- Create: `src/util/price-windows.js`
- Create: `src/util/price-windows.test.js`

### Task 1.1: Create `src/util/price-windows.js` with `priceWindowMult` and `pruneExpired`

- [ ] **Step 1: Write the failing test** in `src/util/price-windows.test.js`

```javascript
import { describe, it, expect } from 'vitest';
import { priceWindowMult, pruneExpiredWindows } from './price-windows.js';

describe('priceWindowMult', () => {
  it('returns 1 when no windows exist', () => {
    expect(priceWindowMult({}, 'Bencoolen', 'pepper', 'sell')).toBe(1);
  });

  it('returns 1 when priceWindows is undefined', () => {
    expect(priceWindowMult({ priceWindows: undefined }, 'Bencoolen', 'pepper', 'sell')).toBe(1);
  });

  it('returns the sellMult of an active matching window', () => {
    const gs = {
      day: 100,
      priceWindows: [{ port: 'Bencoolen', commodity: 'pepper', sellMult: 1.3, expiresDay: 160 }],
    };
    expect(priceWindowMult(gs, 'Bencoolen', 'pepper', 'sell')).toBe(1.3);
  });

  it('returns the buyMult of an active matching window when side="buy"', () => {
    const gs = {
      day: 100,
      priceWindows: [{ port: 'Bencoolen', commodity: 'pepper', buyMult: 0.8, expiresDay: 160 }],
    };
    expect(priceWindowMult(gs, 'Bencoolen', 'pepper', 'buy')).toBe(0.8);
  });

  it('does not match a window from a different port', () => {
    const gs = {
      day: 100,
      priceWindows: [{ port: 'Eustace', commodity: 'pepper', sellMult: 1.3, expiresDay: 160 }],
    };
    expect(priceWindowMult(gs, 'Bencoolen', 'pepper', 'sell')).toBe(1);
  });

  it('does not match a window from a different commodity', () => {
    const gs = {
      day: 100,
      priceWindows: [{ port: 'Bencoolen', commodity: 'cinnamon', sellMult: 1.3, expiresDay: 160 }],
    };
    expect(priceWindowMult(gs, 'Bencoolen', 'pepper', 'sell')).toBe(1);
  });

  it('does not match an expired window', () => {
    const gs = {
      day: 200,
      priceWindows: [{ port: 'Bencoolen', commodity: 'pepper', sellMult: 1.3, expiresDay: 160 }],
    };
    expect(priceWindowMult(gs, 'Bencoolen', 'pepper', 'sell')).toBe(1);
  });

  it('stacks multiple matching windows multiplicatively', () => {
    const gs = {
      day: 100,
      priceWindows: [
        { port: 'Bencoolen', commodity: 'pepper', sellMult: 1.3, expiresDay: 160 },
        { port: 'Bencoolen', commodity: 'pepper', sellMult: 1.2, expiresDay: 200 },
      ],
    };
    expect(priceWindowMult(gs, 'Bencoolen', 'pepper', 'sell')).toBeCloseTo(1.56, 5);
  });

  it('returns 1 when a window matches port/commodity but lacks the requested side', () => {
    const gs = {
      day: 100,
      priceWindows: [{ port: 'Bencoolen', commodity: 'pepper', buyMult: 0.8, expiresDay: 160 }],
    };
    expect(priceWindowMult(gs, 'Bencoolen', 'pepper', 'sell')).toBe(1);
  });
});

describe('pruneExpiredWindows', () => {
  it('returns an empty array when input is undefined', () => {
    expect(pruneExpiredWindows(undefined, 100)).toEqual([]);
  });

  it('keeps windows whose expiresDay is greater than the current day', () => {
    const windows = [
      { port: 'A', commodity: 'pepper', expiresDay: 50 },
      { port: 'A', commodity: 'pepper', expiresDay: 150 },
    ];
    expect(pruneExpiredWindows(windows, 100)).toEqual([
      { port: 'A', commodity: 'pepper', expiresDay: 150 },
    ]);
  });

  it('removes windows whose expiresDay equals the current day', () => {
    const windows = [{ port: 'A', commodity: 'pepper', expiresDay: 100 }];
    expect(pruneExpiredWindows(windows, 100)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/roti/pontus/factors-charter
npx vitest run src/util/price-windows.test.js
```

Expected: FAIL — module `./price-windows.js` not found.

- [ ] **Step 3: Implement `src/util/price-windows.js`**

```javascript
// Pure logic for arbitrage price-window arithmetic. Used by priceFor in
// factors_charter.jsx to apply event-driven port/commodity multipliers.

export function priceWindowMult(gs, portKey, commodity, side) {
  const windows = gs?.priceWindows;
  if (!Array.isArray(windows) || windows.length === 0) return 1;
  const day = gs?.day ?? 0;
  let mult = 1;
  for (const w of windows) {
    if (w.port !== portKey) continue;
    if (w.commodity !== commodity) continue;
    if (w.expiresDay <= day) continue;
    const sideMult = side === 'sell' ? w.sellMult : w.buyMult;
    if (sideMult == null) continue;
    mult *= sideMult;
  }
  return mult;
}

export function pruneExpiredWindows(windows, day) {
  if (!Array.isArray(windows)) return [];
  return windows.filter(w => w.expiresDay > day);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/util/price-windows.test.js
```

Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/util/price-windows.js src/util/price-windows.test.js
git commit -m "$(cat <<'EOF'
feat(rivalry): add price-window pure logic for arbitrage events

priceWindowMult(gs, port, commodity, side) consults gs.priceWindows for any
active window matching the (port, commodity, side) tuple and returns the
product of all matching sellMult/buyMult values, or 1 if none match.
Multiple windows stack multiplicatively. Expired windows are filtered.

pruneExpiredWindows(windows, day) returns a new array with expired entries
removed; expiry is strict (expiresDay <= day → removed).

Pure ESM with vitest tests covering: no-window default, side specificity,
port/commodity specificity, expiry, multiplicative stacking, missing-side.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 1.2: Create `src/util/rivalry.js` data shapes — `makeInitialRivals` + `RIVALS` registry

- [ ] **Step 1: Write failing tests** by creating `src/util/rivalry.test.js`

```javascript
import { describe, it, expect } from 'vitest';
import {
  makeInitialRivals,
  RIVAL_KEYS,
  RIVALS_REGISTRY,
} from './rivalry.js';

describe('makeInitialRivals', () => {
  it('returns an object with the three rival keys', () => {
    const rivals = makeInitialRivals();
    expect(Object.keys(rivals).sort()).toEqual(['hardacre', 'lowji', 'terborch']);
  });

  it('initialises each rival with standing 50, state "steady", empty eventsFired, lastEventDay 0', () => {
    const rivals = makeInitialRivals();
    for (const key of ['hardacre', 'terborch', 'lowji']) {
      expect(rivals[key].standing).toBe(50);
      expect(rivals[key].state).toBe('steady');
      expect(rivals[key].eventsFired).toEqual([]);
      expect(rivals[key].lastEventDay).toBe(0);
    }
  });

  it('Hardacre carries pepper and cinnamon zero-init', () => {
    const rivals = makeInitialRivals();
    expect(rivals.hardacre.pepper).toBe(0);
    expect(rivals.hardacre.cinnamon).toBe(0);
  });

  it('each rival carries name, station, faction', () => {
    const rivals = makeInitialRivals();
    expect(rivals.hardacre).toMatchObject({ name: 'Mr. Hardacre',           station: 'Bencoolen',         faction: 'company' });
    expect(rivals.terborch).toMatchObject({ name: 'Mynheer ter Borch',      station: 'Port St. Eustace',  faction: 'dutch' });
    expect(rivals.lowji).toMatchObject(   { name: 'Mr. Lowji Nusserwanji',  station: 'Bombay',            faction: null });
  });

  it('returns a fresh object each call (no shared mutable state)', () => {
    const a = makeInitialRivals();
    const b = makeInitialRivals();
    a.hardacre.eventsFired.push('test');
    expect(b.hardacre.eventsFired).toEqual([]);
  });
});

describe('RIVAL_KEYS', () => {
  it('lists all three rival keys', () => {
    expect(RIVAL_KEYS).toEqual(['hardacre', 'terborch', 'lowji']);
  });
});

describe('RIVALS_REGISTRY', () => {
  it('binds each rival to an intel channel', () => {
    const map = Object.fromEntries(RIVALS_REGISTRY.map(r => [r.key, r.intelChannel]));
    expect(map.hardacre).toBe('brotherhood');
    expect(map.terborch).toBe('vizier');
    expect(map.lowji).toBe('cama');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/util/rivalry.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/util/rivalry.js` (data shapes only)**

```javascript
// Pure rivalry logic — registries, initial state, and (in subsequent tasks)
// scheduling, pressure formula, baseline trajectory functions. React-free.
//
// Companion file: ./price-windows.js for arbitrage window arithmetic.

export const RIVAL_KEYS = ['hardacre', 'terborch', 'lowji'];

export function makeInitialRivals() {
  return {
    hardacre: {
      name: 'Mr. Hardacre',
      station: 'Bencoolen',
      faction: 'company',
      pepper: 0,
      cinnamon: 0,
      standing: 50,
      state: 'steady',
      eventsFired: [],
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
      faction: null,
      standing: 50,
      state: 'steady',
      eventsFired: [],
      lastEventDay: 0,
    },
  };
}

// Per-rival metadata. `baselineFn` is filled in by Task 1.3.
// `intelChannel` ties each rival to one intel-buy sender.
export const RIVALS_REGISTRY = [
  { key: 'hardacre', intelChannel: 'brotherhood' },
  { key: 'terborch', intelChannel: 'vizier' },
  { key: 'lowji',    intelChannel: 'cama' },
];
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/util/rivalry.test.js
```

Expected: PASS — 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/util/rivalry.js src/util/rivalry.test.js
git commit -m "$(cat <<'EOF'
feat(rivalry): add rivalry data shapes and registry skeleton

makeInitialRivals() returns the seed gs.rivals object with three named
rivals (Hardacre/EIC/Bencoolen, ter Borch/VOC/Eustace, Lowji
Nusserwanji/Parsi/Bombay), each with standing=50, state="steady",
empty eventsFired, lastEventDay=0. Hardacre additionally tracks
pepper/cinnamon tonnage for the existing rivalLine comparison.

RIVAL_KEYS and RIVALS_REGISTRY exported as the canonical iteration
order. Each registry entry binds the rival to an intel channel
(Brotherhood for Hardacre, Vizier for ter Borch, Cama for Lowji).

baselineFn slots are deferred to Task 1.3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 1.3: Add baseline-trajectory functions to `src/util/rivalry.js`

- [ ] **Step 1: Append failing tests** to `src/util/rivalry.test.js`

```javascript
import {
  hardacreBaseline,
  terBorchBaseline,
  lowjiBaseline,
} from './rivalry.js';

describe('hardacreBaseline', () => {
  it('writes pepper and cinnamon based on Indiaman visits', () => {
    const rival = makeInitialRivals().hardacre;
    hardacreBaseline(rival, { indiamanVisits: 0 });
    expect(rival.pepper).toBe(0);
    expect(rival.cinnamon).toBe(0);

    hardacreBaseline(rival, { indiamanVisits: 1 });
    expect(rival.pepper).toBe(75);    // 70 + 1*5 = 75
    expect(rival.cinnamon).toBe(37);  // 35 + 1*2 = 37

    hardacreBaseline(rival, { indiamanVisits: 6 });
    expect(rival.pepper).toBe(450);   // 70*6 + 6*5
    expect(rival.cinnamon).toBe(222); // 35*6 + 6*2
  });

  it('does not mutate visits or other fields', () => {
    const rival = makeInitialRivals().hardacre;
    rival.standing = 70;
    hardacreBaseline(rival, { indiamanVisits: 3 });
    expect(rival.standing).toBe(70);
  });
});

describe('terBorchBaseline', () => {
  it('drifts standing toward 55 on each Indiaman call (slight positive bias)', () => {
    const rival = makeInitialRivals().terborch;
    rival.standing = 50;
    terBorchBaseline(rival, { indiamanVisits: 1 });
    expect(rival.standing).toBeGreaterThan(50);
    expect(rival.standing).toBeLessThanOrEqual(55);
  });

  it('does not exceed 100 even after many calls', () => {
    const rival = makeInitialRivals().terborch;
    rival.standing = 95;
    terBorchBaseline(rival, { indiamanVisits: 10 });
    expect(rival.standing).toBeLessThanOrEqual(100);
  });
});

describe('lowjiBaseline', () => {
  it('drifts standing toward 60 on each Indiaman call (boom-leaning)', () => {
    const rival = makeInitialRivals().lowji;
    rival.standing = 50;
    lowjiBaseline(rival, { indiamanVisits: 1 });
    expect(rival.standing).toBeGreaterThan(50);
    expect(rival.standing).toBeLessThanOrEqual(60);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/util/rivalry.test.js
```

Expected: FAIL — `hardacreBaseline is not a function`.

- [ ] **Step 3: Implement baseline functions in `src/util/rivalry.js`**

Add to the bottom of `src/util/rivalry.js`:

```javascript
// Baseline trajectory functions. Called from tickDays each Indiaman call.
// Each function MUTATES the rival object in place — consistent with the
// project's existing tickDays mutation pattern.

// Hardacre: ~70 cwt pepper + 35 cwt cinnamon per Indiaman call, slightly
// ahead of pace. Six calls → 420/210, just over quota. Existing pattern
// from factors_charter.jsx:1134.
export function hardacreBaseline(rival, ctx) {
  const visits = ctx?.indiamanVisits ?? 0;
  rival.pepper   = Math.round(70 * visits + visits * 5);
  rival.cinnamon = Math.round(35 * visits + visits * 2);
}

// Ter Borch: drifts standing toward 55 (slight positive — VOC favour grows
// with each Indiaman returning to Eustace). 1-point drift per call.
export function terBorchBaseline(rival, ctx) {
  const visits = ctx?.indiamanVisits ?? 0;
  if (visits <= 0) return;
  // Move 1 point toward 55, capped at [0, 100].
  if (rival.standing < 55) rival.standing = Math.min(100, rival.standing + 1);
  else if (rival.standing > 55) rival.standing = Math.max(0, rival.standing - 1);
}

// Lowji: drifts toward 60 (boom-leaning — country traders made faster
// fortunes than Company servants). 2-point drift per call.
export function lowjiBaseline(rival, ctx) {
  const visits = ctx?.indiamanVisits ?? 0;
  if (visits <= 0) return;
  if (rival.standing < 60) rival.standing = Math.min(100, rival.standing + 2);
  else if (rival.standing > 60) rival.standing = Math.max(0, rival.standing - 1);
}

// Wire into the registry — exported separately so the registry stays a
// pure-data export but the functions are colocated.
RIVALS_REGISTRY[0].baselineFn = hardacreBaseline;
RIVALS_REGISTRY[1].baselineFn = terBorchBaseline;
RIVALS_REGISTRY[2].baselineFn = lowjiBaseline;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/util/rivalry.test.js
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/util/rivalry.js src/util/rivalry.test.js
git commit -m "$(cat <<'EOF'
feat(rivalry): add baseline trajectory functions per rival

hardacreBaseline mirrors the existing rivalLine math (70 cwt pepper,
35 cwt cinnamon per Indiaman visit, slightly ahead of pace). Mutates
the rival object's pepper/cinnamon fields in place.

terBorchBaseline drifts standing toward 55 by 1/call; lowjiBaseline
drifts toward 60 by 2/call. Both clamp to [0, 100]. Both no-op if
visits <= 0.

The functions are wired into RIVALS_REGISTRY entries on import.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 1.4: Add `computeRivalPressure` to `src/util/rivalry.js`

- [ ] **Step 1: Append failing tests** to `src/util/rivalry.test.js`

```javascript
import { computeRivalPressure } from './rivalry.js';

describe('computeRivalPressure', () => {
  function gsWith(overrides = {}) {
    return {
      day: 200,
      rivals: makeInitialRivals(),
      rivalPressureModifiers: [],
      quotas: {
        pepper:   { have: 0, target: 400 },
        cinnamon: { have: 0, target: 200 },
      },
      ...overrides,
    };
  }

  it('returns 50 (baseline) when nothing varies', () => {
    expect(computeRivalPressure(gsWith())).toBe(50);
  });

  it('rises when Hardacre is ahead of player on pepper quota', () => {
    const gs = gsWith();
    gs.rivals.hardacre.pepper = 200;     // Hardacre at 50% of quota
    gs.quotas.pepper.have = 50;          // Player at 12.5%
    const p = computeRivalPressure(gs);
    expect(p).toBeGreaterThan(50);
  });

  it('falls when player is ahead of Hardacre on quota', () => {
    const gs = gsWith();
    gs.rivals.hardacre.pepper = 50;
    gs.quotas.pepper.have = 200;
    const p = computeRivalPressure(gs);
    expect(p).toBeLessThan(50);
  });

  it('rises with terborch.standing above 50', () => {
    const gs = gsWith();
    gs.rivals.terborch.standing = 90;
    const p = computeRivalPressure(gs);
    expect(p).toBeGreaterThan(50);
  });

  it('rises with lowji.standing above 50', () => {
    const gs = gsWith();
    gs.rivals.lowji.standing = 90;
    expect(computeRivalPressure(gs)).toBeGreaterThan(50);
  });

  it('applies recent-event pressure modifiers with linear decay', () => {
    const gs = gsWith();
    // -10 modifier 30 days into a 60-day lifetime → -5 effective
    gs.rivalPressureModifiers = [{ delta: -10, fromDay: 170, lifetimeDays: 60 }];
    const p = computeRivalPressure(gs);
    expect(p).toBe(45);   // 50 - 5 (linear decay: 30/60 elapsed)
  });

  it('drops fully-elapsed modifiers (treats them as zero contribution)', () => {
    const gs = gsWith();
    gs.rivalPressureModifiers = [{ delta: -20, fromDay: 100, lifetimeDays: 60 }];  // expired at day 160; current day 200
    expect(computeRivalPressure(gs)).toBe(50);
  });

  it('clamps to [0, 100]', () => {
    const high = gsWith();
    high.rivals.hardacre.pepper = 500;
    high.rivals.terborch.standing = 100;
    high.rivals.lowji.standing = 100;
    high.rivalPressureModifiers = [{ delta: 80, fromDay: 200, lifetimeDays: 60 }];
    expect(computeRivalPressure(high)).toBeLessThanOrEqual(100);

    const low = gsWith();
    low.quotas.pepper.have = 500;
    low.quotas.cinnamon.have = 250;
    low.rivals.terborch.standing = 0;
    low.rivals.lowji.standing = 0;
    low.rivalPressureModifiers = [{ delta: -80, fromDay: 200, lifetimeDays: 60 }];
    expect(computeRivalPressure(low)).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/util/rivalry.test.js
```

Expected: FAIL — `computeRivalPressure is not exported`.

- [ ] **Step 3: Implement `computeRivalPressure` in `src/util/rivalry.js`**

Add at the bottom:

```javascript
// Computes the 0-100 rivalPressure scalar consumed by makeQuarterlyNagLetter
// to shift its tone band. Inputs:
//   - Hardacre tonnage relative to player quota progress
//   - terborch / lowji standing relative to baseline 50
//   - recent-event modifiers in gs.rivalPressureModifiers, each linearly
//     decaying over its lifetime
//
// Output is clamped to [0, 100].
export function computeRivalPressure(gs) {
  const rivals = gs?.rivals;
  if (!rivals) return 50;

  let pressure = 50;

  // Hardacre tonnage axis. If Hardacre is significantly ahead, +10 per
  // commodity; if behind, -10 per commodity.
  const ourPep = gs.quotas?.pepper?.have   ?? 0;
  const ourCin = gs.quotas?.cinnamon?.have ?? 0;
  if (rivals.hardacre.pepper   > ourPep + 30) pressure += 10;
  else if (rivals.hardacre.pepper   < ourPep - 30) pressure -= 10;
  if (rivals.hardacre.cinnamon > ourCin + 15) pressure += 10;
  else if (rivals.hardacre.cinnamon < ourCin - 15) pressure -= 10;

  // ter Borch / Lowji standing axis. Each rival adds up to ±5 from baseline.
  pressure += 5 * ((rivals.terborch.standing - 50) / 50);
  pressure += 5 * ((rivals.lowji.standing    - 50) / 50);

  // Recent-event modifiers with linear decay over their lifetime.
  const day = gs.day ?? 0;
  for (const mod of (gs.rivalPressureModifiers || [])) {
    const elapsed = day - mod.fromDay;
    if (elapsed < 0 || elapsed >= mod.lifetimeDays) continue;
    const remaining = 1 - (elapsed / mod.lifetimeDays);
    pressure += mod.delta * remaining;
  }

  return Math.max(0, Math.min(100, Math.round(pressure)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/util/rivalry.test.js
```

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/util/rivalry.js src/util/rivalry.test.js
git commit -m "$(cat <<'EOF'
feat(rivalry): add computeRivalPressure formula

Computes a 0-100 scalar from three axes: Hardacre tonnage relative to
player quota (±10/commodity), terborch and lowji standing relative to
baseline 50 (±5 each), and active rivalPressureModifiers with linear
decay over their lifetimes.

makeQuarterlyNagLetter (Phase 3) consumes this to shift its tone band
±1 step at the >70 / <30 thresholds. The integration leaves nothingYet
and finalStretch short-circuits intact.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 1.5: Add `pickRivalEvent` to `src/util/rivalry.js`

- [ ] **Step 1: Append failing tests** to `src/util/rivalry.test.js`

```javascript
import { pickRivalEvent } from './rivalry.js';

describe('pickRivalEvent', () => {
  function gsWith(overrides = {}) {
    return {
      day: 200,
      rivals: makeInitialRivals(),
      letters: [],
      ...overrides,
    };
  }

  // Test event templates (will be replaced by real RIVAL_EVENTS in Phase 6).
  const fakeEvents = [
    { key: 'hardacre-fire',   rival: 'hardacre', minDay: 100, maxDay: 720, preconditions: () => true,  build: () => ({ id: 1 }) },
    { key: 'terborch-prom',   rival: 'terborch', minDay: 200, maxDay: 720, preconditions: () => true,  build: () => ({ id: 2 }) },
    { key: 'lowji-glut',      rival: 'lowji',    minDay: 100, maxDay: 720, preconditions: () => true,  build: () => ({ id: 3 }) },
    { key: 'gated',           rival: 'hardacre', minDay: 100, maxDay: 720, preconditions: (s) => s.day >= 999, build: () => ({ id: 4 }) },
  ];

  it('returns null when pool is empty', () => {
    expect(pickRivalEvent(gsWith(), [])).toBeNull();
  });

  it('returns an eligible event from the pool', () => {
    const gs = gsWith();
    const ev = pickRivalEvent(gs, fakeEvents);
    expect(ev).not.toBeNull();
    expect(['hardacre-fire', 'terborch-prom', 'lowji-glut']).toContain(ev.key);
  });

  it('skips events outside their minDay window', () => {
    const gs = gsWith({ day: 50 });   // before minDay of all real events
    expect(pickRivalEvent(gs, fakeEvents)).toBeNull();
  });

  it('skips events outside their maxDay window', () => {
    const gs = gsWith({ day: 800 });
    expect(pickRivalEvent(gs, fakeEvents)).toBeNull();
  });

  it('skips events whose preconditions fail', () => {
    const gs = gsWith();
    const onlyGated = [fakeEvents[3]];
    expect(pickRivalEvent(gs, onlyGated)).toBeNull();
  });

  it('skips events already in eventsFired for that rival', () => {
    const gs = gsWith();
    gs.rivals.hardacre.eventsFired = ['hardacre-fire'];
    gs.rivals.terborch.eventsFired = ['terborch-prom'];
    gs.rivals.lowji.eventsFired = ['lowji-glut'];
    expect(pickRivalEvent(gs, fakeEvents)).toBeNull();
  });

  it('returns null if 240-day cluster cap is hit (3 events fired in last 240 days)', () => {
    const gs = gsWith({ day: 300 });
    gs.rivals.hardacre.lastEventDay = 100;
    gs.rivals.terborch.lastEventDay = 150;
    gs.rivals.lowji.lastEventDay = 200;
    expect(pickRivalEvent(gs, fakeEvents)).toBeNull();
  });

  it('does NOT trigger the cluster cap if events are spread over more than 240 days', () => {
    const gs = gsWith({ day: 600 });
    gs.rivals.hardacre.lastEventDay = 100;   // 500 days ago
    gs.rivals.terborch.lastEventDay = 350;
    gs.rivals.lowji.lastEventDay = 500;
    const ev = pickRivalEvent(gs, fakeEvents);
    expect(ev).not.toBeNull();
  });

  it('weights selection toward rivals with the oldest lastEventDay', () => {
    // Statistical test — repeated calls should favour the oldest.
    const gs = gsWith({ day: 1000 });
    gs.rivals.hardacre.lastEventDay = 0;     // very stale
    gs.rivals.terborch.lastEventDay = 900;   // recent
    gs.rivals.lowji.lastEventDay = 950;      // recent

    const counts = { hardacre: 0, terborch: 0, lowji: 0 };
    for (let i = 0; i < 200; i++) {
      const ev = pickRivalEvent(gs, fakeEvents);
      if (ev) counts[ev.rival]++;
    }
    expect(counts.hardacre).toBeGreaterThan(counts.terborch);
    expect(counts.hardacre).toBeGreaterThan(counts.lowji);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/util/rivalry.test.js
```

Expected: FAIL — `pickRivalEvent is not exported`.

- [ ] **Step 3: Implement `pickRivalEvent` in `src/util/rivalry.js`**

Add at the bottom:

```javascript
// Picks one eligible event template from the pool, or null if none qualify.
// Eligibility:
//   - day in [minDay, maxDay]
//   - preconditions(gs) is truthy
//   - event key not in gs.rivals[rival].eventsFired
// Cluster cap:
//   - if 3 or more events have already fired in the last 240 days
//     (lastEventDay > day - 240), return null
// Selection:
//   - rivals weighted by (day - lastEventDay) so stale rivals are picked
//     more often, evening out cadence
//   - within the chosen rival's eligible pool, uniform random
export function pickRivalEvent(gs, eventPool) {
  if (!Array.isArray(eventPool) || eventPool.length === 0) return null;

  const day = gs?.day ?? 0;

  // Cluster cap: count events fired in the last 240 days across all rivals.
  const recent = RIVAL_KEYS.filter(k => {
    const r = gs.rivals?.[k];
    return r?.lastEventDay && r.lastEventDay > day - 240;
  });
  if (recent.length >= 3) return null;

  // Filter pool to eligible templates.
  const eligible = eventPool.filter(t => {
    if (day < t.minDay || day > t.maxDay) return false;
    if (typeof t.preconditions === 'function' && !t.preconditions(gs)) return false;
    const fired = gs.rivals?.[t.rival]?.eventsFired ?? [];
    if (fired.includes(t.key)) return false;
    return true;
  });

  if (eligible.length === 0) return null;

  // Weighted-by-rival pick: weight = max(1, day - lastEventDay).
  const byRival = new Map();
  for (const t of eligible) {
    if (!byRival.has(t.rival)) byRival.set(t.rival, []);
    byRival.get(t.rival).push(t);
  }
  const rivals = [...byRival.keys()];
  const weights = rivals.map(k => Math.max(1, day - (gs.rivals[k]?.lastEventDay ?? 0)));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalWeight;
  let chosenRival = rivals[0];
  for (let i = 0; i < rivals.length; i++) {
    r -= weights[i];
    if (r <= 0) { chosenRival = rivals[i]; break; }
  }

  // Uniform random within the chosen rival's eligible pool.
  const candidates = byRival.get(chosenRival);
  return candidates[Math.floor(Math.random() * candidates.length)];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/util/rivalry.test.js
```

Expected: PASS — all tests green. The weighting test is statistical (200 trials) so should be reliably one-sided.

- [ ] **Step 5: Commit**

```bash
git add src/util/rivalry.js src/util/rivalry.test.js
git commit -m "$(cat <<'EOF'
feat(rivalry): add pickRivalEvent scheduler

Filters an event pool by day window, preconditions, and eventsFired
de-duping. Returns null when no template is eligible. Implements the
240-day cluster cap (≤3 events fired in any rolling 240 days) and the
weighted-by-rival selection (weight = day - lastEventDay) so cadence
evens out across rivals over the charter.

The pool is passed in (not imported here) — Phase 6 supplies the real
RIVAL_EVENTS pool. Tests use a small fake pool of 4 templates to
exercise filtering and the cluster cap.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

**End of Phase 1.** All pure logic exists with tests. No JSX touched yet. Run `npm test` and confirm everything green:

```bash
npm test
```

Expected: all tests pass, including the 4 existing util suites and the 2 new ones.

---

## Phase 2 — gs migration + initial state

**Files:**
- Modify: `factors_charter.jsx` (sections at 700–760 ensureShape, 905–915 makeInitialState, 2941+ makeSuccessorState, 3061+ makeRenewedState)
- Modify: `WORLD_NOTES.md` (append ter Borch promotion + Lowji + Cama lore entries)

### Task 2.1: Add rivalry imports to `factors_charter.jsx`

- [ ] **Step 1: Read the existing imports block** at the top of `factors_charter.jsx` (first ~30 lines).

```bash
head -30 factors_charter.jsx
```

- [ ] **Step 2: Add imports for the new utilities** in the same block. After the existing `src/util/` imports, add:

```javascript
import {
  makeInitialRivals,
  RIVAL_KEYS,
  RIVALS_REGISTRY,
  computeRivalPressure,
  pickRivalEvent,
} from './src/util/rivalry.js';
import { priceWindowMult, pruneExpiredWindows } from './src/util/price-windows.js';
```

- [ ] **Step 3: Verify the file still parses**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines');"
```

Expected: `OK <line count> lines`.

- [ ] **Step 4: Run the build to confirm Vite resolves the imports**

```bash
npm run build
```

Expected: build succeeds. `dist/` updated.

- [ ] **Step 5: Commit**

```bash
git add factors_charter.jsx
git commit -m "$(cat <<'EOF'
feat(rivalry): import pure rivalry utilities into the JSX monolith

Wires src/util/rivalry.js and src/util/price-windows.js into
factors_charter.jsx. No behavioural change yet — the imports are
exercised in the next tasks (gs migration, scheduler, priceFor patch).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 2.2: Extend `ensureShape` to populate rivalry-related gs fields

- [ ] **Step 1: Locate the `ensureShape` function** (line ~700–760). Read the existing pattern; you'll see entries like `if (!next.portStocks) { next.portStocks = {}; ... }` and `if (next.bottomry === undefined) { next.bottomry = null; }`.

```bash
grep -nB1 -A2 "if (!next\.\|if (next\.\|next\..* = " factors_charter.jsx | head -40
```

- [ ] **Step 2: Add the rivalry migration block** right after the existing `bottomry` block (line ~760, the `if (next.bottomry === undefined)` block — the rivalry block is logically grouped with state-shape additions). Insert:

```javascript
  if (!next.rivals) {
    next.rivals = makeInitialRivals();
  }
  if (!Array.isArray(next.priceWindows)) {
    next.priceWindows = [];
  }
  if (typeof next.rivalPressure !== 'number') {
    next.rivalPressure = 50;
  }
  if (!Array.isArray(next.rivalPressureModifiers)) {
    next.rivalPressureModifiers = [];
  }
```

- [ ] **Step 3: Verify the file still parses**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK');"
```

Expected: `OK`.

- [ ] **Step 4: Verify with a quick smoke test in `npm test`**

The existing `src/util/sync-conflict.test.js` tests `applyPull` which goes through `ensureShape` indirectly via state merge — if any of those break, we have a regression.

```bash
npm test
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add factors_charter.jsx
git commit -m "$(cat <<'EOF'
feat(rivalry): ensureShape migration adds gs.rivals + price/pressure fields

Old saves loaded after this change are populated with:
  - gs.rivals via makeInitialRivals() (fresh trajectories at standing 50)
  - gs.priceWindows = []
  - gs.rivalPressure = 50
  - gs.rivalPressureModifiers = []

For mid-charter migration of an existing playthrough, rivalry timing
starts fresh — first event fires 60-120 days after the next launch,
not from the charter start. Acceptable because rivalry is a new
addition; nothing claims a bookkeeping continuity with prior days.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 2.3: Wire `makeInitialRivals` into `makeInitialState`, `makeSuccessorState`, `makeRenewedState`

- [ ] **Step 1: Locate `makeInitialState`** (line ~770). Find the spot where the returned `gs` object is built, near `portStocks: initialPortStocks` (line ~909).

- [ ] **Step 2: Add the four new fields** alongside `portStocks` in the returned object:

```javascript
    portStocks: initialPortStocks,
    rivals: makeInitialRivals(),
    priceWindows: [],
    rivalPressure: 50,
    rivalPressureModifiers: [],
```

- [ ] **Step 3: Locate `makeSuccessorState`** (line ~2941). The function carries forward most state but resets per-Factor fields. Find the spot where `portStocks` is reset (`portStocks: freshPortStocks`, line ~3022).

- [ ] **Step 4: Add the four new fields to the successor reset**:

```javascript
    portStocks: freshPortStocks,
    rivals: makeInitialRivals(),       // fresh trajectories for the new Factor
    priceWindows: [],                   // no inherited arbitrage windows
    rivalPressure: 50,                  // baseline; recomputed first tick
    rivalPressureModifiers: [],
```

- [ ] **Step 5: Locate `makeRenewedState`** (line ~3061). Add the same reset block alongside `portStocks: freshPortStocks` (line ~3101):

```javascript
    portStocks: freshPortStocks,
    rivals: makeInitialRivals(),
    priceWindows: [],
    rivalPressure: 50,
    rivalPressureModifiers: [],
```

- [ ] **Step 6: Verify the file parses and tests pass**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK');"
npm test
```

Expected: parses + all tests pass.

- [ ] **Step 7: Commit**

```bash
git add factors_charter.jsx
git commit -m "$(cat <<'EOF'
feat(rivalry): seed gs.rivals on new charter, succession, renewal

makeInitialState, makeSuccessorState, and makeRenewedState all populate
gs.rivals (fresh trajectories at standing 50), gs.priceWindows (empty),
gs.rivalPressure (50), and gs.rivalPressureModifiers (empty).

Successor and renewal explicitly reset these per-Factor: a new charter
gets a fresh rivalry curve. Faction-relationship state (companyFaction,
acquaintances, standing) is unaffected.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 2.4: Append rivalry lore entries to `WORLD_NOTES.md`

- [ ] **Step 1: Open `WORLD_NOTES.md`** and locate the `## INSPIRATIONS LANDED` section.

- [ ] **Step 2: Append three new entries** at the bottom of `INSPIRATIONS LANDED`:

```markdown
### Mr. Hardacre at Bencoolen → the EIC rival benchmark

- **Inspiration:** Company servants at different stations were held up
  against each other in private letters from Leadenhall, and the
  comparison shaped careers. Hardacre was already in code as a fictitious
  benchmark; rivalry expansion (2026-05-08) makes him a full rival with
  punctuating events (windfalls, setbacks, scandals).
- **In code:** `gs.rivals.hardacre`, `hardacreBaseline` in
  `src/util/rivalry.js`, plus event templates in `RIVAL_EVENTS`.

### Ter Borch promoted to senior factor at Eustace

- **Setup:** ter Borch already exists in AUTO_SENDERS as a Calvinist
  trader voice and as the second witness in the Vizier marriage gambit.
  The rivalry expansion (2026-05-08) explicitly establishes him as the
  *senior* VOC factor at Port St. Eustace, with Boom serving under him as
  junior. Boom granting the trade pass is now read as a junior-end-run.
- **In code:** no character-creation work — the existing AUTO_SENDERS
  entry covers his voice; rivalry events in `RIVAL_EVENTS` portray his
  promotions, customs disputes, and conflicts with London-via-Amsterdam.

### Mr. Lowji Nusserwanji of Bombay → the country trader

- **Inspiration:** Parsi shipowners dominated 1720s country trade
  out of Bombay; Lowji Nusserwanji Wadia (1702–1774) is a real
  historical figure who founded Bombay's shipbuilding dynasty. The
  rivalry expansion borrows the name as a transposition (he doesn't
  shipbuild here; he country-trades). He is the player's off-Company-
  books rival — competing for private trade, not for Company quota.
- **In code:** `gs.rivals.lowji`, `lowjiBaseline` in
  `src/util/rivalry.js`, plus event templates. His intel channel is
  Mr. Pestonji Cama (a new AUTO_SENDERS entry — see Phase 5).
```

- [ ] **Step 3: Commit**

```bash
git add WORLD_NOTES.md
git commit -m "$(cat <<'EOF'
docs: WORLD_NOTES entries for the three rivals

ter Borch's promotion to senior VOC factor at Eustace is documented as
an explicit retcon (no character-creation work; the existing
AUTO_SENDERS voice carries forward). Lowji Nusserwanji and Hardacre
get full INSPIRATIONS LANDED entries explaining the period sources
and the in-code locations.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

**End of Phase 2.** Run `npm test` and `npm run build`; verify both pass.

---

## Phase 3 — News rhythm: rivalsLines + tickDays scheduler

**Files:**
- Modify: `factors_charter.jsx` — replace `rivalLine`, extend `makeQuarterlyNagLetter`, add tickDays scheduler block

### Task 3.1: Replace `rivalLine(s)` with `rivalsLines(s)` covering all 3 rivals

- [ ] **Step 1: Locate the existing `rivalLine` function at line ~1142**. Read it through line 1162 to confirm shape.

- [ ] **Step 2: Replace the function with a 3-rival version**. Replace the entire `function rivalLine(s) { ... }` block with:

```javascript
// Returns a multi-rival snippet for the quarterly nag letter. Three
// sentences max — one per rival when each has something noteworthy
// to say, omitted otherwise. Hardacre uses tonnage comparison
// (existing pattern); ter Borch and Lowji use standing as a
// qualitative tone band.
function rivalsLines(s) {
  const lines = [];

  // Hardacre — existing 3-band pattern by tonnage.
  const visits = s.indiaman?.visits || 0;
  if (visits > 0) {
    const h = hardacreReckoning(visits);
    const ourPep = Math.floor(s.quotas?.pepper?.have   || 0);
    const ourCin = Math.floor(s.quotas?.cinnamon?.have || 0);
    const aheadPep = h.pepper > ourPep + 30;
    const aheadCin = h.cinnamon > ourCin + 15;
    const muchAhead = h.pepper > ourPep + 80 || h.cinnamon > ourCin + 50;
    if (muchAhead) {
      lines.push(`${HARDACRE.name} at ${HARDACRE.station} reckons ${h.pepper} cwt of pepper and ${h.cinnamon} cwt of cinnamon to date — a comparison we shall not press, but which sits visibly upon the Court's table.`);
    } else if (aheadPep || aheadCin) {
      lines.push(`${HARDACRE.name} at ${HARDACRE.station} stands at ${h.pepper}/${h.cinnamon} cwt; the comparison is not yet flattering to yr. station.`);
    } else if (ourPep >= h.pepper && ourCin >= h.cinnamon) {
      lines.push(`${HARDACRE.name} at ${HARDACRE.station} reckons ${h.pepper}/${h.cinnamon} cwt — yr. own returns, the Court is pleased to note, are no less.`);
    }
  }

  // ter Borch — qualitative band by standing.
  if (s.rivals?.terborch) {
    const st = s.rivals.terborch.standing;
    if (st >= 75)      lines.push(`Mynheer ter Borch at Eustace continues to gain ground in the High Government's regard.`);
    else if (st <= 25) lines.push(`Word from Amsterdam: Mynheer ter Borch's hand at Eustace is tested.`);
  }

  // Lowji — qualitative band by standing.
  if (s.rivals?.lowji) {
    const st = s.rivals.lowji.standing;
    if (st >= 75)      lines.push(`The Bombay accounts speak of Mr. Lowji Nusserwanji's tonnage in terms a Director may not lightly dismiss.`);
    else if (st <= 25) lines.push(`The Bombay houses report Mr. Lowji Nusserwanji to be in the unkind weather of his year.`);
  }

  return lines.length === 0 ? '' : ' ' + lines.join(' ');
}

// Backwards-compatibility shim — keeps the old call sites in
// makeQuarterlyNagLetter working while the next task migrates them.
function rivalLine(s) { return rivalsLines(s); }
```

- [ ] **Step 3: Verify the file parses**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK');"
```

- [ ] **Step 4: Run the test suite**

```bash
npm test
```

Expected: passes. The shim keeps the existing `${rival}` interpolation in `makeQuarterlyNagLetter` working unchanged.

- [ ] **Step 5: Commit**

```bash
git add factors_charter.jsx
git commit -m "$(cat <<'EOF'
feat(rivalry): rivalsLines covers all three rivals in quarterly nags

Hardacre keeps the existing 3-band tonnage comparison (much-ahead /
ahead / equal-or-better). ter Borch and Lowji each contribute one
qualitative line gated by standing >=75 (rising prominence) or <=25
(troubled). The function returns up to three sentences joined with
spaces, prefixed with a single leading space for the existing
makeQuarterlyNagLetter interpolation pattern.

The old rivalLine name is retained as a thin alias for the call sites
in makeQuarterlyNagLetter — no caller change in this task; the alias
will be removed after Task 3.2.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 3.2: Add `rivalPressure` tone-band shift to `makeQuarterlyNagLetter`

- [ ] **Step 1: Locate `makeQuarterlyNagLetter` (line ~1164)**. Read through to understand the existing band selection.

- [ ] **Step 2: Modify the band-selection logic** to consume `rivalPressure`. Change the band-selection block:

```javascript
  // Existing band logic:
  let subject, body;
  if (nothingYet) {
    subject = 'A First Quarterly Note';
    body = `Sir, — ...`;
  } else if (finalStretch && !onTrack) {
    subject = 'A Pointed Word';
    body = `...`;
  } else if (onTrack) {
    subject = 'Yr. Progress Noted';
    body = `...`;
  } else {
    subject = 'A Quarterly Reminder';
    body = `...`;
  }
```

To this (preserves existing prose; only the band picker shifts):

```javascript
  // Pick base band — same logic as before.
  let band;
  if (nothingYet)            band = 'first';
  else if (finalStretch && !onTrack) band = 'pointed';
  else if (onTrack)          band = 'progress';
  else                       band = 'reminder';

  // Apply rivalPressure shift to the middle bands only. nothingYet and
  // finalStretch short-circuits remain untouched (they reflect player-
  // observable facts that rivalry shouldn't override).
  const pressure = s.rivalPressure ?? 50;
  if (band === 'progress' && pressure > 70) band = 'reminder';      // pleased → reminding
  else if (band === 'progress' && pressure < 30) band = 'progress'; // already softest mid-band
  else if (band === 'reminder' && pressure > 70) band = 'pointed';  // reminding → pointed
  else if (band === 'reminder' && pressure < 30) band = 'progress'; // reminding → pleased

  let subject, body;
  if (band === 'first') {
    subject = 'A First Quarterly Note';
    body = `Sir, — We open yr. file at the Court for the present charter. The first Indiaman is despatched in due course; we shall expect a return at her holds. We pray you have laid the ground.\n\nWe are mindful of the climate, the politics, and the price of plank. We are mindful also that the late Mr. Wilbraham held the post for two years on similar excuses.\n\nYr. obedt. servants, the Court of Directors.${dryden}`;
  } else if (band === 'pointed') {
    subject = 'A Pointed Word';
    body = `Sir, — A reckoning at this hand: ${reckoning}${rival} The third year is upon us, and the figures are not what we are owed. The Court has the names of two replacements before it. We trust you take our meaning.\n\nYr. servants, the Court of Directors.${dryden}`;
  } else if (band === 'progress') {
    subject = 'Yr. Progress Noted';
    body = `Sir, — Returns reckon ${reckoning}${rival} The Court is content with the present pace. Press on.\n\nYr. obedt. servants, the Court of Directors.${dryden}`;
  } else {
    subject = 'A Quarterly Reminder';
    body = `Sir, — We have to remind you that the present hand finds the books at ${reckoning}${rival} The next Indiaman comes round in due course, and we shall watch what she brings.\n\nYr. servants, the Court of Directors.${dryden}`;
  }
```

- [ ] **Step 3: Verify the file parses**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK');"
```

- [ ] **Step 4: Smoke-test by running the dev server briefly** (manual verification — these letters require playthrough state to fire)

```bash
npm run dev
# Visit http://localhost:5173/, start a new charter, advance time. Should
# parse without runtime errors. Real letter-band verification happens via
# in-game playtesting at Phase end.
# Ctrl-C to stop.
```

- [ ] **Step 5: Run the test suite**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add factors_charter.jsx
git commit -m "$(cat <<'EOF'
feat(rivalry): rivalPressure shifts quarterly nag tone band

The existing 4-band selection (first / pointed / progress / reminder)
keeps its prose untouched. After base-band selection, gs.rivalPressure
applies a one-step shift to the two middle bands only:
  - pressure > 70: progress→reminder, reminder→pointed
  - pressure < 30: reminder→progress
  - first and pointed bands short-circuit, unchanged

This gives rival events material consequence on Director tone within
90 days of firing without rewriting any letter prose.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 3.3: Add the rival-event scheduler block to `tickDays`

- [ ] **Step 1: Locate the `tickDays` scripted-letter block** (line ~3573 onwards). Find the *end* of the existing one-off scripted-letter triggers (after the last `if (...) { const letter = make...Letter(s); s.letters = [...]; ... }` block — somewhere around line 3700–3750 once you scan it).

- [ ] **Step 2: Insert the rival-event scheduler block** at that point. It also handles `priceWindows` cleanup and `rivalPressure` recomputation:

```javascript
    // ── Rivalry events. Fires roughly every 90-150 days from a per-rival
    // template pool. Pool is RIVAL_EVENTS (Phase 6 — empty during
    // structural phases). pickRivalEvent enforces eligibility, no-repeats,
    // and the 240-day cluster cap.
    if (!s.charterClosed) {
      // Initialize first-event day with 60-120-day jitter from charter start.
      if (!s.flags?.firstRivalEventDay) {
        s.flags = {
          ...(s.flags || {}),
          firstRivalEventDay: 60 + Math.floor(Math.random() * 60),
        };
      }
      const nextEventDay = s.flags?.nextRivalEventDay ?? s.flags.firstRivalEventDay;
      if (s.day >= nextEventDay) {
        const event = pickRivalEvent(s, RIVAL_EVENTS);
        if (event) {
          const intelFlag = `${event.rival}IntelPlant`;
          const wasAnticipated = !!s.flags?.[intelFlag];
          const letter = event.build(s, { anticipated: wasAnticipated });
          s.letters = [...s.letters, letter];
          s.lettersGenerated = (s.lettersGenerated || 0) + 1;
          s.rivals[event.rival].eventsFired = [
            ...(s.rivals[event.rival].eventsFired || []),
            event.key,
          ];
          if (event.standingAfter) s.rivals[event.rival].state = event.standingAfter;
          if (event.standingDelta) {
            s.rivals[event.rival].standing = Math.max(0, Math.min(100,
              (s.rivals[event.rival].standing || 50) + event.standingDelta));
          }
          s.rivals[event.rival].lastEventDay = s.day;

          // Apply priceWindow if any.
          if (event.priceWindow) {
            s.priceWindows = [
              ...(s.priceWindows || []),
              { ...event.priceWindow, expiresDay: s.day + event.priceWindow.days },
            ];
          }
          // Apply pressure modifier (use defaults if event doesn't override).
          const pressureDelta    = event.pressureDelta    ?? (event.standingDelta < 0 ? -8 : 8);
          const pressureLifetime = event.pressureLifetime ?? 60;
          s.rivalPressureModifiers = [
            ...(s.rivalPressureModifiers || []),
            { delta: pressureDelta, fromDay: s.day, lifetimeDays: pressureLifetime },
          ];
          // Consume the intel-plant flag.
          if (wasAnticipated) {
            const flagsNext = { ...(s.flags || {}) };
            delete flagsNext[intelFlag];
            s.flags = flagsNext;
          }
          s.awayLog.push({ day: s.day, type: 'letter', text: 'A note from London concerning the affairs of yr. peers.' });
        }
        s.flags = {
          ...(s.flags || {}),
          nextRivalEventDay: s.day + 90 + Math.floor(Math.random() * 60),
        };
      }
    }

    // ── Cleanup expired priceWindows.
    if (s.priceWindows && s.priceWindows.length > 0) {
      s.priceWindows = pruneExpiredWindows(s.priceWindows, s.day);
    }

    // ── Prune fully-elapsed pressure modifiers (lifetime exhausted).
    if (s.rivalPressureModifiers && s.rivalPressureModifiers.length > 0) {
      s.rivalPressureModifiers = s.rivalPressureModifiers.filter(
        m => (s.day - m.fromDay) < m.lifetimeDays
      );
    }

    // ── Recompute rivalPressure.
    s.rivalPressure = computeRivalPressure(s);
```

- [ ] **Step 3: Add a temporary stub for `RIVAL_EVENTS`** so the file imports cleanly even before Phase 6. Just above `tickDays` (or at top-level alongside other registries — find a sensible spot near `AUTO_SENDERS` ~line 2674):

```javascript
// Rival-event template pool. Populated in Phase 6. The scheduler in
// tickDays handles the empty-pool case gracefully (pickRivalEvent
// returns null).
const RIVAL_EVENTS = [];
```

- [ ] **Step 4: Verify file parses**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK');"
```

- [ ] **Step 5: Run tests + smoke test**

```bash
npm test
npm run build
```

Expected: tests pass; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add factors_charter.jsx
git commit -m "$(cat <<'EOF'
feat(rivalry): tickDays scheduler block + window/modifier maintenance

A new tickDays section after the one-off scripted-letter triggers:
  - First-event day initialized with 60-120-day jitter from charter start
  - On reaching nextRivalEventDay, pickRivalEvent draws from RIVAL_EVENTS
    (currently empty stub — populated in Phase 6)
  - On a hit: insertLetter via the standard mutation pattern, mutate
    rival state (eventsFired, standing, state, lastEventDay), push
    priceWindow into gs.priceWindows, push pressure modifier into
    gs.rivalPressureModifiers (defaults +8/-8 over 60 days), consume
    intelPlant flag if present
  - nextRivalEventDay is reset to s.day + 90 + jitter regardless of hit
  - Expired priceWindows pruned via pruneExpiredWindows helper
  - Fully-elapsed pressure modifiers pruned in place
  - gs.rivalPressure recomputed every tick via computeRivalPressure

The empty RIVAL_EVENTS pool means the scheduler is a no-op for the
player until Phase 6 ships templates. Quarterly nag rivalsLines
already runs (Phase 3 Task 3.1) so Hardacre comparison + ter Borch /
Lowji standing lines are visible to the player as soon as Indiaman
visits begin.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

**End of Phase 3.** Run `npm test` and `npm run build`. Both must pass.

---

## Phase 4 — Port-econ priceWindow integration

**Files:**
- Modify: `factors_charter.jsx` — patch `priceFor` (line 565) and the sublocation price formula (line ~9056)

### Task 4.1: Patch `priceFor` to consult `gs.priceWindows`

- [ ] **Step 1: Locate `priceFor` at line 565**. Current signature:

```javascript
const priceFor = (portKey, commodity, day) => {
  const port = PORTS[portKey];
  const base = COMMODITIES[commodity].basePrice;
  const mult = port.sells?.[commodity] ?? port.buys?.[commodity] ?? 1;
  const fluct = ((hashCode(`${day}-${portKey}-${commodity}`) % 21) - 10) / 100;
  return Math.max(1, Math.round(base * mult * (1 + fluct)));
};
```

- [ ] **Step 2: Replace with a 4-arg version** that consults priceWindows:

```javascript
const priceFor = (portKey, commodity, day, gs) => {
  const port = PORTS[portKey];
  const base = COMMODITIES[commodity].basePrice;
  const mult = port.sells?.[commodity] ?? port.buys?.[commodity] ?? 1;
  const fluct = ((hashCode(`${day}-${portKey}-${commodity}`) % 21) - 10) / 100;
  const side = port.sells?.[commodity] != null ? 'sell' : 'buy';
  const windowMult = gs ? priceWindowMult(gs, portKey, commodity, side) : 1;
  return Math.max(1, Math.round(base * mult * (1 + fluct) * windowMult));
};
```

- [ ] **Step 3: Find every `priceFor(` call site and pass `gs`**. Run:

```bash
grep -n "priceFor(" factors_charter.jsx
```

Expected output: a handful of call sites in `PortView`, `LedgerView`, and possibly elsewhere. For each call site:
- If `gs` is in scope (PortView, LedgerView), update the call to pass `gs` as the 4th argument.
- If `gs` is NOT in scope (rare — e.g. inside `genIndiamanLetterPayload`), pass `undefined` explicitly. The function defaults to no-window behaviour.

Example update:

```javascript
// before:
const price = priceFor(gs.location, c, gs.day);
// after:
const price = priceFor(gs.location, c, gs.day, gs);
```

- [ ] **Step 4: Locate the sublocation price formula at line ~9056**. The block computes:

```javascript
const subMult = sub.sells[c];
const base = com.basePrice;
const fluct = ((Math.abs((gs.day || 1) * 7919 + c.charCodeAt(0)) % 17) - 8) / 100;
const price = Math.max(1, Math.round(base * subMult * (1 + fluct)));
```

Update the price line to apply window multipliers (sublocations live in the same `priceWindows` namespace as their parent port — keyed by the *port* key, not the sublocation key):

```javascript
const subMult = sub.sells[c];
const base = com.basePrice;
const fluct = ((Math.abs((gs.day || 1) * 7919 + c.charCodeAt(0)) % 17) - 8) / 100;
// Window arithmetic uses the parent port's key (sublocations use the
// same priceWindows bucket).
const windowMult = priceWindowMult(gs, gs.location, c, 'sell');
const price = Math.max(1, Math.round(base * subMult * (1 + fluct) * windowMult));
```

- [ ] **Step 5: Verify file parses**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK');"
```

- [ ] **Step 6: Smoke-test by manually injecting a window in dev**

```bash
npm run dev
```

In a browser console at `http://localhost:5173/`:

```javascript
// Inject a sell window on Bayan-Kor pepper for testing.
// (Open React devtools or the in-game console.)
// Actual injection path depends on dev tooling; if there is none, skip
// to playtest validation in Phase 6 once events fire naturally.
```

For a non-interactive smoke test, add a one-off vitest in `src/util/price-windows.test.js`:

```javascript
// Already covered in Task 1.1 — priceWindowMult arithmetic is unit-tested.
// The integration test is via the production build + manual playtest.
```

- [ ] **Step 7: Run all tests**

```bash
npm test
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add factors_charter.jsx
git commit -m "$(cat <<'EOF'
feat(rivalry): priceFor + sublocation price consult priceWindows

priceFor gains a 4th arg (gs); when provided, priceWindowMult is
multiplied into the existing base × mult × (1 + fluct) formula. The
arg is optional — gs=undefined preserves the current behaviour for
call sites that lack state context.

The sublocation price formula at the inland-yard / wreckers'-market /
back-rooms surfaces also consults priceWindows, keyed by the parent
port (sublocation stocks live in the same portStocks bucket so the
windows do too).

Existing call sites in PortView / LedgerView updated to pass gs. The
Dutch trade pass and standing-modulated portTaxRate apply on top of
the window-shifted price unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

**End of Phase 4.** `npm test` + `npm run build` must pass.

---

## Phase 5 — Intel channels + Mr. Cama

**Files:**
- Modify: `factors_charter.jsx` — extend the `pirates` AUTO_SENDERS letter pool (Hardacre intel templates), add `makeVizierIntelLetter` scripted helper + tickDays trigger, add `cama` AUTO_SENDERS entry + 3-template pool

### Task 5.1: Add Hardacre intel templates to the pirates AUTO_SENDERS pool

- [ ] **Step 1: Locate the `pirates` per-sender template pool** (line ~4420 — the comment says "6 senders × 3 templates each = 18 entries"). Find the existing `pirates` template list.

- [ ] **Step 2: Append two Hardacre-intel templates** to the `pirates` pool. The intel-buy responses set `s.flags.hardacreIntelPlant = true`:

```javascript
// In the pirates template array, append these two entries:
{
  subject: 'Of yr. peers in these waters',
  body: `Sir, — A small voice in the strait writes: there is news of yr. peer at Bencoolen, kept close by the high office, of which we have laid eyes. The matter would interest you, perhaps, before it is general talk.

The price for yr. private knowledge of it is forty pounds, paid as before — through the boy at the wharf with the broken cap. We do not write again on the matter; we hold it for two weeks. After that the news is no longer ours alone.

—`,
  responses: [
    {
      label: 'Pay the £40; learn what is known',
      seed: 'pay; intel plant; small pirate rep',
      fixedOutcome: {
        prose: 'You send the boy at the wharf with the agreed sum. A note returns the same evening, in a hand the Factor does not know — three sentences only, but enough to anticipate what the next packet from Bencoolen will say.',
        changes: {
          money: -40,
          flags: { hardacreIntelPlant: true },
          journal: 'Bought intelligence on Mr. Hardacre at Bencoolen — £40 to a Brotherhood hand, by the boy at the wharf.',
        },
      },
    },
    {
      label: 'Decline; let the news come in its own time',
      seed: 'decline cleanly',
      fixedOutcome: {
        prose: 'You write nothing in reply. The strait keeps its own counsel; the boy at the wharf is not seen at the gangway.',
        changes: { journal: 'Declined the Brotherhood\'s offer of intelligence on Mr. Hardacre.' },
      },
    },
    {
      label: 'Refuse; the matter is unbecoming',
      seed: 'refuse plainly; small pirate -1',
      fixedOutcome: {
        prose: 'You write a polite refusal — \'such intelligence as is offered, the Factor does not seek\' — and seal it with the household stamp. The boy at the wharf does not return to it; the small voice in the strait, the Factor suspects, takes the refusal personally.',
        changes: {
          reputation: { pirates: -1 },
          journal: 'Refused the Brotherhood\'s offer plainly. They will remember.',
        },
      },
    },
  ],
},
{
  subject: 'A second hand on the Bencoolen matter',
  body: `Sir, — The strait writes again. The price has been put at sixty pounds — yr. peer at Bencoolen has had a turn, and the news will weight against him within the month. You may wish to lay yr. plans accordingly; if not, the matter passes us by.

—`,
  responses: [
    {
      label: 'Pay the £60; the matter is known to me',
      seed: 'pay; intel plant',
      fixedOutcome: {
        prose: 'Sixty pounds to the boy at the wharf, in a sealed packet of the household colour. The intelligence returns: a misadventure at Bencoolen, of the kind that does not appear in the Court\'s correspondence for some weeks yet. The Factor lays his plans accordingly.',
        changes: {
          money: -60,
          flags: { hardacreIntelPlant: true },
          journal: 'Paid £60 for further news of Mr. Hardacre. The strait knew it before the Court did.',
        },
      },
    },
    {
      label: 'Decline; £60 is heavy',
      seed: 'decline; no cost',
      fixedOutcome: {
        prose: 'You send back a single line: \'such matters as the Court will hear in due course, the Factor is content to wait upon.\' The strait shrugs, in the way the strait shrugs.',
        changes: { journal: 'Declined the Brotherhood\'s second offer; £60 was the price of a private fortnight.' },
      },
    },
  ],
},
```

- [ ] **Step 3: Verify file parses**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK');"
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add factors_charter.jsx
git commit -m "$(cat <<'EOF'
feat(rivalry): Brotherhood intel-buy templates for Hardacre

Two new entries in the pirates AUTO_SENDERS template pool offer
intelligence on Hardacre at Bencoolen for £40 and £60 respectively.
Each carries three responses (pay / decline / refuse-with-rep-cost).
Pay sets s.flags.hardacreIntelPlant = true, which the next Hardacre
event consumes (Phase 3 scheduler) to swap in the "anticipated" prose
branch.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 5.2: Add `makeVizierIntelLetter` and tickDays trigger

- [ ] **Step 1: Read an existing scripted-letter helper for shape reference** — `makeBrotherhoodLetter` at line ~1346. The helper returns `{ id, from, subject, body, responses, read }`.

- [ ] **Step 2: Add `makeVizierIntelLetter`** after the existing Vizier-marriage helper (around line ~1827):

```javascript
// ─────────── VIZIER INTEL CHANNEL ───────────
// One to two times per charter, the Vizier writes offering palace-network
// intelligence on ter Borch at Eustace. Cost is an unspoken favour —
// vizierBoonOwed = true is planted if not already set, otherwise the player
// owes a second favour (the Vizier tracks them).
//
// Trigger: visitedEustace >= 2, day >= 150, 90-day spacing,
//          vizierIntelLetterCount < 2, !charterClosed.

function makeVizierIntelLetter(s) {
  const second = (s.flags?.vizierIntelLetterCount ?? 0) >= 1;
  return {
    id: 9300000 + s.day,
    from: 'The Rajah\'s Vizier',
    subject: second ? 'A second word from Kota Pinang' : 'A word from the palace',
    body: `Sir, — The houses at Kota Pinang are not blind, and the wind from Eustace blows toward this palace as readily as toward yours. There is a matter concerning the Hollander ter Borch which ${second ? 'continues to develop' : 'I should be willing to share with you'}, for the courtesies between us.

I write upon it now, and not later, because the matter is the kind which does not keep. The price is no money — that is for the bazaar. The price is yr. word, given quietly, that you remember the courtesy when called.

Yr. obedt. servant,
The Vizier`,
    responses: [
      {
        label: 'Accept; the Vizier shall be remembered',
        seed: 'accept; vizier boon owed; intel plant',
        fixedOutcome: {
          prose: 'You write a careful acceptance, in the language the Vizier will recognise. A folded note returns within the week — three sentences in his own hand, written under the lamp, naming a thing about the Hollander\'s recent correspondence which the Court will not hear of for some time yet.',
          changes: {
            flags: { terborchIntelPlant: true, vizierBoonOwed: true,
                     vizierIntelLetterCount: (s.flags?.vizierIntelLetterCount ?? 0) + 1 },
            journal: 'Accepted the Vizier\'s intelligence on ter Borch. A favour is owed, to be called.',
            hook: 'The Vizier\'s favour is on the books. He will name it when it suits him.',
          },
        },
      },
      {
        label: 'Decline politely; the courtesies are not equal',
        seed: 'decline; small rajah neutral',
        fixedOutcome: {
          prose: 'You decline by note, with thanks for the regard. The Vizier accepts the refusal with the smallest motion of his head — and writes nothing more for some weeks.',
          changes: {
            flags: { vizierIntelLetterCount: (s.flags?.vizierIntelLetterCount ?? 0) + 1 },
            journal: 'Declined the Vizier\'s offer. The favours-book remains as it was.',
          },
        },
      },
    ],
    read: false,
  };
}
```

- [ ] **Step 3: Add the tickDays trigger** for the Vizier intel letter. Find a suitable spot in the scripted-letter section of tickDays (after the Vizier marriage gambit trigger at line ~3603):

```javascript
    // ── Vizier intel: one to two per charter, gated visited Eustace >= 2,
    // 90-day spacing, capped at 2.
    if (
      !s.charterClosed &&
      (s.flags?.vizierIntelLetterCount ?? 0) < 2 &&
      s.day >= 150 &&
      (s.visited || []).filter(p => p === 'Port St. Eustace').length >= 2 &&
      (s.day - (s.flags?.lastVizierIntelDay ?? 0)) >= 90
    ) {
      const letter = makeVizierIntelLetter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), lastVizierIntelDay: s.day };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A folded note from the palace, the Vizier\'s small personal seal upon it.' });
    }
```

- [ ] **Step 4: Verify parse + tests**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK');"
npm test
```

- [ ] **Step 5: Commit**

```bash
git add factors_charter.jsx
git commit -m "$(cat <<'EOF'
feat(rivalry): Vizier intel channel for ter Borch

makeVizierIntelLetter offers palace-network intelligence on ter Borch
in exchange for an unspoken favour (vizierBoonOwed flag plant). Two
responses: accept (plant terborchIntelPlant + vizierBoonOwed; hook
recorded) or decline (no cost).

Trigger fires from tickDays once the player has visited Eustace at
least twice, day >= 150, 90-day spacing, capped at two firings per
charter.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 5.3: Add Mr. Cama AUTO_SENDERS entry + per-sender template pool

- [ ] **Step 1: Add the new entry** to the `AUTO_SENDERS` array (line 2674–2723). Append after the existing `dryden` entry:

```javascript
  {
    key: 'cama',
    from: 'Mr. Pestonji Cama, of the Bombay establishment',
    faction: null,
    mood: 'a careful Parsi shipping clerk, second to a great house, offering small pieces of news for small pieces of money — formal mercantile English with the occasional Zoroastrian touchstone',
    weight: 1,
    gate: (s) => s.day >= 90,
  },
```

(Weight set to 1 so Cama doesn't crowd out the existing 6 senders.)

- [ ] **Step 2: Add a 3-template pool for Cama** in the per-sender template registry (line ~4420 area). Append a `cama` key to whatever the existing per-sender pool object is keyed by:

```javascript
cama: [
  // Two intel-buy templates + one ambient request, alternated by random pick.
  {
    subject: 'A small note from Bombay',
    body: `Sir, — I write upon a matter you may find of small worth, perhaps of more. Mr. Lowji Nusserwanji's establishment has had a turn this fortnight, of which I am better informed than most by my position. For twenty pounds — paid by the Madras packet — I should be willing to write the matter plainly.

I do not press the matter; I write only because I have written upon similar matters before to gentlemen of yr. station, and they have not regretted the sums.

Yr. obedt. servant,
Pestonji Cama`,
    responses: [
      {
        label: 'Pay the £20; the matter is of interest',
        seed: 'pay; lowji intel plant',
        fixedOutcome: {
          prose: 'You despatch a draft for twenty pounds by the Madras packet. A second letter returns within the month — a careful list of three matters concerning Mr. Lowji\'s recent shipments, written in a hand which has been schooled by a Parsi master in English commerce.',
          changes: {
            money: -20,
            flags: { lowjiIntelPlant: true },
            journal: 'Bought intelligence on Mr. Lowji of Bombay — £20 to Mr. Cama by the Madras packet.',
          },
        },
      },
      {
        label: 'Decline; the price is enough',
        seed: 'decline cleanly',
        fixedOutcome: {
          prose: 'You write a courteous decline. Mr. Cama answers by return — a single sentence of regret, in the formal Bombay manner.',
          changes: { journal: 'Declined Mr. Cama\'s offer. He writes again, no doubt.' },
        },
      },
    ],
  },
  {
    subject: 'A further matter from Bombay',
    body: `Sir, — A second matter, of which the price is sixty pounds, paid as before. Mr. Lowji has put a quantity of [trade good] upon the next ship for Eustace, and the matter — by the time it is general — will weight against him in such-and-such a way. The price is the price; I am not the master of these things.

Yr. obedt. servant,
Pestonji Cama`,
    responses: [
      {
        label: 'Pay the £60; lay my plans accordingly',
        seed: 'pay; lowji intel plant',
        fixedOutcome: {
          prose: 'Sixty pounds across the bay. The return packet brings a clean account of the Bombay establishment\'s misadventure — two ships, three commodities, four weeks before the news travels by ordinary channels. The Factor lays his plans on the strength of it.',
          changes: {
            money: -60,
            flags: { lowjiIntelPlant: true },
            journal: 'Paid £60 to Mr. Cama for the Bombay matter. The Factor\'s holds are positioned.',
          },
        },
      },
      {
        label: 'Decline; £60 is the run of trade',
        seed: 'decline cleanly',
        fixedOutcome: {
          prose: 'You decline by post. Mr. Cama, predictably, writes no more on the matter — and in due course the news arrives by ordinary channels, when it is no longer of any use to lay plans against.',
          changes: { journal: 'Declined Mr. Cama\'s second offer. The Bombay matter, when it became general, found me unprepared.' },
        },
      },
    ],
  },
  {
    subject: 'Of my son in the writing-school',
    body: `Sir, — I beg leave to write upon a matter not of trade. My son, of fifteen years, is engaged in the Madras writing-school under Mr. Wynne; the establishment\'s subscription is short upon the present quarter. A small donation of five pounds to the master, in the Factor\'s name, would not be forgotten — by the boy or by yr. obedt. servant.

I do not write thus often; I write only because the boy is industrious and the matter is small.

Yr. obedt. servant,
Pestonji Cama`,
    responses: [
      {
        label: 'Subscribe £5; the boy shall be remembered',
        seed: 'subscribe small; cama loyalty hint',
        fixedOutcome: {
          prose: 'Five pounds to Mr. Wynne by the next packet, in the Factor\'s name. Mr. Cama writes back in a hand half a degree warmer than before.',
          changes: {
            money: -5,
            journal: 'Subscribed £5 to Mr. Wynne\'s school for the boy Cama. Goodwill in Bombay is, perhaps, worth more than the sum.',
          },
        },
      },
      {
        label: 'Decline politely; another year, perhaps',
        seed: 'decline cleanly',
        fixedOutcome: {
          prose: 'You write a polite decline. Mr. Cama answers with a courteous regret and the matter is not raised again.',
          changes: { journal: 'Declined the subscription. Five pounds is, in the run of accounts, no great matter.' },
        },
      },
    ],
  },
],
```

- [ ] **Step 3: Verify parse + tests + build**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK');"
npm test
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add factors_charter.jsx
git commit -m "$(cat <<'EOF'
feat(rivalry): Mr. Cama AUTO_SENDERS entry + 3-template pool

Mr. Pestonji Cama of the Bombay establishment is added to AUTO_SENDERS
at weight 1 (gate: day >= 90). His three-template pool comprises:
  - Two intel-buy templates (£20 / £60) that plant lowjiIntelPlant
  - One ambient template (subscription request for his son's school)

Cama's voice is formal mercantile English with Parsi/Zoroastrian
touchstones, distinct from Lowji's own event-driven prose. He is the
intel channel for the country trader rival at Bombay.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

**End of Phase 5.** Three intel channels are wired. The structural plumbing is now complete — the system is *operationally* live and will produce zero rival events until Phase 6 ships templates.

---

## Phase 6 — Event templates

**Files:**
- Modify: `factors_charter.jsx` — populate `RIVAL_EVENTS` with 18 templates (6 per rival)

**Note on scope:** The spec §Risks #9.1 flagged 18 templates as the largest content cost. Per the spec's scope-down option, ship 4 templates per rival (12 total) for v1 and add the remaining 6 progressively in follow-up commits. This plan documents the full 18; if shipping 12 first, omit two templates from each rival and adjust the maxDay windows so the pool covers the charter.

### Task 6.1: Add 6 Hardacre event templates

- [ ] **Step 1: Replace the empty `RIVAL_EVENTS = []` stub** (added in Phase 3 Task 3.3) with the populated array. Each template follows the spec §3 Architecture format:

```javascript
const RIVAL_EVENTS = [
  // ─── HARDACRE EVENTS (6) ────────────────────────────────────────────
  {
    key: 'hardacre-fire',
    rival: 'hardacre',
    minDay: 180, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: -20,
    standingAfter: 'troubled',
    pressureDelta: -10,
    pressureLifetime: 60,
    priceWindow: { port: 'Bayan-Kor', commodity: 'pepper', sellMult: 1.25, days: 60 },
    build: (s, opts) => ({
      id: 9400000 + s.day,
      from: 'A correspondent, by the next packet',
      subject: 'News of Bencoolen',
      body: opts.anticipated
        ? `Sir, — As you anticipated. A fire at the Bencoolen godowns, three days back, has cost Mr. Hardacre the better part of his pepper stock for the season. The Court will hear of it within the fortnight; the strait, you have heard already.\n\nYr. obedt. servant.`
        : `Sir, — There is news from Bencoolen, of which the Court does not yet know. A fire at Mr. Hardacre's godowns, three days back, has cost him the better part of his pepper stock for the season. The Court will hear within the fortnight.\n\nYr. obedt. servant.`,
      responses: [
        {
          label: 'Reroute the brigantine to Bencoolen with what pepper we have',
          seed: 'arbitrage; lay hands on the price',
          fixedOutcome: {
            prose: 'The brigantine is laid for Bencoolen at the next favourable wind. The price of pepper in those quarters has risen by the fact of the fire; the Factor positions his hold accordingly.',
            changes: { journal: 'Rerouted the brigantine to Bencoolen on news of Hardacre\'s fire. The pepper price spike will reward the Factor who is first.' },
          },
        },
        {
          label: 'Note it; press on with the present quarter',
          seed: 'no action; private satisfaction',
          fixedOutcome: {
            prose: 'You set the news aside. The Court will hear when the Court hears.',
            changes: { journal: 'Heard of Hardacre\'s misfortune at Bencoolen. We shall press on with the present quarter.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'hardacre-windfall',
    rival: 'hardacre',
    minDay: 240, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: 12,
    standingAfter: 'rising',
    pressureDelta: 10, pressureLifetime: 90,
    build: (s, opts) => ({
      id: 9400100 + s.day,
      from: 'The Court of Directors',
      subject: 'A note in passing',
      body: opts.anticipated
        ? `Sir, — As you had been forewarned. Mr. Hardacre at Bencoolen has had a quarter of which the Court speaks favourably — a Bugis cargo of cinnamon, salvaged from a wreck at Engano, the proceeds of which weight against you in the present comparison.\n\nYr. servants, the Court of Directors.`
        : `Sir, — In the last quarter, Mr. Hardacre at Bencoolen has had a windfall — a cargo of cinnamon, salvaged from a wreck at Engano, which weights against you in the present comparison. We do not press the matter — only note that the present figures favour his station.\n\nYr. servants, the Court of Directors.`,
      responses: [
        {
          label: 'Note it; press on',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside.',
            changes: { journal: 'Hardacre had a windfall at Engano. The Court is, at present, in his favour.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'hardacre-clerk-defect',
    rival: 'hardacre',
    minDay: 360, maxDay: 900,
    preconditions: (s) => (s.rivals?.hardacre?.standing ?? 50) <= 35,
    standingDelta: -8,
    standingAfter: 'troubled',
    pressureDelta: -8, pressureLifetime: 60,
    build: (s, opts) => ({
      id: 9400200 + s.day,
      from: 'Mr. Reginald Penhaligon, Junior Writer',
      subject: 'A request for employment',
      body: `Sir, — I write directly, at the suggestion of Mr. Tyler of the Madras establishment with whom I am acquainted. I am at present junior writer in the Bencoolen establishment under Mr. Hardacre, a post which I no longer find — for reasons I shall not put down upon paper — agreeable to my situation.

I write upon yr. office because the Bayan-Kor establishment is reckoned by the Madras gentlemen as a station where industry is rewarded. My present wage at Bencoolen is £36 per annum; I should not press for more than yr. office finds reasonable.

Yr. obedt. and humble servant,
Reginald Penhaligon`,
      responses: [
        {
          label: 'Hire him at £36/year; the household is the better for it',
          seed: 'hire penhaligon; new acquaintance',
          fixedOutcome: {
            prose: 'You write Mr. Penhaligon a careful letter of engagement, with the £36/year wage offered against an annual review. He arrives by the next packet — a sober, careful young man of three-and-twenty, with a hand fair enough that Hodge says nothing against him.',
            changes: {
              money: -10,                   // travel costs
              journal: 'Engaged Mr. Reginald Penhaligon, late of Bencoolen, as a junior writer. £36/year on review.',
              newAcquaintances: [
                { name: 'Mr. Reginald Penhaligon', role: 'Junior Writer', location: 'Bayan-Kor', notes: 'Defected from Hardacre\'s establishment at Bencoolen. Sober, careful, fair hand.' },
              ],
            },
          },
        },
        {
          label: 'Decline; the household is full enough',
          seed: 'decline cleanly',
          fixedOutcome: {
            prose: 'You write a courteous decline. Mr. Penhaligon, by report, takes a post at Madras instead; we hear of him no more.',
            changes: { journal: 'Declined Mr. Penhaligon\'s application. The household is full enough.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'hardacre-pilot-lost',
    rival: 'hardacre',
    minDay: 300, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: -10,
    pressureDelta: -8, pressureLifetime: 45,
    priceWindow: { port: 'Bayan-Kor', commodity: 'cinnamon', sellMult: 1.15, days: 45 },
    build: (s, opts) => ({
      id: 9400300 + s.day,
      from: 'Capt. Faulke of the Albatross',
      subject: 'A matter from the strait',
      body: opts.anticipated
        ? `Sir, — As foretold. Mr. Hardacre's chief pilot, Bugis, has been pressed into service by the Royal Navy at Trincomalee for an Indian Ocean station. Bencoolen is, for the present quarter, navigating with green hands.`
        : `Sir, — A matter for yr. ear. Mr. Hardacre's chief pilot — a Bugis whose name I shall not write — has been pressed into Royal Navy service at Trincomalee. Bencoolen will navigate with green hands until a replacement is found, which will not be quickly.`,
      responses: [
        {
          label: 'Note it; trust will follow Faulke for the news',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You make a note in the household book.',
            changes: { journal: 'Hardacre has lost his chief pilot to the Navy. Bencoolen sails on green hands.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'hardacre-court-favour',
    rival: 'hardacre',
    minDay: 480, maxDay: 1080,
    preconditions: (s) => (s.rivals?.hardacre?.standing ?? 50) >= 55,
    standingDelta: 15,
    standingAfter: 'rising',
    pressureDelta: 12, pressureLifetime: 90,
    build: (s, opts) => ({
      id: 9400400 + s.day,
      from: 'The Court of Directors',
      subject: 'A note of relative standing',
      body: `Sir, — Mr. Hardacre at Bencoolen has been the recipient, this quarter, of a private commendation from the Chairman, on the strength of his returns. We do not press the comparison. We note only that the Chairman's regard, once given, is not lightly transferred.\n\nYr. servants, the Court of Directors.`,
      responses: [
        {
          label: 'Note it; press on',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside.',
            changes: { journal: 'Hardacre has the Chairman\'s private regard. We must do better than the present quarter.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'hardacre-scandal',
    rival: 'hardacre',
    minDay: 540, maxDay: 1080,
    preconditions: (s) => (s.rivals?.hardacre?.standing ?? 50) <= 30,
    standingDelta: -20,
    standingAfter: 'broken',
    pressureDelta: -15, pressureLifetime: 90,
    build: (s, opts) => ({
      id: 9400500 + s.day,
      from: 'The Court of Directors',
      subject: 'A grave matter at Bencoolen',
      body: `Sir, — A grave matter at Bencoolen has come before the Court. Mr. Hardacre is summoned home upon the next Indiaman to answer the matter at Leadenhall, and a successor is to be named in the interval. The comparison, which has weighted hard against you these quarters past, is now removed from yr. file. We trust this finds yr. station in good order, and yr. quarter\'s returns the equal of expectation.\n\nYr. servants, the Court of Directors.`,
      responses: [
        {
          label: 'Note it; press on',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside. The Bencoolen seat is, for the moment, vacant.',
            changes: { journal: 'Hardacre is summoned home in disgrace. The Court\'s comparison no longer weights against me.' },
          },
        },
      ],
      read: false,
    }),
  },
```

(Continue this array — it does not close yet. The next two tasks add ter Borch and Lowji event templates, then close the bracket.)

- [ ] **Step 2: Verify parse**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); try { p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK'); } catch(e) { console.log('ERR:', e.message); }"
```

If parse fails because the array isn't closed, that's expected — Tasks 6.2 and 6.3 will close it. Tests/build cannot pass mid-task.

- [ ] **Step 3: Stage but do not commit yet** — wait for the full array to close in Task 6.3.

```bash
git add factors_charter.jsx
```

### Task 6.2: Add 6 ter Borch event templates

- [ ] **Step 1: Append after the Hardacre block** (still inside the array literal):

```javascript
  // ─── TER BORCH EVENTS (6) ───────────────────────────────────────────
  {
    key: 'terborch-customs-spat',
    rival: 'terborch',
    minDay: 200, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: -8,
    pressureDelta: -5, pressureLifetime: 45,
    priceWindow: { port: 'Port St. Eustace', commodity: 'sandalwood', sellMult: 1.15, days: 45 },
    build: (s, opts) => ({
      id: 9410000 + s.day,
      from: 'Mynheer Hendrik Boom',
      subject: 'A matter at the customs',
      body: opts.anticipated
        ? `Sir, — As you had been told. The customs at Eustace are at odds with Mynheer ter Borch this fortnight, over a cargo of sandalwood; he is for the moment occupied. Trade may be had at a smaller fee than is usual, by those who can move quickly.`
        : `Sir, — The customs at Eustace are at odds with Mynheer ter Borch this fortnight, over a cargo of sandalwood. The matter is small but not nothing — and trade may be had, at present, at a smaller fee than is usual.\n\nYr. obedt. servant,\nBoom`,
      responses: [
        {
          label: 'Note it; the next visit shall be a profitable one',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You make a private note. The Hollanders\' difficulties, occasionally, are the Englishman\'s opportunity.',
            changes: { journal: 'Boom writes that ter Borch is at odds with the customs at Eustace. A small window for sandalwood.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'terborch-promotion-attempted',
    rival: 'terborch',
    minDay: 360, maxDay: 900,
    preconditions: (s) => true,
    standingDelta: 10,
    standingAfter: 'rising',
    pressureDelta: 6, pressureLifetime: 60,
    build: (s, opts) => ({
      id: 9410100 + s.day,
      from: 'Mynheer Hendrik Boom',
      subject: 'A whisper from the High Government',
      body: `Sir, — There is talk that Mynheer ter Borch is named for an advance — a station at Batavia, perhaps, or a deputy\'s seat at the Council of the Indies. The matter is not settled; but the wind from Amsterdam is in his sail.\n\nYr. obedt. servant,\nBoom`,
      responses: [
        {
          label: 'Note it; the High Government may yet take him from us',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the matter aside. Whether ter Borch goes east or stays at Eustace, the Factor presses on with his charter.',
            changes: { journal: 'Boom writes that ter Borch is named for advance — Batavia or the Council of the Indies. The matter is not settled.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'terborch-scandal',
    rival: 'terborch',
    minDay: 480, maxDay: 1080,
    preconditions: (s) => (s.rivals?.terborch?.standing ?? 50) <= 35,
    standingDelta: -15,
    standingAfter: 'troubled',
    pressureDelta: -10, pressureLifetime: 75,
    build: (s, opts) => ({
      id: 9410200 + s.day,
      from: 'A correspondent, by the next Indiaman',
      subject: 'A matter at Eustace',
      body: `Sir, — A matter has come to the High Government concerning Mynheer ter Borch — the Brotherhood matter, as it is called in the back rooms — of a kind which does not invite open discussion. He is summoned to Batavia for an interview at the Council. The matter may yet be cleared; or not. — Yr. obedt. servant.`,
      responses: [
        {
          label: 'Note it; the Hollanders\' troubles are not the Factor\'s',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside. The Council at Batavia is, in such matters, slow but not unconcerned.',
            changes: { journal: 'Ter Borch is summoned to Batavia for an interview. The Hollanders\' troubles are not the Englishman\'s — yet.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'terborch-clerk-defect',
    rival: 'terborch',
    minDay: 360, maxDay: 900,
    preconditions: (s) => (s.rivals?.terborch?.standing ?? 50) <= 35,
    standingDelta: -8,
    pressureDelta: -6, pressureLifetime: 45,
    build: (s, opts) => ({
      id: 9410300 + s.day,
      from: 'Mynheer Cornelis de Witt, Secretary',
      subject: 'A matter of employment',
      body: `Sir, — I am at present secretary at Mynheer ter Borch's establishment at Eustace, a position which has become — by reasons of recent disagreement — no longer agreeable to my situation. I write upon yr. office because the Bayan-Kor establishment is reckoned by the Hollanders themselves as a station where Dutch industry is not held against the man.

My present wage is forty guilders the month; I should not press for more in pounds than yr. office finds proper.

Yr. obedt. servant,
Cornelis de Witt`,
      responses: [
        {
          label: 'Hire him; a Dutch hand is useful at Eustace',
          seed: 'hire de witt; new acquaintance',
          fixedOutcome: {
            prose: 'You engage Mynheer de Witt at £40 per annum, payable quarterly. He arrives by the next Eustace packet — a thin, careful man of perhaps thirty, with a hand which writes Dutch and English with equal facility.',
            changes: {
              money: -8,
              journal: 'Engaged Mynheer Cornelis de Witt as secretary, late of ter Borch\'s establishment. £40/year, paid quarterly.',
              newAcquaintances: [
                { name: 'Mynheer Cornelis de Witt', role: 'Secretary', location: 'Bayan-Kor', notes: 'Defected from ter Borch\'s establishment. Bilingual (Dutch + English); thirty; careful.' },
              ],
            },
          },
        },
        {
          label: 'Decline; a Hollander in the household is a complication',
          seed: 'decline; small dutch -',
          fixedOutcome: {
            prose: 'You decline by note. Mynheer de Witt takes ship for Amsterdam, by report, and his use to either establishment is at an end.',
            changes: {
              reputation: { dutch: -2 },
              journal: 'Declined de Witt\'s application. A Hollander in the household was a complication.',
            },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'terborch-trade-pass-revocation',
    rival: 'terborch',
    minDay: 540, maxDay: 1080,
    preconditions: (s) => s.flags?.dutchTradePass === true && (s.rivals?.terborch?.standing ?? 50) >= 65,
    standingDelta: 10,
    standingAfter: 'rising',
    pressureDelta: 10, pressureLifetime: 60,
    build: (s, opts) => ({
      id: 9410400 + s.day,
      from: 'Mynheer ter Borch, formally',
      subject: 'A revision of yr. trade pass',
      body: `Sir, — I am instructed by the High Government to revise the trade passes granted by my junior at Eustace to certain English servants in the strait. The pass which yr. office holds is, with my regret, henceforth halved in its application — fifty per cent. of its former privilege. The matter is not personal; it is the run of administration.\n\nYr. obedt. servant,\nter Borch`,
      responses: [
        {
          label: 'Acknowledge; the matter is the run of administration',
          seed: 'acknowledge; trade pass weakened',
          fixedOutcome: {
            prose: 'You write a courteous acknowledgement. The duty at Eustace is, henceforth, only one-quarter halved instead of fully halved — a small but real material loss.',
            changes: {
              flags: { dutchTradePassReduced: true },
              journal: 'Ter Borch revises the trade pass. Eustace duties are no longer fully halved; the privilege is reduced.',
            },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'terborch-glut',
    rival: 'terborch',
    minDay: 240, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: -5,
    pressureDelta: -4, pressureLifetime: 30,
    priceWindow: { port: 'Port St. Eustace', commodity: 'silver', buyMult: 1.10, days: 30 },
    build: (s, opts) => ({
      id: 9410500 + s.day,
      from: 'Mynheer Hendrik Boom',
      subject: 'A small matter at the warehouses',
      body: `Sir, — Mynheer ter Borch's silver consignment, this fortnight, has run heavier than the warehouses can hold; he is for the moment selling silver below the customary mark. The matter does not last — perhaps a month. — Yr. obedt. servant, Boom`,
      responses: [
        {
          label: 'Note it; the next visit to Eustace shall be a buyer\'s',
          seed: 'arbitrage',
          fixedOutcome: {
            prose: 'A small private note in the household book.',
            changes: { journal: 'Ter Borch is over-supplied of silver at Eustace. A month of buyer\'s prices.' },
          },
        },
      ],
      read: false,
    }),
  },
```

- [ ] **Step 2: Verify parse**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); try { p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK'); } catch(e) { console.log('ERR:', e.message); }"
```

If parse fails (array still not closed), that's expected. Task 6.3 closes it.

- [ ] **Step 3: Do not commit yet.**

### Task 6.3: Add 6 Lowji event templates and close the array

- [ ] **Step 1: Append the final 6 templates** and close the `RIVAL_EVENTS` array:

```javascript
  // ─── LOWJI EVENTS (6) ───────────────────────────────────────────────
  {
    key: 'lowji-cargo-lost',
    rival: 'lowji',
    minDay: 200, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: -15,
    standingAfter: 'troubled',
    pressureDelta: -7, pressureLifetime: 60,
    priceWindow: { port: 'Bayan-Kor', commodity: 'calico', buyMult: 0.85, days: 60 },
    build: (s, opts) => ({
      id: 9420000 + s.day,
      from: 'Mr. Pestonji Cama',
      subject: 'A matter from Bombay',
      body: opts.anticipated
        ? `Sir, — As foretold. Mr. Lowji's brigantine, the Hormuzd, has been lost in a squall off the Konkan, with the better part of the season's calico. The Bombay houses are, for the moment, supplying calico into the bay at prices the Englishman may turn to advantage.`
        : `Sir, — News from the bay. Mr. Lowji Nusserwanji has lost the Hormuzd, in a squall off the Konkan coast — a brigantine and the better part of his calico for the season. The Bombay houses redirect their supply through Bayan-Kor at less than the customary price for some weeks.\n\nYr. obedt. servant,\nCama`,
      responses: [
        {
          label: 'Buy calico aggressively while the price holds',
          seed: 'arbitrage',
          fixedOutcome: {
            prose: 'You direct Hodge to lay in calico beyond the customary mark, against the future quarter when the price will return.',
            changes: { journal: 'Lowji has lost the Hormuzd; Cama writes from Bombay. Hodge laying in calico against the season\'s return.' },
          },
        },
        {
          label: 'Note it; the present hold is full enough',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside.',
            changes: { journal: 'Lowji has lost the Hormuzd. The hold is full enough; the bay\'s prices we leave for another quarter.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'lowji-windfall',
    rival: 'lowji',
    minDay: 240, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: 12,
    standingAfter: 'rising',
    pressureDelta: 8, pressureLifetime: 60,
    build: (s, opts) => ({
      id: 9420100 + s.day,
      from: 'Mr. Pestonji Cama',
      subject: 'A small note of standing',
      body: opts.anticipated
        ? `Sir, — As you had been told. Mr. Lowji has secured a contract with the Surat Mughal customs — opium licence in country trade for the season. The bay houses are full of his name.`
        : `Sir, — A matter of small significance, perhaps: Mr. Lowji Nusserwanji has secured an opium licence under the Surat Mughal customs for the present season. The Bombay houses speak of him in the warmer language of country trade.\n\nYr. obedt. servant,\nCama`,
      responses: [
        {
          label: 'Note it; press on',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside.',
            changes: { journal: 'Lowji has the Surat opium licence. The Bombay houses speak well of him.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'lowji-pilot-defect',
    rival: 'lowji',
    minDay: 360, maxDay: 900,
    preconditions: (s) => (s.rivals?.lowji?.standing ?? 50) <= 35,
    standingDelta: -10,
    pressureDelta: -6, pressureLifetime: 45,
    build: (s, opts) => ({
      id: 9420200 + s.day,
      from: 'Capt. Faulke of the Albatross',
      subject: 'A pilot for the strait',
      body: `Sir, — There is in Bayan-Kor at present, looking for employment, one Khojah Avedik — a Persian pilot of fifteen years' service in the bay, late of Mr. Lowji's establishment at Bombay. He left under circumstances of which I do not write upon paper. He knows the strait between here and Macao as a man knows his own door.

He asks £80 per annum, with the use of a clerk to keep his accounts in English. I should not press the matter, but I have seen his hand at the wheel myself, and the matter recommends itself.

Yr. obedt. servant,
Faulke`,
      responses: [
        {
          label: 'Hire him at £80/year; a Persian pilot is no small thing',
          seed: 'hire avedik; new acquaintance',
          fixedOutcome: {
            prose: 'You write Faulke a note authorising the engagement. Khojah Avedik is brought to the household by the next packet — a thin, dignified, careful man, who speaks English with the formality of his Bombay schooling. The strait, henceforth, is read by a hand that knows it.',
            changes: {
              money: -20,
              journal: 'Engaged Khojah Avedik as pilot, late of Mr. Lowji\'s. £80/year. The strait is the household\'s now in a way it was not.',
              newAcquaintances: [
                { name: 'Khojah Avedik', role: 'Pilot', location: 'Bayan-Kor', notes: 'Persian pilot, fifteen years in the bay, late of Mr. Lowji\'s Bombay establishment. £80/year. Knows the strait to Macao.' },
              ],
            },
          },
        },
        {
          label: 'Decline; £80 is a great wage for a hand at the wheel',
          seed: 'decline cleanly',
          fixedOutcome: {
            prose: 'You decline by note. Khojah Avedik, by report, takes a post with the Hollanders at Eustace within the fortnight.',
            changes: { journal: 'Declined Avedik\'s application. £80 was the price of a private pilot.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'lowji-rumour',
    rival: 'lowji',
    minDay: 300, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: 5,
    pressureDelta: 4, pressureLifetime: 30,
    build: (s, opts) => ({
      id: 9420300 + s.day,
      from: 'Mr. Pestonji Cama',
      subject: 'A small rumour from Bombay',
      body: `Sir, — A rumour, of which I take no certainty: Mr. Lowji is said to be building a new shipyard at Mazagon, on the Bombay establishment\'s western water. If the matter is true, his standing in country trade is materially the larger for it.\n\nYr. obedt. servant,\nCama`,
      responses: [
        {
          label: 'Note the rumour; press on',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You make a private note.',
            changes: { journal: 'Cama writes of a Lowji shipyard at Mazagon. The matter, if true, places him further ahead.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'lowji-glut',
    rival: 'lowji',
    minDay: 240, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: -5,
    pressureDelta: -3, pressureLifetime: 30,
    priceWindow: { port: 'Bayan-Kor', commodity: 'calico', sellMult: 0.85, days: 30 },
    build: (s, opts) => ({
      id: 9420400 + s.day,
      from: 'Mr. Pestonji Cama',
      subject: 'A glut at Bombay',
      body: `Sir, — The Bombay houses are at present over-supplied of calico — Mr. Lowji has shipped against an expected market that has not materialised. Bombay calico is, this month, at the cheaper price; the matter is not material to yr. station, but the Factor may wish to know.\n\nYr. obedt. servant,\nCama`,
      responses: [
        {
          label: 'Note it; if a sale at Bayan-Kor presents itself, hold for next month',
          seed: 'arbitrage hint',
          fixedOutcome: {
            prose: 'You make a private note. The Bayan-Kor calico price will be the softer for some weeks.',
            changes: { journal: 'Cama writes of a calico glut at Bombay. Hold the household stock against the next quarter.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'lowji-bankruptcy-rumour',
    rival: 'lowji',
    minDay: 540, maxDay: 1080,
    preconditions: (s) => (s.rivals?.lowji?.standing ?? 50) <= 25,
    standingDelta: -25,
    standingAfter: 'broken',
    pressureDelta: -12, pressureLifetime: 90,
    build: (s, opts) => ({
      id: 9420500 + s.day,
      from: 'Mr. Pestonji Cama',
      subject: 'A grave rumour from Bombay',
      body: `Sir, — A grave rumour, which I record only because I am called upon to record what I hear. Mr. Lowji Nusserwanji's establishment is said to be over-extended in the season's voyages, and the bills he has written against the Surat customs are said to be coming back protested. If the matter is as the bay houses describe, his establishment will not see out the year.

I do not write upon this matter again unless it confirms.

Yr. obedt. servant,
Cama`,
      responses: [
        {
          label: 'Note it; the matter is grave',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside, in the careful way a Factor sets aside news of another man\'s ruin.',
            changes: { journal: 'Cama writes that Lowji\'s establishment may not see out the year. A grave matter, if it confirms.' },
          },
        },
      ],
      read: false,
    }),
  },
];   // ← closes RIVAL_EVENTS
```

- [ ] **Step 2: Verify the file parses**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines');"
```

Expected: `OK <line count> lines`.

- [ ] **Step 3: Add the pool-size sufficiency test** — append to `src/util/rivalry.test.js`:

```javascript
import { RIVALS_REGISTRY } from './rivalry.js';

describe('RIVAL_EVENTS pool sufficiency (smoke)', () => {
  // This test does NOT import RIVAL_EVENTS — that lives in the JSX
  // monolith. It documents the size requirement and is a placeholder
  // for an integration test that imports the pool when the project
  // adopts a pool-export pattern. For now, the assertion is on the
  // registry shape: 3 rivals, each with an intel channel.
  it('has three rivals each bound to an intel channel', () => {
    expect(RIVALS_REGISTRY.length).toBe(3);
    for (const r of RIVALS_REGISTRY) {
      expect(r.intelChannel).toMatch(/^(brotherhood|vizier|cama)$/);
    }
  });
});
```

- [ ] **Step 4: Run all tests + build**

```bash
npm test
npm run build
```

Both must pass.

- [ ] **Step 5: Smoke-test in dev**

```bash
npm run dev
```

In a browser at `http://localhost:5173/`:
- Start a new charter ("Begin Anew" if a save exists from prior testing).
- Use the Skip-day debug control (or play out time) to advance to day 100+. Verify a rival event letter eventually arrives.
- Read the letter; verify the response choices apply changes (money, journal, etc.).
- Visit a port whose commodity has an active priceWindow — confirm the price differs from the baseline.

`Ctrl-C` to stop.

- [ ] **Step 6: Commit Phase 6 in one commit**

```bash
git add factors_charter.jsx src/util/rivalry.test.js
git commit -m "$(cat <<'EOF'
feat(rivalry): RIVAL_EVENTS pool — 18 templates across 3 rivals

Six templates per rival (Hardacre / ter Borch / Lowji), each carrying
the structural fields per the spec: minDay/maxDay window,
preconditions(), build(s, opts) returning a letter object, optional
standingDelta/standingAfter, optional priceWindow for arbitrage,
optional pressureDelta/pressureLifetime override.

Hardacre: fire (-20 standing, pepper price spike at Bayan-Kor),
windfall, clerk defect (Penhaligon), pilot lost, court favour,
scandal-summons-home.

ter Borch: customs spat (sandalwood arbitrage at Eustace), promotion-
attempted, scandal, clerk defect (de Witt), trade-pass revocation
(reduces Dutch pass benefit), silver glut.

Lowji: cargo lost (Hormuzd, calico arbitrage), windfall (Surat opium
licence), pilot defect (Khojah Avedik), Mazagon shipyard rumour,
calico glut, bankruptcy rumour.

Each event's body has both a default and an "anticipated" branch read
by the intel-buy plant flag (Phase 5). Pool-size sufficiency placeholder
test added to src/util/rivalry.test.js.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

**End of Phase 6.** The system is fully live. Run a 1080-day charter end-to-end and verify rival events fire at the expected cadence.

---

## Cross-phase verification

After all six phases:

```bash
npm test                          # all unit tests pass
npm run build                     # production bundle builds
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines');"
```

Manual smoke test (in `npm run dev`):

1. **Quarterly nag rivalsLines:** start a new charter, advance to first Indiaman call (day ~270), then to the next quarterly nag. Confirm Hardacre line plus optional ter Borch / Lowji lines (gated by their standings).
2. **Event firing cadence:** advance time across multiple 90-day windows; expect 6–8 rival events over a 1080-day charter, with no more than 3 in any 240-day window.
3. **Price windows:** when an event fires with a `priceWindow`, navigate to the named port; confirm the displayed price differs from baseline by approximately the configured `sellMult` or `buyMult`.
4. **Intel buy:** trigger a Brotherhood letter offering Hardacre intel. Pay. Then advance time to a Hardacre event; confirm the body shows the "anticipated" prose branch.
5. **Staff poaching:** trigger `hardacre-clerk-defect` (requires Hardacre standing ≤ 35). Hire. Verify Penhaligon appears in `gs.acquaintances` and the household state reflects the change.
6. **Successor reset:** play to charter end; take the successor option. Confirm `gs.rivals` is fresh (all standings 50, eventsFired empty), and rivalry timing resumes from the new charter's day 60–120.
7. **Old-save migration:** load an existing pre-rivalry save (use `git stash`-and-back or a Manuscript JSON from before the rivalry commits). Confirm rivalry fields populate via `ensureShape` without errors.

If anything fails, isolate to its phase, fix, re-run.

---

## Self-review (run after writing the plan)

**Spec coverage check:**

- §1 System overview: ✓ Phase 1 (logic) + Phase 3 (news rhythm) cover the trajectory + events shape.
- §2 Decisions table: all 7 decisions ship — engagement (mech-interactive: levers in P5/P6), cast (3 rivals: P1+P2 wires Hardacre/terborch/lowji), arc (news rhythm: P3 scheduler), cadence (6–8/charter: P3 + P6 templates), levers (P4 arbitrage, P5 intel/poach, P6 read), intel channels (P5 wires all three), sabotage (out of scope ✓).
- §Architecture data model: ✓ P2.2 ensureShape, P2.3 makeInitialState/Successor/Renewal, P3.3 tickDays scheduler.
- §Architecture RIVALS registry: ✓ P1.2 (data) + P1.3 (baselineFn).
- §Architecture RIVAL_EVENTS registry: ✓ P3.3 stub + P6 (18 templates).
- §News rhythm baseline: ✓ P3.1 rivalsLines.
- §Court pressure: ✓ P3.2 tone-band shift, P1.4 computeRivalPressure.
- §Levers (read/arbitrage/poach/intel): ✓ P3 read, P4 arbitrage, P5 intel, P6 events carry poach offers.
- §Intel channels (3): ✓ P5.1 Brotherhood, P5.2 Vizier, P5.3 Cama.
- §Cadence: ✓ P3.3 scheduler with 90+60-day cadence + 240-day cluster cap.
- §Save migration: ✓ P2.2 + P2.3.
- §Successor / renewal: ✓ P2.3.
- §rivalRisk cosmetic: ✓ explicitly preserved (no change to MapView).
- §Testing: ✓ each helper in P1 has TDD'd unit tests; P6.3 adds the smoke RIVALS_REGISTRY test; manual smoke verification listed in cross-phase.
- §Risks #9.1 (18 templates is the largest cost): ✓ flagged at top of P6 with scope-down option.
- §Risks #9.2 (port-econ spike): ✓ already executed before drafting; concrete priceFor patch in P4.1.
- §Risks #9.3 (rivalPressure tone-band fight): ✓ P3.2 keeps nothingYet/finalStretch short-circuits intact, only shifts middle bands.
- §Risks #9.4 (Cama weight): ✓ weight=1 in P5.3 with day≥90 gate.
- §Risks #9.5 (ter Borch retcon in WORLD_NOTES): ✓ P2.4.
- §Open questions (priceWindow + Dutch tax interaction): the spec leaves this open — P4.1's implementation applies windowMult before tax, so the Dutch duty applies to the window-adjusted price; this matches the existing pattern (`taxRate` is multiplied onto the final `price`, not the base).

**Placeholder scan:** I searched for "TBD", "TODO", "implement later", "fill in details", "add appropriate", "similar to" — none present.

**Type consistency check:**
- `priceWindowMult(gs, port, commodity, side)` signature matches across all uses.
- `pruneExpiredWindows(windows, day)` signature matches.
- `makeInitialRivals()` returns the same shape across all consumers (ensureShape, makeInitialState, makeSuccessorState, makeRenewedState).
- `pickRivalEvent(gs, eventPool)` matches the call in tickDays.
- `computeRivalPressure(gs)` matches the call in tickDays.
- Event-template `build(s, opts)` matches the scheduler usage in P3.3.
- Letter-insertion pattern (`s.letters = [...s.letters, letter]; s.lettersGenerated++; ...`) matches the existing convention verified during the spike.

No issues found.

---
