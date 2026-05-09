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

import {
  hardacreBaseline,
  terBorchBaseline,
  lowjiBaseline,
} from './rivalry.js';

import { computeRivalPressure } from './rivalry.js';

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
    // Uses a local pool with maxDay: 1100 so events remain eligible at day 1000.
    const gs = gsWith({ day: 1000 });
    gs.rivals.hardacre.lastEventDay = 0;     // very stale
    gs.rivals.terborch.lastEventDay = 900;   // recent
    gs.rivals.lowji.lastEventDay = 950;      // recent

    const wideEvents = [
      { key: 'hardacre-fire', rival: 'hardacre', minDay: 100, maxDay: 1100, preconditions: () => true, build: () => ({ id: 1 }) },
      { key: 'terborch-prom', rival: 'terborch', minDay: 200, maxDay: 1100, preconditions: () => true, build: () => ({ id: 2 }) },
      { key: 'lowji-glut',    rival: 'lowji',    minDay: 100, maxDay: 1100, preconditions: () => true, build: () => ({ id: 3 }) },
    ];

    const counts = { hardacre: 0, terborch: 0, lowji: 0 };
    for (let i = 0; i < 200; i++) {
      const ev = pickRivalEvent(gs, wideEvents);
      if (ev) counts[ev.rival]++;
    }
    expect(counts.hardacre).toBeGreaterThan(counts.terborch);
    expect(counts.hardacre).toBeGreaterThan(counts.lowji);
  });
});

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
