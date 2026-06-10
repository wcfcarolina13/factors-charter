import { describe, it, expect, beforeEach } from 'vitest';
import {
  getOrFetch, markLoaded, readCache, writeCache,
  CACHE_KEY, MAX_ENTRIES, buildIllustrationUrl,
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
    expect(url).toMatch(/^\/api\/illustrate\?/);
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

  it('handles null storage gracefully', () => {
    const result = getOrFetch(null, 'a junk passes close');
    expect(result.status).toBe('fetching');
    expect(result.url).toMatch(/^\/api\/illustrate\?/);
  });
});

describe('markLoaded', () => {
  it('is idempotent — second call does not overwrite the first', () => {
    const storage = makeStorage();
    const { hash, url } = getOrFetch(storage, 'a sail to leeward');
    markLoaded(storage, hash, url);
    markLoaded(storage, hash, 'https://different-url.com/image.jpg');
    const reread = getOrFetch(storage, 'a sail to leeward');
    expect(reread.url).toBe(url);
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

describe('quota-exceeded fallback', () => {
  it('retries with a 20-entry trim when setItem throws once', () => {
    const storage = makeStorage();
    let threw = false;
    const realSet = storage.setItem;
    storage.setItem = (k, v) => {
      if (!threw) { threw = true; throw new Error('QuotaExceededError'); }
      realSet(k, v);
    };
    let cache = {};
    for (let i = 0; i < 40; i++) {
      cache[`hash${i}`] = { url: `u${i}`, fetchedAt: i, viewedAt: i };
    }
    cache = writeCache(storage, cache);
    expect(Object.keys(cache)).toHaveLength(20);
    expect(cache['hash39']).toBeDefined();
    expect(cache['hash0']).toBeUndefined();
    const persisted = JSON.parse(storage.getItem(CACHE_KEY));
    expect(Object.keys(persisted)).toHaveLength(20);
  });

  it('keeps the in-memory copy when storage keeps failing', () => {
    const storage = makeStorage();
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    const cache = { a: { url: 'u', fetchedAt: 1, viewedAt: 1 } };
    const result = writeCache(storage, cache);
    expect(result.a).toBeDefined();
    expect(storage.getItem(CACHE_KEY)).toBeNull();
  });
});

describe('buildIllustrationUrl', () => {
  it('encodes prose into the URL', () => {
    const url = buildIllustrationUrl('a junk passes close to leeward');
    expect(url).toMatch(/^\/api\/illustrate\?/);
    expect(url).toContain('prompt=');
    expect(url).toContain('seed=');
  });
});
