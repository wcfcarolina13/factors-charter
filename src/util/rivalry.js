// Pure rivalry logic — registries, initial state, and (in subsequent tasks)
// scheduling, pressure formula, baseline trajectory functions. React-free.
//
// Companion file: ./price-windows.js for arbitrage window arithmetic.

export const RIVAL_KEYS = ['hardacre', 'terborch', 'lowji'];

export function makeInitialRivals() {
  return {
    hardacre: {
      name: 'Mr. Hardacre',
      station: 'Bencoolen',
      faction: 'company',
      pepper: 0,
      cinnamon: 0,
      standing: 50,
      state: 'steady',
      eventsFired: [],
      lastEventDay: 0,
    },
    terborch: {
      name: 'Mynheer ter Borch',
      station: 'Port St. Eustace',
      faction: 'dutch',
      standing: 50,
      state: 'steady',
      eventsFired: [],
      lastEventDay: 0,
    },
    lowji: {
      name: 'Mr. Lowji Nusserwanji',
      station: 'Bombay',
      faction: null,
      standing: 50,
      state: 'steady',
      eventsFired: [],
      lastEventDay: 0,
    },
  };
}

// Per-rival metadata. `baselineFn` is filled in below after the functions are
// declared. `intelChannel` ties each rival to one intel-buy sender.
export const RIVALS_REGISTRY = [
  { key: 'hardacre', intelChannel: 'brotherhood' },
  { key: 'terborch', intelChannel: 'vizier' },
  { key: 'lowji',    intelChannel: 'cama' },
];

// Baseline trajectory functions. Called from tickDays each Indiaman call.
// Each function MUTATES the rival object in place — consistent with the
// project's existing tickDays mutation pattern.

// Hardacre: 75 cwt pepper + 37 cwt cinnamon per Indiaman call (70+5 and
// 35+2). Six calls → 450/222 — well ahead of quota (400/200). Existing
// pattern from factors_charter.jsx:1134.
export function hardacreBaseline(rival, ctx) {
  const visits = ctx?.indiamanVisits ?? 0;
  rival.pepper   = Math.round(70 * visits + visits * 5);
  rival.cinnamon = Math.round(35 * visits + visits * 2);
}

// Ter Borch: drifts standing toward 55 (slight positive — VOC favour grows
// with each Indiaman returning to Eustace). 1-point drift per call.
export function terBorchBaseline(rival, ctx) {
  const visits = ctx?.indiamanVisits ?? 0;
  if (visits <= 0) return;
  // Move 1 point toward 55, capped at [0, 100].
  if (rival.standing < 55) rival.standing = Math.min(100, rival.standing + 1);
  else if (rival.standing > 55) rival.standing = Math.max(0, rival.standing - 1);
}

// Lowji: drifts toward 60 (boom-leaning — country traders made faster
// fortunes than Company servants). 2-point drift per call.
export function lowjiBaseline(rival, ctx) {
  const visits = ctx?.indiamanVisits ?? 0;
  if (visits <= 0) return;
  if (rival.standing < 60) rival.standing = Math.min(100, rival.standing + 2);
  else if (rival.standing > 60) rival.standing = Math.max(0, rival.standing - 1);
}

// Wire baseline functions into the registry. After all three are bound,
// freeze the registry and its entries to prevent downstream accidental
// mutation. RIVAL_KEYS gets the same treatment for symmetry.
RIVALS_REGISTRY[0].baselineFn = hardacreBaseline;
RIVALS_REGISTRY[1].baselineFn = terBorchBaseline;
RIVALS_REGISTRY[2].baselineFn = lowjiBaseline;

// Freeze entries individually then the array, AFTER baselineFn wiring.
for (const entry of RIVALS_REGISTRY) Object.freeze(entry);
Object.freeze(RIVALS_REGISTRY);
Object.freeze(RIVAL_KEYS);

// Computes the 0-100 rivalPressure scalar consumed by makeQuarterlyNagLetter
// to shift its tone band. Inputs:
//   - Hardacre tonnage relative to player quota progress
//   - terborch / lowji standing relative to baseline 50
//   - recent-event modifiers in gs.rivalPressureModifiers, each linearly
//     decaying over its lifetime
//
// Output is clamped to [0, 100].
export function computeRivalPressure(gs) {
  const rivals = gs?.rivals;
  if (!rivals) return 50;

  let pressure = 50;

  // Hardacre tonnage axis. If Hardacre is significantly ahead, +10 per
  // commodity; if behind, -10 per commodity.
  const ourPep = gs.quotas?.pepper?.have   ?? 0;
  const ourCin = gs.quotas?.cinnamon?.have ?? 0;
  if (rivals.hardacre.pepper   > ourPep + 30) pressure += 10;
  else if (rivals.hardacre.pepper   < ourPep - 30) pressure -= 10;
  if (rivals.hardacre.cinnamon > ourCin + 15) pressure += 10;
  else if (rivals.hardacre.cinnamon < ourCin - 15) pressure -= 10;

  // ter Borch / Lowji standing axis. Each rival adds up to ±5 from baseline.
  pressure += 5 * ((rivals.terborch.standing - 50) / 50);
  pressure += 5 * ((rivals.lowji.standing    - 50) / 50);

  // Recent-event modifiers with linear decay over their lifetime.
  const day = gs.day ?? 0;
  for (const mod of (gs.rivalPressureModifiers || [])) {
    const elapsed = day - mod.fromDay;
    if (elapsed < 0 || elapsed >= mod.lifetimeDays) continue;
    const remaining = 1 - (elapsed / mod.lifetimeDays);
    pressure += mod.delta * remaining;
  }

  return Math.max(0, Math.min(100, Math.round(pressure)));
}
