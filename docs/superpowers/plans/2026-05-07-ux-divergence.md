# UX Divergence (Desktop Two-Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop rendering mode to the PWA — `useViewportMode()` hook, four desktop-only views (Letters reading pane, Map+Ledger combined, Outpost three-pane, Encounters with inline illustration), inline illustration cache, override toggle. Mobile UI stays byte-identical.

**Architecture:** Single `useViewportMode()` hook reads `(min-width: 1024px) and (pointer: fine)` plus a localStorage override key, returning `'mobile' | 'desktop'`. Each branch point in `factors_charter.jsx` checks the mode and conditionally renders the desktop variant. The illustration cache uses content-hash keys against localStorage with LRU eviction. Reintroduces a tiny vitest suite for the pure utilities (`stableHash`, `cleanProse`).

**Tech Stack:** React 18, Vite 5, vite-plugin-pwa, Vitest, Cloudflare Pages.

**Reference spec:** [docs/superpowers/specs/2026-05-07-two-mode-design.md](../specs/2026-05-07-two-mode-design.md) (Subsystem B section).

---

## Task 1: Restore vitest + extract pure utilities

**Files:**
- Create: `src/util/text.js`
- Create: `src/util/text.test.js`
- Modify: `package.json` (test script already exists from before — verify)
- Modify: `vite.config.js` (test config already exists from before — verify)

This task reintroduces vitest with a tiny scope (just two pure functions). Upcoming tasks will use these utilities; Subsystem A (the next plan) will add ID generation and conflict-detection tests to the same suite.

- [ ] **Step 1: Verify vitest is still in `devDependencies`**

```bash
grep -E '"vitest"|"jsdom"' package.json
```

Expected: both present (they were preserved from the strip).

- [ ] **Step 2: Create `src/util/text.js`**

```js
// Stable, deterministic 53-bit hash of a string, returned as base36 for use
// as an object key. The same input always produces the same key — used by
// the illustration cache so the same scene draws the same image, and by the
// Pollinations seed parameter so the same scene generates the same image
// across devices.
export function stableHash(s) {
  const n = (s || '').split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0);
  return Math.abs(n || 1).toString(36);
}

// Normalize prose for hashing and for sending as an image-generation prompt.
// Collapses whitespace, trims, and caps at 320 characters (Pollinations URL
// length limit + keeps the prompt focused). Idempotent.
export function cleanProse(prose) {
  return (prose || '').replace(/\s+/g, ' ').trim().slice(0, 320);
}
```

- [ ] **Step 3: Create `src/util/text.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { stableHash, cleanProse } from './text.js';

describe('stableHash', () => {
  it('returns a non-empty string', () => {
    expect(stableHash('hello')).toMatch(/^[0-9a-z]+$/);
  });
  it('returns the same hash for the same input', () => {
    expect(stableHash('a voyage encounter at sea')).toBe(stableHash('a voyage encounter at sea'));
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
```

- [ ] **Step 4: Run the tests**

```bash
npm test
```

Expected: 8 tests pass across 1 file.

- [ ] **Step 5: Commit**

```bash
git add src/util/text.js src/util/text.test.js
git commit -m "feat(util): restore vitest with stableHash + cleanProse utilities"
```

---

## Task 2: `useViewportMode()` hook

**Files:**
- Create: `src/util/viewport.js`
- Modify: `factors_charter.jsx` (top of file: import the hook)

Reads `(min-width: 1024px) and (pointer: fine)` plus localStorage override; returns `'mobile' | 'desktop'`. Lives in `src/util/` so it can be tested in isolation later if needed (manual verification for now since it depends on browser APIs).

- [ ] **Step 1: Create `src/util/viewport.js`**

```js
const OVERRIDE_KEY = 'factor_view_override';
const DESKTOP_QUERY = '(min-width: 1024px) and (pointer: fine)';

// Read once, no subscription — used at module load time only.
function detectMode() {
  if (typeof window === 'undefined') return 'mobile';
  try {
    const override = window.localStorage?.getItem(OVERRIDE_KEY);
    if (override === 'mobile' || override === 'desktop') return override;
  } catch (e) { /* localStorage unavailable */ }
  return window.matchMedia(DESKTOP_QUERY).matches ? 'desktop' : 'mobile';
}

// Toggle helper used by the in-game ☰ Menu entry. If the requested mode
// matches what auto-detect would return, clears the override key entirely
// (so future viewport changes work). Otherwise writes the override.
function setOverride(mode) {
  if (typeof window === 'undefined') return;
  try {
    const auto = window.matchMedia(DESKTOP_QUERY).matches ? 'desktop' : 'mobile';
    if (mode === auto) {
      window.localStorage.removeItem(OVERRIDE_KEY);
    } else {
      window.localStorage.setItem(OVERRIDE_KEY, mode);
    }
    // Synthetic storage event so same-tab listeners react immediately
    // (the storage event normally only fires for cross-tab changes).
    window.dispatchEvent(new StorageEvent('storage', { key: OVERRIDE_KEY }));
  } catch (e) { /* localStorage unavailable */ }
}

export { detectMode, setOverride, OVERRIDE_KEY, DESKTOP_QUERY };
```

- [ ] **Step 2: Add the hook inside `factors_charter.jsx`**

The hook must live inside the JSX file because it uses `useState`/`useEffect` from React, which we don't import in `src/util/`. Add it just below the existing top-of-file constants (after line ~3, before the giant block of game data):

Find:
```jsx
import React, { useState, useEffect, useRef } from 'react';

// ═══════════════════════════════════════════════════════════════
//  THE FACTOR'S CHARTER — playable prototype
```

Replace with:
```jsx
import React, { useState, useEffect, useRef } from 'react';
import { detectMode as detectViewportMode, setOverride as setViewportOverride, OVERRIDE_KEY as VIEWPORT_OVERRIDE_KEY, DESKTOP_QUERY as VIEWPORT_DESKTOP_QUERY } from './src/util/viewport.js';

// React hook wrapping the viewport detection. Subscribes to media-query
// changes and to localStorage changes (so toggling the override in one tab
// updates other tabs of the same site). Returns 'mobile' | 'desktop'.
function useViewportMode() {
  const [mode, setMode] = useState(detectViewportMode);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(VIEWPORT_DESKTOP_QUERY);
    const onChange = () => setMode(detectViewportMode());
    mq.addEventListener('change', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return mode;
}

// ═══════════════════════════════════════════════════════════════
//  THE FACTOR'S CHARTER — playable prototype
```

- [ ] **Step 3: Add a temporary debug log to verify the hook works**

Add inside the `FactorsCharter` component (around line 9050, near the existing `useState` calls), as the very first line of the function body:

```jsx
const __viewportMode = useViewportMode();
useEffect(() => { console.log('[viewport]', __viewportMode); }, [__viewportMode]);
```

This is temporary — it gets removed in Step 6.

- [ ] **Step 4: Run JSX parser check**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); try { p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('PARSE OK',c.split('\n').length,'lines'); } catch(e) { console.log('ERR:',e.message); process.exit(1); }"
```

Expected: `PARSE OK <N> lines`.

- [ ] **Step 5: Manual verify in browser**

```bash
npm run build && npx vite preview &
sleep 2
echo "Open http://localhost:4173/ in a desktop browser; check the DevTools console for '[viewport] desktop'. Resize window narrower than 1024px; verify it logs '[viewport] mobile'."
```

- [ ] **Step 6: Remove the temporary debug log**

Delete the two lines added in Step 3. The hook is in place but unused — subsequent tasks will start using it.

- [ ] **Step 7: Run JSX parser check + commit**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('factors_charter.jsx','utf8'); p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('PARSE OK',c.split('\n').length,'lines');"
git add src/util/viewport.js factors_charter.jsx
git commit -m "feat(viewport): add useViewportMode hook + override-key utilities"
```

---

## Task 3: `☰ Menu` override toggle

**Files:**
- Modify: `factors_charter.jsx` — `Header` component's `☰ Menu` block

Adds a menu entry that toggles between Compact view and Wide view. Persists via the localStorage override key.

- [ ] **Step 1: Find the `☰ Menu` rendering inside `Header`**

```bash
grep -n "Return to Title screen" factors_charter.jsx
```

Note the line number of the "← Return to Title screen" button — the new entry goes immediately above it.

- [ ] **Step 2: Add the toggle**

Find the existing menu structure (around line ~7240 area, after the recent Settings strip). The block looks like:

```jsx
          <button
            className="ghost-button"
            style={{ width: '100%', textAlign: 'left', marginBottom: '0.3rem' }}
            onClick={() => { setMenuOpen(false); onReturnToTitle && onReturnToTitle(); }}
          >
            ← Return to Title screen
          </button>
```

Add this block immediately above the "Return to Title screen" button:

```jsx
          <button
            className="ghost-button"
            style={{ width: '100%', textAlign: 'left', marginBottom: '0.3rem' }}
            onClick={() => {
              const next = viewportMode === 'desktop' ? 'mobile' : 'desktop';
              setViewportOverride(next);
              setMenuOpen(false);
            }}
          >
            {viewportMode === 'desktop' ? '☐ Compact view' : '⊞ Wide view'}
          </button>
```

- [ ] **Step 3: Pass `viewportMode` into the `Header` component**

`Header` is rendered from inside `GameHub`. We need to pass the mode down. Find the `<Header ... />` call inside `GameHub` (around line ~6248):

```jsx
        <Header gs={gs} onReturnToTitle={onReturnToTitle} onSuccession={onSuccession} onRenewal={onRenewal} />
```

Replace with:

```jsx
        <Header gs={gs} onReturnToTitle={onReturnToTitle} onSuccession={onSuccession} onRenewal={onRenewal} viewportMode={viewportMode} />
```

And update the `GameHub` signature (around line ~5351) to receive and forward it:

```jsx
function GameHub({ gs, setGs, lastSavedAt, onReturnToTitle, onSuccession, onRenewal }) {
```

becomes:

```jsx
function GameHub({ gs, setGs, lastSavedAt, onReturnToTitle, onSuccession, onRenewal, viewportMode }) {
```

And update the `Header` signature (around line ~7003):

```jsx
function Header({ gs, onReturnToTitle, onSuccession, onRenewal }) {
```

becomes:

```jsx
function Header({ gs, onReturnToTitle, onSuccession, onRenewal, viewportMode }) {
```

- [ ] **Step 4: Wire `viewportMode` from the root component down**

In the `FactorsCharter` root component, get the mode and pass it to `GameHub`. Find the existing root render (around line ~9191):

```jsx
  return (
    <GameHub gs={gs} setGs={setGs} lastSavedAt={lastSavedAt} onReturnToTitle={handleReturnToTitle} onSuccession={handleSuccession} onRenewal={handleRenewal} />
  );
```

Add a `viewportMode` line near the top of the `FactorsCharter` body (after existing `useState` calls):

```jsx
  const viewportMode = useViewportMode();
```

Then update the `<GameHub>` call:

```jsx
  return (
    <GameHub gs={gs} setGs={setGs} lastSavedAt={lastSavedAt} onReturnToTitle={handleReturnToTitle} onSuccession={handleSuccession} onRenewal={handleRenewal} viewportMode={viewportMode} />
  );
```

- [ ] **Step 5: Run JSX parser check**

Same parser command as Task 2. Expected `PARSE OK`.

- [ ] **Step 6: Manual verify in browser**

```bash
npm run build && npx vite preview &
```

Open in desktop browser, click `☰`, verify "☐ Compact view" entry. Click it; verify localStorage has `factor_view_override = "mobile"`. Reload; verify the menu now shows "⊞ Wide view".

- [ ] **Step 7: Commit**

```bash
git add factors_charter.jsx
git commit -m "feat(menu): add Compact view / Wide view override toggle"
```

---

## Task 4: `useIllustrationCache()` hook + tests

**Files:**
- Create: `src/util/illustration-cache.js`
- Create: `src/util/illustration-cache.test.js`
- Modify: `factors_charter.jsx` (import the hook utilities for use in Task 5)

Cache: localStorage `factor_illustration_cache_v1` keyed by content hash. LRU at 50 entries. Pure logic in a separate module so it can be unit-tested.

- [ ] **Step 1: Create `src/util/illustration-cache.js`**

```js
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
```

- [ ] **Step 2: Create `src/util/illustration-cache.test.js`**

```js
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
```

- [ ] **Step 3: Run the tests**

```bash
npm test
```

Expected: 16 tests pass across 2 files (8 from Task 1 + 8 here).

- [ ] **Step 4: Commit**

```bash
git add src/util/illustration-cache.js src/util/illustration-cache.test.js
git commit -m "feat(cache): illustration cache hook with LRU eviction + tests"
```

---

## Task 5: `<InlineIllustration>` component

**Files:**
- Modify: `factors_charter.jsx` (add the component near the existing IllustrationModal)

A small React component that uses `getOrFetch` and `markLoaded` directly (no separate hook needed since the cache is stateless across renders — localStorage IS the state).

- [ ] **Step 1: Add the import at the top of `factors_charter.jsx`**

After the existing viewport import (added in Task 2), add:

```jsx
import { getOrFetch as getOrFetchIllustration, markLoaded as markIllustrationLoaded } from './src/util/illustration-cache.js';
```

- [ ] **Step 2: Add the component**

Find the existing `IllustrationModal` component (search for `function IllustrationModal`). Add the new component immediately after `IllustrationModal` ends (look for its closing `}` followed by the next blank line):

```jsx
// Inline illustration for desktop mode — renders the cached image (or a
// placeholder while fetching) alongside an encounter / arrival / letter.
// On fetch failure, renders nothing (the parent's existing button-on-demand
// path remains available for the player). Mobile callers should not render
// this component; layouts decide based on viewportMode.
function InlineIllustration({ prose }) {
  const storage = (typeof window !== 'undefined') ? window.localStorage : null;
  const { url, status, hash } = getOrFetchIllustration(storage, prose);
  const [imgState, setImgState] = useState(status === 'cached' ? 'loaded' : 'loading');

  if (status === 'empty' || !url) return null;

  return (
    <div style={{
      width: '100%',
      maxWidth: '480px',
      aspectRatio: '3 / 2',
      background: '#d9c596',
      border: '1px solid rgba(74,44,20,0.3)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    }}>
      {imgState === 'failed' ? null : (
        <img
          src={url}
          alt="An illustration of the scene"
          onLoad={() => {
            setImgState('loaded');
            if (storage && status === 'fetching') markIllustrationLoaded(storage, hash, url);
          }}
          onError={() => setImgState('failed')}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: imgState === 'loaded' ? 1 : 0.5,
            transition: 'opacity 0.3s ease',
          }}
        />
      )}
      {imgState === 'loading' && (
        <div style={{
          position: 'absolute',
          fontFamily: '"IM Fell English SC", serif',
          fontSize: '0.85em',
          color: '#5c1a08',
          fontStyle: 'italic',
        }}>
          sketching…
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run JSX parser check**

Same parser command. Expected `PARSE OK`.

- [ ] **Step 4: Run build to confirm component compiles**

```bash
npm run build 2>&1 | tail -5
```

Expected: build succeeds. The component is added but not yet used; bundle size barely changes.

- [ ] **Step 5: Commit**

```bash
git add factors_charter.jsx
git commit -m "feat(illustration): add InlineIllustration component"
```

---

## Task 6: Apply `<InlineIllustration>` to voyage encounters

**Files:**
- Modify: `factors_charter.jsx` — voyage encounter rendering inside `GameHub`

Encounter rendering has the prose + choices laid out vertically today. On desktop, place the choices and prose side-by-side with an illustration in a new column.

- [ ] **Step 1: Find the encounter render block**

```bash
grep -n "encounter\|encounterProse" factors_charter.jsx | head -20
```

Identify the JSX that renders the encounter prose + choices (likely near where `genVoyageEncounter` results land in state and get rendered). Read 80 lines around that block to capture the full layout.

- [ ] **Step 2: Wrap the encounter content with a desktop branch**

In the encounter render block, identify the outer container and the prose + choices it contains. Replace with:

```jsx
{viewportMode === 'desktop' ? (
  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 480px', gap: '1rem', alignItems: 'start' }}>
    <div>
      {/* existing prose + choices markup, unchanged */}
    </div>
    <InlineIllustration prose={encounter.prose} />
  </div>
) : (
  <>
    {/* existing prose + choices markup, unchanged — no illustration */}
  </>
)}
```

The existing markup is duplicated literally between the two branches. (Future refactor could extract it into a small sub-component; not in scope for this task.)

- [ ] **Step 3: Ensure `viewportMode` is in scope**

If the encounter rendering is inside a function/component that doesn't have `viewportMode` as a prop, thread it through from the nearest ancestor that does (likely `GameHub`). Add `viewportMode` to the props of any intermediate component.

- [ ] **Step 4: Parser check + manual verify**

```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); p.parse(fs.readFileSync('factors_charter.jsx','utf8'),{sourceType:'module',plugins:['jsx']}); console.log('PARSE OK');"
npm run build && npx vite preview &
```

Open at desktop width. Trigger a voyage encounter. Verify the illustration appears in the right column. Resize narrower; verify mobile layout (no illustration column).

- [ ] **Step 5: Commit**

```bash
git add factors_charter.jsx
git commit -m "feat(views): inline illustration alongside voyage encounters on desktop"
```

---

## Task 7: Apply `<InlineIllustration>` to arrival vignettes

**Files:**
- Modify: `factors_charter.jsx` — arrival vignette rendering

Same pattern as Task 6 but for the arrival-vignette display. Find where `genArrivalVignette` results are rendered (likely as part of a port-arrival screen or modal) and wrap with the desktop branch.

- [ ] **Step 1: Find the arrival render**

```bash
grep -n "arrivalProse\|arrival.prose\|genArrivalVignette" factors_charter.jsx | head -10
```

- [ ] **Step 2: Wrap with desktop branch**

Same pattern: when `viewportMode === 'desktop'`, lay out the prose + `<InlineIllustration prose={arrivalProse.prose} />` in a grid. Mobile keeps the existing single-column rendering. The existing `<ImaginePanel>` button (if present) stays in both branches as the fallback path.

```jsx
{viewportMode === 'desktop' ? (
  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 480px', gap: '1rem', alignItems: 'start' }}>
    <div>
      {/* existing arrival prose + ImaginePanel button + any other arrival UI, unchanged */}
    </div>
    <InlineIllustration prose={arrivalProse.prose} />
  </div>
) : (
  <>
    {/* existing arrival prose + ImaginePanel button — unchanged */}
  </>
)}
```

- [ ] **Step 3: Parser check + manual verify**

Trigger an arrival at a port the charter hasn't visited; verify the illustration appears on desktop.

- [ ] **Step 4: Commit**

```bash
git add factors_charter.jsx
git commit -m "feat(views): inline illustration alongside arrival vignettes on desktop"
```

---

## Task 8: Apply `<InlineIllustration>` to letters

**Files:**
- Modify: `factors_charter.jsx` — letter rendering inside the existing letter detail view

Letters today render in a single-column reading view. On desktop, the reading view will be replaced entirely by `<LettersDesktop>` in Task 9 — but for this task, just add the illustration alongside the existing single-letter view so it looks right when a player taps an individual letter on desktop.

- [ ] **Step 1: Find letter detail rendering**

```bash
grep -n "letter.body\|letterBeingRead" factors_charter.jsx | head -15
```

Identify the JSX block that renders an opened letter's body and response choices.

- [ ] **Step 2: Wrap with desktop branch**

```jsx
{viewportMode === 'desktop' ? (
  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: '1rem', alignItems: 'start' }}>
    <div>
      {/* existing letter body + response choices, unchanged */}
    </div>
    <InlineIllustration prose={letter.body} />
  </div>
) : (
  <>
    {/* existing letter body + response choices, unchanged */}
  </>
)}
```

Note the smaller illustration column (320px) — letters are denser text-content than encounters, so a smaller image is more proportionate.

- [ ] **Step 3: Parser check + manual verify**

Open any letter on desktop; verify the illustration appears.

- [ ] **Step 4: Commit**

```bash
git add factors_charter.jsx
git commit -m "feat(views): inline illustration alongside letter reading on desktop"
```

---

## Task 9: `<LettersDesktop>` (list + reading pane)

**Files:**
- Modify: `factors_charter.jsx` — replace the desktop letter rendering with a list + reading pane layout

This task replaces what Task 8 set up (single-letter desktop view with an illustration column) with the full list + reading pane layout. The illustration column carries over, but now it's part of a three-pane layout (list / reading / illustration → actually just two panes since the illustration nests inside the reading pane).

- [ ] **Step 1: Find the existing `LettersView` component**

```bash
grep -n "function LettersView" factors_charter.jsx
```

Read the function body (~80 lines) to understand the current state machine: which letter is open, how it transitions to the detail view, etc.

- [ ] **Step 2: Refactor `LettersView` to branch on viewportMode**

```jsx
function LettersView({ gs, setGs, viewportMode, ...props }) {
  if (viewportMode === 'desktop') {
    return <LettersDesktop gs={gs} setGs={setGs} {...props} />;
  }
  // existing single-column body kept as-is below
  // ...
}
```

- [ ] **Step 3: Add the `<LettersDesktop>` component**

Right above `LettersView`, add:

```jsx
function LettersDesktop({ gs, setGs }) {
  const letters = gs.letters || [];
  // Default selection: newest unread, falling back to newest of any kind
  const newestUnread = [...letters].reverse().find(l => !l.read);
  const initialId = (newestUnread || letters[letters.length - 1] || {}).id;
  const [selectedId, setSelectedId] = useState(initialId);
  const selected = letters.find(l => l.id === selectedId);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '24rem minmax(0, 1fr)', gap: '1rem', alignItems: 'start', minHeight: '60vh' }}>
      {/* INBOX */}
      <div style={{ borderRight: '1px solid rgba(74,44,20,0.18)', paddingRight: '1rem', overflowY: 'auto', maxHeight: '70vh' }}>
        <div className="display" style={{ fontSize: '0.85em', color: '#5c1a08', marginBottom: '0.5rem' }}>
          ⁂ CORRESPONDENCE
        </div>
        {letters.length === 0 && (
          <div style={{ fontStyle: 'italic', color: '#6b4423', padding: '0.5rem 0' }}>
            No correspondence has reached you yet.
          </div>
        )}
        {letters.map(l => (
          <button
            key={l.id}
            onClick={() => setSelectedId(l.id)}
            className="ghost-button"
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '0.5rem 0.6rem',
              marginBottom: '0.3rem',
              background: l.id === selectedId ? 'rgba(92,26,8,0.08)' : 'transparent',
              borderLeft: l.id === selectedId ? '2px solid #5c1a08' : '2px solid transparent',
              fontWeight: l.read ? 'normal' : 'bold',
            }}
          >
            <div style={{ fontSize: '0.9em' }}>{l.from}</div>
            <div style={{ fontSize: '0.8em', color: '#6b4423', fontStyle: 'italic' }}>
              {l.subject}
            </div>
          </button>
        ))}
      </div>

      {/* READING PANE */}
      <div>
        {selected ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: '1rem', alignItems: 'start' }}>
            <div>
              <div className="display" style={{ fontSize: '0.85em', color: '#5c1a08', marginBottom: '0.3rem' }}>
                From: {selected.from}
              </div>
              <div style={{ fontSize: '0.85em', color: '#6b4423', fontStyle: 'italic', marginBottom: '0.7rem' }}>
                {selected.subject}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {selected.body}
              </div>
              {/* Response choices: render the existing letter-response UI here.
                  Reuse whatever the mobile path uses to render selected.responses. */}
            </div>
            <InlineIllustration prose={selected.body} />
          </div>
        ) : (
          <div style={{ fontStyle: 'italic', color: '#6b4423', padding: '1rem' }}>
            Select a letter from the inbox to read it.
          </div>
        )}
      </div>
    </div>
  );
}
```

**Note on response choices:** the existing mobile `LettersView` already has logic that renders an opened letter's `responses` array as buttons and dispatches the chosen response. Extract that response-rendering JSX into a small helper component (e.g. `LetterResponses`) — or, if it's already a sub-component, simply reuse it. Then `LettersDesktop` renders `<LetterResponses letter={selected} ... />` inside the reading pane after the body. Both mobile and desktop paths use the same component, ensuring response handling stays consistent. If extraction is non-trivial, do it as the first action in this step before adding `<LettersDesktop>`.

- [ ] **Step 4: Mark a letter as read on selection**

When `selectedId` changes and the selected letter is unread, mark it read. Add this `useEffect` inside `LettersDesktop`:

```jsx
useEffect(() => {
  if (!selected || selected.read) return;
  setGs(prev => ({
    ...prev,
    letters: prev.letters.map(l => l.id === selected.id ? { ...l, read: true } : l),
  }));
}, [selectedId]);
```

- [ ] **Step 5: Make sure `viewportMode` reaches `LettersView`**

`LettersView` is rendered from inside the tab system in `GameHub`. Find the call site:

```bash
grep -n "<LettersView" factors_charter.jsx
```

Add `viewportMode={viewportMode}` to the call. If multiple intermediaries don't have `viewportMode` as a prop, thread it through.

- [ ] **Step 6: Parser check + manual verify**

Open Letters tab on desktop. Verify list + reading pane layout. Click each letter, verify it renders with illustration. Verify newest-unread is selected by default on view enter. Resize narrow; verify mobile single-column layout returns.

- [ ] **Step 7: Commit**

```bash
git add factors_charter.jsx
git commit -m "feat(views): LettersDesktop with list + reading pane"
```

---

## Task 10: `<DesktopOverview>` (Map + Ledger side-by-side)

**Files:**
- Modify: `factors_charter.jsx` — add the combined view, alter the tab routing on desktop

On desktop, the Map and Ledger tabs are merged into a single "Overview" view that shows both side-by-side. The existing tab navigation has individual Map and Ledger entries; on desktop those collapse into one Overview entry.

- [ ] **Step 1: Find the tab navigation block**

```bash
grep -n "TABS\|setActiveTab\|activeTab" factors_charter.jsx | head -20
```

Identify how tabs are listed and which one renders. Note the tab IDs / labels for Map and Ledger.

- [ ] **Step 2: Add `<DesktopOverview>` component**

Add it adjacent to where `MapView` and `LedgerView` are defined. The component renders both:

```jsx
function DesktopOverview({ gs, setGs, ...props }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
      <div>
        <MapView gs={gs} setGs={setGs} {...props} />
      </div>
      <div>
        <LedgerView gs={gs} setGs={setGs} {...props} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Adjust the tab list to collapse Map + Ledger on desktop**

In the tab definitions block, conditionally render the tab list based on `viewportMode`. The mobile path keeps separate Map and Ledger tabs; the desktop path replaces them with a single Overview tab.

```jsx
const tabs = viewportMode === 'desktop'
  ? [
      { id: 'overview', label: 'Overview' },        // new combined tab
      { id: 'port', label: 'Port' },                // existing
      { id: 'outpost', label: 'Outpost' },          // existing
      { id: 'letters', label: 'Letters' },          // existing
      { id: 'journal', label: 'Journal' },          // existing
    ]
  : [
      { id: 'map', label: 'Map' },                  // existing
      { id: 'ledger', label: 'Ledger' },            // existing
      { id: 'port', label: 'Port' },                // existing
      { id: 'outpost', label: 'Outpost' },          // existing
      { id: 'letters', label: 'Letters' },          // existing
      { id: 'journal', label: 'Journal' },          // existing
    ];
```

Before writing this block, locate the existing tab definition (likely an array literal with `id` and `label` fields, or a switch statement on `activeTab`). Use whatever exact labels the existing code uses for `port`, `outpost`, `letters`, `journal`. Only the `overview` entry is new.

- [ ] **Step 4: Adjust the tab content switch**

```jsx
{activeTab === 'overview' && viewportMode === 'desktop' && <DesktopOverview gs={gs} setGs={setGs} />}
{activeTab === 'map' && viewportMode === 'mobile' && <MapView gs={gs} setGs={setGs} />}
{activeTab === 'ledger' && viewportMode === 'mobile' && <LedgerView gs={gs} setGs={setGs} />}
```

(Existing tabs unchanged; just add the new branch and gate the old `map`/`ledger` tabs to mobile.)

- [ ] **Step 5: Default tab on desktop**

If `activeTab` is `'map'` or `'ledger'` and the player is on desktop (e.g., they resized while playing), default to `'overview'`. Add to the tab-rendering logic:

```jsx
const effectiveTab = (viewportMode === 'desktop' && (activeTab === 'map' || activeTab === 'ledger')) ? 'overview' : activeTab;
```

Use `effectiveTab` in the switch above instead of `activeTab`.

- [ ] **Step 6: Parser check + manual verify**

On desktop: verify the Overview tab exists and renders Map + Ledger side-by-side. Resize narrow: verify Map and Ledger become separate tabs again. Verify `factor_view_override` toggling between them works.

- [ ] **Step 7: Commit**

```bash
git add factors_charter.jsx
git commit -m "feat(views): DesktopOverview combining Map + Ledger on desktop"
```

---

## Task 11: OutpostView desktop branch (three-pane)

**Files:**
- Modify: `factors_charter.jsx` — `OutpostView` component

Outpost has three logical regions: the Godown (cargo on hand), the Build queue (buildings + construction), and Acquaintances (NPCs). Mobile stacks them vertically; desktop puts them in a three-pane grid.

- [ ] **Step 1: Find `OutpostView`**

```bash
grep -n "function OutpostView" factors_charter.jsx
```

Read the function body to identify the three logical sections.

- [ ] **Step 2: Wrap the three sections in a viewport-conditional grid**

If the three sections are currently rendered as siblings inside a wrapper `<div>`, change the wrapper:

```jsx
function OutpostView({ gs, setGs, viewportMode }) {
  // ... existing logic ...

  const containerStyle = viewportMode === 'desktop'
    ? { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem', alignItems: 'start' }
    : { display: 'flex', flexDirection: 'column', gap: '1rem' };

  return (
    <div style={containerStyle}>
      {/* GODOWN — existing markup */}
      <div>{/* godown contents */}</div>

      {/* BUILD QUEUE — existing markup */}
      <div>{/* build queue contents */}</div>

      {/* ACQUAINTANCES — existing markup */}
      <div>{/* acquaintances contents */}</div>
    </div>
  );
}
```

If the existing structure isn't already three top-level sections, restructure minimally to make it three. Keep all internal logic and labels exactly the same.

- [ ] **Step 3: Pass `viewportMode` to `OutpostView`**

Find the `<OutpostView ... />` call site:

```bash
grep -n "<OutpostView" factors_charter.jsx
```

Add `viewportMode={viewportMode}` to the props.

- [ ] **Step 4: Parser check + manual verify**

Open Outpost on desktop: verify three columns. Resize narrow: verify stacked. Verify the godown, build queue, and acquaintances all render correctly in both modes.

- [ ] **Step 5: Commit**

```bash
git add factors_charter.jsx
git commit -m "feat(views): OutpostView three-pane layout on desktop"
```

---

## Task 12: Doc updates

**Files:**
- Modify: `CLAUDE.md` (add a "Two-mode rendering" section)
- Modify: `README.md` (add a "On desktop" line to the play quickref)
- Modify: `CHANGELOG.md` (new dated entry)
- Modify: `HANDOFF.md` (refresh after this lands; another refresh after Subsystem A ships)

- [ ] **Step 1: Update `CLAUDE.md`**

Find the "Runtime targets" section that was rewritten in the previous PR. Add a new sub-section after it:

```markdown
### Two-mode rendering

The PWA renders differently on mobile and desktop, gated by the `useViewportMode()` hook. Detection: `(min-width: 1024px) and (pointer: fine)`, with a localStorage override (`factor_view_override`) toggleable from the in-game `☰ Menu`.

- **Mobile:** byte-identical to the previous single-mode JSX. No new affordances.
- **Desktop:** Letters renders as list + reading pane; Map and Ledger collapse into a single Overview tab side-by-side; Outpost lays out three-pane (Godown / Build queue / Acquaintances); voyage encounters, arrival vignettes, and letters render with an `<InlineIllustration>` alongside, drawn by Pollinations.ai and cached in localStorage (LRU at 50 entries, content-hash keyed).

The existing `<ImaginePanel>` button-on-demand path remains in both modes — `<InlineIllustration>` falls back to that on fetch failure.
```

- [ ] **Step 2: Update `README.md`**

Find the play quickref. Append a line:

```markdown
- On desktop (≥1024 px wide, pointer device): wide-view layouts and inline period illustrations alongside scenes. Toggle via the in-game `☰ Menu`.
```

- [ ] **Step 3: Append a `CHANGELOG.md` entry**

Insert at the top, under the title:

```markdown
## 2026-05-07 — Desktop rendering mode

The PWA now adapts to viewport: on screens ≥1024 px with a pointer device, the layout unlocks two-column views (Letters with list + reading pane, Map + Ledger side-by-side as a single Overview tab, Outpost three-pane). Voyage encounters, arrival vignettes, and letters render with an inline auto-generated period illustration drawn by Pollinations.ai and cached in localStorage (LRU at 50 entries, content-hash keyed). Mobile UI is byte-identical. An override toggle in the in-game `☰ Menu` lets a player force Compact or Wide view per device.

Restored vitest with a small suite for the pure utility functions (`stableHash`, `cleanProse`, illustration-cache logic).

Subsystem A (cross-device save sync via Cloudflare Pages Function + KV) is the next ship; spec at `docs/superpowers/specs/2026-05-07-two-mode-design.md`.
```

- [ ] **Step 4: Update `HANDOFF.md`**

Replace the file entirely with content reflecting the new state. Use the same shape as the previous handoff but with the desktop UX shipped and Subsystem A as the next major item.

```markdown
# HANDOFF — The Factor's Charter

**Date:** 2026-05-07 (later same day)
**For:** Bradley (or a fresh Claude session) resuming this project
**Branch:** `main`
**Live build:** https://factors-charter.pages.dev (auto-deploys from `main`)
**Status:** Desktop rendering mode shipped. Cross-device save sync (Subsystem A from the two-mode spec) is the next item, planned but not yet implemented.

> Previous handoff archived in `git log` at commit `c9dc38e`.

---

## What shipped this session

After the strip and pool expansions earlier today:

**Desktop rendering mode (PWA).** `useViewportMode()` hook, four desktop-only views, override toggle in the in-game `☰ Menu`. Mobile UI is byte-identical to the pre-PR state.

### Added
- `useViewportMode()` hook + override key `factor_view_override`
- `<InlineIllustration>` component with content-hash-keyed cache (LRU at 50 entries)
- `<LettersDesktop>` (inbox + reading pane)
- `<DesktopOverview>` (Map + Ledger side-by-side)
- `OutpostView` three-pane variant
- "Compact view" / "Wide view" entry in the in-game `☰ Menu`
- `src/util/text.js`, `src/util/illustration-cache.js`, `src/util/viewport.js` plus tiny test suite

### Reference docs
- Design spec: `docs/superpowers/specs/2026-05-07-two-mode-design.md` (covers both subsystems)
- Implementation plan (this work): `docs/superpowers/plans/2026-05-07-ux-divergence.md`

---

## Deferred items — pick up here

### 1. Subsystem A: cross-device save sync (top priority)

Per the spec at `docs/superpowers/specs/2026-05-07-two-mode-design.md`. Cloudflare Pages Function at `functions/api/save.js` + KV namespace, themed-readable playthrough IDs (`coral-monsoon-pelican-1923` style), silent push-on-save / pull-on-launch / conflict modal with auto-export of the loser. Each save in `gs` gets `playthroughId`, `syncEnabled`, plus per-slot `lastKnownCloudVersion` in localStorage. First-launch sync prompt for new charters; retroactive enable for existing.

Pre-deploy setup needed: create KV namespace via Cloudflare dashboard, bind it to `SAVES_KV` in the Pages project. Then the implementation plan can be written and executed.

### 2. genLetter faction × mood pool (still open from earlier today)

The only remaining item from the pool audit. Faction voices need Bradley's tonal authoring. See `DESIGN_NOTES.md` "Concerns flagged" section.

### 3. Polished PWA icons

Chrome's manifest validation still flags `icon-192.png`. Replacing the placeholder PNGs with hand-designed icons closes this out. Manifest already references them.

### 4. Lazy-load mid-game views (lower priority)

The 1.13 MB main chunk is still hefty. Lower priority than Subsystem A.

### 5. Trusted Types in CSP

Closes out Lighthouse Best Practices. Not blocking.

---

## How to verify the project is healthy on resume

```bash
cd ~/pontus/factors-charter
git status
npm install
npm test                              # 16 tests across 2 files
npm run build
npx vite preview                      # http://localhost:4173/
```

JSX parser:
```bash
node -e "const p=require('@babel/parser'); const fs=require('fs'); p.parse(fs.readFileSync('factors_charter.jsx','utf8'),{sourceType:'module',plugins:['jsx']}); console.log('OK',fs.readFileSync('factors_charter.jsx','utf8').split('\n').length,'lines');"
```

Live:
```bash
curl -sI https://factors-charter.pages.dev/ | grep -i content-security
```

---

## Architecture invariants (don't break)

- `factors_charter.jsx` stays at repo root.
- `legacyAnthropicCall` body unchanged.
- Mobile UI is byte-identical to its pre-desktop-mode state. Desktop affordances are purely additive.
- The `src/util/` tree is PWA-only and contains pure functions only — no React, no DOM, no localStorage assumptions outside of explicit `storage` parameters.
- All gameplay, save format (`ensureShape`), content tables, and generators live in `factors_charter.jsx`.

---

## Bradley's working style (unchanged)

(see prior handoffs)
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md CHANGELOG.md HANDOFF.md
git commit -m "docs: refresh CLAUDE/README/CHANGELOG/HANDOFF for desktop rendering mode"
```

---

## Task 13: Local + live verification

**Files:**
- None modified

- [ ] **Step 1: Clean build**

```bash
rm -rf dist node_modules/.vite
npm test
npm run build 2>&1 | tail -20
```

Expected:
- 16 tests pass across 2 files
- Build succeeds; chunk sizes reasonable (`index-*.js` should be a small amount larger than the previous build — desktop variants add some bytes but most of the additions are conditional render branches inside the existing tree, not new chunks)
- The Outpost three-pane and DesktopOverview live inline in the JSX, so no new chunks.

- [ ] **Step 2: Local preview smoke test**

```bash
npx vite preview &
PREVIEW_PID=$!
sleep 2
curl -s -o /dev/null -w "preview / %{http_code}\n" http://localhost:4173/
kill $PREVIEW_PID 2>/dev/null
```

Expected: `200`. (For deeper verification, open in a real browser, resize between desktop and mobile widths, click through Letters / Outpost / Map / Ledger, verify all four desktop variants render and the override toggle works.)

- [ ] **Step 3: Final references sweep**

```bash
grep -nE "factor_view_override|VIEWPORT_DESKTOP_QUERY|useViewportMode|InlineIllustration|LettersDesktop|DesktopOverview" factors_charter.jsx | head -20
```

Expected: all named references exist and resolve. No stray TODO comments.

- [ ] **Step 4: Push**

```bash
git status                # should be clean
git log --oneline origin/main..HEAD   # should show 12-13 commits from this PR
git push origin main
```

- [ ] **Step 5: Live verification**

After Cloudflare deploys (~1 minute):

```bash
sleep 60
curl -sI https://factors-charter.pages.dev/ | grep -iE "^(content-security|http/)"
curl -s https://factors-charter.pages.dev/ | grep -oE '/assets/[^"]+\.js' | sort -u
curl -s -o /dev/null -w "/                      %{http_code}\n" https://factors-charter.pages.dev/
curl -s -o /dev/null -w "/sw.js                 %{http_code}\n" https://factors-charter.pages.dev/sw.js
```

Expected: 200s, CSP unchanged from earlier today (no new origins), expected JS chunks. Bradley's manual smoke: open the live URL on a desktop browser, resize, verify the four desktop views, toggle the override.

---

## Done

Subsystem B (UX Divergence) shipped. The desktop experience now feels distinctly desktop. Subsystem A (cross-device save sync) is the next plan, written separately when this lands.
