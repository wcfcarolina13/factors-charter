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

// Windows currently bearing on a port+commodity+side. Same matching rules
// as priceWindowMult; used by the UI to attribute a moved market ("the fire
// at Hardacre's godown") instead of leaving the player guessing.
export function activeWindowsFor(gs, portKey, commodity, side) {
  const windows = gs?.priceWindows;
  if (!Array.isArray(windows)) return [];
  const day = gs?.day ?? 0;
  return windows.filter(w =>
    w.port === portKey &&
    w.commodity === commodity &&
    w.expiresDay > day &&
    (side === 'sell' ? w.sellMult != null : w.buyMult != null)
  );
}

// 'low' | 'par' | 'high' — today's price against the port's own fair rate
// (base × port multiplier, before daily flux and event windows). The daily
// flux is ±10%, so ±6% picks up real drift without tagging every day.
export function priceDrift(price, fairPrice) {
  if (!(fairPrice > 0)) return 'par';
  const r = price / fairPrice;
  if (r <= 0.94) return 'low';
  if (r >= 1.06) return 'high';
  return 'par';
}
