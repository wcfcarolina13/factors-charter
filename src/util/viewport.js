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
