// Hook aging via a sidecar timestamp map, gs.hookMeta: { [hookText]: openedDay }.
// gs.hooks stays a plain string[] — its text is already the canonical identity
// used by every closeHook / closeHookText filter — so this adds the one new
// fact (when a thread was first noted) without touching the ~8 push/filter
// sites that operate on the string array. Reconciled in tickDays and on load.

// Returns a new meta map: stamp any current hook not yet known with `day`,
// and drop meta entries whose hook is no longer open (so a closed thread
// doesn't leak, and a re-raised one re-stamps fresh). Pure.
export function reconcileHookMeta(hooks, meta, day) {
  const list = Array.isArray(hooks) ? hooks : [];
  const prev = meta && typeof meta === 'object' ? meta : {};
  const next = {};
  for (const text of list) {
    if (typeof text !== 'string') continue;
    next[text] = Object.prototype.hasOwnProperty.call(prev, text) ? prev[text] : day;
  }
  return next;
}

// Days a thread has been open. null when untracked (no stamp yet) or when the
// stamp is in the future (clock went backwards — defensive).
export function hookAge(text, meta, day) {
  const opened = meta && meta[text];
  if (typeof opened !== 'number') return null;
  const age = day - opened;
  return age >= 0 ? age : null;
}

// Threshold past which an open thread reads as neglected.
export const STALE_AFTER_DAYS = 120;

// A short period-voice marginal note on a thread's age, or null when too
// fresh to remark on. Used under each hook in the OPEN THREADS list.
export function hookAgeNote(text, meta, day) {
  const age = hookAge(text, meta, day);
  if (age == null || age < 30) return null;
  if (age >= STALE_AFTER_DAYS) {
    return { text: `a matter long left — these ${age} days`, stale: true };
  }
  return { text: `noted ${age} days past`, stale: false };
}

// How many open threads have gone stale — for a one-line nudge in the panel.
export function staleHookCount(hooks, meta, day) {
  const list = Array.isArray(hooks) ? hooks : [];
  return list.reduce((n, text) => {
    const age = hookAge(text, meta, day);
    return n + (age != null && age >= STALE_AFTER_DAYS ? 1 : 0);
  }, 0);
}
