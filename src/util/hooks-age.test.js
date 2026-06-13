import { describe, it, expect } from 'vitest';
import {
  reconcileHookMeta, hookAge, hookAgeNote, staleHookCount, STALE_AFTER_DAYS,
} from './hooks-age.js';

describe('reconcileHookMeta', () => {
  it('stamps new hooks with the given day, preserves known stamps', () => {
    const meta = reconcileHookMeta(['a'], {}, 10);
    expect(meta).toEqual({ a: 10 });
    const meta2 = reconcileHookMeta(['a', 'b'], meta, 25);
    expect(meta2).toEqual({ a: 10, b: 25 }); // 'a' keeps its original stamp
  });

  it('drops meta for hooks no longer open', () => {
    const meta = reconcileHookMeta(['a', 'b'], { a: 1, b: 2 }, 5);
    const after = reconcileHookMeta(['a'], meta, 9);
    expect(after).toEqual({ a: 1 });
  });

  it('re-raised hook re-stamps fresh (text is the identity)', () => {
    let meta = reconcileHookMeta(['a'], {}, 5);
    meta = reconcileHookMeta([], meta, 8);       // closed
    meta = reconcileHookMeta(['a'], meta, 50);   // re-raised
    expect(meta).toEqual({ a: 50 });
  });

  it('tolerates junk input', () => {
    expect(reconcileHookMeta(undefined, undefined, 3)).toEqual({});
    expect(reconcileHookMeta([null, 5, 'ok'], {}, 3)).toEqual({ ok: 3 });
  });
});

describe('hookAge', () => {
  it('returns elapsed days', () => {
    expect(hookAge('a', { a: 10 }, 40)).toBe(30);
  });
  it('returns null for untracked or future stamps', () => {
    expect(hookAge('a', {}, 40)).toBeNull();
    expect(hookAge('a', { a: 50 }, 40)).toBeNull();
  });
});

describe('hookAgeNote', () => {
  it('is null when fresh (<30 days)', () => {
    expect(hookAgeNote('a', { a: 100 }, 120)).toBeNull();
  });
  it('marks an ordinary note between 30 and the stale threshold', () => {
    const note = hookAgeNote('a', { a: 0 }, 60);
    expect(note).toEqual({ text: 'noted 60 days past', stale: false });
  });
  it('marks stale at and beyond the threshold', () => {
    const note = hookAgeNote('a', { a: 0 }, STALE_AFTER_DAYS);
    expect(note.stale).toBe(true);
    expect(note.text).toContain(`${STALE_AFTER_DAYS}`);
  });
});

describe('staleHookCount', () => {
  it('counts only threads past the threshold', () => {
    const meta = { old: 0, mid: 100, fresh: 195 };
    const day = 200;
    expect(staleHookCount(['old', 'mid', 'fresh'], meta, day)).toBe(1); // only 'old' (200d) >= 120
  });
  it('is 0 on empty/untracked', () => {
    expect(staleHookCount([], {}, 200)).toBe(0);
    expect(staleHookCount(['x'], {}, 200)).toBe(0);
  });
});
