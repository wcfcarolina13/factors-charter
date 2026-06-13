import { describe, it, expect } from 'vitest';
import {
  VENTURES, accrueVentureIncome, ventureUnlocked, ventureBuyMult, ventureQuarterlyIncome,
  accrueVentureProduce, ventureWorth, venturesWorth, establishedVentureCount,
  VENTURE_EVENTS, pickVentureEvent,
} from './ventures.js';

describe('ventureUnlocked', () => {
  it('is true for ventures with no prerequisite', () => {
    expect(ventureUnlocked('coastal_trader', {})).toBe(true);
  });
  it('gates the country ship behind the coastal trader', () => {
    expect(ventureUnlocked('country_ship', {})).toBe(false);
    expect(ventureUnlocked('country_ship', { coastal_trader: { established: true } })).toBe(true);
  });
  it('is false for an unknown id', () => {
    expect(ventureUnlocked('nope', {})).toBe(false);
  });
});

describe('accrueVentureIncome', () => {
  it('pays nothing before a quarter elapses', () => {
    const state = { coastal_trader: { established: true, establishedDay: 100, lastPaidDay: 100 } };
    const r = accrueVentureIncome(state, 180); // 80 days < 90
    expect(r.income).toBe(0);
    expect(r.lines).toEqual([]);
  });
  it('pays one quarter and advances lastPaidDay by 90', () => {
    const state = { coastal_trader: { established: true, establishedDay: 100, lastPaidDay: 100 } };
    const r = accrueVentureIncome(state, 195); // 95 days
    expect(r.income).toBe(VENTURES.coastal_trader.income);
    expect(r.ventures.coastal_trader.lastPaidDay).toBe(190);
    expect(r.lines[0].amount).toBe(90);
  });
  it('catches up multiple quarters at once', () => {
    const state = { bazaar_stake: { established: true, establishedDay: 0, lastPaidDay: 0 } };
    const r = accrueVentureIncome(state, 280); // 3 quarters (270)
    expect(r.income).toBe(VENTURES.bazaar_stake.income * 3);
    expect(r.ventures.bazaar_stake.lastPaidDay).toBe(270);
  });
  it('sums income across multiple established ventures', () => {
    const state = {
      coastal_trader: { established: true, lastPaidDay: 0 },
      bazaar_stake: { established: true, lastPaidDay: 0 },
    };
    const r = accrueVentureIncome(state, 90);
    expect(r.income).toBe(90 + 70);
    expect(r.lines).toHaveLength(2);
  });
  it('ignores non-income ventures (the agent) and unestablished ones', () => {
    const state = {
      kota_agent: { established: true, lastPaidDay: 0 },
      country_ship: { established: false, lastPaidDay: 0 },
    };
    const r = accrueVentureIncome(state, 200);
    expect(r.income).toBe(0);
  });
  it('handles empty/missing state', () => {
    expect(accrueVentureIncome(undefined, 100)).toEqual({ ventures: {}, income: 0, lines: [] });
  });
});

describe('ventureBuyMult', () => {
  it('discounts pepper at Kota Pinang with the agent', () => {
    const state = { kota_agent: { established: true } };
    expect(ventureBuyMult(state, 'Kota Pinang', 'pepper')).toBe(0.9);
    expect(ventureBuyMult(state, 'Kota Pinang', 'rice')).toBe(1);   // not covered
    expect(ventureBuyMult(state, 'Port St. Eustace', 'pepper')).toBe(1); // wrong port
  });
  it('is 1 with no agent', () => {
    expect(ventureBuyMult({}, 'Kota Pinang', 'pepper')).toBe(1);
  });
});

describe('ventureQuarterlyIncome', () => {
  it('totals income ventures only', () => {
    const state = {
      coastal_trader: { established: true },
      kota_agent: { established: true },
      bazaar_stake: { established: true },
    };
    expect(ventureQuarterlyIncome(state)).toBe(90 + 70);
  });
});

describe('accrueVentureProduce', () => {
  it('produces nothing before a quarter elapses', () => {
    const state = { pepper_garden: { established: true, establishedDay: 100, lastPaidDay: 100 } };
    const r = accrueVentureProduce(state, 180); // 80 days < 90
    expect(r.yields).toEqual([]);
  });
  it('lodges one quarter of pepper and advances lastPaidDay by 90', () => {
    const state = { pepper_garden: { established: true, establishedDay: 100, lastPaidDay: 100 } };
    const r = accrueVentureProduce(state, 195); // 95 days
    expect(r.yields).toHaveLength(1);
    expect(r.yields[0]).toMatchObject({ commodity: 'pepper', amount: 16 });
    expect(r.ventures.pepper_garden.lastPaidDay).toBe(190);
  });
  it('catches up multiple quarters at once', () => {
    const state = { pepper_garden: { established: true, establishedDay: 0, lastPaidDay: 0 } };
    const r = accrueVentureProduce(state, 280); // 3 quarters (270)
    expect(r.yields[0].amount).toBe(16 * 3);
    expect(r.ventures.pepper_garden.lastPaidDay).toBe(270);
  });
  it('yields both commodities for the spice estate', () => {
    const state = { spice_estate: { established: true, lastPaidDay: 0 } };
    const r = accrueVentureProduce(state, 90);
    const byCom = Object.fromEntries(r.yields.map(y => [y.commodity, y.amount]));
    expect(byCom.cinnamon).toBe(10);
    expect(byCom.pepper).toBe(6);
  });
  it('ignores income ventures and unestablished ones', () => {
    const state = {
      bazaar_stake: { established: true, lastPaidDay: 0 },     // income, not produce
      pepper_garden: { established: false, lastPaidDay: 0 },   // not established
    };
    const r = accrueVentureProduce(state, 200);
    expect(r.yields).toEqual([]);
  });
  it('handles empty/missing state', () => {
    expect(accrueVentureProduce(undefined, 100)).toEqual({ ventures: {}, yields: [] });
  });
});

describe('ventureWorth / venturesWorth / establishedVentureCount', () => {
  it('values a bought venture at its cost', () => {
    expect(ventureWorth('coastal_trader', { established: true })).toBe(600);
  });
  it('capitalizes a quest income venture with no cost', () => {
    // bristol_concern: income 110, no cost → 110 * 8
    expect(ventureWorth('bristol_concern', { established: true })).toBe(880);
  });
  it('is zero for an unestablished or unknown venture', () => {
    expect(ventureWorth('coastal_trader', { established: false })).toBe(0);
    expect(ventureWorth('nope', { established: true })).toBe(0);
  });
  it('sums book value across established ventures only', () => {
    const state = {
      coastal_trader: { established: true },   // 600
      bristol_concern: { established: true },  // 880
      country_ship: { established: false },    // ignored
    };
    expect(venturesWorth(state)).toBe(600 + 880);
  });
  it('counts only established ventures', () => {
    const state = {
      coastal_trader: { established: true },
      kota_agent: { established: true },
      country_ship: { established: false },
    };
    expect(establishedVentureCount(state)).toBe(2);
  });
  it('is zero/empty for empty state', () => {
    expect(venturesWorth({})).toBe(0);
    expect(establishedVentureCount(undefined)).toBe(0);
  });
});

describe('VENTURE_EVENTS registry integrity', () => {
  it('every event references a real venture and has unique ids', () => {
    const ids = new Set();
    for (const e of VENTURE_EVENTS) {
      expect(VENTURES[e.venture], `${e.id} → ${e.venture}`).toBeTruthy();
      expect(ids.has(e.id), `dup id ${e.id}`).toBe(false);
      ids.add(e.id);
      expect(typeof e.text).toBe('string');
      // an event must do *something*
      expect(e.money !== undefined || e.produce !== undefined || e.hook !== undefined).toBe(true);
    }
  });
});

describe('pickVentureEvent', () => {
  it('returns null when no venture is established', () => {
    expect(pickVentureEvent({}, [], 0)).toBeNull();
    expect(pickVentureEvent({ coastal_trader: { established: false } }, [], 0)).toBeNull();
  });
  it('only picks events whose venture is established', () => {
    const state = { bazaar_stake: { established: true } };
    for (let i = 0; i < 20; i++) {
      const e = pickVentureEvent(state, [], i / 20);
      expect(e.venture).toBe('bazaar_stake');
    }
  });
  it('excludes ids in the exclude list (spent once-events + anti-repeat)', () => {
    const state = { kota_agent: { established: true } };
    // kota_agent has agent_intel (once) + agent_gift; exclude the gift → only intel left
    const e = pickVentureEvent(state, ['agent_gift'], 0.99);
    expect(e.id).toBe('agent_intel');
  });
  it('returns null if every eligible event is excluded', () => {
    const state = { kota_agent: { established: true } };
    expect(pickVentureEvent(state, ['agent_intel', 'agent_gift'], 0.5)).toBeNull();
  });
  it('roll 0 picks the first eligible, roll near 1 picks the last', () => {
    const state = { coastal_trader: { established: true } }; // prize, storm (in order)
    expect(pickVentureEvent(state, [], 0).id).toBe('kingfisher_prize');
    expect(pickVentureEvent(state, [], 0.999).id).toBe('kingfisher_storm');
  });
});
