// Pure logic for arbitrage price-window arithmetic. Used by priceFor in
// factors_charter.jsx to apply event-driven port/commodity multipliers.

export function priceWindowMult(gs, portKey, commodity, side) {
  const windows = gs?.priceWindows;
  if (!Array.isArray(windows) || windows.length === 0) return 1;
  const day = gs?.day ?? 0;
  let mult = 1;
  for (const w of windows) {
    if (w.port !== portKey) continue;
    if (w.commodity !== commodity) continue;
    if (w.expiresDay <= day) continue;
    const sideMult = side === 'sell' ? w.sellMult : w.buyMult;
    if (sideMult == null) continue;
    mult *= sideMult;
  }
  return mult;
}

export function pruneExpiredWindows(windows, day) {
  if (!Array.isArray(windows)) return [];
  return windows.filter(w => w.expiresDay > day);
}
