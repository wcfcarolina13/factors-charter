import { describe, it, expect } from 'vitest';
import { nextAmbition } from './ambition.js';

describe('nextAmbition', () => {
  const ASP = [
    { key: 'a', label: 'raise the chapel', cost: 120 },
    { key: 'b', label: 'commission the brigantine', cost: 900 },
    { key: 'c', label: 'take up the bazaar stake', cost: 800 },
  ];

  it('points at the NEAREST unaffordable rung (smallest gap), not the cheapest', () => {
    // money 750: chapel affordable; bazaar gap 50, brigantine gap 150 → bazaar wins
    const r = nextAmbition({ money: 750, aspirations: ASP });
    expect(r.kind).toBe('reach');
    expect(r.key).toBe('c');
    expect(r.gap).toBe(50);
  });

  it('gap is cost minus money', () => {
    const r = nextAmbition({ money: 0, aspirations: [{ key: 'x', label: 'x', cost: 430 }] });
    expect(r).toMatchObject({ kind: 'reach', gap: 430, cost: 430 });
  });

  it('when all are affordable, points at the grandest unowned thing', () => {
    const r = nextAmbition({ money: 5000, aspirations: ASP });
    expect(r.kind).toBe('afford');
    expect(r.key).toBe('b'); // the £900 brigantine
    expect(r.gap).toBe(0);
  });

  it('falls back to the quota when no aspirations remain', () => {
    const r = nextAmbition({
      money: 9999,
      aspirations: [],
      quota: { pepper: { needed: 400, secured: 360 }, cinnamon: { needed: 200, secured: 200 } },
    });
    expect(r).toEqual({ kind: 'quota', pepGap: 40, cinGap: 0 });
  });

  it('reports quota-met when nothing is left and the quota is filled', () => {
    const r = nextAmbition({
      money: 9999,
      aspirations: [],
      quota: { pepper: { needed: 400, secured: 400 }, cinnamon: { needed: 200, secured: 250 } },
    });
    expect(r).toEqual({ kind: 'quota-met' });
  });

  it('returns null with no aspirations and no quota', () => {
    expect(nextAmbition({ money: 100, aspirations: [] })).toBeNull();
  });

  it('handles missing/empty input', () => {
    expect(nextAmbition()).toBeNull();
    expect(nextAmbition({})).toBeNull();
  });

  it('ignores malformed aspiration entries', () => {
    const r = nextAmbition({ money: 0, aspirations: [null, { label: 'no cost' }, { key: 'ok', label: 'ok', cost: 50 }] });
    expect(r.key).toBe('ok');
  });
});
