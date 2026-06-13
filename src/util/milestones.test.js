import { describe, it, expect } from 'vitest';
import { WEALTH_MILESTONES, pendingWealthMilestones, seedWealthFlags } from './milestones.js';

describe('pendingWealthMilestones', () => {
  it('returns nothing below the first threshold', () => {
    expect(pendingWealthMilestones(999, {})).toEqual([]);
  });

  it('returns the crossed, unflagged milestone', () => {
    const p = pendingWealthMilestones(1200, {});
    expect(p).toHaveLength(1);
    expect(p[0].flag).toBe('wealth_1k');
  });

  it('returns multiple when a big gain crosses several at once, lowest first', () => {
    const p = pendingWealthMilestones(6000, {});
    expect(p.map(m => m.flag)).toEqual(['wealth_1k', 'wealth_2_5k', 'wealth_5k']);
  });

  it('skips already-flagged milestones', () => {
    const p = pendingWealthMilestones(3000, { wealth_1k: true });
    expect(p.map(m => m.flag)).toEqual(['wealth_2_5k']);
  });

  it('handles junk input', () => {
    expect(pendingWealthMilestones(undefined, undefined)).toEqual([]);
    expect(pendingWealthMilestones(NaN, {})).toEqual([]);
  });
});

describe('seedWealthFlags', () => {
  it('marks every met threshold without touching unmet ones', () => {
    const seeded = seedWealthFlags(3000, {});
    expect(seeded.wealth_1k).toBe(true);
    expect(seeded.wealth_2_5k).toBe(true);
    expect(seeded.wealth_5k).toBeUndefined();
  });

  it('returns the same reference when nothing changes', () => {
    const flags = { wealth_1k: true };
    expect(seedWealthFlags(500, flags)).toBe(flags);          // below threshold
    expect(seedWealthFlags(1200, { wealth_1k: true })).toEqual({ wealth_1k: true });
  });

  it('preserves unrelated flags', () => {
    const seeded = seedWealthFlags(1200, { teakConcession: true });
    expect(seeded.teakConcession).toBe(true);
    expect(seeded.wealth_1k).toBe(true);
  });

  it('after seeding, pending is empty (no retroactive fire)', () => {
    const seeded = seedWealthFlags(6000, {});
    expect(pendingWealthMilestones(6000, seeded)).toEqual([]);
  });
});
