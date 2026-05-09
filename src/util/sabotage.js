// Pure sabotage logic. React-free. Companion to ./rivalry.js.
// Three rivals, three two-step arcs. Resolution is deterministic given
// (rivalKey, gs, randFn). See docs/superpowers/specs/2026-05-09-sabotage-arcs-design.md.

import { computeRivalPressure } from './rivalry.js';

export const SABOTAGE_RIVALS = ['hardacre', 'terborch', 'lowji'];

// Per-rival, per-method cost / base success rate / rapport-axis mapping.
// successCutoff = baseSuccess + min(25, max(0, rep - rapportFloor) / 2).
export const SABOTAGE_TABLE = {
  hardacre: {
    channel:       'brotherhood',
    rapportRep:    'pirates',
    rapportFloor:  50,
    methods: {
      commission: { cost: 500, baseSuccess: 60 },
      negotiate:  { cost: 300, baseSuccess: 40 },
    },
  },
  terborch: {
    channel:       'vizier',
    rapportRep:    'rajah',
    rapportFloor:  50,
    methods: {
      commission: { cost: 700, baseSuccess: 60 },
      negotiate:  { cost: 450, baseSuccess: 40 },
    },
  },
  lowji: {
    channel:       'cama',
    rapportRep:    'company',
    rapportFloor:  50,
    methods: {
      commission: { cost: 600, baseSuccess: 60 },
      negotiate:  { cost: 400, baseSuccess: 40 },
    },
  },
};

for (const k of Object.keys(SABOTAGE_TABLE)) {
  Object.freeze(SABOTAGE_TABLE[k].methods.commission);
  Object.freeze(SABOTAGE_TABLE[k].methods.negotiate);
  Object.freeze(SABOTAGE_TABLE[k].methods);
  Object.freeze(SABOTAGE_TABLE[k]);
}
Object.freeze(SABOTAGE_TABLE);
Object.freeze(SABOTAGE_RIVALS);

// Maps rival -> the persistent "ever bought intel" flag (set wherever
// `<rival>IntelPlant` is set). The volatile `*IntelPlant` flag is consumed
// when its anticipated event fires, so we use a parallel non-volatile
// signal for the channel-relationship gate.
const INTEL_EVER_BOUGHT_FLAG = {
  hardacre: 'hardacreIntelEverBought',
  terborch: 'terborchIntelEverBought',
  lowji:    'lowjiIntelEverBought',
};

export function sabotageChannel(rivalKey) {
  return SABOTAGE_TABLE[rivalKey]?.channel ?? null;
}

// Eligibility predicate for posting the Step 1 letter.
// All gates must pass; see spec §5.
export function canOfferSabotage(rivalKey, gs) {
  if (!SABOTAGE_TABLE[rivalKey]) return false;
  if (gs?.charterClosed) return false;
  if ((gs?.day ?? 0) < 365) return false;
  if (gs?.flags?.[`sabotage_${rivalKey}_offered`] === true) return false;
  if (gs?.rivals?.[rivalKey]?.state === 'broken') return false;
  if (computeRivalPressure(gs) < 60) return false;
  if (gs?.flags?.[INTEL_EVER_BOUGHT_FLAG[rivalKey]] !== true) return false;
  return true;
}

// Resolves the Step 2 outcome. Roll r in [0, 100):
//   r < successCutoff               → 'success'
//   r < successCutoff + 20          → 'partial'
//   else                            → 'failure'
// successCutoff = baseSuccess + rapport, where rapport caps at +25 pp.
// randFn is injectable so tests can pin outcomes deterministically.
export function resolveSabotage(rivalKey, gs, opts = {}) {
  const { method = 'commission', randFn = Math.random } = opts;
  const cfg = SABOTAGE_TABLE[rivalKey];
  if (!cfg) return 'failure';
  const m = cfg.methods[method];
  if (!m) return 'failure';
  const rep = gs?.reputation?.[cfg.rapportRep] ?? 0;
  const rapport = Math.min(25, Math.max(0, rep - cfg.rapportFloor) / 2);
  const successCutoff = m.baseSuccess + rapport;
  const roll = randFn() * 100;
  if (roll < successCutoff) return 'success';
  if (roll < successCutoff + 20) return 'partial';
  return 'failure';
}
