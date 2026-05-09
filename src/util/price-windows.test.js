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
