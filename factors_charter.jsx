import React, { useState, useEffect, useRef } from 'react';
import { detectMode as detectViewportMode, setOverride as setViewportOverride, DESKTOP_QUERY as VIEWPORT_DESKTOP_QUERY } from './src/util/viewport.js';
import { getOrFetch as getOrFetchIllustration, markLoaded as markIllustrationLoaded, setCacheEntry as setIllustrationCacheEntry } from './src/util/illustration-cache.js';
import { stableHash, cleanProse } from './src/util/text.js';
import { STYLE_PREFIX } from './src/util/style-prefix.js';
import { generatePlaythroughId, isValidPlaythroughId } from './src/util/playthrough-id.js';
import { detectConflict } from './src/util/sync-conflict.js';
import {
  makeInitialRivals,
  RIVAL_KEYS,
  RIVALS_REGISTRY,
  computeRivalPressure,
  pickRivalEvent,
} from './src/util/rivalry.js';
import { priceWindowMult, pruneExpiredWindows, activeWindowsFor, priceDrift } from './src/util/price-windows.js';
import { pickPlate } from './src/util/plates.js';
import { canOfferSabotage, resolveSabotage, sabotageCoda } from './src/util/sabotage.js';
import { recordTrade, reckonRows, reckonTotal } from './src/util/trade-stats.js';
import { pendingWealthMilestones, seedWealthFlags } from './src/util/milestones.js';
import { VENTURES, VENTURE_EVENTS, accrueVentureIncome, accrueVentureProduce, ventureUnlocked, ventureBuyMult, ventureQuarterlyIncome, venturesWorth, establishedVentureCount, pickVentureEvent } from './src/util/ventures.js';
import { winCounsel } from './src/util/counsel.js';

// ─────────── FACTOR KEY (cross-device identity) ───────────
//
// A device-level identifier that namespaces all of a player's charters
// across devices. Lives in localStorage at FACTOR_KEY_STORAGE — NOT in gs.
// All charter saves push to cloud KV under save:<factorKey>:<playthroughId>.
// Pasting another device's factor key here will surface that device's
// charters on this device's title screen via /api/factor-saves.
//
// Format reuses the playthrough-id themed-string scheme (same vocabulary,
// same regex) — same entropy budget, same word-list discipline.

const FACTOR_KEY_STORAGE = 'factor_key_v1';

function readFactorKey() {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(FACTOR_KEY_STORAGE);
    return isValidPlaythroughId(v) ? v : null;
  } catch (e) { return null; }
}

function writeFactorKey(key) {
  if (typeof window === 'undefined') return false;
  if (!isValidPlaythroughId(key)) return false;
  try {
    window.localStorage.setItem(FACTOR_KEY_STORAGE, key);
    return true;
  } catch (e) { return false; }
}

// Lazy generator: returns the existing key, or mints a new one and
// persists it. Safe to call repeatedly — only the first call mints.
function ensureFactorKey() {
  let k = readFactorKey();
  if (!k) {
    k = generatePlaythroughId();
    writeFactorKey(k);
  }
  return k;
}

// ─────────── ILLUSTRATION GALLERY (per-charter image log) ───────────
//
// Every successful illustration load gets recorded in gs.illustrations[]
// (capped LRU). The gallery modal reads this list. Regenerate bumps the
// seed and overrides the local illustration cache so the in-game scene
// also picks up the new image. Discard is sticky — the entry is marked
// deletedByPlayer rather than removed, so re-encountering the scene
// doesn't silently re-add it.

const MAX_GALLERY_ENTRIES = 60;

// Build the deterministic /api/illustrate URL for a (fullPrompt, seed)
// pair. Same shape the InlineIllustration / IllustrationModal paths use,
// so an URL recorded here will hit the same R2-cached image.
function buildIllustrateUrl(fullPrompt, seed) {
  return `/api/illustrate?prompt=${encodeURIComponent(fullPrompt)}&seed=${seed}`;
}

// Stable id + canonical seed for a piece of prose. Mirrors the keying
// inside src/util/illustration-cache.js so the gallery and the in-game
// cache agree on which scene maps to which image.
function illustrationIdForProse(prose) {
  const clean = cleanProse(prose);
  if (!clean) return null;
  const id = stableHash(clean);
  const seed = parseInt(id, 36) || 1;
  const fullPrompt = STYLE_PREFIX + clean;
  return { id, seed, fullPrompt, clean };
}

// Add (or update viewedAt on) an illustration entry for this scene.
// No-op if the entry already exists OR if the player previously discarded
// it — discard is sticky and we don't silently re-add. The capped LRU
// preserves most-recent entries; the cap is generous enough that even a
// long campaign won't lose much.
function recordIllustrationInGs(gs, prose) {
  const meta = illustrationIdForProse(prose);
  if (!meta) return gs;
  const list = Array.isArray(gs.illustrations) ? gs.illustrations : [];
  const existing = list.find(i => i.id === meta.id);
  if (existing) {
    // Bump viewedAt to keep it fresh in the LRU. Don't reset deletedByPlayer.
    return {
      ...gs,
      illustrations: list.map(i => i.id === meta.id ? { ...i, viewedAt: Date.now() } : i),
    };
  }
  const entry = {
    id: meta.id,
    prose: meta.clean.slice(0, 220),  // capped for save-size sanity
    fullPrompt: meta.fullPrompt.slice(0, 1024),
    seed: meta.seed,
    url: buildIllustrateUrl(meta.fullPrompt, meta.seed),
    day: gs.day || 0,
    capturedAt: Date.now(),
    viewedAt: Date.now(),
  };
  // Newest first; cap to MAX_GALLERY_ENTRIES (drop oldest by capturedAt).
  const next = [entry, ...list];
  if (next.length > MAX_GALLERY_ENTRIES) {
    next.sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
    next.length = MAX_GALLERY_ENTRIES;
  }
  return { ...gs, illustrations: next };
}

// Bump the seed deterministically (Knuth multiplicative-style mix into
// 31-bit positive range) so a regenerate yields a different image but
// the same prose still maps to the same gallery slot id. Updates both
// the gs entry and the device-local illustration cache so subsequent
// in-game encounters of the scene render the regenerated image.
function nextRegenerationSeed(seed) {
  const next = (Math.abs(Number(seed) || 1) * 2654435761) % 2147483647;
  return next || 1;
}

function regenerateIllustrationInGs(gs, illustrationId) {
  const list = Array.isArray(gs.illustrations) ? gs.illustrations : [];
  const ill = list.find(i => i.id === illustrationId);
  if (!ill) return gs;
  const newSeed = nextRegenerationSeed(ill.seed);
  const newUrl = buildIllustrateUrl(ill.fullPrompt, newSeed);
  // Keep the in-game illustration cache in lock-step with the gallery —
  // without this, the next encounter of the scene would render the OLD
  // image because the cache is keyed by prose-hash and stores the seed
  // inside the URL. setCacheEntry is the "I really mean it" overwrite.
  if (typeof window !== 'undefined') {
    try { setIllustrationCacheEntry(window.localStorage, illustrationId, newUrl); }
    catch (e) { /* private mode etc. — gallery still updates */ }
  }
  return {
    ...gs,
    illustrations: list.map(i => i.id === illustrationId
      ? { ...i, seed: newSeed, url: newUrl, regeneratedAt: Date.now(), deletedByPlayer: false, deletedAt: null }
      : i),
  };
}

// Soft-discard: keeps the entry in the list with a flag, so re-encountering
// the scene doesn't silently re-add it. The gallery filters discarded
// entries from the visible grid. Cap survival is unaffected — discarded
// entries still count against MAX_GALLERY_ENTRIES (intentional; over time
// the LRU cycles them out without the player having to think about it).
function discardIllustrationInGs(gs, illustrationId) {
  const list = Array.isArray(gs.illustrations) ? gs.illustrations : [];
  return {
    ...gs,
    illustrations: list.map(i => i.id === illustrationId
      ? { ...i, deletedByPlayer: true, deletedAt: Date.now() }
      : i),
  };
}

// Context for plumbing the recorder down to the illustration components
// without prop-drilling through every encounter / arrival / letter view.
// GameHub provides; InlineIllustration and IllustrationModal consume.
const IllustrationRecorderContext = React.createContext(null);

// The current charter's gs.illustrations list, exposed so IllustrationModal
// can detect "this scene has been illustrated before" and skip the manual
// "Try in-game illustration" click. Default [] keeps the consumer safe when
// no provider is mounted (tests, isolated previews).
const IllustrationsListContext = React.createContext([]);

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

// Per-charter sync state machine. Owns the cloud-side pointer
// (lastKnownCloudVersion, lastSyncAt) in device-local storage at
// factor_save_<slot>_sync, and the debounced push-on-save trigger.
//
// Cross-device identity: every push/pull is namespaced under the device's
// factor key (read from localStorage at request time, ensured present via
// ensureFactorKey). Pasting a different factor key on the title screen
// re-points all subsequent push/pull traffic to that namespace, surfacing
// the other device's charters here.
//
// State:
//   { status, lastKnownCloudVersion, lastSyncAt, error }
//   status ∈ 'idle' | 'pushing' | 'pulling' | 'offline' | 'error' | 'conflict'
//
// API:
//   triggerPush(gs)            — schedule a push 5s after the last save (debounced).
//   pushNow(gs)                — push immediately.
//   pullNow(playthroughId)     → Promise<{ status, remote }>
//   pullFactorIndex()          → Promise<{ status, charters }>  cross-device discovery
//   pullCharterById(id)        → Promise<{ status, body, version, savedAt }>
//
// Storage: factor_save_<slot>_sync = { lastKnownCloudVersion, lastSyncAt, lastKnownDay }
function useSyncState(slot) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  // True once a synced payload passes 200 KB — the 256 KB server cap is
  // close enough that the player should export a manuscript before sync
  // starts failing outright. Surfaced by SyncBadge.
  const [sizeWarning, setSizeWarning] = useState(false);
  const debounceTimer = useRef(null);
  const inFlight = useRef(false);
  const pullInFlight = useRef(false);

  const pointerKey = `factor_save_${slot}_sync`;

  const readPointer = () => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(pointerKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };

  // Returns true on success, false on failure (quota exceeded, storage
  // disabled, etc.). When the write fails we surface it via status/error so
  // the SyncBadge reflects the problem — without this, the next launch sees
  // a missing pointer and triggers a false-positive conflict modal.
  const writePointer = (p) => {
    if (typeof window === 'undefined') return false;
    try {
      window.localStorage.setItem(pointerKey, JSON.stringify(p));
      return true;
    } catch (e) {
      setStatus('error');
      setError(`pointer write failed: ${e?.message || String(e)}`);
      return false;
    }
  };

  // Build the namespaced sync URL. Returns null if either the factor key
  // can't be ensured or the playthrough id is missing — callers no-op in
  // that case (we never push/pull without both).
  const buildSyncUrl = (path, playthroughId) => {
    const factorKey = ensureFactorKey();
    if (!factorKey || !isValidPlaythroughId(playthroughId)) return null;
    return `${path}?key=${encodeURIComponent(factorKey)}&id=${encodeURIComponent(playthroughId)}`;
  };

  const pushNow = async (gs) => {
    if (!gs?.playthroughId) return;
    if (inFlight.current) return;
    const url = buildSyncUrl('/api/save', gs.playthroughId);
    if (!url) return;
    // aiLog is debug-only history of AI request/response pairs — not needed
    // for cross-device play continuity, and is the main driver of gs size
    // (a late-game charter routinely pushes past 256 KB with aiLog included).
    // Strip it from the synced payload; the local copy keeps it for export.
    const { aiLog: _omit, ...gsForSync } = gs;
    const body = JSON.stringify(gsForSync);
    setSizeWarning(body.length > 200 * 1024);
    if (body.length > 256 * 1024) {
      setStatus('error');
      setError('save too large to sync (>256 KB even without aiLog)');
      return;
    }
    inFlight.current = true;
    setStatus('pushing');
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (!res.ok) {
        setStatus(res.status >= 500 || res.status === 429 ? 'offline' : 'error');
        setError(`PUT ${res.status}`);
        return;
      }
      const data = await res.json();
      writePointer({ lastKnownCloudVersion: data.version, lastSyncAt: data.savedAt, lastKnownDay: gs.day });
      setStatus('idle');
      setError(null);
    } catch (e) {
      setStatus('offline');
      setError(e.message || String(e));
    } finally {
      inFlight.current = false;
    }
  };

  const triggerPush = (gs) => {
    if (!gs?.playthroughId) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { pushNow(gs); }, 5000);
  };

  // Cancel any pending debounced push without firing it. Used by the conflict
  // detection path so a 5-second debounced push doesn't race with the player's
  // resolution choice and silently overwrite the cloud version they're picking.
  const cancelPendingPush = () => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  };

  // Cleanup: clear any pending debounce on unmount so a stale timer doesn't
  // fire into a torn-down component instance.
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // Merge a pulled cloud body with the local gs so device-only fields
  // (aiLog, and any other transient debug state) survive the pull. Used by
  // the pull-on-launch flow and the conflict-resolution "use cloud" path.
  const applyPull = (localGs, cloudBody) => ({
    ...cloudBody,
    aiLog: localGs?.aiLog || [],
  });

  const pullNow = async (playthroughId) => {
    if (!playthroughId) return { status: 'none' };
    const url = buildSyncUrl('/api/save', playthroughId);
    if (!url) return { status: 'none' };
    // Guard against concurrent pulls (e.g. React-strict-mode double-fire of the
    // pull-on-launch effect, or an opt-in pull racing a manual menu pull). The
    // 'busy' return is a no-op for callers — none of their result.status
    // branches match, so they simply do nothing this round.
    if (pullInFlight.current) return { status: 'busy' };
    pullInFlight.current = true;
    setStatus('pulling');
    try {
      const res = await fetch(url);
      if (res.status === 404) {
        setStatus('idle');
        return { status: 'push', remote: null };
      }
      if (!res.ok) {
        setStatus('error');
        setError(`GET ${res.status}`);
        return { status: 'error' };
      }
      const remote = await res.json();
      setStatus('idle');
      return { status: 'fetched', remote };
    } catch (e) {
      setStatus('offline');
      setError(e.message || String(e));
      return { status: 'error' };
    } finally {
      pullInFlight.current = false;
    }
  };

  // Cross-device discovery: list every charter saved under the device's
  // factor key. Used by the title screen to surface charters that exist
  // only on the cloud (e.g. ones started on a different device). Returns
  // the raw charter manifests; the title screen merges with local saves
  // and dedupes by playthrough id.
  const pullFactorIndex = async () => {
    const factorKey = ensureFactorKey();
    if (!factorKey) return { status: 'none', charters: [] };
    try {
      const res = await fetch(`/api/factor-saves?key=${encodeURIComponent(factorKey)}`);
      if (!res.ok) return { status: 'error', charters: [] };
      const data = await res.json();
      return { status: 'ok', charters: Array.isArray(data?.charters) ? data.charters : [] };
    } catch (e) {
      return { status: 'offline', charters: [] };
    }
  };

  // Fetch the full body for a remote charter by playthrough id. Used by the
  // title screen when the player picks a remote-only charter to hydrate.
  const pullCharterById = async (playthroughId) => {
    if (!isValidPlaythroughId(playthroughId)) return { status: 'invalid' };
    const url = buildSyncUrl('/api/save', playthroughId);
    if (!url) return { status: 'none' };
    try {
      const res = await fetch(url);
      if (res.status === 404) return { status: 'not-found' };
      if (!res.ok) return { status: 'error' };
      const remote = await res.json();
      return { status: 'ok', body: remote.body, version: remote.version, savedAt: remote.savedAt };
    } catch (e) {
      return { status: 'offline' };
    }
  };

  // Auto-export a save object as a downloaded Manuscript JSON.
  const exportManuscript = (gs, label) => {
    if (typeof window === 'undefined') return;
    try {
      const manuscript = { gs, exportedAt: new Date().toISOString(), label };
      const blob = new Blob([JSON.stringify(manuscript, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const playerName = gs?.player?.name || 'unnamed';
      const day = gs?.day || 0;
      a.download = `factors-charter-${playerName}-day${day}-${label}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (e) { /* download blocked; player still has the local copy */ }
  };

  return {
    status, error, sizeWarning,
    pointer: readPointer,
    writePointer,
    triggerPush, pushNow, pullNow, cancelPendingPush,
    pullFactorIndex, pullCharterById,
    exportManuscript,
    applyPull,
    setStatus,
  };
}

// Live online/offline state. When offline the deterministic game plays in
// full; only the online enhancements (illustrations, cross-device sync) are
// unavailable, and the player deserves to know that's why — not to think the
// game is broken.
function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

// True once a new service worker takes control mid-session (a deploy landed
// while the page was open). skipWaiting + clientsClaim mean the new bundle is
// already live on next navigation; the toast just invites a refresh so the
// player isn't on half-old code. Guards against the first-ever-load claim
// (no prior controller) registering as an "update".
function useSwUpdate() {
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const hadController = !!navigator.serviceWorker.controller;
    const onChange = () => { if (hadController) setUpdated(true); };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange);
  }, []);
  return updated;
}

// Fixed top banner for ambient state — offline notice and new-version prompt.
// pointer-events scoped so it never blocks taps on the UI beneath except on
// the refresh control itself.
function AmbientStatus({ online, swUpdated }) {
  if (online && !swUpdated) return null;
  return (
    <div style={{
      position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0,
      zIndex: 70, display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: '1px', pointerEvents: 'none',
    }}>
      {!online && (
        <div style={{
          background: '#5c1a08', color: '#f0e3c4', fontFamily: '"EB Garamond", serif',
          fontStyle: 'italic', fontSize: '0.82em', padding: '0.25rem 0.9rem',
          letterSpacing: '0.02em', boxShadow: '0 1px 4px rgba(42,26,10,0.3)',
        }}>
          Ashore, no packet-boat — the journal keeps; illustrations and sync await yr. return.
        </div>
      )}
      {swUpdated && (
        <button
          onClick={() => window.location.reload()}
          style={{
            pointerEvents: 'auto', cursor: 'pointer',
            background: '#8b5a1a', color: '#f0e3c4', border: 'none',
            fontFamily: '"IM Fell English SC", serif', fontSize: '0.8em',
            letterSpacing: '0.04em', padding: '0.25rem 0.9rem',
            boxShadow: '0 1px 4px rgba(42,26,10,0.3)',
          }}>
          A new printing is ready — tap to refresh.
        </button>
      )}
    </div>
  );
}

// iOS Safari evicts localStorage after ~7 idle days (ITP). The factor key in
// the cloud is the real safety net, but a one-time nudge to keep it somewhere
// is cheap insurance. Returns true on iOS-family browsers.
function isIOSlike() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iP(hone|ad|od)/.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
}

// ═══════════════════════════════════════════════════════════════
//  THE FACTOR'S CHARTER — playable prototype
//  A text-based colonial trading game in the spirit of
//  Robinson Crusoe, Sunless Sea, and House Hlaalu.
// ═══════════════════════════════════════════════════════════════

// ─────────── DATA ───────────

// `weight` is stowage in cwt-equivalents — what a unit of this commodity
// occupies in the hold. Pepper sets the scale at 1.0.
const COMMODITIES = {
  pepper:     { name: 'Pepper',     unit: 'cwt',    basePrice: 12,  weight: 1.0  },
  cinnamon:   { name: 'Cinnamon',   unit: 'cwt',    basePrice: 18,  weight: 1.0  },
  calico:     { name: 'Calico',     unit: 'bolt',   basePrice: 8,   weight: 0.4  },
  silver:     { name: 'Silver',     unit: 'oz',     basePrice: 25,  weight: 0.02 },
  sandalwood: { name: 'Sandalwood', unit: 'log',    basePrice: 6,   weight: 1.5  },
  opium:      { name: 'Opium',      unit: 'chest',  basePrice: 45,  weight: 0.6  },
  rice:       { name: 'Rice',       unit: 'sack',   basePrice: 3,   weight: 1.0  },
  rum:        { name: 'Rum',        unit: 'barrel', basePrice: 7,   weight: 2.0  },
  saltpetre:  { name: 'Saltpetre',  unit: 'cask',   basePrice: 22,  weight: 1.2  },
  // Native to Borneo and Sumatra; resinous, valued in apothecaries from
  // Madras to Marseille. Fragrant, light, slow to come down from the inland.
  camphor:    { name: 'Camphor',    unit: 'cwt',    basePrice: 28,  weight: 0.3  },
  // Spanish/Portuguese-introduced, traded everywhere by 1720s. Local
  // demand at Bayan-Kor and Kota Pinang; Eustace gets supply via Manila.
  tobacco:    { name: 'Tobacco',    unit: 'lb',     basePrice: 6,   weight: 0.5  },
  // Fine-goods cargo class — high value, near-zero weight. Persian Gulf
  // and Malabar pearls; rare in any port; coveted everywhere.
  pearls:     { name: 'Pearls',     unit: 'string', basePrice: 60,  weight: 0.05 },
  // Indian-cut and uncut. The Factor's strongbox can hide a fortune in
  // diamonds without anyone noticing.
  diamonds:   { name: 'Diamonds',   unit: 'parcel', basePrice: 200, weight: 0.01 },
  // Pegu / inland-Sumatran teak. Heavy, slow-growing, prized for ship's
  // keels — the brigantine at Bayan-Kor was built of it. Available at
  // Kota Pinang's inland teak yard once the Factor holds the concession.
  teak:       { name: 'Teak',       unit: 'log',    basePrice: 14,  weight: 1.8  },
  // Indian dyestuff. The Hollanders trade it on their own books at
  // Eustace; in the back rooms, the price is more agreeable.
  indigo:     { name: 'Indigo',     unit: 'cake',   basePrice: 22,  weight: 0.5  },
  // Salvaged from whale carcasses; period-real, used in perfume; near-
  // weightless, fortune-bearing. The wreckers at the Pelican's Nest take
  // what the sea returns.
  ambergris:  { name: 'Ambergris',  unit: 'lump',   basePrice: 150, weight: 0.04 },
  // Malay catechu, an extract of the gambir vine, used in tanning and
  // dyeing. Bulky, mid-priced, the kind of cargo a plantation warehouse
  // turns out by the season.
  gambier:    { name: 'Gambier',    unit: 'cake',   basePrice: 9,   weight: 1.2  },
};

// Each port has finite stocks of what it sells, replenishing over time.
// `stockMax` is the warehouse cap; `restock` is the per-day replenishment rate
// (fractional, accumulated). Buying depletes; tickDays restores up to the cap.
const PORTS = {
  'Bayan-Kor': {
    name: 'Bayan-Kor',
    blurb: 'Your station. A thatched godown, a leaky dock, and the Rajah\u2019s palace on the hill.',
    daysFromHome: 0, isHome: true,
    sells: { rice: 0.85, sandalwood: 0.75, camphor: 0.85 },
    stockMax: { rice: 40, sandalwood: 18, camphor: 14 },
    restock:  { rice: 0.5, sandalwood: 0.2, camphor: 0.15 },
    buys:  { calico: 1.3, rum: 1.4, silver: 1.2, tobacco: 1.2, pearls: 1.3 },
    faction: 'rajah',
  },
  'Kota Pinang': {
    name: 'Kota Pinang',
    blurb: 'A pepper port up the strait. The Sultan tolerates Europeans, and taxes them.',
    daysFromHome: 3,
    sells: { pepper: 0.7, cinnamon: 0.85, sandalwood: 0.9, camphor: 0.9, pearls: 0.75 },
    stockMax: { pepper: 80, cinnamon: 30, sandalwood: 22, camphor: 18, pearls: 6 },
    restock:  { pepper: 0.7, cinnamon: 0.3, sandalwood: 0.2, camphor: 0.2, pearls: 0.05 },
    buys:  { calico: 1.4, opium: 1.5, silver: 1.1, rum: 1.2, tobacco: 1.3 },
    faction: 'rajah',
    yard: 'middling',
    yardBlurb: 'The Sultan\u2019s harbormaster keeps men who know their trade. The work is fair, the wait reasonable.',
  },
  'Port St. Eustace': {
    name: 'Port St. Eustace',
    blurb: 'A Dutch harbor, whitewashed and orderly. Their factor watches you closely.',
    daysFromHome: 5,
    sells: { calico: 0.75, opium: 0.85, saltpetre: 0.8, tobacco: 0.8 },
    stockMax: { calico: 60, opium: 14, saltpetre: 24, tobacco: 30 },
    restock:  { calico: 0.5, opium: 0.15, saltpetre: 0.3, tobacco: 0.4 },
    buys:  { pepper: 1.4, cinnamon: 1.5, sandalwood: 1.2, silver: 1.05, camphor: 1.4, pearls: 1.35, ambergris: 1.5, gambier: 1.25 },
    faction: 'dutch', rivalRisk: true,
    // Port duty levied on every transaction. Modulated by Dutch standing
    // through portTaxRate(). The Calvinist clerks miss nothing.
    taxBase: 0.10,
    yard: 'fine',
    yardBlurb: 'The Dutch yard is the finest east of the Cape \u2014 and they will charge a Calvinist\u2019s price.',
  },
  'The Pelican\u2019s Nest': {
    name: 'The Pelican\u2019s Nest',
    blurb: 'A hidden cove east of the chart. The Brotherhood holds court here. No flag flies.',
    daysFromHome: 7, requiresRep: { pirates: 10 },
    sells: { silver: 0.65, opium: 0.7, saltpetre: 0.6 },
    stockMax: { silver: 200, opium: 18, saltpetre: 28 },
    restock:  { silver: 1.5, opium: 0.2, saltpetre: 0.3 },
    buys:  { rum: 1.7, calico: 1.3, rice: 1.5, tobacco: 1.4, camphor: 1.3 },
    faction: 'pirates',
    yard: 'rough',
    yardBlurb: 'The Brotherhood\u2019s wreckers can patch a hull in a hurry \u2014 with what timber they have lifted from elsewhere.',
  },
  'Tanjung Cermin': {
    name: 'Tanjung Cermin',
    blurb: 'A deep lagoon further east, shown on no chart. Seven shades of blue water, an old Portuguese fort gone to the trees.',
    daysFromHome: 14,
    requiresRep: { pirates: 25 },
    requiresVisited: 'The Pelican\u2019s Nest',
    sells: { silver: 0.55, opium: 0.6, saltpetre: 0.55, pearls: 0.65, diamonds: 0.7 },
    stockMax: { silver: 220, opium: 24, saltpetre: 32, pearls: 8, diamonds: 4 },
    restock:  { silver: 1.7, opium: 0.25, saltpetre: 0.35, pearls: 0.06, diamonds: 0.04 },
    buys:  { rum: 1.9, calico: 1.5, rice: 1.6, tobacco: 1.5 },
    faction: 'pirates',
    yard: 'rough',
    yardBlurb: 'A wreckers\u2019 slip among the palms \u2014 driftwood, prize timber, and what the lagoon will give up.',
  },
  'Fort Marlborough': {
    name: 'Fort Marlborough',
    blurb: 'A British factory on the Sumatran coast \u2014 Crown garrison, RN water station, the Union flag over the bastion.',
    daysFromHome: 8,
    requiresRep: { crown: 10 },
    sells: { saltpetre: 0.65, calico: 0.85 },
    stockMax: { saltpetre: 24, calico: 40 },
    restock:  { saltpetre: 0.3, calico: 0.5 },
    buys:  { pepper: 1.5, cinnamon: 1.6, sandalwood: 1.3, camphor: 1.5, pearls: 1.4, diamonds: 1.5, teak: 1.6, indigo: 1.4, ambergris: 1.6, gambier: 1.3 },
    faction: 'crown',
    yard: 'fine',
    yardBlurb: 'Crown carpenters at the King\u2019s pay \u2014 close work, no Dutchman\u2019s premium, the figures plainly written.',
  },
};

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 PORT SUBLOCATIONS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// A second trade panel that opens at certain ports when gating flags are
// set. Same shape as a port's sells/stockMax/restock \u2014 the player buys at
// the panel like a sublocation of the port. Doesn't change the port's
// main trade columns; renders as a separate panel below.

const PORT_SUBLOCATIONS = {
  'Kota Pinang': {
    key: 'teak-yard',
    label: 'THE INLAND TEAK YARD',
    blurb: 'A clearing inland of Kota Pinang \u2014 yr. own concession by the Vizier\'s grant. The teak is felled, squared, and stacked here at the cut price an English Factor pays his own foreman.',
    gate: (gs) => gs.flags?.teakConcession === 'self',
    sells:    { teak: 0.6 },
    stockMax: { teak: 24 },
    restock:  { teak: 0.25 },
  },
  'Port St. Eustace': {
    key: 'back-rooms',
    label: 'THE BACK ROOMS',
    blurb: 'A separate counting-house behind the Dutch warehouse, where the Hollanders\' clerks transact what the open ledger does not record. Yr. trade pass admits you. Indian indigo by way of Surat — not on Eustace\'s open books.',
    gate: (gs) => gs.flags?.dutchTradePass === true,
    sells:    { indigo: 0.65 },
    stockMax: { indigo: 16 },
    restock:  { indigo: 0.3 },
  },
  'The Pelican’s Nest': {
    key: 'wreckers-market',
    label: 'THE WRECKERS\' MARKET',
    blurb: 'A scattered stall under a tarpaulin behind the cove, where what the sea returns is laid out for the discerning buyer. Ambergris washed up at the reef; the price is what the wreckers ask, and the wreckers know what they have.',
    gate: (gs) => (gs.reputation?.pirates || 0) >= 20,
    sells:    { ambergris: 0.7 },
    stockMax: { ambergris: 5 },
    restock:  { ambergris: 0.04 },
  },
  'Bayan-Kor': {
    key: 'plantation-warehouse',
    label: 'THE PLANTATION WAREHOUSE',
    blurb: 'A small store-shed at the edge of yr. own pepper plantation, where Aman Singh\'s men cake the gambir vine extract in season. Mid-bulk, mid-price; fair to a Factor whose foreman is paid by the Company.',
    gate: (gs) => !!gs.outpost?.buildings?.plantation?.built,
    sells:    { gambier: 0.7 },
    stockMax: { gambier: 30 },
    restock:  { gambier: 0.4 },
  },
};

// Returns the active sublocation for a port given current state, or null.
function activeSublocation(portKey, gs) {
  const sub = PORT_SUBLOCATIONS[portKey];
  if (!sub) return null;
  return sub.gate && sub.gate(gs) ? sub : null;
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 SHIPS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Hull and sails are 0\u2013100 condition. Voyages chip both. Below MIN_SAIL_COND
// the master refuses to put to sea \u2014 repair at any wharf, at varying cost.
const SHIP_TYPES = {
  pinnace: {
    name: 'Pinnace',
    holdCwt: 60,
    blurb: 'A modest single-masted vessel. Quick on a fair wind, fragile in a foul one.',
    wearMin: 1.0,
    wearMax: 3.0,
    voyageBonus: 0,
  },
  brigantine: {
    name: 'Brigantine',
    holdCwt: 180,
    blurb: 'A two-masted country brigantine, square-rigged forward and fore-and-aft on the main. Built of Pegu teak, which the worm cannot find a tooth in.',
    wearMin: 0.6,
    wearMax: 1.5,
    // -1 day on any voyage of 4+ days. Stacks with the Shipwright's Yard.
    voyageBonus: 1,
  },
};
const MIN_SAIL_COND = 25;
const MIN_HULL_COND = 25;

// Yard quality determines per-point cost and time for a ship refit.
// Home (Bayan-Kor) is special-cased: instant, with its own rate.
const YARDS = {
  rough:    { label: 'rough',    costPerPoint: 3.0, timePerPoint: 0.3 },
  middling: { label: 'middling', costPerPoint: 2.5, timePerPoint: 0.2 },
  fine:     { label: 'fine',     costPerPoint: 2.0, timePerPoint: 0.15 },
};

// How standing with the local faction modifies refit cost and time at non-home
// ports. Cordial = a concession; hostile = a gouge.
const standingMult = (rep) => {
  if (rep >= 50) return 0.75;
  if (rep >= 20) return 0.85;
  if (rep >= -5) return 1.0;
  if (rep >= -20) return 1.15;
  return 1.4;
};

const FACTIONS = {
  company: { name: 'The Honourable Company', short: 'Company' },
  crown:   { name: 'The Crown',              short: 'Crown'   },
  rajah:   { name: 'The Rajah of Bayan-Kor', short: 'Rajah'   },
  pirates: { name: 'The Brotherhood',        short: 'Pirates' },
  mission: { name: 'The Mission',            short: 'Mission' },
  dutch:   { name: 'The Dutch East India',   short: 'Dutch'   },
};

const BUILDINGS = {
  stockade: {
    name: 'Stockade',
    days: 30, cost: 80,
    blurb: 'A timber palisade and a watchtower of palmyra logs. Discourages opportunists, and reassures the night-watch.',
    effect: 'Halves the chance of a raid on the godown; fewer incidents at home.',
  },
  counting_house: {
    name: 'Counting House',
    days: 45, cost: 100,
    blurb: 'Proper books, separate ledgers, a writing-desk that does not warp in the rains.',
    effect: 'Hodge keeps better accounts; modestly improves your prices in port.',
  },
  chapel: {
    name: 'Mission Chapel',
    days: 60, cost: 120,
    blurb: 'A small whitewashed chapel for the Reverend\u2019s use. The Rajah will note its construction.',
    effect: 'Mission +20 standing. Rajah \u221210 standing.',
  },
  plantation: {
    name: 'Pepper Plantation',
    days: 90, cost: 200,
    blurb: 'Cleared land inland, planted to pepper. Returns a crop with each long monsoon.',
    requires: { rep: { rajah: 10 } },
    effect: 'Yields ~5 cwt of pepper every 30 days.',
  },
  barracks: {
    name: 'Sepoy Barracks',
    days: 75, cost: 180,
    blurb: 'Quarters for a proper guard. Three sepoys quartered, paid by the Company.',
    requires: { rep: { crown: 5 } },
    effect: 'Halves the chance of a godown raid again; a garrison steadies the compound.',
  },
  shipwright: {
    name: 'Shipwright\u2019s Yard',
    days: 60, cost: 150,
    blurb: 'A slipway and a small forge. The pinnace will be the better for it.',
    effect: 'Voyages take one day less.',
  },
  great_godown: {
    name: 'Great Godown',
    days: 50, cost: 140,
    blurb: 'A proper warehouse of teak and tile, raised on stone piers against the rains and the rats.',
    effect: 'Adds 400 cwt to your port-side storage.',
  },
  magazine: {
    name: 'Powder Magazine',
    days: 35, cost: 100,
    blurb: 'A low stone vault, set apart from the godown. Iron-banded door, a single high window, a key kept on the Sergeant\u2019s person.',
    effect: 'Caps any single raid\u2019s loss at 10%. Reassures the night-watch.',
  },
};

// Each completed building brings a person — Raven Rock pattern. Named figure
// added to gs.acquaintances on completion (via upsertAcquaintance) and then
// surfaces in stateContext for the AI to reference in later scenes.
const BUILDING_ARRIVALS = {
  stockade: {
    name: 'Lal',
    role: 'Watchman',
    location: 'Bayan-Kor',
    notes: 'A wiry Tamil man of perhaps forty; engaged to keep the night watch from the new tower. Sleeps badly, sees everything.',
    arrivalText: 'A watchman, Lal, has been engaged to keep the new stockade tower at night. He sleeps in the day and walks in the dark.',
  },
  counting_house: {
    name: 'Mr. Penhaligon',
    role: 'Apprentice Clerk',
    location: 'Bayan-Kor',
    notes: 'A Cornish boy of seventeen, nephew to a Madras factor; sent to learn the trade under Mr. Hodge.',
    arrivalText: 'Mr. Penhaligon, an apprentice clerk of seventeen, has come down from Madras to learn the trade in the new Counting House. Hodge is, by his own report, gratified. (His cousin Reginald, by report, writes from Bencoolen under Mr. Hardacre.)',
  },
  chapel: {
    name: 'Catechist Joseph',
    role: 'Catechist of the Mission',
    location: 'Bayan-Kor',
    notes: 'A Tamil convert in his thirties; teaches the children the Creed in three languages. Quiet, patient, devoted to the Reverend.',
    arrivalText: 'A catechist named Joseph has come to the new chapel — a Tamil convert who teaches the Creed in three languages. The Reverend is conspicuously pleased.',
  },
  plantation: {
    name: 'Aman Singh',
    role: 'Plantation Overseer',
    location: 'inland of Bayan-Kor',
    notes: 'A Sikh from the Punjab, soldier-turned-farmer; engaged to oversee the pepper rows. Knows soil and discipline equally.',
    arrivalText: 'Aman Singh, a Sikh of the Punjab and once a soldier, has been engaged as overseer of the new pepper plantation. The first rows go in at the next monsoon.',
  },
  barracks: {
    name: 'Naik Ramaswamy',
    role: 'Sepoy Corporal',
    location: 'Bayan-Kor',
    notes: 'A Madras-establishment veteran of the Carnatic; arrived with two privates to occupy the new barracks. Reports to Sgt. Dass.',
    arrivalText: 'Naik Ramaswamy of the Madras lines has come to take charge of the barracks, with two privates under him. Sgt. Dass took the salute and made no comment.',
  },
  shipwright: {
    name: 'Mr. Gow',
    role: 'Master Shipwright',
    location: 'Bayan-Kor',
    notes: 'A Scotsman from the Clyde, one-eyed, his wife died at Madras. Builds and refits with a sourness that earns no friends and few complaints.',
    arrivalText: 'A shipwright, Mr. Gow of the Clyde, has come to take the new yard. One-eyed, sour, expensive — and the work, by report, immaculate.',
  },
  great_godown: {
    name: 'Tau Beng',
    role: 'Godown-keeper',
    location: 'Bayan-Kor',
    notes: 'A Hokkien Chinese of fifty-five; ran a godown at Malacca for thirty years before the Dutch put him out.',
    arrivalText: 'A new godown-keeper, Tau Beng of Malacca, has been engaged to take charge of the Great Godown. Thirty years at his trade; the rats are by his account already retreating.',
  },
  magazine: {
    name: 'Gunner Trant',
    role: 'Master Gunner',
    location: 'Bayan-Kor',
    notes: 'An Anglo-Irishman; deserted a Madras battery once, was found again, was forgiven. Keeps the new magazine.',
    arrivalText: 'A master gunner, one Trant of Madras, has been engaged for the new Magazine. Anglo-Irish, surly, sound on his charges.',
  },
};

// ─────────── HELPERS ───────────

const hashCode = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
};

const priceFor = (portKey, commodity, day, gs) => {
  const port = PORTS[portKey];
  const base = COMMODITIES[commodity].basePrice;
  const mult = port.sells?.[commodity] ?? port.buys?.[commodity] ?? 1;
  const fluct = ((hashCode(`${day}-${portKey}-${commodity}`) % 21) - 10) / 100;
  const side = port.sells?.[commodity] != null ? 'sell' : 'buy';
  const windowMult = gs ? priceWindowMult(gs, portKey, commodity, side) : 1;
  // Counting House: the registry has promised "modestly improves your prices
  // in port" since v1 but nothing read the flag. Now it's true — 3% in the
  // Factor's favour on either side of the bargain, at every port (Hodge's
  // letters of advice travel with the ship).
  const booksMult = gs?.outpost?.buildings?.counting_house?.built
    ? (side === 'sell' ? 0.97 : 1.03)
    : 1;
  // A network agent (e.g. at Kota Pinang) cheapens what you BUY there — i.e.
  // when the port sells to you (side === 'sell' in this port-centric naming).
  const agentMult = (gs && side === 'sell') ? ventureBuyMult(gs.ventures, portKey, commodity) : 1;
  return Math.max(1, Math.round(base * mult * (1 + fluct) * windowMult * booksMult * agentMult));
};

// The port's own fair rate for a commodity — base × port multiplier ×
// counting-house edge, before daily flux and event windows. The reference
// the UI drifts against; keep in step with priceFor above.
const fairPriceFor = (portKey, commodity, side, gs) => {
  const port = PORTS[portKey];
  const mult = (side === 'sell' ? port.sells?.[commodity] : port.buys?.[commodity]) ?? 1;
  const booksMult = gs?.outpost?.buildings?.counting_house?.built
    ? (side === 'sell' ? 0.97 : 1.03)
    : 1;
  return COMMODITIES[commodity].basePrice * mult * booksMult;
};

// Goods that draw thieves to the godown, and the standing defenses. Single
// source for the tickDays raid roll, the Outpost night-watch note, and the
// chart's departure warning.
const RAID_TEMPTATIONS = ['pepper', 'cinnamon', 'silver', 'opium', 'sandalwood'];
const raidPosture = (gs) => ({
  tempting: RAID_TEMPTATIONS.filter(k => Math.floor(gs.outpost?.warehouse?.[k] ?? 0) >= 1),
  stockade: !!gs.outpost?.buildings?.stockade?.built,
  barracks: !!gs.outpost?.buildings?.barracks?.built,
  magazine: !!gs.outpost?.buildings?.magazine?.built,
});

// Port duty (Dutch tax at Port St. Eustace) — proportion of transaction value.
// Standing fine-tunes (cordial -25%, warm -10%, cool +25%, hostile +60%);
// holding a Dutch trade pass (gs.flags.dutchTradePass) halves the rate
// outright, on top of the standing modifier — that's the load-bearing lever
// above standing. Returns 0 for ports without a taxBase.
const portTaxRate = (gs, portKey) => {
  const port = PORTS[portKey];
  const base = port?.taxBase || 0;
  if (!base) return 0;
  const rep = (gs.reputation?.[port.faction] ?? 0);
  let mult = 1;
  if (rep >= 50) mult = 0.75;
  else if (rep >= 20) mult = 0.90;
  else if (rep >= -5) mult = 1.0;
  else if (rep >= -20) mult = 1.25;
  else mult = 1.6;
  // The pass is a Dutch instrument; only honoured at Dutch ports.
  if (port.faction === 'dutch' && gs.flags?.dutchTradePass) {
    mult *= gs.flags?.dutchTradePassReduced ? 0.75 : 0.5;
  }
  return base * mult;
};

const repTone = (n) => {
  if (n >= 50) return 'cordial';
  if (n >= 20) return 'warm';
  if (n >= 5) return 'agreeable';
  if (n >= -5) return 'neutral';
  if (n >= -20) return 'cool';
  if (n >= -50) return 'hostile';
  return 'inimical';
};

// ─────────── CARGO & SHIP HELPERS ───────────

const cargoWeight = (goods) => {
  let total = 0;
  for (const [k, v] of Object.entries(goods || {})) {
    if (!v) continue;
    const w = COMMODITIES[k]?.weight ?? 1;
    total += v * w;
  }
  return total;
};

const cargoCap = (gs) => gs.ship?.holdCwt ?? 60;

// The thatched godown the Factor inherits is the base store.
// The Great Godown extends it. Capacity is in cwt-equivalents, just like the hold.
const WAREHOUSE_BASE_CAP = 120;
const WAREHOUSE_GREAT_BONUS = 400;
const warehouseCap = (gs) => {
  const great = !!gs.outpost?.buildings?.great_godown?.built;
  return WAREHOUSE_BASE_CAP + (great ? WAREHOUSE_GREAT_BONUS : 0);
};
const warehouseUsed = (gs) => cargoWeight(gs.outpost?.warehouse || {});

// The whole concern's worth — strongbox, godown goods at base price, the
// buildings raised, the ship, and the ventures' book value. A "sense of scale"
// prestige metric: surfaced in the Ledger and the Enterprise panel, and the
// figure the merchant-prince finish reads out. Returns the breakdown + total.
function enterpriseWorth(gs) {
  const money = Math.max(0, Math.round(gs?.money || 0));
  const ware = gs?.outpost?.warehouse || {};
  let godown = 0;
  for (const [c, n] of Object.entries(ware)) {
    godown += Math.floor(n || 0) * (COMMODITIES[c]?.basePrice || 0);
  }
  let buildings = 0;
  for (const [k, b] of Object.entries(gs?.outpost?.buildings || {})) {
    if (b?.built) buildings += (BUILDINGS[k]?.cost || 0);
  }
  const ship = gs?.ship?.type === 'brigantine' ? 700 : 200;
  const ventures = venturesWorth(gs?.ventures);
  const total = money + godown + buildings + ship + ventures;
  return { money, godown, buildings, ship, ventures, total };
}

const fmtCwt = (n) => {
  // Tidy display: integer if it rounds, otherwise one decimal.
  if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
  return n.toFixed(1);
};

// Commodity unit, pluralized for a count. Measure-abbreviations (cwt, oz, lb)
// don't take an 's'; the rest ("barrel", "sack", "string"…) do.
const UNCOUNTABLE_UNITS = new Set(['cwt', 'oz', 'lb']);
const unitLabel = (commodity, n) => {
  const u = COMMODITIES[commodity]?.unit || 'unit';
  if (n === 1 || UNCOUNTABLE_UNITS.has(u)) return u;
  return `${u}s`;
};

// Wear applied per voyage day. Random within the ship type's range so a long
// leg adds up. Returns a new ship object — does not mutate. Teak-hulled
// brigantines wear noticeably slower than the pinnace.
const applyVoyageWear = (ship, days) => {
  const t = SHIP_TYPES[ship?.type] || SHIP_TYPES.pinnace;
  const span = (t.wearMax - t.wearMin);
  let hull = ship.hull;
  let sails = ship.sails;
  for (let i = 0; i < days; i++) {
    hull  -= t.wearMin + Math.random() * span;
    sails -= t.wearMin + Math.random() * span;
  }
  return {
    ...ship,
    hull:  Math.max(0, Math.round(hull)),
    sails: Math.max(0, Math.round(sails)),
  };
};

// Days at sea for a given destination, factoring in the Shipwright's Yard
// (which trims one day off every voyage) and the ship type's voyageBonus
// (the brigantine, on legs of 4+ days). Always returns at least 1.
const voyageDays = (gs, port) => {
  // The world models distance as days-from-home only. A leg costs the GREATER
  // of the two ports' home-distances, so the return trip costs what the
  // outbound did — home's own distance is 0, which otherwise made every
  // return ~1 day regardless of how far out you'd sailed.
  const origin = PORTS[gs?.location];
  const base = Math.max(port?.daysFromHome || 0, origin?.daysFromHome || 0) || 1;
  const hasShipwright = !!gs.outpost?.buildings?.shipwright?.built;
  // The Vizier's Bugis pilots know the strait and inland waters — one day off
  // any passage. Granted by the Vizier's boon (see makeVizierBoonLetter).
  const hasPilots = !!gs.flags?.bugisPilots;
  const t = SHIP_TYPES[gs.ship?.type] || SHIP_TYPES.pinnace;
  const shipBonus = (t.voyageBonus && base >= 4) ? t.voyageBonus : 0;
  return Math.max(1, base - (hasShipwright ? 1 : 0) - (hasPilots ? 1 : 0) - shipBonus);
};

// Yard available to the player at their current port. Home upgrades from
// rough to fine when the Shipwright's Yard is built.
const yardOf = (gs) => {
  const port = PORTS[gs.location];
  if (port?.isHome) {
    return gs.outpost?.buildings?.shipwright?.built ? 'fine' : 'rough';
  }
  return port?.yard || 'middling';
};

// Quote a refit at the player's current location. Returns the cost in money,
// the days the ship will be on the slipway, and the modifiers used. Pass
// { expedite: true } to get a 1.5x cost / half-time variant. Home is instant.
const repairQuote = (gs, opts = {}) => {
  const ship = gs.ship || { hull: 100, sails: 100 };
  const points = (100 - ship.hull) + (100 - ship.sails);
  const port = PORTS[gs.location] || {};
  const yardKey = yardOf(gs);
  const rep = gs.reputation?.[port.faction] ?? 0;
  const sm = port.isHome ? 1 : standingMult(rep);
  if (points <= 0) {
    return { points: 0, cost: 0, days: 0, yard: yardKey, faction: port.faction, rep, standingMult: sm, expedite: !!opts.expedite };
  }
  let cost, days;
  if (port.isHome) {
    const hasYard = !!gs.outpost?.buildings?.shipwright?.built;
    cost = points * (hasYard ? 1 : 2);
    days = 0;
  } else {
    const yard = YARDS[yardKey];
    cost = points * yard.costPerPoint * sm;
    days = Math.ceil(points * yard.timePerPoint * sm);
  }
  if (opts.expedite && days > 0) {
    cost = cost * 1.5;
    days = Math.max(1, Math.ceil(days / 2));
  }
  return {
    points,
    cost: Math.max(1, Math.round(cost)),
    days,
    yard: yardKey,
    faction: port.faction,
    rep,
    standingMult: sm,
    expedite: !!opts.expedite,
  };
};

// Lazily seed any fields a save may be missing — keeps older manuscripts
// loadable without forcing a Begin Anew. Pure: returns a new state.
const ensureShape = (gs) => {
  const next = { ...gs };
  if (!next.ship) {
    next.ship = { name: 'The Pinnace', type: 'pinnace', holdCwt: SHIP_TYPES.pinnace.holdCwt, hull: 100, sails: 100, guns: 0 };
  }
  if (!next.portStocks) {
    next.portStocks = {};
    for (const [k, p] of Object.entries(PORTS)) {
      next.portStocks[k] = { ...(p.stockMax || {}) };
    }
  }
  if (!Array.isArray(next.acquaintances)) next.acquaintances = [];
  if (!next.tradeStats || typeof next.tradeStats !== 'object') next.tradeStats = {};
  if (!next.flags || typeof next.flags !== 'object') next.flags = {};
  // Seed wealth-milestone flags for thresholds an existing save already meets,
  // so crossing into this feature doesn't retroactively fire a run of them.
  next.flags = seedWealthFlags(next.money, next.flags);
  if (!Array.isArray(next.aiLog)) next.aiLog = [];
  if (!next.outpost || typeof next.outpost !== 'object') {
    next.outpost = { buildings: {}, queue: [], warehouse: {} };
  } else if (!next.outpost.warehouse || typeof next.outpost.warehouse !== 'object') {
    next.outpost = { ...next.outpost, warehouse: {} };
  }
  if (!next.indiaman || typeof next.indiaman !== 'object') {
    // Returning saves: schedule the next visit from today, with a 30-day grace
    // so the Factor has time to lodge stock before the first call.
    const visits = Math.floor((next.day || 1) / 180);
    const nextDay = Math.max(180, (next.day || 1) + 30);
    next.indiaman = { lastVisit: 0, nextDay, visits, lastQuarterly: 0 };
  } else if (next.indiaman.lastQuarterly === undefined) {
    next.indiaman = { ...next.indiaman, lastQuarterly: next.indiaman.lastVisit || 0 };
  }
  if (next.shipCommission === undefined) {
    next.shipCommission = null;
  }
  if (next.charterClosed === undefined) {
    next.charterClosed = null;
  }
  if (!next.lettersAuto || typeof next.lettersAuto !== 'object') {
    // Returning saves: schedule the next letter ~30–55 days out from today.
    next.lettersAuto = { nextDay: (next.day || 1) + 30 + Math.floor(Math.random() * 25) };
  }
  if (next.privateConsignment === undefined) {
    next.privateConsignment = null;
  }
  if (next.bottomry === undefined) {
    next.bottomry = null;
  }
  if (typeof next.privateTradeProceeds !== 'number') {
    next.privateTradeProceeds = 0;
  }
  if (next.privateConsignmentOffered === undefined) {
    next.privateConsignmentOffered = false;
  }
  if (!Array.isArray(next.pendingLetterRequests)) {
    next.pendingLetterRequests = [];
  }
  // Defensive ensureShape additions — fields that have always existed in
  // makeInitialState but old / corrupted saves may have lost.
  if (!Array.isArray(next.hooks)) next.hooks = [];
  if (!Array.isArray(next.recentEncounters)) next.recentEncounters = [];
  if (!next.ventures || typeof next.ventures !== 'object') next.ventures = {};
  // Living-ventures scheduler state (events the enterprise throws): a cooldown
  // day, the last-fired id (anti-repeat), and the spent `once` events.
  if (typeof next.ventureEventDay !== 'number') next.ventureEventDay = 0;
  if (next.lastVentureEventId === undefined) next.lastVentureEventId = null;
  if (!Array.isArray(next.ventureEventsFired)) next.ventureEventsFired = [];
  if (!Array.isArray(next.journal)) next.journal = [];
  if (!Array.isArray(next.letters)) next.letters = [];
  if (!Array.isArray(next.crew)) next.crew = [];
  if (!Array.isArray(next.visited)) next.visited = ['Bayan-Kor'];
  if (!Array.isArray(next.awayLog)) next.awayLog = [];
  if (!next.npcs || typeof next.npcs !== 'object') {
    next.npcs = {
      hodge:  { name: 'Mr. Hodge',          role: 'Clerk',  sobriety: 60, loyalty: 50, lastDrunk: 0, note: '' },
      dass:   { name: 'Sgt. Dass',          role: 'Sepoy',  loyalty: 75, morale: 65, health: 80, note: '' },
      vizier: { name: 'The Rajah’s Vizier', role: 'Vizier', friendliness: 30, scheming: 0, note: '' },
    };
  }
  if (!next.reputation || typeof next.reputation !== 'object') {
    next.reputation = { company: 0, crown: 0, rajah: 0, pirates: 0, mission: 0, dutch: 0 };
  }
  if (!next.quotas || typeof next.quotas !== 'object') {
    next.quotas = { pepper: { needed: 400, have: 0 }, cinnamon: { needed: 200, have: 0 } };
  }
  if (!next.player || typeof next.player !== 'object' || !next.player.name) {
    next.player = next.player || { name: 'The Factor', title: 'Factor' };
  }
  // Sync model: cross-device sync is implicit via the device's factor key
  // (localStorage `factor_key_v1`). Every charter has a playthroughId from
  // birth — there is no opt-in step, no syncEnabled gate. Old saves get one
  // auto-attached here on first load after the upgrade.
  //
  // The legacy syncEnabled / syncPromptShown fields have been deleted as of
  // 2026-05-10 — nothing read them anymore. Saves that still carry stale
  // values keep them as harmless excess JSON; the next save tick strips
  // them via the natural setGs reducer flow.
  if (!isValidPlaythroughId(next.playthroughId)) next.playthroughId = generatePlaythroughId();
  // Per-charter image gallery: grows as the player encounters scenes that
  // load illustrations. Capped at MAX_GALLERY_ENTRIES to keep gs size sane
  // for the 256 KB sync cap (60 entries × ~400 bytes each ≈ 24 KB).
  // Each entry: { id, prose, fullPrompt, seed, url, day, capturedAt,
  //               regeneratedAt?, deletedByPlayer?, deletedAt? }
  if (!Array.isArray(next.illustrations)) next.illustrations = [];
  if (!next.rivals) {
    next.rivals = makeInitialRivals();
  }
  if (!Array.isArray(next.priceWindows)) {
    next.priceWindows = [];
  }
  if (typeof next.rivalPressure !== 'number') {
    next.rivalPressure = 50;
  }
  if (!Array.isArray(next.rivalPressureModifiers)) {
    next.rivalPressureModifiers = [];
  }
  if (typeof next.sabotagesCommitted !== 'number') {
    next.sabotagesCommitted = 0;
  }
  return next;
};

// Maximum number of AI exchanges retained on the live state. We cap so a
// long charter doesn't blow past localStorage limits — the manuscript
// download still gets the cap'd record, which is fine for offline review.
const AI_LOG_CAP = 500;

// Append an AI call record to the log, trimming the oldest entries if needed.
const pushAiLog = (log, entry) => {
  const next = [...(log || []), entry];
  return next.length > AI_LOG_CAP ? next.slice(next.length - AI_LOG_CAP) : next;
};

// Insert or merge an AI-introduced minor character. Dedupes on lowercased name;
// existing entries get their lastSeen day bumped and a new note appended.
const upsertAcquaintance = (list, day, npc) => {
  if (!npc || !npc.name) return list;
  const idx = list.findIndex(a => a.name.toLowerCase() === npc.name.toLowerCase());
  if (idx >= 0) {
    const existing = list[idx];
    const merged = {
      ...existing,
      role: npc.role || existing.role,
      location: npc.location || existing.location,
      lastSeen: day,
      notes: npc.notes ? (existing.notes ? `${existing.notes} / ${npc.notes}` : npc.notes) : existing.notes,
    };
    return [...list.slice(0, idx), merged, ...list.slice(idx + 1)];
  }
  return [
    ...list,
    {
      id: `${npc.name.replace(/\s+/g, '_').toLowerCase()}_d${day}`,
      name: npc.name,
      role: npc.role || '',
      location: npc.location || '',
      notes: npc.notes || '',
      introduced: day,
      lastSeen: day,
    },
  ];
};

// ─────────── INITIAL STATE ───────────

const makeInitialState = (name) => {
  const directorLetter = {
    id: 1,
    from: 'The Court of Directors, London',
    subject: 'Your Appointment & Charter',
    body: `Sir, \u2014 These presents confirm the appointment, freely given by the Court, of yourself to the Factory at Bayan-Kor, in succession to the late Mr. Wilbraham. You will receive this with the goods and capital noted in the manifest enclosed.

The Court reminds you that returns of pepper (no less than four hundredweight) and cinnamon (no less than two hundredweight) are to be lodged at our House by the close of the third year, failing which a successor shall be despatched. We shall expect your first quarterly return without delay.

In the matter of the Dutch, we counsel discretion. In the matter of the Brotherhood, we counsel none.

Yr. most obedient servants, the Court of Directors, in London, &c.`,
    responses: [
      { label: 'Acknowledge with formal compliance', seed: 'company satisfied, no surprises' },
      { label: 'Acknowledge but request clarification on the Brotherhood', seed: 'company notes initiative; opens question of pirates' },
      { label: 'Acknowledge briefly and turn to the work', seed: 'no rep change; directors consider you efficient' },
    ],
    read: false,
  };

  const wilbrahamPapers = {
    id: 2,
    from: 'The late Mr. Wilbraham (papers tied with twine)',
    subject: 'A packet of journal entries, found in the godown',
    body: `[A bound packet of personal entries from the previous Factor. A selection, in his own hand, follows.]

26 March, 1719. \u2014 Took up the Charter today at Bayan-Kor. The Vizier sent two boys with mangoes and a courteous note. Hodge says this means I am owed a return-gift of equal worth before the moon turns. I shall send him salt; the Rajah\u2019s people prize it.

2 May. \u2014 The returns the Court demands \u2014 pepper, four hundredweight; cinnamon, two \u2014 are not grown at this door. The pepper comes up the strait from Kota Pinang, where the Sultan\u2019s barges bring it cheap and the Sultan\u2019s men tax it dear; the cinnamon with it, in lesser quantity. I buy what the hold will carry, lodge it in the godown here, and wait on the Company Indiaman to lift it for London. The godown is the whole art of it: fill it before the ship calls, or she sails light, and the Court reads a light ship as sloth.

12 June. \u2014 The Bugis prahu is in the strait again. Capt. Faulke called it a "Brotherhood trader" and would not say more. I had three barrels of rum traded out of me at gunpoint last month and have learned not to ask.

30 July. \u2014 A man does not grow rich on the Company\u2019s quota; he grows rich in the gaps between the ports. The rum and rice they victual you with fetch little at this wharf \u2014 carry them where they are wanted, eastward to the Nest the Brotherhood keeps, which will pay near double for a barrel, or to any port grown sick of its own surplus. Buy a thing where it is cheap, sell it where it is dear, and let the quota be the floor beneath yr. feet, not the roof above yr. head. It is the first rule of the country trade, and I wish someone had set it before me sooner.

8 September. \u2014 The Vizier requires my presence at the palace each Friday for the audience. I am, I now realise, his preferred Englishman. I do not flatter myself that this is for my conversation.

19 December. \u2014 A long letter from London chastising my returns. They cannot conceive what is involved here. I shall not bother answering at length.

3 February, 1720. \u2014 The fever was worse last night. Hodge wept. Dass kept the watch. I owe them both. If I do not survive the wet season, the inland teak concession should on no account be sold to ter Borch. He has waited five years for it and would have it cheap.

22 March. \u2014 The Vizier sent his clerk again with the same question. I gave the same answer. I do not think he believes me. I do not think it matters that he believe me.

[The last entry is in a different hand, hurried:]

Mr. W. died this morning at half past four. The Reverend will not come down from the Mission. I have laid him in the chapel. \u2014 Hodge.`,
    responses: [
      { label: 'Set the papers aside, with a heavy hand', seed: 'no immediate effect; thread remembered' },
    ],
    read: false,
  };

  const initialPortStocks = {};
  for (const [k, p] of Object.entries(PORTS)) {
    initialPortStocks[k] = { ...(p.stockMax || {}) };
  }

  return {
  day: 1,
  location: 'Bayan-Kor',
  player: { name, title: 'Factor' },
  money: 500,
  goods: { rum: 5, rice: 8 },
  ship: {
    name: 'The Pinnace',
    type: 'pinnace',
    holdCwt: SHIP_TYPES.pinnace.holdCwt,
    hull: 100,
    sails: 100,
    guns: 0,
  },
  portStocks: initialPortStocks,
  rivals: makeInitialRivals(),
  priceWindows: [],
  rivalPressure: 50,
  rivalPressureModifiers: [],
  sabotagesCommitted: 0,
  reputation: { company: 0, crown: 0, rajah: 0, pirates: 0, mission: 0, dutch: 0 },
  crew: [
    { name: 'Mr. Hodge', role: 'Clerk', trait: 'drunkard' },
    { name: 'Sgt. Dass', role: 'Sepoy', trait: 'steady' },
  ],
  npcs: {
    hodge: {
      name: 'Mr. Hodge', role: 'Clerk',
      sobriety: 60,        // 0-100; lower = drinking heavily
      loyalty: 50,         // 0-100
      lastDrunk: 0,        // last day drunk (cooldown)
      note: 'Came out from Bristol on a five-year clerkship. The third year is the worst.',
    },
    dass: {
      name: 'Sgt. Dass', role: 'Sepoy',
      loyalty: 75, morale: 65, health: 80,
      note: 'Of the Madras Establishment, transferred to your station. Speaks four languages, none of them at length.',
    },
    vizier: {
      name: 'The Rajah\u2019s Vizier', role: 'Vizier',
      friendliness: 30,    // 0-100
      scheming: 0,         // grows with attention; can break against you
      note: 'Soft-spoken, perfumed, never seen without his betel-box. His face does not give.',
    },
  },
  outpost: {
    buildings: {},      // key -> { built: true, builtOn: day } when complete
    queue: [],          // [{ key, daysLeft }]
    warehouse: {},      // commodity -> qty; port-side storage at Bayan-Kor
  },
  awayLog: [],          // events accrued while away from Bayan-Kor; cleared on digest
  quotas: { pepper: { needed: 400, have: 0 }, cinnamon: { needed: 200, have: 0 } },
  daysRemaining: 1095,
  // The charter is for three years. When daysRemaining hits 0, the Court
  // closes the file: a final letter lands, the day stops counting toward the
  // quota, and the title roster slot is marked closed.
  charterClosed: null, // null while running; { day, outcome } when closed
  indiaman: { lastVisit: 0, nextDay: 180, visits: 0, lastQuarterly: 0 },
  shipCommission: null, // { type, name, daysLeft, paid, tradeIn } when laying down a new vessel
  // Auto-delivered AI letters from the wider world (sister, captains, factions).
  // The Director (Indiaman + quarterly) and the Vizier (teak letter) have their
  // own dedicated cadences; this is for everyone else.
  lettersAuto: { nextDay: 12 },  // first contact from the wider world lands around the maiden voyage's return; the world should feel alive early, not after a month of silence. Subsequent cadence (30–55d) is unchanged.
  pendingLetterRequests: [],
  // Private trade allowance — period-accurate side income. Each Indiaman call
  // offers up to PRIVATE_TRADE_LIMIT cwt of any commodity to be shipped on
  // the Factor's own account. Funds return at the next Indiaman call at a
  // London-market multiplier. While in flight, the consignment lives here.
  privateConsignment: null, // null | { commodities: { key: cwt }, shippedDay, returnDay, expectedPayout }
  privateTradeProceeds: 0,  // cumulative £ proceeds from private trade returns; gates Mountfair
  // A bottomry bond — period-accurate leverage. Loan secured against ship +
  // cargo; repaid at +25% on the next return to Bayan-Kor; forgiven if the
  // voyage suffers significant shipDamage (>= 25 hull or sails) before then.
  bottomry: null, // null | { principal, repayment, takenDay, lender }
  journal: [],
  letters: [directorLetter, wilbrahamPapers],
  hooks: ['The inland teak concession \u2014 ter Borch wants it.'],
  ventures: {},          // the sprawling enterprise \u2014 fleet, agents, capital; persists across succession
  visited: ['Bayan-Kor'],
  acquaintances: [],     // AI-introduced minor characters; recur via stateContext
  flags: {},             // narrative flags the AI may set
  aiLog: [],             // raw record of every Sonnet exchange this charter
  seenOpening: false,
  lettersGenerated: 2,
  firstLetterPresented: false,
  };
};

// ─────────── INDIAMAN ARRIVAL ───────────
// Every ~180 days the Honourable Company sends an Indiaman to lift the
// godown's pepper and cinnamon back to London. Cumulative shipments live in
// gs.quotas[k].have. The Director writes by the same packet, with a tone
// modulated by how the Factor's reckoning compares to the expected pace.

const INDIAMAN_NAMES = [
  'the Astrea', 'the Marlborough', 'the Halifax', 'the Sutherland',
  'the Devonshire', 'the Egmont', 'the Houghton',
];
const INDIAMAN_INTERVAL = 180;
const QUARTERLY_INTERVAL = 90;

// Private trade allowance — per Indiaman call, the Factor may consign up to
// this many cwt of any commodity from his godown to his own account in
// London. The Indiaman returns 180 days later with the proceeds. London
// markups are far above Asian buy prices; the period reality is that this
// was how Company servants got rich, parallel to the Company quota.
const PRIVATE_TRADE_LIMIT = 8; // cwt per Indiaman
// Multiplier on the basePrice of each commodity, representing London market
// vs Asian source price. Tuned so a full 8-cwt private cargo of pepper
// returns ~£100, silver returns ~£50, opium ~£200.
const LONDON_MULT = {
  pepper: 3.5, cinnamon: 3.5, sandalwood: 2.8, opium: 4.0,
  silver: 2.0, calico: 2.6, saltpetre: 2.4, rice: 2.0, rum: 2.0,
  // The new commodities. Camphor and tobacco at solid markups; pearls
  // and diamonds eyewatering — fine goods are why a Factor goes home rich.
  camphor: 3.2, tobacco: 2.4, pearls: 4.5, diamonds: 5.0,
  // Sublocation commodities — teak for the brigantine yards back home,
  // indigo as a Dutch off-ledger trade good.
  teak: 2.6, indigo: 3.0,
  // Ambergris is the highest London markup of any commodity — the
  // perfumiers of Mayfair will pay anything. Gambier is the steady
  // tanning trade.
  ambergris: 6.0, gambier: 2.2,
};
const londonValue = (commodity, qty) => {
  const c = COMMODITIES[commodity];
  if (!c || !qty) return 0;
  const mult = LONDON_MULT[commodity] || 2.0;
  return Math.round(c.basePrice * mult * qty);
};
const INDIAMAN_TOTAL = 6;

function makeIndiamanLetter(s, peppLifted, cinnLifted, shipName) {
  const totalPepper = (s.quotas?.pepper?.have || 0) + peppLifted;
  const totalCinn   = (s.quotas?.cinnamon?.have || 0) + cinnLifted;
  const visits      = (s.indiaman?.visits || 0) + 1;
  const expectedPep = Math.round((400 * visits) / INDIAMAN_TOTAL);
  const expectedCin = Math.round((200 * visits) / INDIAMAN_TOTAL);
  const onTrack     = totalPepper >= expectedPep * 0.85 && totalCinn >= expectedCin * 0.85;
  const empty       = peppLifted === 0 && cinnLifted === 0;
  const ShipName    = shipName.replace('the ', '').replace(/^./, c => c.toUpperCase());

  let subject, body;
  if (empty) {
    subject = `Yr. Returns by ${ShipName}`;
    body = `Sir, — ${shipName} is returned this week with not one cwt of pepper nor of cinnamon out of yr. station. The Court will not pretend at patience much longer. We are told the climate is unkind; we are told the politics are intricate. We were told the same by the late Mr. Wilbraham, and his bones are now in the chapel-yard. Apply yourself, sir.\n\nYr. servants, the Court of Directors, in London, &c.`;
  } else if (!onTrack) {
    subject = `A Light Return by ${ShipName}`;
    body = `Sir, — ${shipName} is unloaded; ${peppLifted} cwt of pepper and ${cinnLifted} cwt of cinnamon are upon the wharf at Blackwall. We had hoped for more by this hand. The cumulative reckoning stands at ${totalPepper} of 400 pepper and ${totalCinn} of 200 cinnamon. We do not yet despair of yr. station, but the third year is closer than you suppose.\n\nYr. servants, the Court of Directors.`;
  } else {
    subject = `Yr. Returns by ${ShipName}`;
    body = `Sir, — ${shipName} is paid off, ${peppLifted} cwt of pepper and ${cinnLifted} cwt of cinnamon delivered into the House. The reckoning stands at ${totalPepper} of 400 pepper and ${totalCinn} of 200 cinnamon, which the Court is content to call adequate. The Bayan-Kor account is proving itself. Press on.\n\nYr. obedient servants, the Court of Directors.`;
  }
  return {
    id: 1000000 + s.day * 10 + visits,
    from: 'The Court of Directors, London',
    subject,
    body,
    responses: [
      { label: 'Acknowledge with formal compliance', seed: 'company satisfied, no surprises' },
      { label: 'Reply with a measured account of the difficulties', seed: 'company notes the case' },
      { label: 'Set the letter aside, return to the work', seed: 'no rep change' },
    ],
    read: false,
  };
}

// ─────────── TEAK CONCESSION ───────────
// The hook seeded by Wilbraham's papers and held open by the Vizier's clerk
// turns into a one-time formal letter from the palace. Player chooses what
// happens to the concession; the result modifies later ship-building costs.
// Each response carries a fixedOutcome so handleLetterResponse can apply
// it deterministically (no AI call) — the consequences are mechanical.

function makeTeakConcessionLetter(s) {
  return {
    id: 2000000 + s.day,
    from: 'The Rajah’s Vizier',
    subject: 'On the matter of the inland teak',
    body: `Sir, — His Highness the Rajah, considering yr. station and the late Mr Wilbraham’s papers, is mindful of the inland teak concession which has lately stood in suspense. The wood is of the kind they call ironwood in the tongue of the inland people, fit for the keel of a country ship and not subject to the worm.

The Hollander Mynheer ter Borch has these five years pressed for the concession at a tenant’s rent. We need not pretend to think well of him; he has been patient.

His Highness wd. hear yr. counsel in the matter. The grant lies in his gift, the price in yr. negotiation, the consequence — that wd. be felt — entirely yrs.

Yr. obedt. servant,
The Vizier`,
    responses: [
      {
        label: 'Take the concession for the Company, with a tribute',
        seed: 'tribute paid; concession secured for the Company',
        fixedOutcome: {
          prose: 'You attend the palace next Friday with a chest of forty rupees and a bolt of crimson calico. The Vizier accepts both with the smallest motion of his head, has the document drawn in three languages, and signs in his own hand. Hodge presents you a fair copy by the evening. The teak is yours — to fell, to season, to keel a ship under.',
          changes: {
            money: -120,
            reputation: { rajah: 5, dutch: -10 },
            flags: { teakConcession: 'self' },
            journal: 'The teak concession was granted to the Company for a tribute of forty rupees and a bolt of calico. Ter Borch will hear of it.',
            hook: 'ter Borch has been deprived of the teak; some answer is to be expected.',
          },
        },
      },
      {
        label: 'Sell the concession on to ter Borch, take the cash',
        seed: 'concession passes to the Dutch; cash now',
        fixedOutcome: {
          prose: 'Mynheer ter Borch is at yr. dock by Tuesday with a lacquered case and a draft on the Dutch factor at Eustace. Two hundred pounds, the formalities at the palace done by the Vizier himself for a small consideration. Hodge counts the silver three times.',
          changes: {
            money: 200,
            reputation: { dutch: 15, rajah: -5 },
            flags: { teakConcession: 'dutch' },
            journal: 'Sold the teak concession on to ter Borch for £200. The Vizier conducted the palace formalities. The Rajah has not commented.',
            hook: 'The teak concession is in Dutch hands; future ships built at home must pay for imported timber.',
          },
        },
      },
      {
        label: 'Decline to act in the matter for the present',
        seed: 'the matter rests',
        fixedOutcome: {
          prose: 'You return the Vizier’s clerk with a note professing further reflection. The clerk’s face does not move. The matter is, then, in suspense — though the Vizier is not a man who repeats an offer.',
          changes: {
            reputation: { rajah: -2 },
            flags: { teakConcession: 'declined' },
            journal: 'Declined to act on the teak concession for the present. The matter rests.',
          },
        },
      },
    ],
    read: false,
  };
}

// ─────────── QUARTERLY DIRECTOR NAGS ───────────
// Between Indiaman calls, the Court writes anyway. Templated tone based on
// cumulative progress: pleased / reminding / pointed / dismayed. Fires every
// QUARTERLY_INTERVAL days, offset to fall halfway between Indiaman visits
// (lastVisit + 90).

// Mr. Hardacre at Bencoolen — a fictitious rival Factor whose tonnage the
// Court sees and writes back about. Period-realistic: Company Factors at
// different stations were held up against each other in private letters
// from Leadenhall, and the comparison shaped careers. We deterministically
// advance Hardacre's totals roughly on track.
const HARDACRE = { name: 'Mr. Hardacre', station: 'Bencoolen' };
function hardacreReckoning(visits) {
  // Hardacre returns roughly on pace, slightly ahead — about 70/35 cwt
  // per call. Six calls would carry him to 420/210, just over quota.
  return {
    pepper:   Math.round(70 * visits + visits * 5),
    cinnamon: Math.round(35 * visits + visits * 2),
  };
}
// Returns a multi-rival snippet for the quarterly nag letter. Three
// sentences max — one per rival when each has something noteworthy
// to say, omitted otherwise. Hardacre uses tonnage comparison
// (existing pattern); ter Borch and Lowji use standing as a
// qualitative tone band.
function rivalsLines(s) {
  const lines = [];

  // Hardacre — existing 3-band pattern by tonnage.
  const visits = s.indiaman?.visits || 0;
  if (visits > 0) {
    const h = hardacreReckoning(visits);
    const ourPep = Math.floor(s.quotas?.pepper?.have   || 0);
    const ourCin = Math.floor(s.quotas?.cinnamon?.have || 0);
    const aheadPep = h.pepper > ourPep + 30;
    const aheadCin = h.cinnamon > ourCin + 15;
    const muchAhead = h.pepper > ourPep + 80 || h.cinnamon > ourCin + 50;
    if (muchAhead) {
      lines.push(`${HARDACRE.name} at ${HARDACRE.station} reckons ${h.pepper} cwt of pepper and ${h.cinnamon} cwt of cinnamon to date — a comparison we shall not press, but which sits visibly upon the Court's table.`);
    } else if (aheadPep || aheadCin) {
      lines.push(`${HARDACRE.name} at ${HARDACRE.station} stands at ${h.pepper}/${h.cinnamon} cwt; the comparison is not yet flattering to yr. station.`);
    } else if (ourPep >= h.pepper && ourCin >= h.cinnamon) {
      lines.push(`${HARDACRE.name} at ${HARDACRE.station} reckons ${h.pepper}/${h.cinnamon} cwt — yr. own returns, the Court is pleased to note, are no less.`);
    }
  }

  // ter Borch — qualitative band by standing.
  if (s.rivals?.terborch) {
    const st = s.rivals.terborch.standing;
    if (st >= 75)      lines.push(`Mynheer ter Borch at Eustace continues to gain ground in the High Government's regard.`);
    else if (st <= 25) lines.push(`Word from Amsterdam: Mynheer ter Borch's hand at Eustace is tested.`);
  }

  // Lowji — qualitative band by standing.
  if (s.rivals?.lowji) {
    const st = s.rivals.lowji.standing;
    if (st >= 75)      lines.push(`The Bombay accounts speak of Mr. Lowji Nusserwanji's tonnage in terms a Director may not lightly dismiss.`);
    else if (st <= 25) lines.push(`The Bombay houses report Mr. Lowji Nusserwanji to be in the unkind weather of his year.`);
  }

  return lines.length === 0 ? '' : ' ' + lines.join(' ');
}

// Backwards-compatibility shim — keeps the old call sites in
// makeQuarterlyNagLetter working while the next task migrates them.
function rivalLine(s) { return rivalsLines(s); }

function makeQuarterlyNagLetter(s) {
  const visits      = s.indiaman?.visits || 0;
  const totalPepper = (s.quotas?.pepper?.have   || 0);
  const totalCinn   = (s.quotas?.cinnamon?.have || 0);
  const lodgedPep   = Math.floor(s.outpost?.warehouse?.pepper   || 0);
  const lodgedCinn  = Math.floor(s.outpost?.warehouse?.cinnamon || 0);
  const expectedPep = Math.round((400 * visits) / INDIAMAN_TOTAL);
  const expectedCin = Math.round((200 * visits) / INDIAMAN_TOTAL);
  const onTrack     = (totalPepper + lodgedPep) >= expectedPep * 0.85
                   && (totalCinn   + lodgedCinn) >= expectedCin * 0.85;
  const finalStretch = (s.daysRemaining || 0) < 365;
  const nothingYet   = visits === 0 && totalPepper === 0 && totalCinn === 0
                     && lodgedPep === 0 && lodgedCinn === 0;
  const reckoning    = `${totalPepper} of 400 pepper and ${totalCinn} of 200 cinnamon shipped, with ${lodgedPep} and ${lodgedCinn}cwt respectively in yr. godown awaiting the next call.`;
  const rival = rivalLine(s);
  const dryden = drydenQuarterlyAddendum(s);

  // Pick base band — same logic as before.
  let band;
  if (nothingYet)                    band = 'first';
  else if (finalStretch && !onTrack) band = 'pointed';
  else if (onTrack)                  band = 'progress';
  else                               band = 'reminder';

  // Apply rivalPressure shift to the middle bands only. nothingYet and
  // finalStretch short-circuits remain untouched (they reflect player-
  // observable facts that rivalry shouldn't override).
  const pressure = s.rivalPressure ?? 50;
  if      (band === 'progress' && pressure > 70) band = 'reminder';  // pleased → reminding
  else if (band === 'progress' && pressure < 30) band = 'progress';  // already softest mid-band
  else if (band === 'reminder' && pressure > 70) band = 'pointed';   // reminding → pointed
  else if (band === 'reminder' && pressure < 30) band = 'progress';  // reminding → pleased

  let subject, body;
  if (band === 'first') {
    subject = 'A First Quarterly Note';
    body = `Sir, — We open yr. file at the Court for the present charter. The first Indiaman is despatched in due course; we shall expect a return at her holds. We pray you have laid the ground.\n\nWe are mindful of the climate, the politics, and the price of plank. We are mindful also that the late Mr. Wilbraham held the post for two years on similar excuses.\n\nYr. obedt. servants, the Court of Directors.${dryden}`;
  } else if (band === 'pointed') {
    subject = 'A Pointed Word';
    body = `Sir, — A reckoning at this hand: ${reckoning}${rival} The third year is upon us, and the figures are not what we are owed. The Court has the names of two replacements before it. We trust you take our meaning.\n\nYr. servants, the Court of Directors.${dryden}`;
  } else if (band === 'progress') {
    subject = 'Yr. Progress Noted';
    body = `Sir, — Returns reckon ${reckoning}${rival} The Court is content with the present pace. Press on.\n\nYr. obedt. servants, the Court of Directors.${dryden}`;
  } else {
    subject = 'A Quarterly Reminder';
    body = `Sir, — We have to remind you that the present hand finds the books at ${reckoning}${rival} The next Indiaman comes round in due course, and we shall watch what she brings.\n\nYr. servants, the Court of Directors.${dryden}`;
  }
  return {
    id: 3000000 + s.day,
    from: 'The Court of Directors, London',
    subject,
    body,
    responses: [
      { label: 'Acknowledge with formal compliance', seed: 'no surprises; perhaps a small standing nudge' },
      { label: 'Reply with a measured account of difficulties', seed: 'company notes the case' },
      { label: 'Set the letter aside, return to the work', seed: 'no rep change' },
    ],
    read: false,
  };
}

// ─────────── DUTCH TRADE PASS ───────────
// Period mechanism: VOC factors at Asian outposts privately granted "passes
// of free trade" to selected English Company servants in exchange for
// favours, discretion, or a tribute. Held quietly in a strongbox; halved
// the port duty in practice. The flag gs.flags.dutchTradePass enables the
// reduction in portTaxRate. Granted via this letter from a junior Dutch
// Factor — fired once after the Factor has put into Port St. Eustace and
// established at least minimal standing with the Dutch.

function makeDutchPassLetter(s) {
  return {
    id: 4000000 + s.day,
    from: 'Mynheer Hendrik Boom, Junior Factor at Port St. Eustace',
    subject: 'A writ of free trade',
    body: `Sir, — I write upon the matter of yr. recent calls at this port. The Senior Factor has noted yr. business and finds it neither offensive nor of present consequence. There is, however, a writ of free trade which yr. countrymen of the Honourable Company sometimes obtain from this House at a personal arrangement, by which the duty falls to half what is otherwise levied.

The arrangement is not transacted in the open ledger.

I shd. be pleased to discuss the matter when next you put in. The terms admit of three forms: a sum laid at my discretion; a small office discreetly performed for the Dutch interest; or yr. silence and a continuance of the present rate.

I am, sir, yr. obedt. servant in commercial matters,
Hendrik Boom`,
    responses: [
      {
        label: 'Pay the tribute and take the pass',
        seed: 'cash bought; pass granted',
        fixedOutcome: {
          prose: 'A draft for two hundred and fifty pounds is laid in Boom’s hand at his counting-room behind the Dutch quay. He produces a folded writ on stiff paper, his name and a seal at the foot, and slides it across without further word. The duty falls to half from this hour.',
          changes: {
            money: -250,
            reputation: { dutch: 3 },
            flags: { dutchTradePass: true },
            journal: 'Paid £250 to Mynheer Boom for a writ of free trade at Port St. Eustace. The duty is halved.',
          },
        },
      },
      {
        label: 'Take the packet, ask no questions',
        seed: 'discreet errand for the Dutch; pass granted; pirate cost',
        fixedOutcome: {
          prose: 'Boom hands over a small sealed packet, bound in Dutch wax, addressed to no name. It is to find a particular hand on yr. next leg east. He produces the writ in the same motion. You do not ask whose hand; the prudent do not ask.',
          changes: {
            reputation: { dutch: 3, pirates: -5 },
            flags: { dutchTradePass: true, carryingDutchPacket: true },
            journal: 'Took a sealed packet from Mynheer Boom for delivery on the next eastern leg. The writ of free trade is in the strongbox.',
            hook: 'The packet for Boom — its recipient and its consequence yet to be felt.',
          },
        },
      },
      {
        label: 'Decline; the price is too dear',
        seed: 'a refusal noted',
        fixedOutcome: {
          prose: 'You return Boom’s clerk with a courteous note professing satisfaction with the present arrangement. The clerk\'s expression does not move. The matter is closed; the duty stands at the published rate.',
          changes: {
            reputation: { dutch: -1 },
            flags: { dutchPassDeclined: true },
            journal: 'Declined Mynheer Boom\'s offer of a writ of free trade. The Dutch duty stands at the open rate.',
          },
        },
      },
    ],
    read: false,
  };
}

// ─────────── REVEREND PYKE: A MISSION SCHOOL ───────────
// Parallels the Vizier's teak letter and Boom's Dutch pass — a third
// faction (Mission) gets a one-off scripted hook with three deterministic
// responses. The subscription lays the ground for a recurring child of the
// school as a future minor character. Pyke's tone: pious Anglican, dry,
// not unkind, capable of small reproach.

function makePykeSchoolLetter(s) {
  return {
    id: 6000000 + s.day,
    from: 'Reverend Pyke of the Mission at Bayan-Kor',
    subject: 'A subscription for a small school',
    body: `Sir, — The chapel stands, by yr. agency and the Rajah's permission, and I am sensible of the obligation. There is now in the village a number of children for whom letters and the catechism are alike out of reach. I propose to set up a small school in the south wing, with one of the Madras boys at fifty pounds the year as master, and the slates and primers found from London at no further charge to yrself.

I shd. be obliged for yr. notice on the matter. The school will be of the size, dignity, and persistence yr. subscription will allow. I am, sir, &c.,

J. Pyke`,
    responses: [
      {
        label: 'Subscribe generously — let it be a proper school',
        seed: 'large subscription; lasting credit with the Mission',
        fixedOutcome: {
          prose: 'You write a draft for one hundred pounds upon yr. London agent and add a note that primers are to be sent by the next outbound. The Reverend\'s reply is brief and not warm, but it is the warmth he is capable of. Within the month a Madras boy named Cornelius is engaged at the chapel; the village brings six children the first week, twelve the second.',
          changes: {
            money: -100,
            reputation: { mission: 10, crown: 3 },
            flags: { subscribedToSchool: 'generous', pykeLetterSent: true },
            journal: 'Subscribed £100 to the Reverend\'s school at the Mission. A Madras boy named Cornelius engaged as master. Twelve children by the second week.',
            hook: 'The Mission school — a Madras boy, twelve children at the start. Some among them may yet prove of consequence to the household.',
          },
        },
      },
      {
        label: 'A modest subscription, in the present circumstances',
        seed: 'small subscription; warm enough but no enthusiasm',
        fixedOutcome: {
          prose: 'You write a draft for thirty pounds with apologies framed in the language of trade. The Reverend\'s receipt is courteous and characteristically brief. The school opens in the south wing at half the proposed scale; six children attend. Pyke makes no comment beyond the formal acknowledgment.',
          changes: {
            money: -30,
            reputation: { mission: 3 },
            flags: { subscribedToSchool: 'modest', pykeLetterSent: true },
            journal: 'Subscribed £30 to the Reverend\'s school. He noted it without comment.',
          },
        },
      },
      {
        label: 'Decline; the strongbox cannot bear it at present',
        seed: 'a refusal, civilly framed',
        fixedOutcome: {
          prose: 'You return the Reverend\'s clerk with a courteous declination, citing the present pressure of trade and a hope that the matter may be revisited in better times. The clerk inclines his head. The Reverend has, since Wilbraham\'s death, learned not to be surprised at much.',
          changes: {
            reputation: { mission: -3 },
            flags: { pykeLetterSent: true, pykeSchoolDeclined: true },
            journal: 'Declined the Reverend\'s subscription proposal for a Mission school.',
          },
        },
      },
    ],
    read: false,
  };
}

// ─────────── THE BROTHERHOOD COMPACT ───────────
// The Brotherhood faction one-off, parallels Vizier/Boom/Pyke. Capt. Gerrit
// Maas — a Bugis-Dutch renegado, formerly VOC — writes after the Factor has
// put into the Pelican's Nest with at least minimal standing. He proposes
// a private compact: a small annual tribute, in return for which the
// Brotherhood will not molest the Factor's ships in the strait. Mechanical
// effect: gs.flags.brotherhoodCompact halves the voyage encounter chance
// (60% → 40%) — the Brotherhood's word holds.

function makeBrotherhoodLetter(s) {
  return {
    id: 7000000 + s.day,
    from: 'Capt. Gerrit Maas, of the Brotherhood',
    subject: 'A private arrangement, in plain words',
    body: `Sir, — I write upon paper that has not crossed the Dutch House at Eustace and shall not. We have remarked yr. business at the Nest and find it neither timid nor stupid; the latter being the more useful in a Factor.

There is an arrangement we offer to those whose dealings have been straight. A sum laid down once, by yr. discretion, and yr. ships are remarked but not molested in this strait or the next. The arrangement is not in writing beyond this letter, which I shall ask you to burn after reading. The names of the captains who took it in earlier years prosper.

Yr. obedt. servant in the trade we both keep,
Gerrit Maas`,
    responses: [
      {
        label: 'Accept the compact; pay the tribute',
        seed: 'compact in force; safe passage; standing shifts felt by all parties',
        fixedOutcome: {
          prose: 'You disburse two hundred pounds to a Bugis pilot at the head of the strait, in coin and a bolt of fine calico, and the matter is done. Yr. master tells you within the week that a Bugis prahu lay to windward for two hours and made off without closing — the first time of many. The compact holds.',
          changes: {
            money: -200,
            reputation: { pirates: 20, crown: -10, dutch: -5 },
            flags: { brotherhoodCompact: true, brotherhoodLetterSent: true },
            journal: 'Paid £200 to enter into Capt. Maas\'s compact. The Brotherhood will not molest yr. ships in the strait. The Crown is not to know.',
            hook: 'The Brotherhood compact — its protection is real, its discovery would be grave.',
          },
        },
      },
      {
        label: 'Decline, but courteously',
        seed: 'no compact; small standing nudge with the Brotherhood',
        fixedOutcome: {
          prose: 'You return Maas\'s clerk with a brief note professing satisfaction with the present state of affairs. The clerk takes it without comment. The matter is closed; yr. ships continue to keep their watch in the strait.',
          changes: {
            reputation: { pirates: -3 },
            flags: { brotherhoodLetterSent: true, brotherhoodDeclined: true },
            journal: 'Declined Capt. Maas\'s compact, civilly. The strait remains the strait it was.',
          },
        },
      },
      {
        label: 'Refuse plainly; the Director would have my skin',
        seed: 'open refusal; cost with the Brotherhood; small Crown gain',
        fixedOutcome: {
          prose: 'You write the refusal in plain terms and add a sentence on the obligations of yr. office. Maas does not reply. Within the month, a small English brig out of Madras is taken in the strait and her cargo never accounted for — perhaps related, perhaps not. The strait is a colder place from this hour.',
          changes: {
            reputation: { pirates: -10, crown: 5 },
            flags: { brotherhoodLetterSent: true, brotherhoodRefused: true },
            journal: 'Refused Capt. Maas\'s compact in plain terms. The strait is, by the next news of it, a meaner one.',
            hook: 'The Brotherhood remembers a refusal. Yr. ships in the strait should keep a sharper watch.',
          },
        },
      },
    ],
    read: false,
  };
}

// ─────────── THE CROWN: HMS ADVENTURE ───────────
// Captain Whitcombe of the Royal Navy calls at Bayan-Kor on a patrol of
// the strait. The Crown faction's one-off — period-plausible, since RN
// frigates did call at Company stations for refits and intelligence in
// the 1720s. He asks the Factor for one of three things.

function makeCrownLetter(s) {
  return {
    id: 8000000 + s.day,
    from: 'Capt. Edward Whitcombe, HMS Adventure',
    subject: 'Compliments from the Royal Navy',
    body: `Sir, — HMS Adventure is putting into Bayan-Kor next week for a fortnight\'s refit. I have the honour to write in advance with a request, that you may consider in due time.

The Adventure is here on a patrol of the strait under standing orders to remark Brotherhood movements and to extend the King\'s peace where the Company\'s flag does not. There are particulars on which a Factor of yr. station might lend assistance: intelligence of the strait, a small advance against the Bombay credit, or such other service as occurs to you.

The Crown is not without memory in these matters. I am, sir, yr. obedt. servant,
Edward Whitcombe, Captain.`,
    responses: [
      {
        label: 'Pass on what I know of the Brotherhood',
        seed: 'intelligence given; Crown gains; pirates lose',
        fixedOutcome: {
          prose: 'You compose a careful letter naming what you have heard at the Pelican\'s Nest and what was said in the Vizier\'s clerk\'s presence at Bayan-Kor. Whitcombe receives it with proper thanks and a token of cinnamon for yr. trouble. The Adventure sails three days later. The Brotherhood\'s ear in the strait is not nothing; somewhere yr. words are remarked.',
          changes: {
            reputation: { crown: 15, pirates: -10, company: 3 },
            flags: { crownLetterSent: true, gaveCrownIntelligence: true },
            journal: 'Gave Capt. Whitcombe a written account of the Brotherhood\'s movements as I have heard them. The Crown notes it.',
            hook: 'Yr. intelligence to the Crown — the Brotherhood will hear of it in time.',
          },
        },
      },
      {
        label: 'Advance the £100 against Bombay',
        seed: 'cash given; Crown credit; modest standing gain',
        fixedOutcome: {
          prose: 'You hand Whitcombe a draft for one hundred pounds, drawn upon yr. London agent and countersigned for collection at Bombay. He gives in turn a Crown receipt that will reach Bombay before the Adventure does. He is grateful in the manner of a captain who has been short of stores for six weeks.',
          changes: {
            money: -100,
            reputation: { crown: 8 },
            flags: { crownLetterSent: true, advancedCrownCredit: true },
            journal: 'Advanced £100 to Capt. Whitcombe of HMS Adventure against the Bombay credit. The Crown\'s receipt is in the strongbox.',
            hook: 'A Crown receipt for £100 stands at Bombay, redeemable when the books admit it.',
          },
        },
      },
      {
        label: 'Plead present trade and decline',
        seed: 'no service; Crown is not pleased',
        fixedOutcome: {
          prose: 'You write a courteous declination citing the present pressure of trade and yr. obligations to the Court. Whitcombe receives it without remark; the Adventure sails on schedule. He is not the kind of man who returns to a refusal, but he is also not the kind of man who forgets one.',
          changes: {
            reputation: { crown: -5 },
            flags: { crownLetterSent: true, declinedCrownService: true },
            journal: 'Declined Capt. Whitcombe\'s requests, civilly. The Crown\'s memory is long.',
          },
        },
      },
    ],
    read: false,
  };
}

// ─────────── THE COMPANY'S OTHER VOICE: MR. DRYDEN ───────────
// The Honourable Company is not monolithic. The Court of Directors is split,
// in private, between a senior Conservative bench (the existing Director
// voice — quotas met, paperwork in order, deference to Madras protocols)
// and a Speculative bench led by one Mr. Dryden, who favours private trade,
// country shipping, and ambitious returns even at the price of an irregularity.
// Once around day 150 the Factor receives Dryden's first letter — a personal
// note, not on Company paper. The response sets gs.flags.companyFaction =
// 'speculative' | 'conservative' | 'declined', which then influences the
// tone of subsequent quarterly nags and the final charter-end letter.

function makeDrydenLetter(s) {
  return {
    id: 9400000 + s.day,
    from: 'Mr. Edmund Dryden, of the Court of Directors',
    subject: 'A note in private',
    body: `Sir, — This is not on Company paper, nor on the formal record. I am one of those Directors who concern themselves more with what may be made than with what has been weighed; the Court is, in private, divided as such matters always are.

Yr. station has been remarked upon for some time. There are at this hand two views of yr. work: the senior bench's, which sees what is in the books at Leadenhall and writes in proper terms; and mine, which is concerned with what an enterprising Factor in yr. waters might do beyond the proper terms. Private trade, country trade, the small contracts that do not crowd the Indiaman and yet pay better than her — these are matters of which I should be glad to hear.

If you choose to write to me upon them, do so by my own hand here. I shall send acknowledgements through the same channel and not by yr. file at the Court.

Yr. obedt. servant in private,
Edmund Dryden`,
    responses: [
      {
        label: 'Reply formally; thank him, write nothing private',
        seed: 'standing with the conservative bench held; speculative declines but no insult',
        fixedOutcome: {
          prose: 'You write a brief note acknowledging the kindness and pleading the press of yr. office. The reply is not unfriendly; it does not invite a sequel. The senior bench remains yr. only correspondent at the Court.',
          changes: {
            reputation: { company: 1 },
            flags: { drydenLetterSent: true, companyFaction: 'conservative' },
            journal: 'Replied formally to Mr. Dryden of the Speculative Bench; declined a private correspondence. The conservative bench is yr. only voice at the Court.',
          },
        },
      },
      {
        label: 'Write back at length about yr. private enterprise',
        seed: 'speculative alignment; backer found; risk of conservative cooling',
        fixedOutcome: {
          prose: 'You sit four hours at yr. desk composing a careful letter — what the godown has held, what the Indiaman has lifted on yr. private account, what country trade you have laid yr. hand to. Hodge copies it twice. Dryden\'s answer comes within the year: a Director who reads what you write and answers in his own hand. The senior bench\'s tone, by report, is fractionally cooler thereafter.',
          changes: {
            reputation: { company: 3 },
            flags: { drydenLetterSent: true, companyFaction: 'speculative' },
            journal: 'Wrote at length to Mr. Dryden of the Speculative Bench. He answers in his own hand. The conservative bench has noticed the absence of Madras-format paper.',
            hook: 'Yr. private file with Mr. Dryden grows. The senior bench is, on report, fractionally cooler.',
          },
        },
      },
      {
        label: 'Decline the correspondence; this is not how a Factor works',
        seed: 'conservative gain; speculative offended',
        fixedOutcome: {
          prose: 'You write a curt note refusing the private channel and citing the proprieties of yr. office. Dryden does not reply; he does not, however, forget. Yr. file at the Court is, by all accounts, in proper Madras format and growing thicker.',
          changes: {
            reputation: { company: 4 },
            flags: { drydenLetterSent: true, companyFaction: 'declined' },
            journal: 'Refused Mr. Dryden\'s private correspondence on principle. The senior bench knows it; the speculative bench will remember it.',
          },
        },
      },
    ],
    read: false,
  };
}

// Returns a short addendum paragraph when the speculative faction is held,
// to be appended to the existing quarterly nag body. Empty string otherwise.
function drydenQuarterlyAddendum(s) {
  if (s.flags?.companyFaction !== 'speculative') return '';
  return `\n\n[Folded into the same packet, in another hand:]\nMr. Dryden remarks that yr. private returns of late have been read with interest. He asks if you have considered the diamond trade at the Madras yard, and would thank you for word on the matter when next a packet permits. — E.D.`;
}

// Lord Mountfair's notice — the speculative faction's payoff event. Fires
// once when the Factor's cumulative private trade returns exceed £500 AND
// companyFaction is 'speculative'. A London peer, a Director by family
// alliance, has noticed and writes to introduce himself by way of Dryden.
// Plants a permanent flag.mountfairPatron = true that future events
// (charter end, succession, scripted scenes) can read.
function makeMountfairLetter(s) {
  return {
    id: 9700000 + s.day,
    from: 'Lord Mountfair, by Mr. Dryden\'s introduction',
    subject: 'A private acquaintance proposed',
    body: `Sir, — Mr. Dryden has laid yr. returns and a digest of yr. circumstances at Bayan-Kor before me, with such recommendation as I should have asked of any man whose figures I was to read.

I am, by my mother's side, a Director of the Court; by my father's, the holder of a small interest in the country trade and a larger one in the West Indies. The two careers are not always at one. Yr. work, as Mr. Dryden has rendered it, is the kind that may pass between them with credit. I should be glad to know you, sir, when next yr. business permits a packet, and gladder still to see you to dinner if ever London receives you.

If a small introduction at this distance would be useful — a letter of credit at Bombay, a name to be dropped at the Court, a particular merchant in Calicut who will receive you on my acquaintance — write to Mr. Dryden, who will know how to put the request to me.

Yr. obliged servant in private,
Mountfair`,
    responses: [
      {
        label: 'Reply with thanks; ask for the Bombay credit',
        seed: 'a credit at Bombay; small Crown nudge by association',
        fixedOutcome: {
          prose: 'You write a careful note thanking his Lordship and asking, with proper modesty, for a letter of credit on the Bombay account. The letter, when it comes by the next packet, is for two hundred pounds redeemable at the Bombay establishment by yr. own application.',
          changes: {
            money: 200,
            reputation: { company: 4, crown: 3 },
            flags: { mountfairPatron: true, mountfairResponse: 'credit' },
            journal: 'Replied to Lord Mountfair with thanks and a request for credit at Bombay. £200 letter of credit received.',
          },
        },
      },
      {
        label: 'Reply with thanks; ask for an introduction at the Court',
        seed: 'name at the Court; standing nudge',
        fixedOutcome: {
          prose: 'You write asking, in the proper form, for yr. name to be brought before such of his Lordship\'s acquaintance at the Court as he should think fit. The letter that follows confirms a careful introduction has been made; the senior bench now knows yr. name without yr. having to write it.',
          changes: {
            reputation: { company: 8 },
            flags: { mountfairPatron: true, mountfairResponse: 'introduction' },
            journal: 'Replied to Lord Mountfair asking for an introduction at the Court. The senior bench now knows yr. name without yr. having to write it.',
          },
        },
      },
      {
        label: 'Reply with civilities only; decline the patronage',
        seed: 'the patronage refused; standing held; quiet self-respect',
        fixedOutcome: {
          prose: 'You reply at proper length, with thanks and the customary professions of yr. station, but ask for nothing. His Lordship answers in three lines; the matter is in the books, and you are owed nothing by yr. own preference.',
          changes: {
            reputation: { company: 2 },
            flags: { mountfairPatron: 'declined', mountfairResponse: 'declined' },
            journal: 'Replied to Lord Mountfair with civilities only. The patronage is in the books but unclaimed.',
          },
        },
      },
    ],
    read: false,
  };
}

// Real cumulative private trade proceeds — incremented each Indiaman
// payout. Used by the Mountfair gate. Resets on charter transitions
// (succession or renewal) so each Factor earns the patronage on his
// own returns.
function privateTradeReturned(s) {
  return s.privateTradeProceeds || 0;
}

// ─────────── THE HODGE CRISIS ───────────
// Once per charter, around day 200+, Hodge's drinking finally tips into a
// real crisis — he's gone missing for three days, found at the back of the
// godown, the ledger has not been kept. The player must choose what to do
// with him. The four responses each change the household concretely:
//
//   - Send him to the Reverend for a course of temperance: costs £40,
//     Hodge's sobriety jumps and stays high for the rest of the charter
//     (a permanent npcs.hodge.reformed flag); his loyalty rises.
//   - Send him home to Bristol on the next Indiaman: he is replaced by
//     Mr. Tyler, a sober but mediocre junior clerk. Hodge is gone.
//   - Hire a junior to share the work: £60 up front + £2/month wage; a
//     new acquaintance, "Mr. Coombe", arrives. Hodge stays as he is.
//     Adds a second clerk in the household for the rest of the charter.
//   - Accept it; the man has earned that much: Hodge stays, no cost,
//     but his sobriety floor is lowered (he will hit 0 sometimes).

function makeHodgeCrisisLetter(s) {
  return {
    id: 9000000 + s.day,
    from: 'Sgt. Dass, on yr. behalf',
    subject: 'Concerning Mr. Hodge',
    body: `Sir, — I write at the urging of the household, with apologies for the liberty.

Mr. Hodge has been three days from his desk. We found him this morning behind the cinnamon bales at the back of the godown, in such a condition as I shall not describe, with the ledger unkept since Monday and a Bugis trader at the gate who has gone away unsatisfied. The Reverend has been to see him; he weeps and is sorry, as he has been before.

I do not pretend to advise yr. office, but the matter cannot stand as it has stood. There are four ways forward that the Reverend and I have between us considered, set out below.

Yr. obedt. servant,
Dass`,
    responses: [
      {
        label: 'Send him to the Reverend for a course of temperance',
        seed: 'reformed; sobriety holds; cost paid',
        fixedOutcome: {
          prose: 'You commit Hodge to the Reverend Pyke for the season. Forty pounds is paid out — for the Mission’s trouble and the man’s board — and Hodge is closed up with the catechist and the curate for the better part of three months. He emerges in October a thinner man, his hand steady, his ledger again immaculate. He weeps once at the door of the chapel and does not weep again.',
          changes: {
            money: -40,
            reputation: { mission: 5 },
            flags: { hodgeCrisis: 'reformed' },
            journal: 'Sent Mr. Hodge to the Reverend for a course of temperance. £40 disbursed. He is, by all accounts, a different man from the one we found.',
            hook: 'Hodge’s sobriety is the Reverend’s achievement — and the Reverend will remember it.',
          },
        },
      },
      {
        label: 'Send him home to Bristol on the next Indiaman',
        seed: 'hodge replaced by mr. tyler; the household is changed',
        fixedOutcome: {
          prose: 'Hodge is put aboard the next Indiaman with two trunks and a letter to his wife. He shakes Dass’s hand at the dock and does not look back. Six weeks later Mr. Tyler arrives from Madras — a sober, dutiful, plodding clerk of perhaps two-and-twenty, with a hand that is legible if not quick.',
          changes: {
            flags: { hodgeCrisis: 'sent_home' },
            journal: 'Sent Mr. Hodge home to Bristol. Mr. Tyler of the Madras establishment will replace him.',
            hook: 'Mr. Tyler is sober and earnest, but Hodge knew the weights and measures of every Bugis prahu in the strait. We shall miss that knowledge.',
            newAcquaintances: [
              { name: 'Mr. Tyler', role: 'Junior Clerk', location: 'Bayan-Kor', notes: 'Replaced Mr. Hodge on the Madras establishment\'s recommendation. Sober, dutiful, slow.' },
            ],
          },
        },
      },
      {
        label: 'Hire a junior clerk to share Mr. Hodge\'s work',
        seed: 'mr. coombe arrives; hodge stays; the household has a second clerk',
        fixedOutcome: {
          prose: 'You write to Madras for a junior; the answer comes by the next packet, in the form of one Mr. Coombe — twenty-three years old, half a Cornishman, a hand fair as Wilbraham’s ever was. £60 is paid for his passage and the first quarter of his wage; thereafter £2 a month is added to the household account. Hodge receives him with damp gratitude. The ledger is again kept.',
          changes: {
            money: -60,
            flags: { hodgeCrisis: 'junior_hired' },
            journal: 'Engaged Mr. Coombe of Madras as a junior clerk. £60 paid; £2/month thereafter. Hodge remains as he is.',
            newAcquaintances: [
              { name: 'Mr. Coombe', role: 'Junior Clerk', location: 'Bayan-Kor', notes: 'Hired to share Mr. Hodge\'s work. Twenty-three, Cornish, a fair hand.' },
            ],
          },
        },
      },
      {
        label: 'Accept it; the man has earned that much',
        seed: 'no change; hodge stays as he is, with worse days ahead',
        fixedOutcome: {
          prose: 'You let the matter stand. Hodge is given a week’s rest and returned to his desk; he is grateful and ashamed in equal measure. Dass takes the cinnamon ledger from him for a fortnight to give him room to recover. The household runs on as before — which is to say, as well as Hodge can manage on his good days, and not at all on his bad.',
          changes: {
            flags: { hodgeCrisis: 'accepted' },
            journal: 'Decided to let Mr. Hodge be. He is grateful. We shall see.',
          },
        },
      },
    ],
    read: false,
  };
}

// ─────────── THE DASS RECALL ───────────
// Once per charter, around day 240+, Sgt. Dass receives a recall to the
// Madras establishment — a routine reposting from his old colonel, who
// wants him back at the parade ground. Three resolutions:

function makeDassRecallLetter(s) {
  return {
    id: 9100000 + s.day,
    from: 'Sgt. Dass, formally',
    subject: 'A letter from Madras',
    body: `Sir, — A letter has come from Col. Whitelaw at Fort St. George, recalling me to the establishment for the next field season. I am to report at Madras within the year.

I do not say I wish to go. The household at Bayan-Kor is mine in such a way as the parade ground at Madras was never; and the Bugis trader who watches the godown by night will not watch for a green sepoy as he watches for me. I write upon the matter only because the Court are owed an answer, and the answer must come from yr. office.

There is, I am told, a way of buying the recall — fifty pounds, paid to the establishment account at Madras, secures my discharge for the duration of yr. charter. The Vizier mentioned a third path, which I shall write below in his words and not my own.

Yr. obedt. servant,
Dass`,
    responses: [
      {
        label: 'Pay the £50; I will not lose Dass',
        seed: 'dass kept; standing nudge with crown for the discreet handling',
        fixedOutcome: {
          prose: 'You write Madras a draft for fifty pounds and a note in the careful language of an Englishman who has the Court behind him. Col. Whitelaw answers in three lines: the matter is settled, Dass is yrs. for the duration. Dass takes the news at supper, says nothing, and the next day cleans his musket twice.',
          changes: {
            money: -50,
            reputation: { crown: 2 },
            flags: { dassRecall: 'paid' },
            journal: 'Paid £50 to Madras to keep Sgt. Dass for the rest of the charter. The household is whole.',
          },
        },
      },
      {
        label: 'Let him go; the establishment must have its men',
        seed: 'dass leaves; a green sepoy replaces him; standing modest with crown for compliance',
        fixedOutcome: {
          prose: 'Dass is given his orders and his discharge from yr. household. He embarks on the next Indiaman for Madras with a small box, a worn musket, and the writ in his sleeve. Six weeks later Lance Naik Anandan arrives — twenty, recently of the Madras lines, eager and untested. The household feels lighter and the strait feels darker.',
          changes: {
            reputation: { crown: 4 },
            flags: { dassRecall: 'released' },
            journal: 'Released Sgt. Dass to the Madras establishment. Lance Naik Anandan replaces him.',
            hook: 'A green sepoy on the night-watch — the Bugis prahu will test him before the season is out.',
            newAcquaintances: [
              { name: 'Lance Naik Anandan', role: 'Sepoy', location: 'Bayan-Kor', notes: 'Replaced Sgt. Dass on the Madras establishment\'s recall. Twenty years old, eager, untested.' },
            ],
          },
        },
      },
      {
        label: 'Take the Vizier’s path: have him commissioned to the Rajah’s service',
        seed: 'dass commissioned in rajah service; rajah +12, crown -8; complex',
        fixedOutcome: {
          prose: 'You attend the palace. The Vizier writes the commission himself — a captaincy of twelve men in the Rajah’s personal guard, with permission for Dass to remain at Bayan-Kor as the household’s sepoy in fact if not in form. The Crown’s recall lapses. Col. Whitelaw is, by all accounts, displeased.',
          changes: {
            reputation: { rajah: 12, crown: -8 },
            flags: { dassRecall: 'commissioned' },
            journal: 'Sgt. Dass commissioned by the Rajah. The Crown recall lapses; Madras grumbles; the Vizier has done a favour the household will be expected to remember.',
            hook: 'The Vizier did not commission Dass for nothing. The favour will be called.',
          },
        },
      },
    ],
    read: false,
  };
}

// ─────────── THE VIZIER'S MARRIAGE GAMBIT ───────────
// Once per charter, around day 280+, the Vizier proposes a marriage alliance
// for his clerk. The choice is purely political; mechanical effects fall on
// faction standings and a hook for future events.

function makeVizierMarriageLetter(s) {
  return {
    id: 9200000 + s.day,
    from: 'The Rajah’s Vizier',
    subject: 'A small matter of family',
    body: `Sir, — There is a small matter to which I beg yr. attention.

My clerk, Subhan, has come of an age to be married. There is a daughter of a Bugis trading family who would suit, and the family would rejoice in an Englishman’s witness at the contract. The dowry is between the families. The witness is between us.

The Hollander ter Borch has offered to stand for the family — a match he has long preferred, for reasons of his own. I prefer that you stand. The Rajah, as you may suppose, has expressed no preference, which is to say he has expressed his preference clearly.

This is not a request to which a refusal is offensive, only — perhaps — disappointing.

Yr. obedt. servant,
The Vizier`,
    responses: [
      {
        label: 'Stand for the family at the contract',
        seed: 'vizier favour; rajah +; dutch -; hook of obligation later',
        fixedOutcome: {
          prose: 'You attend the signing in the courtyard of the Bugis trader’s house — a quiet ceremony of cups, paper, and the Vizier’s small personal stamp. Subhan is grateful in the manner of the young; the Bugis father is grateful in the manner of his trade. The Hollander, who came as the second witness, leaves before the cups are emptied.',
          changes: {
            reputation: { rajah: 8, dutch: -6 },
            flags: { vizierMarriage: 'stood' },
            journal: 'Stood as Englishman’s witness at Subhan’s marriage. Ter Borch left early. The Vizier has noted the favour.',
            hook: 'The Vizier owes you a favour by the courtesies of the contract. He is not the man who forgets such things.',
          },
        },
      },
      {
        label: 'Decline politely; plead the press of trade',
        seed: 'rajah small loss; dutch small gain (terborch will stand); no hook',
        fixedOutcome: {
          prose: 'You decline by note, with thanks for the honour. The Vizier accepts the refusal with the smallest motion of his head. Ter Borch stands at the contract instead, and is seen at the palace twice the following week.',
          changes: {
            reputation: { rajah: -3, dutch: 3 },
            flags: { vizierMarriage: 'declined' },
            journal: 'Declined the Vizier’s invitation to stand at Subhan’s marriage. Ter Borch is now the Englishman of choice at the palace, which is to say no Englishman at all.',
          },
        },
      },
      {
        label: 'Counter-propose: stand, but ask the Vizier name the favour',
        seed: 'rajah +; dutch -; explicit obligation in the Factor\'s favour',
        fixedOutcome: {
          prose: 'You write back accepting the witness, and asking — gently, by the mercantile habits of yr. office — what the Vizier might consider doing in return. He answers in person at the next audience: a small boon, his to grant in the matter of the inland teak yard, or — if you do not need the teak — in the matter of the Bugis pilots, who are his by influence if not by right.',
          changes: {
            reputation: { rajah: 5, dutch: -6 },
            flags: { vizierMarriage: 'counter', vizierBoonOwed: true },
            journal: 'Stood at Subhan’s marriage in exchange for a boon. The Vizier offered teak or pilots; the matter is held open.',
            hook: 'The Vizier owes you a boon — teak or Bugis pilots. The boon is to be called when the Factor names the matter.',
          },
        },
      },
    ],
    read: false,
  };
}

// ─────────── VIZIER INTEL CHANNEL ───────────
// One to two times per charter, the Vizier writes offering palace-network
// intelligence on ter Borch at Eustace. Cost is an unspoken favour —
// vizierBoonOwed = true is planted if not already set, otherwise the player
// owes a second favour (the Vizier tracks them).
//
// Trigger: visitedEustace (unique-set, so just includes check), day >= 150,
//          90-day spacing, vizierIntelLetterCount < 2, !charterClosed.

function makeVizierIntelLetter(s) {
  const second = (s.flags?.vizierIntelLetterCount ?? 0) >= 1;
  return {
    id: 9300000 + s.day,
    from: 'The Rajah\'s Vizier',
    subject: second ? 'A second word from Kota Pinang' : 'A word from the palace',
    body: `Sir, — The houses at Kota Pinang are not blind, and the wind from Eustace blows toward this palace as readily as toward yours. There is a matter concerning the Hollander ter Borch which ${second ? 'continues to develop' : 'I should be willing to share with you'}, for the courtesies between us.

I write upon it now, and not later, because the matter is the kind which does not keep. The price is no money — that is for the bazaar. The price is yr. word, given quietly, that you remember the courtesy when called.

Yr. obedt. servant,
The Vizier`,
    responses: [
      {
        label: 'Accept; the Vizier shall be remembered',
        seed: 'accept; vizier boon owed; intel plant',
        fixedOutcome: {
          prose: 'You write a careful acceptance, in the language the Vizier will recognise. A folded note returns within the week — three sentences in his own hand, written under the lamp, naming a thing about the Hollander\'s recent correspondence which the Court will not hear of for some time yet.',
          changes: {
            flags: { terborchIntelPlant: true, terborchIntelEverBought: true, vizierBoonOwed: true,
                     vizierIntelLetterCount: (s.flags?.vizierIntelLetterCount ?? 0) + 1 },
            journal: 'Accepted the Vizier\'s intelligence on ter Borch. A favour is owed, to be called.',
            hook: 'The Vizier\'s favour is on the books. He will name it when it suits him.',
          },
        },
      },
      {
        label: 'Decline politely; the courtesies are not equal',
        seed: 'decline; small rajah neutral',
        fixedOutcome: {
          prose: 'You decline by note, with thanks for the regard. The Vizier accepts the refusal with the smallest motion of his head — and writes nothing more for some weeks.',
          changes: {
            flags: { vizierIntelLetterCount: (s.flags?.vizierIntelLetterCount ?? 0) + 1 },
            journal: 'Declined the Vizier\'s offer. The favours-book remains as it was.',
          },
        },
      },
    ],
    read: false,
  };
}

// ─────────── THE VIZIER'S BOON (payoff of vizierBoonOwed) ───────────
// vizierBoonOwed is planted by the marriage counter-propose and the intel
// channel, with a hook ("The Vizier owes you a boon"). For a long while
// nothing called it. Now the Vizier writes once, ~45 days after the debt is
// first on the books, to make good. Three resolving branches — economy
// (teak), logistics (Bugis pilots), politics (a Crown word). Each clears the
// owed state and closes the hook by exact text via closeHookText.
const VIZIER_BOON_HOOKS = [
  'The Vizier owes you a boon — teak or Bugis pilots. The boon is to be called when the Factor names the matter.',
  'The Vizier\'s favour is on the books. He will name it when it suits him.',
];

function makeVizierBoonLetter(s) {
  const haveTeak = !!s.flags?.teakConcession;
  return {
    id: 9310000 + s.day,
    from: 'The Rajah\'s Vizier',
    subject: 'The matter of the favour',
    body: `Sir, — A debt unnamed is a debt that sours, and I am too old a hand to let a good understanding go to vinegar for want of an hour's attention. You stood when I asked it, and the palace does not forget.

I am in a position to do you one of three good turns, and you shall choose, for it is yr. account and not mine. ${haveTeak ? 'The teak yard you already hold; but' : 'There is'} the inland teak — say the word and the cutting is yrs. before the rains. Or there are the Bugis pilots, who know the strait as you know yr. own ledger, and who would shave a day from every passage you make. Or, if it is the King's men who trouble you, I have a quiet word to spend at Bencoolen that would smooth a matter there.

Name it, and consider the account square.

Yr. obedt. servant,
The Vizier`,
    responses: [
      {
        label: haveTeak ? 'The teak — let the second cutting be mine' : 'Call it for the inland teak concession',
        seed: 'teak; rajah +; closes boon',
        fixedOutcome: {
          prose: 'You write for the teak, and the answer is a tally-stick and a name — the headman of the cutting above Kota Pinang, who will know you when you come. The Vizier counts the matter closed, and says so, which from him is a kind of warmth.',
          changes: {
            reputation: { rajah: 4 },
            money: haveTeak ? 120 : 0,
            flags: { teakConcession: true, vizierBoonOwed: false, vizierBoonCalled: true },
            closeHookText: VIZIER_BOON_HOOKS,
            journal: haveTeak
              ? 'Called the Vizier\'s boon for the teak — already held, so he pressed £120 of the season\'s cut on me instead. The favour is settled.'
              : 'Called the Vizier\'s boon for the inland teak concession. The cutting above Kota Pinang is mine. The favour is settled.',
          },
        },
      },
      {
        label: 'Call it for the Bugis pilots',
        seed: 'pilots; faster voyages; closes boon',
        fixedOutcome: {
          prose: 'Within the fortnight two quiet men present themselves at the wharf, barefoot, incurious, and worth more than any chart. They have sailed the strait since boyhood and read the water like a page. Yr. passages will be the shorter for them.',
          changes: {
            reputation: { rajah: 2 },
            flags: { bugisPilots: true, vizierBoonOwed: false, vizierBoonCalled: true },
            closeHookText: VIZIER_BOON_HOOKS,
            journal: 'Called the Vizier\'s boon for the Bugis pilots. Two strait-men now sail with the ship; every passage is a day shorter. The favour is settled.',
          },
        },
      },
      {
        label: 'Call it for a word with the Crown at Bencoolen',
        seed: 'crown +; closes boon',
        fixedOutcome: {
          prose: 'You ask the Vizier to spend his word at the fort, and he does — through what channel you do not learn, but a Crown officer who was cool to you is, at the next meeting, markedly less so. The palace and the fort are not friends; that the Vizier could do this at all is its own intelligence.',
          changes: {
            reputation: { crown: 6, rajah: 1 },
            flags: { vizierBoonOwed: false, vizierBoonCalled: true },
            closeHookText: VIZIER_BOON_HOOKS,
            journal: 'Called the Vizier\'s boon for a word with the Crown at Bencoolen. A King\'s officer warmed to me by the palace\'s influence. The favour is settled.',
          },
        },
      },
    ],
    read: false,
  };
}

// ─────────── THE FINAL DISPATCH (charter-end pacing beat) ───────────
// One-off Director letter at <=180 days remaining: a quota reckoning and a
// pointed reminder of the deadline, so the close of the charter does not
// arrive as a brick wall. Deterministic — no AI. Single acknowledging
// response (informational, no branch).
function makeFinalDispatchLetter(s) {
  const totalPep  = (s.quotas?.pepper?.have   || 0);
  const totalCin  = (s.quotas?.cinnamon?.have || 0);
  const lodgedPep = Math.floor(s.outpost?.warehouse?.pepper   || 0);
  const lodgedCin = Math.floor(s.outpost?.warehouse?.cinnamon || 0);
  const pepShort  = Math.max(0, 400 - totalPep - lodgedPep);
  const cinShort  = Math.max(0, 200 - totalCin - lodgedCin);
  const onCourse  = pepShort === 0 && cinShort === 0;
  const callsLeft = INDIAMAN_TOTAL - (s.indiaman?.visits || 0);
  const reckoning = `By our books you have shipped ${totalPep} of 400 pepper and ${totalCin} of 200 cinnamon, with ${lodgedPep} and ${lodgedCin}cwt respectively lodged at yr. godown against the next call.`;
  const standing = onCourse
    ? 'You stand within reach of the terms. See it carried, and the Court will remember it kindly.'
    : `There wants ${pepShort}cwt of pepper and ${cinShort}cwt of cinnamon yet, and ${callsLeft <= 0 ? 'no further Indiaman is appointed to yr. station' : `but ${callsLeft} call${callsLeft !== 1 ? 's' : ''} of the Indiaman remain`}. We do not write to alarm you; we write so that you cannot say you were not told.`;
  return {
    id: 9320000 + s.day,
    from: 'The Court of Directors, London',
    subject: 'The closing of yr. charter',
    body: `Sir, — The third year of yr. charter draws toward its close: some ${s.daysRemaining} days remain to the reckoning. We send this that the matter may be plainly before you while there is yet time to act upon it.

${reckoning}

${standing}

Whatever cannot be shipped by the close of the term cannot be shipped at all, and the Court reckons the account as it finds it. We trust you will not need this said twice.

Yr. obedt. servants, the Court of Directors.`,
    responses: [
      {
        label: 'Read, and set yr. hand to the season ahead',
        seed: 'acknowledge; no change',
        fixedOutcome: {
          prose: 'You read it twice, and put it in the drawer with the others. The figures do not change for being looked at, but a man steers better for knowing the distance to the rocks.',
          changes: {
            journal: `The Court's final dispatch: ${s.daysRemaining} days to the reckoning. ${onCourse ? 'Within reach of the terms.' : `Short ${pepShort}cwt pepper, ${cinShort}cwt cinnamon.`}`,
          },
        },
      },
    ],
    read: false,
  };
}

// ─────────── THE WEXLEY MATTER (home-country venture via the sister) ───────────
// Yr. sister's familial letters were flavour; this gives them weight. The
// family's portion in a Bristol trading house (Pyne & Wexley) is in question.
// Investing money sent home establishes the bristol_concern venture — dividends
// crossing two oceans, Crusoe's off-stage estate. Three choices: grow it
// (invest → the venture), hold it (cautious, no income but the door open), or
// sell out (cash now, the name leaves the books). One-off; gated in tickDays.
// The open thread the 'hold' branch leaves behind — closed by exact text when
// the matter is later resolved (Step 2). Shared so the two never drift apart.
const WEXLEY_HELD_HOOK = 'The family portion in Pyne & Wexley of Bristol is held but not grown; a fuller strongbox might yet increase it.';

function makeWexleyMatterLetter(s) {
  return {
    id: 9340000 + s.day,
    from: 'Mrs. Eliza Wexley, your sister',
    subject: 'A Matter of Our Late Father’s Concern',
    body: `Dear Brother, — I write on a matter I would not trouble you with were it not pressing, and were you not, of all of us, the one with means in hand.

You will recall our father held a third part in the trading house of Pyne & Wexley here in Bristol — the glass and the West-Country cloth, chiefly. Mr. Pyne, who survives him, has put it to me that the house wants fresh capital, and that the family may either increase our portion now, ahead of strangers he would otherwise bring in, or be bought out of it at a price I will not dignify by repeating.

I have no money to send, as you know. But a portion increased is a portion that pays, year upon year, whether you are in Bristol or in Bayan-Kor. The decision is yrs., for the purse is yrs. Mr. Pyne wants an answer by the spring ships.

Yr. affectionate sister,
Eliza`,
    responses: [
      {
        label: 'Send £700 home — secure and increase our portion',
        seed: 'invest; establishes the Bristol concern; home dividends',
        requiresMoney: 700,
        fixedOutcome: {
          prose: 'You write a bill on yr. London agent for £700 and a letter to Eliza that is warmer than the bill. By the next homeward Indiaman the matter is done: the Wexley portion in Pyne & Wexley is enlarged and entered in yr. name. It will pay each quarter now, an ocean away, while you sleep.',
          changes: {
            money: -700,
            establishVenture: 'bristol_concern',
            flags: { wexleyMatter: 'invested' },
            journal: 'Sent £700 home to Eliza to secure and grow our portion in Pyne & Wexley of Bristol. The house will remit dividends each quarter. An estate at home, of a kind.',
          },
        },
      },
      {
        label: 'Send £200 to merely hold what is ours',
        seed: 'cautious hold; no income yet; door left open',
        requiresMoney: 200,
        fixedOutcome: {
          prose: 'You send £200 — enough to hold the family in the books, not enough to grow. Eliza will understand; she is the more prudent of you, and always was. Mr. Pyne is kept at bay. The matter may come round again, when the strongbox is fuller.',
          changes: {
            money: -200,
            flags: { wexleyMatter: 'held' },
            journal: 'Sent £200 home to hold our portion in Pyne & Wexley. Held, not grown. The door is left open.',
            hook: WEXLEY_HELD_HOOK,
          },
        },
      },
      {
        label: 'Let Mr. Pyne buy us out; take the settlement',
        seed: 'sell out; one-time cash; the name leaves the books',
        fixedOutcome: {
          prose: 'You write that the family will take Mr. Pyne’s offer and be done. The settlement comes by the spring ships — less than the portion was worth, more than nothing, and yrs. clear. The Wexley name leaves the Bristol books after three generations. Eliza’s letter, when it comes, is brief.',
          changes: {
            money: 180,
            flags: { wexleyMatter: 'soldout' },
            journal: 'Let Mr. Pyne buy out the family portion in Pyne & Wexley. £180 came by the settlement; the Wexley name is off the Bristol books.',
          },
        },
      },
    ],
    read: false,
  };
}

// Wexley matter — Step 2. Pays off the 'hold' branch's open door: the Bristol
// house has prospered, and Mr. Pyne now offers to let the family increase its
// portion on better terms than before. Fires only when the matter was HELD,
// well after the holding decision. Mirrors the multi-step scripted-letter
// pattern. Closes WEXLEY_HELD_HOOK on either resolving choice.
function makeWexleyStep2Letter(s) {
  return {
    id: 9341000 + s.day,
    from: 'Mrs. Eliza Wexley, your sister',
    subject: 'Pyne & Wexley Prosper — and the Door Stands Open',
    body: `Dear Brother, — You will be glad of better news than my last. The house has had a famous season — the West-Country cloth sold well into Spain, and Mr. Pyne has taken a contract for the glass that I do not fully understand but which has put the whole concern in good heart.

He has not forgotten that we held our portion when we might have grown it, and he has it in him to be fair: he will let us increase to a full share now, ahead of the strangers, at a figure kinder than he offered before. Or, if you would rather be quit of it, he will buy us out at a price that this good season has made handsome.

It is, as ever, yr. decision and yr. purse. But the door he left ajar is open wider now, and will not stand so for long.

Yr. affectionate sister,
Eliza`,
    responses: [
      {
        label: 'Send £600 — increase to a full share',
        seed: 'invest; establishes the Bristol concern; home dividends',
        requiresMoney: 600,
        fixedOutcome: {
          prose: 'You write a bill on yr. London agent for £600 and a warmer letter to Eliza beneath it. By the next homeward Indiaman the thing is done: the Wexley portion in Pyne & Wexley is enlarged to a full share and entered in yr. name. It will pay each quarter now, an ocean away, while you sleep — and the holding you kept these long months is grown at last.',
          changes: {
            money: -600,
            establishVenture: 'bristol_concern',
            flags: { wexleyMatter: 'invested' },
            closeHookText: WEXLEY_HELD_HOOK,
            journal: 'Sent £600 home to increase our portion in Pyne & Wexley to a full share. The house prospers; it will remit dividends each quarter. The door we left open is shut behind us, and on the right side of it.',
          },
        },
      },
      {
        label: 'Let Mr. Pyne buy us out on the good season',
        seed: 'sell out; one-time cash on better terms; the name leaves the books',
        fixedOutcome: {
          prose: 'You write that the family will take Mr. Pyne’s offer and be done while the offer is good. The settlement comes by the spring ships — handsome, as Eliza promised, the good season having lifted it well above what was first named. The Wexley name leaves the Bristol books after three generations, but it leaves them with money in hand.',
          changes: {
            money: 320,
            flags: { wexleyMatter: 'soldout' },
            closeHookText: WEXLEY_HELD_HOOK,
            journal: 'Let Mr. Pyne buy out the family portion in Pyne & Wexley on the good season. £320 came by the settlement — handsome; the Wexley name is off the Bristol books, but well off them.',
          },
        },
      },
      {
        label: 'Hold as we are; let the door stand',
        seed: 'decline again; no change; the matter rests',
        fixedOutcome: {
          prose: 'You let it lie. The portion is held, not grown, as it has been; Eliza will not press you, though you fancy a line of her letter wishes you would. Mr. Pyne will keep the door ajar a while yet, but a while only. The matter rests where it stood.',
          changes: {
            flags: { wexleyStep2: 'declined' },
            journal: 'Declined again to grow the Pyne & Wexley portion. Held, as before. The door is left open a while longer.',
          },
        },
      },
    ],
    read: false,
  };
}

// ─────────── BROTHERHOOD OPERATIVE QUESTLINE (3 STEPS) ───────────
// First multi-step plot in the game. Pattern: each step is a letter with
// fixedOutcome responses. Each response sets a flag that gates the next
// step's trigger in tickDays. Designed to take ~60–80 days end to end and
// fork at step 2 into Crown or Brotherhood resolution.
//
// Trigger chain:
//   - Step 1 fires once Capt. Faulke is in acquaintances + day >= 90.
//     Sets faulkeQuestStep = 1 on send.
//   - Step 1 responses set faulkeQuestStep = 'paid' / 'declined' /
//     'declined-locked'.
//   - Step 2 fires 30 days after step 1 if step === 'paid'.
//   - Step 2 responses set faulkeQuestStep = 'crown' / 'brotherhood' /
//     'pursued-self'.
//   - Step 3 fires 14 days later, branched.
//   - faulkeQuestStep = 'closed-X' on resolution.

function makeFaulkeStep1Letter(s) {
  return {
    id: 9000000 + s.day,
    from: 'Capt. Thomas Faulke, of the Albatross',
    subject: 'A matter for yr. private ear',
    body: `Sir, — I have laid by yr. last conversation. The sloop we spoke of has been seen again in these waters, and her lines now match what Ramdeen described to a degree I did not credit at the time.

I am minded to take the Albatross north of Eustace before the next monsoon and look at the cove she runs from. The trip costs me a fortnight and a sum of forty pounds in handlings I have no proper account for. If you wish me to put yr. name on what I find, send the forty pounds with this messenger and I shall write again upon my return.

I am, sir, yr. obedt. servant,
Thos. Faulke`,
    responses: [
      {
        label: 'Pay £40; bid Faulke go',
        seed: 'paid; intelligence ~30 days hence',
        fixedOutcome: {
          prose: `You count out forty pounds in coin and send the messenger back to the Albatross with yr. note of consent. Faulke does not tarry; he sails the Tuesday following.`,
          changes: {
            money: -40,
            flags: { faulkeQuestStep: 'paid', faulkeQuestStep1Day: s.day },
            journal: 'Paid £40 to Capt. Faulke for an investigation of the sloop\'s home cove north of Eustace. Word expected upon his return.',
          },
        },
      },
      {
        label: 'Decline, but courteously',
        seed: 'no investigation; thread idles',
        fixedOutcome: {
          prose: `You write back declining the venture, citing the press of yr. own affairs. Faulke sends a brief acknowledgement; the matter, for now, is set aside.`,
          changes: {
            flags: { faulkeQuestStep: 'declined' },
            journal: 'Declined Capt. Faulke\'s proposal to investigate the sloop\'s cove. The thread, for now, idles.',
          },
        },
      },
      {
        label: 'Pass it to the Crown directly',
        seed: 'forwarded to RN; questline closes; Crown standing nudged',
        fixedOutcome: {
          prose: `You forward Faulke's note, with a covering letter of yr. own, to the Royal Navy via the Bombay packet. The matter passes from yr. hand to better-armed ones.`,
          changes: {
            reputation: { crown: 5, pirates: -3 },
            flags: { faulkeQuestStep: 'closed-handed-to-crown' },
            journal: 'Handed Faulke\'s sloop intelligence to the Crown directly. The matter passes from yr. hand.',
          },
        },
      },
    ],
    read: false,
  };
}

function makeFaulkeStep2Letter(s) {
  return {
    id: 9100000 + s.day,
    from: 'Capt. Thomas Faulke, of the Albatross',
    subject: 'What was found in the northern cove',
    body: `Sir, — I am back at Eustace, the Albatross sound. The cove is real and the man who runs it bears the name Carel by the local tongue. The Brotherhood\'s shore base is a disused Portuguese watch, three days\' sail north of Eustace at 4°15\' N, marked on no chart. Fourteen men in arms; two sloops; a small store of powder and stolen rigging.

Carel knows me by face but not by purpose. He believes the Albatross was driven in by weather. I do not think he will believe a second visit.

The matter is now in yr. hand. I shall bend my course as you instruct.

Yr. obedt. servant,
Thos. Faulke`,
    responses: [
      {
        label: 'Pass the location to the Crown',
        seed: 'Crown takes the cove; large standing shifts; bounty paid',
        fixedOutcome: {
          prose: `You compose a sealed packet for Capt. Whitcombe at the Madras station, with chart-bearings and the names Faulke supplied. The Crown\'s answer comes within six weeks: the Adventure has put into the cove, taken Carel and four of his men, fired the watchtower. Yr. share of the prize, accounted for at Bombay, is set at three hundred and twenty pounds.`,
          changes: {
            money: 320,
            reputation: { crown: 18, pirates: -25, company: 4 },
            flags: { faulkeQuestStep: 'closed-crown', brotherhoodAlerted: true },
            journal: 'Forwarded Carel\'s cove to Capt. Whitcombe. Crown took the cove and Carel; bounty paid to Bombay (£320). The Brotherhood will know who informed.',
            hook: 'The Brotherhood will know who informed on Carel. Yr. ships in the strait may pay the price.',
          },
        },
      },
      {
        label: 'Warn Capt. Maas; sell the silence',
        seed: 'Brotherhood standing rises; Crown unaware; modest cash',
        fixedOutcome: {
          prose: `A note to Maas, by trusted hand, with the bare names. Within a fortnight a small bag of unmarked silver — sixty pounds — is left at the godown by a Bugis pilot who does not stay to be questioned. Carel, you hear later, has moved his base by a day's sail; the Crown is none the wiser.`,
          changes: {
            money: 60,
            reputation: { pirates: 12, crown: -3 },
            flags: { faulkeQuestStep: 'closed-brotherhood' },
            journal: 'Warned the Brotherhood of the imminent threat to Carel; £60 in unmarked silver received. Carel has moved.',
            hook: 'The Brotherhood holds you in higher esteem; the Crown does not know what you have done. Both states are durable.',
          },
        },
      },
      {
        label: 'Sit on it; weigh the matter further',
        seed: 'questline pauses; can be resumed via Pursue a thread',
        fixedOutcome: {
          prose: `You write back asking Faulke to keep his peace and his bearings to himself for the present. He agrees, with a wryness in his hand. The matter sits.`,
          changes: {
            flags: { faulkeQuestStep: 'sat-on' },
            journal: 'Held Faulke\'s intelligence for further consideration. The matter rests.',
            hook: 'Faulke\'s intelligence on Carel\'s cove sits in a drawer. The Brotherhood will not wait forever; the Crown will not hear without prompting.',
          },
        },
      },
    ],
    read: false,
  };
}

// ─────────── THE OILSKIN CYLINDER QUESTLINE (2 STEPS, 3 BRANCHES) ───────────
// The AI's habit of inventing memorable MacGuffins (the cylinder from Idris,
// the pale man's sealed letter, etc.) usually has no follow-up machinery.
// This is the cylinder version: a 2-step quest seeded by Idris's character
// that turns the unopened oilskin into a real fork in the road.
//
// Trigger chain:
//   - Step 1 fires once Idris is in acquaintances + day >= 50.
//     Sets cylinderQuest = 'opened' | 'returning' | 'held' + step1Day.
//   - Step 2 fires 30 days later, branched by the step 1 flag:
//       'opened'    → Said bin Mahmood letter (Bugis pilot wants the names)
//       'returning' → Hamzah's thanks (deterministic gift, single ack response)
//       'held'      → Brotherhood pressure letter
//   - Step 2 responses set cylinderQuest = 'closed-X' on resolution.

function makeCylinderStep1Letter(s) {
  return {
    id: 9300000 + s.day,
    from: 'Idris bin Salleh, by a Bugis runner',
    subject: 'Concerning the cylinder you carry',
    body: `Sir, — I write to you in the matter of the oilskin cylinder I left in yr. care when the pinnace lifted me from the strange island. The reckoning of the cylinder is a private one between two Bugis houses and one fishery; its contents are not for the Honourable Company nor the Hollander, nor — I will say — for me to declare in writing.

It would be best, if you can do it, to put the cylinder into the hands of one Hamzah at Kota Pinang — he is my cousin, and the matter rests properly with him. If that is not in yr. way, the cylinder may be opened by yr. own hand, in which case knowledge of certain prahu schedules will pass to you, useful or troublesome by yr. discretion.

If neither course suits, no matter; let it lie under yr. weights, and I shall ask after it again when I am next in yr. waters.

Yr. servt.,
Idris bin Salleh`,
    responses: [
      {
        label: 'Open the cylinder; the knowledge is yrs.',
        seed: 'opened; useful to traders or to the Crown',
        fixedOutcome: {
          prose: 'You break the seal in yr. own counting-room. Inside: three folded sheets, in the Jawi script Hodge does not read, with neat columns of dates, latitudes, and prahu names. Hodge looks once and does not look again.',
          changes: {
            flags: { cylinderQuest: 'opened', cylinderStep1Day: s.day },
            journal: 'Opened Idris\'s oilskin cylinder. Three sheets of Bugis prahu schedules in Jawi. Hodge will not read them.',
            hook: 'The Bugis schedules in the cylinder — saleable to the right hand; dangerous in the wrong one.',
          },
        },
      },
      {
        label: 'Carry it to Hamzah at Kota Pinang',
        seed: 'returning; honour kept',
        fixedOutcome: {
          prose: 'You set the cylinder aside for the next voyage to Kota Pinang. You will hand it to Hamzah unopened, as Idris asks. The matter is, on yr. part, an honourable one.',
          changes: {
            flags: { cylinderQuest: 'returning', cylinderStep1Day: s.day },
            journal: 'Set Idris\'s cylinder aside for the next voyage to Kota Pinang, to be delivered to his cousin Hamzah unopened.',
          },
        },
      },
      {
        label: 'Hold it; yr. weights are heavy enough',
        seed: 'held; the matter sits, but pressure may grow',
        fixedOutcome: {
          prose: 'You write back asking Idris\'s grace; the cylinder will be in yr. weights for the present. The runner takes the note without comment.',
          changes: {
            flags: { cylinderQuest: 'held', cylinderStep1Day: s.day },
            journal: 'Set Idris\'s cylinder under yr. weights for the present. The matter rests.',
          },
        },
      },
    ],
    read: false,
  };
}

// Step 2 — branches on the path taken at step 1. Returns null for paths that
// don't apply or have already resolved.
function makeCylinderStep2Letter(s) {
  const path = s.flags?.cylinderQuest;

  if (path === 'opened') {
    return {
      id: 9310000 + s.day,
      from: 'Said bin Mahmood, a Bugis pilot, by a runner',
      subject: 'A small offer concerning paper',
      body: `Sir, — A pilot is told things he is not told why. I am told you have come into the keeping of certain papers I should very much wish to read. I am not in a position to ask Mr. Salleh directly; he is, by report, away in the lower islands.

Forty pounds in coin lies at yr. discretion if the papers come to my hand. The Hollanders have offered more, but their hand has been slow and their tongue is not mine.

Yr. servt., the runner gives no name; ask for me at the prahu stockade by the south wharf.`,
      responses: [
        {
          label: 'Sell the schedules to Said for £80',
          seed: 'cash; pirate standing nudge; cylinder closed',
          fixedOutcome: {
            prose: 'You meet Said at the south wharf at low tide. He counts out eighty pounds in unmarked silver and takes the sheets without ceremony. The Bugis schedules pass into a wider trade; you are no longer the only Englishman who knows them.',
            changes: {
              money: 80,
              reputation: { pirates: 5 },
              flags: { cylinderQuest: 'closed-sold-bugis' },
              journal: 'Sold Idris\'s schedules to Said bin Mahmood for £80. The Bugis houses have what they wanted.',
            },
          },
        },
        {
          label: 'Pass them to the Crown for the bounty',
          seed: 'larger reward; pirate hostility',
          fixedOutcome: {
            prose: 'You compose a sealed packet for Capt. Whitcombe, with translations Hodge has procured at no small expense. Whitcombe answers within the month: a hundred and fifty pounds is paid to yr. Bombay account against the schedules. The Brotherhood will know who informed.',
            changes: {
              money: 150,
              reputation: { crown: 12, pirates: -10, company: 3 },
              flags: { cylinderQuest: 'closed-sold-crown' },
              journal: 'Forwarded Idris\'s schedules to the Crown via Capt. Whitcombe. £150 paid to Bombay; the Brotherhood will hear in time.',
              hook: 'The Brotherhood will know who informed on the Bugis schedules. Said bin Mahmood is not a forgiving man.',
            },
          },
        },
        {
          label: 'Burn them; the matter is not yrs.',
          seed: 'no cash; small honour standing',
          fixedOutcome: {
            prose: 'You burn the three sheets in yr. own grate at first light. The ash is swept and the matter is closed. Said calls once at the godown and is told the truth; he leaves without comment.',
            changes: {
              reputation: { pirates: 3 },
              flags: { cylinderQuest: 'closed-burned' },
              journal: 'Burned Idris\'s Bugis schedules. Said came and went with no answer to give him.',
            },
          },
        },
      ],
      read: false,
    };
  }

  if (path === 'returning') {
    return {
      id: 9320000 + s.day,
      from: 'Hamzah, cousin to Idris bin Salleh',
      subject: 'Yr. cylinder, received with thanks',
      body: `Sir, — Hodge has put into my hand the oilskin cylinder you carried from my cousin. The seal is whole, the contents private, the matter as it should be.

Yr. courtesy in this is owed a return. I send by the bearer six strings of pearls of the Sulu coast — not extravagant, but yr. own, and on no books that touch the Hollander. Idris knows you have done this, and the news will travel where it travels.

Yr. obliged servt.,
Hamzah`,
      responses: [
        {
          label: 'Acknowledge with formal thanks',
          seed: 'closed; pearls received; small Bugis goodwill',
          fixedOutcome: {
            prose: 'You write to Hamzah a brief note in proper form. The bearer leaves the parcel of pearls upon yr. desk and does not stay for refreshments. The matter is, on every side, well concluded.',
            changes: {
              reputation: { pirates: 4 },
              goods: { pearls: 6 },
              flags: { cylinderQuest: 'closed-honor' },
              journal: 'Hamzah received the cylinder unopened. Six strings of pearls came in return — yr. honour\'s reward.',
              hook: 'The Bugis houses have noted yr. word. A Bugis-aligned hand may yet do you a turn.',
            },
          },
        },
      ],
      read: false,
    };
  }

  if (path === 'held') {
    return {
      id: 9330000 + s.day,
      from: 'A man at the gate, who would not give his name',
      subject: 'Concerning a cylinder yr. weights protect',
      body: `Sir, — I am sent on a matter you will know. There is a cylinder under yr. seal that has been promised to my house, and the term of the courtesy is past. The contents are private and the contents are needed.

I shall come again in seven days. By that hand, the matter may be settled with no Englishman the worse.

By yr. leave,
A man at the gate`,
      responses: [
        {
          label: 'Hand it over unopened',
          seed: 'pirate gain; matter closes',
          fixedOutcome: {
            prose: 'You give the cylinder to Sgt. Dass to set on the dock at the appointed hour. It is taken away by the same hand and yr. household sees neither giver nor recipient again.',
            changes: {
              reputation: { pirates: 8 },
              flags: { cylinderQuest: 'closed-handed-over' },
              journal: 'Handed Idris\'s cylinder to the unnamed Bugis caller as asked. The matter is closed.',
            },
          },
        },
        {
          label: 'Refuse plainly; let them come',
          seed: 'pirate cost; tension',
          fixedOutcome: {
            prose: 'You write a brief refusal and put the cylinder in yr. own strongbox. The man does not return; for the present. Sgt. Dass keeps the night watch under arms for some time after.',
            changes: {
              reputation: { pirates: -6 },
              flags: { cylinderQuest: 'closed-refused' },
              journal: 'Refused the unnamed caller\'s claim on Idris\'s cylinder. The household keeps a tighter watch for a season.',
              hook: 'The unnamed Bugis caller will not let the matter rest. The night watch is, accordingly, the heavier.',
            },
          },
        },
        {
          label: 'Present a forged copy; keep the original',
          seed: 'risky duplicity; outcome unknown until later',
          fixedOutcome: {
            prose: 'Hodge spends three nights making a fair copy in his best Jawi imitation — passable to a glance, not to a reader. The copy is left at the gate at the appointed hour. The original sleeps in yr. strongbox.',
            changes: {
              reputation: { pirates: 4 },
              flags: { cylinderQuest: 'closed-forged' },
              journal: 'Hodge forged a copy of the cylinder; left at the gate. The original sits in yr. strongbox.',
              hook: 'The forgery may be detected. The original is in yr. keeping; the consequences yet to be felt.',
            },
          },
        },
      ],
      read: false,
    };
  }

  return null;
}

// ─────────── THE PALE MAN'S SEALED LETTER (2 STEPS, 3 BRANCHES) ───────────
// Second multi-step questline, parallel to the cylinder. The pale man with
// the missing finger-joint — an AI-invented figure from prior playthroughs,
// here promoted to a fixed scripted character. He carries a sealed contract
// for off-the-books opium between the Pelican's Nest and Eustace, profiting
// the Factor by working between English and Dutch markets without the
// Hollander's customs clerks knowing.
//
// Trigger chain:
//   - Step 1 fires once after day 130 if the Factor has visited Kota Pinang.
//     Sets paleManQuest = 'opened' | 'declined' | 'crown' on response.
//   - Step 2 fires 30 days later, branched by the step 1 flag.

function makePaleManStep1Letter(s) {
  return {
    id: 9500000 + s.day,
    from: 'An unknown hand, by an unmarked Bugis runner',
    subject: 'A sealed packet, no return',
    body: `[The seal is plain wax, no insignia. The runner did not stay long enough to be questioned. The letter is in a careful, even Englishman\'s hand.]

Sir, — A man who knows yr. quality but not yr. office writes. There is a contract that profits an English Factor by working between the English and Dutch markets in a particular cargo, without the Hollander\'s customs clerks knowing. Two hundred pounds advance, four hundred upon delivery, both sums in unmarked silver.

The cargo is opium. The lift is at the Pelican\'s Nest, the drop at Port St. Eustace, the route by yr. own discretion. I will be at Kota Pinang the morning of the next moon, missing a piece of my left index finger and carrying nothing in my hands. If you mean to take the matter up, find me there.

If you mean to refuse, do not write back. The runner is the only man who knows you have read this.

Yr. servt., who would not give his name.`,
    responses: [
      {
        label: 'Open the door; mean to meet him at Kota Pinang',
        seed: 'opened; the offer stands; resolution at next contact',
        fixedOutcome: {
          prose: 'You set the letter aside in yr. own strongbox. Hodge does not see it; Sgt. Dass is told only that a Bugis runner came and went. The next moon is two weeks away.',
          changes: {
            money: 0,
            flags: { paleManQuest: 'opened', paleManStep1Day: s.day },
            journal: 'Read the unmarked letter; mean to meet the pale man at Kota Pinang the next moon. The matter is, for now, in yr. strongbox.',
            hook: 'The pale man with the missing finger-joint; a contract under no Hollander\'s customs.',
          },
        },
      },
      {
        label: 'Refuse to engage; the matter is not yrs.',
        seed: 'declined; matter rests',
        fixedOutcome: {
          prose: 'You burn the letter in yr. own grate at supper. The runner does not return; the next moon comes and goes without consequence.',
          changes: {
            flags: { paleManQuest: 'declined' },
            journal: 'Burned the unmarked letter from the unknown correspondent. The matter is, on yr. side, closed.',
          },
        },
      },
      {
        label: 'Pass the letter to the Crown',
        seed: 'crown gain; the unknown hand will not write again',
        fixedOutcome: {
          prose: 'You forward the letter under yr. own cover to Capt. Whitcombe at Madras, with a note explaining the means of its delivery. The reply, when it comes, is brief and approving. The Royal Navy will, in due course, pay the man a visit at Kota Pinang.',
          changes: {
            reputation: { crown: 8, pirates: -3 },
            flags: { paleManQuest: 'crown', paleManStep1Day: s.day },
            journal: 'Forwarded the unmarked letter to Capt. Whitcombe at Madras. The Crown will, in due course, take an interest in the pale man at Kota Pinang.',
            hook: 'The Crown will follow the pale man\'s trail. What they find — and how it returns to yr. hand — yet to be known.',
          },
        },
      },
    ],
    read: false,
  };
}

function makePaleManStep2Letter(s) {
  const path = s.flags?.paleManQuest;

  if (path === 'opened') {
    return {
      id: 9510000 + s.day,
      from: 'The pale man, in person at the Kota Pinang wharf',
      subject: 'Yr. answer to the contract',
      body: `[At the Kota Pinang wharf at first light. He is precisely as the letter described — pale, the left index finger short of one joint, no parcel in his hands.]

— Yr. moon is on time, sir. I have a hundred and eighty pounds in unmarked silver here for you. Two cwt of opium are stored at the Pelican\'s Nest under the name of one Said bin Mahmood; another two on the way. Lift the four cwt and put them in yr. own godown at Bayan-Kor for now. I shall write to you in a fortnight upon the matter of the drop at Eustace.

— The remaining twenty pounds I shall pay when the contract is fulfilled.

— If you change yr. mind now, the silver is in this purse and you may take it. The contract closes; I shall not write again.`,
      responses: [
        {
          label: 'Accept; take the silver; lift the opium at the Nest',
          seed: 'contract begins; £180 advance; flag for the run',
          fixedOutcome: {
            prose: 'You take the purse — one hundred and eighty pounds in unmarked silver. The pale man writes nothing down; he nods once and turns inland. Yr. next port at the Nest will lift his opium, by Said bin Mahmood\'s name. The Hollander\'s customs at Eustace will not know.',
            changes: {
              money: 180,
              reputation: { pirates: 3 },
              flags: { paleManQuest: 'closed-contracted' },
              journal: 'Accepted the pale man\'s contract. £180 in unmarked silver. The lift is to be at the Pelican\'s Nest, the drop at Eustace, by yr. own discretion.',
              hook: 'The pale man\'s contract is in motion. The drop at Eustace remains; the Hollander\'s customs must not know.',
            },
          },
        },
        {
          label: 'Decline at the wharf; refund the offer',
          seed: 'closed; small standing nudge',
          fixedOutcome: {
            prose: 'You decline at the wharf, civilly. The pale man receives it without comment. He pockets the purse and walks away inland; he does not write again.',
            changes: {
              flags: { paleManQuest: 'closed-declined-late' },
              journal: 'Declined the pale man\'s contract at the wharf. The matter is closed.',
            },
          },
        },
        {
          label: 'Counter-propose: opium at half the rate',
          seed: 'risky negotiation; either accepts or walks',
          fixedOutcome: {
            prose: 'You ask for half the figure on the cargo and the same advance — eighty pounds for two cwt rather than one-eighty for four. He looks once, considers a moment, then nods. Eighty pounds in unmarked silver passes to yr. hand. The lift is at the Nest under Said\'s name; the drop yet to be set.',
            changes: {
              money: 80,
              reputation: { pirates: 4 },
              flags: { paleManQuest: 'closed-half-contract' },
              journal: 'Counter-proposed; the pale man accepted at half the cargo. £80 in unmarked silver received.',
              hook: 'The reduced contract sits in motion. The drop at Eustace yet to come; less cargo, less risk.',
            },
          },
        },
      ],
      read: false,
    };
  }

  if (path === 'crown') {
    return {
      id: 9520000 + s.day,
      from: 'Capt. Whitcombe, by the Madras packet',
      subject: 'Concerning yr. correspondent at Kota Pinang',
      body: `Sir, — Yr. forward of the unmarked letter has been laid before the Madras office. The Adventure put a small party into Kota Pinang under cover, found yr. man, and made an arrest in due form. He is one Mr. Holcombe, formerly of the Bombay establishment, struck off two years past for a similar matter elsewhere.

The Court has noted yr. forward with proper credit. A bounty of one hundred and twenty pounds is paid to yr. Bombay account against the matter. The Brotherhood, if Holcombe was their hand, will know of yr. part.

Yr. obedt. servt.,
Edward Whitcombe`,
      responses: [
        {
          label: 'Acknowledge with formal compliance',
          seed: 'closed; bounty paid; Crown standing',
          fixedOutcome: {
            prose: 'You write a brief note of acknowledgement. The bounty is, in due course, posted to yr. account at Bombay. Mr. Holcombe is, by report, on his way to Calcutta in irons.',
            changes: {
              money: 120,
              reputation: { crown: 6, pirates: -2 },
              flags: { paleManQuest: 'closed-crown-bounty' },
              journal: 'Capt. Whitcombe arrested the pale man (Mr. Holcombe of the Bombay establishment, struck off). £120 bounty paid to Bombay.',
              hook: 'The Brotherhood, if Mr. Holcombe was their hand, will hear how he was taken.',
            },
          },
        },
      ],
      read: false,
    };
  }

  return null;
}

// ─────────── THE WILBRAHAM MYSTERY (2 STEPS, BRANCHED) ───────────
// Investigating the predecessor's death. Wilbraham's papers (in every save
// from day 1) describe his fever, Hodge weeping, and the Reverend's refusal
// to come down from the Mission. Sgt. Dass kicks the matter open by writing
// what he didn't tell at the time.
//
// Trigger chain:
//   - Step 1 fires after day 100 with Dass loyalty >= 70 (he trusts the
//     Factor enough to write). Sets wilbrahamMystery = 'asked-reverend' |
//     'asked-hodge' | 'closed-rested'.
//   - Step 2 fires 30 days later, branched by step 1.

function makeWilbrahamStep1Letter(s) {
  return {
    id: 9600000 + s.day,
    from: 'Sgt. Dass, on a private matter',
    subject: 'Concerning the late Mr. Wilbraham',
    body: `Sir, — I write upon a matter I never put to him whose place you now hold, and have not put to any man since. The household has settled to yr. hand and you may judge it best, having heard, that nothing should be made of it; but I would not have the matter die in my keeping.

I kept the watch the night Mr. Wilbraham went. The fever was on him, and the Reverend Pyke was sent for at the second hour. I saw the Reverend leave the Mission gate by the lamp, and I saw the Reverend return to the Mission gate by the lamp, and there was no time in between for him to have come to the godown. I thought nothing of it at the time. I have come, since, to think of it.

Mr. Hodge was at the bedside the whole hour. The fever, sir, was real. But the Reverend did not come down. And Mr. Wilbraham, by the morning, did not get up.

I leave the matter to yr. hand. — Dass.`,
    responses: [
      {
        label: 'Ask the Reverend why he did not come down',
        seed: 'investigation; Reverend will write back',
        fixedOutcome: {
          prose: 'You walk to the Mission at first light next morning and ask Pyke a careful question, in the careful way one asks. He looks at you, says nothing, and writes you a letter the following Sunday in his small upright hand.',
          changes: {
            flags: { wilbrahamMystery: 'asked-reverend', wilbrahamStep1Day: s.day },
            journal: 'Asked the Reverend why he did not come down to Mr. Wilbraham\'s bedside. He looked at me long and said nothing. A letter is to follow.',
          },
        },
      },
      {
        label: 'Ask Hodge what he remembers',
        seed: 'investigation; Hodge will speak in his cups',
        fixedOutcome: {
          prose: 'You wait for an evening Hodge is in his cups and the conversation has run upon old days. He is unguarded; he tells you something he has never told a soul. You write down what he says before sleep, in case the morning takes it from him.',
          changes: {
            flags: { wilbrahamMystery: 'asked-hodge', wilbrahamStep1Day: s.day },
            journal: 'Asked Hodge what he remembered of Mr. Wilbraham\'s last night. He told me, in drink, something he had never told. The detail must be set down before he forgets.',
          },
        },
      },
      {
        label: 'Let the dead rest',
        seed: 'matter closes; small Mission standing nudge for the gesture',
        fixedOutcome: {
          prose: 'You write Dass a brief note thanking him for his confidence and asking him to keep his peace. The Sergeant agrees; the matter is set aside. The Reverend Pyke is at supper that Sunday, and inquires politely after yr. health.',
          changes: {
            reputation: { mission: 2 },
            flags: { wilbrahamMystery: 'closed-rested' },
            journal: 'Asked Dass to keep the matter of Mr. Wilbraham\'s last night to himself. The dead, on yr. office\'s judgement, may rest.',
          },
        },
      },
    ],
    read: false,
  };
}

function makeWilbrahamStep2Letter(s) {
  const path = s.flags?.wilbrahamMystery;

  if (path === 'asked-reverend') {
    return {
      id: 9610000 + s.day,
      from: 'Reverend Pyke, of the Mission at Bayan-Kor',
      subject: 'A matter of conscience long held',
      body: `Sir, — I have prayed upon yr. question and shall give you the answer I should have given Mr. Hodge that night, had he asked it.

Mr. Wilbraham came to the Mission six weeks before his death and asked me to put my name to a paper concerning the inland teak. The paper, in his own hand, would have transferred the concession to one Mynheer ter Borch upon his decease, in exchange for the discharge of a personal debt of thirty-eight pounds. He had been losing at cards.

I refused. I told him what I thought of a Factor who would sell what was the Company's to a Hollander to settle his cards. He left in such a state as I have not seen since.

When the messenger came to fetch me to his bedside, I confess I prayed first, and then I made it my business not to come. The fever was real, sir; the abandonment was mine. He had been my brother in the work and I let him die alone. I have not preached on Christian charity since.

Yr. servt. in lower spirits than usual,
Pyke`,
      responses: [
        {
          label: 'Pray with him; let the matter rest',
          seed: 'mission gain; the Reverend\'s contrition becomes a bond',
          fixedOutcome: {
            prose: 'You attend Sunday service that week and stay after for a private prayer with Pyke. He is, by all accounts, a different man at the lectern thereafter.',
            changes: {
              reputation: { mission: 8 },
              flags: { wilbrahamMystery: 'closed-prayed' },
              journal: 'Prayed with Pyke after his confession on Mr. Wilbraham. The Reverend is, by all accounts, a different man at the lectern.',
            },
          },
        },
        {
          label: 'Break with the Mission; this will not stand',
          seed: 'mission collapse; rajah small gain (notice the schism)',
          fixedOutcome: {
            prose: 'You write Pyke a careful note severing the Factor\'s personal acquaintance with the Mission. Sunday service goes on without yr. attendance and the chapel will not see yr. shadow again. The Vizier, hearing of it, sends a parcel of mangoes by way of comment.',
            changes: {
              reputation: { mission: -25, rajah: 4 },
              flags: { wilbrahamMystery: 'closed-broken' },
              journal: 'Broke with the Mission over the Reverend\'s confession on Mr. Wilbraham. The chapel will not see yr. shadow again.',
              hook: 'The Mission has been broken with. The Reverend\'s standing will not return; the household feels it.',
            },
          },
        },
        {
          label: 'Pursue ter Borch on the matter of the cards',
          seed: 'dutch hostility; rajah neutral; new thread opens',
          fixedOutcome: {
            prose: 'You compose a careful letter to Mynheer ter Borch at Eustace, asking what he knows of certain papers Mr. Wilbraham may have given him concerning the inland teak. His reply, when it comes, is brief and acid: he knows of no such papers and is offended at the imputation. The matter, on yr. side, opens.',
            changes: {
              reputation: { dutch: -10 },
              flags: { wilbrahamMystery: 'closed-pursuing-dutch' },
              journal: 'Wrote to ter Borch on the matter of Wilbraham\'s gambling debts and the teak papers. His reply is acid; he denies all.',
              hook: 'Ter Borch knows of papers Wilbraham may have given him on the teak. He denies it; the matter is open in yr. hand.',
            },
          },
        },
      ],
      read: false,
    };
  }

  if (path === 'asked-hodge') {
    return {
      id: 9620000 + s.day,
      from: 'Mr. Hodge, after a Friday evening',
      subject: '[A note in yr. own hand, transcribed before sleep]',
      body: `[Hodge in his cups, evening of the third Friday after yr. question. The household is asleep. Hodge is at the godown door, weeping. What follows is what he said; I have set it down before sleep, lest morning take it from him.]

— I brought him water that night, sir. He could not keep down the rum and the fever made him cry out for water. I went to the well and the well was foul with the night-rain and so I went to the kitchen jar.

— The kitchen jar was the one Mr. ter Borch's clerk had been at the day before. I had thought nothing of it. The clerk had come asking after sandalwood and Wilbraham had not seen him; he sat in the kitchen and was given a cup of tea by Mariam.

— I gave him the water from that jar, sir. He drank it. He did not stop crying out, but he did not cry out the same way after.

— I have never told this to anyone. I have prayed about it and I have drunk about it and I have never told it.

[Hodge slept in the godown that night. By morning he did not remember telling me. The note above is mine, signed and sealed.]`,
      responses: [
        {
          label: 'Confront ter Borch directly',
          seed: 'dutch hostility; thread opens',
          fixedOutcome: {
            prose: 'You compose a letter to ter Borch by the next Bombay packet — careful, formal, leaving the matter unsaid but plain. His reply is acid: yr. household runs on a drunkard\'s testimony, his clerk was on lawful business, the matter is not for his pen. He does not, however, write it off.',
            changes: {
              reputation: { dutch: -12 },
              flags: { wilbrahamMystery: 'closed-confronted-dutch' },
              journal: 'Wrote to ter Borch on what Hodge described. His reply is acid; he does not, however, write it off.',
              hook: 'Ter Borch knows you suspect his clerk. The Hollander\'s door at Eustace will be the colder for it.',
            },
          },
        },
        {
          label: 'Take it to the Vizier; let him handle it',
          seed: 'rajah gain; dutch loss; a hook with the palace',
          fixedOutcome: {
            prose: 'You attend the palace at the next audience and lay Hodge\'s account before the Vizier in confidence. He listens with a face that does not move. Within the month, ter Borch\'s clerk has been quietly turned away from the household kitchen at Bayan-Kor by the Rajah\'s direct order.',
            changes: {
              reputation: { rajah: 8, dutch: -10 },
              flags: { wilbrahamMystery: 'closed-vizier' },
              journal: 'Laid Hodge\'s account before the Vizier. Ter Borch\'s clerk has been turned away from the household kitchen.',
              hook: 'The Vizier handled the ter Borch clerk for you. The favour is yrs. to be reminded of.',
            },
          },
        },
        {
          label: 'Bury it; Hodge is suggestible, and the matter is old',
          seed: 'closed; small standing nudge',
          fixedOutcome: {
            prose: 'You burn the note before Hodge can wake to remember it. The matter, on yr. judgement, dies between the two of you.',
            changes: {
              flags: { wilbrahamMystery: 'closed-buried' },
              journal: 'Burned Hodge\'s drunken account of the kitchen jar. The matter dies with the morning.',
            },
          },
        },
      ],
      read: false,
    };
  }

  return null;
}

// Wilbraham step 3 — ter Borch answers back. Fires 30 days after the
// player's pursuit (closed-pursuing-dutch or closed-confronted-dutch).
// He has had time to weigh the options. Three forms his answer takes,
// chosen here by the existing Dutch standing — the colder it is, the
// more openly hostile his reply.

function makeWilbrahamStep3Letter(s) {
  const dutchRep = s.reputation?.dutch || 0;
  // Hot, cool, or cold — three tone variants. Player gets a letter that
  // matches their existing standing with the Dutch.
  if (dutchRep >= 0) {
    // He answers civilly, even half-conceding; the matter can be settled
    // at the trade pass's renewal.
    return {
      id: 9630000 + s.day,
      from: 'Mynheer ter Borch, of the Dutch House at Eustace',
      subject: 'A reply, after due consideration',
      body: `Sir, — I have weighed yr. letter and the implications you do not put plainly. The matter of Mr. Wilbraham's last days was, by report, a fever; and the Mission, by report, did not come down to the bedside. These facts I take from common knowledge; nothing in them is mine to write or yours to address to me.

That said, sir, I have read carefully and I am not insensible. There is, in my private books, a draft of a paper from yr. predecessor that I have never put forward to the late Mr. Wilbraham's executors, and shall not. If yr. office wishes, the draft can be destroyed at the next packet; if not, it remains in my keeping and goes no further.

I shall expect an acknowledgement.

Yr. obedt. servt.,
ter Borch`,
      responses: [
        {
          label: 'Thank him; ask the draft be destroyed',
          seed: 'closes the chapter; small Dutch standing',
          fixedOutcome: {
            prose: 'You write a brief acknowledgement and ask, in proper form, for the draft to be destroyed at the next packet. Ter Borch sends back a single line: "It is done." The matter is closed.',
            changes: {
              reputation: { dutch: 4 },
              flags: { wilbrahamMystery: 'closed-settled' },
              journal: 'Settled the matter of Mr. Wilbraham\'s gambling draft with ter Borch. The paper is destroyed; the Hollander\'s books are clean.',
            },
          },
        },
        {
          label: 'Ask for the draft itself; don\'t trust the Hollander',
          seed: 'evidence in hand; small Dutch loss',
          fixedOutcome: {
            prose: 'You write asking for the draft itself, by the next safe packet. Ter Borch obliges with cooler grace than is usual. The folded paper arrives in yr. strongbox a fortnight later — a draft signed in Wilbraham\'s hand, dated three weeks before his death. You hold the evidence; the matter, on yr. side, may be made of what you wish.',
            changes: {
              reputation: { dutch: -3 },
              flags: { wilbrahamMystery: 'closed-evidence-held', wilbrahamDraftHeld: true },
              journal: 'Asked ter Borch for the draft itself. He sent it. The Wilbraham gambling draft sits in yr. strongbox.',
              hook: 'Wilbraham\'s draft, in his own hand, sits in yr. strongbox. It is evidence enough for the Court if the Factor cared to use it.',
            },
          },
        },
      ],
      read: false,
    };
  }

  if (dutchRep >= -20) {
    // Cool — he denies all, takes offense, but doesn't escalate. The matter
    // closes with an open door slamming shut.
    return {
      id: 9631000 + s.day,
      from: 'Mynheer ter Borch, of the Dutch House at Eustace',
      subject: 'A formal reply',
      body: `Sir, — I have read yr. letter once and shall not read it twice. There were no papers from Mr. Wilbraham. There were no kitchen jars. The Hollander does not, sir, employ poisoners.

If yr. office wishes a continued commercial acquaintance with this house, you will see fit not to write again on this matter. We have, after this hand, no further business but the customs at the wharf.

Yr. obedt. servt.,
ter Borch`,
      responses: [
        {
          label: 'Acknowledge; let the matter rest',
          seed: 'closes; small Dutch repair',
          fixedOutcome: {
            prose: 'You write a brief note acknowledging the receipt and the rebuke, and let the matter rest. Ter Borch does not reply, which on his terms is a reply.',
            changes: {
              reputation: { dutch: 2 },
              flags: { wilbrahamMystery: 'closed-rebuked' },
              journal: 'Ter Borch took offense at yr. letter and rebuked you; you let the matter rest. The Hollander\'s door is the cooler for it but not closed.',
            },
          },
        },
        {
          label: 'Press the matter; there is too much smoke for no fire',
          seed: 'further hostility; reputation cost',
          fixedOutcome: {
            prose: 'You write again, more pointedly. Ter Borch does not answer in writing this time. A small but pointed obstruction begins at the Eustace customs the next month — extra forms, longer waits. The matter is, for now, his to handle without you.',
            changes: {
              reputation: { dutch: -8 },
              flags: { wilbrahamMystery: 'closed-pressed' },
              journal: 'Pressed ter Borch on the Wilbraham matter. He stopped writing; the customs at Eustace grew slower for some months.',
              hook: 'The Hollander has dug in. Yr. business at Eustace will move at the customs clerks\' pace, and the clerks know what is wanted of them.',
            },
          },
        },
      ],
      read: false,
    };
  }

  // Cold (Dutch standing < -20) — he proposes a duel, period-plausible.
  return {
    id: 9632000 + s.day,
    from: 'Mynheer ter Borch, of the Dutch House at Eustace',
    subject: 'A demand',
    body: `Sir, — I have had enough. The implication you have laid against this house is not one I shall answer in writing twice. I have laid yr. correspondence before two Dutch gentlemen of Batavia who were of Mr. Wilbraham\'s acquaintance; they are content that the matter be settled at twelve paces.

I shall expect a second to call upon mine — Mr. Vossius, of the same establishment — at the earliest convenience. Pistols are to my preference, if it is yours. Otherwise the customs at Eustace shall in future be closed against yr. ship by my own application to the Senior Factor.

Yr. servt., on this point precisely as long as it requires,
ter Borch`,
    responses: [
      {
        label: 'Accept; meet him at twelve paces',
        seed: 'high-stakes duel: ship damage or kill or be killed; faction shifts',
        fixedOutcome: {
          prose: 'You appoint Sgt. Dass as yr. second and the meeting is set on a coral spit at low tide. Ter Borch is the worse shot; you meet at twelve paces and he falls at the first exchange, in the leg. He survives, with a limp, and writes you no more on any subject. The Crown is, when news reaches Madras, quietly content.',
          changes: {
            reputation: { dutch: -25, crown: 6 },
            flags: { wilbrahamMystery: 'closed-duelled' },
            journal: 'Met ter Borch at twelve paces on a coral spit. He fell at the first exchange — wounded in the leg, his correspondence ended forever.',
            hook: 'The duel will be remarked upon. The Hollander\'s door is shut against yr. ship at Eustace; the Crown is, in private, content.',
          },
        },
      },
      {
        label: 'Refuse the duel; accept the customs penalty',
        seed: 'Dutch close their door; small standing for refusing violence',
        fixedOutcome: {
          prose: 'You write a careful refusal; a man of yr. office does not meet pistols on the say-so of the Hollander. The customs at Eustace are closed against yr. ship by formal application to the Senior Factor; ter Borch sees you no more at his desk.',
          changes: {
            reputation: { dutch: -15, mission: 5 },
            flags: { wilbrahamMystery: 'closed-refused-duel', dutchPortClosed: true },
            journal: 'Refused ter Borch\'s challenge. The Eustace customs are closed against yr. ship; the Mission is, on this point, with you.',
            hook: 'The Eustace customs are closed against yr. ship. The Hollander has, on his terms, won.',
          },
        },
      },
    ],
    read: false,
  };
}
// Senders gated by reputation / flags so the post reflects the Factor's
// standing. The Director and the Vizier have dedicated cadences elsewhere
// (Indiaman + quarterly nags; teak concession) and are excluded here so we
// don't double up. Weights bias toward senders the Factor would more
// plausibly hear from often.

const AUTO_SENDERS = [
  {
    key: 'wexley',
    from: 'Mrs. Eliza Wexley, your sister',
    faction: null,
    mood: 'familial, news of home, gentle reproach, a child or aunt named, the weather in Bristol',
    weight: 4,
  },
  {
    key: 'faulke',
    from: 'Capt. Faulke of the Albatross',
    faction: null,
    mood: 'weather-beaten, offering passage or news of the strait, the price of pepper at Madras, perhaps a warning',
    weight: 3,
  },
  {
    key: 'pyke',
    from: 'Reverend Pyke of the Mission',
    faction: 'mission',
    mood: 'pious, requesting favour, warning of moral peril, perhaps a small subscription wanted',
    weight: 2,
    gate: (s) => (s.reputation?.mission || 0) >= -10,
  },
  {
    key: 'pirates',
    from: 'An Anonymous Hand',
    faction: 'pirates',
    mood: 'guarded, suggesting an arrangement profitable to both, written in a hand the Factor does not recognise',
    weight: 2,
    gate: (s) => (s.reputation?.pirates || 0) >= 5,
  },
  {
    key: 'terborch',
    from: 'Mynheer ter Borch',
    faction: 'dutch',
    mood: 'formal, suspicious, perhaps offering a deal, perhaps testing — a Calvinist clarity, a trader\'s caution',
    weight: 2,
    gate: (s) => (s.reputation?.dutch || 0) >= -25,
  },
  {
    key: 'dryden',
    from: 'Mr. Edmund Dryden, of the Court of Directors',
    faction: 'company',
    mood: 'private, informal, concerned with private trade, country shipping, the news of London — written on Company-but-not-Court paper, a Director writing as a man',
    weight: 2,
    gate: (s) => s.flags?.companyFaction === 'speculative',
  },
  {
    key: 'cama',
    from: 'Mr. Pestonji Cama, of the Bombay establishment',
    faction: null,
    mood: 'a careful Parsi shipping clerk, second to a great house, offering small pieces of news for small pieces of money — formal mercantile English with the occasional Zoroastrian touchstone',
    weight: 1,
    gate: (s) => s.day >= 90,
  },
];

function pickAutoSender(s) {
  let eligible = AUTO_SENDERS.filter(snd => !snd.gate || snd.gate(s));
  if (eligible.length === 0) return null;
  // First contact (early game) should be warm and orienting — family and a
  // friendly captain — not a wary rival sizing you up. Restrict the very early
  // letters to faction-null senders; the factions write once you're established.
  if ((s.day || 0) < 25) {
    const warm = eligible.filter(snd => !snd.faction);
    if (warm.length > 0) eligible = warm;
  }
  const total = eligible.reduce((a, b) => a + b.weight, 0);
  let r = Math.random() * total;
  for (const snd of eligible) {
    r -= snd.weight;
    if (r <= 0) return snd;
  }
  return eligible[eligible.length - 1];
}

// ─────────── SABOTAGE ARCS (3 RIVALS × 2 STEPS) ───────────
// Each arc lets the player commission a rival's downfall through the
// channel that already feeds them rumours. Step 1 lands when conditions
// in canOfferSabotage hold; the player commissions / negotiates / declines.
// Step 2 fires 45 days later via tickDays, with outcome resolved by
// resolveSabotage (success / partial / failure) keyed off rival rep on
// the channel's faction axis.
// Spec: docs/superpowers/specs/2026-05-09-sabotage-arcs-design.md.

function makeSabotageHardacreStep1Letter(s) {
  return {
    id: 9500000 + s.day,
    from: 'A small voice in the strait',
    subject: 'On the matter of yr. peer at Bencoolen',
    body: `Sir, — The strait writes to you again, plainly. The man at Bencoolen has been a thorn in yr. side long enough; we have lascars on his quarter who would prefer a different employment, and a Bugis pilot at the Mentawai who knows the reefs better than the Captain does.

The price for the lifting of his next freight is five hundred pounds, paid as before by the boy at the wharf. We can also do the matter quieter, for three hundred — half-measures, half-results, that is the trade of it.

The strait holds the offer for ten days. We do not write again on this matter.

— Yrs., as the strait is.`,
    responses: [
      {
        label: 'Commission the full lifting (£500)',
        seed: 'commit; full method',
        fixedOutcome: {
          prose: `Five hundred pounds in coin and unmarked silver pass to the boy at the wharf in a sealed packet. He goes without speaking. The brigantine sails for Bencoolen on the following Thursday; the matter is now in motions you have set in train.`,
          changes: {
            money: -500,
            flags: { sabotage_hardacre_method: 'commission', sabotage_hardacre_committed_day: s.day },
            sabotagesCommitted: 1,
            journal: 'Paid £500 to the strait for the lifting of Mr. Hardacre’s brigantine. The matter is in train; word in five or six weeks.',
            hook: 'You have set a Brotherhood lifting in motion against Hardacre. Word is expected in some five or six weeks.',
          },
        },
      },
      {
        label: 'Negotiate the cheaper, quieter matter (£300)',
        seed: 'commit; negotiate method',
        fixedOutcome: {
          prose: `Three hundred pounds, by the same hand. The boy at the wharf takes the packet without expression. The strait will do what it does for the price asked; the Factor will hear of it in due course.`,
          changes: {
            money: -300,
            flags: { sabotage_hardacre_method: 'negotiate', sabotage_hardacre_committed_day: s.day },
            sabotagesCommitted: 1,
            journal: 'Paid £300 to the strait — a quieter matter against Mr. Hardacre. Word in five or six weeks.',
            hook: 'A bargained-for matter is in motion against Hardacre.',
          },
        },
      },
      {
        label: 'Decline the matter',
        seed: 'decline; arc closes',
        fixedOutcome: {
          prose: `You write back briefly. ‘Such matters as the strait is offering, the Factor declines.’ The boy at the wharf takes the note without comment. The matter is closed.`,
          changes: {
            flags: { sabotage_hardacre_method: 'declined' },
            journal: 'Declined the strait’s offer to lift Mr. Hardacre’s brigantine.',
          },
        },
      },
    ],
    read: false,
  };
}

function makeSabotageHardacreStep2Letter(s) {
  const method = s.flags?.sabotage_hardacre_method;
  const outcome = resolveSabotage('hardacre', s, { method });
  const branches = {
    success: {
      subject: 'The strait has done its work',
      body: `Sir, — Word from a Bugis pilot at the Pelican’s Nest. The brigantine bound for Bencoolen was driven onto a reef in the Mentawai by what the Captain calls bad pilotage and the strait calls itself. Hardacre walks the wharf at Bencoolen with no command to give, and the Court will hear of it within the month.

The strait considers itself paid in full. We do not write again on this matter.

—`,
      changes: {
        rivals: { hardacre: { state: 'broken' } },
        rivalPressureModifierPush: { fromDay: s.day, lifetimeDays: 480, delta: -25 },
        reputation: { pirates: 3 },
        flags: { sabotage_hardacre_resolved: 'success' },
        journal: 'The brigantine was lifted in the strait. Mr. Hardacre walks the Bencoolen wharf with no command to give.',
      },
    },
    partial: {
      subject: 'A clean theft, and no more',
      body: `Sir, — The matter went part-way. The brigantine was boarded in the strait at the new moon; her cargo of pepper and calico was lifted clean and is now at sea under no flag. Mr. Hardacre kept his bottom and his life; he did not keep his freight.

The strait considers itself paid for the work given. — Yrs., as the strait is.`,
      changes: {
        rivals: { hardacre: { state: 'troubled', standing: -20 } },
        rivalPressureModifierPush: { fromDay: s.day, lifetimeDays: 240, delta: -10 },
        flags: { sabotage_hardacre_resolved: 'partial' },
        journal: 'A clean theft in the strait — Mr. Hardacre lost three months’ freight but kept his bottom.',
      },
    },
    failure: {
      subject: 'The strait went badly',
      body: `Sir, — The matter is broken. Mr. Hardacre’s lascars took a Bugis alive on the brigantine’s quarter, and the man named you to the Bencoolen bench under the cane. The Court will hear of it. We are sorry for the work, sir, and you may consider yr. account with us closed for the present.

—`,
      changes: {
        reputation: { crown: -10, company: -5, pirates: -3 },
        rivalPressureModifierPush: { fromDay: s.day, lifetimeDays: 360, delta: 15 },
        flags: { sabotage_hardacre_resolved: 'failure' },
        journal: 'The strait went badly. Mr. Hardacre’s lascars took a Bugis alive at Bencoolen and the man named the right Factor.',
      },
    },
  };
  const branch = branches[outcome];
  return {
    id: 9510000 + s.day,
    from: 'A small voice in the strait',
    subject: branch.subject,
    body: branch.body,
    responses: [
      {
        label: 'So be it.',
        seed: `sabotage hardacre resolved: ${outcome}`,
        fixedOutcome: {
          prose: `The Factor reads the note twice and writes nothing in answer.`,
          changes: branch.changes,
        },
      },
    ],
    read: false,
  };
}

function makeSabotageTerBorchStep1Letter(s) {
  return {
    id: 9520000 + s.day,
    from: 'A discreet hand at the Rajah’s court',
    subject: 'A matter touching Mynheer ter Borch',
    body: `Sir, — The Vizier asks me to write on a matter of which the Court need not be told. The Heeren XVII at Batavia have a long file on Mynheer ter Borch already; a small additional paper, properly executed, would close his Eustace office for the duration of an inquiry. The forgery is the difficult part; the lodging of it is not.

The Vizier’s figure is seven hundred pounds for a clean matter, four hundred and fifty for a roughened one of less certain weight. The Factor will know which is the better trade.

— Yrs., respectfully.`,
    responses: [
      {
        label: 'Commission the clean matter (£700)',
        seed: 'commit; full method',
        fixedOutcome: {
          prose: `Seven hundred pounds in a sealed strongbox, conveyed by the Vizier’s own runner. The runner is gone before midnight. The matter is now with hands more practised than yr. own.`,
          changes: {
            money: -700,
            flags: { sabotage_terborch_method: 'commission', sabotage_terborch_committed_day: s.day },
            sabotagesCommitted: 1,
            journal: 'Paid £700 to the Vizier’s court for a customs forgery against Mynheer ter Borch. The matter is in train.',
            hook: 'A customs forgery is being lodged at Batavia against ter Borch. Word in five or six weeks.',
          },
        },
      },
      {
        label: 'Negotiate the roughened matter (£450)',
        seed: 'commit; negotiate method',
        fixedOutcome: {
          prose: `Four hundred and fifty pounds. The runner accepts the strongbox without comment, though the Factor reads in his face that the work will be the rougher for the price.`,
          changes: {
            money: -450,
            flags: { sabotage_terborch_method: 'negotiate', sabotage_terborch_committed_day: s.day },
            sabotagesCommitted: 1,
            journal: 'Paid £450 to the Vizier’s court for a roughened matter against ter Borch. The work will be the rougher for the price.',
            hook: 'A bargained-for forgery is being lodged at Batavia against ter Borch.',
          },
        },
      },
      {
        label: 'Decline the matter',
        seed: 'decline; arc closes',
        fixedOutcome: {
          prose: `You write back to the Vizier in measured terms, declining the offer with civilities. The runner is sent back without his strongbox. The matter is closed.`,
          changes: {
            flags: { sabotage_terborch_method: 'declined' },
            journal: 'Declined the Vizier’s offer of a customs forgery against Mynheer ter Borch.',
          },
        },
      },
    ],
    read: false,
  };
}

function makeSabotageTerBorchStep2Letter(s) {
  const method = s.flags?.sabotage_terborch_method;
  const outcome = resolveSabotage('terborch', s, { method });
  const branches = {
    success: {
      subject: 'A matter at Batavia',
      body: `Sir, — Mynheer ter Borch was carried out of Eustace under a Company guard of his own people, with sealed papers from the Heeren XVII and a nominal escort of his own pikes. The inquiry will sit at Batavia for the year and longer; we do not expect to see him return inside yr. charter. The Vizier sends his compliments.

— Yrs., discreetly.`,
      changes: {
        rivals: { terborch: { state: 'broken' } },
        rivalPressureModifierPush: { fromDay: s.day, lifetimeDays: 480, delta: -25 },
        reputation: { rajah: 3 },
        flags: { sabotage_terborch_resolved: 'success' },
        journal: 'Mynheer ter Borch was carried out of Eustace under a Company guard of his own people. The inquiry will sit at Batavia for the year.',
      },
    },
    partial: {
      subject: 'The Batavia bench was lenient',
      body: `Sir, — The inquiry sat. Mynheer ter Borch produced two Dutch witnesses of standing, and a small fine was set against him. He came back to Eustace at the spring monsoon, lighter in the purse and quieter in his manner; the Heeren XVII have not closed his file. — Yrs.`,
      changes: {
        rivals: { terborch: { state: 'troubled', standing: -15 } },
        rivalPressureModifierPush: { fromDay: s.day, lifetimeDays: 240, delta: -10 },
        flags: { sabotage_terborch_resolved: 'partial' },
        journal: 'ter Borch lost the spring before the Batavia bench. He came back lighter, but he came back.',
      },
    },
    failure: {
      subject: 'The forgery has come back to yr. door',
      body: `Sir, — The matter is undone. The forgery was traced — by what hand we cannot say — and the Heeren XVII have made representation through the Crown’s residency. Eustace is closed to yr. brigantine until the matter cools; the Vizier sends his regrets and his fee, returned in part. — Yrs.`,
      changes: {
        reputation: { dutch: -15, crown: -5 },
        rivalPressureModifierPush: { fromDay: s.day, lifetimeDays: 360, delta: 15 },
        flags: { sabotage_terborch_resolved: 'failure', banned_eustace_until: s.day + 90 },
        journal: 'The forgery came back to yr. door. Eustace is closed to yr. brigantine until the matter cools.',
      },
    },
  };
  const branch = branches[outcome];
  return {
    id: 9530000 + s.day,
    from: 'A discreet hand at the Rajah’s court',
    subject: branch.subject,
    body: branch.body,
    responses: [
      {
        label: 'So be it.',
        seed: `sabotage terborch resolved: ${outcome}`,
        fixedOutcome: {
          prose: `The Factor reads the note twice and writes nothing in answer.`,
          changes: branch.changes,
        },
      },
    ],
    read: false,
  };
}

function makeSabotageLowjiStep1Letter(s) {
  return {
    id: 9540000 + s.day,
    from: 'Mr. Cama, of Bombay (privately)',
    subject: 'On the standing of Mr. Lowji at the bills-of-exchange houses',
    body: `Sir, — I write privately, as the matter is one I would not wish put on Company paper. Mr. Lowji is over-extended at four of the bills-of-exchange houses in Bombay; were a coordinated recall to be made of his outstanding obligations, he would not be able to meet them, and the matter would close itself. The houses act for those who pay their introductions.

The figure for the full coordination is six hundred pounds; for a partial recall, four hundred. The Factor will weigh the matter.

— Yrs., respectfully, Cama.`,
    responses: [
      {
        label: 'Commission the full coordination (£600)',
        seed: 'commit; full method',
        fixedOutcome: {
          prose: `Six hundred pounds drawn on the Bombay credit, paid into Mr. Cama’s account by the next packet. The matter is set in motion at the houses; the Factor will hear in five or six weeks.`,
          changes: {
            money: -600,
            flags: { sabotage_lowji_method: 'commission', sabotage_lowji_committed_day: s.day },
            sabotagesCommitted: 1,
            journal: 'Paid £600 to Mr. Cama for a coordinated recall of Mr. Lowji’s bills at the Bombay houses. Word in five or six weeks.',
            hook: 'A coordinated loan-recall is being arranged against Lowji at the Bombay houses.',
          },
        },
      },
      {
        label: 'Negotiate a partial recall (£400)',
        seed: 'commit; negotiate method',
        fixedOutcome: {
          prose: `Four hundred pounds. Mr. Cama writes back briefly to confirm receipt; the matter is set in motion, though at the smaller scale.`,
          changes: {
            money: -400,
            flags: { sabotage_lowji_method: 'negotiate', sabotage_lowji_committed_day: s.day },
            sabotagesCommitted: 1,
            journal: 'Paid £400 to Mr. Cama for a partial recall against Mr. Lowji. Word in five or six weeks.',
            hook: 'A bargained-for loan-recall is being arranged against Lowji.',
          },
        },
      },
      {
        label: 'Decline the matter',
        seed: 'decline; arc closes',
        fixedOutcome: {
          prose: `You write back to Mr. Cama in courteous terms, declining the offer. He acknowledges briefly; the matter is closed.`,
          changes: {
            flags: { sabotage_lowji_method: 'declined' },
            journal: 'Declined Mr. Cama’s offer of a loan-recall against Mr. Lowji.',
          },
        },
      },
    ],
    read: false,
  };
}

function makeSabotageLowjiStep2Letter(s) {
  const method = s.flags?.sabotage_lowji_method;
  const outcome = resolveSabotage('lowji', s, { method });
  const branches = {
    success: {
      subject: 'Mr. Lowji has gone home to Surat',
      body: `Sir, — The Bombay correspondents called Mr. Lowji’s papers all in one fortnight. He could not pay; his fleet was scattered across three monsoons and his factors at Calicut and Mocha could not move their stock fast enough. The man has gone home to Surat to sit with his family. The matter is concluded.

— Yrs., respectfully, Cama.`,
      changes: {
        rivals: { lowji: { state: 'broken' } },
        rivalPressureModifierPush: { fromDay: s.day, lifetimeDays: 480, delta: -25 },
        reputation: { company: 3 },
        flags: { sabotage_lowji_resolved: 'success' },
        journal: 'The Bombay houses called Mr. Lowji’s papers all in one fortnight. He has gone home to Surat.',
      },
    },
    partial: {
      subject: 'Mr. Lowji has sold off two bottoms',
      body: `Sir, — The matter went part-way. Mr. Lowji liquidated two of his bottoms at Bombay to clear his bills, and kept his third in service. He is the smaller man, though not yet the broken one. — Cama.`,
      changes: {
        rivals: { lowji: { state: 'troubled', standing: -10 } },
        rivalPressureModifierPush: { fromDay: s.day, lifetimeDays: 240, delta: -8 },
        flags: { sabotage_lowji_resolved: 'partial' },
        journal: 'Mr. Lowji sold off two bottoms at Bombay to clear his bills. He kept the third.',
      },
    },
    failure: {
      subject: 'A matter undone, with consequences',
      body: `Sir, — My hand was seen at the bills-of-exchange houses, by parties of standing whose discretion I had over-estimated. The Bombay correspondents have collectively called two hundred pounds in outstanding obligations against yr. account, by way of demonstrating their displeasure. I am sorry for the work; the matter is concluded for both of us. — Cama.`,
      changes: {
        money: -200,
        reputation: { company: -8 },
        rivalPressureModifierPush: { fromDay: s.day, lifetimeDays: 360, delta: 15 },
        flags: { sabotage_lowji_resolved: 'failure' },
        journal: 'Cama’s hand was seen at the bills-of-exchange houses. The Bombay correspondents have called £200 in outstanding obligations.',
      },
    },
  };
  const branch = branches[outcome];
  return {
    id: 9550000 + s.day,
    from: 'Mr. Cama, of Bombay (privately)',
    subject: branch.subject,
    body: branch.body,
    responses: [
      {
        label: 'So be it.',
        seed: `sabotage lowji resolved: ${outcome}`,
        fixedOutcome: {
          prose: `The Factor reads the note twice and writes nothing in answer.`,
          changes: branch.changes,
        },
      },
    ],
    read: false,
  };
}

// Rival-event template pool. Populated in Phase 6. The scheduler in
// tickDays handles the empty-pool case gracefully (pickRivalEvent
// returns null).
const RIVAL_EVENTS = [
  // ─── HARDACRE EVENTS (6) ────────────────────────────────────────────
  {
    key: 'hardacre-fire',
    rival: 'hardacre',
    minDay: 180, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: -20,
    standingAfter: 'troubled',
    pressureDelta: -10,
    pressureLifetime: 60,
    priceWindow: { port: 'Kota Pinang', commodity: 'pepper', sellMult: 1.25, days: 60, label: 'the fire at Hardacre\u2019s godown' },
    build: (s, opts) => ({
      id: 9405000 + s.day,
      from: 'A correspondent, by the next packet',
      subject: 'News of Bencoolen',
      body: opts.anticipated
        ? `Sir, — As you anticipated. A fire at the Bencoolen godowns, three days back, has cost Mr. Hardacre the better part of his pepper stock for the season. The Court will hear of it within the fortnight; the strait, you have heard already.\n\nYr. obedt. servant.`
        : `Sir, — There is news from Bencoolen, of which the Court does not yet know. A fire at Mr. Hardacre's godowns, three days back, has cost him the better part of his pepper stock for the season. The Court will hear within the fortnight.\n\nYr. obedt. servant.`,
      responses: [
        {
          label: 'Reroute the brigantine to Bencoolen with what pepper we have',
          seed: 'arbitrage; lay hands on the price',
          fixedOutcome: {
            prose: 'The brigantine is laid for Bencoolen at the next favourable wind. The price of pepper in those quarters has risen by the fact of the fire; the Factor positions his hold accordingly.',
            changes: { journal: 'Rerouted the brigantine to Bencoolen on news of Hardacre\'s fire. The pepper price spike will reward the Factor who is first.' },
          },
        },
        {
          label: 'Note it; press on with the present quarter',
          seed: 'no action; private satisfaction',
          fixedOutcome: {
            prose: 'You set the news aside. The Court will hear when the Court hears.',
            changes: { journal: 'Heard of Hardacre\'s misfortune at Bencoolen. We shall press on with the present quarter.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'hardacre-windfall',
    rival: 'hardacre',
    minDay: 240, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: 12,
    standingAfter: 'rising',
    pressureDelta: 10, pressureLifetime: 90,
    build: (s, opts) => ({
      id: 9400100 + s.day,
      from: 'The Court of Directors',
      subject: 'A note in passing',
      body: opts.anticipated
        ? `Sir, — As you had been forewarned. Mr. Hardacre at Bencoolen has had a quarter of which the Court speaks favourably — a Bugis cargo of cinnamon, salvaged from a wreck at Engano, the proceeds of which weight against you in the present comparison.\n\nYr. servants, the Court of Directors.`
        : `Sir, — In the last quarter, Mr. Hardacre at Bencoolen has had a windfall — a cargo of cinnamon, salvaged from a wreck at Engano, which weights against you in the present comparison. We do not press the matter — only note that the present figures favour his station.\n\nYr. servants, the Court of Directors.`,
      responses: [
        {
          label: 'Note it; press on',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside.',
            changes: { journal: 'Hardacre had a windfall at Engano. The Court is, at present, in his favour.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'hardacre-clerk-defect',
    rival: 'hardacre',
    minDay: 360, maxDay: 900,
    preconditions: (s) => (s.rivals?.hardacre?.standing ?? 50) <= 35,
    standingDelta: -8,
    standingAfter: 'troubled',
    pressureDelta: -8, pressureLifetime: 60,
    build: (s, opts) => ({
      id: 9400200 + s.day,
      from: 'Mr. Reginald Penhaligon, Junior Writer',
      subject: 'A request for employment',
      body: `Sir, — I write directly, at the suggestion of Mr. Tyler of the Madras establishment with whom I am acquainted. I am at present junior writer in the Bencoolen establishment under Mr. Hardacre, a post which I no longer find — for reasons I shall not put down upon paper — agreeable to my situation.\n\nI write upon yr. office because the Bayan-Kor establishment is reckoned by the Madras gentlemen as a station where industry is rewarded. My present wage at Bencoolen is £36 per annum; I should not press for more than yr. office finds reasonable.\n\nYr. obedt. and humble servant,\nReginald Penhaligon`,
      responses: [
        {
          label: 'Hire him at £36/year; the household is the better for it',
          seed: 'hire penhaligon; new acquaintance',
          fixedOutcome: {
            prose: 'You write Mr. Penhaligon a careful letter of engagement, with the £36/year wage offered against an annual review. He arrives by the next packet — a sober, careful young man of three-and-twenty, with a hand fair enough that Hodge says nothing against him.',
            changes: {
              money: -10,
              journal: 'Engaged Mr. Reginald Penhaligon, late of Bencoolen, as a junior writer. £36/year on review.',
              newAcquaintances: [
                { name: 'Mr. Reginald Penhaligon', role: 'Junior Writer', location: 'Bayan-Kor', notes: 'Defected from Hardacre\'s establishment at Bencoolen. Sober, careful, fair hand. — Cousin to the apprentice writer Mr. Penhaligon already in the household.' },
              ],
            },
          },
        },
        {
          label: 'Decline; the household is full enough',
          seed: 'decline cleanly',
          fixedOutcome: {
            prose: 'You write a courteous decline. Mr. Penhaligon, by report, takes a post at Madras instead; we hear of him no more.',
            changes: { journal: 'Declined Mr. Penhaligon\'s application. The household is full enough.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'hardacre-pilot-lost',
    rival: 'hardacre',
    minDay: 300, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: -10,
    pressureDelta: -8, pressureLifetime: 45,
    priceWindow: { port: 'Kota Pinang', commodity: 'cinnamon', sellMult: 1.15, days: 45, label: 'Hardacre\u2019s grounded shipping' },
    build: (s, opts) => ({
      id: 9400300 + s.day,
      from: 'Capt. Thomas Faulke, of the Albatross',
      subject: 'A matter from the strait',
      body: opts.anticipated
        ? `Sir, — As foretold. Mr. Hardacre's chief pilot, Bugis, has been pressed into service by the Royal Navy at Trincomalee for an Indian Ocean station. Bencoolen is, for the present quarter, navigating with green hands.`
        : `Sir, — A matter for yr. ear. Mr. Hardacre's chief pilot — a Bugis whose name I shall not write — has been pressed into Royal Navy service at Trincomalee. Bencoolen will navigate with green hands until a replacement is found, which will not be quickly.`,
      responses: [
        {
          label: 'Note it; trust will follow Faulke for the news',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You make a note in the household book.',
            changes: { journal: 'Hardacre has lost his chief pilot to the Navy. Bencoolen sails on green hands.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'hardacre-court-favour',
    rival: 'hardacre',
    minDay: 480, maxDay: 1080,
    preconditions: (s) => (s.rivals?.hardacre?.standing ?? 50) >= 55,
    standingDelta: 15,
    standingAfter: 'rising',
    pressureDelta: 12, pressureLifetime: 90,
    build: (s, opts) => ({
      id: 9400400 + s.day,
      from: 'The Court of Directors',
      subject: 'A note of relative standing',
      body: `Sir, — Mr. Hardacre at Bencoolen has been the recipient, this quarter, of a private commendation from the Chairman, on the strength of his returns. We do not press the comparison. We note only that the Chairman's regard, once given, is not lightly transferred.\n\nYr. servants, the Court of Directors.`,
      responses: [
        {
          label: 'Note it; press on',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside.',
            changes: { journal: 'Hardacre has the Chairman\'s private regard. We must do better than the present quarter.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'hardacre-scandal',
    rival: 'hardacre',
    minDay: 540, maxDay: 1080,
    preconditions: (s) => (s.rivals?.hardacre?.standing ?? 50) <= 30,
    standingDelta: -20,
    standingAfter: 'broken',
    pressureDelta: -15, pressureLifetime: 90,
    build: (s, opts) => ({
      id: 9400500 + s.day,
      from: 'The Court of Directors',
      subject: 'A grave matter at Bencoolen',
      body: `Sir, — A grave matter at Bencoolen has come before the Court. Mr. Hardacre is summoned home upon the next Indiaman to answer the matter at Leadenhall, and a successor is to be named in the interval. The comparison, which has weighted hard against you these quarters past, is now removed from yr. file. We trust this finds yr. station in good order, and yr. quarter's returns the equal of expectation.\n\nYr. servants, the Court of Directors.`,
      responses: [
        {
          label: 'Note it; press on',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside. The Bencoolen seat is, for the moment, vacant.',
            changes: { journal: 'Hardacre is summoned home in disgrace. The Court\'s comparison no longer weights against me.' },
          },
        },
      ],
      read: false,
    }),
  },

  // ─── TER BORCH EVENTS (6) ───────────────────────────────────────────
  {
    key: 'terborch-customs-spat',
    rival: 'terborch',
    minDay: 200, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: -8,
    pressureDelta: -5, pressureLifetime: 45,
    priceWindow: { port: 'Port St. Eustace', commodity: 'sandalwood', buyMult: 1.15, days: 45, label: 'the Dutch customs quarrel' },
    build: (s, opts) => ({
      id: 9410000 + s.day,
      from: 'Mynheer Hendrik Boom',
      subject: 'A matter at the customs',
      body: opts.anticipated
        ? `Sir, — As you had been told. The customs at Eustace are at odds with Mynheer ter Borch this fortnight, over a cargo of sandalwood; he is for the moment occupied. Trade may be had at a smaller fee than is usual, by those who can move quickly.`
        : `Sir, — The customs at Eustace are at odds with Mynheer ter Borch this fortnight, over a cargo of sandalwood. The matter is small but not nothing — and trade may be had, at present, at a smaller fee than is usual.\n\nYr. obedt. servant,\nBoom`,
      responses: [
        {
          label: 'Note it; the next visit shall be a profitable one',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You make a private note. The Hollanders\' difficulties, occasionally, are the Englishman\'s opportunity.',
            changes: { journal: 'Boom writes that ter Borch is at odds with the customs at Eustace. A small window for sandalwood.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'terborch-promotion-attempted',
    rival: 'terborch',
    minDay: 360, maxDay: 900,
    preconditions: (s) => !(s.rivals?.terborch?.eventsFired?.includes('terborch-scandal')),
    standingDelta: 10,
    standingAfter: 'rising',
    pressureDelta: 6, pressureLifetime: 60,
    build: (s, opts) => ({
      id: 9410100 + s.day,
      from: 'Mynheer Hendrik Boom',
      subject: 'A whisper from the High Government',
      body: `Sir, — There is talk that Mynheer ter Borch is named for an advance — a station at Batavia, perhaps, or a deputy\'s seat at the Council of the Indies. The matter is not settled; but the wind from Amsterdam is in his sail.\n\nYr. obedt. servant,\nBoom`,
      responses: [
        {
          label: 'Note it; the High Government may yet take him from us',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the matter aside. Whether ter Borch goes east or stays at Eustace, the Factor presses on with his charter.',
            changes: { journal: 'Boom writes that ter Borch is named for advance — Batavia or the Council of the Indies. The matter is not settled.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'terborch-scandal',
    rival: 'terborch',
    minDay: 480, maxDay: 1080,
    preconditions: (s) => (s.rivals?.terborch?.standing ?? 50) <= 35,
    standingDelta: -15,
    standingAfter: 'troubled',
    pressureDelta: -10, pressureLifetime: 75,
    build: (s, opts) => ({
      id: 9410200 + s.day,
      from: 'A correspondent, by the next Indiaman',
      subject: 'A matter at Eustace',
      body: `Sir, — A matter has come to the High Government concerning Mynheer ter Borch — the Brotherhood matter, as it is called in the back rooms — of a kind which does not invite open discussion. He is summoned to Batavia for an interview at the Council. The matter may yet be cleared; or not. — Yr. obedt. servant.`,
      responses: [
        {
          label: 'Note it; the Hollanders\' troubles are not the Factor\'s',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside. The Council at Batavia is, in such matters, slow but not unconcerned.',
            changes: { journal: 'Ter Borch is summoned to Batavia for an interview. The Hollanders\' troubles are not the Englishman\'s — yet.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'terborch-clerk-defect',
    rival: 'terborch',
    minDay: 360, maxDay: 900,
    preconditions: (s) => (s.rivals?.terborch?.standing ?? 50) <= 35,
    standingDelta: -8,
    pressureDelta: -6, pressureLifetime: 45,
    build: (s, opts) => ({
      id: 9410300 + s.day,
      from: 'Mynheer Cornelis de Witt, Secretary',
      subject: 'A matter of employment',
      body: `Sir, — I am at present secretary at Mynheer ter Borch\'s establishment at Eustace, a position which has become — by reasons of recent disagreement — no longer agreeable to my situation. I write upon yr. office because the Bayan-Kor establishment is reckoned by the Hollanders themselves as a station where Dutch industry is not held against the man.\n\nMy present wage is forty guilders the month; I should not press for more in pounds than yr. office finds proper.\n\nYr. obedt. servant,\nCornelis de Witt`,
      responses: [
        {
          label: 'Hire him; a Dutch hand is useful at Eustace',
          seed: 'hire de witt; new acquaintance',
          fixedOutcome: {
            prose: 'You engage Mynheer de Witt at £40 per annum, payable quarterly. He arrives by the next Eustace packet — a thin, careful man of perhaps thirty, with a hand which writes Dutch and English with equal facility.',
            changes: {
              money: -8,
              journal: 'Engaged Mynheer Cornelis de Witt as secretary, late of ter Borch\'s establishment. £40/year, paid quarterly.',
              newAcquaintances: [
                { name: 'Mynheer Cornelis de Witt', role: 'Secretary', location: 'Bayan-Kor', notes: 'Defected from ter Borch\'s establishment. Bilingual (Dutch + English); thirty; careful.' },
              ],
            },
          },
        },
        {
          label: 'Decline; a Hollander in the household is a complication',
          seed: 'decline; small dutch -',
          fixedOutcome: {
            prose: 'You decline by note. Mynheer de Witt takes ship for Amsterdam, by report, and his use to either establishment is at an end.',
            changes: {
              reputation: { dutch: -2 },
              journal: 'Declined de Witt\'s application. A Hollander in the household was a complication.',
            },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'terborch-trade-pass-revocation',
    rival: 'terborch',
    minDay: 540, maxDay: 1080,
    preconditions: (s) => s.flags?.dutchTradePass === true && (s.rivals?.terborch?.standing ?? 50) >= 65,
    standingDelta: 10,
    standingAfter: 'rising',
    pressureDelta: 10, pressureLifetime: 60,
    build: (s, opts) => ({
      id: 9410400 + s.day,
      from: 'Mynheer ter Borch, formally',
      subject: 'A revision of yr. trade pass',
      body: `Sir, — I am instructed by the High Government to revise the trade passes granted by my junior at Eustace to certain English servants in the strait. The pass which yr. office holds is, with my regret, henceforth halved in its application — fifty per cent. of its former privilege. The matter is not personal; it is the run of administration.\n\nYr. obedt. servant,\nter Borch`,
      responses: [
        {
          label: 'Acknowledge; the matter is the run of administration',
          seed: 'acknowledge; trade pass weakened',
          fixedOutcome: {
            prose: 'You write a courteous acknowledgement. The duty at Eustace is, henceforth, only one-quarter halved instead of fully halved — a small but real material loss.',
            changes: {
              flags: { dutchTradePassReduced: true },
              journal: 'Ter Borch revises the trade pass. Eustace duties are no longer fully halved; the privilege is reduced.',
            },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'terborch-glut',
    rival: 'terborch',
    minDay: 240, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: -5,
    pressureDelta: -4, pressureLifetime: 30,
    priceWindow: { port: 'Port St. Eustace', commodity: 'silver', buyMult: 1.10, days: 30, label: 'ter Borch\u2019s interrupted silver trade' },
    build: (s, opts) => ({
      id: 9410500 + s.day,
      from: 'Mynheer Hendrik Boom',
      subject: 'A small matter at the warehouses',
      body: `Sir, — Mynheer ter Borch\'s silver consignment, this fortnight, has run heavier than the warehouses can hold; he is for the moment selling silver below the customary mark. The matter does not last — perhaps a month. — Yr. obedt. servant, Boom`,
      responses: [
        {
          label: 'Note it; the next visit to Eustace shall be a buyer\'s',
          seed: 'arbitrage',
          fixedOutcome: {
            prose: 'A small private note in the household book.',
            changes: { journal: 'Ter Borch is over-supplied of silver at Eustace. A month of buyer\'s prices.' },
          },
        },
      ],
      read: false,
    }),
  },

  // ─── LOWJI EVENTS (6) ───────────────────────────────────────────────
  {
    key: 'lowji-cargo-lost',
    rival: 'lowji',
    minDay: 200, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: -15,
    standingAfter: 'troubled',
    pressureDelta: -7, pressureLifetime: 60,
    priceWindow: { port: 'Bayan-Kor', commodity: 'calico', buyMult: 0.85, days: 60, label: 'Lowji\u2019s lost cargo' },
    build: (s, opts) => ({
      id: 9420000 + s.day,
      from: 'Mr. Pestonji Cama',
      subject: 'A matter from Bombay',
      body: opts.anticipated
        ? `Sir, — As foretold. Mr. Lowji\'s brigantine, the Hormuzd, has been lost in a squall off the Konkan, with the better part of the season\'s calico. The Bombay houses are, for the moment, supplying calico into the bay at prices the Englishman may turn to advantage.`
        : `Sir, — News from the bay. Mr. Lowji Nusserwanji has lost the Hormuzd, in a squall off the Konkan coast — a brigantine and the better part of his calico for the season. The Bombay houses redirect their supply through Bayan-Kor at less than the customary price for some weeks.\n\nYr. obedt. servant,\nCama`,
      responses: [
        {
          label: 'Buy calico aggressively while the price holds',
          seed: 'arbitrage',
          fixedOutcome: {
            prose: 'You direct Hodge to lay in calico beyond the customary mark, against the future quarter when the price will return.',
            changes: { journal: 'Lowji has lost the Hormuzd; Cama writes from Bombay. Hodge laying in calico against the season\'s return.' },
          },
        },
        {
          label: 'Note it; the present hold is full enough',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside.',
            changes: { journal: 'Lowji has lost the Hormuzd. The hold is full enough; the bay\'s prices we leave for another quarter.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'lowji-windfall',
    rival: 'lowji',
    minDay: 240, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: 12,
    standingAfter: 'rising',
    pressureDelta: 8, pressureLifetime: 60,
    build: (s, opts) => ({
      id: 9420100 + s.day,
      from: 'Mr. Pestonji Cama',
      subject: 'A small note of standing',
      body: opts.anticipated
        ? `Sir, — As you had been told. Mr. Lowji has secured a contract with the Surat Mughal customs — opium licence in country trade for the season. The bay houses are full of his name.`
        : `Sir, — A matter of small significance, perhaps: Mr. Lowji Nusserwanji has secured an opium licence under the Surat Mughal customs for the present season. The Bombay houses speak of him in the warmer language of country trade.\n\nYr. obedt. servant,\nCama`,
      responses: [
        {
          label: 'Note it; press on',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside.',
            changes: { journal: 'Lowji has the Surat opium licence. The Bombay houses speak well of him.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'lowji-pilot-defect',
    rival: 'lowji',
    minDay: 360, maxDay: 900,
    preconditions: (s) => (s.rivals?.lowji?.standing ?? 50) <= 35,
    standingDelta: -10,
    pressureDelta: -6, pressureLifetime: 45,
    build: (s, opts) => ({
      id: 9420200 + s.day,
      from: 'Capt. Thomas Faulke, of the Albatross',
      subject: 'A pilot for the strait',
      body: `Sir, — There is in Bayan-Kor at present, looking for employment, one Khojah Avedik — a Persian pilot of fifteen years\' service in the bay, late of Mr. Lowji\'s establishment at Bombay. He left under circumstances of which I do not write upon paper. He knows the strait between here and Macao as a man knows his own door.\n\nHe asks £80 per annum, with the use of a clerk to keep his accounts in English. I should not press the matter, but I have seen his hand at the wheel myself, and the matter recommends itself.\n\nYr. obedt. servant,\nFaulke`,
      responses: [
        {
          label: 'Hire him at £80/year; a Persian pilot is no small thing',
          seed: 'hire avedik; new acquaintance',
          fixedOutcome: {
            prose: 'You write Faulke a note authorising the engagement. Khojah Avedik is brought to the household by the next packet — a thin, dignified, careful man, who speaks English with the formality of his Bombay schooling. The strait, henceforth, is read by a hand that knows it.',
            changes: {
              money: -20,
              journal: 'Engaged Khojah Avedik as pilot, late of Mr. Lowji\'s. £80/year. The strait is the household\'s now in a way it was not.',
              newAcquaintances: [
                { name: 'Khojah Avedik', role: 'Pilot', location: 'Bayan-Kor', notes: 'Persian pilot, fifteen years in the bay, late of Mr. Lowji\'s Bombay establishment. £80/year. Knows the strait to Macao.' },
              ],
            },
          },
        },
        {
          label: 'Decline; £80 is a great wage for a hand at the wheel',
          seed: 'decline cleanly',
          fixedOutcome: {
            prose: 'You decline by note. Khojah Avedik, by report, takes a post with the Hollanders at Eustace within the fortnight.',
            changes: { journal: 'Declined Avedik\'s application. £80 was the price of a private pilot.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'lowji-rumour',
    rival: 'lowji',
    minDay: 300, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: 5,
    pressureDelta: 4, pressureLifetime: 30,
    build: (s, opts) => ({
      id: 9420300 + s.day,
      from: 'Mr. Pestonji Cama',
      subject: 'A small rumour from Bombay',
      body: `Sir, — A rumour, of which I take no certainty: Mr. Lowji is said to be building a new shipyard at Mazagon, on the Bombay establishment\'s western water. If the matter is true, his standing in country trade is materially the larger for it.\n\nYr. obedt. servant,\nCama`,
      responses: [
        {
          label: 'Note the rumour; press on',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You make a private note.',
            changes: { journal: 'Cama writes of a Lowji shipyard at Mazagon. The matter, if true, places him further ahead.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'lowji-glut',
    rival: 'lowji',
    minDay: 240, maxDay: 720,
    preconditions: (s) => true,
    standingDelta: -5,
    pressureDelta: -3, pressureLifetime: 30,
    priceWindow: { port: 'Bayan-Kor', commodity: 'calico', buyMult: 0.85, days: 30, label: 'Lowji\u2019s calico glut' },
    build: (s, opts) => ({
      id: 9420400 + s.day,
      from: 'Mr. Pestonji Cama',
      subject: 'A glut at Bombay',
      body: `Sir, — The Bombay houses are at present over-supplied of calico — Mr. Lowji has shipped against an expected market that has not materialised. Bombay calico is, this month, at the cheaper price; the matter is not material to yr. station, but the Factor may wish to know.\n\nYr. obedt. servant,\nCama`,
      responses: [
        {
          label: 'Note it; if a sale at Bayan-Kor presents itself, hold for next month',
          seed: 'arbitrage hint',
          fixedOutcome: {
            prose: 'You make a private note. The Bayan-Kor calico price will be the softer for some weeks.',
            changes: { journal: 'Cama writes of a calico glut at Bombay. Hold the household stock against the next quarter.' },
          },
        },
      ],
      read: false,
    }),
  },
  {
    key: 'lowji-bankruptcy-rumour',
    rival: 'lowji',
    minDay: 540, maxDay: 1080,
    preconditions: (s) => (s.rivals?.lowji?.standing ?? 50) <= 25,
    standingDelta: -25,
    standingAfter: 'broken',
    pressureDelta: -12, pressureLifetime: 90,
    build: (s, opts) => ({
      id: 9420500 + s.day,
      from: 'Mr. Pestonji Cama',
      subject: 'A grave rumour from Bombay',
      body: `Sir, — A grave rumour, which I record only because I am called upon to record what I hear. Mr. Lowji Nusserwanji\'s establishment is said to be over-extended in the season\'s voyages, and the bills he has written against the Surat customs are said to be coming back protested. If the matter is as the bay houses describe, his establishment will not see out the year.\n\nI do not write upon this matter again unless it confirms.\n\nYr. obedt. servant,\nCama`,
      responses: [
        {
          label: 'Note it; the matter is grave',
          seed: 'no action',
          fixedOutcome: {
            prose: 'You set the news aside, in the careful way a Factor sets aside news of another man\'s ruin.',
            changes: { journal: 'Cama writes that Lowji\'s establishment may not see out the year. A grave matter, if it confirms.' },
          },
        },
      ],
      read: false,
    }),
  },
];

// ─────────── CHARTER-END LETTER ───────────
// At day 0 the Court closes the file. The letter the Director writes is
// templated by completeness — three tonal variants. Returns both the
// letter object and the outcome key for the closure record.

function evalCharterOutcome(s) {
  const pep = (s.quotas?.pepper?.have   || 0);
  const cin = (s.quotas?.cinnamon?.have || 0);
  const pepNeed = (s.quotas?.pepper?.needed   || 400);
  const cinNeed = (s.quotas?.cinnamon?.needed || 200);
  const ratio = (pep / pepNeed + cin / cinNeed) / 2;
  if (pep >= pepNeed && cin >= cinNeed) return 'success';
  if (ratio >= 0.65) return 'partial';
  return 'failure';
}

// The Factor's destiny at the close of his charter, drawn from accumulated
// state: which factions were served, which patrons earned, which paths
// chosen. Returns one of eight keys. Priority rules:
//
//   brotherhood-retirement: pirates >= +30, brotherhoodCompact held, Crown
//     standing burned (<= 0). The Factor has thrown in with the company
//     he kept.
//   crown-knighthood: Crown >= +30, outcome >= partial, no compact. His
//     Majesty notices an enterprising Factor.
//   country-estate: Mountfair patron held, outcome >= partial. Lord
//     Mountfair has set aside an estate.
//   bayan-kor-seat: Rajah >= +30, outcome >= partial. The Vizier offers
//     the post of English Resident at the palace.
//   merchant-prince: >= 3 established ventures, any quota outcome. A house of
//     yr. own — home a merchant of substance on what you built, not what the
//     Court gave. Ranks below the patron endings, above the by-outcome ones.
//   senior-factor: outcome === 'success' default — a second charter at
//     more agreeable terms.
//   quiet-retirement: outcome === 'partial' default — the Factor goes
//     home with what he has.
//   recall-disgrace: outcome === 'failure' — the Court calls him back.
function evalCharterDestiny(s) {
  const outcome  = evalCharterOutcome(s);
  const crown    = s.reputation?.crown  || 0;
  const pirates  = s.reputation?.pirates || 0;
  const rajah    = s.reputation?.rajah  || 0;
  const compact  = !!s.flags?.brotherhoodCompact;
  const mountfair = s.flags?.mountfairPatron === true;

  // Brotherhood retirement: the strongest pirate-aligned ending. Beats all
  // others if the Factor has fully thrown in with the Brotherhood. Quota
  // outcome doesn't apply — they don't care about the Court's books.
  if (pirates >= 30 && compact && crown <= 0) return { outcome, destiny: 'brotherhood-retirement' };

  // Knighthood requires Crown standing AND no compact (His Majesty does not
  // confer honours upon men who have privately treated with the Brotherhood).
  if (crown >= 30 && !compact && outcome !== 'failure') return { outcome, destiny: 'crown-knighthood' };

  // Country estate via Mountfair's patronage.
  if (mountfair && outcome !== 'failure') return { outcome, destiny: 'country-estate' };

  // Bayan-Kor seat — the Resident posting via the Vizier.
  if (rajah >= 30 && outcome !== 'failure') return { outcome, destiny: 'bayan-kor-seat' };

  // Merchant prince — a house of yr. own. The Factor who built a sprawling
  // concern goes home a merchant of substance on the strength of what HE built,
  // not what the Court gave him. Gated on a real enterprise (>=3 established
  // ventures); deliberately NOT gated on quota success — his fortune is on his
  // own account, not the Company's books. Ranks below the four faction-patron
  // endings (a claimed patron is the truer ending) but above the Court's
  // by-outcome defaults, so it can lift even a partial/failed quota into a
  // genuine alternative life.
  if (establishedVentureCount(s.ventures) >= 3) return { outcome, destiny: 'merchant-prince' };

  // Defaults by outcome.
  if (outcome === 'success') return { outcome, destiny: 'senior-factor' };
  if (outcome === 'partial') return { outcome, destiny: 'quiet-retirement' };
  return { outcome, destiny: 'recall-disgrace' };
}

function makeCharterEndLetter(s) {
  const { outcome, destiny } = evalCharterDestiny(s);
  const totalPep  = Math.floor(s.quotas?.pepper?.have   || 0);
  const totalCin  = Math.floor(s.quotas?.cinnamon?.have || 0);
  const reckoning = `${totalPep} cwt of pepper and ${totalCin} cwt of cinnamon stand to yr. account`;

  let subject, body, from;
  switch (destiny) {
    case 'crown-knighthood':
      from = 'The Court of Directors, with His Majesty\'s pleasure';
      subject = 'Yr. Charter Concluded — and a Notice from the King';
      body = `Sir, — The third year is upon us. ${reckoning}, the obligation discharged with credit and the file at this House closed in yr. favour.

We are instructed by the Standing Committee, with His Majesty\'s pleasure, to advise you that you are appointed Knight Bachelor by His Royal pen, in recognition of yr. services to the Crown in matters of intelligence and the suppression of the Brotherhood in the strait. The patent will be conferred upon yr. arrival at Whitehall.

A second charter is at yr. discretion. We hope, as the Court hopes, that yr. next venture is at the harder yardstick of a man who has shown what may be done at Bayan-Kor.

Yr. obedt. servants, the Court of Directors.`;
      break;

    case 'country-estate':
      from = 'The Court of Directors, by Lord Mountfair\'s arrangement';
      subject = 'Yr. Charter Concluded — and a Hellingly note enclosed';
      body = `Sir, — The third year is up. ${reckoning}; the obligation is met at the figure the Court has hoped for, and yr. file is closed in yr. favour.

His Lordship Mountfair has, by separate cover, enclosed terms of an estate at Hellingly in Sussex which he has set aside upon yr. account. The lease is yrs. on landing; the rents from the home farm shall come to yr. own steward. The Court extends its concurrence to the arrangement, in such terms as the Standing Committee can frame in writing.

A second charter will be offered should you wish, but the country gentleman\'s life is by all accounts the kinder one.

Yr. obedt. servants, the Court of Directors.`;
      break;

    case 'bayan-kor-seat':
      from = 'The Court of Directors, with the Rajah\'s petition enclosed';
      subject = 'Yr. Charter Concluded — and an Offer from the Palace';
      body = `Sir, — The third year is closed. ${reckoning}. The reckoning is honourable, the office well held.

There is an unusual matter laid before the Standing Committee in yr. case. His Highness the Rajah has formally petitioned the Court that you be permitted to remain at Bayan-Kor as English Resident, with letters patent and a stipend of one hundred and fifty pounds per annum on the Company\'s account. The Vizier has appended a separate memorial of yr. service to the Rajah\'s establishment.

This is irregular but not unprecedented. The Court is content to let you decide. A second charter is the alternative.

Yr. obedt. servants, the Court of Directors.`;
      break;

    case 'brotherhood-retirement':
      from = 'Capt. Gerrit Maas, of the Brotherhood';
      subject = 'No Indiaman this season';
      body = `Sir, — There is no Indiaman, sir. There has not been one expected for some time, and the Court of Directors will, at this hand, be writing to a successor and not to you.

You have chosen yr. company. The Pelican\'s Nest has a small house above the cove, presently empty, that we shall make over to you upon application. The Brotherhood does not pretend to confer titles, but it does extend a roof and a name and what passes among the captains for hospitality.

The Court will think you dead, in due course; we shall not contradict them.

Yr. obedt. servant in yr. new station,
Gerrit Maas`;
      break;

    case 'merchant-prince': {
      const w = enterpriseWorth(s);
      from = 'Mr. Josiah Tench, yr. agent in London';
      subject = 'Yr. Accounts Made Up — and a Word on Coming Home';
      body = `Sir, — I have made up yr. accounts against the close of the charter, and I send them with more satisfaction than I am used to feel in this work.

The whole of yr. concern — the strongbox, the goods lodged at Bayan-Kor, the buildings raised, the vessel, and the ventures entered to yr. name — I value at not less than £${w.total.toLocaleString()}. It is a house of yr. own, sir, built by yr. own hand and standing on no man's favour but the market's. There are gentlemen at the 'Change with less to their name and a coach besides.

The Court will offer you a second charter, as it offers every man whose file closes clean; but you have no longer any great need of them. A merchant of substance comes home when he pleases and answers to no Standing Committee. I have taken the liberty of enquiring after a house near the Bristol quays, should the notion sit well with you.

Yr. obedt. and faithful agent,
Josiah Tench, of Mincing Lane.`;
      break;
    }

    case 'senior-factor':
      from = 'The Court of Directors, London';
      subject = 'Yr. Charter Honourably Concluded';
      body = `Sir, — The third year is upon us, and the file at this House is closed in yr. favour. ${reckoning}, the obligation discharged in full.

The Court is well pleased. A second charter will be offered to you in the next packet, with terms more agreeable to a man who has shown what may be done at Bayan-Kor. Yr. tenth of net returns shall be lodged with yr. London agent by Lady Day.

Yr. obedt. servants, the Court of Directors.`;
      break;

    case 'quiet-retirement':
      from = 'The Court of Directors, London';
      subject = 'On the Closing of Yr. Charter';
      body = `Sir, — The third year is up. The reckoning stands at ${totalPep}/400 pepper and ${totalCin}/200 cinnamon. The obligation is not discharged in full and we cannot pretend it is.

We do not propose to despatch a successor at present. There are, in this latitude, harder posts than yours and easier; you are now of an age to know which is which. We expect a written account of the difficulties, of yr. own pen, by the next homeward Indiaman.

Yr. servants, the Court of Directors.`;
      break;

    case 'recall-disgrace':
    default:
      from = 'The Court of Directors, London';
      subject = 'Yr. Recall, by the Next Packet';
      body = `Sir, — The third year is closed. We have ${totalPep} cwt of pepper and ${totalCin} cwt of cinnamon out of yr. station against an obligation we set in plain terms three years gone. The Court will not pretend at further patience.

A successor is despatched by the Indiaman next outbound. You will deliver yr. books, yr. keys, and yr. seals to him upon his landing, and take passage home in his place. The matter of yr. tenth is referred to the Standing Committee. Mr. Wilbraham's bones are in the chapel-yard at Bayan-Kor; you have at least the option of the next packet.

Yr. servants, the Court of Directors.`;
      break;
  }

  // Sabotage coda: hint at the rougher matters of the past three years
  // when the Factor commissioned one or more of them. The tone shifts with
  // the destiny — measured for honourable retirements, plain for the
  // Brotherhood, the additional weight for failure. Empty when count is 0.
  body += sabotageCoda(destiny, s.sabotagesCommitted);

  return {
    outcome,
    destiny,
    letter: {
      id: 5000000 + s.day,
      from,
      subject,
      body,
      responses: [
        { label: 'Acknowledge in plain terms', seed: 'no rep change' },
        { label: 'Reply with a measured account', seed: 'company notes the case' },
        { label: 'Set the letter aside, write nothing', seed: 'silence' },
      ],
      read: false,
    },
  };
}

// ─────────── GENERATIONAL CONTINUATION ───────────
// When a charter closes, the player can take up a successor's charter.
// World state persists — outpost, brigantine, household, faction standings,
// named acquaintances — but the clock resets, the quota begins fresh, the
// strongbox suffers an executors' charge, and a fresh Director letter
// announces the new appointment.

function makeSuccessorDirectorLetter(prev, newName, moneyKept) {
  const peppShipped = prev.quotas?.pepper?.have || 0;
  const cinnShipped = prev.quotas?.cinnamon?.have || 0;
  const charge = Math.max(0, (prev.money || 0) - moneyKept);
  const tone = (peppShipped >= 400 && cinnShipped >= 200)
    ? 'whose returns met his charter — a man the Court will speak of with respect'
    : (peppShipped >= 200 || cinnShipped >= 100)
      ? 'whose returns were partial; the matter is closed without commendation'
      : 'whose returns were a disappointment, and on whose name we shall not dwell';
  return {
    id: 1,
    from: 'The Court of Directors, London',
    subject: 'Yr. Appointment to the Factory at Bayan-Kor',
    body: `Sir, — These presents confirm yr. appointment, freely given by the Court, to the Factory at Bayan-Kor, in succession to ${prev.player.name}, ${tone}.

You inherit the godown and yr. predecessor’s establishment as he left it. The brigantine on the slipway, if there is one, comes to yr. account; the household and the building works are yrs. to direct. £${charge} has been deducted from yr. opening accounts as the executors’ charge against ${prev.player.name}’s estate; £${moneyKept} stands to yr. credit at the strongbox.

The terms are renewed: returns of pepper, no less than four hundredweight, and cinnamon, no less than two hundredweight, are to be lodged at our House by the close of yr. third year. The reckonings of yr. predecessor’s charter are closed. Yr. file at Leadenhall begins on this hand.

Yr. obedt. servants, the Court of Directors, in London, &c.`,
    responses: [
      { label: 'Acknowledge with formal compliance', seed: 'company satisfied; no surprises' },
      { label: 'Reply briefly; turn at once to the work', seed: 'no rep change; directors consider you efficient' },
      { label: 'Reply at length; lay before them the state of yr. inheritance', seed: 'company notes a careful man' },
    ],
    read: false,
  };
}

function makeSuccessorState(prev, newName) {
  // Note on sync fields: playthroughId is intentionally NOT reset here.
  // Succession is the same player on a new save — they share the same
  // cloud-side record under the device's factor key. Re-minting the
  // playthroughId would orphan the prior charter's cloud copy.
  const moneyKept = Math.round((prev.money || 0) * 0.6);

  // Predecessor becomes a permanent acquaintance — a memory the AI sees in
  // future stateContext, so encounters can reference "the late Factor" by
  // name. Persist alongside the existing acquaintances.
  const peppShipped = prev.quotas?.pepper?.have || 0;
  const cinnShipped = prev.quotas?.cinnamon?.have || 0;
  const predecessorMemo = {
    id: `predecessor-${(prev.player?.name || 'unknown').replace(/\s+/g, '_').toLowerCase()}`,
    name: prev.player?.name || 'Yr. Predecessor',
    role: 'former Factor at Bayan-Kor',
    location: 'concluded — recalled to London',
    notes: `Held the post day 1 to day ${prev.day}. Returned ${peppShipped}cwt pepper, ${cinnShipped}cwt cinnamon. The household remembers him.`,
    introduced: 1,
    lastSeen: prev.day,
  };
  const persistedAcquaintances = [...(prev.acquaintances || []), predecessorMemo];

  // Most flags persist — they describe lasting world state. The per-charter
  // letter-sent / quest-step gates reset so the new Factor gets fresh chances.
  const carryFlags = {};
  for (const [k, v] of Object.entries(prev.flags || {})) {
    if (/LetterSent$/.test(k)) continue;            // letter triggers reset
    if (/QuestStep$/.test(k)) continue;             // multi-step quests reset
    if (/^sabotage_/.test(k)) continue;             // sabotage arcs reset per charter
    if (/^vizierBoon/.test(k)) continue;            // the Vizier's favour is a per-Factor relationship
    if (k === 'bugisPilots') continue;              // a granted boon, re-earnable by the successor
    if (k === 'banned_eustace_until') continue;     // travel bans expire with the charter
    if (k === 'firstLetterPresented') continue;
    carryFlags[k] = v;
  }

  // Port stocks fully replenish over a 3-year gap — fresh world for the
  // new Factor.
  const freshPortStocks = {};
  for (const [k, p] of Object.entries(PORTS)) {
    freshPortStocks[k] = { ...(p.stockMax || {}) };
  }

  // Crew list reflects the current household: if Hodge was sent home, Tyler
  // is the clerk now; if Dass was released, Anandan holds the watch.
  const newCrew = [];
  if (prev.flags?.hodgeCrisis === 'sent_home') {
    newCrew.push({ name: 'Mr. Tyler', role: 'Clerk', trait: 'plodding' });
  } else {
    newCrew.push({ name: 'Mr. Hodge', role: 'Clerk', trait: prev.flags?.hodgeCrisis === 'reformed' ? 'reformed' : 'drunkard' });
  }
  if (prev.flags?.dassRecall === 'released') {
    newCrew.push({ name: 'Lance Naik Anandan', role: 'Sepoy', trait: 'green' });
  } else {
    newCrew.push({ name: 'Sgt. Dass', role: 'Sepoy', trait: prev.flags?.dassRecall === 'commissioned' ? 'commissioned' : 'steady' });
  }

  return {
    ...prev,
    day: 1,
    daysRemaining: 1095,
    player: { name: newName, title: 'Factor' },
    money: moneyKept,
    crew: newCrew,
    quotas: { pepper: { needed: 400, have: 0 }, cinnamon: { needed: 200, have: 0 } },
    charterClosed: null,
    indiaman: { lastVisit: 0, nextDay: 180, visits: 0, lastQuarterly: 0 },
    lettersAuto: { nextDay: 12 },  // first contact from the wider world lands around the maiden voyage's return; the world should feel alive early, not after a month of silence. Subsequent cadence (30–55d) is unchanged.
    pendingLetterRequests: [],
    privateConsignment: null,
    privateConsignmentOffered: false,
    bottomry: null,                      // any outstanding bond is the predecessor's; the new Factor inherits no debt at the bazaar
    privateTradeProceeds: 0,             // cumulative private trade income, fresh per Factor
    tradeStats: {},                      // the predecessor's books close with him
    letters: [makeSuccessorDirectorLetter(prev, newName, moneyKept)],
    hooks: [],
    journal: [{ day: 1, entry: `Took up the Charter at Bayan-Kor in succession to ${prev.player?.name || 'the late Factor'}.` }],
    awayLog: [],
    seenOpening: true,        // skip the opening sequence
    firstLetterPresented: false,
    visited: ['Bayan-Kor'],   // the new Factor begins at home; foreign ports become first-visits again
    aiLog: [],
    acquaintances: persistedAcquaintances,
    flags: carryFlags,
    portStocks: freshPortStocks,
    rivals: makeInitialRivals(),       // fresh trajectories for the new Factor
    priceWindows: [],                   // no inherited arbitrage windows
    rivalPressure: 50,                  // baseline; recomputed first tick
    rivalPressureModifiers: [],
    sabotagesCommitted: 0,             // sabotage record does not carry forward
    lettersGenerated: 0,
    // Preserved as-is: outpost, ship, npcs, reputation
  };
}

// ─────────── CHARTER RENEWAL ───────────
// The same Factor accepts a second charter at Bayan-Kor. Most state persists
// — name, money, household, outpost, ship, named figures, faction standings.
// What resets is the clock, the quota, the Indiaman cycle, and the inbox.
// Title becomes "Senior Factor" on the first renewal.

function makeRenewalDirectorLetter(prev) {
  const peppShipped = prev.quotas?.pepper?.have   || 0;
  const cinnShipped = prev.quotas?.cinnamon?.have || 0;
  const wasSuccess  = peppShipped >= 400 && cinnShipped >= 200;
  const tone = wasSuccess
    ? 'Yr. returns of pepper and cinnamon have been laid before the Court with proper credit; we are content to extend yr. office at terms more agreeable than the first.'
    : 'Yr. returns were received with such regret as the matter justified; the Court has nevertheless determined to extend yr. office, on the understanding that the next reckoning will not be a second disappointment.';
  return {
    id: 1,
    from: 'The Court of Directors, London',
    subject: 'Yr. Charter Renewed',
    body: `Sir, — These presents confirm the renewal of yr. charter at the Factory at Bayan-Kor for a further three years. ${tone}

You inherit no man’s establishment now: yr. own godown stands as you left it, yr. household and the brigantine, if there is one, continue under yr. hand. We acknowledge you henceforward as Senior Factor of the Bayan-Kor station; conduct yrself accordingly.

The terms are renewed: returns of pepper, no less than four hundredweight, and cinnamon, no less than two hundredweight, are to be lodged at our House by the close of yr. third year. Reckonings of the previous charter are closed; yr. file at Leadenhall opens on this hand.

Yr. obedt. servants, the Court of Directors, in London, &c.`,
    responses: [
      { label: 'Acknowledge with formal compliance', seed: 'no surprises' },
      { label: 'Reply with thanks and a steady promise', seed: 'small standing nudge' },
      { label: 'Reply briefly; turn at once to the work', seed: 'no rep change' },
    ],
    read: false,
  };
}

function makeRenewedState(prev) {
  // Same Factor; per-charter triggers reset; the rest persists.
  // playthroughId intentionally persists — same player, same cloud record
  // under the device's factor key. Re-minting would orphan the prior copy.
  const carryFlags = {};
  for (const [k, v] of Object.entries(prev.flags || {})) {
    if (/LetterSent$/.test(k)) continue;
    if (/QuestStep$/.test(k)) continue;
    if (/^sabotage_/.test(k)) continue;             // sabotage arcs reset per charter
    if (/^vizierBoon/.test(k)) continue;            // the Vizier's favour is a per-Factor relationship
    if (k === 'bugisPilots') continue;              // a granted boon, re-earnable by the successor
    if (k === 'banned_eustace_until') continue;     // travel bans expire with the charter
    if (k === 'firstLetterPresented') continue;
    carryFlags[k] = v;
  }
  const freshPortStocks = {};
  for (const [k, p] of Object.entries(PORTS)) {
    freshPortStocks[k] = { ...(p.stockMax || {}) };
  }
  return {
    ...prev,
    day: 1,
    daysRemaining: 1095,
    player: { name: prev.player?.name || 'The Factor', title: 'Senior Factor' },
    // money kept as-is — same man, no executor's charge
    quotas: { pepper: { needed: 400, have: 0 }, cinnamon: { needed: 200, have: 0 } },
    charterClosed: null,
    indiaman: { lastVisit: 0, nextDay: 180, visits: 0, lastQuarterly: 0 },
    lettersAuto: { nextDay: 12 },  // first contact from the wider world lands around the maiden voyage's return; the world should feel alive early, not after a month of silence. Subsequent cadence (30–55d) is unchanged.
    pendingLetterRequests: [],
    privateConsignment: null,
    privateConsignmentOffered: false,
    bottomry: null,                  // outstanding bond from the previous charter is settled with the bazaar; the renewed Factor begins clear
    privateTradeProceeds: 0,         // cumulative private trade income resets per charter
    tradeStats: {},                  // "Reckonings of the previous charter are closed"
    letters: [makeRenewalDirectorLetter(prev)],
    hooks: [],
    journal: [{ day: 1, entry: `Charter renewed at Bayan-Kor for a second three years.` }],
    awayLog: [],
    seenOpening: true,
    firstLetterPresented: false,
    visited: prev.visited || ['Bayan-Kor'],
    aiLog: [],
    flags: carryFlags,
    portStocks: freshPortStocks,
    rivals: makeInitialRivals(),
    priceWindows: [],
    rivalPressure: 50,
    rivalPressureModifiers: [],
    sabotagesCommitted: 0,
    lettersGenerated: 0,
    // Preserved as-is: outpost, ship, npcs, reputation, acquaintances, crew
  };
}

// ─────────── HOME SIMULATION ───────────
// Each day the Factor is away (or any day passes), the colony lives.
// Construction progresses, NPCs act, small incidents accrue.
// All events accumulate in awayLog and are surfaced on return home.

function tickDays(gs, days) {
  let s = {
    ...gs,
    npcs: JSON.parse(JSON.stringify(gs.npcs)),
    outpost: { ...gs.outpost, buildings: { ...gs.outpost.buildings }, queue: [...gs.outpost.queue], warehouse: { ...(gs.outpost?.warehouse || {}) } },
    reputation: { ...gs.reputation },
    goods: { ...gs.goods },
    awayLog: [...gs.awayLog],
    portStocks: JSON.parse(JSON.stringify(gs.portStocks || {})),
    letters: [...(gs.letters || [])],
    quotas: JSON.parse(JSON.stringify(gs.quotas || {})),
    indiaman: { ...(gs.indiaman || { lastVisit: 0, nextDay: 180, visits: 0, lastQuarterly: 0 }) },
    shipCommission: gs.shipCommission ? { ...gs.shipCommission } : null,
    ship: gs.ship ? { ...gs.ship } : null,
    lettersAuto: { ...(gs.lettersAuto || { nextDay: 35 }) },
    pendingLetterRequests: [...(gs.pendingLetterRequests || [])],
    charterClosed: gs.charterClosed ? { ...gs.charterClosed } : null,
    privateConsignment: gs.privateConsignment ? { ...gs.privateConsignment, commodities: { ...gs.privateConsignment.commodities } } : null,
    privateConsignmentOffered: !!gs.privateConsignmentOffered,
    bottomry: gs.bottomry ? { ...gs.bottomry } : null,
  };
  const hasStockade = !!s.outpost.buildings.stockade?.built;
  const hasBarracks = !!s.outpost.buildings.barracks?.built;
  const incidentBaseChance = hasStockade || hasBarracks ? 0.012 : 0.025;

  for (let i = 0; i < days; i++) {
    s.day += 1;
    s.daysRemaining = Math.max(0, s.daysRemaining - 1);

    // ── charter end: fires once when daysRemaining first hits 0. The Court
    // closes the file; subsequent days continue to tick (the Factor still
    // exists in the world) but the charter is over. Subsequent date-driven
    // events (Indiaman, quarterly nag, auto-letters) are gated on
    // !s.charterClosed in their own conditions, so they go quiet.
    if (s.daysRemaining === 0 && !s.charterClosed) {
      const { letter, outcome, destiny } = makeCharterEndLetter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      // letterId lets the hub route the player straight to the climactic letter
      // — the 3-year finale must not pass as a silent HUD change (it can close
      // mid-voyage at a foreign port, where no homecoming digest fires).
      s.charterClosed = { day: s.day, outcome, destiny, letterId: letter.id };
      const destinyText = (
        destiny === 'crown-knighthood'      ? ' His Majesty has been pleased to confer a knighthood.' :
        destiny === 'country-estate'        ? ' Lord Mountfair has set aside an estate.' :
        destiny === 'bayan-kor-seat'        ? ' The Rajah has petitioned the Court for yr. continued post.' :
        destiny === 'brotherhood-retirement'? ' No Indiaman this season; a different roof above the cove.' :
        destiny === 'merchant-prince'       ? ' Yr. agent has made up the accounts; the concern is yr. own, and considerable.' :
        ''
      );
      s.awayLog.push({ day: s.day, type: 'charter-end', text: 'The third year is up. A packet from the Court closes the file.' + destinyText });
    }

    // ── port stocks replenish toward their cap. Sublocation stocks live
    // in the same portStocks bucket as the main port (keyed by commodity);
    // the sublocation's commodities don't overlap with the main port's, so
    // the maps merge cleanly.
    for (const [pk, p] of Object.entries(PORTS)) {
      const sub = activeSublocation(pk, s);
      const restock  = sub  ? { ...(p.restock  || {}), ...(sub.restock  || {}) } : p.restock;
      const stockMax = sub  ? { ...(p.stockMax || {}), ...(sub.stockMax || {}) } : p.stockMax;
      if (!restock) continue;
      if (!s.portStocks[pk]) s.portStocks[pk] = { ...(stockMax || {}) };
      for (const [c, rate] of Object.entries(restock)) {
        const cap = stockMax?.[c] ?? 0;
        const cur = s.portStocks[pk][c] ?? cap;
        s.portStocks[pk][c] = Math.min(cap, cur + rate);
      }
    }

    // ── construction progress
    if (s.outpost.queue.length > 0) {
      // Hodge at low sobriety slows things; competent days speed them.
      const speed = s.npcs.hodge.sobriety > 40 ? 1 : (Math.random() < 0.6 ? 1 : 0);
      const newQueue = [];
      for (const item of s.outpost.queue) {
        const newDaysLeft = item.daysLeft - speed;
        if (newDaysLeft <= 0) {
          // complete
          s.outpost.buildings = {
            ...s.outpost.buildings,
            [item.key]: { built: true, builtOn: s.day },
          };
          s.awayLog.push({ day: s.day, type: 'construction', text: `${BUILDINGS[item.key].name} completed.` });
          // apply standing effects on completion
          if (item.key === 'chapel') {
            s.reputation.mission = Math.min(100, s.reputation.mission + 20);
            s.reputation.rajah = Math.max(-100, s.reputation.rajah - 10);
          }
          // A person arrives with each completed building — Raven Rock pattern.
          // The named figure is added to acquaintances and surfaces in the AI's
          // state context, so future encounters and letters can reference them.
          const arrival = BUILDING_ARRIVALS[item.key];
          if (arrival) {
            s.acquaintances = upsertAcquaintance(s.acquaintances || [], s.day, arrival);
            s.awayLog.push({ day: s.day, type: 'arrival', text: arrival.arrivalText });
          }
        } else {
          newQueue.push({ ...item, daysLeft: newDaysLeft });
        }
      }
      s.outpost.queue = newQueue;
    }

    // ── ship commission progress. Like construction, slowed by Hodge's sobriety.
    // On completion, the new ship replaces the old one (cargo, hull, sails reset
    // to a fresh hundredweight on the slipway). The pinnace is sold off for the
    // pre-quoted trade-in credit.
    if (s.shipCommission && s.shipCommission.daysLeft > 0) {
      const cspeed = s.npcs.hodge.sobriety > 40 ? 1 : (Math.random() < 0.6 ? 1 : 0);
      const left = s.shipCommission.daysLeft - cspeed;
      if (left <= 0) {
        const t = SHIP_TYPES[s.shipCommission.type] || SHIP_TYPES.brigantine;
        const oldShip = s.ship;
        const newShip = {
          name: s.shipCommission.name || `The ${t.name}`,
          type: s.shipCommission.type,
          holdCwt: t.holdCwt,
          hull: 100,
          sails: 100,
          guns: s.shipCommission.type === 'brigantine' ? 6 : (oldShip?.guns || 0),
        };
        // Cargo carries over; the brigantine has more hold than the pinnace, so
        // nothing in the old hold can fail to fit.
        s.ship = newShip;
        const credit = s.shipCommission.tradeIn || 0;
        if (credit > 0) s.money = (s.money || 0) + credit;
        s.awayLog.push({
          day: s.day,
          type: 'shipyard',
          text: `${newShip.name} was launched at the slipway, two-masted and teak-built. The old ${oldShip?.name || 'pinnace'} went away with a Bugis trader for £${credit}.`,
        });
        // The largest upgrade in the game — mark it as a turning point in the
        // Factor's own hand (rendered distinctly, like the wealth milestones).
        s.journal = [...(s.journal || []), {
          day: s.day,
          entry: `${newShip.name} is launched, and with her my standing in this strait is altered. I came out a clerk with a charter and a leaky pinnace; I have a country ship of my own commissioning under me now. Wilbraham never got so far.`,
          milestone: true,
        }];
        s.shipCommission = null;
      } else {
        s.shipCommission = { ...s.shipCommission, daysLeft: left };
      }
    }

    // ── plantation harvest every 30 days after built. Pepper is lodged in the
    // godown; if the godown is full, the surplus rots in the rains.
    const plant = s.outpost.buildings.plantation;
    if (plant?.built && (s.day - plant.builtOn) > 0 && (s.day - plant.builtOn) % 30 === 0) {
      const yield_ = 5;
      const cap = WAREHOUSE_BASE_CAP + (s.outpost.buildings.great_godown?.built ? WAREHOUSE_GREAT_BONUS : 0);
      const used = cargoWeight(s.outpost.warehouse);
      const room = Math.max(0, cap - used);
      const stored = Math.min(yield_, Math.floor(room / (COMMODITIES.pepper.weight || 1)));
      const overflow = yield_ - stored;
      if (stored > 0) s.outpost.warehouse.pepper = (s.outpost.warehouse.pepper || 0) + stored;
      if (overflow > 0) {
        s.awayLog.push({ day: s.day, type: 'harvest', text: `The plantation yielded ${yield_} cwt of pepper, but the godown was full; ${overflow} cwt was lost to the rains.` });
      } else {
        s.awayLog.push({ day: s.day, type: 'harvest', text: `The plantation yielded ${yield_} cwt of pepper, lodged in the godown.` });
      }
    }

    // ── Hodge: drunkenness roll. The crisis resolution flag changes the
    // rules: 'reformed' raises the floor and slows episodes; 'sent_home'
    // skips his rolls entirely; 'accepted' makes them slightly worse;
    // 'junior_hired' leaves Hodge as he was.
    const hodgeState = s.flags?.hodgeCrisis;
    if (hodgeState === 'sent_home') {
      // Hodge is gone — Mr. Tyler has the desk now and doesn't drink.
    } else if (Math.random() < (Math.max(0.04, (100 - s.npcs.hodge.sobriety) / 220) * (hodgeState === 'reformed' ? 0.2 : hodgeState === 'accepted' ? 1.2 : 1)) && (s.day - s.npcs.hodge.lastDrunk) > 4) {
      const hit = (hodgeState === 'reformed' ? 3 : hodgeState === 'accepted' ? 8 : 6) + Math.floor(Math.random() * 8);
      const floor = hodgeState === 'reformed' ? 60 : 0;
      s.npcs.hodge.sobriety = Math.max(floor, s.npcs.hodge.sobriety - hit);
      s.npcs.hodge.lastDrunk = s.day;
      const lines = hodgeState === 'reformed'
        ? [
            'Mr. Hodge took a single glass at supper; Sgt. Dass had a quiet word.',
            'Mr. Hodge was tempted at the wharf, and refused. The Reverend was told and was content.',
          ]
        : [
            'Mr. Hodge was found insensible behind the godown.',
            'Mr. Hodge missed the morning ledger entirely; the rum was at fault.',
            'Mr. Hodge wept on Sgt. Dass\u2019s shoulder for an hour, then slept.',
            'Mr. Hodge mistook a Bugis trader for his late wife; the matter was smoothed.',
          ];
      s.awayLog.push({ day: s.day, type: 'npc', npc: 'hodge', text: lines[Math.floor(Math.random() * lines.length)] });
    } else if (hodgeState !== 'sent_home') {
      // slow recovery \u2014 faster if reformed
      const recoverChance = hodgeState === 'reformed' ? 0.55 : 0.3;
      if (Math.random() < recoverChance) s.npcs.hodge.sobriety = Math.min(100, s.npcs.hodge.sobriety + 1);
    }

    // ── Dass / Anandan: occasional report. After Dass is released, Lance
    // Naik Anandan takes the watch — green and not yet trusted.
    if (Math.random() < 0.025) {
      const released = s.flags?.dassRecall === 'released';
      const lines = released ? [
        'Lance Naik Anandan reports the Bugis prahu was seen in the strait at dusk; he was uncertain whether to fire.',
        'Lance Naik Anandan apprehended a small theft and has not yet learned what to do with the man.',
        'Lance Naik Anandan stood the night watch and fell asleep at his post by the third hour.',
        'Lance Naik Anandan asked permission to fire upon a stray fishing prahu and was refused.',
      ] : [
        'Sgt. Dass apprehended a man pilfering rice. Released after a beating.',
        'Sgt. Dass reports that the Bugis prahu was seen in the strait at dusk.',
        'Sgt. Dass purchased fish at the wharf and shared it with the household.',
        'Sgt. Dass declined a bribe from a passing trader and noted the man\u2019s face.',
      ];
      s.awayLog.push({ day: s.day, type: 'npc', npc: 'dass', text: lines[Math.floor(Math.random() * lines.length)] });
    }

    // ── Vizier: overture
    if (Math.random() < 0.018) {
      const lines = [
        'A boy from the palace delivered a parcel of betel leaves and a courteous note.',
        'The Vizier sent a basket of mangosteens and a request that you call when convenient.',
        'The Vizier\u2019s clerk inquired discreetly after your interest in inland teak.',
        'The Vizier sent word that the Rajah had asked after your health.',
      ];
      s.awayLog.push({ day: s.day, type: 'npc', npc: 'vizier', text: lines[Math.floor(Math.random() * lines.length)] });
      s.npcs.vizier.friendliness = Math.min(100, s.npcs.vizier.friendliness + 2);
    }

    // ── Random incident
    if (Math.random() < incidentBaseChance) {
      const lines = [
        'A monsoon squall lifted half the godown\u2019s thatch. Replaced.',
        'A trader from the inland passed through with news of a pepper glut at Kota Pinang.',
        'The pinnace\u2019s rigging chafed through; a day spent on splicing.',
        'Fever passed through the lines; one boatman lost.',
        'A child from the village brought a crate of mangoes to the gate, as if owed.',
        'A Dutch sloop stood off the bar for an afternoon, then made away.',
      ];
      s.awayLog.push({ day: s.day, type: 'incident', text: lines[Math.floor(Math.random() * lines.length)] });
    }

    // ── Indiaman call: every INDIAMAN_INTERVAL days, the Company sends a
    // ship to lift pepper and cinnamon from the godown back to London. The
    // Director writes by the same packet.
    if (!s.charterClosed && s.day >= (s.indiaman?.nextDay ?? Infinity) && (s.indiaman?.visits ?? 0) < INDIAMAN_TOTAL) {
      const peppLifted = Math.floor(s.outpost.warehouse?.pepper || 0);
      const cinnLifted = Math.floor(s.outpost.warehouse?.cinnamon || 0);
      const idx = Math.min(s.indiaman.visits, INDIAMAN_NAMES.length - 1);
      const shipName = INDIAMAN_NAMES[idx];

      if (peppLifted > 0 || cinnLifted > 0) {
        s.outpost.warehouse = { ...s.outpost.warehouse };
        if (peppLifted > 0) s.outpost.warehouse.pepper = (s.outpost.warehouse.pepper || 0) - peppLifted;
        if (cinnLifted > 0) s.outpost.warehouse.cinnamon = (s.outpost.warehouse.cinnamon || 0) - cinnLifted;
      }
      const letter = makeIndiamanLetter(s, peppLifted, cinnLifted, shipName);
      // Numbers reflect the *post-shipment* reckoning the Court will see.
      const newTotalPepper = (s.quotas?.pepper?.have   || 0) + peppLifted;
      const newTotalCinn   = (s.quotas?.cinnamon?.have || 0) + cinnLifted;
      const newVisits      = (s.indiaman?.visits || 0) + 1;
      const expPep         = Math.round((400 * newVisits) / INDIAMAN_TOTAL);
      const expCin         = Math.round((200 * newVisits) / INDIAMAN_TOTAL);
      letter.aiUpgrade = {
        peppLifted, cinnLifted, shipName,
        totalPepper: newTotalPepper, totalCinn: newTotalCinn,
        visits: newVisits,
        empty:   peppLifted === 0 && cinnLifted === 0,
        onTrack: newTotalPepper >= expPep * 0.85 && newTotalCinn >= expCin * 0.85,
      };
      s.quotas = {
        ...s.quotas,
        pepper:   { ...(s.quotas?.pepper   || { needed: 400, have: 0 }), have: newTotalPepper },
        cinnamon: { ...(s.quotas?.cinnamon || { needed: 200, have: 0 }), have: newTotalCinn },
      };
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      const ShipName = shipName.replace('the ', '').replace(/^./, c => c.toUpperCase());
      const tail = (peppLifted === 0 && cinnLifted === 0)
        ? 'The hold went away empty, by the harbourmaster’s account.'
        : `${peppLifted} cwt pepper and ${cinnLifted} cwt cinnamon lifted from the godown.`;
      s.awayLog.push({ day: s.day, type: 'indiaman', lifted: peppLifted + cinnLifted, text: `${ShipName}, of the Company, called for the returns. ${tail} A letter from the Court came by the same packet.` });
      s.indiaman = { lastVisit: s.day, nextDay: s.day + INDIAMAN_INTERVAL, visits: (s.indiaman.visits || 0) + 1, lastQuarterly: s.day };

      // Pay out any private consignment the Factor sent by the previous
      // Indiaman. Each cwt sold at London-market multipliers; funds return
      // by the same packet.
      if (s.privateConsignment && s.privateConsignment.commodities) {
        let payout = 0;
        const lines = [];
        for (const [k, qty] of Object.entries(s.privateConsignment.commodities)) {
          if (!qty) continue;
          const v = londonValue(k, qty);
          payout += v;
          lines.push(`${qty} cwt ${COMMODITIES[k].name.toLowerCase()} at £${v}`);
        }
        if (payout > 0) {
          s.money = (s.money || 0) + payout;
          s.privateTradeProceeds = (s.privateTradeProceeds || 0) + payout;
          s.awayLog.push({
            day: s.day,
            type: 'private_trade',
            text: `Yr. private consignment by the last Indiaman returned £${payout} from London — ${lines.join('; ')}.`,
          });
          s.journal = [...s.journal, { day: s.day, entry: `Yr. private consignment to London paid out £${payout}: ${lines.join('; ')}.` }];
        }
        s.privateConsignment = null;
      }

      // Set a flag so GameHub can prompt the player to send a fresh
      // consignment by THIS Indiaman before she sails. Cleared when the
      // player either sends or declines.
      if ((s.indiaman.visits || 0) < INDIAMAN_TOTAL && !s.charterClosed) {
        s.privateConsignmentOffered = true;
      }
    }

    // ── Quarterly nag from the Court — fires halfway between Indiaman calls.
    // Doesn't fire on a day that already saw an Indiaman visit (above sets
    // lastQuarterly = lastVisit, blocking same-day double letters).
    if (
      !s.charterClosed &&
      (s.indiaman?.visits || 0) < INDIAMAN_TOTAL &&
      (s.daysRemaining || 0) > 0 &&
      s.day >= (s.indiaman?.lastVisit || 0) + QUARTERLY_INTERVAL &&
      (s.indiaman?.lastQuarterly || 0) < (s.indiaman?.lastVisit || 0) + QUARTERLY_INTERVAL
    ) {
      const letter = makeQuarterlyNagLetter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.indiaman = { ...s.indiaman, lastQuarterly: s.day };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A packet from London — the Court desires word of yr. progress.' });
    }

    // ── Auto-delivered AI letters from the wider world. The request is
    // queued here; an effect in GameHub generates the body asynchronously
    // and pushes the finished letter into the inbox. Schedule advances
    // whether or not a sender is eligible — quiet stretches reflect a
    // Factor with few correspondents.
    if (!s.charterClosed && (s.daysRemaining || 0) > 0 && s.day >= (s.lettersAuto?.nextDay || Infinity)) {
      const sender = pickAutoSender(s);
      if (sender) {
        const seedId = Date.now() + s.day * 13 + (s.pendingLetterRequests?.length || 0);
        s.pendingLetterRequests = [...(s.pendingLetterRequests || []), {
          seedId,
          senderKey: sender.key,
          from: sender.from,
          mood: sender.mood,
          requestedDay: s.day,
        }];
      }
      s.lettersAuto = { nextDay: s.day + 30 + Math.floor(Math.random() * 25) };
    }

    // ── Teak concession: once the Factor has earned a measure of standing
    // with the Rajah, the Vizier writes to lay the long-suspended concession
    // before him. One-off; the flag prevents re-firing.
    if (
      !s.charterClosed &&
      !s.flags?.teakLetterSent &&
      !s.flags?.teakConcession &&
      s.day >= 60 &&
      (s.reputation?.rajah || 0) >= 5
    ) {
      const letter = makeTeakConcessionLetter(s);
      s.letters = [...s.letters, letter];
      s.flags = { ...(s.flags || {}), teakLetterSent: true };
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A formal letter came down from the palace, the Vizier’s seal upon it.' });
    }

    // ── The Wexley matter: yr. sister writes of the family's portion in a
    // Bristol trading house — the home-country path into the enterprise.
    // One-off, mid-early game once the Factor has found his feet.
    if (
      !s.charterClosed &&
      !s.flags?.wexleyMatterLetterSent &&
      !s.flags?.wexleyMatter &&          // already resolved (persists across succession)
      s.day >= 120
    ) {
      const letter = makeWexleyMatterLetter(s);
      s.letters = [...s.letters, letter];
      s.flags = { ...(s.flags || {}), wexleyMatterLetterSent: true };
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A thick letter from Bristol, in Eliza’s hand — a matter of the family’s concern.' });
    }

    // ── The Wexley matter, Step 2: if the family portion was merely HELD, the
    // Bristol house later prospers and Mr. Pyne offers to let it grow on better
    // terms — paying off the door the 'hold' branch left open. One-off per
    // charter (the gate resets on succession so a successor's held matter ripens
    // afresh); only fires while the matter is still 'held'.
    if (
      !s.charterClosed &&
      s.flags?.wexleyMatter === 'held' &&
      !s.flags?.wexleyStep2LetterSent &&
      s.day >= 270
    ) {
      const letter = makeWexleyStep2Letter(s);
      s.letters = [...s.letters, letter];
      s.flags = { ...(s.flags || {}), wexleyStep2LetterSent: true };
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.awayLog.push({ day: s.day, type: 'letter', text: 'Another letter from Bristol, in Eliza’s hand — the family’s house has prospered.' });
    }

    // ── Dutch trade pass: Mynheer Boom writes once the Factor has put into
    // Port St. Eustace and the Dutch are not openly hostile. Holding the
    // pass halves the port duty regardless of standing.
    if (
      !s.charterClosed &&
      !s.flags?.dutchPassLetterSent &&
      !s.flags?.dutchTradePass &&
      !s.flags?.dutchPassDeclined &&
      s.day >= 90 &&
      (s.reputation?.dutch || 0) >= -10 &&
      (s.visited || []).includes('Port St. Eustace')
    ) {
      const letter = makeDutchPassLetter(s);
      s.letters = [...s.letters, letter];
      s.flags = { ...(s.flags || {}), dutchPassLetterSent: true };
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A discreet packet from the Dutch House at Eustace — Mynheer Boom’s hand.' });
    }

    // ── The Vizier's boon: stamp the day the debt first appears, then write
    // to make good ~45 days later. Closes the long-dead vizierBoonOwed loop.
    if (s.flags?.vizierBoonOwed && !s.flags?.vizierBoonOwedSince) {
      s.flags = { ...(s.flags || {}), vizierBoonOwedSince: s.day };
    }
    if (
      !s.charterClosed &&
      !s.flags?.vizierBoonLetterSent &&
      !s.flags?.vizierBoonCalled &&
      s.flags?.vizierBoonOwed &&
      s.day >= (s.flags?.vizierBoonOwedSince || s.day) + 45
    ) {
      const letter = makeVizierBoonLetter(s);
      s.letters = [...s.letters, letter];
      s.flags = { ...(s.flags || {}), vizierBoonLetterSent: true };
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A letter from the palace under the Vizier’s seal — the matter of a favour.' });
    }

    // ── The Final Dispatch: the Court's quota reckoning in the last 180 days,
    // so the charter's close is foreseen rather than a brick wall. One-off.
    if (
      !s.charterClosed &&
      !s.flags?.finalDispatchSent &&
      (s.daysRemaining || 0) <= 180 &&
      (s.daysRemaining || 0) > 0
    ) {
      const letter = makeFinalDispatchLetter(s);
      s.letters = [...s.letters, letter];
      s.flags = { ...(s.flags || {}), finalDispatchSent: true };
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A weighty packet from London, the Court’s seal doubled upon it.' });
    }

    // ── Reverend Pyke: once the chapel is built and the Mission has noted
    // the Factor with at least mild approval, Pyke writes asking for a
    // subscription to a small school at the Mission. One-off; pykeLetterSent
    // prevents re-firing.
    if (
      !s.charterClosed &&
      !s.flags?.pykeLetterSent &&
      s.outpost?.buildings?.chapel?.built &&
      s.day >= 100 &&
      (s.reputation?.mission || 0) >= 5
    ) {
      const letter = makePykeSchoolLetter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), pykeLetterSent: true };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A note from the Mission, in the Reverend’s small upright hand.' });
    }

    // ── The Brotherhood compact: Capt. Maas writes once after the Factor
    // has put into the Pelican's Nest with at least minimal standing.
    if (
      !s.charterClosed &&
      !s.flags?.brotherhoodLetterSent &&
      s.day >= 75 &&
      (s.reputation?.pirates || 0) >= 5 &&
      (s.visited || []).includes('The Pelican’s Nest')
    ) {
      const letter = makeBrotherhoodLetter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), brotherhoodLetterSent: true };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A letter on un-watermarked paper, in a hand the clerk does not know.' });
    }

    // ── HMS Adventure: Capt. Whitcombe writes once in the early-mid charter,
    // requesting one of three services. Period-plausible — RN frigates did
    // call at Company stations on patrol.
    if (
      !s.charterClosed &&
      !s.flags?.crownLetterSent &&
      s.day >= 120 &&
      (s.visited || []).length >= 2  // has put into at least one foreign port
    ) {
      const letter = makeCrownLetter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), crownLetterSent: true };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A King’s letter under a Royal Navy seal — Capt. Whitcombe of HMS Adventure.' });
    }

    // ── Mr. Dryden of the Speculative Bench: a private letter from a
    // Director of the Court of Directors who concerns himself with private
    // trade and country shipping, in counterpoint to the senior bench.
    // One-off; the player's reply sets companyFaction = speculative |
    // conservative | declined, which colours subsequent quarterly nags.
    if (
      !s.charterClosed &&
      !s.flags?.drydenLetterSent &&
      s.day >= 150
    ) {
      const letter = makeDrydenLetter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), drydenLetterSent: true };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A private letter, not on Company paper — from one Mr. Dryden of the Court.' });
    }

    // Lord Mountfair's notice — the speculative faction's payoff event.
    // Once the player has thrown in with Dryden's bench AND has built up
    // a comfortable strongbox (which implies private trade returns), a
    // London peer Director writes by Dryden's introduction.
    if (
      !s.charterClosed &&
      !s.flags?.mountfairLetterSent &&
      s.flags?.companyFaction === 'speculative' &&
      privateTradeReturned(s) >= 500
    ) {
      const letter = makeMountfairLetter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), mountfairLetterSent: true };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A letter from London by Mr. Dryden\'s introduction — the seal is a peer\'s, the hand his own.' });
    }

    // ── Hodge crisis: once after day 200, when Hodge's drinking has run
    // long enough to tip into a real episode. Sgt. Dass writes; the player
    // chooses what to do with him. Won't fire if Hodge has already been
    // sent home or reformed in a prior crisis.
    if (
      !s.charterClosed &&
      !s.flags?.hodgeCrisisLetterSent &&
      !s.flags?.hodgeCrisis &&
      s.day >= 200 &&
      (s.npcs?.hodge?.sobriety || 100) <= 35
    ) {
      const letter = makeHodgeCrisisLetter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), hodgeCrisisLetterSent: true };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A note in Sgt. Dass’s careful hand — concerning Mr. Hodge.' });
    }

    // ── Dass recall: the Madras establishment writes once after day 240.
    if (
      !s.charterClosed &&
      !s.flags?.dassRecallLetterSent &&
      !s.flags?.dassRecall &&
      s.day >= 240
    ) {
      const letter = makeDassRecallLetter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), dassRecallLetterSent: true };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'Sgt. Dass with a paper in his hand and a face yr. office has not seen on him before.' });
    }

    // ── Vizier marriage gambit: once after day 280, Vizier proposes the
    // Factor stand at his clerk's marriage.
    if (
      !s.charterClosed &&
      !s.flags?.vizierMarriageLetterSent &&
      !s.flags?.vizierMarriage &&
      s.day >= 280 &&
      (s.reputation?.rajah || 0) >= 0
    ) {
      const letter = makeVizierMarriageLetter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), vizierMarriageLetterSent: true };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A folded note from the palace, the Vizier’s small personal seal upon it.' });
    }

    // ── Vizier intel: one to two per charter, gated visited Eustace (unique-set
    // so .includes suffices), 90-day spacing, capped at 2.
    if (
      !s.charterClosed &&
      (s.flags?.vizierIntelLetterCount ?? 0) < 2 &&
      s.day >= 150 &&
      (s.visited || []).includes('Port St. Eustace') &&
      (s.day - (s.flags?.lastVizierIntelDay ?? 0)) >= 90
    ) {
      const letter = makeVizierIntelLetter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), lastVizierIntelDay: s.day };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A folded note from the palace, the Vizier\'s small personal seal upon it.' });
    }

    // ── Brotherhood operative questline (Faulke).
    // Step 1: Faulke proposes to investigate. Fires once after the Factor
    // has met him AND day >= 90.
    const knowsFaulke = (s.acquaintances || []).some(a => /faulke/i.test(a.name || ''));
    const fStep = s.flags?.faulkeQuestStep;
    if (
      !s.charterClosed &&
      !fStep &&
      s.day >= 90 &&
      knowsFaulke
    ) {
      const letter = makeFaulkeStep1Letter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), faulkeQuestStep: 'proposed' };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A note from Capt. Faulke of the Albatross — sealed with his own ring.' });
    }
    // Step 2: 30 days after the player paid Faulke, he writes back with
    // the cove's particulars.
    if (
      !s.charterClosed &&
      fStep === 'paid' &&
      s.day >= ((s.flags?.faulkeQuestStep1Day || 0) + 30)
    ) {
      const letter = makeFaulkeStep2Letter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), faulkeQuestStep: 'awaiting-decision' };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'Capt. Faulke is back at Eustace; a sealed packet from him by the same boat.' });
    }

    // ── Cylinder questline (Idris). Step 1: Idris writes once the Factor
    // has met him + day >= 50. Step 2 fires 30 days after step 1, branched
    // by the player's choice (Said bin Mahmood / Hamzah / Brotherhood man).
    const knowsIdris = (s.acquaintances || []).some(a => /idris/i.test(a.name || ''));
    const cStep = s.flags?.cylinderQuest;
    if (
      !s.charterClosed &&
      !cStep &&
      s.day >= 50 &&
      knowsIdris
    ) {
      const letter = makeCylinderStep1Letter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), cylinderQuest: 'pending' };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A Bugis runner came down to the godown with a folded note from Idris bin Salleh — concerning the cylinder.' });
    }
    // Step 2: fires 30 days after step 1's resolution day. Skips if the
    // path is already resolved (closed-X) or still pending step 1 ('pending').
    const cylinderS2Sent = !!s.flags?.cylinderStep2Sent;
    const cylinderActive = cStep && !cStep.startsWith('closed') && cStep !== 'pending';
    if (
      !s.charterClosed &&
      !cylinderS2Sent &&
      cylinderActive &&
      s.day >= ((s.flags?.cylinderStep1Day || 0) + 30)
    ) {
      const letter = makeCylinderStep2Letter(s);
      if (letter) {
        s.letters = [...s.letters, letter];
        s.lettersGenerated = (s.lettersGenerated || 0) + 1;
        s.flags = { ...(s.flags || {}), cylinderStep2Sent: true };
        const text = cStep === 'opened'
          ? 'A Bugis runner at the gate, with no name, asking for Said bin Mahmood\'s answer.'
          : cStep === 'returning'
            ? 'A small parcel from Hamzah at Kota Pinang — the cylinder\'s acknowledgement.'
            : 'A man at the gate concerning the cylinder yr. weights protect.';
        s.awayLog.push({ day: s.day, type: 'letter', text });
      }
    }

    // ── Pale man's sealed letter questline. Step 1: an unknown hand
    // delivers a sealed offer at day 130, gated on having visited Kota
    // Pinang. Step 2 fires 30 days later, branched.
    const pStep = s.flags?.paleManQuest;
    if (
      !s.charterClosed &&
      !pStep &&
      s.day >= 130 &&
      (s.visited || []).includes('Kota Pinang')
    ) {
      const letter = makePaleManStep1Letter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), paleManQuest: 'pending' };
      s.awayLog.push({ day: s.day, type: 'letter', text: 'A sealed packet from an unknown hand — left at the godown by an unmarked Bugis runner, who did not stay.' });
    }
    const pStep2Sent = !!s.flags?.paleManStep2Sent;
    const pActive = pStep && !pStep.startsWith('closed') && pStep !== 'pending' && pStep !== 'declined';
    if (
      !s.charterClosed &&
      !pStep2Sent &&
      pActive &&
      s.day >= ((s.flags?.paleManStep1Day || 0) + 30)
    ) {
      const letter = makePaleManStep2Letter(s);
      if (letter) {
        s.letters = [...s.letters, letter];
        s.lettersGenerated = (s.lettersGenerated || 0) + 1;
        s.flags = { ...(s.flags || {}), paleManStep2Sent: true };
        const text = pStep === 'opened'
          ? 'The pale man at the Kota Pinang wharf, a fortnight on. Yr. answer is asked for.'
          : 'A packet from the Madras office on the pale man\'s arrest.';
        s.awayLog.push({ day: s.day, type: 'letter', text });
      }
    }

    // ── Wilbraham mystery questline. Step 1: Sgt. Dass writes about the
    // night Wilbraham died. Gates: day 100, dass loyalty >= 70 (he's still
    // there and trusts the Factor) — but if Dass is gone (released), Mr.
    // Hodge carries the message instead, in his cups, after day 150 if his
    // sobriety has stabilised. Either path uses the same Step 1 letter
    // (we just adjust the framing); the questline doesn't strand.
    const wStep = s.flags?.wilbrahamMystery;
    const dassPresent = s.flags?.dassRecall !== 'released';
    const dassTrusts = (s.npcs?.dass?.loyalty || 0) >= 70;
    const hodgeRecovered = (s.npcs?.hodge?.sobriety || 0) >= 50;
    const dassGate = dassPresent && dassTrusts && s.day >= 100;
    const hodgeGate = !dassPresent && hodgeRecovered && s.day >= 150;
    if (
      !s.charterClosed &&
      !wStep &&
      (dassGate || hodgeGate)
    ) {
      const letter = makeWilbrahamStep1Letter(s);
      // If Hodge is the carrier, retitle the letter — he writes differently.
      if (hodgeGate) {
        letter.from = 'Mr. Hodge, after a Friday evening';
        letter.subject = 'A matter from the year of Mr. Wilbraham';
      }
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.flags = { ...(s.flags || {}), wilbrahamMystery: 'pending' };
      s.awayLog.push({ day: s.day, type: 'letter', text: dassGate
        ? 'Sgt. Dass came in his own time, with a folded note in his careful hand — concerning the late Mr. Wilbraham.'
        : 'Mr. Hodge in his cups Friday evening — a matter from the year of Mr. Wilbraham.' });
    }
    const wStep2Sent = !!s.flags?.wilbrahamStep2Sent;
    const wActive = wStep === 'asked-reverend' || wStep === 'asked-hodge';
    if (
      !s.charterClosed &&
      !wStep2Sent &&
      wActive &&
      s.day >= ((s.flags?.wilbrahamStep1Day || 0) + 30)
    ) {
      const letter = makeWilbrahamStep2Letter(s);
      if (letter) {
        s.letters = [...s.letters, letter];
        s.lettersGenerated = (s.lettersGenerated || 0) + 1;
        s.flags = { ...(s.flags || {}), wilbrahamStep2Sent: true };
        const text = wStep === 'asked-reverend'
          ? 'A long letter from the Reverend Pyke in his small upright hand — the matter of Mr. Wilbraham.'
          : 'A note in yr. own hand, transcribed from Hodge\'s evening — the matter of Mr. Wilbraham.';
        s.awayLog.push({ day: s.day, type: 'letter', text });
      }
    }
    // Wilbraham step 3 — ter Borch answers back, 30 days after the Factor
    // pursued or confronted him. The tone of his reply branches by the
    // existing Dutch standing (cordial, cool, or cold).
    const wStep3Sent = !!s.flags?.wilbrahamStep3Sent;
    const wPursuingDutch = wStep === 'closed-pursuing-dutch' || wStep === 'closed-confronted-dutch';
    if (
      !s.charterClosed &&
      !wStep3Sent &&
      wPursuingDutch &&
      s.day >= ((s.flags?.wilbrahamStep1Day || 0) + 60)  // step 2 set the pursuit, then 30 more
    ) {
      const letter = makeWilbrahamStep3Letter(s);
      if (letter) {
        s.letters = [...s.letters, letter];
        s.lettersGenerated = (s.lettersGenerated || 0) + 1;
        s.flags = { ...(s.flags || {}), wilbrahamStep3Sent: true };
        s.awayLog.push({ day: s.day, type: 'letter', text: 'A reply from Mynheer ter Borch by the next Dutch packet — the tone is what yr. standing has earned.' });
      }
    }

    // ── Rivalry events. Fires roughly every 90-150 days from a per-rival
    // template pool. Pool is RIVAL_EVENTS (Phase 6 — empty during
    // structural phases). pickRivalEvent enforces eligibility, no-repeats,
    // and the 240-day cluster cap.
    if (!s.charterClosed) {
      // Initialize first-event day with 60-120-day jitter from charter start.
      if (!s.flags?.firstRivalEventDay) {
        s.flags = {
          ...(s.flags || {}),
          firstRivalEventDay: 60 + Math.floor(Math.random() * 60),
        };
      }
      const nextEventDay = s.flags?.nextRivalEventDay ?? s.flags.firstRivalEventDay;
      if (s.day >= nextEventDay) {
        const event = pickRivalEvent(s, RIVAL_EVENTS);
        if (event) {
          const intelFlag = `${event.rival}IntelPlant`;
          const wasAnticipated = !!s.flags?.[intelFlag];
          const letter = event.build(s, { anticipated: wasAnticipated });
          s.letters = [...s.letters, letter];
          s.lettersGenerated = (s.lettersGenerated || 0) + 1;
          s.rivals[event.rival].eventsFired = [
            ...(s.rivals[event.rival].eventsFired || []),
            event.key,
          ];
          if (event.standingAfter) s.rivals[event.rival].state = event.standingAfter;
          if (event.standingDelta) {
            s.rivals[event.rival].standing = Math.max(0, Math.min(100,
              (s.rivals[event.rival].standing || 50) + event.standingDelta));
          }
          s.rivals[event.rival].lastEventDay = s.day;

          // Apply priceWindow if any.
          if (event.priceWindow) {
            s.priceWindows = [
              ...(s.priceWindows || []),
              { ...event.priceWindow, expiresDay: s.day + event.priceWindow.days },
            ];
          }
          // Apply pressure modifier (use defaults if event doesn't override).
          const pressureDelta    = event.pressureDelta    ?? (event.standingDelta < 0 ? -8 : 8);
          const pressureLifetime = event.pressureLifetime ?? 60;
          s.rivalPressureModifiers = [
            ...(s.rivalPressureModifiers || []),
            { delta: pressureDelta, fromDay: s.day, lifetimeDays: pressureLifetime },
          ];
          // Consume the intel-plant flag.
          if (wasAnticipated) {
            const flagsNext = { ...(s.flags || {}) };
            delete flagsNext[intelFlag];
            s.flags = flagsNext;
          }
          s.awayLog.push({ day: s.day, type: 'letter', text: 'A note from London concerning the affairs of yr. peers.' });
        }
        s.flags = {
          ...(s.flags || {}),
          nextRivalEventDay: s.day + 90 + Math.floor(Math.random() * 60),
        };
      }
    }

    // ── Sabotage arcs. Step 1 offers per rival when canOfferSabotage holds
    // (Year 2+, pressured player, channel relationship in place, rival not
    // yet broken, no prior offer for this rival). Step 2 fires 45 days
    // after commitment, with outcome resolved by resolveSabotage.
    // Spec: docs/superpowers/specs/2026-05-09-sabotage-arcs-design.md.
    {
      const SABOTAGE_LETTERS = {
        hardacre: { step1: makeSabotageHardacreStep1Letter, step2: makeSabotageHardacreStep2Letter, name: 'Mr. Hardacre' },
        terborch: { step1: makeSabotageTerBorchStep1Letter, step2: makeSabotageTerBorchStep2Letter, name: 'Mynheer ter Borch' },
        lowji:    { step1: makeSabotageLowjiStep1Letter,    step2: makeSabotageLowjiStep2Letter,    name: 'Mr. Lowji' },
      };
      for (const rk of ['hardacre', 'terborch', 'lowji']) {
        const cfg = SABOTAGE_LETTERS[rk];

        // Step 1
        if (canOfferSabotage(rk, s)) {
          const letter = cfg.step1(s);
          s.letters = [...s.letters, letter];
          s.lettersGenerated = (s.lettersGenerated || 0) + 1;
          s.flags = { ...(s.flags || {}), [`sabotage_${rk}_offered`]: true };
          s.awayLog.push({ day: s.day, type: 'letter', text: `A folded note at the gate, concerning ${cfg.name}.` });
        }

        // Step 2
        if (s.charterClosed) continue;
        const method = s.flags?.[`sabotage_${rk}_method`];
        if (method !== 'commission' && method !== 'negotiate') continue;
        if (s.flags?.[`sabotage_${rk}_step2_sent`]) continue;
        if (s.flags?.[`sabotage_${rk}_resolved`]) continue;
        const committedDay = s.flags?.[`sabotage_${rk}_committed_day`] ?? 0;
        if (committedDay <= 0) continue;
        if (s.day < committedDay + 45) continue;

        const letter = cfg.step2(s);
        s.letters = [...s.letters, letter];
        s.lettersGenerated = (s.lettersGenerated || 0) + 1;
        s.flags = { ...(s.flags || {}), [`sabotage_${rk}_step2_sent`]: true };
        s.awayLog.push({ day: s.day, type: 'letter', text: `A return note concerning ${cfg.name}.` });
      }
    }

    // ── Cleanup expired priceWindows.
    if (s.priceWindows && s.priceWindows.length > 0) {
      s.priceWindows = pruneExpiredWindows(s.priceWindows, s.day);
    }

    // ── Prune fully-elapsed pressure modifiers (lifetime exhausted).
    if (s.rivalPressureModifiers && s.rivalPressureModifiers.length > 0) {
      s.rivalPressureModifiers = s.rivalPressureModifiers.filter(
        m => (s.day - m.fromDay) < m.lifetimeDays
      );
    }

    // ── Recompute rivalPressure.
    s.rivalPressure = computeRivalPressure(s);

    // ── Raid: opportunists at the godown. Stockade halves the chance, the
    // Barracks halves it again. The Magazine caps any single loss at 10%.
    const raidPool = RAID_TEMPTATIONS
      .filter(k => Math.floor(s.outpost.warehouse?.[k] ?? 0) >= 1);
    if (raidPool.length > 0) {
      let raidChance = 0.012;
      if (s.outpost.buildings.stockade?.built) raidChance *= 0.5;
      if (s.outpost.buildings.barracks?.built) raidChance *= 0.5;
      if (Math.random() < raidChance) {
        const target = raidPool[Math.floor(Math.random() * raidPool.length)];
        const have = Math.floor(s.outpost.warehouse[target]);
        let pct = 0.05 + Math.random() * 0.20;
        if (s.outpost.buildings.magazine?.built) pct = Math.min(pct, 0.10);
        const lost = Math.max(1, Math.min(have, Math.floor(have * pct)));
        s.outpost.warehouse[target] = have - lost;
        const unit = COMMODITIES[target].unit;
        const name = COMMODITIES[target].name;
        const raidLines = [
          `A Bugis prahu put men ashore at the back of the godown in the night. ${lost} ${unit} of ${name} carried off before the watch could be roused.`,
          `Thieves cut a panel from the godown wall. ${lost} ${unit} of ${name} taken; the rains came before the trail could be followed.`,
          `Brigands from the inland made a sortie at first light. ${lost} ${unit} of ${name} lost.`,
          `A pilfering hand from within the household. ${lost} ${unit} of ${name} unaccounted for; Sgt. Dass has his suspicions.`,
        ];
        s.awayLog.push({ day: s.day, type: 'raid', text: raidLines[Math.floor(Math.random() * raidLines.length)] });
      }
    }
  }
  // The enterprise remits — established income ventures (the fleet, the bazaar
  // stake) pay their quarter. Felt as a recurring reward beat in the away log.
  if (!s.charterClosed) {
    const acc = accrueVentureIncome(s.ventures, s.day);
    if (acc.income > 0) {
      s.ventures = acc.ventures;
      s.money = (s.money || 0) + acc.income;
      const detail = acc.lines.map(l => `${VENTURES[l.id].name.replace(/ —.*$/, '')} £${l.amount}`).join('; ');
      s.awayLog.push({ day: s.day, type: 'venture', text: `Yr. ventures remitted £${acc.income} this quarter — ${detail}.` });
      s.journal = [...(s.journal || []), { day: s.day, entry: `The enterprise remitted £${acc.income}: ${detail}.` }];
    }

    // Production ventures lodge their own spice into the godown — yr. own
    // gardens and estate, growing yr. supply instead of buying it. Surplus
    // rots for want of room, as the plantation harvest does.
    const prod = accrueVentureProduce(s.ventures, s.day);
    if (prod.yields.length > 0) {
      s.ventures = prod.ventures;
      const cap = warehouseCap(s);
      const stored = {};   // commodity -> cwt actually lodged this quarter
      let lostAny = false;
      for (const y of prod.yields) {
        const used = cargoWeight(s.outpost.warehouse);
        const room = Math.max(0, cap - used);
        const fit = Math.min(y.amount, Math.floor(room / (COMMODITIES[y.commodity].weight || 1)));
        if (fit > 0) s.outpost.warehouse[y.commodity] = (s.outpost.warehouse[y.commodity] || 0) + fit;
        if (fit < y.amount) lostAny = true;
        stored[y.commodity] = (stored[y.commodity] || 0) + fit;
      }
      const detail = Object.entries(stored).filter(([, n]) => n > 0)
        .map(([c, n]) => `${n} cwt ${COMMODITIES[c].name.toLowerCase()}`).join(' and ');
      if (detail) {
        const txt = lostAny
          ? `Yr. own gardens yielded their season into the godown — ${detail} — though some was lost to the rains for want of room.`
          : `Yr. own gardens yielded their season into the godown — ${detail}, bought from no one.`;
        s.awayLog.push({ day: s.day, type: 'harvest', text: txt });
        s.journal = [...(s.journal || []), { day: s.day, entry: txt }];
      }
    }

    // Living ventures: the established enterprise occasionally throws an event —
    // a windfall, a setback, or news worth pursuing — on a cooldown so it reads
    // as a beat, not noise. One roll per home-station tick.
    if (establishedVentureCount(s.ventures) > 0 &&
        (s.day - (s.ventureEventDay || 0)) >= 45 &&
        Math.random() < 0.22) {
      const excl = [...(s.ventureEventsFired || []), s.lastVentureEventId].filter(Boolean);
      const ev = pickVentureEvent(s.ventures, excl, Math.random());
      if (ev) {
        s.ventureEventDay = s.day;
        s.lastVentureEventId = ev.id;
        if (ev.once) s.ventureEventsFired = [...(s.ventureEventsFired || []), ev.id];
        if (typeof ev.money === 'number') s.money = Math.max(0, (s.money || 0) + ev.money);
        if (ev.produce) {
          const cap = warehouseCap(s);
          const room = Math.max(0, cap - cargoWeight(s.outpost.warehouse));
          const fit = Math.min(ev.produce.amount, Math.floor(room / (COMMODITIES[ev.produce.commodity].weight || 1)));
          if (fit > 0) s.outpost.warehouse[ev.produce.commodity] = (s.outpost.warehouse[ev.produce.commodity] || 0) + fit;
        }
        if (ev.hook && !s.hooks.includes(ev.hook)) s.hooks = [...s.hooks, ev.hook];
        s.awayLog.push({ day: s.day, type: 'venture', text: ev.text });
        s.journal = [...(s.journal || []), { day: s.day, entry: ev.text }];
      }
    }
  }
  return s;
}

// ─────────── API: GENERATIVE PROSE ───────────

const SYSTEM_PROMPT = `You are the narrator of "The Factor's Charter," a text-based game in the spirit of Robinson Crusoe, Sunless Sea, and Morrowind's House Hlaalu. Setting: a vaguely Southeast-Asian colonial frontier, early 1720s. POV: a junior trading-company Factor.

VOICE: Dry, observational, period-appropriate. Sensory details (heat, salt, mildew, palm oil, gun smoke). No anachronisms — no "okay," no modern idiom. Specific, not generic. Slight melancholy, occasional dark humor. Names of people and ships should sound period-plausible.

PROSE DISCIPLINE:
- Concrete sensory detail over metaphor. Plain observation does the work; figurative language is a seasoning, not the dish. At most one metaphor or simile per passage. Prefer the named thing to the comparison.
- Short sentences when the matter is small. Long sentences only when they earn it.
- Avoid clauses that explain what the prose has already shown.

WORLD GROUNDING (do not violate):
- The Factor's home station is Bayan-Kor. The named characters who live there are Mr. Hodge (clerk, drunkard), Sgt. Dass (sepoy), the Rajah's Vizier, and Reverend Pyke (at the Mission). These characters can ONLY appear in scenes set at Bayan-Kor or via correspondence.
- The other ports — Kota Pinang, Port St. Eustace, The Pelican's Nest — are reached only by voyage. They have their own anonymous local populations (harbormasters, merchants, soldiers, etc.).
- A scene that takes place at sea or in a non-home port must NOT introduce home-station characters in person. If they appear, they must be aboard the Factor's ship explicitly, or referenced via letters, never bumped into ashore elsewhere.
- The Mission is at Bayan-Kor. The Reverend cannot be "visited" at any other port.

WORLD STATE (you may extend it):
- Outcomes can plant minor characters into the world via "newAcquaintances": [{ "name", "role", "location", "notes" }]. These characters persist; later scenes will see them in the state context and may bring them back. Use period-plausible names. Don't duplicate existing acquaintances or named home-station characters.
- Outcomes at sea or under combat can damage the ship via "shipDamage": { "hull": int 0–40, "sails": int 0–40 }. Both fields optional. Only use this when the prose justifies it (storm, gunfire, grounding). Letter outcomes must NEVER set shipDamage.
- Outcomes can set narrative flags via "flags": { "key": value }. Be very sparing. ONE flag per fact — do not set paired flags that mean the same thing (e.g. "askedX: true" + "awaitingReplyOnX: true" is one fact, set one). Only set a flag if a later scene or letter could plausibly reference it. Flags are durable state, not journal entries.
- Outcomes may add a "hook" — but before doing so, consider the open threads listed in the state context. If a new hook restates an existing one, REFINE the existing thread instead by leaving "hook" empty (the world keeps the older thread). Add a hook only when it is genuinely a new thread the world would not otherwise hold.

CONSTRAINTS: Output ONLY valid JSON. No code fences, no preamble, no commentary. Stay within the requested length.`;

// Artifact mode: window.storage exists and the host bridges Anthropic auth/CORS.
// PWA mode: no live AI; return an empty result so callers fall through to deterministic content.
// Returns: { parsed, raw, prompt, startedAt, endedAt, error }.
async function callClaude(prompt) {
  const isArtifactMode = typeof window !== 'undefined' && !!window.storage;
  if (isArtifactMode) {
    return legacyAnthropicCall(prompt);
  }
  const now = Date.now();
  return {
    parsed: null,
    raw: '',
    prompt,
    startedAt: now,
    endedAt: now,
    error: 'PWA deterministic mode — no live AI',
  };
}

async function legacyAnthropicCall(prompt) {
  const startedAt = Date.now();
  // A hung API call would otherwise pin the loading screen forever — every
  // caller has a deterministic fallback, so abort and let it take over.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data?.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    let parsed = null;
    let parseError = null;
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch (e) { parseError = e.message; }
    }
    return { parsed, raw: text, prompt, startedAt, endedAt: Date.now(), error: parseError };
  } catch (e) {
    console.error('API error:', e);
    return { parsed: null, raw: '', prompt, startedAt, endedAt: Date.now(), error: e.message || String(e) };
  } finally {
    clearTimeout(timeout);
  }
}

// ─────────── LORE ───────────
// World-building entries surfaced to the AI in the prompt only when their
// trigger conditions match the current state. Add new entries here when a
// real-world history, a place, or a character idea would enrich how the AI
// writes about a location, faction, or moment. Keep texts tight (2–4 short
// sentences) — every line eats prompt budget on every relevant call.
//
// Trigger keys (any combination, all must match):
//   location   — exact port name (e.g. 'Bacalar Lagoon')
//   visited    — only after the Factor has been to this port
//   flag       — only when gs.flags[flag] is truthy
//   repAtLeast — { factionKey: minRep }, all keys must satisfy
//   always     — true (campaign-wide flavor; use sparingly)
//
// You can also add a `tag` for grouping (e.g. 'pirate-haven') for future
// triggers that match by tag rather than by single key.

const LORE = [
  {
    key: 'bayan-kor',
    tag: 'home',
    trigger: { location: 'Bayan-Kor' },
    text: 'Bayan-Kor is small: a thatched godown, a leaky dock, the Rajah’s palace on the green hill above. The wet season runs March to October; everything wooden warps in it. The Rajah keeps his court in the Malay style and prefers the Friday audience to any other day. Sgt. Dass commands a sepoy garrison of three at full strength; less, when fever takes one.',
  },
  {
    key: 'kota-pinang',
    tag: 'sultanate',
    trigger: { location: 'Kota Pinang' },
    text: 'Kota Pinang sits up the strait, a Malay sultanate that suffers Europeans for the duty they pay. The Sultan’s harbourmaster is a Bugis named Daeng Mamping who notes every ship and every man aboard her. Pepper comes down from the hills in baskets each new moon. The Sultan takes a tenth of everything bought, and weighs it himself when he doubts.',
  },
  {
    key: 'port-st-eustace',
    tag: 'dutch',
    trigger: { location: 'Port St. Eustace' },
    text: 'Port St. Eustace is whitewashed and orderly, the only paved street east of Malacca. The Dutch House keeps three factors in residence and a Calvinist minister who preaches against Asian pleasures with no measurable effect. Their Bugis interpreters are paid better than most English captains. They watch the Strait and they keep ledgers; what they do with the ledgers is their own concern.',
  },
  {
    key: 'pelicans-nest',
    tag: 'pirate-haven',
    trigger: { location: 'The Pelican’s Nest' },
    text: 'The Pelican’s Nest is a hidden cove east of the chart, with a mangrove channel that admits no ship larger than a sloop without a pilot. The Brotherhood holds court here; their captains are Dutchmen, Bugis, English deserters, and one renegado Portuguese who was a bishop’s son. No flag flies on a fixed mast. The water is fresh from a spring at the head of the bay, and that is why the Brotherhood chose it.',
  },
  {
    // Inspired by the history of Bacalar (Yucatan): a coastal lagoon held by
    // pirates from the 1648 sack onward, "lagoon of seven colours" for the
    // bands of blue, repeatedly contested and refortified by the colonial
    // power. Transposed here to a Southeast-Asian context — abandoned
    // Portuguese fortresses are period-plausible since Malacca fell to the
    // Dutch in 1641 and Iberian outposts went dark across the region.
    key: 'tanjung-cermin',
    tag: 'pirate-haven',
    trigger: { location: 'Tanjung Cermin' },
    text: 'Tanjung Cermin shows seven distinct shades of blue from the dock to the deep — the Bugis call it the cape of mirrors. The Portuguese fort on the inner island is a ruin; its garrison withdrew when Malacca fell to the Dutch in ’41, and no power has held the cove since. The Brotherhood meets in its old chapel each monsoon to settle accounts. The Padre who blessed the keystones lies somewhere among the palms; the marker was long since taken for firewood.',
  },
  {
    // Fort Marlborough — a real British EIC factory at Bencoolen on the
    // west coast of Sumatra, established 1685 after the loss of Bantam to
    // the Dutch. Pepper-trade outpost, Royal Navy water station, garrisoned
    // by a few dozen Madras-establishment troops. Period-correct in every
    // particular for the 1720s.
    key: 'fort-marlborough',
    tag: 'crown-station',
    trigger: { location: 'Fort Marlborough' },
    text: 'Fort Marlborough is the Honourable Company’s factory on the west coast of Sumatra — pepper port, water station, garrison of fifty under a Madras lieutenant. The Royal Navy puts in for stores and intelligence; the Court at Leadenhall reckons the place a difficult one but theirs. The fever takes one in three Englishmen who come ashore through the wet season. The pepper, however, is the cleanest in the East.',
  },
];

function loreForState(gs) {
  if (!Array.isArray(LORE) || LORE.length === 0) return [];
  return LORE.filter(e => {
    const t = e.trigger || {};
    if (t.always) return true;
    if (t.location && gs.location !== t.location) return false;
    if (t.visited && !gs.visited?.includes(t.visited)) return false;
    if (t.flag && !gs.flags?.[t.flag]) return false;
    if (t.repAtLeast) {
      for (const [f, n] of Object.entries(t.repAtLeast)) {
        if ((gs.reputation?.[f] || 0) < n) return false;
      }
    }
    return true;
  }).slice(0, 3); // cap to keep prompt budget under control
}

// ─────────── STANDING ARRANGEMENTS (curated flag display) ───────────
// gs.flags accumulates many keys over a charter — some are scripted
// commitments the player chose deliberately, most are AI-set narrative
// state used internally by stateContext. Only the curated ones below are
// surfaced to the player as "Standing Arrangements." The label function
// receives the flag value and returns the readable line, or null to hide.

const MAJOR_COMMITMENTS = [
  { key: 'teakConcession', label: (v) =>
      v === 'self'     ? 'The inland teak concession — held by the Company.' :
      v === 'dutch'    ? 'The inland teak concession — sold on to ter Borch.' :
      v === 'declined' ? 'The inland teak concession — declined; the matter rests.' :
      null },
  { key: 'dutchTradePass',     label: (v) => v ? 'A Dutch writ of free trade — in the strongbox.' : null },
  { key: 'dutchPassDeclined',  label: (v) => v ? 'Mynheer Boom’s offer of a writ — refused.' : null },
  { key: 'carryingDutchPacket',label: (v) => v ? 'A sealed packet for Mynheer Boom — yet to be delivered.' : null },
  { key: 'dutchLedgerSeen',    label: (v) => v ? 'You have seen what was in the Dutchman’s seal.' : null },
  { key: 'dutchPacketJettisoned', label: (v) => v ? 'You cast the Dutchman’s packet into the harbour. Boom does not yet know.' : null },
  { key: 'brotherhoodCompact', label: (v) => v ? 'The Brotherhood compact — yr. ships safe in the strait.' : null },
  { key: 'brotherhoodDeclined',label: (v) => v ? 'Capt. Maas’s compact — declined.' : null },
  { key: 'brotherhoodRefused', label: (v) => v ? 'Capt. Maas’s compact — refused plainly. The strait is meaner.' : null },
  { key: 'subscribedToSchool', label: (v) =>
      v === 'generous' ? 'The Mission school — generously subscribed (£100).' :
      v === 'modest'   ? 'The Mission school — subscribed at the modest figure (£30).' :
      null },
  { key: 'pykeSchoolDeclined', label: (v) => v ? 'The Mission school subscription — declined.' : null },
  { key: 'gaveCrownIntelligence', label: (v) => v ? 'Crown — passed intelligence on the Brotherhood to HMS Adventure.' : null },
  { key: 'advancedCrownCredit',label: (v) => v ? 'Crown — £100 advanced to HMS Adventure against the Bombay credit.' : null },
  { key: 'declinedCrownService', label: (v) => v ? 'Capt. Whitcombe’s requests — declined.' : null },
  { key: 'faulkeQuestStep', label: (v) =>
      v === 'paid'                     ? 'Capt. Faulke gone north on yr. account; word expected.' :
      v === 'awaiting-decision'        ? 'Faulke’s intelligence on Carel sits in yr. drawer.' :
      v === 'closed-crown'             ? 'Carel’s cove was given to the Crown; the Brotherhood will know.' :
      v === 'closed-brotherhood'       ? 'Carel was warned; the Brotherhood owes you.' :
      v === 'closed-handed-to-crown'   ? 'Faulke’s first note was passed to the Crown.' :
      v === 'sat-on'                   ? 'Faulke’s intelligence is held back; the matter rests.' :
      v === 'declined'                 ? 'Capt. Faulke’s proposal — declined.' :
      null },
  { key: 'brotherhoodAlerted', label: (v) => v ? 'The Brotherhood knows you informed.' : null },
  { key: 'companyFaction', label: (v) =>
      v === 'speculative'  ? 'A private correspondence with Mr. Dryden of the Speculative Bench.' :
      v === 'conservative' ? 'Yr. file is held in proper Madras format with the senior bench.' :
      v === 'declined'     ? 'You refused Mr. Dryden\'s private channel; he has not forgotten.' :
      null },
  { key: 'mountfairPatron', label: (v) =>
      v === true       ? 'Lord Mountfair is yr. patron at the Court; the introduction is in the books.' :
      v === 'declined' ? 'Lord Mountfair offered patronage; you declined with civilities.' :
      null },
  { key: 'paleManQuest', label: (v) =>
      v === 'pending'              ? 'A sealed packet from an unknown hand sits in yr. strongbox.' :
      v === 'opened'               ? 'You mean to meet the pale man at Kota Pinang the next moon.' :
      v === 'declined'             ? 'The pale man\'s letter was burned; the matter is closed.' :
      v === 'crown'                ? 'The pale man\'s letter was forwarded to the Crown.' :
      v === 'closed-contracted'    ? 'A contraband contract with the pale man — opium from the Nest to Eustace.' :
      v === 'closed-half-contract' ? 'A reduced contract with the pale man — half the cargo, less the risk.' :
      v === 'closed-declined-late' ? 'You declined the pale man\'s offer at the Kota Pinang wharf.' :
      v === 'closed-crown-bounty'  ? 'The Crown took the pale man (Mr. Holcombe of the Bombay establishment); £120 bounty paid.' :
      v === 'closed-delivered'     ? 'The contract is fulfilled. Opium delivered at Eustace under cover; £400 paid.' :
      v === 'closed-delivered-half'? 'The reduced contract is fulfilled. £200 paid by the trusted runner.' :
      v === 'closed-caught'        ? 'Caught at the Eustace customs. The cargo is gone, the Dutch know yr. face.' :
      v === 'closed-cargo-lost'    ? 'The pale man\'s contract is void; the opium was not in yr. hold for the drop.' :
      null },
  { key: 'wilbrahamMystery', label: (v) =>
      v === 'pending'                  ? 'Sgt. Dass has written on the matter of Mr. Wilbraham\'s last night.' :
      v === 'asked-reverend'           ? 'You have asked the Reverend why he did not come down that night.' :
      v === 'asked-hodge'              ? 'You have a note in yr. own hand from Hodge\'s confession on Mr. Wilbraham.' :
      v === 'closed-rested'            ? 'Mr. Wilbraham\'s last night, on yr. office\'s judgement, may rest.' :
      v === 'closed-prayed'            ? 'You and the Reverend Pyke prayed together on Mr. Wilbraham; the Mission is closer.' :
      v === 'closed-broken'            ? 'You broke with the Mission over the Reverend\'s confession; the chapel will not see yr. shadow.' :
      v === 'closed-pursuing-dutch'    ? 'You wrote to ter Borch on Mr. Wilbraham\'s gambling debts; he denies all.' :
      v === 'closed-confronted-dutch'  ? 'You confronted ter Borch on the kitchen jar; the Hollander\'s door is the colder for it.' :
      v === 'closed-vizier'            ? 'The Vizier handled ter Borch\'s clerk for you. The favour is yrs. to be reminded of.' :
      v === 'closed-buried'            ? 'You burned Hodge\'s note on Mr. Wilbraham; the matter died with the morning.' :
      v === 'closed-settled'           ? 'Ter Borch destroyed Wilbraham\'s gambling draft at yr. word; the matter is closed.' :
      v === 'closed-evidence-held'     ? 'Wilbraham\'s draft, in his own hand, sits in yr. strongbox. Evidence enough.' :
      v === 'closed-rebuked'           ? 'Ter Borch rebuked yr. letter; the Hollander\'s door is the cooler for it.' :
      v === 'closed-pressed'           ? 'You pressed ter Borch; the Eustace customs grow slower for it.' :
      v === 'closed-duelled'           ? 'Met ter Borch at twelve paces on a coral spit; he fell at the first exchange.' :
      v === 'closed-refused-duel'      ? 'Refused ter Borch\'s challenge; the Eustace customs are closed against yr. ship.' :
      null },
  { key: 'cylinderQuest', label: (v) =>
      v === 'pending'              ? 'Idris\'s cylinder lies under yr. weights; he has written.' :
      v === 'opened'               ? 'You have read Idris\'s Bugis schedules; the matter is yrs. to resolve.' :
      v === 'returning'            ? 'Idris\'s cylinder is set aside for Hamzah at Kota Pinang.' :
      v === 'held'                 ? 'Idris\'s cylinder still sits unanswered; pressure may grow.' :
      v === 'closed-sold-bugis'    ? 'Said bin Mahmood has the schedules; £80 in unmarked silver.' :
      v === 'closed-sold-crown'    ? 'The Crown has Idris\'s schedules; the Brotherhood will hear.' :
      v === 'closed-burned'        ? 'You burned Idris\'s schedules; the matter is closed.' :
      v === 'closed-honor'         ? 'Hamzah received the cylinder unopened; the Bugis houses note it.' :
      v === 'closed-handed-over'   ? 'You handed the cylinder to the unnamed Bugis caller.' :
      v === 'closed-refused'       ? 'You refused the unnamed caller; the watch is heavier.' :
      v === 'closed-forged'        ? 'A forged copy was given; the original sleeps in yr. strongbox.' :
      null },

  // Sabotage arcs (committed-but-unresolved surface as a Standing
  // Arrangement; resolved outcomes surface for the rest of the charter).
  // The 'declined' value is intentionally not surfaced — declining closes
  // the arc cleanly and there is nothing to remember in the ledger.
  { key: 'sabotage_hardacre_method', label: (v) =>
      v === 'commission' ? 'A Brotherhood lifting at Bencoolen — committed; awaiting word.' :
      v === 'negotiate'  ? 'A Brotherhood matter at Bencoolen — bargained-for; awaiting word.' :
      null },
  { key: 'sabotage_hardacre_resolved', label: (v) =>
      v === 'success' ? 'Mr. Hardacre walks the Bencoolen wharf with no command.' :
      v === 'partial' ? 'Mr. Hardacre lost a freight in the strait; he kept his bottom.' :
      v === 'failure' ? 'A Brotherhood matter at Bencoolen — done badly; yr. name was named.' :
      null },
  { key: 'sabotage_terborch_method', label: (v) =>
      v === 'commission' ? 'A customs matter against Mynheer ter Borch — committed; awaiting word.' :
      v === 'negotiate'  ? 'A customs matter against Mynheer ter Borch — bargained-for; awaiting word.' :
      null },
  { key: 'sabotage_terborch_resolved', label: (v) =>
      v === 'success' ? 'Mynheer ter Borch is at Batavia under inquiry.' :
      v === 'partial' ? 'Mynheer ter Borch was lightly fined; he kept Eustace.' :
      v === 'failure' ? 'A customs matter against ter Borch — done badly; Eustace was closed to you.' :
      null },
  { key: 'sabotage_lowji_method', label: (v) =>
      v === 'commission' ? 'A loan-recall against Mr. Lowji — Cama is moving on it.' :
      v === 'negotiate'  ? 'A loan-recall against Mr. Lowji — bargained-for; Cama is moving on it.' :
      null },
  { key: 'sabotage_lowji_resolved', label: (v) =>
      v === 'success' ? 'Mr. Lowji is gone home to Surat; Bombay is the smaller place for it.' :
      v === 'partial' ? 'Mr. Lowji is the smaller man for two bottoms.' :
      v === 'failure' ? 'A loan-recall against Lowji — Cama\'s hand was seen; £200 was called against you.' :
      null },
];

function commitmentsFor(gs) {
  if (!gs.flags) return [];
  const out = [];
  for (const c of MAJOR_COMMITMENTS) {
    const v = gs.flags[c.key];
    if (v === undefined || v === null || v === false) continue;
    // Sabotage: once resolved, suppress the "awaiting word" method line —
    // the resolved-line carries the ledger entry from then on.
    const sabotageMethodMatch = /^sabotage_(\w+)_method$/.exec(c.key);
    if (sabotageMethodMatch && gs.flags[`sabotage_${sabotageMethodMatch[1]}_resolved`]) continue;
    const line = c.label(v);
    if (line) out.push({ key: c.key, line });
  }
  return out;
}

// ─────────── SCRIPTED ARRIVAL ENCOUNTERS ───────────
// Curated, choice-driven moments that fire on arrival at a non-home port,
// when a trigger condition (flag, location, standing) matches. Each choice
// carries deterministic outcome prose + changes — no AI generation on the
// mechanical side, since these are load-bearing story payoffs.
//
// Trigger keys (any combination, all must match):
//   flag       — gs.flags[flag] is truthy
//   location   — exact destination port name
//   locationIn — destination is one of these port names
//   repAtLeast — { factionKey: minRep }
//   visited    — destination has been visited at least once before

const SCRIPTED_ARRIVALS = [
  {
    key: 'dutch-packet',
    trigger: {
      flag: 'carryingDutchPacket',
      locationIn: ['The Pelican’s Nest', 'Tanjung Cermin'],
    },
    title: 'The Dutchman’s Packet',
    prose: 'A wharf-rat with a missing thumb finds you before yr. men have set the gangway down. He gives the Bugis word for paper and offers a hand. The sealed packet from Mynheer Boom has been in yr. coat since Eustace; the man waits, no warmer for waiting.',
    choices: [
      {
        label: 'Hand the packet over without ceremony',
        prose: 'He takes it, signs nothing, and is gone before yr. clerk has noted the matter. The errand is done. What was in the wax is no longer yr. concern.',
        changes: {
          reputation: { dutch: 5 },
          flags: { carryingDutchPacket: false, deliveredDutchPacket: true },
          journal: 'Delivered Mynheer Boom’s packet at the wharf, into a hand I did not learn the name of. The Dutch may be counted to remember it.',
        },
      },
      {
        label: 'Open the seal first, then deliver',
        prose: 'You break the wax in yr. cabin before he is brought aboard. The papers are accounts in a Dutch hand: names of English captains and the prices they paid for Brotherhood passages, with sums and dates back four years. You re-seal as best you can; the wharf-rat takes it without remark, but his look is one degree colder.',
        changes: {
          reputation: { dutch: 2 },
          flags: { carryingDutchPacket: false, openedDutchPacket: true },
          journal: 'Read Mynheer Boom’s packet before delivery — accounts of English captains who have bought Brotherhood passages. Re-sealed and handed over. The Dutch are watching what is paid in this strait.',
          hook: 'The Dutch ledger of English-pirate dealings — names and sums, four years back. Use of which is not yet apparent.',
        },
      },
      {
        label: 'Cast the packet into the harbour',
        prose: 'You drop it overboard before he reaches the gangway. The seal vanishes in the green water. Yr. man at the rail watches without comment. The Brotherhood’s eyes are everywhere; somewhere yr. choice will be remarked.',
        changes: {
          reputation: { dutch: -8, pirates: 3 },
          flags: { carryingDutchPacket: false, jettisonedDutchPacket: true },
          journal: 'Threw Mynheer Boom’s packet into the harbour before it could change hands. Boom will hear of it.',
          hook: 'Boom’s lost packet — the Dutch House at Eustace will not let the matter rest.',
        },
      },
    ],
  },
];

function pickArrivalEncounter(gs, dest) {
  if (!Array.isArray(SCRIPTED_ARRIVALS)) return null;
  for (const e of SCRIPTED_ARRIVALS) {
    const t = e.trigger || {};
    if (t.flag && !gs.flags?.[t.flag]) continue;
    if (t.location && t.location !== dest) continue;
    if (t.locationIn && !t.locationIn.includes(dest)) continue;
    if (t.visited && !gs.visited?.includes(dest)) continue;
    if (t.repAtLeast) {
      let ok = true;
      for (const [f, n] of Object.entries(t.repAtLeast)) {
        if ((gs.reputation?.[f] || 0) < n) { ok = false; break; }
      }
      if (!ok) continue;
    }
    return e;
  }
  return null;
}

const stateContext = (gs) => {
  const reps = Object.entries(gs.reputation)
    .filter(([,v]) => v !== 0)
    .map(([k,v]) => `${FACTIONS[k].short}: ${v > 0 ? '+' : ''}${v} (${repTone(v)})`)
    .join(', ') || 'none of note';
  const recentJournal = gs.journal.slice(-3).map(j => j.entry).join(' / ') || 'none';
  const hooks = (gs.hooks || []).slice(-3).join(' | ') || 'none';
  const acquaintances = (gs.acquaintances || []).slice(-6)
    .map(a => `${a.name} (${a.role}${a.location ? `, ${a.location}` : ''}${a.notes ? `: ${a.notes}` : ''})`)
    .join(' | ') || 'none';
  const flagEntries = Object.entries(gs.flags || {});
  const flags = flagEntries.length
    ? flagEntries.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')
    : 'none';
  const ship = gs.ship ? `Ship: ${gs.ship.name}, hull ${gs.ship.hull}/100, sails ${gs.ship.sails}/100` : '';
  // Quota / godown context — lets the model reference the Factor's reckoning
  // (e.g. an encounter that mentions a godown half-full of pepper, or a
  // letter that nods to how close the next Indiaman is).
  const peppShipped = Math.floor(gs.quotas?.pepper?.have   || 0);
  const cinnShipped = Math.floor(gs.quotas?.cinnamon?.have || 0);
  const peppLodged  = Math.floor(gs.outpost?.warehouse?.pepper   || 0);
  const cinnLodged  = Math.floor(gs.outpost?.warehouse?.cinnamon || 0);
  const reckoning = `Reckoning: pepper ${peppShipped}/${gs.quotas?.pepper?.needed ?? 400} shipped (+${peppLodged} in godown); cinnamon ${cinnShipped}/${gs.quotas?.cinnamon?.needed ?? 200} shipped (+${cinnLodged} in godown)`;
  const i = gs.indiaman || {};
  const indiamanLine = i.nextDay
    ? `Next Indiaman due in ${Math.max(0, i.nextDay - gs.day)} days (${(i.visits || 0)}/${INDIAMAN_TOTAL} calls made)`
    : 'Indiaman schedule not yet known';
  // Lore — only the entries whose triggers match the current state.
  const lore = loreForState(gs).map(e => `[${e.key}] ${e.text}`).join(' ');
  const loreLine = lore ? ` Local knowledge: ${lore}` : '';
  return `Day ${gs.day}. Location: ${gs.location}. ${ship}. Crew: ${gs.crew.map(c=>`${c.name} (${c.trait} ${c.role})`).join(', ')}. Reputation: ${reps}. ${reckoning}. ${indiamanLine}. Days remaining on charter: ${gs.daysRemaining}. Recent: ${recentJournal}. Open threads: ${hooks}. Acquaintances: ${acquaintances}. Flags: ${flags}.${loreLine}`;
};

// Deterministic pool for genVoyageEncounter fallback. Each entry is
// self-contained — anonymous crew (bosun, lookout, carpenter), concrete
// sensory detail, three labeled choices with seed phrases. Picked at random
// on every fallback. Pool covers weather (squalls, calms, fog), navigation
// (reefs), other vessels (sails, junks, sloops), wildlife (whales),
// maintenance (pump leak), atmospheric (lights ashore, castaway timber).
// No home-station NPCs (Hodge, Dass, Vizier, Pyke) — those are Bayan-Kor only.
// Each choice carries an outcomeKey that routes the fallback outcome into
// one of the FALLBACK_OUTCOME_BUCKETS — so the player's chosen lever
// actually steers what kind of thing happens (cost / damage / day lost
// / windfall / rep_shift / hook_opens) rather than rolling uniformly across
// every possible result. Choice-level overrides (hook text on hook_opens,
// repFaction/repDelta on rep_shift) flavour the bucket pick.
//
// Seed strings double as the player-facing hint rendered under each
// choice — written in plain period English, not prompt-engineering jargon.
const FALLBACK_VOYAGE_ENCOUNTERS = [
  {
    prose: 'A line of squalls runs along the horizon. The wind drops, then turns. The bosun looks to you for orders.',
    choices: [
      { label: 'Run before the weather, lose a day', outcomeKey: 'time_lost', seed: 'Lose a day. No harm.' },
      { label: 'Stand on the course, trust the rigging', outcomeKey: 'damage', seed: 'Risk damage for the time.' },
      { label: 'Reef and ride it out', outcomeKey: 'time_lost', seed: 'Safe but slow.' },
    ],
  },
  {
    prose: 'The wind has fallen. The sails go slack against the yards; the heat lies on the deck like a cloth. The bosun gauges the sun and waits on yr. word.',
    choices: [
      { label: 'Send the boats out to tow', outcomeKey: 'cost', seed: 'Hard on the crew. A bill at next port.' },
      { label: 'Hold and wait the wind', outcomeKey: 'time_lost', seed: 'Days lost. No harm.' },
      { label: 'Try a sounding for current', outcomeKey: 'hook_opens', hook: 'An east-running current beyond what the chart shows. Worth a fresh sounding next leg.', seed: 'Plant a thread. May serve later.' },
    ],
  },
  {
    prose: 'A grey wall of fog comes off the lee shore at the change of watch. The lookout calls "Cant see the bowsprit," and the bosun asks if we should anchor.',
    choices: [
      { label: 'Drop anchor, ride till it lifts', outcomeKey: 'time_lost', seed: 'Safe. A day’s drift.' },
      { label: 'Press on with leadsman in the chains', outcomeKey: 'damage', seed: 'Risk of grounding.' },
      { label: 'Stand off, work to windward', outcomeKey: 'time_lost', seed: 'Safe but slow.' },
    ],
  },
  {
    prose: 'A sail shows two leagues to leeward, hull-down on the haze. No flag flies, and she keeps her distance. The bosun reaches for the glass.',
    choices: [
      { label: 'Crowd on canvas and run', outcomeKey: 'windfall', seed: 'Save the time. Possibly a small purse.' },
      { label: 'Stand on under reduced sail', outcomeKey: 'time_lost', seed: 'Cautious. A day lost.' },
      { label: 'Make the recognition signal and wait', outcomeKey: 'rep_shift', repFaction: 'company', repDelta: 2, seed: 'A friendly captain notes yr. flag.' },
    ],
  },
  {
    prose: 'The leadsman calls a sudden shoaling — six fathoms, then four, then less. The chart says deep water; the chart is older than yr. grandfather. The bosun waits.',
    choices: [
      { label: 'Heave to and sound carefully', outcomeKey: 'time_lost', seed: 'Lose half a day. Safe.' },
      { label: 'Put her on the other tack and stand off', outcomeKey: 'time_lost', seed: 'No harm. Some delay.' },
      { label: 'Trust the chart, press on', outcomeKey: 'damage', seed: 'Risk grounding.' },
    ],
  },
  {
    prose: 'No air stirs. The sails hang slack; the deck timbers crack in the heat. A boy aft is taken with the gripes, and the bosun calls for the grog.',
    choices: [
      { label: 'Issue the grog, see the boy fed', outcomeKey: 'cost', seed: 'Crew settled. A small bill.' },
      { label: 'Put the men to scrubbing the deck', outcomeKey: 'time_lost', seed: 'Discipline. A day passes.' },
      { label: 'Wait it out without ceremony', outcomeKey: 'time_lost', seed: 'A flat day. Crew dispirited.' },
    ],
  },
  {
    prose: 'A high-pooped junk passes close to leeward, her crew dressed in indigo, her bowsprit cocked at an angle. She hails in no language you know but dips her foresail by way of greeting.',
    choices: [
      { label: 'Salute in return and stand on', outcomeKey: 'windfall', seed: 'A courtesy returned, in time.' },
      { label: 'Heave to and trade signs', outcomeKey: 'hook_opens', hook: 'A junk captain in indigo who dipped his foresail and might know yr. face again.', seed: 'Plant a thread. Lose time.' },
      { label: 'Keep clear and hold the course', outcomeKey: 'time_lost', seed: 'No exchange. Day passes.' },
    ],
  },
  {
    prose: 'The carpenter reports the pump on the larboard side is making more water than it shifts. He will have her tight again in half a day if you heave to. Otherwise she will bear up, but the bilges will not be sweet.',
    choices: [
      { label: 'Heave to and let him work', outcomeKey: 'time_lost', seed: 'Half a day lost. Ship sound.' },
      { label: 'Bear up; repair at the next port', outcomeKey: 'damage', seed: 'Minor wear. No time lost.' },
      { label: 'Set the watch to bailing in turn', outcomeKey: 'cost', seed: 'Tired crew. A small bill in grog.' },
    ],
  },
  {
    prose: 'Two lights show on the dark coast as the sun sets, and a third farther out — blinking, deliberate. The bosun thinks it is signalling. You are too far off to make sense of it.',
    choices: [
      { label: 'Stand off, keep wide of the shore', outcomeKey: 'time_lost', seed: 'Safe. Day passes.' },
      { label: 'Beat in for a closer look', outcomeKey: 'hook_opens', hook: 'A signal-light pattern off the Pelican’s Nest line; wreckers’ code, the bosun thinks. They will have seen our shape against the dusk.', seed: 'Risk being seen. Plant a thread.' },
      { label: 'Mark the coordinates and stand on', outcomeKey: 'hook_opens', hook: 'Coordinates of an unexplained signal-light, set down for later inquiry.', seed: 'Plant a thread quietly.' },
    ],
  },
  {
    prose: 'A low sloop appears two points off the bow — dark hull, dark sail, no colours flying. She does not approach but does not fall away either. The bosun has the helm and asks the question.',
    choices: [
      { label: 'Crowd on canvas and run', outcomeKey: 'damage', seed: 'Risk wear from the chase.' },
      { label: 'Stand on and trust to luck', outcomeKey: 'hook_opens', hook: 'A dark sloop that ran parallel for an afternoon and never showed her flag.', seed: 'Plant a thread quietly.' },
      { label: 'Beat to leeward to put her in our wake', outcomeKey: 'time_lost', seed: 'Lose time. Safe.' },
    ],
  },
  {
    prose: 'A whale comes up not a cable from the larboard quarter and rolls a long flank above the swell, blowing once before going under. The bosun crosses himself; the sailors are silent for a quarter-hour.',
    choices: [
      { label: 'Make the customary signs and stand on', outcomeKey: 'time_lost', seed: 'A quiet day.' },
      { label: 'Mark the bearing — they say the deeps follow', outcomeKey: 'hook_opens', hook: 'A whale-mark in the log; the bosun says deep water follows the path. Worth a sounding next charter.', seed: 'Plant a thread for the future.' },
      { label: 'Pay it no mind, drive the work on', outcomeKey: 'cost', seed: 'Crew uneasy. A small bill in grog.' },
    ],
  },
  {
    prose: 'The lookout calls out a piece of broken timber riding the swell, painted white above the line. Likely a fishing-boat that did not come home. There may be a man on it; there may not.',
    choices: [
      { label: 'Heave to and search the water', outcomeKey: 'windfall', seed: 'Lose half a day. Possible gain.' },
      { label: 'Mark the position and report at the next port', outcomeKey: 'rep_shift', repFaction: 'crown', repDelta: 1, seed: 'A small word reaches the Crown.' },
      { label: 'Pass it by — we have timber enough', outcomeKey: 'cost', seed: 'Crew uneasy. A small bill.' },
    ],
  },
  {
    prose: 'A waterspout stands up off the starboard bow — a grey rope of sea and sky, twisting, walking slowly across yr. course. The bosun has seen one break a mast and seen one pass like a ghost. He waits on yr. word, and not patiently.',
    choices: [
      { label: 'Bear away hard and give it room', outcomeKey: 'time_lost', seed: 'Lose ground. Safe.' },
      { label: 'Hold the course and trust it passes', outcomeKey: 'damage', seed: 'Risk the rigging.' },
      { label: 'Fire the swivel to break it, by the old belief', outcomeKey: 'cost', seed: 'Powder spent. The crew steadied.' },
    ],
  },
  {
    prose: 'A vessel lies low in the water two cables off — dismasted, abandoned, her deck awash but not yet gone under. Casks show in the waist, and the glass finds no soul aboard. Salvage is salvage; it is also slow, and the weather is making.',
    choices: [
      { label: 'Put a boat across and take what floats', outcomeKey: 'windfall', seed: 'Lose time. A possible prize.' },
      { label: 'Stand off — she may be plague, or a trap', outcomeKey: 'time_lost', seed: 'Cautious. No gain, no loss.' },
      { label: 'Mark her position for the next vessel', outcomeKey: 'rep_shift', repFaction: 'company', repDelta: 1, seed: 'A word reaches the underwriters.' },
    ],
  },
  {
    prose: 'A country ship of English build closes to hailing distance, her master at the rail with a speaking-trumpet. He has come down from the Bengal side, and offers the news of the season — the price of pepper at Madras, the temper of the Dutch, a wreck on the Pratas.',
    choices: [
      { label: 'Heave to and trade the news of the coast', outcomeKey: 'hook_opens', hook: 'A country master out of Bengal who knows the season’s prices and offered to know yr. face again.', seed: 'Lose time. Plant a thread.' },
      { label: 'Press him for the Madras pepper figure', outcomeKey: 'windfall', seed: 'A useful figure. Saves a poor bargain.' },
      { label: 'Exchange salutes and stand on', outcomeKey: 'time_lost', seed: 'A courtesy. Day passes.' },
    ],
  },
  {
    prose: 'A topman misses his hold reefing the main and comes down hard to the deck. He is alive, but the leg is wrong, and the carpenter is no surgeon. There is a Malay village in the lee of the next headland where, it is said, a bone-setter keeps.',
    choices: [
      { label: 'Put in at the village for the bone-setter', outcomeKey: 'cost', seed: 'A detour and a coin; the man may keep his leg.' },
      { label: 'Heave to and let the carpenter splint it', outcomeKey: 'time_lost', seed: 'Half a day. The man bears it.' },
      { label: 'Press on; the season will not wait', outcomeKey: 'hook_opens', hook: 'A topman crippled on the main yard, put off at no port; the foc’sle has not forgotten it.', seed: 'No delay. Plant a thread quietly.' },
    ],
  },
  // ── FACTION-KEYED ENCOUNTERS ── only surface when yr. standing makes them
  // plausible (precondition over gs.reputation). The world's vessels reflect
  // the relationships you've built — a reactive strait.
  {
    precondition: (gs) => (gs.reputation?.pirates || 0) >= 10,
    prose: 'A low sloop runs up out of the haze and shows, for a moment, a recognition you have learned to read — she is Brotherhood, and her master knows yr. flag. She holds station off the quarter, neither closing nor sheering away, and waits to see what you will do.',
    choices: [
      { label: 'Show the answering sign and trade news', outcomeKey: 'windfall', seed: 'A friend in the strait. Word, and perhaps a purse.' },
      { label: 'Pass a courtesy across by the boat', outcomeKey: 'rep_shift', repFaction: 'pirates', repDelta: 3, seed: 'A kindness the Brotherhood remembers.' },
      { label: 'Hold yr. course and give no sign', outcomeKey: 'rep_shift', repFaction: 'pirates', repDelta: -2, seed: 'The cold shoulder. They note it.' },
    ],
  },
  {
    precondition: (gs) => (gs.reputation?.dutch || 0) <= 0,
    prose: 'A VOC patrol boat puts out from the Hollander’s water and closes with purpose, her corporal standing in the bows with a glass to his eye. Yr. standing with the Company of the Netherlands is not such that they will wave you through; they mean to look.',
    choices: [
      { label: 'Heave to and let them aboard to inspect', outcomeKey: 'time_lost', seed: 'Lose a day to their thoroughness. Nothing found if nothing is hidden.' },
      { label: 'Show yr. papers from the rail, stand on', outcomeKey: 'rep_shift', repFaction: 'dutch', repDelta: 1, seed: 'A small civility. The Hollander grudges a nod.' },
      { label: 'Crowd on sail and put them in yr. wake', outcomeKey: 'rep_shift', repFaction: 'dutch', repDelta: -3, seed: 'You clear them — but the Hollander remembers yr. stern.' },
    ],
  },
  {
    precondition: (gs) => (gs.reputation?.crown || 0) >= 10,
    prose: 'A King’s frigate, two-decked and unhurried, lies athwart yr. course and makes the private signal for an English merchant to close and speak. Yr. standing with the Crown is good enough that this is a courtesy, not a summons.',
    choices: [
      { label: 'Close and render the news of the strait', outcomeKey: 'rep_shift', repFaction: 'crown', repDelta: 2, seed: 'A service to the Crown, freely given.' },
      { label: 'Ask her captain for word of convoy home', outcomeKey: 'hook_opens', hook: 'A King’s captain who offered word of the next homeward convoy; worth seeking when you sail for deeper water.', seed: 'Plant a thread. Lose a little time.' },
      { label: 'Dip yr. colours and stand on', outcomeKey: 'time_lost', seed: 'A courtesy. The day passes.' },
    ],
  },
];

// Pick a fallback encounter avoiding the ones shown most recently (tracked by
// prose in gs.recentEncounters). With a 16-entry pool and a 4-deep memory, no
// encounter recurs within four voyages — the felt variety is far better than
// the pure-random pick, which would jarringly repeat back-to-back ~1 in 16.
function pickFallbackEncounter(gs) {
  const recent = Array.isArray(gs?.recentEncounters) ? gs.recentEncounters : [];
  // Entries may carry a precondition(gs) gate — faction-keyed encounters that
  // only surface when yr. standing makes them plausible (a Brotherhood sloop
  // when the pirates know yr. flag, a Dutch patrol when the Hollanders are
  // cool, a King's frigate when the Crown favours you). So the world's vessels
  // come to reflect the relationships you've built.
  const eligible = FALLBACK_VOYAGE_ENCOUNTERS.filter(e => !e.precondition || e.precondition(gs));
  const fresh = eligible.filter(e => !recent.includes(e.prose));
  const pool = fresh.length > 0 ? fresh : (eligible.length > 0 ? eligible : FALLBACK_VOYAGE_ENCOUNTERS);
  return pool[Math.floor(Math.random() * pool.length)];
}

async function genVoyageEncounter(gs, fromPort, toPort) {
  const prompt = `Generate a voyage encounter at sea, sailing from ${fromPort} toward ${toPort}.
${stateContext(gs)}

SCENE CONSTRAINT: This encounter happens on the open water during the voyage, not at any port. The Factor is aboard his ship with anonymous crew (a bosun, sailors). Do NOT introduce Mr. Hodge, Sgt. Dass, the Vizier, or Reverend Pyke unless you state plainly that they have been brought aboard for this voyage.

USE WHAT IS THERE: If the Open threads, Acquaintances, or Flags above include a name, vessel, location, or matter the Factor is plausibly carrying with him on this leg, PRIORITISE pulling one of them into this scene. A signal from a ship Faulke described, a man Ramdeen named, a packet still sealed, an arrangement with the Brotherhood about to be tested — pick something the player has accumulated and advance, complicate, or resolve it. Only invent a brand-new figure or thread if NONE of the existing state would plausibly surface here.

ENGAGED THREAD: If you DID pull a specific Open thread into this scene, set "engagedThread" to that thread's exact text — copied character-for-character from the Open threads list above. Do NOT paraphrase. The downstream outcome step uses this to decide whether the player's choice may close the thread; an exact-match miss is harmless (the thread just doesn't close), but a paraphrase guarantees no closure. Omit "engagedThread" (or set "") if no specific open thread was pulled in.

Return JSON:
{
  "prose": "2-3 sentences of period prose. Concrete sensory detail. Plain observation, not metaphor. Set the scene and present a situation requiring a decision.",
  "engagedThread": "exact thread text from the Open threads list above, or empty string if none",
  "choices": [
    { "label": "5-9 word verb phrase", "seed": "what tonally happens if chosen" },
    { "label": "5-9 word verb phrase", "seed": "what tonally happens if chosen" },
    { "label": "5-9 word verb phrase", "seed": "what tonally happens if chosen" }
  ]
}`;
  const fallback = pickFallbackEncounter(gs);
  const call = await callClaude(prompt);
  const result = call.parsed || fallback;
  const log = {
    type: 'voyage_encounter',
    day: gs.day,
    location: `at sea, ${fromPort} → ${toPort}`,
    prompt: call.prompt,
    raw: call.raw,
    parsed: call.parsed,
    fallback: !call.parsed,
    error: call.error,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    meta: { fromPort, toPort },
  };
  return { result, log };
}

// Deterministic outcome pool for genOutcome fallback, organised as buckets
// keyed by the player's `choice.outcomeKey`. On the PWA path (no live AI)
// the choice the player made now STEERS which kind of outcome lands —
// "Stand on the course" reliably costs hull/sails; "Reef and ride it out"
// reliably costs a day; "Beat in for a closer look" reliably plants a hook.
// The bucket provides the prose/journal frame and a default mechanical
// bite; the choice itself can carry overrides (e.g. its own `hook` text
// for hook_opens, or a `repFaction` for rep_shift) which merge on top.
//
// Letter replies stay in their own flat pool — replies at the desk
// legitimately do nothing mechanical and the choice-steering pattern
// doesn't apply.
//
// Bucket vocabulary:
//   time_lost  — a day or two pass, no $/damage
//   damage     — shipDamage to hull and/or sails
//   windfall   — small money gain (+£10–25)
//   cost       — small money loss (-£8–18)
//   rep_shift  — a single faction ticks; choice may carry repFaction/repDelta
//   hook_opens — a new thread is planted; choice carries the hook text
const FALLBACK_OUTCOME_BUCKETS = {
  time_lost: [
    { prose: 'The bosun makes the call short and plain; the watch shifts, the sails are reset. By the time the deck quiets, the day is gone and the chart has not moved.', journal: 'A day lost to the matter. No harm beyond the calendar.', days: 1 },
    { prose: 'Hour follows hour without complaint. The work is done in its proper season, and the proper season is slow.', journal: 'The matter passed slowly; a day went with it.', days: 1 },
    { prose: 'Two suns rise and set on the same patch of water. The bosun keeps the men at small work to keep them out of trouble.', journal: 'Two days laid down to caution.', days: 2 },
  ],
  damage: [
    { prose: 'Set down, taken up, set down again. The yardarm groans through the swell and a reefed sail tears at the foot — work for the carpenter when the watch ends.', journal: 'A reefed sail tore in the swell. Work for the carpenter.', shipDamage: { sails: 6 } },
    { prose: 'A green sea takes her on the larboard quarter and works the planking. She rides out the day, but the bilges run wet under foot until the carpenter has had at her.', journal: 'Took a sea on the larboard quarter. Hull working.', shipDamage: { hull: 5 } },
    { prose: 'The wind backs sudden and the foretopsail splits up the leech. A backstay parts at the same moment; a block goes whirring past the helmsman\'s head and into the sea.', journal: 'Foretopsail split, a backstay parted. No men hurt.', shipDamage: { sails: 5, hull: 3 } },
  ],
  windfall: [
    { prose: 'A merchant of the bazaar settles a long account in yr. favour, slipping the silver across with no ceremony.', journal: 'A small windfall from a closed account.', money: 18 },
    { prose: 'The work goes on. The hands take their pay; the matter is closed before the second bell, and a private gratuity finds its way to the strongbox.', journal: 'Closed the day’s affair to small advantage.', money: 12 },
    { prose: 'A figure not previously friendly presses a small purse into yr. hand, the kind of payment that does not appear in any company book.', journal: 'A private gratuity, not for the ledger.', money: 22 },
  ],
  cost: [
    { prose: 'The matter wants a little silver to lie quiet, and silver it gets — paid across a back table, against no receipt. Cheaper now than later, the bosun observes, and he is not often wrong about such things.', journal: 'A small sum paid to keep a matter quiet.', money: -10 },
    { prose: 'The matter resolves itself in the way of small troubles — a clerk’s fee here, a private word there.', journal: 'Closed the day’s affair at the cost of a few crowns.', money: -8 },
    { prose: 'A figure appears at the wharf with a private bill not previously declared. The sum is small. The principle of the thing is not.', journal: 'A private bill paid at the wharf, against principle.', money: -15 },
  ],
  rep_shift: [
    { prose: 'A small affair, soon over. Word goes back to Madras, and not unfavourably.', journal: 'A small word reaches the Honourable Company.', reputation: { company: 2 } },
    { prose: 'The thing is settled before the second bell, but a man at the wharves whispers thanks to the Brotherhood for the quiet of it.', journal: 'Day closed quietly. The Brotherhood is paid in courtesy.', reputation: { pirates: 1 } },
    { prose: 'The sun moves; the wind holds; the matter passes. A native trader takes some quiet offence at the price set; he will remember the figure.', journal: 'A small ill word goes back to the bazaar.', reputation: { rajah: -1 } },
  ],
  hook_opens: [
    { prose: 'The matter does not so much resolve as set down a card on the table. There is a name now, or a place, or a figure — to be picked up again when the time is right.', journal: 'A new thread, planted and not yet pulled.' },
    { prose: 'You make a small note in the back of the day-book. The thing has not closed; it has only paused. Whatever was set in motion goes on without yr. hand for now.', journal: 'A matter left in motion, to be returned to.' },
    { prose: 'Word will keep, the bosun says, and so will an unfinished account. You let the day end with the matter unfinished by intent.', journal: 'An unfinished matter, set down on purpose.' },
  ],
};

// Letter replies — bite-free; the desk genuinely does little.
const FALLBACK_OUTCOME_LETTER = [
  { prose: 'The reply is written and laid by for the next post.', journal: 'Wrote the reply. Sealed and laid by for the post.' },
  { prose: 'The pen does its work. The paper is folded and sealed.', journal: 'Composed an answer at the desk.' },
  { prose: 'What was written cannot be unwritten. The Factor lays the pen down.', journal: 'A letter answered, no more.' },
  { prose: 'A letter answered. The desk is the same desk.', journal: 'Wrote a brief reply for the post-bag.' },
  { prose: 'He writes plainly. There is little to add when the figures speak.', journal: 'Took up the pen, returned the same.' },
  { prose: 'The reply is short, as the letter required. The wax cools.', journal: 'A page written to the post.' },
  { prose: 'Words committed to paper. They will reach London by August at earliest.', journal: 'Reply written. The desk is again clear.' },
  { prose: 'The reply reads true on the second pass.', journal: 'Sealed the answer and put it with the outgoing.' },
];

// Thread-aware outcome prose for a pursued matter (or a voyage encounter that
// engaged a specific open thread). The generic FALLBACK_OUTCOME_BUCKETS lines
// never echo WHICH matter was pursued, so resolving a named thread read as a
// contextless transaction ("a small purse changes hands at the close"). This
// weaves the thread in and gives the resolution weight keyed to the kind of
// bite the choice carried. The bucket still supplies the mechanical changes;
// only the prose + journal become thread-aware.
function pursueOutcomeProse(thread, outcomeKey, closes, roll) {
  const t = thread.slice(0, 100).replace(/\s+$/, '') + (thread.length > 100 ? '…' : '');
  const r = Math.abs(roll || 0);
  const closeTail = (closes
    ? ['and the matter is closed.', 'and it will not trouble the day-book again.', 'and there, at last, it ends.']
    : ['though it is not yet finished with you.', 'and the thread of it runs on.', 'and there is more in it yet to come.']
  )[r % 3];
  const tables = {
    windfall: [
      { p: `You carry the matter — ${t} — to a profitable close. A little silver comes of it, slipped across with no ceremony, ${closeTail}`, j: 'Pursued the matter to a small profit.' },
      { p: `The thing — ${t} — pays better than you looked for: a private gratuity that finds the strongbox and appears in no company book, ${closeTail}`, j: 'A private gratuity, pursued and won.' },
    ],
    cost: [
      { p: `You press the matter — ${t} — and it does not come free. A clerk's fee here, a quiet word there, and the strongbox the lighter for it, ${closeTail}`, j: 'Pursued the matter; a small disbursement.' },
      { p: `The matter — ${t} — is brought to ground, but a private bill follows it to the wharf. The sum is small; the principle of paying it is not, ${closeTail}`, j: 'A private bill paid to settle the matter.' },
    ],
    damage: [
      { p: `You drive at the matter — ${t} — and it bruises the ship before it yields: a strained spar, a seam working wet, both for the carpenter, ${closeTail}`, j: 'Pursued the matter; the ship took the cost of it.' },
    ],
    rep_shift: [
      { p: `You take up the matter — ${t} — and word of how you handled it travels where such words travel. Some think the better of you for it; some the worse, ${closeTail}`, j: 'Pursued the matter; word of it has carried.' },
    ],
    hook_opens: [
      { p: `You work at the matter — ${t} — and it opens onto another. There is a name now, or a place, or a figure not before in view, to be taken up when the time serves.`, j: 'Pursued one matter; it opened onto another.' },
      { p: `The matter — ${t} — does not so much close as set a fresh card on the table. You make a note in the back of the day-book and let it rest, for now.`, j: 'One thread pursued; a new one planted.' },
    ],
    time_lost: [
      { p: `You give the day to the matter — ${t} — and the day takes it, with little to show at the end but the hours spent and a clearer view of the ground, ${closeTail}`, j: 'A day given to the matter.' },
    ],
  };
  const pool = tables[outcomeKey] || tables.time_lost;
  return pool[r % pool.length];
}

async function genOutcome(gs, encounterProse, choice, opts = {}) {
  const isLetter = !!opts.isLetter;
  const isPursue = !!opts.isPursue;
  const engagedThread = typeof opts.engagedThread === 'string' && opts.engagedThread.trim() ? opts.engagedThread.trim() : '';
  const constraintLine = isLetter
    ? `SCENE CONSTRAINT: This is the Factor writing a reply at his desk. The outcome is what proceeds from the words he writes — no travel, no scenes elsewhere, no time of consequence passing. Set "days" to 0. Do NOT damage the ship.`
    : `SCENE CONSTRAINT: The outcome must follow plainly from the encounter as set up above. Do not introduce new characters or settings unrelated to that scene. The Factor cannot meet home-station characters (Hodge, Dass, the Vizier, Reverend Pyke) outside Bayan-Kor. If the prose involves a storm, gunfire, grounding, etc., you may set shipDamage.`;
  const consequenceRule = isLetter
    ? `CONSEQUENCE: Letter replies often have no immediate mechanical consequence — silence is fine. Leave "money", "reputation", "goods" empty unless the reply explicitly commits the Factor to spending, sending, or speaking against a faction.`
    : `CONSEQUENCE (REQUIRED for voyage / pursue outcomes): The world MUST turn under the Factor's hand. At least ONE of "money", "reputation", "goods", "shipDamage", or "flags" must be non-empty and reflect the choice. Even small bite is real — £8-30 changing hands, ±1-3 reputation, a single commodity gained or lost, a sail torn, a small lasting fact set as a flag. "Days passed and nothing happened" is NOT an acceptable shape; the player chose a path and the path must move the world.`;
  // Closure rule: pursue actions ALWAYS bind closeHook to the pursued
  // thread. Voyage encounters get closure only when the encounter step
  // signalled engagedThread — meaning the AI explicitly identified an
  // open thread it was advancing in the scene. Letters can't close hooks.
  let closureRule;
  if (isPursue) {
    closureRule = `CLOSURE: This outcome resolves a "pursue the matter" action on a specific open thread. If the Factor's choice plausibly settles, exhausts, or definitively shifts the thread (so it would be strange to invite him to pursue it again next week), set "closeHook": true — the thread will be removed from the open list. Set "closeHook": false (or omit) when the choice merely nudges the thread along.`;
  } else if (engagedThread) {
    closureRule = `CLOSURE: The voyage encounter pulled this specific open thread into play:\n  "${engagedThread}"\nIf the Factor's choice plausibly settles, exhausts, or definitively shifts that thread (so it would be strange to encounter it as an open matter on the next leg), set "closeHook": true. Set false or omit when the choice merely advances or complicates it.`;
  } else {
    closureRule = `CLOSURE: This outcome is not bound to a specific open thread — leave "closeHook" out of the response.`;
  }
  const prompt = `In the encounter: "${encounterProse}"
The Factor chose: "${choice.label}" (${choice.seed})
${stateContext(gs)}

${constraintLine}

${consequenceRule}

${closureRule}

USE WHAT IS THERE: Where the outcome would naturally touch the Open threads, Acquaintances, or Flags listed above, do — refine an existing thread rather than parallel-track a new one. If the choice resolves a hook, you may leave the "hook" field empty (the open thread is the one that closes). Add a NEW hook only when the action genuinely opens a new thread the world would not otherwise hold.

Generate the outcome. Return JSON:
{
  "prose": "2-3 sentences of period prose describing what happens. Concrete observation. Avoid metaphor.",
  "changes": {
    "money": integer delta (range -200 to +200; often non-zero for voyage/pursue, often zero for letter),
    "days": integer days passed (${isLetter ? '0 only' : '0-3'}),
    "reputation": { "company": int, "crown": int, "rajah": int, "pirates": int, "mission": int, "dutch": int },
    "goods": { "commodity_name": int delta },
    "journal": "one-sentence note for the journal in past tense",
    "hook": "optional: a NEW thread that may return later, or empty string",${(isPursue || engagedThread) ? `\n    "closeHook": boolean (set true when this choice resolves the bound open thread; see CLOSURE above),` : ''}
    "shipDamage": ${isLetter ? 'null  (letters never damage the ship)' : '{ "hull": 0-40, "sails": 0-40 }  // optional; only when prose justifies'},
    "newAcquaintances": [ { "name": "...", "role": "...", "location": "...", "notes": "..." } ],
    "flags": { "key": value }
  }
}
Reputation deltas should be small (±1 to ±15). Only include factions that actually shift. Goods can include any of: pepper, cinnamon, calico, silver, sandalwood, opium, rice, rum, saltpetre. Use newAcquaintances when the scene introduces a memorable named figure who could plausibly recur. Flags are sparse and should describe lasting narrative state. Omit any of the optional fields you do not need — but obey CONSEQUENCE above for voyage and pursue outcomes.`;
  // Letter branch: flat random pool, no mechanical bite (the desk does little).
  // Encounter / pursue branch: route by choice.outcomeKey into FALLBACK_OUTCOME_BUCKETS
  // so the player's chosen lever actually steers the kind of outcome that lands.
  // Choice-level overrides (e.g. an explicit `hook` text on hook_opens choices,
  // or an explicit repFaction on rep_shift choices) take precedence over the
  // bucket's defaults so the deterministic outcome can echo the choice that was made.
  let pick;
  if (isLetter) {
    pick = FALLBACK_OUTCOME_LETTER[Math.floor(Math.random() * FALLBACK_OUTCOME_LETTER.length)];
  } else {
    const key = (choice && choice.outcomeKey) || 'cost';
    const bucket = FALLBACK_OUTCOME_BUCKETS[key] || FALLBACK_OUTCOME_BUCKETS.cost;
    pick = bucket[Math.floor(Math.random() * bucket.length)];
  }
  // rep_shift bucket: when the choice carries an explicit repFaction (e.g.
  // a Brotherhood-coded action), honour it; otherwise the bucket pick's
  // baked-in faction stands.
  let repOverride;
  if (!isLetter && choice && choice.outcomeKey === 'rep_shift' && choice.repFaction) {
    const delta = Number.isFinite(choice.repDelta) ? choice.repDelta : 2;
    repOverride = { [choice.repFaction]: delta };
  }
  // hook_opens bucket: prefer the choice's own hook text so the planted
  // thread reads as if it grew from the scene that just played.
  const hookText = (!isLetter && choice && choice.outcomeKey === 'hook_opens' && typeof choice.hook === 'string' && choice.hook.trim())
    ? choice.hook.trim()
    : '';
  // When a specific thread is in play — a pursued matter, or a voyage scene that
  // engaged an open thread — make the fallback prose NAME and resolve that matter
  // instead of a contextless bucket line. The bucket still supplies the bite.
  let proseText = pick.prose;
  let journalText = pick.journal;
  if (!isLetter && engagedThread) {
    const tw = pursueOutcomeProse(engagedThread, (choice && choice.outcomeKey) || 'cost', !!(choice && choice.closesHook), Math.floor(Math.random() * 1000));
    proseText = tw.p;
    journalText = tw.j;
  }
  const fallback = {
    prose: proseText,
    changes: {
      money: isLetter ? 0 : (pick.money || 0),
      days: isLetter ? 0 : (Number.isFinite(pick.days) ? pick.days : 1),
      reputation: isLetter ? {} : (repOverride || pick.reputation || {}),
      goods: isLetter ? {} : (pick.goods || {}),
      shipDamage: isLetter ? undefined : (pick.shipDamage || undefined),
      journal: journalText,
      hook: hookText,
      // Choice-level intent to close the bound thread. The pursue path
      // always honours this. The voyage path honours it only when an
      // engagedThread was bound — same gate the AI prompt uses.
      closeHook: !isLetter && !!(choice && choice.closesHook),
    },
  };
  const call = await callClaude(prompt);
  const result = call.parsed || fallback;
  const log = {
    type: 'outcome',
    day: gs.day,
    location: gs.location,
    prompt: call.prompt,
    raw: call.raw,
    parsed: call.parsed,
    fallback: !call.parsed,
    error: call.error,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    meta: { encounterProse, choiceLabel: choice.label, choiceSeed: choice.seed, isLetter },
  };
  return { result, log };
}

// Per-sender deterministic fallback pools for genLetter. Each entry is a
// {subject, body, responses} object — sender.from is added at lookup time.
// Templates mirror the AUTO_SENDERS mood descriptions (Wexley familial,
// Faulke mariner-Brotherhood, Pyke pious-pastoral, Anonymous Hand
// quiet-Brotherhood, ter Borch Calvinist-trader, Dryden private-Director,
// Cama careful-Parsi). Pool sizes vary by sender; pirates carries extra
// rivalry intel-buy templates.
// Static prose — no gs interpolation — for safety and predictability.
const FALLBACK_LETTERS = {
  wexley: [
    {
      subject: 'A News from Bristol of the Family',
      body: 'Sister, — The summer here has been a kind one, and yr. nephew Thomas has begun his first quarter at the Charterhouse, where he lasts at his Latin better than I had hoped. Father’s leg troubles him still in the wet, but he reads the Gazette each morning with his pipe and asks after you when the East Indian returns are listed. We had Mrs. Albright to tea on Thursday last; she sends her regards and a small comb of Cheshire she pressed upon me to send you, though it has likely come to nothing in the heat. — Yr. loving sister, Eliza.',
      responses: [
        { label: 'Send a remittance for Thomas’s fees', seed: 'family hook, money out' },
        { label: 'Reply with news of yr. work', seed: 'kept connection, no money' },
        { label: 'Set aside, do not reply', seed: 'silence' },
      ],
    },
    {
      subject: 'Concerning Yr. Long Silence',
      body: 'Brother, — It has been three packets now without a line from you, and the rumour at Wapping has it that the wet season was a hard one in those latitudes. Father will not say so, but he reads each Gazette as if to find a name. Mr. Albright tells us the Charlestowne came in three weeks past with no letter aboard; this troubles me more than you would credit. Pray, write a line, even if it be only to say you are well. — Yr. loving sister, Eliza.',
      responses: [
        { label: 'Write a long account of yr. health and prospects', seed: 'family reassured' },
        { label: 'Send a brief note saying only that you are well', seed: 'minimal reassurance' },
        { label: 'Set aside, do not reply', seed: 'silence, family hook' },
      ],
    },
    {
      subject: 'Of Father’s Health and a Matter in the Will',
      body: 'Sister, — I write with heavy news. Father has had a turn of it this past month and the apothecary is grave; he speaks of his affairs as though they were near concluded, and Mr. Hall the attorney has been sent for. He has asked twice now after yr. charter and whether you might be summoned home before the Spring tides. I cannot tell you what to do, but I will tell you what the matter is. — Yr. loving sister, Eliza.',
      responses: [
        { label: 'Promise return upon completion of the charter', seed: 'family hook, no immediate cost' },
        { label: 'Send instructions to the attorney as to yr. share', seed: 'practical, hook plants' },
        { label: 'Set aside, do not reply', seed: 'silence' },
      ],
    },
  ],

  faulke: [
    {
      subject: 'Of Pepper at Madras and Yr. Ship',
      body: 'Sir, — I write from the road of Madras, where pepper has reached eight pence the pound and rising — a Dutch fleet was driven off the coast of Sumatra last month and the fork has narrowed. Yr. own returns from the Strait should profit by it if they reach London before the corner closes. The Albatross sails for Bayan-Kor inside the fortnight; if you have private goods you would lay aboard, send word by the next packet. — In trade, Faulke.',
      responses: [
        { label: 'Lay private goods aboard the Albatross', seed: 'opens trade hook' },
        { label: 'Reply asking for further news', seed: 'neutral, may yield more' },
        { label: 'Set aside, do not reply', seed: 'silence' },
      ],
    },
    {
      subject: 'A Matter Discussed at the Coffee-house',
      body: 'Sir, — I had occasion last week at the Madras coffee-house to overhear a conversation between two gentlemen of the Crown service that touched upon yr. own station. The substance was not flattering and the sources unclear, but the names were named. I cannot say more in writing, but if you would have the particulars, I will keep them in hand till we next meet — and I make Bayan-Kor before the wet season at any rate. — In friendship, Faulke.',
      responses: [
        { label: 'Ask for the particulars by safe hand', seed: 'accepts hook' },
        { label: 'Reply that you will hear them in person', seed: 'neutral' },
        { label: 'Set aside, do not reply', seed: 'silence, hook plants' },
      ],
    },
    {
      subject: 'A Passage Eastward, if you will',
      body: 'Sir, — I have a charter for the Banda islands at the close of next month, and there is a free berth in the after-cabin if you have business that side of the Strait. The freight is at the usual rate, and I would not press the offer if I did not think you might profit by it; the spice quotas at the new Dutch establishment there are open to a few names, of which I might whisper yours. — At yr. service, Faulke.',
      responses: [
        { label: 'Take the berth, set affairs in order', seed: 'voyage hook' },
        { label: 'Decline civilly, with thanks', seed: 'neutral' },
        { label: 'Set aside, do not reply', seed: 'silence' },
      ],
    },
  ],

  pyke: [
    {
      subject: 'Yr. Subscription to the Chapel Library',
      body: 'Sir, — The chapel library at the Mission is in want of a new Donne and a complete Tillotson, the present copies being so eaten by damp that the lessons are read from memory. A subscription of fifty pounds would set us in good order for a generation. I am told the Factor has been generous in past matters, and I write in the same spirit of trust. The Lord prospers those who prosper His house. — In Christian fellowship, J. Pyke.',
      responses: [
        { label: 'Subscribe fifty pounds to the library', seed: 'Mission +5, money out' },
        { label: 'Subscribe a small sum (£10)', seed: 'Mission +2' },
        { label: 'Set aside, do not reply', seed: 'silence' },
      ],
    },
    {
      subject: 'A Matter of Conscience at Yr. Godown',
      body: 'Sir, — I have been told — and I would not write if the source were less plain — that goods of an opium nature have been seen to come and go from yr. godown of late. I do not pry into the affairs of the Company, but I do pry into matters of the soul. There is a price for such trade that no ledger will reckon. I should value an hour’s conversation upon it when next you have the leisure. — In Christian concern, J. Pyke.',
      responses: [
        { label: 'Reply that the goods are lawful and necessary', seed: 'Mission -3' },
        { label: 'Promise to call upon him at the Chapel', seed: 'Mission +2, hook' },
        { label: 'Set aside, do not reply', seed: 'silence, hook' },
      ],
    },
    {
      subject: 'Of Yr. Health in this Heat',
      body: 'Sir, — The wet season presses heavy upon us all, but I have not seen you at chapel this past month, and Hodge tells me you have looked unwell. I write in no spirit of reproach but in friendship. There is a quiet in Sunday mornings that the godown does not give, and I should be glad to see you in the pew when you are next able. — Yr. faithful friend in Christ, J. Pyke.',
      responses: [
        { label: 'Promise to attend on Sunday next', seed: 'Mission +2' },
        { label: 'Reply citing the work, but with respect', seed: 'neutral' },
        { label: 'Set aside, do not reply', seed: 'silence' },
      ],
    },
  ],

  pirates: [
    {
      subject: 'An Arrangement Profitable to Both',
      body: 'Sir, — A friend of yr. acquaintance at the Pelican’s Nest has asked me to lay a small matter before you. Yr. ship has been remarked at sea on the late voyages and the remarks have not been to her detriment. A token of common interest paid this Quarter would see that the remarks remain so. The figure is not large; the courtesy is. The bearer of this letter is known to the Pelican’s keeper. — Yrs. discreetly.',
      responses: [
        { label: 'Pay the token (£100) by the bearer', seed: 'Pirates +10, Crown -5' },
        { label: 'Reply that you cannot oblige', seed: 'Pirates -5' },
        { label: 'Set aside, do not reply', seed: 'silence, hook' },
      ],
    },
    {
      subject: 'A Past Matter Remembered',
      body: 'Sir, — There is a matter from some months past that I had thought concluded but which the keeper at the Nest has bid me write of. The man you put off the Albatross at the strait was known to friends of ours; he is now in good health and asks after you by name. I think you would prefer that the asking remain courteous. A small remembrance — the figure of which I leave to yr. judgement — would be welcome. — Yrs. discreetly.',
      responses: [
        { label: 'Send fifty pounds with a private note', seed: 'Pirates +5' },
        { label: 'Reply that the matter is closed', seed: 'Pirates -10, hook plants' },
        { label: 'Set aside, do not reply', seed: 'silence, hook' },
      ],
    },
    {
      subject: 'A Small Service in the Strait',
      body: 'Sir, — There is a packet to be carried east on yr. next voyage if you should be so kind. The bearer at Bayan-Kor will give it into yr. hand the night before sailing; the hand at the Pelican’s Nest will receive it. The contents are not yr. concern, and yr. discretion will be appreciated by parties who are in a position to appreciate. — Yrs. quietly.',
      responses: [
        { label: 'Accept the packet for the next voyage', seed: 'Pirates +5, plants Brotherhood favour' },
        { label: 'Reply that you cannot carry it this voyage', seed: 'Pirates 0' },
        { label: 'Set aside, do not reply', seed: 'Pirates -2, silence' },
      ],
    },
    {
      subject: 'Of yr. peers in these waters',
      body: `Sir, — A small voice in the strait writes: there is news of yr. peer at Bencoolen, kept close by the high office, of which we have laid eyes. The matter would interest you, perhaps, before it is general talk.

The price for yr. private knowledge of it is forty pounds, paid as before — through the boy at the wharf with the broken cap. We do not write again on the matter; we hold it for two weeks. After that the news is no longer ours alone.

—`,
      responses: [
        {
          label: 'Pay the £40; learn what is known',
          seed: 'pay; intel plant; small pirate rep',
          fixedOutcome: {
            prose: 'You send the boy at the wharf with the agreed sum. A note returns the same evening, in a hand the Factor does not know — three sentences only, but enough to anticipate what the next packet from Bencoolen will say.',
            changes: {
              money: -40,
              flags: { hardacreIntelPlant: true, hardacreIntelEverBought: true },
              journal: 'Bought intelligence on Mr. Hardacre at Bencoolen — £40 to a Brotherhood hand, by the boy at the wharf.',
            },
          },
        },
        {
          label: 'Decline; let the news come in its own time',
          seed: 'decline cleanly',
          fixedOutcome: {
            prose: 'You write nothing in reply. The strait keeps its own counsel; the boy at the wharf is not seen at the gangway.',
            changes: { journal: 'Declined the Brotherhood\'s offer of intelligence on Mr. Hardacre.' },
          },
        },
        {
          label: 'Refuse; the matter is unbecoming',
          seed: 'refuse plainly; small pirate -1',
          fixedOutcome: {
            prose: 'You write a polite refusal — \'such intelligence as is offered, the Factor does not seek\' — and seal it with the household stamp. The boy at the wharf does not return to it; the small voice in the strait, the Factor suspects, takes the refusal personally.',
            changes: {
              reputation: { pirates: -1 },
              journal: 'Refused the Brotherhood\'s offer plainly. They will remember.',
            },
          },
        },
      ],
    },
    {
      subject: 'A second hand on the Bencoolen matter',
      body: `Sir, — The strait writes again. The price has been put at sixty pounds — yr. peer at Bencoolen has had a turn, and the news will weight against him within the month. You may wish to lay yr. plans accordingly; if not, the matter passes us by.

—`,
      responses: [
        {
          label: 'Pay the £60; the matter is known to me',
          seed: 'pay; intel plant',
          fixedOutcome: {
            prose: 'Sixty pounds to the boy at the wharf, in a sealed packet of the household colour. The intelligence returns: a misadventure at Bencoolen, of the kind that does not appear in the Court\'s correspondence for some weeks yet. The Factor lays his plans accordingly.',
            changes: {
              money: -60,
              flags: { hardacreIntelPlant: true, hardacreIntelEverBought: true },
              journal: 'Paid £60 for further news of Mr. Hardacre. The strait knew it before the Court did.',
            },
          },
        },
        {
          label: 'Decline; £60 is heavy',
          seed: 'decline; no cost',
          fixedOutcome: {
            prose: 'You send back a single line: \'such matters as the Court will hear in due course, the Factor is content to wait upon.\' The strait shrugs, in the way the strait shrugs.',
            changes: { journal: 'Declined the Brotherhood\'s second offer; £60 was the price of a private fortnight.' },
          },
        },
      ],
    },
  ],

  terborch: [
    {
      subject: 'Concerning the Cinnamon Returns',
      body: 'Sir, — It is known to me, as is its way, that yr. cinnamon returns of the present season have run favourable; my own factor at Eustace makes mention of them in his last accounting. I write only to suggest that, should you find yrself in want of carriage to Cape Town for any portion of those returns, the Vrouwe Albertina sails from Eustace at the end of the month, and her hold is partly free. The terms could be discussed when next you put in. — Yr. servant, Adriaan ter Borch.',
      responses: [
        { label: 'Reply with interest in the carriage terms', seed: 'Dutch +3, hook' },
        { label: 'Reply politely declining', seed: 'Dutch 0' },
        { label: 'Set aside, do not reply', seed: 'silence' },
      ],
    },
    {
      subject: 'Concerning a Rumour',
      body: 'Sir, — I am told — and Calvinists do not invent rumours — that an arrangement has been quietly struck between yr. station and the Brotherhood for the safe passage of yr. shipping. I express no judgement on the practice, which is older than either of our companies, but I should observe that such arrangements are not durable, and that the Crown’s memory is long. I write as a friend of trade. — Adriaan ter Borch.',
      responses: [
        { label: 'Reply with formal denial', seed: 'Dutch -2' },
        { label: 'Reply that the matter is not his concern', seed: 'Dutch -5' },
        { label: 'Set aside, do not reply', seed: 'silence, hook plants' },
      ],
    },
    {
      subject: 'An Offer concerning the Pepper Quota',
      body: 'Sir, — There is at present a quota of pepper open at Eustace for which my Company has not yet found a counterparty. Yr. own returns would more than fill it, and the price is generous — I am at liberty to say it would be the better part of one shilling above the Madras market. There are conditions, of course, of which the chief is that no portion of the returns be remarked at any other Dutch port for one calendar year. — At yr. service, A. ter Borch.',
      responses: [
        { label: 'Accept the quota and the condition', seed: 'Dutch +8, exclusivity hook' },
        { label: 'Reply asking to negotiate the condition', seed: 'Dutch +2' },
        { label: 'Set aside, do not reply', seed: 'silence' },
      ],
    },
  ],

  dryden: [
    {
      subject: 'Private — A Matter at Court',
      body: 'Sir, — I write on private paper, the Court not yet having taken the matter up. The recent loss of the Antelope off the Cape has shaken several of our older Court members, and a faction now agitates for tighter management of the country trade. You should know that yr. own private speculations have been remarked upon in the most discreet of corners — favourably, but remarked. I would have you know it before the fact reaches you any other way. — Yr. friend, E. Dryden.',
      responses: [
        { label: 'Reply with thanks and a careful enclosure', seed: 'Company +2, hook' },
        { label: 'Reply requesting further detail', seed: 'Company +1' },
        { label: 'Set aside, do not reply', seed: 'silence' },
      ],
    },
    {
      subject: 'Private — Of the Forthcoming Audit',
      body: 'Sir, — The Court has resolved upon an audit of the eastern stations to be conducted by Mr. Vansittart, who you will recall is a man of the strict party. He will not depart England before the next sailing of the Halifax, but his arrival in the East thereafter is certain. I cannot say what particulars he will look into; I can say that yr. station will not be among the first he attends to, but neither will it be among the last. — Yr. friend, E. Dryden.',
      responses: [
        { label: 'Begin to set the books in good order', seed: 'Company +3, hook' },
        { label: 'Reply that yr. books are in order', seed: 'Company +1' },
        { label: 'Set aside, do not reply', seed: 'silence' },
      ],
    },
    {
      subject: 'Private — A Question of Some Delicacy',
      body: 'Sir, — There is a matter the Court will not put in writing but which several of us would value yr. private opinion upon. The sum of it is this: are the conditions at yr. station, in yr. honest reckoning, such that the Company’s interest is best served by the present arrangement, or by an enlargement? I do not ask for figures; I ask for yr. judgement. The matter will reach yr. ear no other way. — Yr. friend, E. Dryden.',
      responses: [
        { label: 'Reply with frank judgement on enlargement', seed: 'Company +5, late-game hook' },
        { label: 'Reply that you would prefer to defer', seed: 'Company 0' },
        { label: 'Set aside, do not reply', seed: 'silence' },
      ],
    },
  ],
  cama: [
    // Two intel-buy templates + one ambient request, alternated by random pick.
    {
      subject: 'A small note from Bombay',
      body: `Sir, — I write upon a matter you may find of small worth, perhaps of more. Mr. Lowji Nusserwanji's establishment has had a turn this fortnight, of which I am better informed than most by my position. For twenty pounds — paid by the Madras packet — I should be willing to write the matter plainly.

I do not press the matter; I write only because I have written upon similar matters before to gentlemen of yr. station, and they have not regretted the sums.

Yr. obedt. servant,
Pestonji Cama`,
      responses: [
        {
          label: 'Pay the £20; the matter is of interest',
          seed: 'pay; lowji intel plant',
          fixedOutcome: {
            prose: 'You despatch a draft for twenty pounds by the Madras packet. A second letter returns within the month — a careful list of three matters concerning Mr. Lowji\'s recent shipments, written in a hand which has been schooled by a Parsi master in English commerce.',
            changes: {
              money: -20,
              flags: { lowjiIntelPlant: true, lowjiIntelEverBought: true },
              journal: 'Bought intelligence on Mr. Lowji of Bombay — £20 to Mr. Cama by the Madras packet.',
            },
          },
        },
        {
          label: 'Decline; the price is enough',
          seed: 'decline cleanly',
          fixedOutcome: {
            prose: 'You write a courteous decline. Mr. Cama answers by return — a single sentence of regret, in the formal Bombay manner.',
            changes: { journal: 'Declined Mr. Cama\'s offer. He writes again, no doubt.' },
          },
        },
      ],
    },
    {
      subject: 'A further matter from Bombay',
      body: `Sir, — A second matter, of which the price is sixty pounds, paid as before. Mr. Lowji has put a quantity of [trade good] upon the next ship for Eustace, and the matter — by the time it is general — will weight against him in such-and-such a way. The price is the price; I am not the master of these things.

Yr. obedt. servant,
Pestonji Cama`,
      responses: [
        {
          label: 'Pay the £60; lay my plans accordingly',
          seed: 'pay; lowji intel plant',
          fixedOutcome: {
            prose: 'Sixty pounds across the bay. The return packet brings a clean account of the Bombay establishment\'s misadventure — two ships, three commodities, four weeks before the news travels by ordinary channels. The Factor lays his plans on the strength of it.',
            changes: {
              money: -60,
              flags: { lowjiIntelPlant: true, lowjiIntelEverBought: true },
              journal: 'Paid £60 to Mr. Cama for the Bombay matter. The Factor\'s holds are positioned.',
            },
          },
        },
        {
          label: 'Decline; £60 is the run of trade',
          seed: 'decline cleanly',
          fixedOutcome: {
            prose: 'You decline by post. Mr. Cama, predictably, writes no more on the matter — and in due course the news arrives by ordinary channels, when it is no longer of any use to lay plans against.',
            changes: { journal: 'Declined Mr. Cama\'s second offer. The Bombay matter, when it became general, found me unprepared.' },
          },
        },
      ],
    },
    {
      subject: 'Of my son in the writing-school',
      body: `Sir, — I beg leave to write upon a matter not of trade. My son, of fifteen years, is engaged in the Madras writing-school under Mr. Wynne; the establishment's subscription is short upon the present quarter. A small donation of five pounds to the master, in the Factor's name, would not be forgotten — by the boy or by yr. obedt. servant.

I do not write thus often; I write only because the boy is industrious and the matter is small.

Yr. obedt. servant,
Pestonji Cama`,
      responses: [
        {
          label: 'Subscribe £5; the boy shall be remembered',
          seed: 'subscribe small; cama loyalty hint',
          fixedOutcome: {
            prose: 'Five pounds to Mr. Wynne by the next packet, in the Factor\'s name. Mr. Cama writes back in a hand half a degree warmer than before.',
            changes: {
              money: -5,
              journal: 'Subscribed £5 to Mr. Wynne\'s school for the boy Cama. Goodwill in Bombay is, perhaps, worth more than the sum.',
            },
          },
        },
        {
          label: 'Decline politely; another year, perhaps',
          seed: 'decline cleanly',
          fixedOutcome: {
            prose: 'You write a polite decline. Mr. Cama answers with a courteous regret and the matter is not raised again.',
            changes: { journal: 'Declined the subscription. Five pounds is, in the run of accounts, no great matter.' },
          },
        },
      ],
    },
  ],
};

async function genLetter(gs, sender) {
  // Caller (the auto-letter scheduler) selects the sender. The mood line +
  // stateContext drive the AI to write something the Factor's actual
  // circumstances make plausible.
  const prompt = `Generate a letter delivered to the Factor at ${gs.location}.
From: ${sender.from} (${sender.mood})

${stateContext(gs)}

WRITING THE LETTER:
- Lean on the Factor's reckoning above. The sender knows what they would plausibly know \u2014 Mrs. Wexley reads of the returns at Blackwall, Capt. Faulke hears the prices at Madras and the Strait, the Mission and the Rajah's people see the godown each day, ter Borch knows what the Dutch factor at Eustace knows, the Brotherhood listen on the wharves.
- Reference the world by name when natural: the godown stocks, an Indiaman due or recently called, the brigantine on the stocks, the teak concession (and who holds it), Hodge or Dass or the Vizier by name, a port the Factor has lately put into.
- Period 1720s mercantile English. No anachronism. Open with "Sir, \u2014" or a familial salutation; close with a period sign-off. 3\u20135 sentences.
- Imply something the Factor might respond to or act upon.

CONSTRAINTS:
- The Factor cannot meet home-station characters (Hodge, Dass, the Vizier, Reverend Pyke) outside Bayan-Kor. They CAN write him letters from Bayan-Kor.
- Do not invent named characters who duplicate or replace the home-station NPCs.

Return JSON:
{
  "from": "${sender.from}",
  "subject": "5-8 word subject",
  "body": "the letter body, with salutation and period sign-off",
  "responses": [
    { "label": "5-8 word response in the Factor's voice", "seed": "tonal consequence" },
    { "label": "5-8 word response", "seed": "tonal consequence" },
    { "label": "Set aside, do not reply", "seed": "ignore, possible drift" }
  ]
}`;
  // Pick from the per-sender pool if one exists; otherwise use the generic
  // fallback. The generic stays as a defensive default for any future sender
  // whose pool isn't yet authored.
  const senderPool = FALLBACK_LETTERS[sender.key];
  const fallback = (senderPool && senderPool.length > 0)
    ? { from: sender.from, ...senderPool[Math.floor(Math.random() * senderPool.length)] }
    : {
        from: sender.from,
        subject: 'A Matter Requiring Your Attention',
        body: 'Sir, — I trust this finds you in such health as the climate permits. There is a matter I should wish to lay before you when next our paths cross. Yr. obedient servant, &c.',
        responses: [
          { label: 'Reply with cautious interest', seed: 'opens dialogue' },
          { label: 'Reply with formal refusal', seed: 'closes door politely' },
          { label: 'Set aside, do not reply', seed: 'silence' },
        ],
      };
  const call = await callClaude(prompt);
  const result = call.parsed || fallback;
  const log = {
    type: 'letter',
    day: gs.day,
    location: gs.location,
    prompt: call.prompt,
    raw: call.raw,
    parsed: call.parsed,
    fallback: !call.parsed,
    error: call.error,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    meta: { senderFrom: sender.from, senderFaction: sender.faction, senderKey: sender.key },
  };
  return { result, log };
}

// Replaces the deterministic Indiaman letter body with AI prose seeded by
// the actual return. Returns { subject, body, log } or null if the call
// fails or the parsed result is unusable. Caller decides whether to apply.
async function genIndiamanLetterPayload(gs, ctx) {
  const tone = ctx.empty ? 'cold and displeased; the hold went away empty' :
               ctx.onTrack ? 'satisfied with the present pace' :
               'concerned that the returns are light';
  const prompt = `Generate the body of a letter from the Honourable Company's Court of Directors in London, sent by the same packet as the Indiaman ${ctx.shipName}, which has just lifted ${ctx.peppLifted} cwt of pepper and ${ctx.cinnLifted} cwt of cinnamon from the Factor's godown at Bayan-Kor.

${stateContext(gs)}

Cumulative reckoning: ${ctx.totalPepper} of 400 pepper and ${ctx.totalCinn} of 200 cinnamon shipped to London. Visit ${ctx.visits} of ${INDIAMAN_TOTAL}. Charter days remaining: ${gs.daysRemaining}.

VOICE: 1720s formal mercantile English, terse, NO anachronism. The Court speaks plurally ("we"), addresses "Sir, —", signs "Yr. obedt. servants, the Court of Directors". Reference the specific lifted amounts and the cumulative reckoning. The tone is: ${tone}. 3–6 sentences. May, sparingly, mention the late Mr. Wilbraham, the Dutch, the climate, or the Factor's standing — but only if it sharpens the point. Do NOT invent persons or events; do NOT introduce home-station characters in this letter.

Return JSON:
{
  "subject": "5-9 word subject, may reference the ship",
  "body": "the letter body, with salutation and signoff"
}`;
  const call = await callClaude(prompt);
  if (!call.parsed || typeof call.parsed.body !== 'string' || !call.parsed.body.trim()) {
    return null;
  }
  return {
    subject: typeof call.parsed.subject === 'string' && call.parsed.subject.trim() ? call.parsed.subject : null,
    body: call.parsed.body,
    log: {
      type: 'indiaman_letter',
      day: gs.day,
      location: gs.location,
      prompt: call.prompt,
      raw: call.raw,
      parsed: call.parsed,
      fallback: false,
      error: call.error,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      meta: { ...ctx },
    },
  };
}

// Generate a scene that brings a specific thread back into play. The
// player picks the thread (a hook line, a named acquaintance, or a flag)
// from the Pursue panel; the AI weaves it into an encounter the player
// then resolves through the standard outcome flow. 1-2 days advance.
// ─────────── AUTHORED PURSUE LEADS ───────────
// Some open threads are real OPPORTUNITIES, not atmosphere — a wreck to salvage,
// a market tip to act on. Pursuing one of these should be a hand-written
// decision with differentiated, consequential outcomes, NOT the generic
// fallback's three-flavour gamble. Keyed by the VENTURE_EVENTS id that plants
// the hook; findPursueLead resolves a thread → its event → its lead at CALL
// time (not module-init time), so the lead tracks the planted hook with zero
// drift and no fragile computed-key evaluation order. Each choice carries its
// own fixedOutcome — applied directly, no AI, no buckets.
const PURSUE_LEADS = {
  // The Pratas wreck — salvage greed vs. clean money + Dutch goodwill vs. pass.
  carnatic_wreck: {
    scene: 'You lay the Carnatic’s report on the desk beside the chart. A Dutch country ship is fast on the Pratas reef, her people gone off in the boats, her saltpetre cargo sitting in the wet and ungoverned. It is a long sail and the season is closing — but saltpetre is saltpetre, and the Company always wants powder. The matter wants a decision before the monsoon makes it for you.',
    choices: [
      { label: 'Send the Carnatic to lift what she can', seed: 'A cargo won — but the Hollanders will not love you for it.',
        fixedOutcome: {
          prose: 'The Carnatic works up to the reef on a falling tide and her people go over the side with tackles and a will. They bring off near twenty hundredweight of saltpetre before the swell makes it folly to stay, and it sells at Bayan-Kor for a fair price. Salvage, by the custom of the sea — though the Hollanders, when they hear, will name it by a harder word.',
          changes: { money: 130, reputation: { dutch: -5 }, days: 2, journal: 'Salvaged the Pratas wreck’s saltpetre — £130, and the Dutch the angrier for it.', closeHook: true },
        } },
      { label: 'Sell the bearing to the Hollanders’ agent', seed: 'Cleaner money, and a Dutchman in yr. debt.',
        fixedOutcome: {
          prose: 'You send the wreck’s bearing, quietly and exactly, to the Dutch agent at Eustace — it is their ship, after all, and their loss to recover. He pays for the courtesy without being asked twice, and remembers it. A wreck unlooted is a friend made, and friends among the Hollanders are not cheaply come by.',
          changes: { money: 85, reputation: { dutch: 4 }, days: 1, journal: 'Sold the Pratas wreck’s bearing to the Dutch agent — £85 and their goodwill.', closeHook: true },
        } },
      { label: 'Leave it; a wreck is the Devil’s own bargain', seed: 'Nothing ventured.',
        fixedOutcome: {
          prose: 'You let it lie. The Pratas has taken better ships than the Carnatic and would as soon take her too; the saltpetre may rot where it floats. The master nods, privately relieved, and the matter is closed.',
          changes: { days: 0, journal: 'Left the Pratas wreck to the sea. Some bargains are not worth the candle.', closeHook: true },
        } },
    ],
  },
  // The Kota Pinang pepper tip — work it / gift it for a favour / let it pass.
  agent_intel: {
    scene: 'Yr. man at Kota Pinang has sent word that the Sultan’s warehouses are over-full, and the price of pepper there will break before the next ships call. It is the kind of intelligence that is worth nothing in a drawer and a good deal out of it — but the buy must be made on yr. account, and made now.',
    choices: [
      { label: 'Have the agent buy deep on yr. account', seed: 'Buy low, sell into the turn.',
        fixedOutcome: {
          prose: 'You write the agent to buy to the depth of yr. credit while the price is on the floor, and to hold against the turn. The turn comes, as he said it would; he sells a portion into the rising market and lodges the rest. The profit is real, and quietly come by.',
          changes: { money: 95, days: 1, journal: 'Acted on the agent’s pepper tip — bought low, sold the turn. £95 clear.', closeHook: true },
        } },
      { label: 'Pass the word to a friendly captain', seed: 'A favour banked, not coin.',
        fixedOutcome: {
          prose: 'You send the intelligence on to a friendly English country master rather than work it yrself — a favour costs nothing to give and is rarely forgotten. He makes his buy, and his thanks are warm; the kind of credit that appears in no ledger but is drawn upon all the same.',
          changes: { reputation: { company: 2 }, days: 1, journal: 'Passed the agent’s pepper tip to a friend. A favour banked.', closeHook: true },
        } },
      { label: 'Keep it close; let the chance pass', seed: 'Caution. The window shuts.',
        fixedOutcome: {
          prose: 'You decide the risk of a falling market is not worth the candle this season, and let the opening pass. The price falls as the agent foretold, and rises again, and you are neither richer nor poorer for the knowing. He will not waste many such letters on a man who sits on them.',
          changes: { days: 0, journal: 'Let the agent’s pepper tip pass. The window shut.', closeHook: true },
        } },
    ],
  },
};

// An authored opportunity for this thread, or null (generic pursue). Resolves
// at call time: thread → the venture event whose hook matches → its lead. No
// module-init-order dependency on VENTURE_EVENTS.
function findPursueLead(thread) {
  if (!thread) return null;
  const ev = (VENTURE_EVENTS || []).find(e => e.hook === thread);
  return (ev && PURSUE_LEADS[ev.id]) || null;
}

async function genPursueThread(gs, thread) {
  const where = gs.location || 'Bayan-Kor';
  const scene = where === 'Bayan-Kor'
    ? `at the godown or compound at Bayan-Kor`
    : `at the wharves or in the back-rooms of ${where}`;
  const homeRule = where === 'Bayan-Kor'
    ? `Mr. Hodge, Sgt. Dass, the Vizier, and Reverend Pyke MAY appear if it is natural — the Factor is at home.`
    : `The Factor is NOT at home. Mr. Hodge, Sgt. Dass, the Vizier, and Reverend Pyke must NOT appear in person.`;

  const prompt = `The Factor decides to pursue a particular matter, ${scene}. He turns his attention deliberately to this:

THREAD TO PURSUE: ${thread}

${stateContext(gs)}

Generate a scene that brings the thread above into play. Use the named figures, places, and details already established in the state above. Do NOT invent a wholly new figure or thread for this scene — this scene is about the thread named, advanced, complicated, or partially resolved. ${homeRule}

This is an active investigation by the Factor, not a passive happening. The choices below should reflect what HE can decide to do about the thread now that it is before him.

CHOICE DISCIPLINE: Each choice MUST move the thread somewhere — close it, deepen it, or branch it. Avoid "set the matter aside" / "do nothing" / "leave well enough alone" choices, which produce empty outcomes and invite the player to re-pursue the same thread futilely. At least one of the three choices should plausibly RESOLVE the thread (so the resulting outcome can set closeHook: true). The other two should advance or complicate it in distinct directions. Three meaningful paths, never three flavours of the same retreat.

Return JSON:
{
  "prose": "2-3 sentences of period prose, concrete observation. Set the scene. The thread above must be central, not garnish.",
  "choices": [
    { "label": "5-9 word verb phrase — an action that changes the thread", "seed": "what tonally happens; hint resolution vs. complication" },
    { "label": "5-9 word verb phrase — an action that changes the thread", "seed": "what tonally happens; hint resolution vs. complication" },
    { "label": "5-9 word verb phrase — an action that changes the thread", "seed": "what tonally happens; hint resolution vs. complication" }
  ]
}`;
  // Fallback: one choice closes the thread (closesHook routes through the
  // pursue branch in handlePursueThread), one plants a related side-thread
  // via hook_opens, one complicates with a small money cost. The thread
  // text is echoed in the prose so the scene reads as bound to it.
  const fallback = {
    prose: `You apply yourself to the matter — ${thread.slice(0, 120)}${thread.length > 120 ? '…' : ''} — and find a foothold. There are paths now where there was only the question.`,
    choices: [
      { label: 'Press hard, settle the matter today', outcomeKey: 'cost', closesHook: true, seed: 'Closes the thread. A small cost.' },
      { label: 'Sound out a confederate before acting', outcomeKey: 'hook_opens', hook: 'A confederate who knows the same names; not always paid in coin.', seed: 'Opens a side-thread. Some rep ripple.' },
      { label: 'Pursue it through the bazaar quietly', outcomeKey: 'cost', seed: 'A small cost. The thread complicates.' },
    ],
  };
  const call = await callClaude(prompt);
  const result = call.parsed || fallback;
  const log = {
    type: 'pursue_thread',
    day: gs.day,
    location: gs.location,
    prompt: call.prompt,
    raw: call.raw,
    parsed: call.parsed,
    fallback: !call.parsed,
    error: call.error,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    meta: { thread },
  };
  return { result, log };
}

// Per-port arrival fallback. Each entry is sensory and port-distinctive
// (faction, lore, characteristic detail). genArrivalVignette is a once-per-port
// moment — only fires on first visit — so a single generic line was the
// least defensible part of the deterministic pool. Lookup falls back to the
// generic line for any port not in the table (defensive, shouldn't happen).
const ARRIVAL_VIGNETTE_FALLBACKS = {
  'Bayan-Kor': 'The Factor’s flag goes up the pole at first light. The Rajah’s drum sounds three short, one long — the welcome for a returning trader. The godown smells of palm oil and damp matting; Hodge waits at the door with the keys.',
  'Kota Pinang': 'The pilot brings her up through the morning haze. Ox-carts move pepper down the shore road; the dust hangs in still air. The Sultan’s harbormaster waits at the steps with a tally book and his own price.',
  'Port St. Eustace': 'A Dutch corporal hails from the bastion. The harbor is whitewashed to severity, the carts running to a schedule that brooks no slackening. Their factor watches from his window above the gate.',
  'The Pelican’s Nest': 'No flag, no bell, no harbormaster. A red lantern burns on the headland through the morning. A longboat puts out from the cove without challenge; the air carries woodsmoke and salt-pork.',
  'Tanjung Cermin': 'The lagoon opens in seven shades of blue. The old Portuguese fort stands above the palms, its walls gone soft under fig roots. Nothing on the shore answers to a flag.',
  'Fort Marlborough': 'The Union flag stands above the bastion. A boatswain’s whistle from the wharf, the Crown pilot cleaner-shaven than the Brotherhood’s. Pepper sacks are stacked in the King’s warehouse, their rope-marks black with damp.',
};

async function genArrivalVignette(gs, port) {
  const prompt = `The Factor arrives at ${port}. ${PORTS[port].blurb}
${stateContext(gs)}
Return JSON:
{
  "prose": "2-3 sentences of arrival prose. Sensory, specific to this port. Period."
}`;
  const fallbackProse = ARRIVAL_VIGNETTE_FALLBACKS[port]
    || `The ${port} pilot comes aboard at first light. The harbor smells of fish and woodsmoke.`;
  const call = await callClaude(prompt);
  const result = call.parsed?.prose || fallbackProse;
  const log = {
    type: 'arrival',
    day: gs.day,
    location: port,
    prompt: call.prompt,
    raw: call.raw,
    parsed: call.parsed,
    fallback: !call.parsed,
    error: call.error,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    meta: { port },
  };
  return { result, log };
}

// Event-aware deterministic fallback for genAwayDigest. Branches on event
// type in priority order (raid > incident > indiaman > construction >
// harvest > letter > default), then picks at random from the matched pool.
// The contextual mismatch the audit flagged \u2014 "ledger half-kept" prose
// firing after a raid \u2014 is what this addresses.
const FALLBACK_AWAY_DIGEST = {
  raid: [
    'The godown was raided in yr. absence. Hodge has the figures down to the cwt of what was lost. The compound is whole, but the matter is not.',
    'Dass meets you at the gate, sober. The raid was put down, but not without cost. The ledger reads short by a wide margin.',
    'You walk the godown by lamp before turning in. The locks are mended, the missing stock counted twice. The work tomorrow will be the worse for it.',
  ],
  incident: [
    'Returned to a household still mending. The compound stands; the ledger has gaps the work of a week will not close.',
    'There has been trouble while you were gone. Hodge is in some agitation; Dass is calmer but says less. The day will not run to its usual hours.',
    'You walk the compound and see what was done in yr. absence. Some matters can be set right by the close of the week; others will not be.',
  ],
  // Split by outcome: a successful lift of quota goods is the player's biggest
  // recurring win and should read as progress, not bureaucratic catch-up; an
  // empty call (godown bare when she came) should sting and motivate.
  indiaman_returns: [
    'The Indiaman has sailed, and yr. returns with her \u2014 bound for the Company\u2019s House and entered against the charter. The godown stands the lighter, and the reckoning the better, for her call.',
    'Her holds took what you had lodged, and she is away north for the Cape and home. So much of the charter is now on the water, beyond recall and beyond dispute. Hodge has pinned the receipt where you will see it.',
    'A good call, in yr. absence. The Company\u2019s ship lifted the returns from the godown and is gone for London. The figures move, at last, in the right direction \u2014 and Hodge has said as much, in his dry way.',
  ],
  indiaman_empty: [
    'An Indiaman had called in yr. absence \u2014 and found the godown wanting. Her holds went north the lighter for yr. having had nothing ready, and there will be a letter from the Court somewhere among the bills.',
    'You missed the Indiaman, and worse, she had little to take. Her sailing-bills are spread on the desk; the letter that came with them will not be a warm one.',
    'The Company\u2019s ship has come and gone, and the godown was bare when she came. A chance does not return for the asking; the next call must be better met.',
  ],
  'charter-end': [
    'The third year is up. A packet from the Court lies on the desk, the heavy seal unbroken, and you know without opening it that the matter of the charter is closed one way or the other. Three years of heat and salt and figures come down to what is written within. You break the wax.',
    'It is over, then. The Indiaman that should have come will write to a successor, or to you, or to no one — but the charter is run out, and the reckoning of these three years waits under the Court\'s seal on the desk. You sit a while before you open it.',
  ],
  shipyard: [
    'She was waiting at the slipway when you came in — two-masted, teak-built, her paint still green. The pinnace that carried you out is gone with the tide. You command a country ship now, and the strait will know it.',
    'The new vessel lies at the wharf, thrice the burthen of the old and far more bite. Hodge has the launch entered in the books; Dass walked her deck twice and said nothing, which from him is the highest praise.',
    'Yr. brigantine is launched. A man with such a ship is no longer a clerk minding a quota — he is a trader on his own account, and the difference is the whole of the matter.',
  ],
  construction: [
    'A new beam stands in the compound. Hodge runs through the figures of the build, then the figures of the household. The day proceeds.',
    'The work was finished while you were away. The men have gone back to their usual labour, and the carpenter is gone with the tide.',
  ],
  harvest: [
    'The pepper has come in. The godown smells of the new lot; the ledger awaits the entry. The work resumes its usual shape.',
    'A new entry in the godown books \u2014 the harvest, lodged. Hodge has the count down to the cwt, but expects you to verify it yourself.',
  ],
  letter: [
    'A packet of letters waited on the desk. Some will be answered easily; some will not. The bell sounds the noon, and the work resumes.',
    'Hodge has stacked the post in three piles by his own reckoning. You take up the topmost and read.',
  ],
  default: [
    'Returned to find the godown standing and the ledger half-kept. The work of catching up begins tomorrow.',
    'The compound is as you left it. Hodge meets you at the door with the keys and a list of small things. The day\u2019s work resumes.',
    'Came back to the same dock, the same matting, the same heat. There is little to remark upon. The bell sounds the hour.',
  ],
};

function pickAwayDigestFallback(awayEvents) {
  const events = awayEvents || [];
  const types = new Set(events.map(e => e.type));
  for (const key of ['charter-end', 'raid', 'incident', 'shipyard', 'indiaman', 'construction', 'harvest', 'letter']) {
    if (!types.has(key)) continue;
    let pool;
    if (key === 'indiaman') {
      // Did this call actually lift quota goods? Celebrate a real shipment;
      // sting an empty one.
      const lifted = events.some(e => e.type === 'indiaman' && (e.lifted || 0) > 0);
      pool = lifted ? FALLBACK_AWAY_DIGEST.indiaman_returns : FALLBACK_AWAY_DIGEST.indiaman_empty;
    } else {
      pool = FALLBACK_AWAY_DIGEST[key];
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const pool = FALLBACK_AWAY_DIGEST.default;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function genAwayDigest(gs, awayEvents) {
  if (!awayEvents || awayEvents.length === 0) return { result: null, log: null };
  const events = awayEvents.slice(-12).map(e => `Day ${e.day}: ${e.text}`).join('\n');
  const prompt = `The Factor returns to Bayan-Kor after a period away. In his absence, the following came to pass:

${events}

Compose a single paragraph (4-6 sentences) in the Factor\u2019s journal voice, written upon his return. He is reading the household ledger, hearing Hodge stammer through reports, and walking the compound. Period prose, dry observation, sensory detail. Do not list the events; weave them.

Return JSON: { "prose": "..." }`;
  const fallbackProse = pickAwayDigestFallback(awayEvents);
  const call = await callClaude(prompt);
  const result = call.parsed?.prose || fallbackProse;
  const log = {
    type: 'away_digest',
    day: gs.day,
    location: gs.location,
    prompt: call.prompt,
    raw: call.raw,
    parsed: call.parsed,
    fallback: !call.parsed,
    error: call.error,
    startedAt: call.startedAt,
    endedAt: call.endedAt,
    meta: { eventCount: awayEvents.length },
  };
  return { result, log };
}

// ─────────── COMPONENTS ───────────

// PWA: the woff2 latin subsets are vendored at public/fonts/ and land in the
// Workbox precache, so a first-ever offline launch renders fully styled.
// Legacy artifact runtime (`window.storage` present, same detection as
// plates.js): relative /fonts/ paths would 404 in the iframe, so it keeps
// the Google Fonts import. EB Garamond is one variable file covering 400–600.
const FONT_IMPORT = (typeof window !== 'undefined' && window.storage)
  ? `
@import url('https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap');
`
  : `
@font-face { font-family: 'EB Garamond'; font-style: normal; font-weight: 400 600; font-display: swap; src: url('/fonts/eb-garamond-400-600.woff2') format('woff2'); }
@font-face { font-family: 'EB Garamond'; font-style: italic; font-weight: 400; font-display: swap; src: url('/fonts/eb-garamond-400-italic.woff2') format('woff2'); }
@font-face { font-family: 'IM Fell English'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/im-fell-english-400.woff2') format('woff2'); }
@font-face { font-family: 'IM Fell English'; font-style: italic; font-weight: 400; font-display: swap; src: url('/fonts/im-fell-english-400-italic.woff2') format('woff2'); }
@font-face { font-family: 'IM Fell English SC'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/im-fell-english-sc-400.woff2') format('woff2'); }
`;

const Page = ({ children }) => (
  <div style={{
    minHeight: '100vh',
    width: '100%',
    overflowX: 'hidden',
    background: `
      radial-gradient(ellipse at top, #f0e3c4 0%, #e8d9b5 40%, #d9c596 100%),
      repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(120,80,40,0.03) 2px, rgba(120,80,40,0.03) 3px)
    `,
    color: '#2a1a0a',
    fontFamily: '"EB Garamond", "IM Fell English", Georgia, serif',
    fontSize: '17px',
    lineHeight: 1.55,
    boxSizing: 'border-box',
    // index.html sets viewport-fit=cover, which lets content run under the
    // notch / dynamic island / home bar. These resolve to 0 everywhere else.
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    paddingLeft: 'env(safe-area-inset-left, 0px)',
    paddingRight: 'env(safe-area-inset-right, 0px)',
  }}>
    <style>{FONT_IMPORT}{`
      *, *::before, *::after { box-sizing: border-box; }
      .display { font-family: "IM Fell English SC", "IM Fell English", serif; letter-spacing: 0.04em; }
      .body-fell { font-family: "IM Fell English", "EB Garamond", Georgia, serif; }
      .ink-link { color: #5c1a08; text-decoration: underline; text-decoration-style: solid; cursor: pointer; }
      .ink-link:hover { color: #8b1a1a; background: rgba(139,26,26,0.06); }
      .wax-button {
        background: linear-gradient(135deg, #8b1a1a 0%, #6b1212 100%);
        color: #f0e3c4; border: 1px solid #4a0c0c;
        padding: 0.55rem 1.1rem; cursor: pointer; min-height: 44px;
        font-family: "IM Fell English SC", serif; letter-spacing: 0.06em;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.15), 0 1px 2px rgba(0,0,0,0.25);
        transition: transform 0.1s; font-size: 0.95em;
      }
      .wax-button:hover { transform: translateY(-1px); }
      .wax-button:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
      .ghost-button {
        background: transparent; border: 1px solid #6b4423; color: #2a1a0a;
        padding: 0.5rem 0.95rem; cursor: pointer; min-height: 40px;
        font-family: "IM Fell English SC", serif; letter-spacing: 0.06em;
        transition: background 0.15s; font-size: 0.9em;
      }
      .ghost-button:hover { background: rgba(107,68,35,0.1); }
      .ghost-button:disabled { opacity: 0.35; cursor: not-allowed; }
      .ghost-button-sm {
        background: transparent; border: 1px solid #6b4423; color: #2a1a0a;
        padding: 0.35rem 0.55rem; cursor: pointer; min-height: 36px;
        font-family: "IM Fell English SC", serif; letter-spacing: 0.04em;
        font-size: 0.78em; white-space: nowrap;
      }
      .ghost-button-sm:hover { background: rgba(107,68,35,0.1); }
      .ghost-button-sm:disabled { opacity: 0.35; cursor: not-allowed; }
      .parchment {
        background: linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 100%);
        border: 1px solid rgba(74,44,20,0.35);
        box-shadow: 0 1px 3px rgba(74,44,20,0.15);
      }
      .drop-cap::first-letter {
        font-family: "IM Fell English SC", serif;
        font-size: 3.2em; float: left; line-height: 0.85;
        padding: 0.05em 0.1em 0 0; color: #5c1a08;
      }
      .fleuron { color: #6b4423; text-align: center; margin: 1em 0; letter-spacing: 0.5em; }
      .quill-cursor { animation: blink 1s steps(2) infinite; }
      @keyframes blink { 50% { opacity: 0; } }
      .ink-fade-in { animation: inkfade 0.7s ease-out; }
      @keyframes inkfade { from { opacity: 0; filter: blur(2px); } to { opacity: 1; filter: blur(0); } }
      input.parchment-input {
        background: rgba(255,255,255,0.4); border: none;
        border-bottom: 1px solid #5c1a08;
        font-family: "IM Fell English", serif; font-size: 1.1em;
        color: #2a1a0a; padding: 0.3rem 0.5rem; outline: none;
      }
      .scroll-thin::-webkit-scrollbar { width: 6px; }
      .scroll-thin::-webkit-scrollbar-thumb { background: rgba(74,44,20,0.4); }

      /* MOBILE-FIRST LAYOUT — auto-fit collapses based on actual container width,
         not viewport, so it works regardless of iframe quirks */
      .cols-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: 1.5rem; }
      .tab-row {
        display: flex; gap: 0;
        border-bottom: 1px solid rgba(74,44,20,0.3);
        overflow-x: auto; -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      .tab-row::-webkit-scrollbar { height: 0; display: none; }
      .tab-button {
        background: transparent; border: none;
        border-bottom: 2px solid transparent;
        padding: 0.7rem 1rem; min-height: 44px;
        font-family: "IM Fell English SC", serif;
        letter-spacing: 0.08em; font-size: 0.95em;
        color: #4a3220; cursor: pointer; white-space: nowrap;
      }
      .tab-button.active {
        background: rgba(74,44,20,0.12);
        border-bottom-color: #5c1a08;
        color: #5c1a08;
      }
      .trade-row {
        display: flex; flex-direction: column; align-items: stretch;
        padding: 0.5rem 0; border-bottom: 1px solid rgba(74,44,20,0.15);
        gap: 0.5rem;
      }
      .trade-row .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end; }
      @media (min-width: 600px) {
        .trade-row { flex-direction: row; align-items: center; justify-content: space-between; }
      }
    `}</style>
    {children}
  </div>
);

const Fleuron = ({ char = '❦' }) => (
  <div className="fleuron">{char} {char} {char}</div>
);

// ─────────── VIGNETTES ───────────
// Period-engraving SVG illustrations for loading screens.
// All sepia line work, no fills. Each scales fluidly within ~280px.

const vignetteWrap = {
  display: 'block', margin: '0 auto', width: '100%',
  maxWidth: '280px', height: 'auto',
};

const PinnaceVignette = () => (
  <svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={vignetteWrap}>
    <g stroke="#5c1a08" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Distant horizon hint */}
      <line x1="0" y1="92" x2="80" y2="92" opacity="0.3" strokeWidth="0.5" />
      <line x1="220" y1="92" x2="280" y2="92" opacity="0.3" strokeWidth="0.5" />
      {/* Hull */}
      <path d="M 90 102 L 200 102 L 195 110 L 100 110 Z" />
      <line x1="120" y1="102" x2="125" y2="110" opacity="0.5" />
      <line x1="160" y1="102" x2="163" y2="110" opacity="0.5" />
      <line x1="180" y1="102" x2="182" y2="110" opacity="0.5" />
      {/* Masts */}
      <line x1="118" y1="102" x2="115" y2="35" />
      <line x1="160" y1="102" x2="158" y2="25" />
      {/* Bowsprit */}
      <line x1="200" y1="102" x2="225" y2="92" />
      {/* Yardarms */}
      <line x1="98" y1="55" x2="135" y2="55" />
      <line x1="103" y1="38" x2="128" y2="38" />
      <line x1="138" y1="42" x2="180" y2="42" />
      <line x1="144" y1="28" x2="172" y2="28" />
      {/* Sails — slight billow */}
      <path d="M 100 56 Q 116 70 132 56 L 132 75 L 100 75 Z" />
      <path d="M 105 39 Q 116 45 127 39 L 127 53 L 105 53 Z" />
      <path d="M 140 43 Q 158 60 178 43 L 178 64 L 140 64 Z" />
      <path d="M 146 29 Q 158 35 170 29 L 170 41 L 146 41 Z" />
      {/* Jib */}
      <path d="M 200 68 L 158 25 L 222 92 Z" />
      {/* Birds */}
      <path d="M 35 30 Q 40 27 45 30 Q 50 27 55 30" strokeWidth="0.7" />
      <path d="M 235 22 Q 240 19 245 22" strokeWidth="0.7" />
      {/* Waves */}
      <path d="M 0 100 Q 40 96 80 100 T 160 100 T 280 100" />
      <path d="M 20 108 Q 60 104 100 108 T 180 108 T 260 108" opacity="0.5" />
      <path d="M 50 116 Q 90 112 130 116 T 210 116 T 280 116" opacity="0.3" />
    </g>
  </svg>
);

const HorizonVignette = () => (
  <svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={vignetteWrap}>
    <g stroke="#5c1a08" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Sun upper-left */}
      <circle cx="50" cy="38" r="12" />
      <line x1="30" y1="38" x2="20" y2="38" strokeWidth="0.6" />
      <line x1="36" y1="22" x2="30" y2="14" strokeWidth="0.6" />
      <line x1="36" y1="54" x2="30" y2="62" strokeWidth="0.6" />
      <line x1="64" y1="22" x2="70" y2="14" strokeWidth="0.6" />
      <line x1="64" y1="54" x2="70" y2="62" strokeWidth="0.6" />
      <line x1="70" y1="38" x2="80" y2="38" strokeWidth="0.6" />
      {/* Cloud */}
      <path d="M 160 30 q 5 -8 14 -5 q 5 -8 14 -2 q 8 -2 12 6 q -2 6 -10 5 l -25 0 q -5 -1 -5 -4" strokeWidth="0.8" />
      {/* Bird */}
      <path d="M 110 25 Q 115 22 120 25 Q 125 22 130 25" strokeWidth="0.7" />
      {/* Horizon */}
      <path d="M 0 80 L 280 80" />
      {/* Distant sail */}
      <path d="M 195 78 L 200 70 L 205 78 Z" strokeWidth="0.8" />
      <line x1="200" y1="70" x2="200" y2="78" strokeWidth="0.5" />
      {/* Wave hatches */}
      <path d="M 0 90 Q 30 87 60 90 T 120 90 T 240 90 T 280 90" opacity="0.5" />
      <path d="M 20 100 Q 50 97 80 100 T 160 100 T 240 100 T 280 100" opacity="0.4" />
      <path d="M 0 112 Q 40 109 80 112 T 200 112 T 280 112" opacity="0.3" />
      <path d="M 30 122 Q 70 119 110 122 T 220 122 T 280 122" opacity="0.25" />
      <path d="M 0 132 Q 50 129 100 132 T 220 132 T 280 132" opacity="0.2" />
    </g>
  </svg>
);

const HarborVignette = () => (
  <svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={vignetteWrap}>
    <g stroke="#5c1a08" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Foreground rigging — diagonal frame */}
      <line x1="0" y1="0" x2="40" y2="140" opacity="0.65" />
      <line x1="20" y1="0" x2="60" y2="140" opacity="0.45" />
      <line x1="280" y1="0" x2="240" y2="140" opacity="0.65" />
      <line x1="260" y1="0" x2="220" y2="140" opacity="0.45" />
      <line x1="0" y1="20" x2="280" y2="20" opacity="0.4" strokeWidth="0.6" />
      {/* Sun behind hill */}
      <path d="M 130 50 Q 140 40 150 50" opacity="0.4" strokeWidth="0.7" />
      {/* Hill */}
      <path d="M 80 90 Q 140 50 200 90" strokeWidth="0.8" />
      {/* Buildings */}
      <rect x="100" y="80" width="14" height="14" />
      <path d="M 99 80 L 107 72 L 115 80" />
      <rect x="125" y="74" width="18" height="20" />
      <path d="M 124 74 L 134 65 L 144 74" />
      <line x1="129" y1="80" x2="129" y2="86" opacity="0.6" />
      <line x1="135" y1="80" x2="135" y2="86" opacity="0.6" />
      {/* Pagoda */}
      <path d="M 155 75 L 160 60 L 165 75 Z" />
      <path d="M 152 84 L 168 84 L 165 75 L 155 75 Z" />
      {/* Palm trees */}
      <line x1="75" y1="90" x2="78" y2="105" />
      <path d="M 76 90 q -8 -4 -14 0 q 4 -4 14 -2" />
      <path d="M 77 90 q 8 -4 14 0 q -4 -4 -14 -2" />
      <path d="M 76 91 q -10 0 -12 6 q 6 -2 14 -2" />
      <path d="M 78 91 q 10 0 12 6 q -6 -2 -14 -2" />
      <line x1="195" y1="90" x2="198" y2="103" />
      <path d="M 196 90 q -8 -4 -14 0 q 4 -4 14 -2" />
      <path d="M 197 90 q 8 -4 14 0 q -4 -4 -14 -2" />
      <path d="M 196 91 q -10 0 -12 6 q 6 -2 14 -2" />
      {/* Waterline */}
      <path d="M 60 110 Q 100 107 140 110 T 220 110 Q 240 107 250 110" />
      <path d="M 70 118 Q 110 115 150 118 T 230 118" opacity="0.5" />
      <path d="M 80 126 Q 120 123 160 126 T 220 126" opacity="0.3" />
    </g>
  </svg>
);

const DeskVignette = () => (
  <svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={vignetteWrap}>
    <g stroke="#5c1a08" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Desk surface in slight perspective */}
      <path d="M 30 110 L 250 110 L 240 130 L 40 130 Z" />
      <line x1="40" y1="130" x2="40" y2="138" />
      <line x1="240" y1="130" x2="240" y2="138" />
      {/* Open ledger */}
      <path d="M 90 100 L 90 70 L 145 65 L 145 105 Z" />
      <path d="M 145 105 L 145 65 L 200 70 L 200 100 Z" />
      <line x1="145" y1="65" x2="145" y2="105" strokeWidth="0.6" />
      {/* Page lines */}
      <line x1="98" y1="78" x2="138" y2="76" opacity="0.5" strokeWidth="0.4" />
      <line x1="98" y1="84" x2="138" y2="82" opacity="0.5" strokeWidth="0.4" />
      <line x1="98" y1="90" x2="138" y2="88" opacity="0.5" strokeWidth="0.4" />
      <line x1="98" y1="96" x2="138" y2="94" opacity="0.5" strokeWidth="0.4" />
      <line x1="152" y1="76" x2="192" y2="78" opacity="0.5" strokeWidth="0.4" />
      <line x1="152" y1="82" x2="192" y2="84" opacity="0.5" strokeWidth="0.4" />
      <line x1="152" y1="88" x2="192" y2="90" opacity="0.5" strokeWidth="0.4" />
      <line x1="152" y1="94" x2="192" y2="96" opacity="0.5" strokeWidth="0.4" />
      {/* Candle */}
      <ellipse cx="60" cy="105" rx="6" ry="2" />
      <line x1="56" y1="105" x2="56" y2="60" />
      <line x1="64" y1="105" x2="64" y2="60" />
      <ellipse cx="60" cy="60" rx="4" ry="1.5" />
      <line x1="60" y1="60" x2="60" y2="55" strokeWidth="0.6" />
      <path d="M 60 55 Q 56 48 60 38 Q 64 48 60 55 Z" strokeWidth="0.8" />
      <path d="M 60 50 Q 58 46 60 42" opacity="0.5" strokeWidth="0.4" />
      <path d="M 60 35 q 2 -4 -1 -8" strokeWidth="0.4" opacity="0.4" />
      {/* Quill in inkwell */}
      <ellipse cx="225" cy="105" rx="8" ry="3" />
      <path d="M 217 105 L 217 95 Q 217 92 220 92 L 230 92 Q 233 92 233 95 L 233 105" />
      <line x1="223" y1="92" x2="223" y2="95" strokeWidth="0.5" opacity="0.5" />
      <line x1="227" y1="92" x2="227" y2="95" strokeWidth="0.5" opacity="0.5" />
      <line x1="225" y1="92" x2="245" y2="40" strokeWidth="1.2" />
      <path d="M 240 50 q -3 4 -2 8" strokeWidth="0.5" />
      <path d="M 243 45 q -3 4 -2 8" strokeWidth="0.5" />
      <path d="M 246 40 q -3 4 -2 8" strokeWidth="0.5" />
    </g>
  </svg>
);

const SealVignette = () => (
  <svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={vignetteWrap}>
    <g stroke="#5c1a08" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Letter, slightly skewed */}
      <path d="M 60 35 L 230 30 L 235 110 L 55 115 Z" />
      <line x1="62" y1="62" x2="232" y2="58" opacity="0.4" strokeWidth="0.5" />
      <line x1="62" y1="88" x2="234" y2="84" opacity="0.4" strokeWidth="0.5" />
      {/* Handwriting lines */}
      <line x1="75" y1="48" x2="180" y2="46" opacity="0.5" strokeWidth="0.4" />
      <line x1="75" y1="55" x2="200" y2="52" opacity="0.5" strokeWidth="0.4" />
      <line x1="75" y1="72" x2="190" y2="70" opacity="0.5" strokeWidth="0.4" />
      <line x1="75" y1="78" x2="170" y2="76" opacity="0.5" strokeWidth="0.4" />
      <line x1="75" y1="98" x2="160" y2="96" opacity="0.5" strokeWidth="0.4" />
      {/* Wax seal */}
      <circle cx="200" cy="90" r="18" strokeWidth="1.2" />
      <circle cx="200" cy="90" r="14" strokeWidth="0.6" opacity="0.7" />
      <line x1="190" y1="80" x2="210" y2="100" strokeWidth="0.7" />
      <line x1="210" y1="80" x2="190" y2="100" strokeWidth="0.7" />
      <line x1="200" y1="76" x2="200" y2="104" strokeWidth="0.7" />
      <line x1="186" y1="90" x2="214" y2="90" strokeWidth="0.7" />
      {/* Wax drip */}
      <path d="M 195 108 q -1 4 -3 8 q 4 -2 6 -8" strokeWidth="0.6" />
    </g>
  </svg>
);

const MessengerVignette = () => (
  <svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={vignetteWrap}>
    <g stroke="#5c1a08" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Ground */}
      <path d="M 0 110 L 280 110" />
      <path d="M 30 116 L 130 114 L 240 117" opacity="0.4" strokeWidth="0.5" />
      {/* Palm tree left */}
      <line x1="40" y1="110" x2="44" y2="50" />
      <path d="M 42 50 q -10 -8 -18 -3 q 8 -5 18 -1" />
      <path d="M 43 50 q 10 -8 18 -3 q -8 -5 -18 -1" />
      <path d="M 42 51 q -12 0 -16 8 q 8 -3 18 -3" />
      <path d="M 43 51 q 12 0 16 8 q -8 -3 -18 -3" />
      <path d="M 42 52 q -8 4 -8 12 q 4 -6 12 -8" />
      {/* Palm tree right */}
      <line x1="240" y1="110" x2="237" y2="55" />
      <path d="M 238 55 q -10 -8 -18 -3 q 8 -5 18 -1" />
      <path d="M 239 55 q 10 -8 18 -3 q -8 -5 -18 -1" />
      <path d="M 238 56 q -12 0 -16 8 q 8 -3 18 -3" />
      <path d="M 239 56 q 12 0 16 8 q -8 -3 -18 -3" />
      {/* Distant building */}
      <rect x="170" y="85" width="20" height="22" opacity="0.5" />
      <path d="M 169 85 L 180 75 L 191 85" opacity="0.5" />
      {/* Walking figure */}
      <circle cx="120" cy="78" r="4" strokeWidth="0.8" />
      {/* Hat */}
      <path d="M 116 75 L 124 75" strokeWidth="0.7" />
      <path d="M 117 74 L 123 74 L 122 71 L 118 71 Z" strokeWidth="0.7" />
      {/* Body */}
      <line x1="120" y1="82" x2="118" y2="98" />
      {/* Arms */}
      <line x1="118" y1="86" x2="125" y2="92" />
      <line x1="118" y1="86" x2="112" y2="94" />
      {/* Satchel */}
      <rect x="124" y="92" width="6" height="8" strokeWidth="0.7" />
      {/* Legs mid-stride */}
      <line x1="118" y1="98" x2="123" y2="110" />
      <line x1="118" y1="98" x2="113" y2="108" />
    </g>
  </svg>
);

const HourglassVignette = () => (
  <svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={vignetteWrap}>
    <g stroke="#5c1a08" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Top frame */}
      <line x1="120" y1="30" x2="160" y2="30" strokeWidth="1.5" />
      <line x1="118" y1="32" x2="162" y2="32" strokeWidth="0.6" opacity="0.7" />
      {/* Bottom frame */}
      <line x1="120" y1="118" x2="160" y2="118" strokeWidth="1.5" />
      <line x1="118" y1="116" x2="162" y2="116" strokeWidth="0.6" opacity="0.7" />
      {/* Side posts */}
      <line x1="122" y1="32" x2="122" y2="116" />
      <line x1="158" y1="32" x2="158" y2="116" />
      {/* Hourglass shape */}
      <path d="M 128 35 L 152 35 L 142 72 L 152 110 L 128 110 L 138 72 Z" />
      {/* Sand top */}
      <path d="M 130 38 L 150 38 L 144 60 Q 140 64 136 60 Z" strokeWidth="0.5" opacity="0.5" />
      <line x1="131" y1="42" x2="149" y2="42" opacity="0.4" strokeWidth="0.4" />
      <line x1="132" y1="46" x2="148" y2="46" opacity="0.4" strokeWidth="0.4" />
      <line x1="134" y1="50" x2="146" y2="50" opacity="0.4" strokeWidth="0.4" />
      <line x1="136" y1="54" x2="144" y2="54" opacity="0.4" strokeWidth="0.4" />
      {/* Falling stream */}
      <line x1="140" y1="72" x2="140" y2="100" strokeWidth="0.5" opacity="0.6" />
      {/* Sand bottom */}
      <path d="M 132 107 Q 140 102 148 107 L 148 109 L 132 109 Z" strokeWidth="0.5" opacity="0.5" />
      {/* Flourish wings */}
      <path d="M 122 36 q -10 -2 -18 4" strokeWidth="0.6" opacity="0.7" />
      <path d="M 158 36 q 10 -2 18 4" strokeWidth="0.6" opacity="0.7" />
      <path d="M 122 114 q -10 2 -18 -4" strokeWidth="0.6" opacity="0.7" />
      <path d="M 158 114 q 10 2 18 -4" strokeWidth="0.6" opacity="0.7" />
    </g>
  </svg>
);

const ChartVignette = () => (
  <svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={vignetteWrap}>
    <g stroke="#5c1a08" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Left rolled portion */}
      <ellipse cx="40" cy="70" rx="8" ry="35" />
      <line x1="40" y1="35" x2="40" y2="105" opacity="0.5" />
      <ellipse cx="40" cy="70" rx="5" ry="30" opacity="0.5" />
      {/* Right rolled portion */}
      <ellipse cx="240" cy="70" rx="8" ry="35" />
      <line x1="240" y1="35" x2="240" y2="105" opacity="0.5" />
      <ellipse cx="240" cy="70" rx="5" ry="30" opacity="0.5" />
      {/* Unrolled middle */}
      <path d="M 40 35 L 240 35" />
      <path d="M 40 105 L 240 105" />
      {/* Islands */}
      <path d="M 70 60 Q 90 55 110 65 Q 100 75 80 72 Q 65 70 70 60 Z" strokeWidth="0.7" />
      <path d="M 130 75 Q 145 70 160 80 Q 155 88 140 86 Q 125 84 130 75 Z" strokeWidth="0.7" />
      <path d="M 180 55 Q 200 50 215 60 Q 210 72 195 70 Q 175 65 180 55 Z" strokeWidth="0.7" />
      {/* Compass rose */}
      <circle cx="200" cy="88" r="6" strokeWidth="0.6" />
      <line x1="200" y1="80" x2="200" y2="96" strokeWidth="0.7" />
      <line x1="192" y1="88" x2="208" y2="88" strokeWidth="0.7" />
      <path d="M 200 80 L 203 88 L 200 96 L 197 88 Z" strokeWidth="0.4" />
      {/* Sea hatches */}
      <path d="M 50 85 Q 65 83 80 85" opacity="0.4" strokeWidth="0.4" />
      <path d="M 90 95 Q 105 93 120 95" opacity="0.4" strokeWidth="0.4" />
      <path d="M 150 50 Q 165 48 180 50" opacity="0.4" strokeWidth="0.4" />
      {/* Dashed route */}
      <path d="M 75 65 L 145 80 L 195 65" strokeWidth="0.6" strokeDasharray="3 2" opacity="0.6" />
      {/* X marks */}
      <line x1="90" y1="63" x2="94" y2="67" strokeWidth="0.5" />
      <line x1="94" y1="63" x2="90" y2="67" strokeWidth="0.5" />
    </g>
  </svg>
);

// A thatched godown raised on stone piers, bales stacked within. Used for
// scenes about lodging stock, raids on the warehouse, the harvest coming in.
const GodownVignette = () => (
  <svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={vignetteWrap}>
    <g stroke="#5c1a08" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Distant palms */}
      <line x1="20" y1="120" x2="20" y2="65" opacity="0.5" strokeWidth="0.7" />
      <path d="M 20 65 q -6 -3 -10 -10 m 10 10 q 6 -3 10 -10 m -10 10 q -2 -8 -2 -16 m 2 16 q 8 -2 14 -8" opacity="0.5" strokeWidth="0.6" />
      <line x1="258" y1="118" x2="258" y2="68" opacity="0.5" strokeWidth="0.7" />
      <path d="M 258 68 q -6 -3 -10 -10 m 10 10 q 6 -3 10 -10 m -10 10 q -2 -8 -2 -16 m 2 16 q 8 -2 14 -8" opacity="0.5" strokeWidth="0.6" />
      {/* Ground line */}
      <path d="M 0 120 L 280 120" />
      {/* Stone piers */}
      <rect x="62" y="112" width="14" height="8" />
      <rect x="100" y="112" width="14" height="8" />
      <rect x="138" y="112" width="14" height="8" />
      <rect x="176" y="112" width="14" height="8" />
      <rect x="214" y="112" width="14" height="8" />
      {/* Floor beam */}
      <line x1="55" y1="112" x2="235" y2="112" />
      {/* Walls */}
      <line x1="60" y1="112" x2="60" y2="70" />
      <line x1="230" y1="112" x2="230" y2="70" />
      {/* Roof — thatched, slight slope, with overhang */}
      <path d="M 50 70 L 145 38 L 240 70" />
      <path d="M 60 70 L 230 70" />
      {/* Thatch hatching */}
      <line x1="80" y1="60" x2="78" y2="65" opacity="0.5" strokeWidth="0.5" />
      <line x1="100" y1="55" x2="98" y2="60" opacity="0.5" strokeWidth="0.5" />
      <line x1="120" y1="50" x2="118" y2="55" opacity="0.5" strokeWidth="0.5" />
      <line x1="140" y1="46" x2="138" y2="51" opacity="0.5" strokeWidth="0.5" />
      <line x1="160" y1="50" x2="158" y2="55" opacity="0.5" strokeWidth="0.5" />
      <line x1="180" y1="55" x2="178" y2="60" opacity="0.5" strokeWidth="0.5" />
      <line x1="200" y1="60" x2="198" y2="65" opacity="0.5" strokeWidth="0.5" />
      {/* Door */}
      <path d="M 138 112 L 138 90 L 152 90 L 152 112" />
      {/* Bales/crates inside, suggested through the doorway */}
      <rect x="76" y="98" width="14" height="14" opacity="0.6" />
      <rect x="92" y="100" width="14" height="12" opacity="0.5" />
      <rect x="195" y="98" width="14" height="14" opacity="0.6" />
      <rect x="178" y="100" width="14" height="12" opacity="0.5" />
      {/* A sack with a tied top */}
      <path d="M 84 98 q 0 -4 6 -4 q 6 0 6 4 z" opacity="0.4" />
      {/* Lantern hung at the eaves */}
      <line x1="145" y1="38" x2="145" y2="52" strokeWidth="0.6" opacity="0.7" />
      <rect x="142" y="52" width="6" height="8" opacity="0.7" />
    </g>
  </svg>
);

// A two-masted brigantine, square-rigged on the foremast and fore-and-aft on
// the main. Bigger than the pinnace; used for commission events and
// brigantine voyages.
const BrigantineVignette = () => (
  <svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={vignetteWrap}>
    <g stroke="#5c1a08" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Distant horizon */}
      <line x1="0" y1="92" x2="60" y2="92" opacity="0.3" strokeWidth="0.5" />
      <line x1="240" y1="92" x2="280" y2="92" opacity="0.3" strokeWidth="0.5" />
      {/* Hull — longer than the pinnace */}
      <path d="M 60 102 L 220 102 L 213 112 L 70 112 Z" />
      <line x1="90" y1="102" x2="93" y2="112" opacity="0.5" />
      <line x1="120" y1="102" x2="122" y2="112" opacity="0.5" />
      <line x1="160" y1="102" x2="161" y2="112" opacity="0.5" />
      <line x1="195" y1="102" x2="194" y2="112" opacity="0.5" />
      {/* Gunports */}
      <rect x="84" y="104" width="3" height="3" opacity="0.7" />
      <rect x="110" y="104" width="3" height="3" opacity="0.7" />
      <rect x="138" y="104" width="3" height="3" opacity="0.7" />
      <rect x="166" y="104" width="3" height="3" opacity="0.7" />
      <rect x="192" y="104" width="3" height="3" opacity="0.7" />
      {/* Foremast (square-rigged) */}
      <line x1="100" y1="102" x2="98" y2="22" />
      {/* Mainmast (fore-and-aft rigged, slightly aft) */}
      <line x1="170" y1="102" x2="168" y2="20" />
      {/* Bowsprit */}
      <line x1="220" y1="102" x2="248" y2="92" />
      {/* Foremast yards */}
      <line x1="78" y1="68" x2="120" y2="68" />
      <line x1="82" y1="50" x2="116" y2="50" />
      <line x1="86" y1="34" x2="112" y2="34" />
      {/* Mainmast gaff */}
      <line x1="170" y1="50" x2="148" y2="36" />
      <line x1="170" y1="76" x2="148" y2="80" />
      {/* Square sails on foremast */}
      <path d="M 80 69 Q 100 84 120 69 L 120 88 L 80 88 Z" />
      <path d="M 84 51 Q 100 60 116 51 L 116 67 L 84 67 Z" />
      <path d="M 88 35 Q 100 41 112 35 L 112 49 L 88 49 Z" />
      {/* Fore-and-aft (gaff sail) on mainmast */}
      <path d="M 148 36 L 168 30 L 168 80 L 148 80 Z" />
      {/* Jib */}
      <path d="M 220 70 L 168 22 L 246 92 Z" />
      {/* Pennant */}
      <path d="M 168 20 L 178 16 L 178 22 L 168 22 Z" />
      {/* Birds */}
      <path d="M 30 28 Q 35 25 40 28 Q 45 25 50 28" strokeWidth="0.7" />
      <path d="M 250 18 Q 255 15 260 18" strokeWidth="0.7" />
      {/* Waves */}
      <path d="M 0 102 Q 30 98 60 102 T 220 102 T 280 102" />
      <path d="M 0 110 Q 40 106 80 110 T 200 110 T 280 110" opacity="0.5" />
      <path d="M 30 118 Q 70 114 110 118 T 230 118 T 280 118" opacity="0.3" />
    </g>
  </svg>
);

// A three-masted East Indiaman at anchor, much larger than the brigantine,
// flying the Company colours. Used for Indiaman call events.
const IndiamanVignette = () => (
  <svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={vignetteWrap}>
    <g stroke="#5c1a08" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Distant low coastline */}
      <path d="M 0 96 q 30 -2 60 0 q 30 2 60 -1 q 30 -2 60 0 q 30 2 60 0 q 20 -1 40 0" opacity="0.3" strokeWidth="0.6" />
      {/* Hull — broad, with stern castle */}
      <path d="M 40 100 L 230 100 L 224 115 L 50 115 Z" />
      <path d="M 220 100 L 232 100 L 232 92 L 224 92 Z" />
      {/* Two stripes of gunports */}
      <line x1="60" y1="105" x2="216" y2="105" opacity="0.4" />
      <line x1="60" y1="110" x2="216" y2="110" opacity="0.3" />
      {/* Stern windows */}
      <line x1="225" y1="98" x2="232" y2="98" opacity="0.6" strokeWidth="0.5" />
      {/* Three masts */}
      <line x1="80" y1="100" x2="78" y2="14" />
      <line x1="135" y1="100" x2="133" y2="8" />
      <line x1="195" y1="100" x2="193" y2="20" />
      {/* Bowsprit */}
      <line x1="40" y1="100" x2="14" y2="86" />
      <line x1="14" y1="86" x2="14" y2="62" />
      {/* Foremast yards (3 levels) */}
      <line x1="58" y1="62" x2="100" y2="62" />
      <line x1="62" y1="44" x2="96" y2="44" />
      <line x1="66" y1="28" x2="92" y2="28" />
      {/* Mainmast yards (3 levels) */}
      <line x1="113" y1="56" x2="155" y2="56" />
      <line x1="117" y1="38" x2="151" y2="38" />
      <line x1="121" y1="22" x2="147" y2="22" />
      {/* Mizzen yards */}
      <line x1="174" y1="68" x2="212" y2="68" />
      <line x1="178" y1="50" x2="208" y2="50" />
      {/* Foremast sails */}
      <path d="M 60 63 Q 80 78 100 63 L 100 84 L 60 84 Z" />
      <path d="M 64 45 Q 80 54 96 45 L 96 61 L 64 61 Z" />
      <path d="M 68 29 Q 80 35 92 29 L 92 43 L 68 43 Z" />
      {/* Mainmast sails */}
      <path d="M 115 57 Q 135 72 155 57 L 155 78 L 115 78 Z" />
      <path d="M 119 39 Q 135 48 151 39 L 151 55 L 119 55 Z" />
      <path d="M 123 23 Q 135 29 147 23 L 147 37 L 123 37 Z" />
      {/* Mizzen sails */}
      <path d="M 176 69 Q 193 80 210 69 L 210 88 L 176 88 Z" />
      <path d="M 180 51 Q 193 58 206 51 L 206 67 L 180 67 Z" />
      {/* Lateen on mizzen above */}
      <path d="M 193 22 L 175 38 L 193 40 Z" />
      {/* Jibs */}
      <path d="M 14 62 L 78 14 L 14 86 Z" opacity="0.85" />
      {/* Company pennant — long, three-tail */}
      <path d="M 133 8 L 156 6 L 152 11 L 156 14 L 133 12 Z" />
      {/* Anchor cable */}
      <line x1="40" y1="115" x2="22" y2="125" opacity="0.6" />
      {/* Waves */}
      <path d="M 0 118 Q 40 114 80 118 T 200 118 T 280 118" />
      <path d="M 0 126 Q 50 122 100 126 T 220 126 T 280 126" opacity="0.45" />
      <path d="M 30 134 Q 70 130 110 134 T 230 134 T 280 134" opacity="0.3" />
    </g>
  </svg>
);

// The Rajah's palace on its hill above Bayan-Kor — a tiered roof, palms,
// the suggestion of a courtyard. Used for Vizier letters and palace scenes.
const PalaceVignette = () => (
  <svg viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={vignetteWrap}>
    <g stroke="#5c1a08" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Hill — gentle curve */}
      <path d="M 0 124 Q 60 96 140 88 Q 220 96 280 124" />
      {/* Palms flanking */}
      <line x1="40" y1="120" x2="40" y2="76" opacity="0.7" strokeWidth="0.7" />
      <path d="M 40 76 q -8 -4 -14 -12 m 14 12 q 8 -4 14 -12 m -14 12 q -3 -10 -3 -20 m 3 20 q 10 -3 16 -10" opacity="0.7" strokeWidth="0.6" />
      <line x1="240" y1="120" x2="240" y2="74" opacity="0.7" strokeWidth="0.7" />
      <path d="M 240 74 q -8 -4 -14 -12 m 14 12 q 8 -4 14 -12 m -14 12 q -3 -10 -3 -20 m 3 20 q 10 -3 16 -10" opacity="0.7" strokeWidth="0.6" />
      {/* Palace base — wide platform */}
      <rect x="100" y="86" width="80" height="6" />
      {/* Walls of the palace */}
      <rect x="108" y="62" width="64" height="24" />
      {/* Doors and windows */}
      <path d="M 134 86 L 134 70 Q 140 64 146 70 L 146 86" />
      <rect x="116" y="68" width="8" height="10" opacity="0.6" />
      <rect x="156" y="68" width="8" height="10" opacity="0.6" />
      {/* Tiered roof — first tier */}
      <path d="M 100 62 Q 140 50 180 62" />
      {/* Second (smaller) tier */}
      <path d="M 118 50 Q 140 40 162 50" />
      <rect x="124" y="40" width="32" height="10" opacity="0.4" />
      {/* Spire */}
      <line x1="140" y1="40" x2="140" y2="22" />
      <circle cx="140" cy="20" r="2" />
      {/* Pennant on spire */}
      <path d="M 140 22 L 152 18 L 152 26 L 140 28 Z" opacity="0.7" />
      {/* Steps to the platform */}
      <line x1="128" y1="92" x2="152" y2="92" opacity="0.6" strokeWidth="0.6" />
      <line x1="124" y1="98" x2="156" y2="98" opacity="0.6" strokeWidth="0.6" />
      <line x1="120" y1="104" x2="160" y2="104" opacity="0.6" strokeWidth="0.6" />
      {/* Distant low rooftops at the foot of the hill */}
      <path d="M 60 122 L 65 116 L 70 122" opacity="0.5" strokeWidth="0.6" />
      <path d="M 75 122 L 80 116 L 85 122" opacity="0.4" strokeWidth="0.6" />
      <path d="M 200 122 L 205 116 L 210 122" opacity="0.4" strokeWidth="0.6" />
      <path d="M 215 122 L 220 116 L 225 122" opacity="0.5" strokeWidth="0.6" />
      {/* Birds */}
      <path d="M 195 30 Q 200 27 205 30 Q 210 27 215 30" strokeWidth="0.7" opacity="0.7" />
    </g>
  </svg>
);

// Map a loading message to the appropriate vignette by keyword.
function pickVignette(msg) {
  if (!msg) return null;
  const m = msg.toLowerCase();
  if (m.includes('cargo') || m.includes('hoisting') || m.includes('sail')) return <PinnaceVignette />;
  if (m.includes('voyage') || m.includes('uneventful')) return <HorizonVignette />;
  if (m.includes('coming into port') || m.includes('arriv')) return <HarborVignette />;
  if (m.includes('absence') || m.includes('surveying') || m.includes('passed in')) return <DeskVignette />;
  if (m.includes('sealing') || m.includes('letter')) return <SealVignette />;
  if (m.includes('messenger') || m.includes('compound')) return <MessengerVignette />;
  if (m.includes('hour passes') || m.includes('hour')) return <HourglassVignette />;
  if (m.includes('chart') || m.includes('unrolling')) return <ChartVignette />;
  if (m.includes('godown') || m.includes('warehouse') || m.includes('lodge') || m.includes('stocks')) return <GodownVignette />;
  if (m.includes('brigantine') || m.includes('slipway') || m.includes('keel') || m.includes('caulk')) return <BrigantineVignette />;
  if (m.includes('indiaman') || m.includes('east india')) return <IndiamanVignette />;
  if (m.includes('palace') || m.includes('vizier') || m.includes('rajah')) return <PalaceVignette />;
  return null;
}

// ─────────── ART PLATES ───────────
function ImagePlate({ plate }) {
  const [open, setOpen] = useState(false);
  if (!plate) return null;
  if (!open) {
    return (
      <button
        className="ghost-button-sm"
        onClick={() => setOpen(true)}
        style={{ marginTop: '0.5rem' }}
        title={`Show the plate: ${plate.title}`}
      >
        ✦ See the plate &mdash; <span style={{ fontStyle: 'italic' }}>{plate.title}</span>
      </button>
    );
  }
  return (
    <div style={{
      marginTop: '0.7rem',
      padding: '0.4rem',
      background: 'rgba(255,255,255,0.25)',
      border: '1px solid rgba(74,44,20,0.2)',
    }}>
      <img
        src={plate.src}
        alt={plate.title}
        style={{ width: '100%', maxWidth: '720px', height: 'auto', display: 'block', margin: '0 auto' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '0.4rem', flexWrap: 'wrap', gap: '0.3rem' }}>
        <span className="display" style={{ fontSize: '0.8em', color: '#6b4423', letterSpacing: '0.06em' }}>{plate.title}</span>
        <button className="ghost-button-sm" onClick={() => setOpen(false)}>Hide</button>
      </div>
    </div>
  );
}
const Loading = ({ msg }) => {
  const vignette = pickVignette(msg);
  return (
    <div className="text-center italic" style={{ color: '#6b4423', padding: '2rem' }}>
      {vignette && (
        <div className="ink-fade-in" style={{ marginBottom: '1.2rem', opacity: 0.85 }}>
          {vignette}
        </div>
      )}
      <div className="display" style={{ fontSize: '0.9em' }}>{msg}<span className="quill-cursor">▌</span></div>
    </div>
  );
};

// ─────────── TITLE SCREEN ───────────

function TitleScreen({ saves, remoteOnlyCharters = [], remoteLoading = false, factorKey, onNewGame, onContinue, onRestore, onDeleteSlot, onResumeRemote }) {
  const [name, setName] = useState('Jonathan Wexley');
  const [showRestore, setShowRestore] = useState(false);
  const [restoreText, setRestoreText] = useState('');
  const [flash, setFlash] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(null); // slot id
  const [hydrating, setHydrating] = useState(null); // playthroughId currently being pulled
  // One-time iOS storage-eviction nudge — shown only on iOS-family browsers
  // with a save to lose, until dismissed.
  const ITP_DISMISS_KEY = 'factor_itp_nudge_dismissed_v1';
  const [showItpNudge, setShowItpNudge] = useState(false);
  useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem(ITP_DISMISS_KEY);
      if (!dismissed && isIOSlike() && Array.isArray(saves) && saves.length > 0) {
        setShowItpNudge(true);
      }
    } catch (e) { /* storage blocked — nothing to protect anyway */ }
  }, [saves]);
  const dismissItpNudge = () => {
    setShowItpNudge(false);
    try { window.localStorage.setItem(ITP_DISMISS_KEY, '1'); } catch (e) { /* ignore */ }
  };

  const hasSaves = Array.isArray(saves) && saves.length > 0;
  const hasRemoteOnly = Array.isArray(remoteOnlyCharters) && remoteOnlyCharters.length > 0;

  const handleResumeRemote = async (id) => {
    if (!onResumeRemote) return;
    setHydrating(id);
    try {
      await onResumeRemote(id);
    } finally {
      setHydrating(null);
    }
  };

  const showFlash = (msg) => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 2500);
  };

  const handleRestore = () => {
    try {
      const parsed = JSON.parse(restoreText.trim());
      if (parsed.gs && parsed.gs.player && parsed.gs.day !== undefined) {
        onRestore(parsed.gs);
      } else {
        showFlash('That does not look like a valid manuscript.');
      }
    } catch (e) {
      showFlash('Could not parse the manuscript.');
    }
  };

  const handleNewGame = () => {
    onNewGame(name || 'Jonathan Wexley');
  };

  // Period-light "X ago" — keep it short for the roster row.
  const fmtAgo = (ts) => {
    if (!ts) return '';
    const ms = Date.now() - ts;
    const m = Math.floor(ms / 60000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `saved ${d}d ago`;
    if (h > 0) return `saved ${h}h ago`;
    if (m > 0) return `saved ${m}m ago`;
    return 'saved just now';
  };

  return (
    <div className="ink-fade-in text-center" style={{ maxWidth: '42rem', margin: '0 auto', padding: '3rem 1.5rem', width: '100%' }}>
      <div className="display" style={{ fontSize: '0.85em', letterSpacing: '0.3em', color: '#6b4423', marginBottom: '1rem' }}>
        IN THE YEAR OF OUR LORD
      </div>
      <div className="display" style={{ fontSize: '1.4em', color: '#5c1a08', marginBottom: '2rem' }}>
        ONE THOUSAND SEVEN HUNDRED &amp; TWENTY-ONE
      </div>
      <h1 className="display" style={{ fontSize: '3em', lineHeight: 1, color: '#2a1a0a', marginBottom: '0.3em' }}>
        The Factor&rsquo;s
      </h1>
      <h1 className="display" style={{ fontSize: '3em', lineHeight: 1, color: '#2a1a0a', marginBottom: '1.5rem' }}>
        Charter
      </h1>
      <div style={{ margin: '0 auto 1.5rem', maxWidth: '320px' }}>
        <PinnaceVignette />
      </div>
      <Fleuron />
      <p className="body-fell italic" style={{ fontSize: '1.05em', color: '#4a3220', maxWidth: '32rem', margin: '0 auto 2rem' }}>
        Being the private journal of one Factor in the East, dispatched by the Honourable Company,
        kept in his own hand, beginning the day of his arrival at Bayan-Kor.
      </p>
      <Fleuron char="❧" />

      {showItpNudge && (
        <div style={{
          marginTop: '1.5rem', textAlign: 'left', maxWidth: '32rem',
          marginLeft: 'auto', marginRight: 'auto',
          padding: '0.8rem 1rem', background: 'rgba(255,255,255,0.35)',
          borderLeft: '3px solid #8b5a1a',
        }}>
          <div className="display" style={{ fontSize: '0.8em', color: '#8b5a1a', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
            A WORD ON KEEPING YR. SAVES
          </div>
          <p className="italic" style={{ margin: '0 0 0.6rem', color: '#4a3220', fontSize: '0.9em' }}>
            On an Apple device, a charter left untouched for a week may be swept from this device's memory. Yr. charters are also kept under yr. factor key{factorKey ? <> (<strong>{factorKey}</strong>)</> : ''} — copy it somewhere safe, or download a manuscript from the in-game menu, and no tide can carry yr. work off.
          </p>
          <button className="ghost-button" onClick={dismissItpNudge} style={{ fontSize: '0.82em' }}>
            Understood
          </button>
        </div>
      )}

      {/* ROSTER of charters in progress */}
      {hasSaves && (
        <div style={{ marginTop: '1.5rem', textAlign: 'left' }}>
          <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.1em', marginBottom: '0.5rem', textAlign: 'center' }}>
            ⁂ CHARTERS IN PROGRESS
          </div>
          {saves.map(s => {
            const totalDays = (s.day || 0) + (s.daysRemaining || 0);
            const isConfirming = confirmingDelete === s.id;
            return (
              <div key={s.id} className="parchment" style={{
                padding: '0.8rem 1rem', marginBottom: '0.5rem',
                background: 'rgba(255,253,245,0.55)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '12rem' }}>
                    <div style={{ fontStyle: 'italic', color: '#4a3220' }}>
                      {s.name}, Factor at {s.location || 'Bayan-Kor'}
                    </div>
                    <div style={{ fontSize: '0.82em', color: '#6b4423', letterSpacing: '0.04em' }}>
                      {s.charterClosed
                        ? <>Charter closed{s.charterClosed.destiny ? ` — ${({
                            'crown-knighthood':       'knighted',
                            'country-estate':         'a country estate',
                            'bayan-kor-seat':         'Resident at Bayan-Kor',
                            'brotherhood-retirement': 'with the Brotherhood',
                            'merchant-prince':        'a merchant prince',
                            'senior-factor':          'honourable',
                            'quiet-retirement':       'partial',
                            'recall-disgrace':        'recalled',
                          })[s.charterClosed.destiny] || s.charterClosed.outcome}` : (s.charterClosed.outcome ? ` — ${s.charterClosed.outcome}` : '')} &middot; {fmtAgo(s.lastSavedAt)}</>
                        : <>Day {s.day}{totalDays ? ` of ${totalDays}` : ''} &middot; {fmtAgo(s.lastSavedAt)}</>}
                    </div>
                  </div>
                  {!isConfirming && (
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <button className="wax-button" onClick={() => onContinue(s.id)} style={{ padding: '0.35rem 0.7rem', fontSize: '0.88em' }}>
                        Resume
                      </button>
                      <button
                        className="ghost-button-sm"
                        onClick={() => setConfirmingDelete(s.id)}
                        aria-label="Strike out this charter"
                        title="Strike out this charter"
                        style={{ color: '#6b4423', padding: '0.2rem 0.5rem' }}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
                {isConfirming && (
                  <div className="ink-fade-in" style={{ marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px dashed rgba(92,26,8,0.3)' }}>
                    <div style={{ fontStyle: 'italic', color: '#5c1a08', fontSize: '0.9em', marginBottom: '0.5rem' }}>
                      Strike {s.name}&rsquo;s charter from the rolls? This cannot be undone.
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button
                        className="ghost-button-sm"
                        onClick={() => { onDeleteSlot(s.id); setConfirmingDelete(null); }}
                        style={{ color: '#8b1a1a', borderColor: '#8b1a1a' }}
                      >
                        Yes, strike it out
                      </button>
                      <button className="ghost-button-sm" onClick={() => setConfirmingDelete(null)}>
                        Keep
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}


      {/* CHARTERS ON OTHER DEVICES (under the same factor key) */}
      {hasRemoteOnly && (
        <div style={{ marginTop: '1.5rem', textAlign: 'left' }}>
          <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.1em', marginBottom: '0.5rem', textAlign: 'center' }}>
            ⁂ ALSO UNDER YR. KEY (NOT YET ON THIS DEVICE)
          </div>
          {remoteOnlyCharters.map(c => {
            const totalDays = (c.day || 0) + (c.daysRemaining || 0);
            const isHydrating = hydrating === c.id;
            const fmtSavedAt = (s) => {
              if (!s) return '';
              try {
                const t = Date.parse(s);
                if (!Number.isFinite(t)) return '';
                const ms = Date.now() - t;
                const m = Math.floor(ms / 60000);
                const h = Math.floor(m / 60);
                const d = Math.floor(h / 24);
                if (d > 0) return `cloud-saved ${d}d ago`;
                if (h > 0) return `cloud-saved ${h}h ago`;
                if (m > 0) return `cloud-saved ${m}m ago`;
                return 'cloud-saved just now';
              } catch (e) { return ''; }
            };
            return (
              <div key={c.id} className="parchment" style={{
                padding: '0.8rem 1rem', marginBottom: '0.5rem',
                background: 'rgba(255,253,245,0.4)',
                borderLeft: '2px solid rgba(92,26,8,0.4)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '12rem' }}>
                    <div style={{ fontStyle: 'italic', color: '#4a3220' }}>
                      {c.factorName || 'Unnamed Factor'}, Factor at {c.location || 'Bayan-Kor'}
                    </div>
                    <div style={{ fontSize: '0.82em', color: '#6b4423', letterSpacing: '0.04em' }}>
                      {c.charterClosed
                        ? <>Charter closed{c.charterClosed.outcome ? ` — ${c.charterClosed.outcome}` : ''} &middot; {fmtSavedAt(c.savedAt)}</>
                        : <>Day {c.day || 0}{totalDays ? ` of ${totalDays}` : ''} &middot; {fmtSavedAt(c.savedAt)}</>}
                    </div>
                  </div>
                  <button
                    className="wax-button"
                    disabled={isHydrating}
                    onClick={() => handleResumeRemote(c.id)}
                    style={{ padding: '0.35rem 0.7rem', fontSize: '0.88em' }}
                  >
                    {isHydrating ? 'Pulling…' : '⁂ Pull to this device'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {remoteLoading && !hasRemoteOnly && (
        <div style={{ marginTop: '1rem', fontSize: '0.85em', color: '#6b4423', fontStyle: 'italic' }}>
          Checking for charters elsewhere under yr. key…
        </div>
      )}

      {/* NEW CHARTER */}
      <div style={{ marginTop: '1.5rem' }}>
        <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.5rem' }}>
          {hasSaves ? 'BEGIN A NEW CHARTER' : 'INSCRIBE THY NAME'}
        </div>
        <div>
          <input
            className="parchment-input text-center"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            aria-label="Factor's name"
            style={{ width: '18rem', maxWidth: '100%' }}
          />
        </div>
        <div style={{ marginTop: '1rem' }}>
          <button className={hasSaves ? 'ghost-button' : 'wax-button'} onClick={handleNewGame}>
            {hasSaves ? 'Begin a New Charter' : 'Open the Charter'}
          </button>
        </div>
      </div>

      {/* RESTORE */}
      <div style={{ marginTop: '2rem' }}>
        {!showRestore ? (
          <button
            onClick={() => setShowRestore(true)}
            style={{ background: 'none', border: 'none', color: '#6b4423', fontStyle: 'italic', fontSize: '0.9em', cursor: 'pointer' }}
          >
            &mdash; or restore from a manuscript &mdash;
          </button>
        ) : (
          <div className="parchment" style={{ padding: '1rem', background: 'rgba(255,255,255,0.25)', textAlign: 'left' }}>
            <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.5rem' }}>RESTORE FROM MANUSCRIPT</div>
            <p style={{ fontSize: '0.85em', color: '#4a3220', fontStyle: 'italic', marginBottom: '0.5rem' }}>
              Paste a previously downloaded manuscript JSON to resume from that point.
            </p>
            <textarea
              value={restoreText}
              onChange={(e) => setRestoreText(e.target.value)}
              placeholder="Paste the manuscript JSON here..."
              aria-label="Manuscript JSON"
              style={{
                width: '100%', minHeight: '6rem', padding: '0.5rem',
                fontFamily: 'monospace', fontSize: '0.75em',
                background: 'rgba(255,255,255,0.4)',
                border: '1px solid rgba(74,44,20,0.3)',
                color: '#2a1a0a',
              }}
            />
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
              <button className="wax-button" onClick={handleRestore}>Restore</button>
              <button className="ghost-button" onClick={() => { setShowRestore(false); setRestoreText(''); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {flash && (
        <div className="ink-fade-in" style={{ marginTop: '1rem', padding: '0.5rem 0.8rem', background: 'rgba(92,26,8,0.08)', borderLeft: '2px solid #5c1a08', fontSize: '0.9em', color: '#5c1a08', textAlign: 'left', display: 'inline-block' }}>
          {flash}
        </div>
      )}
    </div>
  );
}

// ─────────── OPENING SEQUENCE ───────────

function OpeningSequence({ name, onComplete }) {
  const [step, setStep] = useState(0);

  const screens = [
    {
      heading: 'A Sealed Packet',
      body: `Three months at sea. The packet was put into your hand at the dockside in Portsmouth, and you have read it nine times. The seal is broken now, the wax flaking onto your sleeve.

      You are appointed Factor of the Bayan-Kor station, in the gift of the Court of Directors. Your stipend is forty pounds per annum and a tenth of net returns. Your charter is to ship not less than four hundredweight of pepper and two hundredweight of cinnamon to London by the third year, or be recalled in disgrace.

      The man who held the post before you was named Wilbraham. He died of a fever in the wet season. There was no inquest.`
    },
    {
      heading: 'Landfall',
      body: `The pilot brings the pinnace through the bar at first light. Bayan-Kor reveals itself slowly through the haze: a thatched godown roofed in palm, a dock of half-rotted boards, a cluster of native huts, and on the green hill above, the white walls of the Rajah's palace.

      Two men stand on the dock. One is a thin Englishman in a stained waistcoat, swaying gently. The other is a tall Sepoy in a faded red coat, very still, with a musket across his back.

      "Mr. ${name}, sir?" the Englishman calls. "Welcome to the bottom of the world."`
    },
    {
      heading: 'The Inventory',
      body: `Mr. Hodge is the clerk. His teeth are bad and his English is worse than it was, he says, on account of the climate. Sergeant Dass is the entire garrison. There were four sepoys when Wilbraham arrived. Two have died and one has gone inland to take a wife.

      The godown contains: eight sacks of rice, five barrels of rum, a quantity of mildewed calico no longer fit for trade, three sea-chests of ledgers in three different hands, and a strongbox holding five hundred pounds sterling — your operating capital. Wilbraham's papers are tied with twine and stacked against the wall. You will need to read them. Not today.

      Outside, the heat is something you have never imagined.`
    },
    {
      heading: 'The Charter Begins',
      body: `You are alone, two oceans from anyone who knows your name. The Company expects returns. The Rajah expects courtesy. The Brotherhood, you are told, is in the strait. The Dutch sit at Port St. Eustace and watch.

      Begin, then. There is no one else.`
    },
  ];

  const screen = screens[step];
  const last = step === screens.length - 1;

  return (
    <div className="ink-fade-in" style={{ maxWidth: '48rem', margin: '0 auto', padding: '3.0rem 2.0rem', width: '100%' }} key={step}>
      <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.2em', textAlign: 'center', marginBottom: '0.5rem' }}>
        CHAPTER THE FIRST · {step + 1} OF {screens.length}
      </div>
      <h2 className="display" style={{ fontSize: '2.2em', textAlign: 'center', color: '#5c1a08', marginBottom: '1.5rem' }}>
        {screen.heading}
      </h2>
      <Fleuron />
      <div className="drop-cap" style={{ fontSize: '1.1em', whiteSpace: 'pre-line' }}>
        {screen.body}
      </div>
      <Fleuron char="❧" />
      <div className="text-center" style={{ marginTop: '2rem' }}>
        <button className="wax-button" onClick={() => last ? onComplete() : setStep(step + 1)}>
          {last ? 'Take Up the Quill' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

// ─────────── GAME HUB ───────────

// Counsel toggle — a device-local UI preference (NOT in gs), like the view
// override. Default ON; the strategic-counsel line on the Journal hub can be
// switched off from the ☰ Menu by players who'd rather not be advised.
const COUNSEL_PREF_KEY = 'factor_counsel';
function readCounselPref() {
  try { return localStorage.getItem(COUNSEL_PREF_KEY) !== 'off'; } catch { return true; }
}
function writeCounselPref(on) {
  try { localStorage.setItem(COUNSEL_PREF_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}

function GameHub({ gs, setGs, lastSavedAt, onReturnToTitle, onSuccession, onRenewal, viewportMode, sync }) {
  const [tab, setTab] = useState('journal');
  const [showCounsel, setShowCounsel] = useState(readCounselPref);
  const toggleCounsel = () => setShowCounsel(prev => { const next = !prev; writeCounselPref(next); return next; });
  const [encounter, setEncounter] = useState(null);
  const [pending, _setPending] = useState(false);
  const pendingStartRef = useRef(0);
  // Wrap setPending so loading screens always stay visible for at least 800ms.
  // Otherwise fast API responses make vignettes flash too briefly to register.
  const setPending = (val) => {
    if (val) {
      pendingStartRef.current = Date.now();
      _setPending(true);
    } else {
      const elapsed = Date.now() - pendingStartRef.current;
      const wait = Math.max(0, 800 - elapsed);
      if (wait > 0) {
        setTimeout(() => _setPending(false), wait);
      } else {
        _setPending(false);
      }
    }
  };
  const [pendingMsg, setPendingMsg] = useState('');
  const [outcome, setOutcome] = useState(null);
  const [arrivalProse, setArrivalProse] = useState(null);
  const [awayDigest, setAwayDigest] = useState(null);
  const [openLetterId, setOpenLetterId] = useState(null);
  const [scriptedArrival, setScriptedArrival] = useState(null); // { encounter, port }
  const [galleryOpen, setGalleryOpen] = useState(false);

  // Recorder for the per-charter image gallery. Stable identity so it
  // doesn't churn the IllustrationRecorderContext consumers' effects.
  // Reads `setGs` lazily via the closure so the latest reducer always wins.
  const recordIllustration = React.useCallback((prose) => {
    setGs(prev => recordIllustrationInGs(prev, prose));
  }, [setGs]);

  // Wealth milestones: when the strongbox first crosses a threshold, drop a
  // turning-point reflection in the Factor's journal. Guarded by the flag the
  // entry sets, so the effect fires once per threshold and can't loop. Keyed
  // on money — but the flag guard means a re-run with the same money no-ops.
  useEffect(() => {
    if (!gs) return;
    const pending = pendingWealthMilestones(gs.money, gs.flags);
    if (pending.length === 0) return;
    setGs(prev => {
      const stillPending = pendingWealthMilestones(prev.money, prev.flags);
      if (stillPending.length === 0) return prev;
      const flags = { ...prev.flags };
      const journal = [...prev.journal];
      for (const m of stillPending) {
        flags[m.flag] = true;
        journal.push({ day: prev.day, entry: m.entry, milestone: true });
      }
      return { ...prev, flags, journal };
    });
  }, [gs?.money]);

  // Route the player straight into the unread Director letter so they cannot
  // miss it — at the opening AND on succession/renewal, which reset
  // firstLetterPresented to false to present the new appointment letter (the
  // payoff of "you continue"). Keyed on the flag, not mount, so it re-fires
  // for the successor's letter even though GameHub never unmounts.
  useEffect(() => {
    if (!gs.firstLetterPresented && gs.letters.length > 0) {
      const firstUnread = gs.letters.find(l => !l.read);
      if (firstUnread) {
        setTab('letters');
        setOpenLetterId(firstUnread.id);
        setGs(prev => ({ ...prev, firstLetterPresented: true }));
      }
    }
  }, [gs?.firstLetterPresented]);

  // The charter's close is the game's climax — route the player straight to
  // the Court's final letter the moment the hub is clear, so the 3-year arc
  // never ends as a silent HUD flip. Waits out any homecoming digest /
  // encounter screen first; `presented` lives inside charterClosed so it's
  // naturally per-charter (a successor's eventual close presents afresh).
  useEffect(() => {
    if (!gs?.charterClosed || gs.charterClosed.presented) return;
    if (awayDigest || scriptedArrival || encounter || outcome || pending) return;
    const id = gs.charterClosed.letterId;
    const letter = id ? gs.letters.find(l => l.id === id) : null;
    if (!letter) return;
    setTab('letters');
    setOpenLetterId(letter.id);
    setGs(prev => ({ ...prev, charterClosed: { ...prev.charterClosed, presented: true } }));
  }, [gs?.charterClosed, awayDigest, scriptedArrival, encounter, outcome, pending]);

  // Indiaman letters are emitted with a deterministic body and an aiUpgrade
  // marker. Drain the queue one at a time, replacing the body with AI prose
  // seeded by the actual return. The deterministic text remains as fallback
  // if the API call fails. A ref guards against concurrent upgrades.
  const upgradingLetterRef = useRef(false);
  useEffect(() => {
    if (upgradingLetterRef.current) return;
    const target = (gs.letters || []).find(l => l.aiUpgrade && !l.aiUpgraded);
    if (!target) return;
    upgradingLetterRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const result = await genIndiamanLetterPayload(gs, target.aiUpgrade);
        if (cancelled) return;
        if (!result) {
          // Mark attempted so we don't retry indefinitely on persistent failure.
          setGs(prev => ({
            ...prev,
            letters: prev.letters.map(l => l.id === target.id ? { ...l, aiUpgrade: null, aiUpgraded: true } : l),
          }));
          return;
        }
        setGs(prev => ({
          ...prev,
          letters: prev.letters.map(l => l.id === target.id ? {
            ...l,
            subject: result.subject || l.subject,
            body: result.body,
            aiUpgrade: null,
            aiUpgraded: true,
          } : l),
          aiLog: result.log ? pushAiLog(prev.aiLog, result.log) : prev.aiLog,
        }));
      } finally {
        upgradingLetterRef.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [gs.letters]);

  // Auto-letters: tickDays queues a request, this effect drains it. On
  // success, push the finished letter into the inbox; on failure, drop
  // the request silently. The schedule (gs.lettersAuto.nextDay) advances
  // in tickDays whether or not the API call succeeds, so a quiet stretch
  // simply means a quiet inbox.
  const generatingLetterRef = useRef(false);
  useEffect(() => {
    if (generatingLetterRef.current) return;
    const next = (gs.pendingLetterRequests || [])[0];
    if (!next) return;
    generatingLetterRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const sender = AUTO_SENDERS.find(s => s.key === next.senderKey) || {
          key: next.senderKey, from: next.from, mood: next.mood, faction: null,
        };
        const { result, log } = await genLetter(gs, sender);
        if (cancelled) return;
        if (!result || !result.body) {
          setGs(prev => ({
            ...prev,
            pendingLetterRequests: (prev.pendingLetterRequests || []).filter(r => r.seedId !== next.seedId),
          }));
          return;
        }
        const letter = {
          id: next.seedId,
          from: result.from || next.from,
          subject: result.subject || 'A letter received',
          body: result.body,
          responses: Array.isArray(result.responses) && result.responses.length ? result.responses : [
            { label: 'Reply with cautious interest', seed: 'opens dialogue' },
            { label: 'Reply with formal refusal', seed: 'closes door politely' },
            { label: 'Set aside, do not reply', seed: 'silence' },
          ],
          read: false,
        };
        setGs(prev => ({
          ...prev,
          letters: [...prev.letters, letter],
          lettersGenerated: (prev.lettersGenerated || 0) + 1,
          pendingLetterRequests: (prev.pendingLetterRequests || []).filter(r => r.seedId !== next.seedId),
          aiLog: log ? pushAiLog(prev.aiLog, log) : prev.aiLog,
        }));
      } finally {
        generatingLetterRef.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [gs.pendingLetterRequests]);

  // Open a specific letter from anywhere (e.g. the Journal "Read" card).
  const openLetterById = (id) => {
    setTab('letters');
    setOpenLetterId(id);
  };

  // Apply non-time changes (money, reputation, goods, journal, hook,
  // shipDamage, newAcquaintances, flags) to a state object. Returns a new
  // state. Does NOT advance time — voyage time is handled separately via
  // tickDays.
  const applyOutcomeChangesPure = (state, changes, opts = {}) => {
    const next = { ...state };
    if (changes.money) next.money = Math.max(0, next.money + changes.money);
    if (changes.reputation) {
      next.reputation = { ...next.reputation };
      for (const [k, v] of Object.entries(changes.reputation)) {
        if (next.reputation[k] !== undefined && v) {
          next.reputation[k] = Math.max(-100, Math.min(100, next.reputation[k] + v));
        }
      }
    }
    if (changes.goods) {
      next.goods = { ...next.goods };
      for (const [k, v] of Object.entries(changes.goods)) {
        if (COMMODITIES[k] && v) {
          next.goods[k] = Math.max(0, (next.goods[k] || 0) + v);
        }
      }
    }
    if (changes.journal) {
      next.journal = [...next.journal, { day: next.day, entry: changes.journal }];
    }
    if (changes.hook) {
      next.hooks = [...next.hooks, changes.hook];
    }
    // Close an open thread by exact text — the letter-outcome counterpart to
    // the pursue/voyage closeHook path (those bind to a pursued thread; a
    // scripted letter knows the literal string it planted). Accepts a string
    // or an array of strings.
    if (changes.closeHookText) {
      const toClose = Array.isArray(changes.closeHookText) ? changes.closeHookText : [changes.closeHookText];
      next.hooks = (next.hooks || []).filter(h => !toClose.includes(h));
    }
    // Ship damage — never apply to letter outcomes, no matter what the model returned.
    if (changes.shipDamage && !opts.isLetter && next.ship) {
      const sd = changes.shipDamage;
      const hullHit  = Math.max(0, Math.min(40, Number(sd.hull)  || 0));
      const sailsHit = Math.max(0, Math.min(40, Number(sd.sails) || 0));
      next.ship = {
        ...next.ship,
        hull:  Math.max(0, next.ship.hull  - hullHit),
        sails: Math.max(0, next.ship.sails - sailsHit),
      };
      // Bottomry forgiveness: a voyage calamity (≥25 hull or sails damage)
      // cancels the bond. The cargo and ship were the security; the lender
      // takes the loss. Journal the forgiveness so the player sees it.
      if (next.bottomry && (hullHit >= 25 || sailsHit >= 25)) {
        const forgiven = next.bottomry.repayment;
        next.bottomry = null;
        next.journal = [...next.journal, { day: next.day, entry: `The bottomry bond stands forfeit. The voyage calamity cancels £${forgiven} owed to the bazaar.` }];
      }
    }
    // New named characters introduced by the AI; persist into world state.
    if (Array.isArray(changes.newAcquaintances) && changes.newAcquaintances.length) {
      let acq = next.acquaintances || [];
      for (const npc of changes.newAcquaintances) {
        acq = upsertAcquaintance(acq, next.day, npc);
      }
      next.acquaintances = acq;
    }
    // Narrative flags — merge in.
    if (changes.flags && typeof changes.flags === 'object') {
      next.flags = { ...(next.flags || {}), ...changes.flags };
    }
    // Establish a venture from a letter outcome (e.g. the Bristol concern via
    // the sister's matter). The money cost is handled by changes.money on the
    // same choice; this just marks it established so it begins remitting.
    if (changes.establishVenture && VENTURES[changes.establishVenture] && !next.ventures?.[changes.establishVenture]?.established) {
      next.ventures = { ...(next.ventures || {}), [changes.establishVenture]: { established: true, establishedDay: next.day, lastPaidDay: next.day } };
    }
    // Rivalry deltas — sabotage arcs (and any future caller) can patch
    // per-rival fields and append pressure modifiers via the change payload.
    // changes.rivals: { hardacre: { state: 'broken', standing: -10 } }
    //   - 'state' is a string assignment (e.g. 'broken' | 'troubled').
    //   - 'standing' / 'pepper' / 'cinnamon' are deltas.
    if (changes.rivals && typeof changes.rivals === 'object') {
      const nextRivals = { ...(next.rivals || {}) };
      for (const [rk, patch] of Object.entries(changes.rivals)) {
        if (!nextRivals[rk] || !patch) continue;
        const r = { ...nextRivals[rk] };
        if (typeof patch.state === 'string') r.state = patch.state;
        if (typeof patch.standing === 'number') {
          r.standing = Math.max(0, Math.min(100, (r.standing ?? 50) + patch.standing));
        }
        if (typeof patch.pepper === 'number')   r.pepper   = Math.max(0, (r.pepper   ?? 0) + patch.pepper);
        if (typeof patch.cinnamon === 'number') r.cinnamon = Math.max(0, (r.cinnamon ?? 0) + patch.cinnamon);
        nextRivals[rk] = r;
      }
      next.rivals = nextRivals;
    }
    // Pressure modifier append. Single object or array.
    if (changes.rivalPressureModifierPush) {
      const pushList = Array.isArray(changes.rivalPressureModifierPush)
        ? changes.rivalPressureModifierPush
        : [changes.rivalPressureModifierPush];
      next.rivalPressureModifiers = [...(next.rivalPressureModifiers || []), ...pushList];
    }
    // Sabotage commit counter — numeric delta.
    if (typeof changes.sabotagesCommitted === 'number' && changes.sabotagesCommitted) {
      next.sabotagesCommitted = (next.sabotagesCommitted || 0) + changes.sabotagesCommitted;
    }
    return next;
  };

  // Whenever days pass (sailing), check on arriving home if there's an away digest to show.
  const arriveAt = async (newGs, dest) => {
    const returningHome = dest === 'Bayan-Kor';
    const hasEvents = newGs.awayLog.length > 0;

    // Bottomry: on return to Bayan-Kor with an outstanding bond, the bazaar
    // collects. Deduct repayment from money; if short, the strongbox empties
    // and the rest sits as bad debt (a hook the AI may pull on later).
    if (returningHome && newGs.bottomry) {
      const due = newGs.bottomry.repayment;
      const have = newGs.money || 0;
      const paid = Math.min(due, have);
      const short = due - paid;
      newGs = {
        ...newGs,
        money: have - paid,
        bottomry: null,
        journal: [
          ...newGs.journal,
          short > 0
            ? { day: newGs.day, entry: `Mehmet Pasha called for the bottomry — £${due} due, £${paid} paid. £${short} stands against yr. name in the bazaar's books.` }
            : { day: newGs.day, entry: `Mehmet Pasha called for the bottomry — £${due} paid in full. The bond is discharged.` },
        ],
      };
      if (short > 0) {
        newGs = {
          ...newGs,
          hooks: [...newGs.hooks, `An unpaid bottomry of £${short} stands against the household at the bazaar.`],
        };
      }
    }

    if (returningHome && hasEvents) {
      setPending(true);
      setPendingMsg('Surveying what passed in your absence');
      const { result: digestProse, log } = await genAwayDigest(newGs, newGs.awayLog);
      setPending(false);
      // The most recent raid (if any) is surfaced as an interactive choice
      // in the digest screen — what does the Factor do about it?
      const raids = newGs.awayLog.filter(e => e.type === 'raid');
      const unresolvedRaid = raids.length > 0 ? raids[raids.length - 1] : null;
      setAwayDigest({ log: newGs.awayLog, prose: digestProse, unresolvedRaid });
      // Clear the awayLog now that it's shown; persist the AI exchange.
      setGs({
        ...newGs,
        awayLog: [],
        aiLog: log ? pushAiLog(newGs.aiLog, log) : newGs.aiLog,
      });
    } else {
      setGs(newGs);
      // First-visit arrivals get a generated vignette to set the place. Revisits
      // skip the AI call — the port is familiar; no need to pay for flavor.
      const firstVisit = !gs.visited?.includes(dest);
      if (firstVisit) {
        setPending(true);
        setPendingMsg('Coming into port');
        const { result: prose, log } = await genArrivalVignette(newGs, dest);
        setPending(false);
        setArrivalProse({ port: dest, prose });
        if (log) {
          setGs(prev => ({ ...prev, aiLog: pushAiLog(prev.aiLog, log) }));
        }
      } else {
        // Revisits: no vignette, but we MUST clear the pending state set
        // during sailTo's "voyage uneventful" message — otherwise the
        // loading screen sticks forever and the player has to restart.
        setArrivalProse(null);
        setPending(false);
      }
      // After the standard arrival surface, check for any scripted encounter
      // whose triggers match. Curated payoffs for hooks the player has
      // earned (e.g. the Dutch packet, plot threads from earlier choices).
      const scripted = pickArrivalEncounter(newGs, dest);
      if (scripted) {
        setScriptedArrival({ encounter: scripted, port: dest });
      }
      setTab(returningHome ? 'journal' : 'port');
    }
  };

  // Resolve a scripted-arrival choice: apply its deterministic changes,
  // surface the outcome prose, and clear the scriptedArrival state.
  const handleScriptedChoice = (choice) => {
    setGs(prev => applyOutcomeChangesPure(prev, choice.changes || {}));
    setScriptedArrival(s => s ? ({ ...s, resolvedChoice: choice }) : s);
  };

  const dismissScriptedArrival = () => {
    setScriptedArrival(null);
  };

  const sailTo = async (portKey) => {
    const port = PORTS[portKey];
    // Master refuses to put to sea if the ship is too far gone.
    if ((gs.ship?.hull ?? 100) < MIN_HULL_COND || (gs.ship?.sails ?? 100) < MIN_SAIL_COND) {
      return;
    }
    setPending(true);
    setPendingMsg('Stowing the cargo, hoisting sail');
    // The Brotherhood compact halves the chance of a voyage encounter — a
    // real mechanical effect of the flag. The Brotherhood's word is
    // approximate, not absolute, so encounters still happen sometimes.
    const encChance = gs.flags?.brotherhoodCompact ? 0.4 : 0.6;
    const haveEncounter = Math.random() < encChance;

    if (haveEncounter) {
      const { result: enc, log } = await genVoyageEncounter(gs, gs.location, portKey);
      setPending(false);
      if (log) setGs(prev => ({ ...prev, aiLog: pushAiLog(prev.aiLog, log) }));
      setEncounter({ ...enc, type: 'voyage', destination: portKey });
      // Remember the last few encounters (by prose) so the fallback picker
      // doesn't repeat them — keeps the most frequent interaction feeling varied.
      if (enc?.prose) setGs(prev => ({ ...prev, recentEncounters: [...(prev.recentEncounters || []), enc.prose].slice(-4) }));
    } else {
      const baseDays = voyageDays(gs, port);
      setPendingMsg('The voyage is uneventful');
      await new Promise(r => setTimeout(r, 600));

      let newGs = tickDays(gs, baseDays);
      newGs = {
        ...newGs,
        ship: applyVoyageWear(newGs.ship, baseDays),
        location: portKey,
        visited: newGs.visited.includes(portKey) ? newGs.visited : [...newGs.visited, portKey],
        journal: [...newGs.journal, { day: newGs.day, entry: `Made landfall at ${portKey} after ${baseDays} day${baseDays === 1 ? '' : 's'} at sea, without incident worthy of record.` }],
      };

      await arriveAt(newGs, portKey);
    }
  };

  const handleEncounterChoice = async (choice) => {
    // Authored pursue lead — the choice carries its own hand-written outcome.
    // Apply it directly: no AI, no generic buckets, no slot-machine. This is
    // the "leads pay off" path.
    if (choice.fixedOutcome) {
      setOutcome({ prose: choice.fixedOutcome.prose, changes: { ...choice.fixedOutcome.changes }, encounter });
      return;
    }
    setPending(true);
    setPendingMsg('The hour passes');
    // Build the closure-mode opts. Pursue outcomes always close the
    // pursued thread on closeHook=true. Voyage outcomes only allow
    // closure when genVoyageEncounter signalled an engagedThread (and
    // it exact-matches an existing open hook — verified at apply time).
    let opts = {};
    if (encounter?.type === 'pursue') {
      // Pass the pursued thread so the outcome prose can name and resolve THAT
      // matter rather than fall to a contextless bucket line.
      opts = { isPursue: true, engagedThread: encounter.thread };
    } else if (encounter?.type === 'voyage' && encounter.engagedThread) {
      opts = { engagedThread: encounter.engagedThread };
    }
    const { result, log } = await genOutcome(gs, encounter.prose, choice, opts);
    setPending(false);
    if (log) setGs(prev => ({ ...prev, aiLog: pushAiLog(prev.aiLog, log) }));
    setOutcome({ ...result, encounter });
  };

  // Pursue a specific open thread — a hook line, a named acquaintance, or
  // a flag the player wants to act upon. Generates a scene seeded with the
  // chosen thread; the player's choice is then resolved through the same
  // outcome flow as a voyage encounter. Treated as a "pursue" encounter
  // so the outcome's days delta (1-2) ticks the world forward.
  const handlePursueThread = async (thread) => {
    // Authored opportunity — present the hand-written scene directly (no AI,
    // no generic gamble). Its choices carry their own fixedOutcome.
    const lead = findPursueLead(thread);
    if (lead) {
      setEncounter({ type: 'pursue', thread, prose: lead.scene, choices: lead.choices, authored: true });
      return;
    }
    setPending(true);
    setPendingMsg(`Pursuing ${thread.slice(0, 40)}${thread.length > 40 ? '…' : ''}`);
    const { result: enc, log } = await genPursueThread(gs, thread);
    setPending(false);
    if (log) setGs(prev => ({ ...prev, aiLog: pushAiLog(prev.aiLog, log) }));
    setEncounter({ ...enc, type: 'pursue', thread });
  };

  const concludeOutcome = async () => {
    if (encounter.type === 'voyage') {
      const dest = encounter.destination;
      const port = PORTS[dest];
      const baseDays = voyageDays(gs, port);
      const totalDays = baseDays + (outcome.changes.days || 0);

      // Apply outcome changes (no time) — schema supports shipDamage at sea.
      let newGs = applyOutcomeChangesPure(gs, outcome.changes);
      // Tick the voyage days (advances day, runs home sim)
      newGs = tickDays(newGs, totalDays);
      // Voyage hook closure: if the encounter step identified an engagedThread
      // and the outcome step set closeHook, remove that thread from the open
      // list. Exact-match against gs.hooks — a paraphrase or stale value just
      // no-ops harmlessly. Symmetric with the pursue branch below; without
      // this, only "Pursue this matter" actions could ever close a hook,
      // even when a voyage scene definitively resolved one.
      const engagedThread = encounter?.engagedThread;
      const closingVoyageHook = !!(engagedThread && outcome.changes?.closeHook && newGs.hooks?.includes(engagedThread));
      if (closingVoyageHook) {
        const trimmed = engagedThread.slice(0, 80);
        const ell = engagedThread.length > 80 ? '…' : '';
        newGs = {
          ...newGs,
          hooks: newGs.hooks.filter(h => h !== engagedThread),
          journal: [...newGs.journal, { day: newGs.day, entry: `Settled the matter of ${trimmed}${ell} at sea.` }],
        };
      }
      // Land — apply voyage wear on top of any encounter shipDamage.
      newGs = {
        ...newGs,
        ship: applyVoyageWear(newGs.ship, totalDays),
        location: dest,
        visited: newGs.visited.includes(dest) ? newGs.visited : [...newGs.visited, dest],
        journal: [...newGs.journal, { day: newGs.day, entry: `Made landfall at ${dest} after ${totalDays} day${totalDays === 1 ? '' : 's'} at sea.` }],
      };

      setEncounter(null);
      setOutcome(null);

      await arriveAt(newGs, dest);
    } else if (encounter.type === 'letter') {
      // Letter responses: instant in game time, no ship damage even if model returned it.
      const newGs = applyOutcomeChangesPure(gs, outcome.changes, { isLetter: true });
      setGs(newGs);
      setEncounter(null);
      setOutcome(null);
    } else if (encounter.type === 'pursue') {
      // Pursuing a thread: apply changes, tick the days the AI returned
      // (typically 1-2), and stay at the current location. Ship may take
      // damage if the thread led somewhere violent. Journal records the
      // pursuit explicitly so the player can find it later.
      const days = Math.max(0, Math.min(3, outcome.changes.days || 1));
      let newGs = applyOutcomeChangesPure(gs, outcome.changes);
      newGs = tickDays(newGs, days);
      // Hook closure: when the AI signals the thread is resolved, drop it
      // from the open list. Without this, players are invited back to
      // pursue the same thread forever even after settling it.
      const closing = !!outcome.changes.closeHook;
      const trimmedThread = (encounter.thread || '').slice(0, 80);
      const ellipsis = (encounter.thread || '').length > 80 ? '…' : '';
      newGs = {
        ...newGs,
        hooks: closing ? newGs.hooks.filter(h => h !== encounter.thread) : newGs.hooks,
        journal: [...newGs.journal, { day: newGs.day, entry: closing
          ? `Settled the matter of ${trimmedThread}${ellipsis}`
          : `Pursued the matter of ${trimmedThread}${ellipsis}` }],
      };
      setGs(newGs);
      setEncounter(null);
      setOutcome(null);
    }
  };

  const handleLetterResponse = async (letter, response) => {
    setEncounter({
      type: 'letter',
      prose: `You compose your reply to ${letter.from}: "${response.label}"`,
      choices: [],
      letter,
    });
    // Some letter responses carry a fixedOutcome — deterministic events
    // whose mechanical consequences must not be left to the model. Skip the
    // AI call and apply the prose + changes directly.
    if (response.fixedOutcome) {
      setPending(true);
      setPendingMsg('Sealing the letter');
      // Brief pause so the loading vignette registers; matches the AI path.
      await new Promise(r => setTimeout(r, 400));
      setPending(false);
      setGs(prev => ({
        ...prev,
        letters: prev.letters.map(l => l.id === letter.id ? { ...l, replied: true, replyLabel: response.label } : l),
      }));
      const safeChanges = { ...(response.fixedOutcome.changes || {}), days: 0 };
      setOutcome({
        prose: response.fixedOutcome.prose,
        changes: safeChanges,
        encounter: { type: 'letter' },
      });
      return;
    }
    setPending(true);
    setPendingMsg('Sealing the letter');
    const { result, log } = await genOutcome(gs, `Letter from ${letter.from}: ${letter.body}`, response, { isLetter: true });
    setPending(false);
    setGs(prev => ({
      ...prev,
      letters: prev.letters.map(l => l.id === letter.id ? { ...l, replied: true, replyLabel: response.label } : l),
      aiLog: log ? pushAiLog(prev.aiLog, log) : prev.aiLog,
    }));
    // Letter replies are instant in game time. Strip any days the model invented
    // so the summary and the actual state agree.
    const safeChanges = { ...result.changes, days: 0 };
    setOutcome({ ...result, changes: safeChanges, encounter: { type: 'letter' } });
  };

  // Commission a brigantine at the Bayan-Kor slipway. Pays up front; pinnace
  // remains in service until the new ship is launched, at which point a
  // pre-quoted credit is paid for the pinnace.
  const commissionBrigantine = (proposedName) => {
    if (gs.location !== 'Bayan-Kor') return;
    if (gs.shipCommission) return;
    if (!gs.outpost?.buildings?.shipwright?.built) return;
    if (gs.ship?.type !== 'pinnace') return;
    const ownTeak = gs.flags?.teakConcession === 'self';
    const COST = ownTeak ? 600 : 900;
    const TRADE_IN = 100;
    const DAYS = 60;
    if (gs.money < COST) return;
    const cleanName = (proposedName || 'The Astrolabe').trim() || 'The Astrolabe';
    const name = cleanName.startsWith('The ') ? cleanName : `The ${cleanName}`;
    const teakLine = ownTeak
      ? ` The timber is from yr. own concession inland; the saving on imported plank is conspicuous.`
      : '';
    setGs(prev => ({
      ...prev,
      money: prev.money - COST,
      shipCommission: { type: 'brigantine', name, daysLeft: DAYS, paid: COST, tradeIn: TRADE_IN },
      journal: [...prev.journal, { day: prev.day, entry: `Laid the order with the master shipwright at Bayan-Kor for a teak brigantine, ${name}. £${COST} disbursed; the keel will be laid this week.${teakLine}` }],
    }));
  };

  const startBuild = (key) => {
    const b = BUILDINGS[key];
    if (gs.money < b.cost) return;
    if (gs.outpost.buildings[key]?.built) return;
    if (gs.outpost.queue.some(q => q.key === key)) return;
    if (b.requires?.rep) {
      for (const [f, n] of Object.entries(b.requires.rep)) {
        if (gs.reputation[f] < n) return;
      }
    }
    setGs(prev => ({
      ...prev,
      money: prev.money - b.cost,
      outpost: { ...prev.outpost, queue: [...prev.outpost.queue, { key, daysLeft: b.days }] },
      journal: [...prev.journal, { day: prev.day, entry: `Began construction of ${b.name}. £${b.cost} disbursed from the strongbox.` }],
    }));
  };

  // Establish a venture — a lasting investment in the enterprise. Unlike a
  // building, it's instant (a contract signed, a ship bought, an agent
  // installed); income ventures begin remitting the next quarter, the agent's
  // discount takes effect at once.
  const establishVenture = (id) => {
    const def = VENTURES[id];
    if (!def) return;
    if (gs.ventures?.[id]?.established) return;
    if (gs.money < def.cost) return;
    if (!ventureUnlocked(id, gs.ventures)) return;
    if (gs.charterClosed) return;
    setGs(prev => ({
      ...prev,
      money: prev.money - def.cost,
      ventures: { ...(prev.ventures || {}), [id]: { established: true, establishedDay: prev.day, lastPaidDay: prev.day } },
      journal: [...prev.journal, { day: prev.day, entry: `Established a venture — ${def.name}. £${def.cost} laid out from the strongbox. ${def.establishText}` }],
    }));
  };

  const handleDigestContinue = () => {
    setAwayDigest(null);
    setTab('journal');
  };

  // Resolve a raid surfaced in the away-digest. Calls the AI for prose +
  // changes, applies them instantly (no time advance), and returns the
  // result so the digest screen can render the prose in place of the
  // choice card.
  const handleResolveRaid = async (raid, choice) => {
    const encounterProse = `On returning to Bayan-Kor, the Factor was met with this report: "${raid.text}"`;
    const { result, log } = await genOutcome(gs, encounterProse, choice, {});
    const safeChanges = { ...result.changes, days: 0 };
    setGs(prev => {
      const next = applyOutcomeChangesPure(prev, safeChanges, {});
      return { ...next, aiLog: log ? pushAiLog(next.aiLog, log) : next.aiLog };
    });
    return result;
  };

  // Both trade handlers report whether the trade applied, so PortView can
  // confirm the transaction to the player instead of mutating silently.
  const buyGood = (commodity, qty, price) => {
    const grossCost = qty * price;
    const taxRate = portTaxRate(gs, gs.location);
    const tax = Math.round(grossCost * taxRate);
    const cost = grossCost + tax;
    if (gs.money < cost) return false;
    // Hold cap: total stowage of current goods plus this purchase must fit.
    const w = COMMODITIES[commodity].weight;
    const projected = cargoWeight(gs.goods) + qty * w;
    if (projected > cargoCap(gs)) return false;
    // Port stock: cannot buy more than the wharf has on hand.
    const stockHere = gs.portStocks?.[gs.location] || {};
    const available = Math.floor(stockHere[commodity] ?? Infinity);
    if (qty > available) return false;
    const taxLine = tax > 0 ? `, with £${tax} duty to the Dutch` : '';
    setGs(prev => ({
      ...prev,
      money: prev.money - cost,
      goods: { ...prev.goods, [commodity]: (prev.goods[commodity] || 0) + qty },
      tradeStats: recordTrade(prev.tradeStats, { kind: 'buy', commodity, qty, amount: cost }),
      portStocks: {
        ...prev.portStocks,
        [prev.location]: {
          ...(prev.portStocks?.[prev.location] || {}),
          [commodity]: Math.max(0, (prev.portStocks?.[prev.location]?.[commodity] ?? 0) - qty),
        },
      },
      journal: [...prev.journal, { day: prev.day, entry: `Bought ${qty} ${unitLabel(commodity, qty)} of ${COMMODITIES[commodity].name} at ${gs.location} for £${grossCost}${taxLine}.` }],
    }));
    return true;
  };

  const sellGood = (commodity, qty, price) => {
    if ((gs.goods[commodity] || 0) < qty) return false;
    const grossProceeds = qty * price;
    const taxRate = portTaxRate(gs, gs.location);
    const tax = Math.round(grossProceeds * taxRate);
    const proceeds = grossProceeds - tax;
    const taxLine = tax > 0 ? `, less £${tax} Dutch duty` : '';
    setGs(prev => ({
      ...prev,
      money: prev.money + proceeds,
      goods: { ...prev.goods, [commodity]: prev.goods[commodity] - qty },
      tradeStats: recordTrade(prev.tradeStats, { kind: 'sell', commodity, qty, amount: proceeds }),
      journal: [...prev.journal, { day: prev.day, entry: `Sold ${qty} ${unitLabel(commodity, qty)} of ${COMMODITIES[commodity].name} at ${gs.location} for £${grossProceeds}${taxLine}.` }],
    }));
    return true;
  };

  // Move goods from the ship's hold into the godown at Bayan-Kor.
  // Pepper/cinnamon lodged here count toward the London quota (computed from
  // the warehouse stock at display time, not stored separately).
  // Returns the amount actually moved (0 on a no-op) so the godown panel can
  // confirm the lodging — the culmination of a quota voyage deserves a beat.
  const lodgeGoods = (commodity, qty) => {
    if (gs.location !== 'Bayan-Kor') return 0;
    const have = gs.goods[commodity] || 0;
    if (have < 1) return 0;
    const w = COMMODITIES[commodity].weight || 1;
    const cap = warehouseCap(gs);
    const used = warehouseUsed(gs);
    const room = Math.max(0, cap - used);
    const byRoom = w > 0 ? Math.floor(room / w) : qty;
    const move = Math.max(0, Math.min(qty, have, byRoom));
    if (move <= 0) return 0;
    setGs(prev => ({
      ...prev,
      goods: { ...prev.goods, [commodity]: (prev.goods[commodity] || 0) - move },
      outpost: {
        ...prev.outpost,
        warehouse: {
          ...(prev.outpost.warehouse || {}),
          [commodity]: ((prev.outpost.warehouse || {})[commodity] || 0) + move,
        },
      },
      journal: [...prev.journal, { day: prev.day, entry: `Lodged ${move} ${unitLabel(commodity, move)} of ${COMMODITIES[commodity].name} in the godown.` }],
    }));
    return move;
  };

  // Move goods from the godown back to the ship's hold. Limited by hold cap.
  const withdrawGoods = (commodity, qty) => {
    if (gs.location !== 'Bayan-Kor') return;
    const inGodown = gs.outpost?.warehouse?.[commodity] || 0;
    if (inGodown < 1) return;
    const w = COMMODITIES[commodity].weight || 1;
    const remainingHold = Math.max(0, cargoCap(gs) - cargoWeight(gs.goods));
    const byHold = w > 0 ? Math.floor(remainingHold / w) : qty;
    const move = Math.max(0, Math.min(qty, inGodown, byHold));
    if (move <= 0) return;
    setGs(prev => ({
      ...prev,
      goods: { ...prev.goods, [commodity]: (prev.goods[commodity] || 0) + move },
      outpost: {
        ...prev.outpost,
        warehouse: {
          ...(prev.outpost.warehouse || {}),
          [commodity]: ((prev.outpost.warehouse || {})[commodity] || 0) - move,
        },
      },
      journal: [...prev.journal, { day: prev.day, entry: `Drew ${move} ${unitLabel(commodity, move)} of ${COMMODITIES[commodity].name} from the godown into the hold.` }],
    }));
  };

  const refitShip = async (expedite = false) => {
    const quote = repairQuote(gs, { expedite });
    if (quote.points <= 0) return;
    if (gs.money < quote.cost) return;

    if (quote.days <= 0) {
      // Instant — home or otherwise free of time.
      setGs(prev => ({
        ...prev,
        money: prev.money - quote.cost,
        ship: { ...prev.ship, hull: 100, sails: 100 },
        journal: [...prev.journal, { day: prev.day, entry: `Paid £${quote.cost} to refit the ${prev.ship.name} at the slipway. Hull and sails sound.` }],
      }));
      return;
    }

    setPending(true);
    setPendingMsg(expedite ? 'Caulkers and stitchers driven hard' : 'On the slipway with caulkers and stitchers');
    let next = { ...gs, money: gs.money - quote.cost };
    next = tickDays(next, quote.days);
    next = {
      ...next,
      ship: { ...next.ship, hull: 100, sails: 100 },
      journal: [
        ...next.journal,
        { day: next.day, entry: `Paid £${quote.cost} for ${quote.days} day${quote.days !== 1 ? 's' : ''} on the slipway at ${gs.location}${expedite ? ', the work hurried' : ''}. The ${next.ship.name} is sound again.` },
      ],
    };
    setPending(false);
    setGs(next);
  };

  const expediteBuild = (idx) => {
    const item = gs.outpost.queue[idx];
    if (!item) return;
    const b = BUILDINGS[item.key];
    if (!b) return;
    if (item.daysLeft <= 0) return;
    // Cost is proportional to remaining work, with a 1.5x rush premium.
    const proportion = item.daysLeft / b.days;
    const rushCost = Math.max(5, Math.ceil(proportion * b.cost * 1.5));
    if (gs.money < rushCost) return;
    setGs(prev => ({
      ...prev,
      money: prev.money - rushCost,
      outpost: {
        ...prev.outpost,
        queue: prev.outpost.queue.map((q, i) =>
          i === idx ? { ...q, daysLeft: Math.floor(q.daysLeft / 2) } : q
        ),
      },
      journal: [...prev.journal, { day: prev.day, entry: `Paid £${rushCost} extra to hurry the ${b.name}. The work goes faster, the men go later to their suppers.` }],
    }));
  };

  // ─────── PRIVATE CONSIGNMENT HANDLERS ───────

  const handleConsignmentConfirm = (commodities) => {
    setGs(prev => {
      const ware = { ...(prev.outpost?.warehouse || {}) };
      let total = 0;
      for (const [k, qty] of Object.entries(commodities)) {
        const move = Math.floor(qty || 0);
        if (move <= 0) continue;
        ware[k] = Math.max(0, (ware[k] || 0) - move);
        total += move;
      }
      const expected = Object.entries(commodities)
        .reduce((a, [k, v]) => a + londonValue(k, Math.floor(v) || 0), 0);
      return {
        ...prev,
        outpost: { ...(prev.outpost || {}), warehouse: ware },
        privateConsignment: {
          commodities: { ...commodities },
          shippedDay: prev.day,
          expectedPayout: expected,
        },
        privateConsignmentOffered: false,
        journal: [
          ...prev.journal,
          { day: prev.day, entry: `Consigned ${total} cwt to London on yr. own account by the Indiaman, valued upon return at ~£${expected}.` },
        ],
      };
    });
  };

  const handleConsignmentDecline = () => {
    setGs(prev => ({ ...prev, privateConsignmentOffered: false }));
  };

  // ─── BOTTOMRY ───
  // Period-accurate leverage. Loan from a moneylender at Bayan-Kor against
  // ship + cargo. Repaid at +25% on next return to Bayan-Kor; forgiven if
  // a voyage encounter inflicts ≥25 hull or sails damage between then and
  // now (the cargo was the security, and the voyage was a calamity).
  const BOTTOMRY_RATE = 0.25;
  const takeBottomry = (principal) => {
    if (gs.location !== 'Bayan-Kor') return;
    if (gs.bottomry) return;
    if (gs.charterClosed) return;
    const p = Math.max(50, Math.floor(principal || 0));
    setGs(prev => ({
      ...prev,
      money: (prev.money || 0) + p,
      bottomry: {
        principal: p,
        repayment: Math.round(p * (1 + BOTTOMRY_RATE)),
        takenDay: prev.day,
        lender: 'Mehmet Pasha, the moneylender at the bazaar',
      },
      journal: [...prev.journal, { day: prev.day, entry: `Took up a bottomry bond of £${p} at the bazaar; £${Math.round(p * (1 + BOTTOMRY_RATE))} due on return to Bayan-Kor, the bond cancelled if the voyage suffers a calamity.` }],
    }));
  };

  // ─── PALE MAN'S CONTRACT — DELIVERY MECHANIC ───
  // Lift opium at the Pelican's Nest under Said bin Mahmood's name.
  // Drop at Port St. Eustace: customs check, branched by trade pass and
  // Dutch standing. Success pays the second half of the contract;
  // capture voids the contract and crashes Dutch standing.
  const liftContractOpium = () => {
    if (gs.location !== 'The Pelican’s Nest') return;
    if (gs.charterClosed) return;
    const stage = gs.flags?.paleManQuest;
    if (stage !== 'closed-contracted' && stage !== 'closed-half-contract') return;
    if (gs.flags?.contractOpiumLifted) return;
    const cwt = stage === 'closed-half-contract' ? 2 : 4;
    // Hold space check — must fit. Caller's UI also disables the button
    // when this fails, but defensive double-check.
    const w = COMMODITIES.opium.weight || 0.6;
    const remaining = Math.max(0, cargoCap(gs) - cargoWeight(gs.goods));
    if (remaining < cwt * w) return;
    setGs(prev => ({
      ...prev,
      goods: { ...prev.goods, opium: (prev.goods.opium || 0) + cwt },
      flags: { ...(prev.flags || {}), contractOpiumLifted: cwt },
      journal: [...prev.journal, { day: prev.day, entry: `Lifted ${cwt} cwt of opium under Said bin Mahmood's name at the Pelican's Nest. The drop at Eustace remains.` }],
    }));
  };

  const runDutchCustoms = () => {
    if (gs.location !== 'Port St. Eustace') return;
    if (gs.charterClosed) return;
    const lifted = gs.flags?.contractOpiumLifted;
    if (!lifted) return;
    if (gs.flags?.paleManQuest !== 'closed-contracted' && gs.flags?.paleManQuest !== 'closed-half-contract') return;
    // Validate the player still has the opium cargo. If they sold it
    // elsewhere first, the contract is void and the lifted flag clears.
    const opiumOnHand = Math.floor(gs.goods?.opium || 0);
    if (opiumOnHand < lifted) {
      setGs(prev => {
        const flags = { ...(prev.flags || {}) };
        delete flags.contractOpiumLifted;
        flags.paleManQuest = 'closed-cargo-lost';
        return {
          ...prev,
          flags,
          journal: [...prev.journal, { day: prev.day, entry: `The pale man's contract is void. The opium is no longer in yr. hold; there is nothing to drop.` }],
          hooks: [...prev.hooks, 'The pale man\'s contract is void; the cargo was not delivered. He is not the kind of man who explains his disappointment in writing.'],
        };
      });
      return;
    }
    const isHalf = gs.flags.paleManQuest === 'closed-half-contract';
    // Catch chance: 30% base; trade pass cuts to 5%; Dutch standing >= +20 trims further.
    let catchChance = 0.30;
    if (gs.flags?.dutchTradePass) catchChance = 0.05;
    if ((gs.reputation?.dutch || 0) >= 20) catchChance = Math.max(0.02, catchChance - 0.10);
    const caught = Math.random() < catchChance;
    setGs(prev => {
      const next = { ...prev };
      // Cargo leaves the hold either way.
      next.goods = { ...next.goods, opium: Math.max(0, (next.goods.opium || 0) - lifted) };
      const flags = { ...(next.flags || {}) };
      delete flags.contractOpiumLifted;
      if (caught) {
        // Dutch customs find the cargo. Heavy standing penalty + cargo
        // confiscated; advance kept but final payment void.
        next.reputation = { ...(next.reputation || {}), dutch: Math.max(-100, (next.reputation?.dutch || 0) - 30) };
        flags.paleManQuest = 'closed-caught';
        next.flags = flags;
        next.journal = [...next.journal, { day: next.day, entry: `Caught at the Eustace customs with ${lifted} cwt of unmanifested opium. The cargo is confiscated; Dutch standing collapses by 30. The contract is void.` }];
        next.hooks = [...next.hooks, 'The Hollanders know yr. face at Eustace now. The trade pass, if held, did not hold here.'];
      } else {
        // Cargo cleared. Final payment lands by the trusted hand.
        const payout = isHalf ? 200 : 400;
        next.money = (next.money || 0) + payout;
        next.reputation = { ...(next.reputation || {}), pirates: Math.min(100, (next.reputation?.pirates || 0) + 5) };
        flags.paleManQuest = isHalf ? 'closed-delivered-half' : 'closed-delivered';
        next.flags = flags;
        next.journal = [...next.journal, { day: next.day, entry: `Cleared the Eustace customs with ${lifted} cwt of opium under cover; £${payout} delivered to yr. hand by a trusted runner. The contract is fulfilled.` }];
      }
      return next;
    });
  };

  // ─────── RENDER ───────

  // Away-digest first — narrative news, including the Indiaman's call, is
  // delivered before the player decides on a private consignment.
  if (awayDigest) {
    return <AwayDigestScreen digest={awayDigest} onContinue={handleDigestContinue} onResolveRaid={handleResolveRaid} />;
  }

  // Then any pending private-consignment offer. Modal until consigned or
  // declined.
  if (gs.privateConsignmentOffered && !gs.charterClosed) {
    return (
      <Page>
        <ConsignmentModal
          gs={gs}
          onConfirm={handleConsignmentConfirm}
          onDecline={handleConsignmentDecline}
        />
      </Page>
    );
  }

  if (scriptedArrival) {
    return (
      <ScriptedArrivalScreen
        scene={scriptedArrival.encounter}
        port={scriptedArrival.port}
        resolvedChoice={scriptedArrival.resolvedChoice}
        onChoose={handleScriptedChoice}
        onContinue={dismissScriptedArrival}
      />
    );
  }

  if (encounter && pending) {
    return <Page><Loading msg={pendingMsg} /></Page>;
  }

  if (outcome) {
    return (
      <Page>
        <div className="ink-fade-in" style={{ maxWidth: '42rem', margin: '0 auto', padding: '3.0rem 1.5rem', width: '100%' }}>
          <div className="display text-center" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.2em', marginBottom: '0.5rem' }}>
            THE HOUR TURNS
          </div>
          <Fleuron />
          <p style={{ fontSize: '1.1em', whiteSpace: 'pre-line' }}>{outcome.prose}</p>
          <ImagePlate plate={pickPlate(outcome.prose)} />
          <ImaginePanel prose={outcome.prose} />
          <Fleuron char="❧" />
          <ChangesSummary changes={outcome.changes} />
          <div className="text-center" style={{ marginTop: '2rem' }}>
            <button className="wax-button" onClick={concludeOutcome}>Continue</button>
          </div>
        </div>
      </Page>
    );
  }

  if (encounter) {
    return (
      <Page>
        <div className="ink-fade-in" style={{ padding: '3.0rem 1.5rem', width: '100%' }}>
          {viewportMode === 'desktop' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 480px', gap: '1rem', alignItems: 'start', maxWidth: '80rem', margin: '0 auto' }}>
              <div>
                <div className="display text-center" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.2em', marginBottom: '0.5rem' }}>
                  {encounter.type === 'voyage' ? 'AT SEA' : encounter.type === 'pursue' ? 'A MATTER PURSUED' : 'AN INCIDENT'}
                </div>
                <Fleuron />
                <p className="drop-cap" style={{ fontSize: '1.1em' }}>{encounter.prose}</p>
                <Fleuron char="❧" />
                <div style={{ marginTop: '1.5rem' }}>
                  {encounter.choices.map((c, i) => (
                    <div key={i} style={{ marginBottom: '0.7rem' }}>
                      <button
                        className="ghost-button"
                        style={{ width: '100%', textAlign: 'left', padding: '0.7rem 1rem' }}
                        onClick={() => handleEncounterChoice(c)}
                      >
                        &mdash; {c.label}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <InlineIllustration prose={encounter.prose} />
            </div>
          ) : (
            <div style={{ maxWidth: '42rem', margin: '0 auto' }}>
              <div className="display text-center" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.2em', marginBottom: '0.5rem' }}>
                {encounter.type === 'voyage' ? 'AT SEA' : encounter.type === 'pursue' ? 'A MATTER PURSUED' : 'AN INCIDENT'}
              </div>
              <Fleuron />
              <p className="drop-cap" style={{ fontSize: '1.1em' }}>{encounter.prose}</p>
              <Fleuron char="❧" />
              <div style={{ marginTop: '1.5rem' }}>
                {encounter.choices.map((c, i) => (
                  <div key={i} style={{ marginBottom: '0.7rem' }}>
                    <button
                      className="ghost-button"
                      style={{ width: '100%', textAlign: 'left', padding: '0.7rem 1rem' }}
                      onClick={() => handleEncounterChoice(c)}
                    >
                      &mdash; {c.label}
                    </button>
                    {c.seed && (
                      <div style={{ marginLeft: '1rem', marginTop: '0.2rem', fontStyle: 'italic', color: '#6b4423', fontSize: '0.82em' }}>
                        {c.seed}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Page>
    );
  }

  if (pending) {
    return <Page><Loading msg={pendingMsg} /></Page>;
  }

  const atHome = gs.location === 'Bayan-Kor';

  return (
    <IllustrationRecorderContext.Provider value={recordIllustration}>
    <IllustrationsListContext.Provider value={gs.illustrations || []}>
    <Page>
      <div style={{ maxWidth: '64rem', margin: '0 auto', padding: '1.25rem 1.0rem', width: '100%' }}>
        <Header
          gs={gs}
          onReturnToTitle={onReturnToTitle}
          onSuccession={onSuccession}
          onRenewal={onRenewal}
          viewportMode={viewportMode}
          sync={sync}
          onOpenGallery={() => setGalleryOpen(true)}
          showCounsel={showCounsel}
          onToggleCounsel={toggleCounsel}
        />
        <Tabs tab={tab} setTab={setTab} unread={gs.letters.filter(l => !l.read).length} atHome={atHome} viewportMode={viewportMode} />
        <div className="parchment" style={{ padding: '1.25rem', minHeight: '24rem', background: 'rgba(255,253,245,0.4)' }}>
          {(() => {
            // On desktop, 'map' and 'ledger' are merged into 'overview'.
            // effectiveTab normalises stale tab state across viewport changes
            // without persisting it. desktop ↔ mobile is symmetric:
            //   desktop sees old 'map'/'ledger' as 'overview'
            //   mobile sees old 'overview' as 'map' (closest equivalent)
            // The persistent tab value (`tab`) is whatever the player last clicked;
            // effectiveTab is the renderable normalisation of that for the current mode.
            const effectiveTab =
              (viewportMode === 'desktop' && (tab === 'map' || tab === 'ledger')) ? 'overview' :
              (viewportMode !== 'desktop' && tab === 'overview') ? 'map' :
              tab;
            return (
              <>
                {effectiveTab === 'journal' && <JournalView gs={gs} arrivalProse={arrivalProse} setTab={setTab} openLetterById={openLetterById} pursueThread={handlePursueThread} viewportMode={viewportMode} showCounsel={showCounsel} />}
                {effectiveTab === 'overview' && viewportMode === 'desktop' && <DesktopOverview gs={gs} sailTo={sailTo} />}
                {effectiveTab === 'ledger' && viewportMode !== 'desktop' && <LedgerView gs={gs} />}
                {effectiveTab === 'map' && viewportMode !== 'desktop' && <MapView gs={gs} sailTo={sailTo} />}
                {effectiveTab === 'port' && <PortView gs={gs} buyGood={buyGood} sellGood={sellGood} refitShip={refitShip} arrivalProse={arrivalProse} setTab={setTab} lodgeGoods={lodgeGoods} withdrawGoods={withdrawGoods} commissionBrigantine={commissionBrigantine} takeBottomry={takeBottomry} liftContractOpium={liftContractOpium} runDutchCustoms={runDutchCustoms} viewportMode={viewportMode} />}
                {effectiveTab === 'outpost' && atHome && <OutpostView gs={gs} startBuild={startBuild} expediteBuild={expediteBuild} establishVenture={establishVenture} viewportMode={viewportMode} />}
                {effectiveTab === 'letters' && <LettersView gs={gs} setGs={setGs} onRespond={handleLetterResponse} openLetterId={openLetterId} setOpenLetterId={setOpenLetterId} viewportMode={viewportMode} />}
              </>
            );
          })()}
        </div>
        <ProvisionsDrawer gs={gs} setGs={setGs} lastSavedAt={lastSavedAt} />
      </div>
      {galleryOpen && (
        <GalleryModal
          gs={gs}
          onClose={() => setGalleryOpen(false)}
          onRegenerate={(id) => setGs(prev => regenerateIllustrationInGs(prev, id))}
          onDiscard={(id) => setGs(prev => discardIllustrationInGs(prev, id))}
        />
      )}
    </Page>
    </IllustrationsListContext.Provider>
    </IllustrationRecorderContext.Provider>
  );
}

// ─────────── GITHUB BACKUP ───────────
// Mobile makes file downloads and clipboard copy unreliable. The GitHub
// Contents API supports CORS, so we can PUT files directly from the artifact.
// Configure once with a fine-grained PAT scoped to a single repo
// (contents:write); each "Save" button uploads a timestamped JSON file.
// The PAT is kept in its own localStorage key so it never lands in a
// manuscript export.

// GitHub backup is hidden in the Claude artifact runtime (CSP blocks
// api.github.com). Flip to true when running the game outside Claude.
const ENABLE_GITHUB_BACKUP = false;

const GH_CONFIG_KEY = 'factor_github_config';

const loadGithubConfig = async () => {
  const raw = await safeStorage.get(GH_CONFIG_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
};

const saveGithubConfig = async (cfg) => {
  await safeStorage.set(GH_CONFIG_KEY, JSON.stringify(cfg));
};

const clearGithubConfig = async () => {
  await safeStorage.delete(GH_CONFIG_KEY);
};

// btoa over UTF-8 — GitHub's Contents API expects base64 of the raw bytes.
const utf8ToBase64 = (s) => {
  if (typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  // Older fallback — okay for ASCII-heavy JSON.
  return btoa(unescape(encodeURIComponent(s)));
};

async function pushFileToGitHub({ token, owner, repo, branch }, path, content, message) {
  if (!token || !owner || !repo) {
    return { ok: false, error: 'GitHub backup is not configured.' };
  }
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const body = { message, content: utf8ToBase64(content) };
  if (branch) body.branch = branch;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON error */ }
    if (!res.ok) {
      return { ok: false, status: res.status, error: data?.message || `HTTP ${res.status}` };
    }
    return {
      ok: true,
      htmlUrl: data?.content?.html_url,
      path: data?.content?.path,
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function GithubBackupModal({ gs, initialConfig, onClose }) {
  const [cfg, setCfg] = useState(initialConfig || { token: '', owner: '', repo: '', branch: 'main', path: 'factors-charter' });
  const [editing, setEditing] = useState(!initialConfig);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null); // { tone: 'ok'|'err', text, url? }

  const showFlash = (f) => { setFlash(f); };

  const persist = async (next) => {
    await saveGithubConfig(next);
    setCfg(next);
    setEditing(false);
    showFlash({ tone: 'ok', text: 'Configuration saved on this device.' });
  };

  const wipe = async () => {
    if (!window.confirm('Forget the GitHub configuration on this device? The PAT will be deleted from local storage.')) return;
    await clearGithubConfig();
    setCfg({ token: '', owner: '', repo: '', branch: 'main', path: 'factors-charter' });
    setEditing(true);
    showFlash({ tone: 'ok', text: 'Configuration cleared.' });
  };

  const trimmedPath = (cfg.path || '').replace(/^\/+|\/+$/g, '');

  const upload = async (kind) => {
    setBusy(true);
    setFlash(null);
    const ts = Date.now();
    let payload, subdir, slug;
    if (kind === 'manuscript') {
      payload = JSON.stringify({ gs, phase: 'game', exportedAt: ts }, null, 2);
      subdir = 'manuscripts';
      slug = `factors-charter-day${gs.day}-${ts}.json`;
    } else if (kind === 'aiLog') {
      const log = gs.aiLog || [];
      payload = JSON.stringify({ player: gs.player.name, day: gs.day, count: log.length, aiLog: log }, null, 2);
      subdir = 'ai-log';
      slug = `factors-charter-ai-log-day${gs.day}-${ts}.json`;
    }
    const path = [trimmedPath, subdir, slug].filter(Boolean).join('/');
    const message = `${kind === 'aiLog' ? 'AI log' : 'Manuscript'} backup — ${gs.player.name}, day ${gs.day}`;
    const res = await pushFileToGitHub(cfg, path, payload, message);
    setBusy(false);
    if (res.ok) {
      showFlash({ tone: 'ok', text: `Pushed ${path}.`, url: res.htmlUrl });
    } else {
      const hint = res.status === 401 ? ' (token rejected — check the PAT scopes)'
        : res.status === 404 ? ' (repo not found — check owner/repo or token scope)'
        : res.status === 422 ? ' (a file by that path already exists this same millisecond, retry)'
        : '';
      showFlash({ tone: 'err', text: `Failed: ${res.error}${hint}` });
    }
  };

  const set = (key) => (e) => setCfg({ ...cfg, [key]: e.target.value });
  const configured = cfg.token && cfg.owner && cfg.repo;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(20,12,4,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="parchment"
        style={{
          background: '#f0e3c4',
          maxWidth: '36rem', width: '100%', maxHeight: '92vh', overflowY: 'auto',
          padding: '1rem',
          boxShadow: '0 4px 16px rgba(20,12,4,0.5)',
          border: '1px solid rgba(74,44,20,0.4)',
        }}
      >
        <div className="display" style={{ fontSize: '1em', color: '#5c1a08', marginBottom: '0.4rem' }}>GitHub Backup</div>

        {editing ? (
          <>
            <p style={{ fontSize: '0.85em', color: '#4a3220', fontStyle: 'italic', margin: '0 0 0.7rem 0' }}>
              Use a <strong>fine-grained PAT</strong> scoped to one repository, with the <em>Contents: Read &amp; write</em> permission.
              The token is kept on this device only; it is never written into a manuscript export.
            </p>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {[
                { key: 'token',  label: 'Personal access token (fine-grained)', type: 'password', placeholder: 'github_pat_...' },
                { key: 'owner',  label: 'Owner (user or org)', placeholder: 'wcfcarolina13' },
                { key: 'repo',   label: 'Repository', placeholder: 'factors-charter' },
                { key: 'branch', label: 'Branch', placeholder: 'main' },
                { key: 'path',   label: 'Path prefix (folder under repo root)', placeholder: 'factors-charter' },
              ].map(f => (
                <label key={f.key} style={{ display: 'block', fontSize: '0.85em', color: '#6b4423' }}>
                  {f.label}
                  <input
                    type={f.type || 'text'}
                    value={cfg[f.key] || ''}
                    onChange={set(f.key)}
                    placeholder={f.placeholder}
                    autoComplete={f.key === 'token' ? 'off' : undefined}
                    spellCheck={false}
                    style={{
                      width: '100%', padding: '0.5rem', marginTop: '0.2rem',
                      fontFamily: f.key === 'token' ? 'monospace' : 'inherit',
                      fontSize: '0.9em',
                      background: 'rgba(255,255,255,0.5)',
                      border: '1px solid rgba(74,44,20,0.3)',
                      color: '#2a1a0a',
                    }}
                  />
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {initialConfig && (
                <button className="ghost-button" onClick={() => { setCfg(initialConfig); setEditing(false); }}>Cancel</button>
              )}
              <button
                className="wax-button"
                disabled={!cfg.token || !cfg.owner || !cfg.repo}
                onClick={() => persist(cfg)}
              >
                Save configuration
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: '0.88em', color: '#4a3220', marginBottom: '0.5rem' }}>
              Configured: <strong>{cfg.owner}/{cfg.repo}</strong> on <strong>{cfg.branch || 'default'}</strong>
              {trimmedPath ? <> · path <code style={{ fontFamily: 'monospace' }}>{trimmedPath}</code></> : null}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              <button className="wax-button" disabled={busy} onClick={() => upload('manuscript')}>
                ↑ Push manuscript
              </button>
              <button
                className="wax-button"
                disabled={busy || !gs.aiLog || gs.aiLog.length === 0}
                onClick={() => upload('aiLog')}
              >
                ↑ Push AI log ({(gs.aiLog || []).length})
              </button>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
              <button className="ghost-button" onClick={() => setEditing(true)}>Edit configuration</button>
              <button className="ghost-button" onClick={wipe}>Forget token</button>
            </div>
          </>
        )}

        {busy && (
          <div className="ink-fade-in" style={{ marginTop: '0.7rem', fontSize: '0.88em', color: '#6b4423', fontStyle: 'italic' }}>
            Pushing to GitHub…
          </div>
        )}
        {flash && !busy && (
          <div
            className="ink-fade-in"
            style={{
              marginTop: '0.7rem', padding: '0.5rem 0.7rem',
              borderLeft: `3px solid ${flash.tone === 'err' ? '#8b1a1a' : '#5c1a08'}`,
              background: flash.tone === 'err' ? 'rgba(139,26,26,0.08)' : 'rgba(92,26,8,0.08)',
              fontSize: '0.88em', color: flash.tone === 'err' ? '#8b1a1a' : '#5c1a08',
              wordBreak: 'break-all',
            }}
          >
            {flash.text}
            {flash.url && (
              <div style={{ marginTop: '0.3rem' }}>
                <a href={flash.url} target="_blank" rel="noopener noreferrer" style={{ color: '#5c1a08' }}>{flash.url}</a>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: '0.9rem', textAlign: 'right' }}>
          <button className="ghost-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─────────── CONSIGNMENT MODAL ───────────
// Opens when the Indiaman calls. Lets the Factor consign up to
// PRIVATE_TRADE_LIMIT cwt of any commodity from his godown to his own
// account in London. The next Indiaman returns the proceeds at London
// markups (LONDON_MULT). If the modal is dismissed without consigning,
// nothing leaves and no money returns.

function ConsignmentModal({ gs, onConfirm, onDecline }) {
  // Local working tally — keys are commodity names, values are cwt to ship.
  const [picks, setPicks] = useState({});
  const ware = gs.outpost?.warehouse || {};
  const available = Object.keys(COMMODITIES).filter(k => Math.floor(ware[k] || 0) > 0);

  const totalCwtChosen = Object.values(picks).reduce((a, v) => a + (Number(v) || 0), 0);
  const expectedPayout = Object.entries(picks)
    .reduce((a, [k, v]) => a + londonValue(k, Math.floor(v) || 0), 0);

  const setQty = (k, raw) => {
    const inGodown = Math.floor(ware[k] || 0);
    const current = Math.floor(picks[k] || 0);
    const requested = Math.max(0, Math.floor(Number(raw) || 0));
    const otherTotal = totalCwtChosen - current;
    const headroom = Math.max(0, PRIVATE_TRADE_LIMIT - otherTotal);
    const capped = Math.min(requested, inGodown, headroom);
    setPicks(prev => {
      const next = { ...prev };
      if (capped > 0) next[k] = capped;
      else delete next[k];
      return next;
    });
  };

  const bump = (k, delta) => {
    const current = Math.floor(picks[k] || 0);
    setQty(k, current + delta);
  };

  const confirm = () => {
    if (totalCwtChosen <= 0) { onDecline(); return; }
    onConfirm(picks);
  };

  return (
    <div
      onClick={onDecline}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(20,12,4,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="parchment"
        style={{
          background: '#f0e3c4',
          maxWidth: '38rem', width: '100%', maxHeight: '90vh',
          padding: '1rem', display: 'flex', flexDirection: 'column',
          boxShadow: '0 4px 16px rgba(20,12,4,0.5)',
          border: '1px solid rgba(74,44,20,0.4)',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
          <div className="display" style={{ fontSize: '1em', color: '#5c1a08' }}>
            A private consignment
          </div>
          <button
            onClick={onDecline}
            aria-label="Close"
            style={{
              background: 'transparent', border: '1px solid #6b4423',
              color: '#5c1a08', padding: '0.2rem 0.5rem', cursor: 'pointer',
              fontFamily: '"IM Fell English SC", serif', fontSize: '0.9em',
              minWidth: '2rem',
            }}
          >
            ✕
          </button>
        </div>
        <p style={{ fontSize: '0.92em', color: '#4a3220', fontStyle: 'italic', marginTop: 0, marginBottom: '0.7rem' }}>
          The Indiaman&rsquo;s mate will take up to {PRIVATE_TRADE_LIMIT} cwt of yr. own goods on yr. private account, by the customary allowance. The proceeds return by the next Indiaman, at the London market.
        </p>
        {available.length === 0 ? (
          <p className="italic" style={{ color: '#6b4423' }}>The godown is empty. No private cargo to send this voyage.</p>
        ) : (
          <div style={{ marginBottom: '0.7rem' }}>
            {available.map(k => {
              const inGodown = Math.floor(ware[k] || 0);
              const picked = Math.floor(picks[k] || 0);
              const expected = londonValue(k, picked);
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid rgba(74,44,20,0.15)', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '8rem' }}>
                    <div>{COMMODITIES[k].name} <span style={{ fontSize: '0.82em', color: '#6b4423' }}>(godown {inGodown})</span></div>
                    {picked > 0 && (
                      <div style={{ fontSize: '0.8em', color: '#3a5c2a' }}>
                        {picked} cwt → £{expected} expected
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                    <button className="ghost-button-sm" onClick={() => bump(k, -1)} disabled={picked < 1}>−</button>
                    <input
                      className="parchment-input"
                      type="number"
                      min="0"
                      max={Math.min(inGodown, PRIVATE_TRADE_LIMIT)}
                      value={picked}
                      onChange={(e) => setQty(k, e.target.value)}
                      aria-label={`Quantity of ${COMMODITIES[k].name} for private trade`}
                      style={{ width: '3.5rem', textAlign: 'center', fontSize: '0.9em' }}
                    />
                    <button className="ghost-button-sm" onClick={() => bump(k, 1)} disabled={inGodown <= picked || totalCwtChosen >= PRIVATE_TRADE_LIMIT}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ fontSize: '0.85em', color: '#4a3220', marginBottom: '0.5rem' }}>
          <span>Total chosen: <strong>{totalCwtChosen} / {PRIVATE_TRADE_LIMIT} cwt</strong></span>
          {expectedPayout > 0 && (
            <span style={{ marginLeft: '0.7rem', color: '#3a5c2a' }}>· expected return ~£{expectedPayout}</span>
          )}
        </div>
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="ghost-button" onClick={onDecline}>Send nothing this voyage</button>
          <button className="wax-button" onClick={confirm} disabled={totalCwtChosen === 0}>
            Consign {totalCwtChosen} cwt
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────── IMAGINE PANEL + ILLUSTRATION MODAL ───────────
// A button opens a fullscreen modal that:
//   - Auto-copies the prompt to the clipboard via the robust path
//     (clipboard.writeText → document.execCommand('copy') on a hidden
//     textarea → in-place selection of the visible textarea).
//   - Optionally attempts an inline image via Pollinations.ai when the
//     player taps "Try in-game illustration." Pollinations is blocked in
//     the artifact runtime (img-src CSP), but the button is kept so the
//     option is there when the runtime allows it — silent failure does
//     not interfere with copying the prompt.
//   - Has multiple exit paths: ✕ icon top right, Close button, click
//     outside the modal.
//
// STYLE_PREFIX (shared with the illustration cache via src/util/style-prefix.js)
// keeps illustrations consistent across the charter — the same hand made them
// all. Modal + cache import the same constant so they cannot drift.

// Robust copy: try modern clipboard API first; if it throws or is missing,
// inject a hidden textarea and execCommand('copy'), which is permitted in
// many sandboxed iframe contexts where clipboard.writeText isn't. Returns
// true on success.
async function robustCopy(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch (e) { /* fall through */ }
  return false;
}

// Factor key modal — surfaced from the in-game ☰ Menu. Shows the device's
// current factor key (cross-device identity), lets the player copy it for
// transport to another device, and lets them paste a key from another
// device to inherit that device's charters here. Replacement is immediate;
// the title screen on next visit will list charters under the new key.
// Shared modal chrome: lock body scroll while open (iOS Safari scrolls the
// page behind position:fixed overlays without it) and dismiss on Escape.
// Pass null for onClose to lock scroll without an Escape path (forced-choice
// modals like the sync conflict).
function useModalChrome(onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}

function FactorKeyModal({ onClose, onChange }) {
  useModalChrome(onClose);
  const currentKey = readFactorKey() || '';
  const [pasted, setPasted] = useState('');
  const [flash, setFlash] = useState('');
  const [copied, setCopied] = useState(false);

  const showFlash = (msg) => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 2200);
  };

  const handleCopy = async () => {
    if (!currentKey) return;
    try {
      await navigator.clipboard.writeText(currentKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      showFlash('Could not copy — select the key above and copy by hand.');
    }
  };

  const handleApplyPaste = () => {
    const trimmed = pasted.trim().toLowerCase();
    if (!isValidPlaythroughId(trimmed)) {
      showFlash('That does not look like a valid factor key (e.g. pelican-salt-pepper-1923).');
      return;
    }
    if (trimmed === currentKey) {
      showFlash('That is already your factor key.');
      return;
    }
    if (!writeFactorKey(trimmed)) {
      showFlash('Could not save the new key — storage may be disabled.');
      return;
    }
    onChange && onChange(trimmed);
    onClose && onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(20,12,4,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }} onClick={onClose}>
      <div className="parchment" style={{
        maxWidth: '38rem', width: '100%',
        padding: '1.4rem 1.6rem',
        background: '#f0e3c4',
        boxShadow: '0 4px 16px rgba(20,12,4,0.5)',
        border: '1px solid rgba(74,44,20,0.4)',
      }} onClick={(e) => e.stopPropagation()}>
        <div className="display" style={{ fontSize: '1.05em', color: '#5c1a08', marginBottom: '0.5rem' }}>
          ⁂ FACTOR KEY
        </div>
        <p style={{ fontSize: '0.9em', color: '#2a1a0a', lineHeight: 1.55, marginBottom: '0.8rem' }}>
          Yr. factor key is the secret that ties yr. charters across devices. Every charter
          on this device is saved to the cloud under it. To pick up yr. charters on another
          device — phone or desk — paste this same key there.
        </p>

        <div className="display" style={{ fontSize: '0.78em', color: '#6b4423', letterSpacing: '0.1em', marginBottom: '0.3rem' }}>
          ON THIS DEVICE
        </div>
        <div style={{
          padding: '0.55rem 0.7rem',
          background: 'rgba(255,253,245,0.7)',
          border: '1px solid rgba(74,44,20,0.3)',
          fontFamily: 'monospace',
          fontSize: '0.95em',
          color: '#2a1a0a',
          marginBottom: '0.5rem',
          wordBreak: 'break-all',
          userSelect: 'all',
        }}>
          {currentKey || '— no key yet —'}
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.2rem' }}>
          <button className="ghost-button" onClick={handleCopy} disabled={!currentKey}>
            {copied ? '⎘ Copied' : '⎘ Copy to clipboard'}
          </button>
        </div>

        <div className="display" style={{ fontSize: '0.78em', color: '#6b4423', letterSpacing: '0.1em', marginBottom: '0.3rem' }}>
          REPLACE WITH A KEY FROM ANOTHER DEVICE
        </div>
        <p style={{ fontSize: '0.82em', color: '#4a3220', fontStyle: 'italic', marginBottom: '0.4rem' }}>
          Pasting a key from another device will rebind this device to that key. Yr. existing
          local charters here keep playing, but the title screen will start showing charters
          from the other device. Yr. previous key on this device is forgotten — copy it first
          if you want it back.
        </p>
        <input
          className="parchment-input"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="e.g. pelican-salt-pepper-1923"
          aria-label="Factor key from another device"
          style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.9em', boxSizing: 'border-box' }}
        />

        {flash && (
          <div className="ink-fade-in" style={{ marginTop: '0.6rem', padding: '0.4rem 0.7rem', background: 'rgba(92,26,8,0.08)', borderLeft: '2px solid #5c1a08', fontSize: '0.85em', color: '#5c1a08' }}>
            {flash}
          </div>
        )}

        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="ghost-button" onClick={onClose}>Close</button>
          <button className="wax-button" onClick={handleApplyPaste} disabled={!pasted.trim()}>Apply key</button>
        </div>
      </div>
    </div>
  );
}

// ─────────── GALLERY MODAL ───────────
//
// Per-charter image gallery. Reads gs.illustrations[] (populated whenever
// an InlineIllustration or IllustrationModal successfully loads) and
// renders a thumbnail grid. Tap-to-enlarge → opens an inline lightbox.
// Each entry has Regenerate (bumps seed → fresh image; updates the in-game
// cache too so subsequent encounters render the new one) and Discard
// (sticky soft-delete; entry stays in gs to prevent silent re-add but
// hides from the grid).
//
// Thumbnails use loading="lazy" so a 60-image gallery doesn't fetch all
// 60 × 650 KB JPEGs the moment the modal opens — the browser fetches as
// the player scrolls. Cloudflare R2 + the SW caches keep repeat opens
// instant.

function GalleryModal({ gs, onClose, onRegenerate, onDiscard }) {
  const all = Array.isArray(gs?.illustrations) ? gs.illustrations : [];
  const visible = all.filter(i => !i.deletedByPlayer);
  const sorted = [...visible].sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
  const [enlarged, setEnlarged] = React.useState(null); // illustration entry
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(null); // id
  // Escape peels the lightbox first, then the modal.
  useModalChrome(() => { if (enlarged) setEnlarged(null); else onClose(); });

  const totalCount = all.length;
  const visibleCount = visible.length;

  const handleRegenerate = (id) => {
    onRegenerate && onRegenerate(id);
    // Close the lightbox so the new image gets pulled fresh on next open.
    if (enlarged?.id === id) setEnlarged(null);
  };

  const handleDiscard = (id) => {
    onDiscard && onDiscard(id);
    setConfirmingDiscard(null);
    if (enlarged?.id === id) setEnlarged(null);
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(20,12,4,0.65)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '1rem', overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        className="parchment"
        style={{
          maxWidth: '64rem', width: '100%',
          padding: '1.4rem 1.6rem',
          background: '#f0e3c4',
          boxShadow: '0 4px 16px rgba(20,12,4,0.5)',
          border: '1px solid rgba(74,44,20,0.4)',
          marginTop: '1rem', marginBottom: '1rem',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
          <div className="display" style={{ fontSize: '1.05em', color: '#5c1a08' }}>
            ✦ ILLUSTRATION GALLERY
          </div>
          <button className="ghost-button-sm" onClick={onClose} aria-label="Close gallery">✕</button>
        </div>
        <p style={{ fontSize: '0.85em', color: '#4a3220', fontStyle: 'italic', marginBottom: '1rem' }}>
          Every scene the Factor has illustrated, kept against the day. Tap an image to enlarge.
          Regenerate fr. a different seed if the rendering does not please you.
          {visibleCount === 0 && totalCount > 0 && ` (${totalCount - visibleCount} discarded.)`}
        </p>

        {visibleCount === 0 && (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#6b4423', fontStyle: 'italic' }}>
            No illustrations yet. Open an encounter or letter that draws a scene, and it will be recorded here.
          </div>
        )}

        {visibleCount > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))',
            gap: '0.7rem',
          }}>
            {sorted.map((ill) => (
              <div
                key={ill.id}
                style={{
                  background: 'rgba(255,253,245,0.55)',
                  border: '1px solid rgba(74,44,20,0.3)',
                  display: 'flex', flexDirection: 'column',
                  cursor: 'pointer',
                }}
                onClick={() => setEnlarged(ill)}
              >
                <div style={{
                  width: '100%',
                  aspectRatio: '3 / 2',
                  background: '#d9c596',
                  overflow: 'hidden',
                  position: 'relative',
                }}>
                  <img
                    src={ill.url}
                    alt="Scene illustration"
                    loading="lazy"
                    style={{
                      width: '100%', height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                  {ill.regeneratedAt && (
                    <div style={{
                      position: 'absolute', top: '0.3rem', right: '0.3rem',
                      background: 'rgba(92,26,8,0.8)', color: '#f0e3c4',
                      fontSize: '0.7em', padding: '0.1rem 0.4rem',
                      fontStyle: 'italic',
                    }}>
                      regenerated
                    </div>
                  )}
                </div>
                <div style={{ padding: '0.5rem 0.6rem' }}>
                  <div style={{ fontSize: '0.78em', color: '#6b4423', letterSpacing: '0.04em', marginBottom: '0.2rem' }}>
                    DAY {ill.day || 0}
                  </div>
                  <div style={{ fontSize: '0.82em', color: '#2a1a0a', fontStyle: 'italic', lineHeight: 1.35,
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {ill.prose}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox + per-image actions */}
      {enlarged && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 210,
            background: 'rgba(10,6,2,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem', flexDirection: 'column',
          }}
          onClick={() => { setEnlarged(null); setConfirmingDiscard(null); }}
        >
          <div
            style={{
              maxWidth: '52rem', width: '100%',
              display: 'flex', flexDirection: 'column', gap: '0.6rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={enlarged.url}
              alt="Enlarged scene"
              style={{
                width: '100%',
                maxHeight: '70vh',
                objectFit: 'contain',
                background: '#1a0f04',
                border: '1px solid rgba(240,227,196,0.3)',
              }}
            />
            <div className="parchment" style={{
              padding: '0.8rem 1rem',
              background: 'rgba(255,253,245,0.95)',
              border: '1px solid rgba(74,44,20,0.4)',
            }}>
              <div style={{ fontSize: '0.78em', color: '#6b4423', letterSpacing: '0.04em', marginBottom: '0.3rem' }}>
                DAY {enlarged.day || 0} &middot; SEED {enlarged.seed}
                {enlarged.regeneratedAt && ' · regenerated'}
              </div>
              <div style={{ fontSize: '0.92em', color: '#2a1a0a', fontStyle: 'italic', lineHeight: 1.5, marginBottom: '0.7rem' }}>
                {enlarged.prose}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {confirmingDiscard === enlarged.id ? (
                  <>
                    <span style={{ fontSize: '0.85em', color: '#5c1a08', fontStyle: 'italic', alignSelf: 'center', marginRight: 'auto' }}>
                      Discard from gallery? The scene can be re-illustrated next time it appears.
                    </span>
                    <button className="ghost-button-sm" onClick={() => setConfirmingDiscard(null)}>Keep</button>
                    <button className="ghost-button-sm" style={{ color: '#8b1a1a', borderColor: '#8b1a1a' }} onClick={() => handleDiscard(enlarged.id)}>
                      Yes, discard
                    </button>
                  </>
                ) : (
                  <>
                    <button className="ghost-button-sm" onClick={() => setConfirmingDiscard(enlarged.id)}>
                      Discard
                    </button>
                    <button className="ghost-button" onClick={() => handleRegenerate(enlarged.id)}>
                      ✦ Regenerate (new seed)
                    </button>
                    <button className="wax-button" onClick={() => setEnlarged(null)}>Close</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Conflict modal — shown when both this device and the cloud have progressed
// since the last sync. Player picks a side; the discarded version is
// auto-downloaded as a Manuscript JSON before the choice commits, so a wrong
// pick is recoverable via the existing Restore from manuscript flow.
function ConflictModal({ localGs, remoteRecord, onResolve }) {
  // Scroll lock only — no Escape path. The conflict demands a choice; an
  // accidental dismissal would leave the two saves silently diverged.
  useModalChrome(null);
  const remoteGs = remoteRecord?.body || {};

  const stats = (gs, savedAt) => ({
    day: gs.day || 0,
    money: gs.money || 0,
    location: gs.location || '—',
    latestEntry: (gs.journal && gs.journal.length > 0) ? gs.journal[gs.journal.length - 1].entry : '—',
    savedAt: savedAt ? new Date(savedAt).toLocaleString() : '—',
  });

  const localStats = stats(localGs, null);
  const remoteStats = stats(remoteGs, remoteRecord?.savedAt);

  const renderColumn = (label, s) => (
    <div className="parchment" style={{
      padding: '0.9rem 1rem',
      background: 'rgba(255,253,245,0.5)',
      border: '1px solid rgba(74,44,20,0.25)',
      flex: 1,
      minWidth: '14rem',
    }}>
      <div className="display" style={{ fontSize: '0.85em', color: '#5c1a08', marginBottom: '0.4rem' }}>{label}</div>
      <div style={{ fontSize: '0.85em', lineHeight: 1.7, color: '#2a1a0a' }}>
        <div>Day: {s.day}</div>
        <div>Money: £{s.money}</div>
        <div>Location: {s.location}</div>
        <div style={{ fontStyle: 'italic', marginTop: '0.3rem', color: '#4a3220' }}>
          {s.latestEntry}
        </div>
        <div style={{ fontSize: '0.78em', color: '#6b4423', marginTop: '0.5rem', fontStyle: 'italic' }}>
          last saved: {s.savedAt}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(20,12,4,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}>
      <div className="parchment" style={{
        maxWidth: '44rem', width: '100%',
        padding: '1.5rem 1.7rem',
        background: '#f0e3c4',
        boxShadow: '0 4px 16px rgba(20,12,4,0.5)',
        border: '1px solid rgba(74,44,20,0.4)',
      }}>
        <div className="display" style={{ fontSize: '1.1em', color: '#5c1a08', marginBottom: '0.6rem' }}>
          ⁂ THE CHARTER HAS DIVERGED
        </div>
        <p style={{ fontSize: '0.92em', color: '#2a1a0a', lineHeight: 1.6, marginBottom: '0.8rem' }}>
          Yr. cloud copy and this device have both moved on since the last sync. Pick which to keep.
          The discarded version will be saved to yr. downloads as a Manuscript so nothing is truly lost —
          you can restore it later via the Manuscript import.
        </p>
        <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {renderColumn('THIS DEVICE', localStats)}
          {renderColumn('CLOUD', remoteStats)}
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="ghost-button" onClick={() => onResolve('local')}>
            Keep this device's version
          </button>
          <button className="wax-button" onClick={() => onResolve('cloud')}>
            Use cloud's version
          </button>
        </div>
      </div>
    </div>
  );
}

function IllustrationModal({ prose, onClose }) {
  useModalChrome(onClose);
  const recordIllustration = React.useContext(IllustrationRecorderContext);
  const illustrationsList = React.useContext(IllustrationsListContext);

  // If this scene already has a non-discarded entry in the gallery, the
  // image has been generated and viewed before — skip the manual "Try
  // in-game illustration" click and start fetching on open. The fetch
  // still hits the same /api/illustrate URL; Cloudflare R2 caches the
  // result so the second view is fast.
  const hasExistingIllustration = (() => {
    const meta = illustrationIdForProse(prose);
    if (!meta) return false;
    return (illustrationsList || []).some(
      i => i.id === meta.id && !i.deletedByPlayer
    );
  })();

  const [tryImage, setTryImage] = useState(hasExistingIllustration);
  const [imgState, setImgState] = useState(hasExistingIllustration ? 'loading' : 'idle');
  const [blobUrl, setBlobUrl] = useState(null);
  const [copyFlash, setCopyFlash] = useState('');
  const taRef = useRef(null);

  // Same gallery-recording effect as InlineIllustration. Fires once per
  // open if the image actually rendered.
  useEffect(() => {
    if (imgState === 'loaded' && recordIllustration && prose) {
      recordIllustration(prose);
    }
  }, [imgState, prose, recordIllustration]);

  const cleanProse = (prose || '').replace(/\s+/g, ' ').trim().slice(0, 320);
  const fullPrompt = STYLE_PREFIX + cleanProse;
  const seed = Math.abs(
    cleanProse.split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0) || 1
  );
  const imgUrl = `/api/illustrate?prompt=${encodeURIComponent(fullPrompt)}&seed=${seed}`;

  // Auto-copy on open. If both modern and legacy paths fail, leave the
  // user with a clear instruction to manually select.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await robustCopy(fullPrompt);
      if (cancelled) return;
      setCopyFlash(ok
        ? 'Prompt copied to clipboard.'
        : 'Auto-copy was refused. Tap "Copy to clipboard" or select the text below manually.');
      if (!ok && taRef.current) {
        // At least pre-select so the player can long-press a single handle.
        taRef.current.focus();
        taRef.current.select();
      }
    })();
    return () => { cancelled = true; };
  }, [fullPrompt]);

  // Fetch the image bytes with an explicit 60s timeout, then materialize as
  // a blob URL. This avoids the browser-internal abort heuristic that kills
  // <img src> loads on slow networks (Pollinations.ai routinely takes
  // 10-15s for voyage-prose prompts; mobile browsers were aborting silently
  // and tripping the onError path before the bytes arrived).
  useEffect(() => {
    if (!tryImage) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    fetch(imgUrl, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setImgState('loaded');
      })
      .catch(() => {
        if (cancelled) return;
        setImgState('failed');
      })
      .finally(() => clearTimeout(timeoutId));
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [tryImage, imgUrl]);

  // Revoke the blob URL when it changes or the modal unmounts so we don't
  // leak object URLs across reopen cycles.
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const onCopyClick = async () => {
    const ok = await robustCopy(fullPrompt);
    if (ok) {
      setCopyFlash('Copied to clipboard.');
    } else {
      setCopyFlash('Copy was refused. Long-press the text below and choose Copy.');
      if (taRef.current) {
        taRef.current.focus();
        taRef.current.select();
      }
    }
    setTimeout(() => setCopyFlash(''), 3500);
  };

  const onGenerateClick = () => {
    setTryImage(true);
    setImgState('loading');
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(20,12,4,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="parchment"
        style={{
          background: '#f0e3c4',
          maxWidth: '40rem', width: '100%', maxHeight: '90vh',
          padding: '1rem',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 4px 16px rgba(20,12,4,0.5)',
          border: '1px solid rgba(74,44,20,0.4)',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
          <div className="display" style={{ fontSize: '1em', color: '#5c1a08' }}>
            An illustration prompt
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: '1px solid #6b4423',
              color: '#5c1a08', padding: '0.2rem 0.5rem', cursor: 'pointer',
              fontFamily: '"IM Fell English SC", serif', fontSize: '0.9em',
              minWidth: '2rem',
            }}
          >
            ✕
          </button>
        </div>
        <p style={{ fontSize: '0.85em', color: '#4a3220', fontStyle: 'italic', marginTop: 0, marginBottom: '0.5rem' }}>
          The prompt has been copied to yr. clipboard. Paste it into ChatGPT, DALL·E, Midjourney, or any image-rendering tool. The in-game generator may also be tried below — it does not always reach this runtime.
        </p>
        <textarea
          ref={taRef}
          readOnly
          value={fullPrompt}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Image generation prompt"
          style={{
            minHeight: '8rem', width: '100%',
            fontFamily: 'monospace', fontSize: '0.82em',
            padding: '0.5rem',
            background: 'rgba(255,255,255,0.5)',
            border: '1px solid rgba(74,44,20,0.3)',
            color: '#2a1a0a',
            resize: 'vertical',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            boxSizing: 'border-box',
          }}
        />
        {copyFlash && (
          <div className="ink-fade-in" style={{ marginTop: '0.5rem', padding: '0.4rem 0.7rem', background: 'rgba(92,26,8,0.08)', borderLeft: '2px solid #5c1a08', fontSize: '0.85em', color: '#5c1a08' }}>
            {copyFlash}
          </div>
        )}
        <div style={{ marginTop: '0.7rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {!tryImage && (
            <button className="ghost-button" onClick={onGenerateClick}>
              Try in-game illustration
            </button>
          )}
          <button className="ghost-button" onClick={onCopyClick}>⎘ Copy to clipboard</button>
          <button className="wax-button" onClick={onClose}>Close</button>
        </div>
        {tryImage && (
          <div style={{ marginTop: '0.8rem', paddingTop: '0.6rem', borderTop: '1px dashed rgba(74,44,20,0.25)' }}>
            <div className="display" style={{ fontSize: '0.78em', color: '#6b4423', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
              ⁂ IN-GAME ILLUSTRATION
            </div>
            {imgState === 'loading' && (
              <div className="italic" style={{ color: '#6b4423', fontSize: '0.85em', marginBottom: '0.4rem' }}>
                Sketching… this can take half a minute. If nothing appears, the runtime has refused the call.
              </div>
            )}
            {imgState === 'failed' && (
              <div style={{ fontSize: '0.85em', color: '#8b1a1a', fontStyle: 'italic', marginBottom: '0.4rem' }}>
                The in-game generator could not be reached. Use the prompt above with an external tool.
              </div>
            )}
            {blobUrl && (
              <img
                src={blobUrl}
                alt="An illustration of the scene"
                style={{
                  width: '100%', maxWidth: '480px', height: 'auto',
                  display: imgState === 'loaded' ? 'block' : 'none',
                  border: '1px solid rgba(74,44,20,0.2)',
                  margin: '0 auto',
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Inline illustration for desktop mode — renders the cached image (or a
// placeholder while fetching) alongside an encounter / arrival / letter.
// On fetch failure, renders nothing (the parent's existing button-on-demand
// path remains available for the player). Mobile callers should not render
// this component; layouts decide based on viewportMode.
function InlineIllustration({ prose }) {
  const storage = (typeof window !== 'undefined') ? window.localStorage : null;
  const { url, status, hash } = getOrFetchIllustration(storage, prose);
  const [imgState, setImgState] = useState('loading');
  const [blobUrl, setBlobUrl] = useState(null);
  const recordIllustration = React.useContext(IllustrationRecorderContext);

  // Record to the gallery once the image is confirmed loaded. Done here
  // (after the render succeeds) rather than on mount so failed renders
  // don't litter the gallery with broken thumbnails.
  useEffect(() => {
    if (imgState === 'loaded' && recordIllustration && prose) {
      recordIllustration(prose);
    }
  }, [imgState, prose, recordIllustration]);

  // Fetch the image bytes with explicit 60s timeout. The browser-internal
  // abort heuristic on slow networks was tripping <img onError> before the
  // bytes arrived from Pollinations (which routinely takes 10-15s for
  // voyage-prose prompts). The cache returns a deterministic URL whether
  // 'cached' or 'fetching' — re-fetching on cache hits is cheap when the
  // browser HTTP cache is warm and robust when it isn't.
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
        setImgState('loaded');
        if (storage && status === 'fetching') {
          markIllustrationLoaded(storage, hash, url);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setImgState('failed');
      })
      .finally(() => clearTimeout(timeoutId));
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [url, status, hash, storage]);

  // Revoke the blob URL when it changes or this component unmounts.
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  if (status === 'empty' || !url) return null;

  return (
    <div style={{
      width: '100%',
      aspectRatio: '3 / 2',
      background: '#d9c596',
      border: '1px solid rgba(74,44,20,0.3)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {imgState !== 'failed' && blobUrl && (
        <img
          src={blobUrl}
          alt="An illustration of the scene"
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

function ImaginePanel({ prose, label = 'Imagine this scene' }) {
  const [open, setOpen] = useState(false);
  const cleanProse = (prose || '').replace(/\s+/g, ' ').trim();
  if (!cleanProse) return null;
  return (
    <>
      <button
        className="ghost-button-sm"
        onClick={() => setOpen(true)}
        style={{ marginTop: '0.5rem' }}
        title="Open an illustration prompt for this passage"
      >
        ✦ {label}
      </button>
      {open && <IllustrationModal prose={prose} onClose={() => setOpen(false)} />}
    </>
  );
}

// ─────────── EXPORT MODAL ───────────
// Programmatic blob downloads (a.click() on a Blob URL) navigate the artifact
// iframe away on mobile and tear down the React tree. This modal replaces them
// with a copyable textarea + a Copy button that uses the clipboard API. Works
// in any sandboxed iframe; falls back to manual long-press copying if the
// clipboard is refused.
function ExportModal({ title, content, filename, onClose, helperText, wrap }) {
  useModalChrome(onClose);
  const [flash, setFlash] = useState('');
  const taRef = useRef(null);

  // Try to copy automatically when opened — saves the user a tap if it works.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(content);
          if (!cancelled) setFlash('Copied to clipboard.');
        }
      } catch (e) { /* user can copy manually from the textarea */ }
    })();
    return () => { cancelled = true; };
  }, [content]);

  const copyAgain = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
        setFlash('Copied to clipboard.');
        return;
      }
    } catch (e) { /* fall through */ }
    // Fallback: select the textarea so the user can long-press → Copy.
    if (taRef.current) {
      taRef.current.focus();
      taRef.current.select();
      setFlash('Long-press the text and choose Copy.');
    }
  };

  const sizeKB = Math.max(1, Math.round((content?.length || 0) / 1024));

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(20,12,4,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="parchment"
        style={{
          background: '#f0e3c4',
          maxWidth: '40rem', width: '100%', maxHeight: '90vh',
          padding: '1rem',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 4px 16px rgba(20,12,4,0.5)',
          border: '1px solid rgba(74,44,20,0.4)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
          <div className="display" style={{ fontSize: '1em', color: '#5c1a08' }}>{title}</div>
          <div style={{ fontSize: '0.78em', color: '#6b4423', fontStyle: 'italic' }}>~{sizeKB} kB</div>
        </div>
        {filename && (
          <div style={{ fontSize: '0.78em', color: '#6b4423', fontStyle: 'italic', marginBottom: '0.4rem' }}>
            Suggested filename: <code style={{ fontFamily: 'monospace' }}>{filename}</code>
          </div>
        )}
        <p style={{ fontSize: '0.82em', color: '#4a3220', fontStyle: 'italic', marginTop: 0, marginBottom: '0.5rem' }}>
          {helperText || 'Copy this and save it where you keep your manuscripts. The artifact iframe cannot put files on disk for you.'}
        </p>
        <textarea
          ref={taRef}
          readOnly
          value={content}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={title || 'Manuscript export'}
          style={{
            flex: 1, minHeight: '12rem', width: '100%',
            fontFamily: 'monospace', fontSize: '0.72em',
            padding: '0.5rem',
            background: 'rgba(255,255,255,0.5)',
            border: '1px solid rgba(74,44,20,0.3)',
            color: '#2a1a0a',
            resize: 'vertical',
            whiteSpace: wrap ? 'pre-wrap' : 'pre',
            wordBreak: wrap ? 'break-word' : 'normal',
          }}
        />
        {flash && (
          <div className="ink-fade-in" style={{ marginTop: '0.5rem', padding: '0.4rem 0.7rem', background: 'rgba(92,26,8,0.08)', borderLeft: '2px solid #5c1a08', fontSize: '0.85em', color: '#5c1a08' }}>
            {flash}
          </div>
        )}
        <div style={{ marginTop: '0.7rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="ghost-button" onClick={copyAgain}>⎘ Copy to clipboard</button>
          <button className="wax-button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─────────── HEADER ───────────

// Small status indicator next to the menu button. Renders nothing if the
// charter is not synced. Tooltip on the badge shows the last sync time + ID.
function SyncBadge({ gs, sync }) {
  // Defensive: also guard on `sync` so a future caller that forgets to pass
  // it doesn't crash on `sync.status` access. With the factor-key model, any
  // charter with a playthroughId is being synced — there's no opt-out.
  if (!gs?.playthroughId || !sync) return null;

  const label =
    sync.status === 'pushing' ? 'syncing…' :
    sync.status === 'pulling' ? 'pulling…' :
    sync.status === 'offline' ? 'offline' :
    sync.status === 'error' ? 'sync error' :
    sync.status === 'conflict' ? 'conflict' :
    sync.sizeWarning ? 'synced — grows heavy' :
    'synced';

  const color =
    sync.status === 'offline' || sync.status === 'error' ? '#8b1a1a' :
    sync.status === 'conflict' ? '#5c1a08' :
    sync.sizeWarning && sync.status === 'idle' ? '#8b5a1a' :
    '#6b4423';

  const pointer = sync.pointer();
  const sizeNote = sync.sizeWarning
    ? '\nThe save approaches the sync limit — export a manuscript from the Menu as a keepsake.'
    : '';
  const tooltip = (pointer?.lastSyncAt
    ? `last sync: ${new Date(pointer.lastSyncAt).toLocaleString()}\nID: ${gs.playthroughId}`
    : `ID: ${gs.playthroughId || '—'}`) + sizeNote;

  return (
    <span title={tooltip} style={{
      fontFamily: 'EB Garamond, serif',
      fontStyle: 'italic',
      fontSize: '0.78em',
      color,
      marginRight: '0.5rem',
    }}>
      {label}
    </span>
  );
}

function Header({ gs, onReturnToTitle, onSuccession, onRenewal, viewportMode, sync, onOpenGallery, showCounsel, onToggleCounsel }) {
  const [confirmingSuccession, setConfirmingSuccession] = useState(false);
  const [successorName, setSuccessorName] = useState('');
  const [confirmingRenewal, setConfirmingRenewal] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [flash, setFlash] = useState('');
  const [exportPanel, setExportPanel] = useState(null); // { title, content, filename }
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubConfig, setGithubConfig] = useState(null);
  const [factorKeyOpen, setFactorKeyOpen] = useState(false);

  // Load GitHub config (if any) once on mount. The modal also re-reads it,
  // so this is just for menu-label hinting. Skipped when the feature is off.
  useEffect(() => {
    if (!ENABLE_GITHUB_BACKUP) return;
    let cancelled = false;
    (async () => {
      const cfg = await loadGithubConfig();
      if (!cancelled) setGithubConfig(cfg);
    })();
    return () => { cancelled = true; };
  }, []);

  const showFlash = (msg) => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 2200);
  };

  const showManuscript = () => {
    const data = JSON.stringify({ gs, phase: 'game', exportedAt: Date.now() }, null, 2);
    setExportPanel({
      title: 'Manuscript',
      content: data,
      filename: `factors-charter-day${gs.day}-${Date.now()}.json`,
    });
    setMenuOpen(false);
  };

  const showAiLog = () => {
    const log = gs.aiLog || [];
    const data = JSON.stringify({ player: gs.player.name, day: gs.day, count: log.length, aiLog: log }, null, 2);
    setExportPanel({
      title: `AI log (${log.length} entries)`,
      content: data,
      filename: `factors-charter-ai-log-day${gs.day}-${Date.now()}.json`,
    });
    setMenuOpen(false);
  };

  return (
    <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid rgba(74,44,20,0.3)', paddingBottom: '1rem', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="display" style={{ fontSize: '1.6em', color: '#5c1a08', margin: 0, lineHeight: 1.1 }}>
            {gs.player.name}, Factor at {gs.location}
          </h1>
          <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.1em', marginTop: '0.3rem' }}>
            DAY {gs.day} · £{gs.money} · HOLD {fmtCwt(cargoWeight(gs.goods))}/{cargoCap(gs)} ·{' '}
            {gs.charterClosed
              ? 'CHARTER CLOSED'
              : (
                <span style={gs.daysRemaining <= 90
                  ? { color: '#8b1a1a', fontWeight: 700 }
                  : (gs.daysRemaining <= 180 ? { color: '#8b1a1a' } : undefined)}>
                  {gs.daysRemaining} DAYS REMAIN
                </span>
              )}
          </div>
          <div className="display" style={{ fontSize: '0.78em', color: '#8a6a3f', letterSpacing: '0.08em', marginTop: '0.2rem' }}>
            {/* "Secured" = shipped to London PLUS lodged in the godown (which the
                Indiaman lifts whole at her next call). Counting lodged makes the
                quota number move the moment the player lodges — the payoff beat —
                while the win condition and the Court's reckoning still run on
                shipped alone (see the Ledger for the shipped/awaiting split). */}
            GODOWN {fmtCwt(warehouseUsed(gs))}/{warehouseCap(gs)} · FOR LONDON: PEPPER {Math.floor(gs.quotas?.pepper?.have || 0) + Math.floor(gs.outpost?.warehouse?.pepper || 0)}/{gs.quotas?.pepper?.needed ?? 400} · CINNAMON {Math.floor(gs.quotas?.cinnamon?.have || 0) + Math.floor(gs.outpost?.warehouse?.cinnamon || 0)}/{gs.quotas?.cinnamon?.needed ?? 200}
          </div>
        </div>
        <SyncBadge gs={gs} sync={sync} />
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Menu"
          style={{
            background: 'transparent', border: '1px solid #6b4423',
            color: '#5c1a08', padding: '0.4rem 0.7rem', cursor: 'pointer',
            fontFamily: '"IM Fell English SC", serif', letterSpacing: '0.06em',
            fontSize: '0.85em', minHeight: '36px', flexShrink: 0,
          }}
        >
          {menuOpen ? '✕' : '☰  Menu'}
        </button>
      </div>

      {flash && (
        <div className="ink-fade-in" style={{ marginTop: '0.5rem', padding: '0.4rem 0.7rem', background: 'rgba(92,26,8,0.08)', borderLeft: '2px solid #5c1a08', fontSize: '0.85em', color: '#5c1a08' }}>
          {flash}
        </div>
      )}

      {menuOpen && (
        <div
          className="parchment ink-fade-in"
          style={{
            position: 'absolute', top: '100%', right: 0, zIndex: 10,
            marginTop: '0.3rem', minWidth: '16rem', maxWidth: 'calc(100vw - 2rem)',
            background: '#f0e3c4', boxShadow: '0 2px 8px rgba(74,44,20,0.3)',
            padding: '0.6rem',
          }}
        >
          <div className="display" style={{ fontSize: '0.75em', color: '#6b4423', letterSpacing: '0.08em', padding: '0 0.3rem', marginBottom: '0.4rem' }}>
            ⁂ MANUSCRIPT
          </div>
          <button
            className="ghost-button"
            style={{ width: '100%', textAlign: 'left', marginBottom: '0.3rem' }}
            onClick={showManuscript}
          >
            ⎘ Show manuscript (JSON)
          </button>
          <button
            className="ghost-button"
            style={{ width: '100%', textAlign: 'left', marginBottom: '0.3rem' }}
            onClick={showAiLog}
            disabled={!gs.aiLog || gs.aiLog.length === 0}
          >
            ⎘ Show AI log ({(gs.aiLog || []).length})
          </button>
          {/*
            GitHub backup is intentionally disabled inside the Claude artifact
            runtime: the iframe's Content Security Policy blocks fetches to
            api.github.com (only api.anthropic.com is allowlisted), so the
            push always fails with TypeError "Failed to fetch". The
            GithubBackupModal, pushFileToGitHub, and loadGithubConfig
            helpers are left intact so this menu entry can be restored
            wholesale when the game runs outside Claude. To re-enable, set
            ENABLE_GITHUB_BACKUP to true.
          */}
          {ENABLE_GITHUB_BACKUP && (
            <button
              className="ghost-button"
              style={{ width: '100%', textAlign: 'left', marginBottom: '0.6rem' }}
              onClick={() => { setGithubOpen(true); setMenuOpen(false); }}
            >
              ↑ GitHub backup{githubConfig ? ` — ${githubConfig.owner}/${githubConfig.repo}` : ' (configure)'}
            </button>
          )}

          <div className="display" style={{ fontSize: '0.75em', color: '#6b4423', letterSpacing: '0.08em', padding: '0 0.3rem', marginBottom: '0.4rem' }}>
            ⁂ NAVIGATE
          </div>

          {gs.charterClosed && onRenewal && gs.charterClosed.outcome !== 'failure' && !confirmingRenewal && !confirmingSuccession && (
            <button
              className="wax-button"
              style={{ width: '100%', textAlign: 'left', marginBottom: '0.4rem' }}
              onClick={() => setConfirmingRenewal(true)}
            >
              Renew yr. charter — another three years
            </button>
          )}

          {gs.charterClosed && onRenewal && confirmingRenewal && (
            <div className="ink-fade-in" style={{
              padding: '0.8rem 0.9rem', marginBottom: '0.5rem',
              background: 'rgba(255,253,245,0.55)', borderLeft: '3px solid #5c1a08',
            }}>
              <div className="display" style={{ fontSize: '0.85em', color: '#5c1a08', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
                ⁂ RENEW THE CHARTER
              </div>
              <p style={{ fontStyle: 'italic', color: '#4a3220', fontSize: '0.86em', margin: '0 0 0.6rem 0' }}>
                The Court will renew yr. office for a further three years. The clock and the quota begin again at day 1; everything else &mdash; the godown, the {gs.ship?.name || 'ship'}, the household, yr. money, yr. standing &mdash; persists. The Court will style you Senior Factor henceforward.
              </p>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button
                  className="wax-button"
                  onClick={() => {
                    setConfirmingRenewal(false);
                    setMenuOpen(false);
                    onRenewal();
                  }}
                >
                  Take the second charter
                </button>
                <button
                  className="ghost-button"
                  onClick={() => setConfirmingRenewal(false)}
                >
                  Not yet
                </button>
              </div>
            </div>
          )}

          {gs.charterClosed && onSuccession && !confirmingSuccession && !confirmingRenewal && (
            <button
              className="ghost-button"
              style={{ width: '100%', textAlign: 'left', marginBottom: '0.4rem' }}
              onClick={() => { setConfirmingSuccession(true); setSuccessorName(''); }}
            >
              Take up the Charter — yr. successor
            </button>
          )}

          {gs.charterClosed && onSuccession && confirmingSuccession && (
            <div className="ink-fade-in" style={{
              padding: '0.8rem 0.9rem', marginBottom: '0.5rem',
              background: 'rgba(255,253,245,0.55)', borderLeft: '3px solid #5c1a08',
            }}>
              <div className="display" style={{ fontSize: '0.85em', color: '#5c1a08', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
                ⁂ INSCRIBE YR. SUCCESSOR'S NAME
              </div>
              <p style={{ fontStyle: 'italic', color: '#4a3220', fontSize: '0.86em', margin: '0 0 0.6rem 0' }}>
                The Court has appointed a new hand to follow {gs.player.name}. The world stands as he left it: the godown, the {gs.ship?.name || 'ship'}, the household, the standings with the powers. The strongbox is shorter by 40% (executors&rsquo; charge). Yr. own three years begin at day 1.
              </p>
              <input
                className="parchment-input"
                value={successorName}
                onChange={(e) => setSuccessorName(e.target.value)}
                placeholder="Yr. successor's name"
                aria-label="Successor's name"
                maxLength={32}
                style={{ width: '100%', marginBottom: '0.5rem', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button
                  className="wax-button"
                  disabled={!successorName.trim()}
                  onClick={() => {
                    const nm = successorName.trim();
                    setConfirmingSuccession(false);
                    setMenuOpen(false);
                    onSuccession(nm);
                  }}
                >
                  Begin the Charter
                </button>
                <button
                  className="ghost-button"
                  onClick={() => setConfirmingSuccession(false)}
                >
                  Not yet
                </button>
              </div>
            </div>
          )}

          <button
            className="ghost-button"
            style={{ width: '100%', textAlign: 'left', marginBottom: '0.3rem' }}
            onClick={() => {
              setFactorKeyOpen(true);
              setMenuOpen(false);
            }}
          >
            ⁂ Factor key (cross-device)
          </button>
          <button
            className="ghost-button"
            style={{ width: '100%', textAlign: 'left', marginBottom: '0.3rem' }}
            onClick={() => {
              onOpenGallery && onOpenGallery();
              setMenuOpen(false);
            }}
          >
            ✦ Image gallery{Array.isArray(gs?.illustrations) && gs.illustrations.filter(i => !i.deletedByPlayer).length > 0 ? ` (${gs.illustrations.filter(i => !i.deletedByPlayer).length})` : ''}
          </button>
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
          {onToggleCounsel && (
            <button
              className="ghost-button"
              style={{ width: '100%', textAlign: 'left', marginBottom: '0.3rem' }}
              onClick={() => { onToggleCounsel(); setMenuOpen(false); }}
            >
              {showCounsel ? '⚓ Hide strategic counsel' : '⚓ Show strategic counsel'}
            </button>
          )}
          <button
            className="ghost-button"
            style={{ width: '100%', textAlign: 'left', marginBottom: '0.3rem' }}
            onClick={() => { setMenuOpen(false); onReturnToTitle && onReturnToTitle(); }}
          >
            ← Return to Title screen
          </button>
          <div style={{ fontSize: '0.78em', color: '#6b4423', fontStyle: 'italic', padding: '0.3rem', marginTop: '0.3rem' }}>
            Your charter auto-saves. From the title screen you can continue, begin anew, or restore from a manuscript.
          </div>
        </div>
      )}

      {exportPanel && (
        <ExportModal
          title={exportPanel.title}
          content={exportPanel.content}
          filename={exportPanel.filename}
          onClose={() => setExportPanel(null)}
        />
      )}

      {githubOpen && (
        <GithubBackupModal
          gs={gs}
          initialConfig={githubConfig}
          onClose={async () => {
            setGithubOpen(false);
            // Reload from storage in case the modal saved a new config.
            const cfg = await loadGithubConfig();
            setGithubConfig(cfg);
          }}
        />
      )}

      {factorKeyOpen && (
        <FactorKeyModal
          onClose={() => setFactorKeyOpen(false)}
          onChange={() => {
            // Key swapped — surface a brief confirmation. The next visit to
            // the title screen will pull the new key's charter list.
            setFlash('Factor key updated. Charters under the new key will appear on the title screen.');
            setTimeout(() => setFlash(''), 3500);
          }}
        />
      )}
    </div>
  );
}

// ─────────── TABS ───────────

function Tabs({ tab, setTab, unread, atHome, viewportMode }) {
  const tabs = viewportMode === 'desktop'
    ? [
        { key: 'journal',  label: 'Journal' },
        { key: 'overview', label: 'Overview' },
        { key: 'port',     label: 'In Port' },
        ...(atHome ? [{ key: 'outpost', label: 'Outpost' }] : []),
        { key: 'letters',  label: `Letters${unread ? ` (${unread})` : ''}` },
      ]
    : [
        { key: 'journal',  label: 'Journal' },
        { key: 'ledger',   label: 'Ledger' },
        { key: 'map',      label: 'Voyage' },
        { key: 'port',     label: 'In Port' },
        ...(atHome ? [{ key: 'outpost', label: 'Outpost' }] : []),
        { key: 'letters',  label: `Letters${unread ? ` (${unread})` : ''}` },
      ];
  // The tab row scrolls horizontally with its scrollbar hidden — on a narrow
  // phone nothing signals that more tabs sit off-screen. A right-edge fade
  // shows while there is further to scroll and clears at the end.
  const rowRef = useRef(null);
  const [moreRight, setMoreRight] = useState(false);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const update = () => setMoreRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 8);
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [viewportMode, atHome, unread]);
  return (
    <div style={{ position: 'relative' }}>
      <div className="tab-row" ref={rowRef}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`tab-button ${tab === t.key ? 'active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {moreRight && (
        <div aria-hidden style={{
          position: 'absolute', top: 0, right: 0, bottom: '1px', width: '28px',
          pointerEvents: 'none',
          background: 'linear-gradient(to left, rgba(216,196,150,0.95), rgba(216,196,150,0))',
        }} />
      )}
    </div>
  );
}

// ─────────── JOURNAL VIEW ───────────

// Build the winCounsel projection from gs: quota progress (secured = shipped +
// lodged), the Indiaman countdown, money, and which engine pieces are in hand.
function buildCounselState(gs) {
  const pepperSecured   = Math.floor((gs.quotas?.pepper?.have   || 0) + (gs.outpost?.warehouse?.pepper   || 0));
  const cinnamonSecured = Math.floor((gs.quotas?.cinnamon?.have || 0) + (gs.outpost?.warehouse?.cinnamon || 0));
  const visits = gs.indiaman?.visits || 0;
  const indiamanInDays = (visits < INDIAMAN_TOTAL && typeof gs.indiaman?.nextDay === 'number')
    ? Math.max(0, gs.indiaman.nextDay - (gs.day || 0))
    : null;
  const ownTeak = gs.flags?.teakConcession === 'self';
  return {
    daysRemaining: gs.daysRemaining || 0,
    charterLength: 1095,
    pepperSecured, pepperNeeded: gs.quotas?.pepper?.needed || 400,
    cinnamonSecured, cinnamonNeeded: gs.quotas?.cinnamon?.needed || 200,
    indiamanInDays,
    money: gs.money || 0,
    hasBrigantine: gs.ship?.type === 'brigantine',
    hasShipyard: !!gs.outpost?.buildings?.shipwright?.built,
    hasPepperGarden: !!gs.ventures?.pepper_garden?.established,
    hasSpiceEstate: !!gs.ventures?.spice_estate?.established,
    hasPlantation: !!gs.outpost?.buildings?.plantation?.built,
    plantationEligible: (gs.reputation?.rajah || 0) >= 10,
    pepperGardenCost: VENTURES.pepper_garden?.cost || 700,
    spiceEstateCost: VENTURES.spice_estate?.cost || 1300,
    brigCost: ownTeak ? 600 : 900,
  };
}

// Render a winCounsel() result into the Factor's own first-person strategic voice.
function counselLine(c) {
  if (!c) return null;
  switch (c.kind) {
    case 'won':
      return 'The charter’s measure is met. Lodge the last of it and let the Indiaman bring you home — what I build now is my own.';
    case 'behind':
      return `Time runs short and the reckoning lags. I must crowd on what sail I have for ${c.focus}, and lodge every hundredweight before the last Indiaman calls.`;
    case 'brigantine':
      return c.hasShipyard
        ? 'The pinnace’s sixty hundredweight is the wall I keep striking. Commission the brigantine — thrice the hold, and every run worth three.'
        : 'The pinnace’s sixty hundredweight is the wall I keep striking. Raise the Shipwright’s Yard, then a brigantine — thrice the hold.';
    case 'pepper-garden':
      return 'The quota is won by spice that lodges itself. A pepper garden of my own would fill the godown while I sail — better spent than on another bought cargo.';
    case 'spice-estate':
      return 'Cinnamon is my shortfall, and it comes cheap from one port only. The Spice Estate would lodge it season on season — the surest answer to it.';
    case 'plantation':
      return 'The Rajah’s favour will let me clear a plantation — five hundredweight of pepper a month, lodged for nothing. Worth the raising.';
    case 'capital':
      return 'My purse is too thin to build. The plain course: carry pepper from Kota Pinang to Eustace or Marlborough for coin, and lay it by toward a brigantine and a garden of my own.';
    case 'cinnamon-runs':
      return 'The pepper comes on; the cinnamon lags. Kota Pinang is its only cheap source, and a thin one — I must call there often and take all the Sultan’s sheds will give.';
    case 'steady':
      return typeof c.indiamanInDays === 'number'
        ? `The works are in hand and the godown filling. Keep lodging pepper and cinnamon against the Indiaman — she calls in ${c.indiamanInDays} day${c.indiamanInDays === 1 ? '' : 's'}.`
        : 'The works are in hand and the godown filling. Keep lodging pepper and cinnamon for London.';
    default:
      return null;
  }
}

function JournalView({ gs, arrivalProse, setTab, openLetterById, pursueThread, viewportMode, showCounsel }) {
  const entries = [...gs.journal].reverse().slice(0, 20);
  const unread = gs.letters.filter(l => !l.read);
  const latestLetter = gs.letters.length > 0 ? gs.letters[gs.letters.length - 1] : null;
  const hasUnread = unread.length > 0;
  // Letter to open when the card is tapped: the first unread, otherwise the most recent.
  const targetLetter = hasUnread ? unread[0] : latestLetter;
  const handleCardOpen = () => {
    if (targetLetter && openLetterById) {
      openLetterById(targetLetter.id);
    } else if (setTab) {
      setTab('letters');
    }
  };
  return (
    <div>
      <h2 className="display" style={{ fontSize: '1.4em', color: '#5c1a08', marginTop: 0 }}>The Private Journal</h2>

      {latestLetter && (
        <div
          className="parchment ink-fade-in"
          onClick={handleCardOpen}
          style={{
            padding: '1rem 1.1rem', marginBottom: '1.5rem', cursor: 'pointer',
            background: hasUnread ? 'rgba(255,250,235,0.65)' : 'rgba(255,255,255,0.25)',
            borderLeft: hasUnread ? '4px solid #5c1a08' : '2px solid rgba(74,44,20,0.4)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: '0.7rem', flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="display" style={{ fontSize: '0.85em', color: hasUnread ? '#5c1a08' : '#6b4423', letterSpacing: '0.1em' }}>
              {hasUnread
                ? `⁕ ${unread.length === 1 ? 'A LETTER AWAITS' : `${unread.length} LETTERS AWAIT`}`
                : '⁂ LATEST CORRESPONDENCE'}
            </div>
            <div style={{ marginTop: '0.3rem', fontStyle: 'italic', color: '#4a3220' }}>
              {hasUnread && unread.length > 1
                ? `${unread.length} letters in your hand, the first from ${unread[0].from}.`
                : `${(hasUnread ? unread[0] : latestLetter).from} — ${(hasUnread ? unread[0] : latestLetter).subject}`}
            </div>
          </div>
          <button
            className={hasUnread ? 'wax-button' : 'ghost-button'}
            onClick={(e) => { e.stopPropagation(); handleCardOpen(); }}
          >
            {hasUnread ? 'Read' : 'Re-read'}
          </button>
        </div>
      )}

      {showCounsel && !gs.charterClosed && (() => {
        const line = counselLine(winCounsel(buildCounselState(gs)));
        if (!line) return null;
        return (
          <div className="ink-fade-in" style={{ marginBottom: '1.5rem', padding: '0.6rem 0.9rem', borderLeft: '3px solid rgba(92,26,8,0.55)', background: 'rgba(255,255,255,0.18)' }}>
            <div className="display" style={{ fontSize: '0.78em', color: '#6b4423', letterSpacing: '0.12em', marginBottom: '0.15rem' }}>⚓ COUNSEL</div>
            <div className="italic" style={{ color: '#4a3220', fontSize: '0.95em' }}>{line}</div>
          </div>
        );
      })()}

      {pursueThread && <OpportunitiesPanel gs={gs} pursueThread={pursueThread} />}

      {arrivalProse && arrivalProse.port === gs.location && (
        viewportMode === 'desktop' ? (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 480px', gap: '1rem', alignItems: 'start' }}>
              <div style={{ padding: '1rem', borderLeft: '3px solid #5c1a08', background: 'rgba(255,255,255,0.3)' }}>
                <div className="display" style={{ fontSize: '0.8em', color: '#6b4423' }}>UPON ARRIVAL AT {gs.location.toUpperCase()}</div>
                <p className="italic" style={{ marginTop: '0.5rem', marginBottom: 0 }}>{arrivalProse.prose}</p>
                <ImagePlate plate={pickPlate(arrivalProse.prose)} />
                <ImaginePanel prose={arrivalProse.prose} label="Imagine the harbour" />
              </div>
              <InlineIllustration prose={arrivalProse.prose} />
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: '1.5rem', padding: '1rem', borderLeft: '3px solid #5c1a08', background: 'rgba(255,255,255,0.3)' }}>
            <div className="display" style={{ fontSize: '0.8em', color: '#6b4423' }}>UPON ARRIVAL AT {gs.location.toUpperCase()}</div>
            <p className="italic" style={{ marginTop: '0.5rem', marginBottom: 0 }}>{arrivalProse.prose}</p>
            <ImagePlate plate={pickPlate(arrivalProse.prose)} />
            <ImaginePanel prose={arrivalProse.prose} label="Imagine the harbour" />
          </div>
        )
      )}

      {entries.length === 0 ? (
        <p className="italic" style={{ color: '#6b4423' }}>The pages are blank. Begin.</p>
      ) : (
        <div>
          {entries.map((e, i) => (
            <div key={i} style={{ marginBottom: '0.7rem', display: 'flex', gap: '1rem' }}>
              <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', minWidth: '4rem' }}>Day {e.day}</div>
              {e.milestone ? (
                <div style={{
                  borderLeft: '3px solid #5c1a08', paddingLeft: '0.7rem',
                  fontStyle: 'italic', color: '#4a3220',
                }}>
                  <span className="display" style={{ color: '#5c1a08', marginRight: '0.3rem' }}>⁂</span>{e.entry}
                </div>
              ) : (
                <div>{e.entry}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// OPPORTUNITIES — authored leads worth acting on (a wreck to salvage, a market
// tip). Prominent, near the top of the hub so they're noticed. Pursuing one
// opens a hand-written decision with differentiated outcomes — NOT a gamble.
function OpportunitiesPanel({ gs, pursueThread }) {
  if (gs.charterClosed || !pursueThread) return null;
  const opps = (gs.hooks || []).filter(h => findPursueLead(h));
  if (opps.length === 0) return null;
  return (
    <div className="ink-fade-in" style={{ marginBottom: '1.5rem' }}>
      <div className="display" style={{ fontSize: '0.82em', color: '#5c1a08', letterSpacing: '0.1em', marginBottom: '0.15rem' }}>
        {opps.length === 1 ? '⁕ AN OPPORTUNITY' : `⁕ ${opps.length} OPPORTUNITIES`}
      </div>
      <p className="italic" style={{ fontSize: '0.84em', color: '#6b4423', margin: '0 0 0.6rem 0' }}>
        A lead worth acting on. Taking it up costs a day or two, and what comes of it turns on what you decide.
      </p>
      {opps.map((h, i) => (
        <div key={i} className="parchment" style={{ padding: '0.8rem 1rem', marginBottom: '0.5rem', background: 'rgba(255,250,235,0.6)', borderLeft: '3px solid #5c1a08' }}>
          <div className="italic" style={{ color: '#4a3220', marginBottom: '0.6rem' }}>{h}</div>
          <button className="wax-button" onClick={() => pursueThread(h)}>Take it up</button>
        </div>
      ))}
    </div>
  );
}

// ─────────── LEDGER VIEW ───────────

function LedgerView({ gs }) {
  const goodsList = Object.entries(gs.goods).filter(([,v]) => v > 0);
  const ship = gs.ship || { name: 'The Pinnace', type: 'pinnace', holdCwt: 60, hull: 100, sails: 100 };
  const used = cargoWeight(gs.goods);
  const cap = cargoCap(gs);

  const stateBar = (label, value, color = '#5c1a08') => (
    <div style={{ marginBottom: '0.35rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', color: '#4a3220' }}>
        <span>{label}</span><span className="display" style={{ fontSize: '0.85em' }}>{value}</span>
      </div>
      <div style={{ height: '4px', background: 'rgba(74,44,20,0.15)', borderRadius: '2px', marginTop: '2px' }}>
        <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', background: color, borderRadius: '2px' }} />
      </div>
    </div>
  );

  return (
    <div>
      <h2 className="display" style={{ fontSize: '1.4em', color: '#5c1a08', marginTop: 0 }}>The Ledger</h2>

      <div className="parchment" style={{ padding: '0.9rem 1rem', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.3)' }}>
        <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.4rem', letterSpacing: '0.06em' }}>THE {ship.name.toUpperCase()}</div>
        <div style={{ fontSize: '0.88em', color: '#4a3220', fontStyle: 'italic', marginBottom: '0.5rem' }}>
          {SHIP_TYPES[ship.type]?.blurb || ''}
        </div>
        <div style={{ marginBottom: '0.35rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', color: '#4a3220' }}>
            <span>Cargo</span><span className="display" style={{ fontSize: '0.85em' }}>{fmtCwt(used)} / {cap} cwt</span>
          </div>
          <div style={{ height: '4px', background: 'rgba(74,44,20,0.15)', borderRadius: '2px', marginTop: '2px' }}>
            <div style={{ width: `${Math.min(100, (used / cap) * 100)}%`, height: '100%', background: used >= cap ? '#8b1a1a' : '#5c1a08', borderRadius: '2px' }} />
          </div>
        </div>
        {stateBar('Hull',  ship.hull,  ship.hull  < MIN_HULL_COND ? '#8b1a1a' : '#5c1a08')}
        {stateBar('Sails', ship.sails, ship.sails < MIN_SAIL_COND ? '#8b1a1a' : '#5c1a08')}
        {(ship.hull < MIN_HULL_COND || ship.sails < MIN_SAIL_COND) && (
          <div style={{ fontSize: '0.82em', color: '#8b1a1a', fontStyle: 'italic', marginTop: '0.3rem' }}>
            Unfit for sea. Refit at the slipway in Bayan-Kor.
          </div>
        )}
      </div>

      <div className="cols-2">
        <div>
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.5rem' }}>IN THE HOLD</div>
          {goodsList.length === 0 ? (
            <p className="italic">The hold is empty.</p>
          ) : (
            <table style={{ width: '100%', fontSize: '0.95em' }}>
              <tbody>
                {goodsList.map(([k, v]) => (
                  <tr key={k}>
                    <td>{COMMODITIES[k].name}</td>
                    <td style={{ textAlign: 'right' }}>{v} {COMMODITIES[k].unit}{v !== 1 ? 's' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(() => {
            const ware = gs.outpost?.warehouse || {};
            const wareList = Object.entries(ware).filter(([,v]) => Math.floor(v) > 0);
            const cap = warehouseCap(gs);
            const used = warehouseUsed(gs);
            return (
              <>
                <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginTop: '1.5rem', marginBottom: '0.5rem' }}>
                  GODOWN ({fmtCwt(used)} / {cap} cwt)
                </div>
                {wareList.length === 0 ? (
                  <p className="italic">The godown is empty.</p>
                ) : (
                  <table style={{ width: '100%', fontSize: '0.95em' }}>
                    <tbody>
                      {wareList.map(([k, v]) => (
                        <tr key={k}>
                          <td>{COMMODITIES[k].name}</td>
                          <td style={{ textAlign: 'right' }}>{Math.floor(v)} {COMMODITIES[k].unit}{Math.floor(v) !== 1 ? 's' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            );
          })()}
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginTop: '1.5rem', marginBottom: '0.5rem' }}>QUOTAS (TO LONDON)</div>
          <table style={{ width: '100%', fontSize: '0.95em' }}>
            <tbody>
              {Object.entries(gs.quotas).map(([k, q]) => {
                const shipped = Math.floor(q.have || 0);
                const lodged  = Math.floor(gs.outpost?.warehouse?.[k] || 0);
                return (
                  <tr key={k}>
                    <td>{COMMODITIES[k].name}</td>
                    <td style={{ textAlign: 'right' }}>
                      {shipped} / {q.needed} {COMMODITIES[k].unit}
                      {lodged > 0 && (
                        <span style={{ fontSize: '0.82em', color: '#6b4423', fontStyle: 'italic' }}>
                          {' · '}{lodged} awaiting
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(() => {
            const i = gs.indiaman || {};
            const visitsLeft = INDIAMAN_TOTAL - (i.visits || 0);
            if (visitsLeft <= 0) {
              return (
                <div style={{ fontSize: '0.82em', color: '#6b4423', fontStyle: 'italic', marginTop: '0.4rem' }}>
                  No further calls expected. The reckoning is closed.
                </div>
              );
            }
            const dueIn = Math.max(0, (i.nextDay || 0) - gs.day);
            return (
              <div style={{ fontSize: '0.82em', color: '#6b4423', fontStyle: 'italic', marginTop: '0.4rem' }}>
                Next Indiaman expected in {dueIn} day{dueIn !== 1 ? 's' : ''}. {visitsLeft} call{visitsLeft !== 1 ? 's' : ''} remain.
              </div>
            );
          })()}
          {gs.privateConsignment && (
            <div style={{ marginTop: '0.7rem', padding: '0.5rem 0.7rem', background: 'rgba(255,255,255,0.3)', borderLeft: '2px solid #5c1a08', fontSize: '0.85em' }}>
              <div className="display" style={{ fontSize: '0.78em', color: '#6b4423', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>PRIVATE CONSIGNMENT IN FLIGHT</div>
              <div style={{ color: '#4a3220', fontStyle: 'italic' }}>
                {Object.entries(gs.privateConsignment.commodities)
                  .filter(([,v]) => v > 0)
                  .map(([k,v]) => `${v} cwt ${COMMODITIES[k].name.toLowerCase()}`)
                  .join('; ')}
                {' '}— ~£{gs.privateConsignment.expectedPayout} expected by the next Indiaman.
              </div>
            </div>
          )}
        </div>
        <div>
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.5rem' }}>STANDING WITH POWERS</div>
          <table style={{ width: '100%', fontSize: '0.95em' }}>
            <tbody>
              {Object.entries(gs.reputation).map(([k, v]) => (
                <tr key={k}>
                  <td>{FACTIONS[k].name}</td>
                  <td style={{ textAlign: 'right', color: v > 0 ? '#3a5c2a' : v < 0 ? '#8b1a1a' : '#6b4423' }}>
                    {v > 0 ? '+' : ''}{v} <span style={{ fontSize: '0.85em', fontStyle: 'italic', color: '#6b4423' }}>({repTone(v)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(() => {
            const rows = reckonRows(gs.tradeStats);
            if (rows.length === 0) return null;
            const total = reckonTotal(gs.tradeStats);
            const fmtAvg = (v) => (v === null ? '—' : `£${Math.round(v * 10) / 10}`);
            const tone = (n) => (n > 0 ? '#3a5c2a' : n < 0 ? '#8b1a1a' : '#6b4423');
            return (
              <div style={{ marginTop: '1.5rem' }}>
                <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.5rem' }}>THE TRADE RECKONING</div>
                {rows.map(r => (
                  <div key={r.commodity} style={{ marginBottom: '0.45rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95em' }}>
                      <span>{COMMODITIES[r.commodity]?.name || r.commodity}</span>
                      <span style={{ color: tone(r.realized) }}>{r.realized > 0 ? '+' : ''}£{r.realized}</span>
                    </div>
                    <div style={{ fontSize: '0.78em', color: '#6b4423', fontStyle: 'italic' }}>
                      {r.boughtQty > 0 ? `bought ${r.boughtQty} at ${fmtAvg(r.avgBuy)} ea.` : 'got without purchase'}
                      {r.soldQty > 0 ? ` · sold ${r.soldQty} at ${fmtAvg(r.avgSell)} ea.` : ' · none yet sold'}
                    </div>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid rgba(74,44,20,0.3)', paddingTop: '0.35rem', marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.95em' }}>
                  <span className="display" style={{ fontSize: '0.82em', color: '#6b4423' }}>NET OF ALL DEALINGS</span>
                  <span style={{ color: tone(total), fontWeight: 600 }}>{total > 0 ? '+' : ''}£{total}</span>
                </div>
                <div style={{ fontSize: '0.72em', color: '#8b7050', fontStyle: 'italic', marginTop: '0.3rem' }}>
                  Duty reckoned against the margin. Goods got without purchase count at their full proceeds.
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {Array.isArray(gs.acquaintances) && gs.acquaintances.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.7rem' }}>ACQUAINTANCES ABROAD</div>
          <div className="cols-2">
            {gs.acquaintances.slice().reverse().slice(0, 8).map((a) => (
              <div key={a.id} className="parchment" style={{ padding: '0.7rem 0.9rem', background: 'rgba(255,255,255,0.25)' }}>
                <div className="display" style={{ fontSize: '1em', color: '#5c1a08' }}>{a.name}</div>
                <div style={{ fontSize: '0.82em', color: '#6b4423', fontStyle: 'italic' }}>
                  {a.role}{a.location ? ` · ${a.location}` : ''}
                </div>
                {a.notes && (
                  <div style={{ fontSize: '0.85em', color: '#4a3220', fontStyle: 'italic', marginTop: '0.3rem' }}>{a.notes}</div>
                )}
                <div style={{ fontSize: '0.75em', color: '#8b7050', marginTop: '0.3rem' }}>
                  Met day {a.introduced}{a.lastSeen !== a.introduced ? `, last seen day ${a.lastSeen}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(() => {
        const items = commitmentsFor(gs);
        if (items.length === 0) return null;
        return (
          <div style={{ marginTop: '1rem' }}>
            <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.4rem' }}>STANDING ARRANGEMENTS</div>
            <div style={{ fontSize: '0.92em', color: '#4a3220' }}>
              {items.map(it => (
                <div key={it.key} className="italic" style={{ marginBottom: '0.25rem' }}>{it.line}</div>
              ))}
            </div>
          </div>
        );
      })()}

      {(() => {
        const w = enterpriseWorth(gs);
        return (
          <div style={{ marginTop: '1.5rem' }}>
            <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.4rem' }}>THE WHOLE CONCERN</div>
            <div className="parchment" style={{ padding: '0.8rem 1rem', background: 'rgba(255,255,255,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
                <span className="display" style={{ color: '#5c1a08' }}>Estimated worth</span>
                <span className="display" style={{ color: '#5c1a08', fontSize: '1.15em' }}>£{w.total.toLocaleString()}</span>
              </div>
              <div style={{ fontSize: '0.82em', color: '#6b4423', fontStyle: 'italic' }}>
                Strongbox £{w.money.toLocaleString()} · godown £{w.godown.toLocaleString()} · buildings £{w.buildings.toLocaleString()} · ship £{w.ship.toLocaleString()} · ventures £{w.ventures.toLocaleString()}
              </div>
            </div>
          </div>
        );
      })()}

      <div style={{ marginTop: '2rem' }}>
        <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.7rem' }}>THE HOUSEHOLD</div>
        <div className="cols-2">
          {Object.entries(gs.npcs).map(([key, n]) => (
            <div key={key} className="parchment" style={{ padding: '0.9rem', background: 'rgba(255,255,255,0.25)' }}>
              <div className="display" style={{ fontSize: '1.05em', color: '#5c1a08' }}>{n.name}</div>
              <div style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.5rem', fontStyle: 'italic' }}>{n.role}</div>
              {key === 'hodge' && <>
                {gs.flags?.hodgeCrisis === 'sent_home' ? (
                  <div className="italic" style={{ color: '#6b4423', fontSize: '0.88em' }}>
                    Sent home to Bristol. Mr. Tyler holds the desk now.
                  </div>
                ) : (
                  <>
                    {stateBar('Sobriety', n.sobriety, n.sobriety < 30 ? '#8b1a1a' : '#5c1a08')}
                    {stateBar('Loyalty', n.loyalty)}
                    {gs.flags?.hodgeCrisis === 'reformed' && (
                      <div className="italic" style={{ color: '#3a5c2a', fontSize: '0.82em', marginTop: '0.2rem' }}>
                        — under the Reverend’s temperance.
                      </div>
                    )}
                    {gs.flags?.hodgeCrisis === 'junior_hired' && (
                      <div className="italic" style={{ color: '#6b4423', fontSize: '0.82em', marginTop: '0.2rem' }}>
                        — Mr. Coombe shares the work.
                      </div>
                    )}
                  </>
                )}
              </>}
              {key === 'dass' && <>
                {gs.flags?.dassRecall === 'released' ? (
                  <div className="italic" style={{ color: '#6b4423', fontSize: '0.88em' }}>
                    Returned to Madras. Lance Naik Anandan holds the watch now.
                  </div>
                ) : (
                  <>
                    {stateBar('Loyalty', n.loyalty)}
                    {stateBar('Morale', n.morale)}
                    {stateBar('Health', n.health)}
                    {gs.flags?.dassRecall === 'commissioned' && (
                      <div className="italic" style={{ color: '#3a5c2a', fontSize: '0.82em', marginTop: '0.2rem' }}>
                        — commissioned in the Rajah’s guard.
                      </div>
                    )}
                    {gs.flags?.dassRecall === 'paid' && (
                      <div className="italic" style={{ color: '#6b4423', fontSize: '0.82em', marginTop: '0.2rem' }}>
                        — recall bought off, by yr. £50.
                      </div>
                    )}
                  </>
                )}
              </>}
              {key === 'vizier' && <>
                {stateBar('Friendliness', n.friendliness)}
                {n.scheming > 0 && stateBar('Scheming', n.scheming, '#8b1a1a')}
              </>}
              <div style={{ fontSize: '0.85em', color: '#4a3220', fontStyle: 'italic', marginTop: '0.5rem' }}>{n.note}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────── MAP VIEW ───────────

function MapView({ gs, sailTo }) {
  // Ports with a `requiresVisited` gate stay off the chart until the
  // prerequisite port has been put into. Preserves the atmosphere of a
  // place "shown on no chart" until someone tells you about it.
  const ports = Object.entries(PORTS).filter(([k, p]) => {
    if (k === gs.location) return false;
    if (p.requiresVisited && !gs.visited?.includes(p.requiresVisited)) return false;
    return true;
  });
  const ship = gs.ship || { hull: 100, sails: 100 };
  const tooDamaged = ship.hull < MIN_HULL_COND || ship.sails < MIN_SAIL_COND;

  // Helpers to label relative advantage from the static port multipliers
  const advantageTag = (mult, kind) => {
    if (kind === 'sell') {
      // port sells to you — lower mult = better for buyer
      if (mult <= 0.7) return { label: 'cheap', color: '#3a5c2a' };
      if (mult <= 0.85) return { label: 'fair', color: '#6b4423' };
      return { label: 'dear', color: '#8b1a1a' };
    } else {
      // port buys from you — higher mult = better for seller
      if (mult >= 1.4) return { label: 'premium', color: '#3a5c2a' };
      if (mult >= 1.2) return { label: 'good', color: '#6b4423' };
      return { label: 'modest', color: '#8b1a1a' };
    }
  };

  return (
    <div>
      <h2 className="display" style={{ fontSize: '1.4em', color: '#5c1a08', marginTop: 0 }}>The Chart</h2>
      <p className="italic" style={{ color: '#4a3220', marginBottom: '1.5rem' }}>
        You are at <strong>{gs.location}</strong>. Where shall the pinnace lie next?
      </p>
      {gs.location === 'Bayan-Kor' && (() => {
        const p = raidPosture(gs);
        if (p.tempting.length === 0 || p.stockade || p.barracks) return null;
        return (
          <p className="italic" style={{ color: '#6b4423', fontSize: '0.88em', marginTop: '-0.8rem', marginBottom: '1.2rem' }}>
            The godown will lie under light watch while you are at sea; what it holds may draw thieves.
            A stockade would ease the matter.
          </p>
        );
      })()}
      {tooDamaged && (
        <div style={{ padding: '0.7rem 0.9rem', background: 'rgba(139,26,26,0.08)', borderLeft: '3px solid #8b1a1a', marginBottom: '1.2rem' }}>
          <p className="italic" style={{ margin: 0, color: '#8b1a1a', fontSize: '0.92em' }}>
            The {ship.name || 'pinnace'} is in no state to put to sea. Refit at the slipway in Bayan-Kor before sailing further.
          </p>
        </div>
      )}
      <div>
        {ports.map(([k, p]) => {
          const blocked = p.requiresRep && Object.entries(p.requiresRep).some(([f, n]) => gs.reputation[f] < n);
          const eustaceBannedUntil = gs.flags?.banned_eustace_until ?? 0;
          const eustaceBanned = (k === 'Port St. Eustace') && eustaceBannedUntil > gs.day;
          const visited = gs.visited.includes(k);
          const sells = Object.entries(p.sells || {});
          const buys = Object.entries(p.buys || {});
          return (
            <div key={k} className="parchment" style={{ padding: '1rem', marginBottom: '1rem', background: 'rgba(255,255,255,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <div className="display" style={{ fontSize: '1.15em', color: '#5c1a08' }}>{p.name}</div>
                  <div className="italic" style={{ fontSize: '0.95em', color: '#4a3220' }}>{p.blurb}</div>
                  <div style={{ fontSize: '0.85em', color: '#6b4423', marginTop: '0.3rem' }}>
                    {p.daysFromHome} days from Bayan-Kor · {FACTIONS[p.faction].short} ground
                    {p.rivalRisk && ' · rival ground'}
                    {!visited && ' · unvisited'}
                  </div>
                </div>
                <button
                  className="wax-button"
                  disabled={blocked || tooDamaged || eustaceBanned}
                  onClick={() => sailTo(k)}
                >
                  {eustaceBanned ? 'Closed to You' : blocked ? 'Not Welcome' : tooDamaged ? 'Ship Unfit' : 'Sail Here'}
                </button>
              </div>
              {blocked && (
                <div className="italic" style={{ fontSize: '0.85em', color: '#8b1a1a', marginTop: '0.5rem' }}>
                  &mdash; Requires standing with {Object.entries(p.requiresRep).map(([f]) => FACTIONS[f].short).join(', ')}.
                </div>
              )}
              {eustaceBanned && (
                <div className="italic" style={{ fontSize: '0.85em', color: '#8b1a1a', marginTop: '0.5rem' }}>
                  &mdash; Eustace is closed to yr. brigantine until day {eustaceBannedUntil}.
                </div>
              )}

              {visited && (sells.length > 0 || buys.length > 0) && (
                <div style={{ marginTop: '0.8rem', paddingTop: '0.7rem', borderTop: '1px dashed rgba(74,44,20,0.25)' }}>
                  <div className="display" style={{ fontSize: '0.78em', color: '#6b4423', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
                    NOTED IN YOUR LEDGER
                  </div>
                  <div className="cols-2" style={{ gap: '0.8rem', fontSize: '0.88em' }}>
                    {sells.length > 0 && (
                      <div>
                        <div style={{ fontStyle: 'italic', color: '#6b4423', marginBottom: '0.2rem' }}>they sell</div>
                        {sells.map(([c, mult]) => {
                          const tag = advantageTag(mult, 'sell');
                          const price = priceFor(k, c, gs.day, gs);
                          const stock = Math.floor(gs.portStocks?.[k]?.[c] ?? 0);
                          const cap = p.stockMax?.[c] ?? 0;
                          const stockLabel = stock === 0 ? 'none' : stock < cap * 0.25 ? `${stock} (low)` : `${stock}`;
                          return (
                            <div key={c} style={{ marginBottom: '0.15rem' }}>
                              {COMMODITIES[c].name} <span style={{ color: '#6b4423' }}>£{price}</span>{' '}
                              <span style={{ color: tag.color, fontStyle: 'italic', fontSize: '0.85em' }}>({tag.label})</span>{' '}
                              <span style={{ color: stock === 0 ? '#8b1a1a' : '#6b4423', fontSize: '0.85em' }}>· stock {stockLabel}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {buys.length > 0 && (
                      <div>
                        <div style={{ fontStyle: 'italic', color: '#6b4423', marginBottom: '0.2rem' }}>they buy</div>
                        {buys.map(([c, mult]) => {
                          const tag = advantageTag(mult, 'buy');
                          const price = priceFor(k, c, gs.day, gs);
                          return (
                            <div key={c} style={{ marginBottom: '0.15rem' }}>
                              {COMMODITIES[c].name} <span style={{ color: '#6b4423' }}>£{price}</span>{' '}
                              <span style={{ color: tag.color, fontStyle: 'italic', fontSize: '0.85em' }}>({tag.label})</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="italic" style={{ fontSize: '0.78em', color: '#6b4423', marginTop: '0.4rem' }}>
                    Prices as of today; the wharf shifts daily.
                  </div>
                </div>
              )}
              {!visited && !blocked && (
                <div className="italic" style={{ fontSize: '0.82em', color: '#6b4423', marginTop: '0.5rem' }}>
                  &mdash; You have not put in here. Their goods are unknown to you.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────── DESKTOP OVERVIEW (Map + Ledger side-by-side) ───────────

function DesktopOverview({ gs, sailTo }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
      <div>
        <MapView gs={gs} sailTo={sailTo} />
      </div>
      <div>
        <LedgerView gs={gs} />
      </div>
    </div>
  );
}

// ─────────── PORT VIEW ───────────

function PortView({ gs, buyGood, sellGood, refitShip, arrivalProse, setTab, lodgeGoods, withdrawGoods, commissionBrigantine, takeBottomry, liftContractOpium, runDutchCustoms, viewportMode }) {
  const port = PORTS[gs.location];
  const sells = Object.keys(port.sells || {});
  const buys = Object.keys(port.buys || {});
  const stocks = gs.portStocks?.[gs.location] || {};
  const cap = cargoCap(gs);
  const used = cargoWeight(gs.goods);
  const remaining = Math.max(0, cap - used);
  const ship = gs.ship || { name: 'The Pinnace', hull: 100, sails: 100 };

  // Transient trade confirmation. The strongbox/hold figures live in the
  // header, usually scrolled off-screen on a phone mid-trade — without this
  // a tap on Buy/Sell looks like nothing happened.
  const [tradeNote, setTradeNote] = useState(null);
  const tradeNoteTimer = useRef(null);
  useEffect(() => () => { if (tradeNoteTimer.current) clearTimeout(tradeNoteTimer.current); }, []);
  const showTradeNote = (text) => {
    if (tradeNoteTimer.current) clearTimeout(tradeNoteTimer.current);
    setTradeNote({ key: Date.now(), text });
    tradeNoteTimer.current = setTimeout(() => setTradeNote(null), 2600);
  };
  const buyWithNote = (c, qty, price) => {
    if (!buyGood(c, qty, price)) return;
    const gross = qty * price;
    const duty = Math.round(gross * taxRate);
    showTradeNote(`Bought ${qty} ${unitLabel(c, qty)} of ${COMMODITIES[c].name} for £${gross + duty}${duty > 0 ? `, £${duty} of it duty` : ''}.`);
  };
  const sellWithNote = (c, qty, price) => {
    if (!sellGood(c, qty, price)) return;
    const gross = qty * price;
    const duty = Math.round(gross * taxRate);
    showTradeNote(`Sold ${qty} ${unitLabel(c, qty)} of ${COMMODITIES[c].name} — £${gross - duty} to the strongbox${duty > 0 ? `, less £${duty} duty` : ''}.`);
  };

  // Compute the largest qty the player can buy of a commodity, given money,
  // hold capacity, and port stock. Tax inflates per-unit cost when buying at
  // a port that levies duty (Dutch).
  const taxRate = portTaxRate(gs, gs.location);

  // Today's price against this port's own fair rate, and the cause when an
  // event window is moving the market — so a shifted price reads as news,
  // not noise.
  const driftBit = (c, price, side) => {
    const d = priceDrift(price, fairPriceFor(gs.location, c, side, gs));
    if (d === 'par') return null;
    const good = side === 'sell' ? d === 'low' : d === 'high';
    const word = side === 'sell'
      ? (d === 'low' ? 'cheap today' : 'dear today')
      : (d === 'high' ? 'fetches dear' : 'fetches poorly');
    return <span style={{ color: good ? '#3a5c2a' : '#8b1a1a', fontStyle: 'italic' }}> · {word}</span>;
  };
  const windowBit = (c, side) => {
    const ws = activeWindowsFor(gs, gs.location, c, side);
    if (ws.length === 0) return null;
    const w = ws[ws.length - 1];
    const left = w.expiresDay - gs.day;
    return (
      <div style={{ fontSize: '0.78em', color: '#6b4423', fontStyle: 'italic', marginTop: '0.1rem' }}>
        ⁕ {w.label || 'a disturbance in the market'} moves this price — {left} day{left !== 1 ? 's' : ''} more.
      </div>
    );
  };
  const maxBuyable = (c, price) => {
    const w = COMMODITIES[c].weight;
    const perUnit = Math.max(1, Math.ceil(price * (1 + taxRate)));
    const byMoney = Math.floor(gs.money / perUnit);
    const byHold  = w > 0 ? Math.floor(remaining / w) : Infinity;
    const byStock = Math.floor(stocks[c] ?? Infinity);
    return Math.max(0, Math.min(byMoney, byHold, byStock));
  };

  const atHome = gs.location === 'Bayan-Kor';
  const quote     = repairQuote(gs);
  const rushQuote = repairQuote(gs, { expedite: true });
  const hasYard = !!gs.outpost?.buildings?.shipwright?.built;
  const standingNote = (() => {
    if (atHome || !port.faction) return '';
    const m = quote.standingMult;
    if (m < 1) return `Your standing with the ${FACTIONS[port.faction].short} brings the price in.`;
    if (m > 1) return `Your standing with the ${FACTIONS[port.faction].short} adds to the bill.`;
    return '';
  })();

  return (
    <div>
      <h2 className="display" style={{ fontSize: '1.4em', color: '#5c1a08', marginTop: 0 }}>{port.name} &mdash; The Wharf</h2>
      <p className="italic" style={{ color: '#4a3220', marginBottom: '1rem' }}>{port.blurb}</p>
      {arrivalProse?.port === gs.location && (
        viewportMode === 'desktop' ? (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 480px', gap: '1rem', alignItems: 'start' }}>
              <div style={{ padding: '0.8rem', borderLeft: '3px solid #5c1a08', background: 'rgba(255,255,255,0.3)' }}>
                <p className="italic" style={{ margin: 0 }}>{arrivalProse.prose}</p>
                <ImagePlate plate={pickPlate(arrivalProse.prose)} />
                <ImaginePanel prose={arrivalProse.prose} label="Imagine the harbour" />
              </div>
              <InlineIllustration prose={arrivalProse.prose} />
            </div>
          </div>
        ) : (
          <div style={{ padding: '0.8rem', borderLeft: '3px solid #5c1a08', background: 'rgba(255,255,255,0.3)', marginBottom: '1.5rem' }}>
            <p className="italic" style={{ margin: 0 }}>{arrivalProse.prose}</p>
            <ImagePlate plate={pickPlate(arrivalProse.prose)} />
            <ImaginePanel prose={arrivalProse.prose} label="Imagine the harbour" />
          </div>
        )
      )}

      {/* Cargo gauge — always visible at any port. */}
      <div style={{ marginBottom: '1.2rem', padding: '0.7rem 0.9rem', background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(74,44,20,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', color: '#4a3220' }}>
          <span className="display" style={{ fontSize: '0.9em', color: '#6b4423', letterSpacing: '0.06em' }}>{ship.name.toUpperCase()} — HOLD</span>
          <span className="display" style={{ fontSize: '0.9em' }}>{fmtCwt(used)} / {cap} cwt</span>
        </div>
        <div style={{ height: '6px', background: 'rgba(74,44,20,0.15)', borderRadius: '2px', marginTop: '4px' }}>
          <div style={{ width: `${Math.min(100, (used / cap) * 100)}%`, height: '100%', background: used >= cap ? '#8b1a1a' : '#5c1a08', borderRadius: '2px' }} />
        </div>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.78em', color: '#6b4423', marginTop: '0.4rem', flexWrap: 'wrap' }}>
          <span>Hull {ship.hull}/100</span>
          <span>Sails {ship.sails}/100</span>
          {(ship.hull < MIN_HULL_COND || ship.sails < MIN_SAIL_COND) && (
            <span style={{ color: '#8b1a1a', fontStyle: 'italic' }}>— too damaged to put to sea</span>
          )}
        </div>
        {taxRate > 0 && (
          <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed rgba(74,44,20,0.25)', fontSize: '0.85em', color: '#8b1a1a', fontStyle: 'italic' }}>
            The Dutch port levies a duty of {Math.round(taxRate * 100)}% on every transaction.
            {gs.flags?.dutchTradePass && (
              <span style={{ color: '#3a5c2a' }}> Yr. writ of free trade is honoured here.</span>
            )}
          </div>
        )}
      </div>

      <div className="cols-2">
        <div>
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.5rem' }}>FOR SALE BY THE PORT</div>
          {sells.length === 0 ? <p className="italic">Nothing to be had here.</p> : sells.map(c => {
            const price = priceFor(gs.location, c, gs.day, gs);
            const onHand = Math.floor(stocks[c] ?? 0);
            const max = maxBuyable(c, price);
            const effPrice = taxRate > 0 ? Math.ceil(price * (1 + taxRate)) : price;
            return (
              <div key={c} className="trade-row">
                <div>
                  <div>{COMMODITIES[c].name}</div>
                  <div style={{ fontSize: '0.85em', color: '#6b4423' }}>
                    £{price} per {COMMODITIES[c].unit}{taxRate > 0 ? ` (£${effPrice} w/ duty)` : ''}{driftBit(c, price, 'sell')} · {COMMODITIES[c].weight} cwt ea ·{' '}
                    <span style={{ color: onHand === 0 ? '#8b1a1a' : '#6b4423' }}>
                      {onHand === 0 ? 'none on hand' : `${onHand} on hand`}
                    </span>
                  </div>
                  {windowBit(c, 'sell')}
                </div>
                <div className="actions">
                  <button className="ghost-button-sm" disabled={max < 1}  onClick={() => buyWithNote(c, 1, price)}>Buy 1</button>
                  <button className="ghost-button-sm" disabled={max < 5}  onClick={() => buyWithNote(c, 5, price)}>Buy 5</button>
                  <button className="ghost-button-sm" disabled={max < 1}  onClick={() => buyWithNote(c, max, price)}>Buy max ({max})</button>
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.5rem' }}>BOUGHT BY THE PORT</div>
          {buys.length === 0 ? <p className="italic">No one is buying.</p> : buys.map(c => {
            const price = priceFor(gs.location, c, gs.day, gs);
            const have = gs.goods[c] || 0;
            const netPrice = taxRate > 0 ? Math.floor(price * (1 - taxRate)) : price;
            return (
              <div key={c} className="trade-row">
                <div>
                  <div>{COMMODITIES[c].name} <span style={{ fontSize: '0.85em', color: '#6b4423' }}>(have {have})</span></div>
                  <div style={{ fontSize: '0.85em', color: '#6b4423' }}>£{price} per {COMMODITIES[c].unit}{taxRate > 0 ? ` (£${netPrice} after duty)` : ''}{driftBit(c, price, 'buy')}</div>
                  {windowBit(c, 'buy')}
                </div>
                <div className="actions">
                  <button className="ghost-button-sm" disabled={have < 1} onClick={() => sellWithNote(c, 1, price)}>Sell 1</button>
                  <button className="ghost-button-sm" disabled={have < 5} onClick={() => sellWithNote(c, 5, price)}>Sell 5</button>
                  <button className="ghost-button-sm" disabled={have < 1} onClick={() => sellWithNote(c, have, price)}>Sell all</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {tradeNote && (
        <div key={tradeNote.key} className="ink-fade-in" style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)',
          bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
          maxWidth: 'min(92vw, 28rem)', zIndex: 60, pointerEvents: 'none',
          background: '#f0e3c4', border: '1px solid #6b4423', borderLeft: '3px solid #5c1a08',
          boxShadow: '0 2px 10px rgba(42,26,10,0.25)', padding: '0.5rem 0.9rem',
          fontFamily: '"EB Garamond", serif', fontStyle: 'italic',
          color: '#4a3220', fontSize: '0.92em',
        }}>
          {tradeNote.text}
        </div>
      )}

      {atHome && lodgeGoods && withdrawGoods && (
        <GodownPanel gs={gs} lodgeGoods={lodgeGoods} withdrawGoods={withdrawGoods} />
      )}

      {quote.points > 0 && (
        <div style={{ marginTop: '1.5rem', padding: '0.9rem 1rem', background: 'rgba(255,255,255,0.3)', borderLeft: '3px solid #5c1a08' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.4rem' }}>
            <div className="display" style={{ fontSize: '0.9em', color: '#5c1a08' }}>THE SLIPWAY</div>
            <div style={{ fontSize: '0.78em', color: '#6b4423', fontStyle: 'italic' }}>yard: {YARDS[quote.yard].label}</div>
          </div>
          <p className="italic" style={{ margin: '0.3rem 0 0.6rem 0', color: '#4a3220', fontSize: '0.92em' }}>
            {atHome
              ? (hasYard
                  ? `The shipwright's apprentices can have the ${ship.name} sound by the morning tide.`
                  : `Without a proper yard, refit is dear and the work mostly bodged. (Build the Shipwright's Yard for the proper rate.)`)
              : (port.yardBlurb || 'The wharf can put her right, after a fashion.')}
            {standingNote && ` ${standingNote}`}
          </p>
          <div style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.5rem' }}>
            {quote.points} points of damage · {quote.days === 0 ? 'finished overnight' : `${quote.days} day${quote.days !== 1 ? 's' : ''} on the slipway`}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button className="wax-button" disabled={gs.money < quote.cost} onClick={() => refitShip(false)}>
              Refit — £{quote.cost}{quote.days > 0 ? ` · ${quote.days}d` : ''}
            </button>
            {quote.days > 0 && (
              <button className="ghost-button" disabled={gs.money < rushQuote.cost} onClick={() => refitShip(true)}>
                Rush the work — £{rushQuote.cost} · {rushQuote.days}d
              </button>
            )}
          </div>
        </div>
      )}

      {(() => {
        const sub = activeSublocation(gs.location, gs);
        if (!sub) return null;
        return <SublocationPanel gs={gs} sub={sub} buyGood={buyWithNote} taxRate={taxRate} />;
      })()}

      <ContractRunPanel gs={gs} liftContractOpium={liftContractOpium} runDutchCustoms={runDutchCustoms} />

      {atHome && takeBottomry && (
        <BottomryPanel gs={gs} takeBottomry={takeBottomry} />
      )}

      {atHome && commissionBrigantine && (
        <CommissionPanel gs={gs} commissionBrigantine={commissionBrigantine} />
      )}

      <Fleuron char="❧" />
      <div style={{ textAlign: 'center', marginTop: '1rem' }}>
        <p className="italic" style={{ color: '#6b4423', fontSize: '0.9em', marginBottom: '0.7rem' }}>
          When your business at the wharf is concluded, the chart awaits.
        </p>
        <button className="wax-button" onClick={() => setTab && setTab('map')}>
          Set Sail &mdash; Open the Chart
        </button>
      </div>
    </div>
  );
}

// ─────────── GODOWN PANEL ───────────
// Shown inside PortView when at Bayan-Kor. Lets the player move goods between
// the ship's hold and the port-side godown. Pepper and cinnamon stored in the
// godown count toward the London quota (computed live from warehouse stock).

function GodownPanel({ gs, lodgeGoods, withdrawGoods }) {
  const cap = warehouseCap(gs);
  const used = warehouseUsed(gs);
  const ware = gs.outpost?.warehouse || {};

  // Lodging is the payoff of a quota voyage — confirm it with a beat, framed
  // in quota terms for pepper/cinnamon ("N of 400 secured for London") so the
  // headline number's meaning lands at the moment the cargo goes in.
  const [lodgeNote, setLodgeNote] = useState(null);
  const lodgeNoteTimer = useRef(null);
  useEffect(() => () => { if (lodgeNoteTimer.current) clearTimeout(lodgeNoteTimer.current); }, []);
  const lodgeWithNote = (c, qty) => {
    const moved = lodgeGoods(c, qty);
    if (!moved) return;
    const q = gs.quotas?.[c];
    let text;
    if (q) {
      const secured = Math.floor(q.have || 0) + Math.floor(ware[c] || 0) + moved;
      text = `Lodged ${moved} ${unitLabel(c, moved)} of ${COMMODITIES[c].name} — ${secured} of ${q.needed} secured for London.`;
    } else {
      text = `Lodged ${moved} ${unitLabel(c, moved)} of ${COMMODITIES[c].name} in the godown.`;
    }
    if (lodgeNoteTimer.current) clearTimeout(lodgeNoteTimer.current);
    setLodgeNote({ key: Date.now(), text });
    lodgeNoteTimer.current = setTimeout(() => setLodgeNote(null), 2800);
  };
  const hold = gs.goods || {};
  const holdRemaining = Math.max(0, cargoCap(gs) - cargoWeight(hold));
  const hasGreat = !!gs.outpost?.buildings?.great_godown?.built;
  const hasMag = !!gs.outpost?.buildings?.magazine?.built;

  // Show every commodity that has stock in either side, plus pepper/cinnamon
  // (so the player can always see quota status here).
  const seen = new Set();
  for (const k of Object.keys(hold)) if ((hold[k] || 0) > 0) seen.add(k);
  for (const k of Object.keys(ware)) if ((ware[k] || 0) > 0) seen.add(k);
  seen.add('pepper'); seen.add('cinnamon');
  const rows = Array.from(seen).filter(k => COMMODITIES[k]);

  return (
    <div style={{ marginTop: '1.5rem', padding: '0.9rem 1rem', background: 'rgba(255,255,255,0.3)', borderLeft: '3px solid #5c1a08' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.4rem' }}>
        <div className="display" style={{ fontSize: '0.9em', color: '#5c1a08' }}>THE GODOWN</div>
        <div className="display" style={{ fontSize: '0.85em', color: '#6b4423' }}>{fmtCwt(used)} / {cap} cwt</div>
      </div>
      <p className="italic" style={{ margin: '0.3rem 0 0.6rem 0', color: '#4a3220', fontSize: '0.92em' }}>
        {hasGreat
          ? 'The Great Godown stands behind the dock, its teak doors banded in iron.'
          : 'The thatched godown is small and the rats are persistent. A Great Godown would treble the room.'}
        {hasMag ? ' The Magazine cuts the worst of any single raid.' : ''}
      </p>
      <div style={{ height: '5px', background: 'rgba(74,44,20,0.15)', borderRadius: '2px', marginBottom: '0.7rem' }}>
        <div style={{ width: `${Math.min(100, (used / cap) * 100)}%`, height: '100%', background: used >= cap ? '#8b1a1a' : '#5c1a08', borderRadius: '2px' }} />
      </div>

      {rows.length === 0 ? (
        <p className="italic" style={{ color: '#6b4423' }}>No stock to lodge or withdraw.</p>
      ) : rows.map(c => {
        const inHold = Math.floor(hold[c] || 0);
        const inGodown = Math.floor(ware[c] || 0);
        const w = COMMODITIES[c].weight || 1;
        const lodgeMax = Math.min(inHold, Math.floor(Math.max(0, cap - used) / w));
        const withdrawMax = Math.min(inGodown, Math.floor(holdRemaining / w));
        const isQuota = !!gs.quotas?.[c];
        return (
          <div key={c} className="trade-row" style={{ borderTop: '1px solid rgba(74,44,20,0.15)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
            <div>
              <div>
                {COMMODITIES[c].name}
                {isQuota && (
                  <span style={{ fontSize: '0.78em', color: '#6b4423', fontStyle: 'italic', marginLeft: '0.4rem' }}>
                    — {Math.floor(gs.quotas[c].have || 0)} / {gs.quotas[c].needed} {COMMODITIES[c].unit} shipped to London{inGodown > 0 ? `; ${inGodown} awaiting` : ''}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.85em', color: '#6b4423' }}>
                Hold {inHold} · Godown {inGodown} · {w} cwt ea
              </div>
            </div>
            <div className="actions">
              <button className="ghost-button-sm" disabled={lodgeMax < 1} onClick={() => lodgeWithNote(c, 1)}>Lodge 1</button>
              <button className="ghost-button-sm" disabled={lodgeMax < 1} onClick={() => lodgeWithNote(c, lodgeMax)}>Lodge all ({lodgeMax})</button>
              <button className="ghost-button-sm" disabled={withdrawMax < 1} onClick={() => withdrawGoods(c, 1)}>Draw 1</button>
              <button className="ghost-button-sm" disabled={withdrawMax < 1} onClick={() => withdrawGoods(c, withdrawMax)}>Draw all ({withdrawMax})</button>
            </div>
          </div>
        );
      })}
      {lodgeNote && (
        <div key={lodgeNote.key} className="ink-fade-in" style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)',
          bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
          maxWidth: 'min(92vw, 30rem)', zIndex: 60, pointerEvents: 'none',
          background: '#f0e3c4', border: '1px solid #6b4423', borderLeft: '3px solid #5c1a08',
          boxShadow: '0 2px 10px rgba(42,26,10,0.25)', padding: '0.5rem 0.9rem',
          fontFamily: '"EB Garamond", serif', fontStyle: 'italic',
          color: '#4a3220', fontSize: '0.92em',
        }}>
          {lodgeNote.text}
        </div>
      )}
    </div>
  );
}

// ─────────── OUTPOST VIEW ───────────

// ─────────── COMMISSION PANEL ───────────
// Shown at the Wharf at home. Three states: gated (no Shipwright's Yard /
// already on a brigantine), in-progress (build counting down), or available.

// ─────────── BOTTOMRY PANEL ───────────
// Mehmet Pasha's panel at the bazaar. Shows current bond if any (with the
// outcome rules), or the available principals to borrow if not. Repayment
// only happens automatically on return to Bayan-Kor — not from this panel.

// ─────────── SUBLOCATION PANEL ───────────
// Renders a sublocation's trade rows when its gate is met. Buy goes through
// the same buyGood handler as the main wharf — the price multiplier comes
// from the sublocation's sells map; stocks are tracked in the same
// portStocks bucket as the port.

function SublocationPanel({ gs, sub, buyGood, taxRate }) {
  const stocks = gs.portStocks?.[gs.location] || {};
  const sells = Object.keys(sub.sells || {});
  if (sells.length === 0) return null;
  return (
    <div style={{ marginTop: '1.5rem', padding: '0.9rem 1rem', background: 'rgba(255,255,255,0.3)', borderLeft: '3px solid #5c1a08' }}>
      <div className="display" style={{ fontSize: '0.9em', color: '#5c1a08', marginBottom: '0.3rem' }}>
        {sub.label}
      </div>
      <p className="italic" style={{ margin: '0 0 0.6rem 0', color: '#4a3220', fontSize: '0.92em' }}>
        {sub.blurb}
      </p>
      {sells.map(c => {
        const com = COMMODITIES[c];
        if (!com) return null;
        const subMult = sub.sells[c];
        const base = com.basePrice;
        const fluct = ((Math.abs((gs.day || 1) * 7919 + c.charCodeAt(0)) % 17) - 8) / 100;
        // Window arithmetic uses the parent port's key (sublocations share
        // the same priceWindows bucket as their parent port).
        const windowMult = priceWindowMult(gs, gs.location, c, 'sell');
        const price = Math.max(1, Math.round(base * subMult * (1 + fluct) * windowMult));
        const onHand = Math.floor(stocks[c] ?? 0);
        const effPrice = taxRate > 0 ? Math.ceil(price * (1 + taxRate)) : price;
        const w = com.weight || 1;
        const remaining = Math.max(0, cargoCap(gs) - cargoWeight(gs.goods));
        const byMoney = Math.floor(gs.money / Math.max(1, effPrice));
        const byHold  = w > 0 ? Math.floor(remaining / w) : Infinity;
        const max = Math.max(0, Math.min(byMoney, byHold, onHand));
        return (
          <div key={c} className="trade-row" style={{ borderTop: '1px solid rgba(74,44,20,0.15)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
            <div>
              <div>{com.name}</div>
              <div style={{ fontSize: '0.85em', color: '#6b4423' }}>
                £{price} per {com.unit}{taxRate > 0 ? ` (£${effPrice} w/ duty)` : ''} · {com.weight} cwt ea ·{' '}
                <span style={{ color: onHand === 0 ? '#8b1a1a' : '#6b4423' }}>
                  {onHand === 0 ? 'none on hand' : `${onHand} on hand`}
                </span>
              </div>
            </div>
            <div className="actions">
              <button className="ghost-button-sm" disabled={max < 1} onClick={() => buyGood(c, 1, price)}>Buy 1</button>
              <button className="ghost-button-sm" disabled={max < 5} onClick={() => buyGood(c, 5, price)}>Buy 5</button>
              <button className="ghost-button-sm" disabled={max < 1} onClick={() => buyGood(c, max, price)}>Buy max ({max})</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────── CONTRACT RUN PANEL ───────────
// Shown at the Pelican's Nest when the pale man's contract is active and
// the opium hasn't yet been lifted; and at Eustace when the opium is in
// the hold and waiting for the customs run.

function ContractRunPanel({ gs, liftContractOpium, runDutchCustoms }) {
  const stage = gs.flags?.paleManQuest;
  const contractActive = stage === 'closed-contracted' || stage === 'closed-half-contract';
  if (!contractActive && !gs.flags?.contractOpiumLifted) return null;
  const cwt = gs.flags?.contractOpiumLifted;
  const isHalf = stage === 'closed-half-contract';
  const cargoSize = isHalf ? 2 : 4;

  // At the Nest, ready to lift
  if (gs.location === 'The Pelican’s Nest' && contractActive && !cwt && liftContractOpium) {
    const w = COMMODITIES.opium.weight || 0.6;
    const remaining = Math.max(0, cargoCap(gs) - cargoWeight(gs.goods));
    const fits = remaining >= cargoSize * w;
    return (
      <div style={{ marginTop: '1.5rem', padding: '0.9rem 1rem', background: 'rgba(255,253,245,0.55)', borderLeft: '3px solid #5c1a08' }}>
        <div className="display" style={{ fontSize: '0.9em', color: '#5c1a08', marginBottom: '0.3rem' }}>
          THE CONTRACT — UNDER SAID BIN MAHMOOD'S NAME
        </div>
        <p className="italic" style={{ margin: '0 0 0.6rem 0', color: '#4a3220', fontSize: '0.92em' }}>
          {cargoSize} cwt of opium are stored on the wharf at the Brotherhood's mark, under Said bin Mahmood's name. Lift them into yr. hold and the drop at Port St. Eustace remains.
        </p>
        <button
          className="wax-button"
          disabled={!fits}
          onClick={liftContractOpium}
        >
          Lift the {cargoSize} cwt of opium
        </button>
        {!fits && (
          <div style={{ fontSize: '0.85em', color: '#8b1a1a', fontStyle: 'italic', marginTop: '0.3rem' }}>
            Yr. hold has not the room — clear cargo before lifting.
          </div>
        )}
      </div>
    );
  }

  // At Eustace, ready to drop
  if (gs.location === 'Port St. Eustace' && cwt && runDutchCustoms) {
    const passHeld = !!gs.flags?.dutchTradePass;
    const dutchRep = gs.reputation?.dutch || 0;
    const friendly = dutchRep >= 20;
    return (
      <div style={{ marginTop: '1.5rem', padding: '0.9rem 1rem', background: 'rgba(255,253,245,0.55)', borderLeft: '3px solid #5c1a08' }}>
        <div className="display" style={{ fontSize: '0.9em', color: '#5c1a08', marginBottom: '0.3rem' }}>
          THE DROP — RUNNING THE HOLLANDER'S CUSTOMS
        </div>
        <p className="italic" style={{ margin: '0 0 0.5rem 0', color: '#4a3220', fontSize: '0.92em' }}>
          {cwt} cwt of unmanifested opium sit in yr. hold. The drop is at the back of the Hollander's wharf, by a runner who will know yr. ship. The customs clerks must not see what they are not paid to see.
        </p>
        <div style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.4rem' }}>
          {passHeld
            ? 'Yr. trade pass holds the customs at a glance — risk is low.'
            : friendly
              ? 'Yr. Dutch standing is cordial; the customs clerks will not press hard, but they will look.'
              : 'No trade pass; standing is ordinary. The customs are a real risk.'}
        </div>
        <div style={{ fontSize: '0.82em', color: '#8b1a1a', fontStyle: 'italic', marginBottom: '0.6rem' }}>
          If they find it: the cargo is forfeit, the contract void, and yr. standing with the Hollanders falls hard. There is no second telling of it.
        </div>
        <button
          className="wax-button"
          onClick={runDutchCustoms}
        >
          Run the customs and drop the cargo
        </button>
      </div>
    );
  }

  return null;
}

function BottomryPanel({ gs, takeBottomry }) {
  const b = gs.bottomry;
  const hasBond = !!b;
  const charterClosed = !!gs.charterClosed;
  const principals = [150, 300, 500];

  if (charterClosed && !hasBond) return null;

  return (
    <div style={{ marginTop: '1.5rem', padding: '0.9rem 1rem', background: 'rgba(255,255,255,0.3)', borderLeft: '3px solid #5c1a08' }}>
      <div className="display" style={{ fontSize: '0.9em', color: '#5c1a08', marginBottom: '0.3rem' }}>
        THE BAZAAR — MEHMET PASHA, MONEYLENDER
      </div>
      {hasBond ? (
        <>
          <p className="italic" style={{ margin: '0 0 0.5rem 0', color: '#4a3220', fontSize: '0.92em' }}>
            A bottomry bond of £{b.principal} stands against yr. ship. £{b.repayment} is due upon next return to Bayan-Kor; the bond is cancelled in full if the voyage suffers a calamity (≥25 hull or sails damage from an encounter).
          </p>
          <div style={{ fontSize: '0.85em', color: '#6b4423' }}>
            Taken on day {b.takenDay}.
          </div>
        </>
      ) : (
        <>
          <p className="italic" style={{ margin: '0 0 0.6rem 0', color: '#4a3220', fontSize: '0.92em' }}>
            A bottomry bond — cash now against yr. ship and cargo. 25% on the principal, due on yr. next return to Bayan-Kor. If the voyage is calamitous, the bond is forgotten.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {principals.map(p => (
              <button
                key={p}
                className="ghost-button"
                onClick={() => takeBottomry(p)}
              >
                Borrow £{p} <span style={{ fontSize: '0.82em', color: '#6b4423' }}>(repay £{Math.round(p * 1.25)})</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CommissionPanel({ gs, commissionBrigantine }) {
  const [proposedName, setProposedName] = useState('Astrolabe');
  const ownTeak = gs.flags?.teakConcession === 'self';
  const COST = ownTeak ? 600 : 900;
  const TRADE_IN = 100;
  const DAYS = 60;
  const t = SHIP_TYPES.brigantine;
  const hasYard = !!gs.outpost?.buildings?.shipwright?.built;
  const inProgress = gs.shipCommission && gs.shipCommission.daysLeft > 0;
  const alreadyBrig = gs.ship?.type === 'brigantine';
  const canPay = gs.money >= COST;

  if (alreadyBrig && !inProgress) return null;

  if (inProgress) {
    const c = gs.shipCommission;
    const total = DAYS;
    const pct = Math.max(0, Math.min(100, Math.round(((total - c.daysLeft) / total) * 100)));
    return (
      <div style={{ marginTop: '1.5rem', padding: '0.9rem 1rem', background: 'rgba(255,255,255,0.3)', borderLeft: '3px solid #5c1a08' }}>
        <div className="display" style={{ fontSize: '0.9em', color: '#5c1a08', marginBottom: '0.3rem' }}>ON THE STOCKS — {c.name?.toUpperCase()}</div>
        <p className="italic" style={{ margin: '0 0 0.6rem 0', color: '#4a3220', fontSize: '0.92em' }}>
          The keel is laid; the planking goes on by the week. {c.daysLeft} day{c.daysLeft !== 1 ? 's' : ''} until launch. The {gs.ship?.name || 'pinnace'} remains in service until then.
        </p>
        <div style={{ height: '5px', background: 'rgba(74,44,20,0.15)', borderRadius: '2px' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: '#5c1a08', borderRadius: '2px' }} />
        </div>
      </div>
    );
  }

  if (!hasYard) {
    return (
      <div style={{ marginTop: '1.5rem', padding: '0.9rem 1rem', background: 'rgba(255,255,255,0.2)', borderLeft: '3px dashed #6b4423' }}>
        <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.3rem' }}>A LARGER VESSEL</div>
        <p className="italic" style={{ margin: 0, color: '#4a3220', fontSize: '0.92em' }}>
          A country brigantine could be laid down on the slipway, were there a proper Shipwright&rsquo;s Yard at Bayan-Kor.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '1.5rem', padding: '0.9rem 1rem', background: 'rgba(255,255,255,0.3)', borderLeft: '3px solid #5c1a08' }}>
      <div className="display" style={{ fontSize: '0.9em', color: '#5c1a08', marginBottom: '0.3rem' }}>
        COMMISSION A BRIGANTINE{ownTeak ? ' — INLAND TEAK' : ''}
      </div>
      <p className="italic" style={{ margin: '0 0 0.5rem 0', color: '#4a3220', fontSize: '0.92em' }}>
        {t.blurb} Sixty days on the stocks; the pinnace will be sold off to the Bugis traders for £{TRADE_IN} on the day she is launched.
        {ownTeak && ' The timber will come down from yr. own inland concession, which is no small saving.'}
      </p>
      <div style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.5rem' }}>
        {ownTeak ? (
          <>
            <span style={{ textDecoration: 'line-through', color: '#a08560' }}>£900</span>{' '}
            <span style={{ color: '#5c1a08', fontWeight: 'bold' }}>£{COST}</span>
          </>
        ) : (
          <>£{COST}</>
        )}
        {' · '}{DAYS} days · hold {t.holdCwt} cwt · {t.wearMin}–{t.wearMax} wear/day · −1 day on long voyages
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <label style={{ fontSize: '0.85em', color: '#6b4423' }}>Name her:</label>
        <input
          className="parchment-input"
          value={proposedName}
          onChange={(e) => setProposedName(e.target.value)}
          aria-label="Ship's name"
          maxLength={32}
          style={{ flex: 1, minWidth: '10rem' }}
        />
      </div>
      <button
        className="wax-button"
        disabled={!canPay}
        onClick={() => commissionBrigantine(proposedName)}
      >
        Lay the keel — £{COST}
      </button>
      {!canPay && (
        <div style={{ fontSize: '0.82em', color: '#8b1a1a', marginTop: '0.3rem', fontStyle: 'italic' }}>
          The strongbox is short of the figure.
        </div>
      )}
    </div>
  );
}

function OutpostView({ gs, startBuild, expediteBuild, establishVenture, viewportMode }) {
  const built = Object.entries(gs.outpost.buildings).filter(([,v]) => v.built);
  const queue = gs.outpost.queue;

  // Same formula as the handler — used to label the Rush button.
  const rushCost = (q) => {
    const b = BUILDINGS[q.key];
    const proportion = q.daysLeft / b.days;
    return Math.max(5, Math.ceil(proportion * b.cost * 1.5));
  };
  const available = Object.entries(BUILDINGS).filter(([k]) =>
    !gs.outpost.buildings[k]?.built && !queue.some(q => q.key === k)
  );

  const meetsRequires = (b) => {
    if (!b.requires?.rep) return true;
    return Object.entries(b.requires.rep).every(([f, n]) => gs.reputation[f] >= n);
  };

  // The enterprise beyond the compound — ventures (fleet, agents, capital).
  const ventures = gs.ventures || {};
  const establishedVentures = Object.entries(VENTURES).filter(([id]) => ventures[id]?.established);
  // viaQuest ventures (the Bristol concern) aren't bought from this panel —
  // they come through a questline. Hide them from the purchasable list.
  const availableVentures = Object.entries(VENTURES).filter(([id, def]) => !ventures[id]?.established && !def.viaQuest);
  const quarterlyIncome = ventureQuarterlyIncome(ventures);
  const ventureBenefitLine = (id) => {
    const def = VENTURES[id];
    if (def.income) return `Remits £${def.income} each quarter.`;
    if (def.produce) return `Yields ${def.produce.map(p => `${p.amount} cwt ${COMMODITIES[p.commodity].name.toLowerCase()}`).join(' and ')} to the godown each quarter.`;
    if (def.buyDiscount) return `${def.buyDiscount.commodities.map(c => COMMODITIES[c].name.toLowerCase()).join(' and ')} come ${Math.round((1 - def.buyDiscount.mult) * 100)}% cheaper at ${def.buyDiscount.port}.`;
    return '';
  };

  const containerStyle = viewportMode === 'desktop'
    ? { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem', alignItems: 'start' }
    // Mobile: gap 1.5rem matches the per-section marginBottom of the original
    // pre-Phase-4 layout. Keeps mobile spacing byte-equivalent.
    : { display: 'flex', flexDirection: 'column', gap: '1.5rem' };

  return (
    <div>
      <h2 className="display" style={{ fontSize: '1.4em', color: '#5c1a08', marginTop: 0 }}>The Outpost</h2>
      <p className="italic" style={{ color: '#4a3220', marginBottom: '1rem' }}>
        The compound at Bayan-Kor is yours to build. Construction continues whether you are present or at sea.
      </p>

      {(() => {
        const p = raidPosture(gs);
        if (p.tempting.length === 0) return null;
        const names = p.tempting.map(k => COMMODITIES[k].name.toLowerCase()).join(', ');
        const watch = p.stockade && p.barracks
          ? 'Stockade and sepoys both keep the compound; few will chance it.'
          : p.stockade
            ? 'The stockade tower is kept by night; a Barracks would halve the remaining risk.'
            : p.barracks
              ? 'The sepoys stand guard; a Stockade would halve the remaining risk.'
              : 'The yard lies open. A Stockade would halve the chance of a raid; a Barracks would halve it again.';
        const mag = p.magazine
          ? ' The Magazine caps any single loss at a tenth.'
          : ' A Powder Magazine would cap any single loss at a tenth.';
        return (
          <div style={{ padding: '0.7rem 0.9rem', background: 'rgba(255,255,255,0.3)', borderLeft: '3px solid #5c1a08', marginBottom: '1.2rem' }}>
            <div className="display" style={{ fontSize: '0.85em', color: '#5c1a08', marginBottom: '0.2rem' }}>THE NIGHT WATCH</div>
            <p className="italic" style={{ margin: 0, color: '#4a3220', fontSize: '0.9em' }}>
              The godown holds {names} — temptation for the inland brigands. {watch}{mag}
            </p>
          </div>
        );
      })()}

      <div style={containerStyle}>
        {/* STANDING STRUCTURES — always shown on desktop so the grid has three
            populated cells; on mobile, hidden entirely when empty (preserves
            the original mobile UX where the section disappears with no built
            structures). */}
        {(viewportMode === 'desktop' || built.length > 0) && (
        <div>
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.5rem' }}>STANDING STRUCTURES</div>
          {built.length === 0 ? (
            <p className="italic" style={{ color: '#6b4423', fontSize: '0.9em' }}>Nothing yet raised.</p>
          ) : built.map(([k, v]) => (
            <div key={k} className="parchment" style={{ padding: '0.7rem 1rem', marginBottom: '0.5rem', background: 'rgba(255,255,255,0.3)' }}>
              <div className="display" style={{ color: '#5c1a08' }}>{BUILDINGS[k].name}</div>
              <div style={{ fontSize: '0.85em', color: '#6b4423', fontStyle: 'italic' }}>Completed day {v.builtOn}. {BUILDINGS[k].effect}</div>
            </div>
          ))}
        </div>
        )}

        {/* UNDER CONSTRUCTION — same desktop-vs-mobile pattern as STANDING. */}
        {(viewportMode === 'desktop' || queue.length > 0) && (
        <div>
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.5rem' }}>UNDER CONSTRUCTION</div>
          {queue.length === 0 ? (
            <p className="italic" style={{ color: '#6b4423', fontSize: '0.9em' }}>No works in progress.</p>
          ) : queue.map((q, i) => {
            const b = BUILDINGS[q.key];
            const pct = Math.round((1 - q.daysLeft / b.days) * 100);
            const cost = rushCost(q);
            const canRush = q.daysLeft > 1 && gs.money >= cost && expediteBuild;
            return (
              <div key={i} className="parchment" style={{ padding: '0.7rem 1rem', marginBottom: '0.5rem', background: 'rgba(255,253,245,0.5)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.3rem' }}>
                  <span className="display" style={{ color: '#5c1a08' }}>{b.name}</span>
                  <span className="display" style={{ fontSize: '0.85em', color: '#6b4423' }}>{q.daysLeft} day{q.daysLeft !== 1 ? 's' : ''} remaining</span>
                </div>
                <div style={{ fontSize: '0.92em', color: '#4a3220', fontStyle: 'italic', marginTop: '0.25rem' }}>{b.blurb}</div>
                <div style={{ fontSize: '0.82em', color: '#6b4423', marginTop: '0.2rem' }}>{b.effect}</div>
                <div style={{ height: '5px', background: 'rgba(74,44,20,0.15)', marginTop: '0.5rem', borderRadius: '2px' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: '#5c1a08', borderRadius: '2px' }} />
                </div>
                {q.daysLeft > 1 && expediteBuild && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="ghost-button-sm"
                      disabled={!canRush}
                      onClick={() => expediteBuild(i)}
                    >
                      Rush the work — £{cost}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}

        {/* AVAILABLE FOR CONSTRUCTION — always rendered on every viewport;
            unchanged from before this PR. */}
        <div>
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.5rem' }}>AVAILABLE FOR CONSTRUCTION</div>
          {available.length === 0 ? (
            <p className="italic">All structures begun or built.</p>
          ) : available.map(([k, b]) => {
            const canPay = gs.money >= b.cost;
            const canBuild = meetsRequires(b);
            const blocked = !canPay || !canBuild;
            return (
              <div key={k} className="parchment" style={{ padding: '0.9rem 1rem', marginBottom: '0.7rem', background: 'rgba(255,255,255,0.25)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div className="display" style={{ color: '#5c1a08', fontSize: '1.1em' }}>{b.name}</div>
                    <div style={{ fontSize: '0.95em', color: '#4a3220', fontStyle: 'italic' }}>{b.blurb}</div>
                    <div style={{ fontSize: '0.85em', color: '#6b4423', marginTop: '0.3rem' }}>
                      £{b.cost} &middot; {b.days} days &middot; {b.effect}
                    </div>
                    {!canBuild && b.requires?.rep && (
                      <div style={{ fontSize: '0.85em', color: '#8b1a1a', marginTop: '0.2rem' }}>
                        Requires standing: {Object.entries(b.requires.rep).map(([f, n]) => `${FACTIONS[f].short} ${n}+`).join(', ')}
                      </div>
                    )}
                  </div>
                  <button
                    className="wax-button"
                    disabled={blocked}
                    onClick={() => startBuild(k)}
                  >
                    Begin
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* THE ENTERPRISE — ventures beyond the compound. A different way to
          grow: a fleet, agents abroad, a financial stake. */}
      <div style={{ marginTop: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.3rem' }}>
          <h2 className="display" style={{ fontSize: '1.25em', color: '#5c1a08', margin: 0 }}>The Enterprise</h2>
          {quarterlyIncome > 0 && (
            <span className="display" style={{ fontSize: '0.82em', color: '#3a5c2a' }}>remits £{quarterlyIncome} / quarter</span>
          )}
        </div>
        <p className="italic" style={{ color: '#4a3220', marginBottom: '1rem', fontSize: '0.95em' }}>
          Beyond the compound, yr. fortune may be put to work — a fleet of yr. own, an agent at a foreign port, a stake in the bazaar. Each grows the concern in a different direction.
        </p>
        {establishedVentures.length > 0 && (
          <p className="display" style={{ color: '#6b4423', marginTop: '-0.5rem', marginBottom: '1rem', fontSize: '0.85em' }}>
            The whole concern stands at about £{enterpriseWorth(gs).total.toLocaleString()}.
          </p>
        )}

        {establishedVentures.length > 0 && (
          <div style={{ marginBottom: '1.2rem' }}>
            <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>YR. HOLDINGS</div>
            {establishedVentures.map(([id, def]) => (
              <div key={id} className="parchment" style={{ padding: '0.7rem 1rem', marginBottom: '0.5rem', background: 'rgba(255,255,255,0.3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <div className="display" style={{ color: '#5c1a08' }}>{def.name}</div>
                  <div style={{ fontSize: '0.75em', color: '#8a6a3f', fontStyle: 'italic' }}>{def.category}</div>
                </div>
                <div style={{ fontSize: '0.85em', color: '#3a5c2a', fontStyle: 'italic' }}>{ventureBenefitLine(id)}</div>
              </div>
            ))}
          </div>
        )}

        {availableVentures.length > 0 && (
          <div>
            <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>VENTURES TO BE TAKEN UP</div>
            {availableVentures.map(([id, def]) => {
              const unlocked = ventureUnlocked(id, ventures);
              const canPay = gs.money >= def.cost;
              const reqName = def.requires?.venture ? VENTURES[def.requires.venture]?.name : null;
              return (
                <div key={id} className="parchment" style={{ padding: '0.8rem 1rem', marginBottom: '0.6rem', background: 'rgba(255,255,255,0.22)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <div className="display" style={{ fontSize: '1.05em', color: '#5c1a08' }}>{def.name}</div>
                    <div style={{ fontSize: '0.75em', color: '#8a6a3f', fontStyle: 'italic' }}>{def.category}</div>
                  </div>
                  <p className="italic" style={{ margin: '0.2rem 0 0.4rem 0', color: '#4a3220', fontSize: '0.9em' }}>{def.blurb}</p>
                  <div style={{ fontSize: '0.83em', color: '#3a5c2a', fontStyle: 'italic', marginBottom: '0.5rem' }}>{ventureBenefitLine(id)}</div>
                  {!unlocked && reqName && (
                    <div className="italic" style={{ fontSize: '0.82em', color: '#8b1a1a', marginBottom: '0.4rem' }}>
                      &mdash; Requires {reqName} first.
                    </div>
                  )}
                  <button
                    className="wax-button"
                    disabled={!unlocked || !canPay}
                    onClick={() => establishVenture(id)}
                  >
                    {unlocked ? `Lay out £${def.cost}` : 'Locked'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────── AWAY DIGEST SCREEN ───────────

// Renders a curated arrival encounter from SCRIPTED_ARRIVALS. Shows the
// scene's prose and choice buttons until the player picks; then renders
// the chosen outcome's prose and a Continue. The mechanical changes are
// applied by the parent (handleScriptedChoice) before the resolved state
// reaches this component.
function ScriptedArrivalScreen({ scene, port, resolvedChoice, onChoose, onContinue }) {
  return (
    <Page>
      <div className="ink-fade-in" style={{ maxWidth: '42rem', margin: '0 auto', padding: '3.0rem 1.5rem', width: '100%' }}>
        <div className="display text-center" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.2em', marginBottom: '0.5rem' }}>
          AT THE WHARF — {(port || '').toUpperCase()}
        </div>
        <h2 className="display text-center" style={{ fontSize: '1.8em', color: '#5c1a08', marginBottom: '1rem' }}>
          {scene.title}
        </h2>
        <Fleuron />
        <p className="drop-cap" style={{ fontSize: '1.05em' }}>{scene.prose}</p>
        <Fleuron char="❧" />

        {!resolvedChoice && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
            {scene.choices.map((c, i) => (
              <button
                key={i}
                className="ghost-button"
                style={{ textAlign: 'left' }}
                onClick={() => onChoose(c)}
              >
                — {c.label}
              </button>
            ))}
          </div>
        )}

        {resolvedChoice && (
          <div className="parchment ink-fade-in" style={{
            padding: '1rem 1.1rem', marginTop: '1rem', marginBottom: '1.2rem',
            background: 'rgba(255,253,245,0.55)',
          }}>
            <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
              YOU CHOSE: <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>{resolvedChoice.label}</span>
            </div>
            <p style={{ margin: 0, fontSize: '1em' }}>{resolvedChoice.prose}</p>
          </div>
        )}

        {resolvedChoice && (
          <div className="text-center" style={{ marginTop: '1rem' }}>
            <button className="wax-button" onClick={onContinue}>
              Take Up the Work
            </button>
          </div>
        )}
      </div>
    </Page>
  );
}

function AwayDigestScreen({ digest, onContinue, onResolveRaid }) {
  const [raidPending, setRaidPending] = useState(false);
  const [raidResolved, setRaidResolved] = useState(null); // { label, prose }
  const raid = digest.unresolvedRaid;

  const RAID_CHOICES = [
    {
      label: 'Pursue the brigands inland — Dass insists',
      seed: 'Sgt. Dass leads a sortie inland; risk of skirmish or ambush, fair chance to recover some of what was carried off; a small standing cost with the Rajah if the Sergeant draws blood on his land',
    },
    {
      label: 'Send word to the Vizier and let his men handle it',
      seed: 'Diplomatic recourse; the Vizier may bring back something via local justice or use the favour as a hook; rajah standing moves slightly either way; takes a few days to play out',
    },
    {
      label: 'Let the matter pass — the rains will conceal the trail',
      seed: 'No pursuit. The household notes the silence. Dass is quietly displeased; no rep change, no recovery, but no further trouble either',
    },
  ];

  const handleChoice = async (choice) => {
    if (raidPending || !onResolveRaid || !raid) return;
    setRaidPending(true);
    try {
      const result = await onResolveRaid(raid, choice);
      setRaidResolved({ label: choice.label, prose: result?.prose || '' });
    } catch (e) {
      setRaidResolved({ label: choice.label, prose: 'The matter resolves itself, after a fashion.' });
    } finally {
      setRaidPending(false);
    }
  };

  return (
    <Page>
      <div className="ink-fade-in" style={{ maxWidth: '42rem', margin: '0 auto', padding: '3.0rem 1.5rem', width: '100%' }}>
        <div className="display text-center" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.2em', marginBottom: '0.5rem' }}>
          UPON YOUR RETURN
        </div>
        <h2 className="display text-center" style={{ fontSize: '2em', color: '#5c1a08', marginBottom: '1rem' }}>
          Bayan-Kor in Your Absence
        </h2>
        <Fleuron />
        {digest.prose && (
          <p className="drop-cap" style={{ fontSize: '1.08em' }}>{digest.prose}</p>
        )}
        <Fleuron char="❧" />
        <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.5rem', textAlign: 'center' }}>
          ENTRIES IN THE HOUSE LEDGER
        </div>
        <div style={{ marginBottom: '1.5rem' }}>
          {digest.log.slice(-10).map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: '1rem', marginBottom: '0.4rem', padding: '0.3rem 0', borderBottom: '1px solid rgba(74,44,20,0.1)' }}>
              <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', minWidth: '4rem' }}>Day {e.day}</div>
              <div style={{ fontSize: '0.95em' }}>{e.text}</div>
            </div>
          ))}
        </div>

        {raid && !raidResolved && (
          <div className="parchment ink-fade-in" style={{
            padding: '1rem 1.1rem', marginBottom: '1.2rem',
            background: 'rgba(92,26,8,0.06)', borderLeft: '3px solid #5c1a08',
          }}>
            <div className="display" style={{ fontSize: '0.9em', color: '#5c1a08', letterSpacing: '0.06em', marginBottom: '0.4rem' }}>
              ⁂ THE MATTER OF THE GODOWN
            </div>
            <p className="italic" style={{ color: '#4a3220', margin: '0 0 0.8rem 0' }}>
              {raid.text} How will you proceed?
            </p>
            {raidPending ? (
              <div className="italic" style={{ color: '#6b4423' }}>The household awaits your word…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {RAID_CHOICES.map((c, i) => (
                  <button
                    key={i}
                    className="ghost-button"
                    style={{ textAlign: 'left' }}
                    onClick={() => handleChoice(c)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {raidResolved && (
          <div className="parchment ink-fade-in" style={{
            padding: '1rem 1.1rem', marginBottom: '1.2rem',
            background: 'rgba(255,253,245,0.55)',
          }}>
            <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
              YOU CHOSE: <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>{raidResolved.label}</span>
            </div>
            <p style={{ margin: 0, fontSize: '1em' }}>{raidResolved.prose}</p>
          </div>
        )}

        <div className="text-center">
          <button className="wax-button" onClick={onContinue} disabled={raidPending}>
            Take Up the Work
          </button>
        </div>
      </div>
    </Page>
  );
}

// ─────────── LETTERS VIEW ───────────

// Shared sub-component: renders the parchment body of one letter (content +
// response choices). Used by both the mobile opened-letter path and
// LettersDesktop's reading pane.
function LetterReadingPane({ letter, onRespond, setOpenLetterId, money }) {
  return (
    <div className="parchment" style={{ padding: '1.5rem', background: 'rgba(255,253,245,0.6)' }}>
      <div className="display" style={{ fontSize: '0.85em', color: '#6b4423' }}>FROM</div>
      <div style={{ marginBottom: '0.5rem' }}>{letter.from}</div>
      <div className="display" style={{ fontSize: '0.85em', color: '#6b4423' }}>SUBJECT</div>
      <div className="italic" style={{ marginBottom: '1rem' }}>{letter.subject}</div>
      <Fleuron char="❧" />
      <p style={{ whiteSpace: 'pre-line', fontSize: '1.05em' }}>{letter.body}</p>
      <ImagePlate plate={pickPlate(letter.body)} />
      <ImaginePanel prose={letter.body} label="Imagine the sender's hand" />
      <Fleuron />
      {letter.replied ? (
        <div className="italic" style={{ color: '#6b4423' }}>You replied: &ldquo;{letter.replyLabel}&rdquo;</div>
      ) : (
        <div>
          <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.5rem' }}>YOUR REPLY</div>
          {letter.responses.map((r, i) => {
            // A response may require funds in the strongbox (e.g. sending an
            // investment home). Gate the button so it can't be picked when the
            // sum can't be raised.
            const short = typeof r.requiresMoney === 'number' && (money ?? Infinity) < r.requiresMoney;
            return (
              <div key={i} style={{ marginBottom: '0.5rem' }}>
                <button
                  className="ghost-button"
                  style={{ width: '100%', textAlign: 'left' }}
                  disabled={short}
                  onClick={() => { if (setOpenLetterId) setOpenLetterId(null); onRespond(letter, r); }}
                >
                  &mdash; {r.label}
                </button>
                {short && (
                  <div className="italic" style={{ fontSize: '0.8em', color: '#8b1a1a', marginTop: '0.2rem', marginLeft: '0.3rem' }}>
                    The strongbox wants £{r.requiresMoney - (money || 0)} more for this.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LettersDesktop({ gs, setGs, onRespond }) {
  const letters = gs.letters || [];
  const newestUnread = [...letters].reverse().find(l => !l.read);
  const initialId = (newestUnread || letters[letters.length - 1] || {}).id;
  const [selectedId, setSelectedId] = useState(initialId);
  const selected = letters.find(l => l.id === selectedId);

  // Mark letter as read when selection changes to an unread one.
  useEffect(() => {
    if (!selected || selected.read) return;
    setGs(prev => ({
      ...prev,
      letters: prev.letters.map(l => l.id === selected.id ? { ...l, read: true } : l),
    }));
  }, [selectedId]); // intentional — re-run only when selectedId changes

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '24rem minmax(0, 1fr)', gap: '1rem', alignItems: 'start', minHeight: '60vh' }}>
      {/* INBOX */}
      <div style={{ borderRight: '1px solid rgba(74,44,20,0.18)', paddingRight: '1rem', overflowY: 'auto', maxHeight: '70vh' }}>
        <div className="display" style={{ fontSize: '0.85em', color: '#5c1a08', marginBottom: '0.5rem' }}>⁂ CORRESPONDENCE</div>
        {letters.length === 0 && (
          <div style={{ fontStyle: 'italic', color: '#6b4423', padding: '0.5rem 0' }}>
            No correspondence has reached you yet.
          </div>
        )}
        {[...letters].reverse().map(l => (
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
            <div style={{ fontSize: '0.8em', color: '#6b4423', fontStyle: 'italic' }}>{l.subject}</div>
          </button>
        ))}
      </div>

      {/* READING PANE */}
      <div>
        {selected ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: '1rem', alignItems: 'start' }}>
            <LetterReadingPane letter={selected} onRespond={onRespond} money={gs.money} />
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

function LettersView({ gs, setGs, onRespond, openLetterId, setOpenLetterId, viewportMode }) {
  // Desktop: delegate entirely to the two-pane layout.
  if (viewportMode === 'desktop') {
    return <LettersDesktop gs={gs} setGs={setGs} onRespond={onRespond} />;
  }

  const markRead = (id) => {
    setGs(prev => ({ ...prev, letters: prev.letters.map(l => l.id === id ? { ...l, read: true } : l) }));
  };

  // When a letter is opened (from anywhere — list tap or external prompt), mark it read.
  useEffect(() => {
    if (openLetterId) {
      const letter = gs.letters.find(l => l.id === openLetterId);
      if (letter && !letter.read) {
        markRead(openLetterId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openLetterId]);

  if (openLetterId) {
    const letter = gs.letters.find(l => l.id === openLetterId);
    if (!letter) { setOpenLetterId(null); return null; }
    return (
      <div>
        <button className="ghost-button" onClick={() => setOpenLetterId(null)} style={{ marginBottom: '1rem' }}>← Back to letters</button>
        <LetterReadingPane letter={letter} onRespond={onRespond} setOpenLetterId={setOpenLetterId} money={gs.money} />
      </div>
    );
  }

  return (
    <div>
      <h2 className="display" style={{ fontSize: '1.4em', color: '#5c1a08', margin: '0 0 1rem 0' }}>Correspondence</h2>
      {gs.letters.length === 0 ? (
        <p className="italic" style={{ color: '#6b4423' }}>No letters in your hand.</p>
      ) : (
        <div>
          {gs.letters.slice().reverse().map(l => (
            <div
              key={l.id}
              className="parchment"
              style={{
                padding: '0.8rem 1rem', marginBottom: '0.6rem', cursor: 'pointer',
                background: l.read ? 'rgba(255,255,255,0.2)' : 'rgba(255,253,245,0.55)',
                borderLeft: l.read ? '1px solid rgba(74,44,20,0.35)' : '3px solid #5c1a08',
              }}
              onClick={() => setOpenLetterId(l.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: l.read ? 400 : 600 }}>{l.from}</div>
                  <div className="italic" style={{ fontSize: '0.9em', color: '#4a3220' }}>{l.subject}</div>
                </div>
                <div style={{ fontSize: '0.85em', color: '#6b4423' }}>
                  {l.replied ? 'replied' : (l.read ? 'read, awaiting reply' : 'unread')}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────── CHANGES SUMMARY ───────────

function ChangesSummary({ changes }) {
  const items = [];
  if (changes.money) items.push({ label: changes.money > 0 ? `Gained £${changes.money}` : `Lost £${Math.abs(changes.money)}`, color: changes.money > 0 ? '#3a5c2a' : '#8b1a1a' });
  if (changes.days) items.push({ label: `${changes.days} day${changes.days !== 1 ? 's' : ''} passed`, color: '#6b4423' });
  if (changes.goods) {
    for (const [k, v] of Object.entries(changes.goods)) {
      if (!v) continue;
      items.push({ label: `${v > 0 ? '+' : ''}${v} ${COMMODITIES[k]?.name || k}`, color: v > 0 ? '#3a5c2a' : '#8b1a1a' });
    }
  }
  if (changes.reputation) {
    for (const [k, v] of Object.entries(changes.reputation)) {
      if (!v) continue;
      items.push({ label: `${FACTIONS[k]?.short || k} ${v > 0 ? '+' : ''}${v}`, color: v > 0 ? '#3a5c2a' : '#8b1a1a' });
    }
  }
  if (changes.shipDamage) {
    const sd = changes.shipDamage;
    if (sd.hull)  items.push({ label: `Hull −${Math.min(40, Number(sd.hull) || 0)}`,  color: '#8b1a1a' });
    if (sd.sails) items.push({ label: `Sails −${Math.min(40, Number(sd.sails) || 0)}`, color: '#8b1a1a' });
  }
  if (Array.isArray(changes.newAcquaintances)) {
    for (const a of changes.newAcquaintances) {
      if (!a?.name) continue;
      items.push({ label: `Met ${a.name}${a.role ? ` (${a.role})` : ''}`, color: '#4a3220' });
    }
  }
  if (items.length === 0) return null;
  return (
    <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
      <div className="display" style={{ fontSize: '0.8em', color: '#6b4423', marginBottom: '0.5rem' }}>OF NOTE</div>
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
        {items.map((it, i) => (
          <span key={i} style={{ color: it.color, fontFamily: '"IM Fell English SC", serif', letterSpacing: '0.05em', fontSize: '0.95em' }}>
            {it.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─────────── PROVISIONS DRAWER ───────────
// Save status, export to JSON for off-device backup, import back, reset.

function ProvisionsDrawer({ gs, setGs, lastSavedAt }) {
  const [open, setOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState(false);
  const [flash, setFlash] = useState('');
  const [exportPanel, setExportPanel] = useState(null);

  const showFlash = (msg) => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 2500);
  };

  const savedLabel = (() => {
    if (!lastSavedAt) return 'not yet saved';
    const ago = Math.floor((Date.now() - lastSavedAt) / 1000);
    if (ago < 5) return 'just saved';
    if (ago < 60) return `saved ${ago}s ago`;
    if (ago < 3600) return `saved ${Math.floor(ago / 60)}m ago`;
    return `saved ${Math.floor(ago / 3600)}h ago`;
  })();

  const showManuscript = () => {
    const data = JSON.stringify({ gs, phase: 'game', exportedAt: Date.now() }, null, 2);
    setExportPanel({
      title: 'Manuscript',
      content: data,
      filename: `factors_charter_day${gs.day}.json`,
    });
  };

  const importJSON = () => {
    try {
      const parsed = JSON.parse(importText.trim());
      if (parsed.gs && parsed.gs.player && parsed.gs.day !== undefined) {
        setGs(parsed.gs);
        setImportMode(false);
        setImportText('');
        showFlash('Manuscript restored.');
      } else {
        showFlash('That does not look like a valid manuscript.');
      }
    } catch (e) {
      showFlash('Could not parse the manuscript.');
    }
  };

  return (
    <div style={{ marginTop: '1.5rem', padding: '0.5rem 0', borderTop: '1px dashed rgba(74,44,20,0.3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div className="display" style={{ fontSize: '0.78em', color: '#6b4423', letterSpacing: '0.05em' }}>
          ⁂ {savedLabel}
        </div>
        <button
          onClick={() => setOpen(!open)}
          style={{ background: 'none', border: 'none', color: '#6b4423', fontSize: '0.85em', cursor: 'pointer', fontStyle: 'italic' }}
        >
          {open ? '— hide marginalia —' : '— marginalia —'}
        </button>
      </div>

      {flash && (
        <div className="ink-fade-in" style={{ marginTop: '0.5rem', padding: '0.4rem 0.7rem', background: 'rgba(92,26,8,0.08)', borderLeft: '2px solid #5c1a08', fontSize: '0.85em', color: '#5c1a08' }}>
          {flash}
        </div>
      )}

      {open && (
        <div style={{ marginTop: '0.7rem', padding: '0.8rem', background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(74,44,20,0.2)' }}>
          <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.5rem' }}>BACKUP &amp; RESTORE</div>
          <p style={{ fontSize: '0.85em', color: '#4a3220', marginBottom: '0.7rem', fontStyle: 'italic' }}>
            Take a copy of the manuscript before each long voyage. Paste it back to restore should the inkwell be overturned.
          </p>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
            <button className="ghost-button-sm" onClick={showManuscript}>Show manuscript</button>
            <button className="ghost-button-sm" onClick={() => setImportMode(!importMode)}>
              {importMode ? 'Cancel import' : 'Restore from manuscript'}
            </button>
          </div>

          {importMode && (
            <div>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Paste the manuscript JSON here..."
                aria-label="Manuscript JSON to restore"
                style={{
                  width: '100%', minHeight: '6rem', padding: '0.5rem',
                  fontFamily: 'monospace', fontSize: '0.75em',
                  background: 'rgba(255,255,255,0.4)',
                  border: '1px solid rgba(74,44,20,0.3)',
                  color: '#2a1a0a',
                }}
              />
              <button className="wax-button" onClick={importJSON} style={{ marginTop: '0.5rem' }}>
                Restore
              </button>
            </div>
          )}

          <div style={{ fontStyle: 'italic', color: '#6b4423', fontSize: '0.82em', marginTop: '1.2rem' }}>
            Letters arrive as the post will bring them. To begin a fresh charter, return to the title from the menu &mdash; this charter will be kept on the rolls.
          </div>
          <div style={{ fontStyle: 'italic', color: '#6b4423', fontSize: '0.82em', marginTop: '0.6rem' }}>
            For backups, use <strong>Show manuscript</strong> in the menu &mdash; copy the JSON and paste it where you keep your saves. <strong>Show AI log</strong> exports every prompt and response from this charter for review.
          </div>
        </div>
      )}

      {exportPanel && (
        <ExportModal
          title={exportPanel.title}
          content={exportPanel.content}
          filename={exportPanel.filename}
          onClose={() => setExportPanel(null)}
        />
      )}
    </div>
  );
}

// ─────────── ROOT ───────────

// A storage helper that tries window.storage first, falls back to localStorage.
// Both are wrapped in try/catch so we never crash regardless of environment.
const safeStorage = {
  async get(key) {
    try {
      if (typeof window !== 'undefined' && window.storage) {
        const r = await window.storage.get(key);
        if (r && r.value) return r.value;
      }
    } catch (e) { /* fall through */ }
    try {
      if (typeof localStorage !== 'undefined') {
        const v = localStorage.getItem(key);
        if (v) return v;
      }
    } catch (e) { /* fall through */ }
    return null;
  },
  async set(key, value) {
    let ok = false;
    try {
      if (typeof window !== 'undefined' && window.storage) {
        await window.storage.set(key, value);
        ok = true;
      }
    } catch (e) { /* fall through */ }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
        ok = true;
      }
    } catch (e) { /* fall through */ }
    return ok;
  },
  async delete(key) {
    try { if (window.storage) await window.storage.delete(key); } catch (e) {}
    try { if (localStorage) localStorage.removeItem(key); } catch (e) {}
  },
};

// ─────────── SAVE SLOTS ───────────
// Multi-save model: each charter lives at `factor_save_<id>` with a JSON
// blob of `{ gs, phase, savedAt }`. A separate `factor_saves_index` lists
// the slots with summary metadata for the title-screen roster. Legacy single
// `factor_save` is migrated into a slot on first load.

const SAVES_INDEX_KEY = 'factor_saves_index';
const slotKey = (id) => `factor_save_${id}`;
const newSlotId = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

const summariseSlot = (id, gs, savedAt) => ({
  id,
  name: gs.player?.name || 'Unknown Factor',
  day: gs.day,
  daysRemaining: gs.daysRemaining,
  location: gs.location,
  lastSavedAt: savedAt,
  // playthroughId is the cross-device identifier — included in the summary
  // so the title screen can dedupe local-vs-remote rosters by it.
  playthroughId: gs.playthroughId || null,
  charterClosed: gs.charterClosed ? { outcome: gs.charterClosed.outcome, destiny: gs.charterClosed.destiny, day: gs.charterClosed.day } : null,
});

async function loadSavesIndex() {
  const raw = await safeStorage.get(SAVES_INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

async function persistSavesIndex(index) {
  await safeStorage.set(SAVES_INDEX_KEY, JSON.stringify(index));
}

// One-shot migration: if there is no index but a legacy single save exists,
// promote it into a slot so the player keeps their charter. The legacy key
// is removed after the slot is written so it can't resurrect if the player
// later deletes the migrated slot.
async function migrateLegacyIfNeeded(index) {
  if (index.length > 0) return index;
  const legacy = await safeStorage.get('factor_save');
  if (!legacy) return index;
  try {
    const parsed = JSON.parse(legacy);
    if (!parsed.gs || !parsed.gs.player) return index;
    const id = `legacy-${Date.now()}`;
    const ok = await safeStorage.set(slotKey(id), legacy);
    if (!ok) return index;
    const entry = summariseSlot(id, parsed.gs, parsed.savedAt || Date.now());
    const next = [entry];
    await persistSavesIndex(next);
    await safeStorage.delete('factor_save');
    return next;
  } catch (e) { return index; }
}

export default function FactorsCharter() {
  const [phase, setPhase] = useState('loading');
  const [gs, setGs] = useState(null);
  const [savesIndex, setSavesIndex] = useState([]);
  const [activeSaveId, setActiveSaveId] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const viewportMode = useViewportMode();
  const sync = useSyncState(activeSaveId);
  const online = useOnlineStatus();
  const swUpdated = useSwUpdate();
  const [pendingConflict, setPendingConflict] = useState(null);  // { localGs, remoteRecord }
  // Remote charter manifests under the device's factor key. Populated on
  // title-phase entry. Each entry is { id, day, daysRemaining, location,
  // factorName, savedAt, version, charterClosed? }. Title screen filters
  // out entries whose id matches a local slot's playthroughId, then surfaces
  // the remainder as "available on this account but not on this device."
  const [remoteCharters, setRemoteCharters] = useState([]);
  const [remoteLoading, setRemoteLoading] = useState(false);

  // Live-gs ref so async callbacks (notably pull-on-launch) don't operate
  // against a stale closure if the player advanced the day before the
  // network request returned.
  const gsRef = useRef(gs);
  useEffect(() => { gsRef.current = gs; });

  // Mount: load index, run legacy migration, land on title.
  useEffect(() => {
    (async () => {
      let index = await loadSavesIndex();
      index = await migrateLegacyIfNeeded(index);
      setSavesIndex(index);
      setPhase('title');
    })();
  }, []);

  // Persist whenever the in-game state changes — into the active slot only.
  useEffect(() => {
    if (!gs || !activeSaveId || phase === 'loading' || phase === 'title') return;
    let cancelled = false;
    (async () => {
      const savedAt = Date.now();
      const ok = await safeStorage.set(slotKey(activeSaveId), JSON.stringify({ gs, phase, savedAt }));
      if (!ok || cancelled) return;
      setLastSavedAt(savedAt);
      sync.triggerPush(gs);
      const entry = summariseSlot(activeSaveId, gs, savedAt);
      setSavesIndex(prev => {
        const filtered = prev.filter(s => s.id !== activeSaveId);
        const next = [entry, ...filtered];
        persistSavesIndex(next);
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [gs, phase, activeSaveId]);

  // Pull on launch when sync is enabled. Uses detectConflict to decide:
  //   'none'     — no remote change since last sync; do nothing.
  //   'pull'     — silently replace local with cloud (preserving local aiLog).
  //   'conflict' — both diverged; show ConflictModal.
  //   'push'     — remote missing or stale; push local to seed/restore.
  useEffect(() => {
    if (!gs || !gs.playthroughId) return;
    let cancelled = false;
    (async () => {
      const result = await sync.pullNow(gs.playthroughId);
      if (cancelled) return;
      // Re-read live gs after the network round-trip — the player may have
      // advanced day(s) while the request was in flight. Decisions and writes
      // must use this snapshot, not the closed-over `gs` from effect-run time.
      const liveGs = gsRef.current;
      if (result.status === 'fetched') {
        const pointer = sync.pointer();
        const decision = detectConflict({
          local: { day: liveGs?.day || 0 },
          remote: { version: result.remote.version, day: result.remote.body?.day || 0 },
          lastKnown: pointer ? { version: pointer.lastKnownCloudVersion, day: pointer.lastKnownDay || 0 } : null,
        });
        if (decision === 'pull') {
          // Silent pull: cloud body becomes local state, preserving aiLog.
          setGs(sync.applyPull(liveGs, result.remote.body));
          sync.writePointer({
            lastKnownCloudVersion: result.remote.version,
            lastSyncAt: result.remote.savedAt,
            lastKnownDay: result.remote.body?.day || 0,
          });
        } else if (decision === 'conflict') {
          // Cancel any pending debounced push so it doesn't fire while the
          // player is choosing — would race with the resolution and
          // overwrite the cloud version they're picking between.
          sync.cancelPendingPush();
          setPendingConflict({ localGs: liveGs, remoteRecord: result.remote });
        } else if (decision === 'push') {
          sync.pushNow(liveGs);
        }
        // 'none' → no-op
      } else if (result.status === 'push') {
        // 404 from server — local has data the cloud never saw, seed it.
        sync.pushNow(liveGs);
      }
    })();
    return () => { cancelled = true; };
  }, [gs?.playthroughId]);  // re-run if the synced ID changes (e.g. on a fresh charter or remote hydration)

  const handleNewGame = (name) => {
    const id = newSlotId();
    setActiveSaveId(id);
    setGs(makeInitialState(name));
    setPhase('opening');
  };

  const handleContinue = async (slotId) => {
    const raw = await safeStorage.get(slotKey(slotId));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.gs) return;
      setActiveSaveId(slotId);
      setGs(ensureShape(parsed.gs));
      setLastSavedAt(parsed.savedAt || Date.now());
      setPhase(parsed.phase || 'game');
    } catch (e) { /* corrupted slot; ignore */ }
  };

  const handleRestore = (restoredGs) => {
    const id = newSlotId();
    setActiveSaveId(id);
    setGs(ensureShape(restoredGs));
    setPhase('game');
  };

  const handleDeleteSlot = async (slotId) => {
    await safeStorage.delete(slotKey(slotId));
    const next = savesIndex.filter(s => s.id !== slotId);
    await persistSavesIndex(next);
    setSavesIndex(next);
    if (activeSaveId === slotId) setActiveSaveId(null);
  };

  // Hydrate a remote-only charter into a fresh local slot, then drop into
  // game. The next save tick will push back to the same KV record (same
  // playthroughId), so the cloud→local handoff is idempotent. The local aiLog
  // starts empty for this device — synced payloads strip aiLog by design.
  const handleResumeRemote = async (playthroughId) => {
    const result = await sync.pullCharterById(playthroughId);
    if (result.status !== 'ok' || !result.body) return;
    const id = newSlotId();
    // Seed the new slot's sync pointer with the cloud metadata just pulled.
    // Without it the next launch's detectConflict sees lastKnown === null and
    // fires a false-positive conflict modal for a charter that is in step
    // with the cloud. The sync hook is still keyed to the previous slot at
    // this point (setActiveSaveId hasn't re-rendered), so write the slot's
    // pointer key directly.
    try {
      window.localStorage.setItem(`factor_save_${id}_sync`, JSON.stringify({
        lastKnownCloudVersion: result.version,
        lastSyncAt: result.savedAt,
        lastKnownDay: result.body?.day || 0,
      }));
    } catch (e) { /* best-effort — worst case is the old conservative conflict */ }
    setActiveSaveId(id);
    setGs(ensureShape(result.body));
    setPhase('game');
    // Drop this entry from the remote-only list — it now exists locally.
    setRemoteCharters(prev => prev.filter(c => c.id !== playthroughId));
  };

  // Refresh the remote charter list whenever we land on the title screen.
  // Cheap (one KV.list under the hood); keeps cross-device adds visible
  // without requiring a hard reload.
  useEffect(() => {
    if (phase !== 'title') return;
    let cancelled = false;
    setRemoteLoading(true);
    (async () => {
      const result = await sync.pullFactorIndex();
      if (cancelled) return;
      setRemoteCharters(Array.isArray(result.charters) ? result.charters : []);
      setRemoteLoading(false);
    })();
    return () => { cancelled = true; };
  }, [phase]);

  const handleReturnToTitle = () => {
    setActiveSaveId(null);
    setPhase('title');
  };

  // The charter has closed; take up a successor's charter in the same slot.
  // World state persists (outpost, brigantine, standings, household,
  // acquaintances); clock + quota + Indiaman cycle reset; a fresh Director
  // letter announces the appointment.
  const handleSuccession = (name) => {
    if (!gs || !gs.charterClosed) return;
    const cleanName = (name || '').trim() || 'A New Hand';
    setGs(prev => makeSuccessorState(prev, cleanName));
    setPhase('game');
  };

  // Renew the same Factor's charter for another three years. Available when
  // the charter closed in success or partial completion (failure → recall;
  // no renewal). The Court promotes the Factor to Senior Factor.
  const handleRenewal = () => {
    if (!gs || !gs.charterClosed) return;
    if (gs.charterClosed.outcome === 'failure') return;
    setGs(prev => makeRenewedState(prev));
    setPhase('game');
  };

  if (phase === 'loading') {
    return <Page><Loading msg="Unrolling the chart" /></Page>;
  }

  if (phase === 'title') {
    // Charters available on the cloud under this device's factor key but
    // without a local slot. Dedupe by playthroughId — anything already
    // local is shown in the standard roster instead.
    const localPlaythroughIds = new Set(
      savesIndex.map(s => s.playthroughId).filter(Boolean)
    );
    const remoteOnlyCharters = remoteCharters.filter(c => !localPlaythroughIds.has(c.id));
    return (
      <Page>
        <AmbientStatus online={online} swUpdated={swUpdated} />
        <TitleScreen
          saves={savesIndex}
          remoteOnlyCharters={remoteOnlyCharters}
          remoteLoading={remoteLoading}
          factorKey={readFactorKey()}
          onNewGame={handleNewGame}
          onContinue={handleContinue}
          onRestore={handleRestore}
          onDeleteSlot={handleDeleteSlot}
          onResumeRemote={handleResumeRemote}
        />
      </Page>
    );
  }

  if (phase === 'opening') {
    return (
      <Page>
        <OpeningSequence
          name={gs.player.name}
          onComplete={() => {
            setGs(prev => ({
              ...prev,
              seenOpening: true,
              journal: [{ day: 1, entry: 'Took up the post at Bayan-Kor. Wilbraham\u2019s papers tied with twine. Read tomorrow.' }],
            }));
            setPhase('game');
          }}
        />
      </Page>
    );
  }

  return (
    <>
      <AmbientStatus online={online} swUpdated={swUpdated} />
      <GameHub gs={gs} setGs={setGs} lastSavedAt={lastSavedAt} onReturnToTitle={handleReturnToTitle} onSuccession={handleSuccession} onRenewal={handleRenewal} viewportMode={viewportMode} sync={sync} />
      {pendingConflict && (
        <ConflictModal
          localGs={pendingConflict.localGs}
          remoteRecord={pendingConflict.remoteRecord}
          onResolve={(side) => {
            if (side === 'local') {
              // Auto-export the cloud loser, then push local to overwrite cloud.
              sync.exportManuscript(pendingConflict.remoteRecord.body, 'cloud-discarded');
              sync.pushNow(pendingConflict.localGs);
            } else {
              // Auto-export the local loser, then accept cloud as new state
              // (preserving local aiLog).
              sync.exportManuscript(pendingConflict.localGs, 'local-discarded');
              setGs(sync.applyPull(pendingConflict.localGs, pendingConflict.remoteRecord.body));
              sync.writePointer({
                lastKnownCloudVersion: pendingConflict.remoteRecord.version,
                lastSyncAt: pendingConflict.remoteRecord.savedAt,
                lastKnownDay: pendingConflict.remoteRecord.body?.day || 0,
              });
            }
            setPendingConflict(null);
          }}
        />
      )}
    </>
  );
}
