import { describe, it, expect } from 'vitest';
import { priceWindowMult, pruneExpiredWindows, activeWindowsFor, priceDrift } from './price-windows.js';

describe('activeWindowsFor', () => {
  const gs = {
    day: 100,
    priceWindows: [
      { port: 'Kota Pinang', commodity: 'pepper', sellMult: 1.25, expiresDay: 160, label: 'the fire' },
      { port: 'Kota Pinang', commodity: 'pepper', buyMult: 0.9, expiresDay: 160 },
      { port: 'Kota Pinang', commodity: 'pepper', sellMult: 1.1, expiresDay: 100 }, // expired today
      { port: 'Bayan-Kor', commodity: 'pepper', sellMult: 1.1, expiresDay: 160 },   // other port
    ],
  };

  it('matches port, commodity, side, and unexpired only', () => {
    const got = activeWindowsFor(gs, 'Kota Pinang', 'pepper', 'sell');
    expect(got).toHaveLength(1);
    expect(got[0].label).toBe('the fire');
  });

  it('matches the buy side independently', () => {
    expect(activeWindowsFor(gs, 'Kota Pinang', 'pepper', 'buy')).toHaveLength(1);
  });

  it('returns [] on missing state', () => {
    expect(activeWindowsFor({}, 'Kota Pinang', 'pepper', 'sell')).toEqual([]);
    expect(activeWindowsFor(undefined, 'Kota Pinang', 'pepper', 'sell')).toEqual([]);
  });
});

describe('priceDrift', () => {
  it('tags low at 6% under fair and high at 6% over', () => {
    expect(priceDrift(94, 100)).toBe('low');
    expect(priceDrift(106, 100)).toBe('high');
  });

  it('tags par inside the band and on degenerate input', () => {
    expect(priceDrift(100, 100)).toBe('par');
    expect(priceDrift(105, 100)).toBe('par');
    expect(priceDrift(95, 100)).toBe('par');
    expect(priceDrift(10, 0)).toBe('par');
  });
});

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
