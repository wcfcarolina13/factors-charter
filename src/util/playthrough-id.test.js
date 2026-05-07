import { describe, it, expect } from 'vitest';
import { generatePlaythroughId, isValidPlaythroughId, NOUNS, MODIFIERS, MARITIME, ID_PATTERN } from './playthrough-id.js';

describe('generatePlaythroughId', () => {
  it('produces a string matching the canonical format', () => {
    for (let i = 0; i < 50; i++) {
      const id = generatePlaythroughId();
      expect(id).toMatch(ID_PATTERN);
    }
  });

  it('produces three lowercase word segments and a 4-digit suffix', () => {
    const id = generatePlaythroughId();
    const parts = id.split('-');
    expect(parts).toHaveLength(4);
    expect(parts[3]).toMatch(/^\d{4}$/);
  });

  it('produces high entropy across many calls', () => {
    const ids = new Set();
    for (let i = 0; i < 200; i++) ids.add(generatePlaythroughId());
    // 200 random IDs over a ~327M space should produce 200 unique results
    // overwhelmingly often. If duplicates exceed ~1, generate is broken.
    expect(ids.size).toBeGreaterThan(195);
  });
});

describe('isValidPlaythroughId', () => {
  it('accepts a valid ID', () => {
    expect(isValidPlaythroughId('pelican-salt-pepper-1923')).toBe(true);
  });

  it('accepts every output of generatePlaythroughId', () => {
    for (let i = 0; i < 50; i++) {
      expect(isValidPlaythroughId(generatePlaythroughId())).toBe(true);
    }
  });

  it('rejects malformed IDs', () => {
    expect(isValidPlaythroughId('')).toBe(false);
    expect(isValidPlaythroughId('not-an-id')).toBe(false);
    expect(isValidPlaythroughId('pelican-salt-pepper')).toBe(false);
    expect(isValidPlaythroughId('pelican-salt-pepper-12')).toBe(false);
    expect(isValidPlaythroughId('Pelican-Salt-Pepper-1923')).toBe(false);
    expect(isValidPlaythroughId('pelican_salt_pepper_1923')).toBe(false);
    expect(isValidPlaythroughId(undefined)).toBe(false);
    expect(isValidPlaythroughId(null)).toBe(false);
    expect(isValidPlaythroughId(42)).toBe(false);
  });

  it('does not check wordlist membership (loose validation)', () => {
    expect(isValidPlaythroughId('foo-bar-baz-1234')).toBe(true);
  });
});

describe('vocabulary arrays', () => {
  it('all three lists have at least 32 entries', () => {
    expect(NOUNS.length).toBeGreaterThanOrEqual(32);
    expect(MODIFIERS.length).toBeGreaterThanOrEqual(32);
    expect(MARITIME.length).toBeGreaterThanOrEqual(32);
  });

  it('all words are lowercase ASCII letters only', () => {
    const onlyLower = /^[a-z]+$/;
    for (const w of [...NOUNS, ...MODIFIERS, ...MARITIME]) {
      expect(w).toMatch(onlyLower);
    }
  });
});
