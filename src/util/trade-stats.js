// Per-commodity running trade aggregates and the Ledger's "Trade Reckoning"
// rows. Pure logic, no React. State lives at gs.tradeStats:
//   { [commodity]: { boughtQty, boughtCost, soldQty, soldProceeds } }
// boughtCost includes duty paid; soldProceeds is net of duty — the
// reckoning answers "what did this trade actually return", so the Dutch
// take counts against the margin.

const EMPTY = { boughtQty: 0, boughtCost: 0, soldQty: 0, soldProceeds: 0 };

// Returns a new stats object with one trade folded in. amount is the total
// money moved: cost including duty for buys, net proceeds for sells.
export function recordTrade(stats, { kind, commodity, qty, amount }) {
  if (!commodity || !(qty > 0) || !(amount >= 0)) return stats || {};
  const prev = (stats && stats[commodity]) || EMPTY;
  const entry = kind === 'buy'
    ? { ...prev, boughtQty: prev.boughtQty + qty, boughtCost: prev.boughtCost + amount }
    : { ...prev, soldQty: prev.soldQty + qty, soldProceeds: prev.soldProceeds + amount };
  return { ...(stats || {}), [commodity]: entry };
}

// Display rows for every commodity with any activity, best realized return
// first. Realized profit reckons sold units at the average buy price; goods
// got without purchase (starting cargo, prizes, letter outcomes) have no
// cost basis and reckon at their full proceeds, flagged costBasisKnown:false.
export function reckonRows(stats) {
  return Object.entries(stats || {})
    .filter(([, s]) => s && (s.boughtQty > 0 || s.soldQty > 0))
    .map(([commodity, s]) => {
      const avgBuy = s.boughtQty > 0 ? s.boughtCost / s.boughtQty : null;
      const avgSell = s.soldQty > 0 ? s.soldProceeds / s.soldQty : null;
      const realized = s.soldQty > 0
        ? Math.round(s.soldProceeds - (avgBuy !== null ? s.soldQty * avgBuy : 0))
        : 0;
      return {
        commodity,
        boughtQty: s.boughtQty,
        boughtCost: s.boughtCost,
        avgBuy,
        soldQty: s.soldQty,
        soldProceeds: s.soldProceeds,
        avgSell,
        realized,
        costBasisKnown: s.boughtQty > 0,
      };
    })
    .sort((a, b) => b.realized - a.realized);
}

// Sum of realized returns across all commodities.
export function reckonTotal(stats) {
  return reckonRows(stats).reduce((sum, r) => sum + r.realized, 0);
}
