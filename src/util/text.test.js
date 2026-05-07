import { describe, it, expect } from 'vitest';
import { stableHash, cleanProse } from './text.js';

describe('stableHash', () => {
  it('returns a non-empty string', () => {
    expect(stableHash('hello')).toMatch(/^[0-9a-z]+$/);
  });
  it('returns the same hash for the same input', () => {
    expect(stableHash('a voyage encounter at sea')).toBe(stableHash('a voyage encounter at sea'));
  });
  it('hash value is pinned for cache key stability across versions', () => {
    // If this test fails, the hash function changed and ALL existing
    // illustration-cache entries on every player's device will be orphaned.
    // Don't update this without also bumping the cache key version.
    expect(stableHash('a voyage encounter at sea')).toBe('2c7umwf');
  });
  it('returns different hashes for different inputs', () => {
    expect(stableHash('alpha')).not.toBe(stableHash('beta'));
  });
  it('handles empty / undefined input without throwing', () => {
    expect(stableHash('')).toBe('1');
    expect(stableHash(undefined)).toBe('1');
  });
});

describe('cleanProse', () => {
  it('collapses whitespace runs to single spaces', () => {
    expect(cleanProse('a  b\n\tc')).toBe('a b c');
  });
  it('trims leading and trailing whitespace', () => {
    expect(cleanProse('  hello  ')).toBe('hello');
  });
  it('caps at 320 characters', () => {
    const long = 'x'.repeat(500);
    expect(cleanProse(long)).toHaveLength(320);
  });
  it('handles empty / undefined input', () => {
    expect(cleanProse('')).toBe('');
    expect(cleanProse(undefined)).toBe('');
  });
});
