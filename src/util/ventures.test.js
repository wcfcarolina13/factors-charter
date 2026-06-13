import { describe, it, expect } from 'vitest';
import {
  VENTURES, accrueVentureIncome, ventureUnlocked, ventureBuyMult, ventureQuarterlyIncome,
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
