import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOrFetch, markLoaded, readCache, writeCache,
  CACHE_KEY, MAX_ENTRIES, buildPollinationsUrl,
} from './illustration-cache.js';

function makeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _store: store,
  };
}

describe('getOrFetch', () => {
  let storage;
  beforeEach(() => { storage = makeStorage(); });

  it('returns fetching status for a fresh prose', () => {
    const { url, status, hash } = getOrFetch(storage, 'a sail to leeward');
    expect(status).toBe('fetching');
    expect(url).toMatch(/^https:\/\/image\.pollinations\.ai/);
    expect(hash).toBeTruthy();
  });

  it('returns cached status after markLoaded', () => {
    const a = getOrFetch(storage, 'a sail to leeward');
    markLoaded(storage, a.hash, a.url);
    const b = getOrFetch(storage, 'a sail to leeward');
    expect(b.status).toBe('cached');
    expect(b.url).toBe(a.url);
  });

  it('returns empty status for empty prose', () => {
    expect(getOrFetch(storage, '').status).toBe('empty');
    expect(getOrFetch(storage, undefined).status).toBe('empty');
    expect(getOrFetch(storage, '   ').status).toBe('empty');
  });

  it('produces identical urls for identical prose', () => {
    const a = getOrFetch(storage, 'the same scene');
    const b = getOrFetch(makeStorage(), 'the same scene');
    expect(a.url).toBe(b.url);
  });
});

describe('LRU eviction', () => {
  it('keeps cache at MAX_ENTRIES after writing more', () => {
    const storage = makeStorage();
    let cache = {};
    for (let i = 0; i < MAX_ENTRIES + 10; i++) {
      cache[`hash${i}`] = { url: `u${i}`, fetchedAt: i, viewedAt: i };
    }
    cache = writeCache(storage, cache);
    expect(Object.keys(cache)).toHaveLength(MAX_ENTRIES);
    // Should keep the most-recently-viewed entries (highest viewedAt)
    expect(cache[`hash${MAX_ENTRIES + 9}`]).toBeDefined();
    expect(cache[`hash0`]).toBeUndefined();
  });
});

describe('buildPollinationsUrl', () => {
  it('encodes prose into the URL', () => {
    const url = buildPollinationsUrl('a junk passes close to leeward');
    expect(url).toMatch(/^https:\/\/image\.pollinations\.ai\/prompt\//);
    expect(url).toContain('width=480');
    expect(url).toContain('height=320');
    expect(url).toContain('seed=');
  });
});
