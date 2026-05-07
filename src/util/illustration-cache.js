import { stableHash, cleanProse } from './text.js';

const CACHE_KEY = 'factor_illustration_cache_v1';
const MAX_ENTRIES = 50;
const POLLINATIONS_PREFIX = 'https://image.pollinations.ai/prompt/';
// Must match the existing IMAGINE_STYLE_PREFIX in factors_charter.jsx.
// Kept duplicated here so the cache module is self-contained for tests.
const STYLE_PREFIX = '1720s logbook engraving, period woodcut style, sepia line illustration, single-color brown ink on cream parchment, period 18th century book illustration. ';

// Read the cache from localStorage. Returns {} on parse failure or absence.
function readCache(storage) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

// Write the cache to localStorage, evicting oldest viewedAt entries down to
// MAX_ENTRIES. Mutates input by sorting; clone first if the caller cares.
function writeCache(storage, cache) {
  if (!storage) return cache;
  const entries = Object.entries(cache);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => (b[1].viewedAt || 0) - (a[1].viewedAt || 0));
    cache = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
  }
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) { /* quota exceeded — silently keep in-memory copy */ }
  return cache;
}

// Build the Pollinations URL for a given prose string. Same logic as the
// existing IllustrationModal so cached + on-demand paths produce identical
// images for identical scenes.
function buildPollinationsUrl(prose) {
  const clean = cleanProse(prose);
  const fullPrompt = STYLE_PREFIX + clean;
  const seed = parseInt(stableHash(clean), 36) || 1;
  return `${POLLINATIONS_PREFIX}${encodeURIComponent(fullPrompt)}?width=480&height=320&nologo=true&seed=${seed}&model=flux`;
}

// getOrFetch returns { url, status, hash } for a given prose. Status is
// 'cached' if the entry already exists in storage, 'fetching' if a new URL
// is being returned for the first time. The caller renders an <img>; when
// the <img> fires onLoad, the caller should call markLoaded(hash) to commit
// the URL into the cache (this avoids caching URLs that fail to render).
export function getOrFetch(storage, prose) {
  const clean = cleanProse(prose);
  if (!clean) return { url: null, status: 'empty', hash: null };
  const hash = stableHash(clean);
  const cache = readCache(storage);
  if (cache[hash]) {
    cache[hash].viewedAt = Date.now();
    writeCache(storage, cache);
    return { url: cache[hash].url, status: 'cached', hash };
  }
  return { url: buildPollinationsUrl(prose), status: 'fetching', hash };
}

// Called by the consumer after an <img> successfully loads. Commits the
// URL into the cache; safe to call repeatedly.
export function markLoaded(storage, hash, url) {
  if (!hash || !url) return;
  const cache = readCache(storage);
  if (!cache[hash]) {
    cache[hash] = { url, fetchedAt: Date.now(), viewedAt: Date.now() };
    writeCache(storage, cache);
  }
}

export { CACHE_KEY, MAX_ENTRIES, buildPollinationsUrl, readCache, writeCache };
