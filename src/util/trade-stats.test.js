import { describe, it, expect } from 'vitest';
import { recordTrade, reckonRows, reckonTotal } from './trade-stats.js';

describe('recordTrade', () => {
  it('accumulates buys', () => {
    let s = recordTrade({}, { kind: 'buy', commodity: 'pepper', qty: 10, amount: 30 });
    s = recordTrade(s, { kind: 'buy', commodity: 'pepper', qty: 5, amount: 20 });
    expect(s.pepper).toEqual({ boughtQty: 15, boughtCost: 50, soldQty: 0, soldProceeds: 0 });
  });

  it('accumulates sells separately from buys', () => {
    let s = recordTrade({}, { kind: 'buy', commodity: 'rum', qty: 4, amount: 24 });
    s = recordTrade(s, { kind: 'sell', commodity: 'rum', qty: 2, amount: 20 });
    expect(s.rum).toEqual({ boughtQty: 4, boughtCost: 24, soldQty: 2, soldProceeds: 20 });
  });

  it('does not mutate the input stats', () => {
    const before = { rice: { boughtQty: 1, boughtCost: 2, soldQty: 0, soldProceeds: 0 } };
    recordTrade(before, { kind: 'buy', commodity: 'rice', qty: 1, amount: 2 });
    expect(before.rice.boughtQty).toBe(1);
  });

  it('ignores junk input', () => {
    expect(recordTrade({}, { kind: 'buy', commodity: '', qty: 1, amount: 2 })).toEqual({});
    expect(recordTrade({}, { kind: 'buy', commodity: 'rice', qty: 0, amount: 2 })).toEqual({});
    expect(recordTrade({}, { kind: 'buy', commodity: 'rice', qty: 1, amount: -1 })).toEqual({});
    expect(recordTrade(undefined, { kind: 'buy', commodity: '', qty: 0, amount: 0 })).toEqual({});
  });
});

describe('reckonRows', () => {
  it('computes margin against average buy price', () => {
    let s = recordTrade({}, { kind: 'buy', commodity: 'pepper', qty: 10, amount: 30 }); // avg 3
    s = recordTrade(s, { kind: 'sell', commodity: 'pepper', qty: 6, amount: 36 }); // avg 6
    const [row] = reckonRows(s);
    expect(row.avgBuy).toBe(3);
    expect(row.avgSell).toBe(6);
    expect(row.realized).toBe(36 - 6 * 3);
    expect(row.costBasisKnown).toBe(true);
  });

  it('treats goods sold without purchase as pure proceeds, flagged', () => {
    const s = recordTrade({}, { kind: 'sell', commodity: 'sandalwood', qty: 3, amount: 15 });
    const [row] = reckonRows(s);
    expect(row.realized).toBe(15);
    expect(row.costBasisKnown).toBe(false);
    expect(row.avgBuy).toBeNull();
  });

  it('shows bought-but-unsold commodities with zero realized', () => {
    const s = recordTrade({}, { kind: 'buy', commodity: 'calico', qty: 5, amount: 25 });
    const [row] = reckonRows(s);
    expect(row.realized).toBe(0);
    expect(row.soldQty).toBe(0);
  });

  it('sorts best realized first and totals correctly', () => {
    let s = recordTrade({}, { kind: 'buy', commodity: 'rice', qty: 10, amount: 20 });
    s = recordTrade(s, { kind: 'sell', commodity: 'rice', qty: 10, amount: 15 }); // -5
    s = recordTrade(s, { kind: 'sell', commodity: 'pearls', qty: 1, amount: 60 }); // +60
    const rows = reckonRows(s);
    expect(rows.map(r => r.commodity)).toEqual(['pearls', 'rice']);
    expect(reckonTotal(s)).toBe(55);
  });

  it('handles empty and missing stats', () => {
    expect(reckonRows({})).toEqual([]);
    expect(reckonRows(undefined)).toEqual([]);
    expect(reckonTotal(undefined)).toBe(0);
  });
});
