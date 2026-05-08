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
