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

// Charter-end prose coda. Returns a short paragraph hinting at the rougher
// matters of the past three years, or '' when there is nothing to remark on.
// The tone shifts with the destiny — honourable retirements get a measured
// "the Court has chosen not to record" line; the Brotherhood path gets Maas's
// plain acknowledgement; failure destinies get the additional weight.
//
// The string returned has a leading double-newline so it can be concatenated
// to the body of the charter-end letter without further formatting.
const HONOURABLE = new Set(['crown-knighthood', 'country-estate', 'bayan-kor-seat', 'senior-factor']);
const FAILURE    = new Set(['quiet-retirement', 'recall-disgrace']);

export function sabotageCoda(destiny, count) {
  const n = Math.max(0, Math.floor(count || 0));
  if (n <= 0) return '';
  const intensifier = n >= 2 ? 'matters' : 'a matter';
  if (destiny === 'brotherhood-retirement') {
    return `\n\nWe note, between us, that yr. hand in ${intensifier} of the strait was the steadier for being the quieter. The Captain who knows this is not the Captain who writes it down.`;
  }
  if (HONOURABLE.has(destiny)) {
    return `\n\nThere are ${intensifier} of yr. tenure which the Court has not seen fit to enter on the record, and which yr. honour will permit us to leave undescribed. The Standing Committee is not, in such things, an exact bookkeeper.`;
  }
  if (FAILURE.has(destiny)) {
    return `\n\nWe shall not detail the ${intensifier} of yr. private commissioning that have also been brought to the Court's attention. The reckoning above is the milder of the two accountings before us.`;
  }
  return '';
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
