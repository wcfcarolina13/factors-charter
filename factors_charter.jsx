import React, { useState, useEffect, useRef } from 'react';

// ═══════════════════════════════════════════════════════════════
//  THE FACTOR'S CHARTER — playable prototype
//  A text-based colonial trading game in the spirit of
//  Robinson Crusoe, Sunless Sea, and House Hlaalu.
// ═══════════════════════════════════════════════════════════════

// ─────────── DATA ───────────

// `weight` is stowage in cwt-equivalents — what a unit of this commodity
// occupies in the hold. Pepper sets the scale at 1.0.
const COMMODITIES = {
  pepper:     { name: 'Pepper',     unit: 'cwt',    basePrice: 12, weight: 1.0  },
  cinnamon:   { name: 'Cinnamon',   unit: 'cwt',    basePrice: 18, weight: 1.0  },
  calico:     { name: 'Calico',     unit: 'bolt',   basePrice: 8,  weight: 0.4  },
  silver:     { name: 'Silver',     unit: 'oz',     basePrice: 25, weight: 0.02 },
  sandalwood: { name: 'Sandalwood', unit: 'log',    basePrice: 6,  weight: 1.5  },
  opium:      { name: 'Opium',      unit: 'chest',  basePrice: 45, weight: 0.6  },
  rice:       { name: 'Rice',       unit: 'sack',   basePrice: 3,  weight: 1.0  },
  rum:        { name: 'Rum',        unit: 'barrel', basePrice: 7,  weight: 2.0  },
  saltpetre:  { name: 'Saltpetre',  unit: 'cask',   basePrice: 22, weight: 1.2  },
};

// Each port has finite stocks of what it sells, replenishing over time.
// `stockMax` is the warehouse cap; `restock` is the per-day replenishment rate
// (fractional, accumulated). Buying depletes; tickDays restores up to the cap.
const PORTS = {
  'Bayan-Kor': {
    name: 'Bayan-Kor',
    blurb: 'Your station. A thatched godown, a leaky dock, and the Rajah\u2019s palace on the hill.',
    daysFromHome: 0, isHome: true,
    sells: { rice: 0.85, sandalwood: 0.75 },
    stockMax: { rice: 40, sandalwood: 18 },
    restock:  { rice: 0.5, sandalwood: 0.2 },
    buys:  { calico: 1.3, rum: 1.4, silver: 1.2 },
    faction: 'rajah',
  },
  'Kota Pinang': {
    name: 'Kota Pinang',
    blurb: 'A pepper port up the strait. The Sultan tolerates Europeans, and taxes them.',
    daysFromHome: 3,
    sells: { pepper: 0.7, cinnamon: 0.85, sandalwood: 0.9 },
    stockMax: { pepper: 80, cinnamon: 30, sandalwood: 22 },
    restock:  { pepper: 0.7, cinnamon: 0.3, sandalwood: 0.2 },
    buys:  { calico: 1.4, opium: 1.5, silver: 1.1, rum: 1.2 },
    faction: 'rajah',
    yard: 'middling',
    yardBlurb: 'The Sultan\u2019s harbormaster keeps men who know their trade. The work is fair, the wait reasonable.',
  },
  'Port St. Eustace': {
    name: 'Port St. Eustace',
    blurb: 'A Dutch harbor, whitewashed and orderly. Their factor watches you closely.',
    daysFromHome: 5,
    sells: { calico: 0.75, opium: 0.85, saltpetre: 0.8 },
    stockMax: { calico: 60, opium: 14, saltpetre: 24 },
    restock:  { calico: 0.5, opium: 0.15, saltpetre: 0.3 },
    buys:  { pepper: 1.4, cinnamon: 1.5, sandalwood: 1.2, silver: 1.05 },
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
    buys:  { rum: 1.7, calico: 1.3, rice: 1.5 },
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
    sells: { silver: 0.55, opium: 0.6, saltpetre: 0.55 },
    stockMax: { silver: 220, opium: 24, saltpetre: 32 },
    restock:  { silver: 1.7, opium: 0.25, saltpetre: 0.35 },
    buys:  { rum: 1.9, calico: 1.5, rice: 1.6 },
    faction: 'pirates',
    yard: 'rough',
    yardBlurb: 'A wreckers\u2019 slip among the palms \u2014 driftwood, prize timber, and what the lagoon will give up.',
  },
};

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
    effect: 'Reduces the chance of incident in your absence.',
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
    effect: 'Reduces piracy risk on voyages and incidents at home.',
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

// ─────────── HELPERS ───────────

const hashCode = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
};

const priceFor = (portKey, commodity, day) => {
  const port = PORTS[portKey];
  const base = COMMODITIES[commodity].basePrice;
  const mult = port.sells?.[commodity] ?? port.buys?.[commodity] ?? 1;
  const fluct = ((hashCode(`${day}-${portKey}-${commodity}`) % 21) - 10) / 100;
  return Math.max(1, Math.round(base * mult * (1 + fluct)));
};

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
    mult *= 0.5;
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

const fmtCwt = (n) => {
  // Tidy display: integer if it rounds, otherwise one decimal.
  if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
  return n.toFixed(1);
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
  const base = port?.daysFromHome || 1;
  const hasShipwright = !!gs.outpost?.buildings?.shipwright?.built;
  const t = SHIP_TYPES[gs.ship?.type] || SHIP_TYPES.pinnace;
  const shipBonus = (t.voyageBonus && base >= 4) ? t.voyageBonus : 0;
  return Math.max(1, base - (hasShipwright ? 1 : 0) - shipBonus);
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
  if (!next.flags || typeof next.flags !== 'object') next.flags = {};
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
  if (!Array.isArray(next.pendingLetterRequests)) {
    next.pendingLetterRequests = [];
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

12 June. \u2014 The Bugis prahu is in the strait again. Capt. Faulke called it a "Brotherhood trader" and would not say more. I had three barrels of rum traded out of me at gunpoint last month and have learned not to ask.

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
  lettersAuto: { nextDay: 35 },
  pendingLetterRequests: [],
  journal: [],
  letters: [directorLetter, wilbrahamPapers],
  hooks: ['The inland teak concession \u2014 ter Borch wants it.'],
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

  let subject, body;
  if (nothingYet) {
    subject = 'A First Quarterly Note';
    body = `Sir, — We open yr. file at the Court for the present charter. The first Indiaman is despatched in due course; we shall expect a return at her holds. We pray you have laid the ground.\n\nWe are mindful of the climate, the politics, and the price of plank. We are mindful also that the late Mr. Wilbraham held the post for two years on similar excuses.\n\nYr. obedt. servants, the Court of Directors.`;
  } else if (finalStretch && !onTrack) {
    subject = 'A Pointed Word';
    body = `Sir, — A reckoning at this hand: ${reckoning} The third year is upon us, and the figures are not what we are owed. The Court has the names of two replacements before it. We trust you take our meaning.\n\nYr. servants, the Court of Directors.`;
  } else if (onTrack) {
    subject = 'Yr. Progress Noted';
    body = `Sir, — Returns reckon ${reckoning} The Court is content with the present pace. Press on.\n\nYr. obedt. servants, the Court of Directors.`;
  } else {
    subject = 'A Quarterly Reminder';
    body = `Sir, — We have to remind you that the present hand finds the books at ${reckoning} The next Indiaman comes round in due course, and we shall watch what she brings.\n\nYr. servants, the Court of Directors.`;
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

// ─────────── AUTO LETTER SENDERS ───────────
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
];

function pickAutoSender(s) {
  const eligible = AUTO_SENDERS.filter(snd => !snd.gate || snd.gate(s));
  if (eligible.length === 0) return null;
  const total = eligible.reduce((a, b) => a + b.weight, 0);
  let r = Math.random() * total;
  for (const snd of eligible) {
    r -= snd.weight;
    if (r <= 0) return snd;
  }
  return eligible[eligible.length - 1];
}

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

function makeCharterEndLetter(s) {
  const outcome   = evalCharterOutcome(s);
  const totalPep  = Math.floor(s.quotas?.pepper?.have   || 0);
  const totalCin  = Math.floor(s.quotas?.cinnamon?.have || 0);

  let subject, body;
  if (outcome === 'success') {
    subject = 'Yr. Charter Honourably Concluded';
    body = `Sir, — The third year is upon us, and the file at this House is closed in yr. favour. ${totalPep} cwt of pepper and ${totalCin} cwt of cinnamon stand to yr. account, the obligation discharged in full.

The Court is well pleased. A second charter will be offered to you in the next packet, with terms more agreeable to a man who has shown what may be done at Bayan-Kor. Yr. tenth of net returns shall be lodged with yr. London agent by Lady Day.

Yr. obedt. servants, the Court of Directors.`;
  } else if (outcome === 'partial') {
    subject = 'On the Closing of Yr. Charter';
    body = `Sir, — The third year is up. The reckoning stands at ${totalPep}/400 pepper and ${totalCin}/200 cinnamon. The obligation is not discharged in full and we cannot pretend it is.

We do not propose to despatch a successor at present. There are, in this latitude, harder posts than yours and easier; you are now of an age to know which is which. We expect a written account of the difficulties, of yr. own pen, by the next homeward Indiaman.

Yr. servants, the Court of Directors.`;
  } else {
    subject = 'Yr. Recall, by the Next Packet';
    body = `Sir, — The third year is closed. We have ${totalPep} cwt of pepper and ${totalCin} cwt of cinnamon out of yr. station against an obligation we set in plain terms three years gone. The Court will not pretend at further patience.

A successor is despatched by the Indiaman next outbound. You will deliver yr. books, yr. keys, and yr. seals to him upon his landing, and take passage home in his place. The matter of yr. tenth is referred to the Standing Committee. Mr. Wilbraham's bones are in the chapel-yard at Bayan-Kor; you have at least the option of the next packet.

Yr. servants, the Court of Directors.`;
  }
  return {
    outcome,
    letter: {
      id: 5000000 + s.day,
      from: 'The Court of Directors, London',
      subject,
      body,
      responses: [
        { label: 'Acknowledge in plain terms', seed: 'no rep change' },
        { label: 'Reply with a measured account of difficulties', seed: 'company notes the case' },
        { label: 'Set the letter aside, write nothing', seed: 'silence' },
      ],
      read: false,
    },
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
      const { letter, outcome } = makeCharterEndLetter(s);
      s.letters = [...s.letters, letter];
      s.lettersGenerated = (s.lettersGenerated || 0) + 1;
      s.charterClosed = { day: s.day, outcome };
      s.awayLog.push({ day: s.day, type: 'charter-end', text: 'The third year is up. A packet from the Court closes the file.' });
    }

    // ── port stocks replenish toward their cap
    for (const [pk, p] of Object.entries(PORTS)) {
      if (!p.restock) continue;
      if (!s.portStocks[pk]) s.portStocks[pk] = { ...(p.stockMax || {}) };
      for (const [c, rate] of Object.entries(p.restock)) {
        const cap = p.stockMax?.[c] ?? 0;
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

    // ── Hodge: drunkenness roll
    const drunkChance = Math.max(0.04, (100 - s.npcs.hodge.sobriety) / 220);
    if (Math.random() < drunkChance && (s.day - s.npcs.hodge.lastDrunk) > 4) {
      const hit = 6 + Math.floor(Math.random() * 8);
      s.npcs.hodge.sobriety = Math.max(0, s.npcs.hodge.sobriety - hit);
      s.npcs.hodge.lastDrunk = s.day;
      const lines = [
        'Mr. Hodge was found insensible behind the godown.',
        'Mr. Hodge missed the morning ledger entirely; the rum was at fault.',
        'Mr. Hodge wept on Sgt. Dass\u2019s shoulder for an hour, then slept.',
        'Mr. Hodge mistook a Bugis trader for his late wife; the matter was smoothed.',
      ];
      s.awayLog.push({ day: s.day, type: 'npc', npc: 'hodge', text: lines[Math.floor(Math.random() * lines.length)] });
    } else {
      // slow recovery
      if (Math.random() < 0.3) s.npcs.hodge.sobriety = Math.min(100, s.npcs.hodge.sobriety + 1);
    }

    // ── Dass: occasional report
    if (Math.random() < 0.025) {
      const lines = [
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
      s.awayLog.push({ day: s.day, type: 'indiaman', text: `${ShipName}, of the Company, called for the returns. ${tail} A letter from the Court came by the same packet.` });
      s.indiaman = { lastVisit: s.day, nextDay: s.day + INDIAMAN_INTERVAL, visits: (s.indiaman.visits || 0) + 1, lastQuarterly: s.day };
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

    // ── Raid: opportunists at the godown. Stockade halves the chance, the
    // Barracks halves it again. The Magazine caps any single loss at 10%.
    const raidPool = ['pepper', 'cinnamon', 'silver', 'opium', 'sandalwood']
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

// Returns a full record so the caller can both use the parsed result and log
// the raw exchange: { parsed, raw, prompt, startedAt, endedAt, error }.
async function callClaude(prompt) {
  const startedAt = Date.now();
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
];

function commitmentsFor(gs) {
  if (!gs.flags) return [];
  const out = [];
  for (const c of MAJOR_COMMITMENTS) {
    const v = gs.flags[c.key];
    if (v === undefined || v === null || v === false) continue;
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

async function genVoyageEncounter(gs, fromPort, toPort) {
  const prompt = `Generate a voyage encounter at sea, sailing from ${fromPort} toward ${toPort}.
${stateContext(gs)}

SCENE CONSTRAINT: This encounter happens on the open water during the voyage, not at any port. The Factor is aboard his ship with anonymous crew (a bosun, sailors). Do NOT introduce Mr. Hodge, Sgt. Dass, the Vizier, or Reverend Pyke unless you state plainly that they have been brought aboard for this voyage. New characters (e.g. another ship's captain, a passenger, a castaway) should have period-plausible names.

Return JSON:
{
  "prose": "2-3 sentences of period prose. Concrete sensory detail. Plain observation, not metaphor. Set the scene and present a situation requiring a decision.",
  "choices": [
    { "label": "5-9 word verb phrase", "seed": "what tonally happens if chosen" },
    { "label": "5-9 word verb phrase", "seed": "what tonally happens if chosen" },
    { "label": "5-9 word verb phrase", "seed": "what tonally happens if chosen" }
  ]
}`;
  const fallback = {
    prose: 'A line of squalls runs along the horizon. The wind drops, then turns. The bosun looks to you for orders.',
    choices: [
      { label: 'Run before the weather, lose a day', seed: 'lose time but no harm' },
      { label: 'Stand on the course, trust the rigging', seed: 'risk damage for time' },
      { label: 'Reef and ride it out', seed: 'safe but slow' },
    ],
  };
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

async function genOutcome(gs, encounterProse, choice, opts = {}) {
  const isLetter = !!opts.isLetter;
  const constraintLine = isLetter
    ? `SCENE CONSTRAINT: This is the Factor writing a reply at his desk. The outcome is what proceeds from the words he writes — no travel, no scenes elsewhere, no time of consequence passing. Set "days" to 0. Do NOT damage the ship.`
    : `SCENE CONSTRAINT: The outcome must follow plainly from the encounter as set up above. Do not introduce new characters or settings unrelated to that scene. The Factor cannot meet home-station characters (Hodge, Dass, the Vizier, Reverend Pyke) outside Bayan-Kor. If the prose involves a storm, gunfire, grounding, etc., you may set shipDamage.`;
  const prompt = `In the encounter: "${encounterProse}"
The Factor chose: "${choice.label}" (${choice.seed})
${stateContext(gs)}

${constraintLine}

Generate the outcome. Return JSON:
{
  "prose": "2-3 sentences of period prose describing what happens. Concrete observation. Avoid metaphor.",
  "changes": {
    "money": integer delta (often 0; range -200 to +200),
    "days": integer days passed (${isLetter ? '0 only' : '0-3'}),
    "reputation": { "company": int, "crown": int, "rajah": int, "pirates": int, "mission": int, "dutch": int },
    "goods": { "commodity_name": int delta },
    "journal": "one-sentence note for the journal in past tense",
    "hook": "optional: a thread that may return later, or empty string",
    "shipDamage": ${isLetter ? 'null  (letters never damage the ship)' : '{ "hull": 0-40, "sails": 0-40 }  // optional; only when prose justifies'},
    "newAcquaintances": [ { "name": "...", "role": "...", "location": "...", "notes": "..." } ],
    "flags": { "key": value }
  }
}
Reputation deltas should be small (-15 to +15). Only include factions that actually shift. Goods can include any of: pepper, cinnamon, calico, silver, sandalwood, opium, rice, rum, saltpetre. Use newAcquaintances when the scene introduces a memorable named figure who could plausibly recur. Flags are sparse and should describe lasting narrative state. Omit any of the optional fields you do not need.`;
  const fallback = {
    prose: 'It plays out as you might expect, neither as well nor as ill as feared.',
    changes: { money: 0, days: isLetter ? 0 : 1, reputation: {}, goods: {}, journal: 'A day passed without consequence.', hook: '' },
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
  const fallback = {
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

async function genArrivalVignette(gs, port) {
  const prompt = `The Factor arrives at ${port}. ${PORTS[port].blurb}
${stateContext(gs)}
Return JSON:
{
  "prose": "2-3 sentences of arrival prose. Sensory, specific to this port. Period."
}`;
  const fallbackProse = `The ${port} pilot comes aboard at first light. The harbor smells of fish and woodsmoke.`;
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

async function genAwayDigest(gs, awayEvents) {
  if (!awayEvents || awayEvents.length === 0) return { result: null, log: null };
  const events = awayEvents.slice(-12).map(e => `Day ${e.day}: ${e.text}`).join('\n');
  const prompt = `The Factor returns to Bayan-Kor after a period away. In his absence, the following came to pass:

${events}

Compose a single paragraph (4-6 sentences) in the Factor\u2019s journal voice, written upon his return. He is reading the household ledger, hearing Hodge stammer through reports, and walking the compound. Period prose, dry observation, sensory detail. Do not list the events; weave them.

Return JSON: { "prose": "..." }`;
  const fallbackProse = 'Returned to find the godown standing and the ledger half-kept. The work of catching up begins tomorrow.';
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

const FONT_IMPORT = `
@import url('https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&family=IM+Fell+DW+Pica:ital@0;1&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap');
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
      .trade-row .actions { display: flex; gap: 0.3rem; flex-wrap: wrap; justify-content: flex-end; }
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

function TitleScreen({ saves, onNewGame, onContinue, onRestore, onDeleteSlot }) {
  const [name, setName] = useState('Jonathan Wexley');
  const [showRestore, setShowRestore] = useState(false);
  const [restoreText, setRestoreText] = useState('');
  const [flash, setFlash] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(null); // slot id

  const hasSaves = Array.isArray(saves) && saves.length > 0;

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
                        ? <>Charter closed{s.charterClosed.outcome ? ` — ${s.charterClosed.outcome}` : ''} &middot; {fmtAgo(s.lastSavedAt)}</>
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

function GameHub({ gs, setGs, lastSavedAt, onReturnToTitle }) {
  const [tab, setTab] = useState('journal');
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

  // The very first time the game proper begins (after the opening sequence),
  // route the player straight into the unread Director letter so they cannot miss it.
  useEffect(() => {
    if (!gs.firstLetterPresented && gs.letters.length > 0) {
      const firstUnread = gs.letters.find(l => !l.read);
      if (firstUnread) {
        setTab('letters');
        setOpenLetterId(firstUnread.id);
        setGs(prev => ({ ...prev, firstLetterPresented: true }));
      }
    }
  }, []);

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
    return next;
  };

  // Whenever days pass (sailing), check on arriving home if there's an away digest to show.
  const arriveAt = async (newGs, dest) => {
    const returningHome = dest === 'Bayan-Kor';
    const hasEvents = newGs.awayLog.length > 0;

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
        journal: [...newGs.journal, { day: newGs.day, entry: `Made landfall at ${portKey} after ${baseDays} days at sea, without incident worthy of record.` }],
      };

      await arriveAt(newGs, portKey);
    }
  };

  const handleEncounterChoice = async (choice) => {
    setPending(true);
    setPendingMsg('The hour passes');
    const { result, log } = await genOutcome(gs, encounter.prose, choice);
    setPending(false);
    if (log) setGs(prev => ({ ...prev, aiLog: pushAiLog(prev.aiLog, log) }));
    setOutcome({ ...result, encounter });
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
      // Land — apply voyage wear on top of any encounter shipDamage.
      newGs = {
        ...newGs,
        ship: applyVoyageWear(newGs.ship, totalDays),
        location: dest,
        visited: newGs.visited.includes(dest) ? newGs.visited : [...newGs.visited, dest],
        journal: [...newGs.journal, { day: newGs.day, entry: `Made landfall at ${dest} after ${totalDays} days at sea.` }],
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

  const buyGood = (commodity, qty, price) => {
    const grossCost = qty * price;
    const taxRate = portTaxRate(gs, gs.location);
    const tax = Math.round(grossCost * taxRate);
    const cost = grossCost + tax;
    if (gs.money < cost) return;
    // Hold cap: total stowage of current goods plus this purchase must fit.
    const w = COMMODITIES[commodity].weight;
    const projected = cargoWeight(gs.goods) + qty * w;
    if (projected > cargoCap(gs)) return;
    // Port stock: cannot buy more than the wharf has on hand.
    const stockHere = gs.portStocks?.[gs.location] || {};
    const available = Math.floor(stockHere[commodity] ?? Infinity);
    if (qty > available) return;
    const taxLine = tax > 0 ? `, with £${tax} duty to the Dutch` : '';
    setGs(prev => ({
      ...prev,
      money: prev.money - cost,
      goods: { ...prev.goods, [commodity]: (prev.goods[commodity] || 0) + qty },
      portStocks: {
        ...prev.portStocks,
        [prev.location]: {
          ...(prev.portStocks?.[prev.location] || {}),
          [commodity]: Math.max(0, (prev.portStocks?.[prev.location]?.[commodity] ?? 0) - qty),
        },
      },
      journal: [...prev.journal, { day: prev.day, entry: `Bought ${qty} ${COMMODITIES[commodity].unit} of ${COMMODITIES[commodity].name} at ${gs.location} for £${grossCost}${taxLine}.` }],
    }));
  };

  const sellGood = (commodity, qty, price) => {
    if ((gs.goods[commodity] || 0) < qty) return;
    const grossProceeds = qty * price;
    const taxRate = portTaxRate(gs, gs.location);
    const tax = Math.round(grossProceeds * taxRate);
    const proceeds = grossProceeds - tax;
    const taxLine = tax > 0 ? `, less £${tax} Dutch duty` : '';
    setGs(prev => ({
      ...prev,
      money: prev.money + proceeds,
      goods: { ...prev.goods, [commodity]: prev.goods[commodity] - qty },
      journal: [...prev.journal, { day: prev.day, entry: `Sold ${qty} ${COMMODITIES[commodity].unit} of ${COMMODITIES[commodity].name} at ${gs.location} for £${grossProceeds}${taxLine}.` }],
    }));
  };

  // Move goods from the ship's hold into the godown at Bayan-Kor.
  // Pepper/cinnamon lodged here count toward the London quota (computed from
  // the warehouse stock at display time, not stored separately).
  const lodgeGoods = (commodity, qty) => {
    if (gs.location !== 'Bayan-Kor') return;
    const have = gs.goods[commodity] || 0;
    if (have < 1) return;
    const w = COMMODITIES[commodity].weight || 1;
    const cap = warehouseCap(gs);
    const used = warehouseUsed(gs);
    const room = Math.max(0, cap - used);
    const byRoom = w > 0 ? Math.floor(room / w) : qty;
    const move = Math.max(0, Math.min(qty, have, byRoom));
    if (move <= 0) return;
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
      journal: [...prev.journal, { day: prev.day, entry: `Lodged ${move} ${COMMODITIES[commodity].unit} of ${COMMODITIES[commodity].name} in the godown.` }],
    }));
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
      journal: [...prev.journal, { day: prev.day, entry: `Drew ${move} ${COMMODITIES[commodity].unit} of ${COMMODITIES[commodity].name} from the godown into the hold.` }],
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

  // ─────── RENDER ───────

  if (awayDigest) {
    return <AwayDigestScreen digest={awayDigest} onContinue={handleDigestContinue} onResolveRaid={handleResolveRaid} />;
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
        <div className="ink-fade-in" style={{ maxWidth: '42rem', margin: '0 auto', padding: '3.0rem 1.5rem', width: '100%' }}>
          <div className="display text-center" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.2em', marginBottom: '0.5rem' }}>
            {encounter.type === 'voyage' ? 'AT SEA' : 'AN INCIDENT'}
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
      </Page>
    );
  }

  if (pending) {
    return <Page><Loading msg={pendingMsg} /></Page>;
  }

  const atHome = gs.location === 'Bayan-Kor';

  return (
    <Page>
      <div style={{ maxWidth: '64rem', margin: '0 auto', padding: '1.25rem 1.0rem', width: '100%' }}>
        <Header gs={gs} onReturnToTitle={onReturnToTitle} />
        <Tabs tab={tab} setTab={setTab} unread={gs.letters.filter(l => !l.read).length} atHome={atHome} />
        <div className="parchment" style={{ padding: '1.25rem', minHeight: '24rem', background: 'rgba(255,253,245,0.4)' }}>
          {tab === 'journal' && <JournalView gs={gs} arrivalProse={arrivalProse} setTab={setTab} openLetterById={openLetterById} />}
          {tab === 'ledger' && <LedgerView gs={gs} />}
          {tab === 'map' && <MapView gs={gs} sailTo={sailTo} />}
          {tab === 'port' && <PortView gs={gs} buyGood={buyGood} sellGood={sellGood} refitShip={refitShip} arrivalProse={arrivalProse} setTab={setTab} lodgeGoods={lodgeGoods} withdrawGoods={withdrawGoods} commissionBrigantine={commissionBrigantine} />}
          {tab === 'outpost' && atHome && <OutpostView gs={gs} startBuild={startBuild} expediteBuild={expediteBuild} />}
          {tab === 'letters' && <LettersView gs={gs} setGs={setGs} onRespond={handleLetterResponse} openLetterId={openLetterId} setOpenLetterId={setOpenLetterId} />}
        </div>
        <ProvisionsDrawer gs={gs} setGs={setGs} lastSavedAt={lastSavedAt} />
      </div>
    </Page>
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
                { key: 'repo',   label: 'Repository', placeholder: 'hello-world' },
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
// The IMAGINE_STYLE_PREFIX keeps illustrations consistent across the
// charter — the same hand made them all.

const IMAGINE_STYLE_PREFIX =
  '1720s logbook engraving, period woodcut style, sepia line illustration, single-color brown ink on cream parchment, period 18th century book illustration. ';

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

function IllustrationModal({ prose, onClose }) {
  const [tryImage, setTryImage] = useState(false);
  const [imgState, setImgState] = useState('idle'); // 'idle' | 'loading' | 'loaded' | 'failed'
  const [copyFlash, setCopyFlash] = useState('');
  const taRef = useRef(null);

  const cleanProse = (prose || '').replace(/\s+/g, ' ').trim().slice(0, 320);
  const fullPrompt = IMAGINE_STYLE_PREFIX + cleanProse;
  const seed = Math.abs(
    cleanProse.split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0) || 1
  );
  const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=480&height=320&nologo=true&seed=${seed}&model=flux`;

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
            <img
              src={imgUrl}
              alt="An illustration of the scene"
              onLoad={() => setImgState('loaded')}
              onError={() => setImgState('failed')}
              style={{
                width: '100%', maxWidth: '480px', height: 'auto',
                display: imgState === 'loaded' ? 'block' : 'none',
                border: '1px solid rgba(74,44,20,0.2)',
                margin: '0 auto',
              }}
            />
          </div>
        )}
      </div>
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

function Header({ gs, onReturnToTitle }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [flash, setFlash] = useState('');
  const [exportPanel, setExportPanel] = useState(null); // { title, content, filename }
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubConfig, setGithubConfig] = useState(null);

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
            DAY {gs.day} · £{gs.money} · HOLD {fmtCwt(cargoWeight(gs.goods))}/{cargoCap(gs)} · {gs.charterClosed ? 'CHARTER CLOSED' : `${gs.daysRemaining} DAYS REMAIN`}
          </div>
          <div className="display" style={{ fontSize: '0.78em', color: '#8a6a3f', letterSpacing: '0.08em', marginTop: '0.2rem' }}>
            GODOWN {fmtCwt(warehouseUsed(gs))}/{warehouseCap(gs)} · LONDON: PEPPER {Math.floor(gs.quotas?.pepper?.have || 0)}/{gs.quotas?.pepper?.needed ?? 400} · CINNAMON {Math.floor(gs.quotas?.cinnamon?.have || 0)}/{gs.quotas?.cinnamon?.needed ?? 200}
          </div>
        </div>
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
    </div>
  );
}

// ─────────── TABS ───────────

function Tabs({ tab, setTab, unread, atHome }) {
  const tabs = [
    { key: 'journal',  label: 'Journal' },
    { key: 'ledger',   label: 'Ledger' },
    { key: 'map',      label: 'Voyage' },
    { key: 'port',     label: 'In Port' },
    ...(atHome ? [{ key: 'outpost', label: 'Outpost' }] : []),
    { key: 'letters',  label: `Letters${unread ? ` (${unread})` : ''}` },
  ];
  return (
    <div className="tab-row">
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
  );
}

// ─────────── JOURNAL VIEW ───────────

function JournalView({ gs, arrivalProse, setTab, openLetterById }) {
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

      {arrivalProse && arrivalProse.port === gs.location && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem', borderLeft: '3px solid #5c1a08', background: 'rgba(255,255,255,0.3)' }}>
          <div className="display" style={{ fontSize: '0.8em', color: '#6b4423' }}>UPON ARRIVAL AT {gs.location.toUpperCase()}</div>
          <p className="italic" style={{ marginTop: '0.5rem', marginBottom: 0 }}>{arrivalProse.prose}</p>
          <ImaginePanel prose={arrivalProse.prose} label="Imagine the harbour" />
        </div>
      )}

      {entries.length === 0 ? (
        <p className="italic" style={{ color: '#6b4423' }}>The pages are blank. Begin.</p>
      ) : (
        <div>
          {entries.map((e, i) => (
            <div key={i} style={{ marginBottom: '0.7rem', display: 'flex', gap: '1rem' }}>
              <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', minWidth: '4rem' }}>Day {e.day}</div>
              <div>{e.entry}</div>
            </div>
          ))}
        </div>
      )}
      {gs.hooks.length > 0 && (
        <>
          <Fleuron char="❧" />
          <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.5rem' }}>OPEN THREADS</div>
          {gs.hooks.slice(-5).map((h, i) => (
            <div key={i} className="italic" style={{ marginBottom: '0.3rem', color: '#4a3220' }}>&mdash; {h}</div>
          ))}
        </>
      )}
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

      <div style={{ marginTop: '2rem' }}>
        <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.7rem' }}>THE HOUSEHOLD</div>
        <div className="cols-2">
          {Object.entries(gs.npcs).map(([key, n]) => (
            <div key={key} className="parchment" style={{ padding: '0.9rem', background: 'rgba(255,255,255,0.25)' }}>
              <div className="display" style={{ fontSize: '1.05em', color: '#5c1a08' }}>{n.name}</div>
              <div style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.5rem', fontStyle: 'italic' }}>{n.role}</div>
              {key === 'hodge' && <>
                {stateBar('Sobriety', n.sobriety, n.sobriety < 30 ? '#8b1a1a' : '#5c1a08')}
                {stateBar('Loyalty', n.loyalty)}
              </>}
              {key === 'dass' && <>
                {stateBar('Loyalty', n.loyalty)}
                {stateBar('Morale', n.morale)}
                {stateBar('Health', n.health)}
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
                  disabled={blocked || tooDamaged}
                  onClick={() => sailTo(k)}
                >
                  {blocked ? 'Not Welcome' : tooDamaged ? 'Ship Unfit' : 'Sail Here'}
                </button>
              </div>
              {blocked && (
                <div className="italic" style={{ fontSize: '0.85em', color: '#8b1a1a', marginTop: '0.5rem' }}>
                  &mdash; Requires standing with {Object.entries(p.requiresRep).map(([f]) => FACTIONS[f].short).join(', ')}.
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
                          const price = priceFor(k, c, gs.day);
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
                          const price = priceFor(k, c, gs.day);
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

// ─────────── PORT VIEW ───────────

function PortView({ gs, buyGood, sellGood, refitShip, arrivalProse, setTab, lodgeGoods, withdrawGoods, commissionBrigantine }) {
  const port = PORTS[gs.location];
  const sells = Object.keys(port.sells || {});
  const buys = Object.keys(port.buys || {});
  const stocks = gs.portStocks?.[gs.location] || {};
  const cap = cargoCap(gs);
  const used = cargoWeight(gs.goods);
  const remaining = Math.max(0, cap - used);
  const ship = gs.ship || { name: 'The Pinnace', hull: 100, sails: 100 };

  // Compute the largest qty the player can buy of a commodity, given money,
  // hold capacity, and port stock. Tax inflates per-unit cost when buying at
  // a port that levies duty (Dutch).
  const taxRate = portTaxRate(gs, gs.location);
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
        <div style={{ padding: '0.8rem', borderLeft: '3px solid #5c1a08', background: 'rgba(255,255,255,0.3)', marginBottom: '1.5rem' }}>
          <p className="italic" style={{ margin: 0 }}>{arrivalProse.prose}</p>
          <ImaginePanel prose={arrivalProse.prose} label="Imagine the harbour" />
        </div>
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
            const price = priceFor(gs.location, c, gs.day);
            const onHand = Math.floor(stocks[c] ?? 0);
            const max = maxBuyable(c, price);
            const effPrice = taxRate > 0 ? Math.ceil(price * (1 + taxRate)) : price;
            return (
              <div key={c} className="trade-row">
                <div>
                  <div>{COMMODITIES[c].name}</div>
                  <div style={{ fontSize: '0.85em', color: '#6b4423' }}>
                    £{price} per {COMMODITIES[c].unit}{taxRate > 0 ? ` (£${effPrice} w/ duty)` : ''} · {COMMODITIES[c].weight} cwt ea ·{' '}
                    <span style={{ color: onHand === 0 ? '#8b1a1a' : '#6b4423' }}>
                      {onHand === 0 ? 'none on hand' : `${onHand} on hand`}
                    </span>
                  </div>
                </div>
                <div className="actions">
                  <button className="ghost-button-sm" disabled={max < 1}  onClick={() => buyGood(c, 1, price)}>Buy 1</button>
                  <button className="ghost-button-sm" disabled={max < 5}  onClick={() => buyGood(c, 5, price)}>Buy 5</button>
                  <button className="ghost-button-sm" disabled={max < 1}  onClick={() => buyGood(c, max, price)}>Buy max ({max})</button>
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.5rem' }}>BOUGHT BY THE PORT</div>
          {buys.length === 0 ? <p className="italic">No one is buying.</p> : buys.map(c => {
            const price = priceFor(gs.location, c, gs.day);
            const have = gs.goods[c] || 0;
            const netPrice = taxRate > 0 ? Math.floor(price * (1 - taxRate)) : price;
            return (
              <div key={c} className="trade-row">
                <div>
                  <div>{COMMODITIES[c].name} <span style={{ fontSize: '0.85em', color: '#6b4423' }}>(have {have})</span></div>
                  <div style={{ fontSize: '0.85em', color: '#6b4423' }}>£{price} per {COMMODITIES[c].unit}{taxRate > 0 ? ` (£${netPrice} after duty)` : ''}</div>
                </div>
                <div className="actions">
                  <button className="ghost-button-sm" disabled={have < 1} onClick={() => sellGood(c, 1, price)}>Sell 1</button>
                  <button className="ghost-button-sm" disabled={have < 5} onClick={() => sellGood(c, 5, price)}>Sell 5</button>
                  <button className="ghost-button-sm" disabled={have < 1} onClick={() => sellGood(c, have, price)}>Sell all</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
              <button className="ghost-button-sm" disabled={lodgeMax < 1} onClick={() => lodgeGoods(c, 1)}>Lodge 1</button>
              <button className="ghost-button-sm" disabled={lodgeMax < 1} onClick={() => lodgeGoods(c, lodgeMax)}>Lodge all ({lodgeMax})</button>
              <button className="ghost-button-sm" disabled={withdrawMax < 1} onClick={() => withdrawGoods(c, 1)}>Draw 1</button>
              <button className="ghost-button-sm" disabled={withdrawMax < 1} onClick={() => withdrawGoods(c, withdrawMax)}>Draw all ({withdrawMax})</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────── OUTPOST VIEW ───────────

// ─────────── COMMISSION PANEL ───────────
// Shown at the Wharf at home. Three states: gated (no Shipwright's Yard /
// already on a brigantine), in-progress (build counting down), or available.

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

function OutpostView({ gs, startBuild, expediteBuild }) {
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

  return (
    <div>
      <h2 className="display" style={{ fontSize: '1.4em', color: '#5c1a08', marginTop: 0 }}>The Outpost</h2>
      <p className="italic" style={{ color: '#4a3220', marginBottom: '1rem' }}>
        The compound at Bayan-Kor is yours to build. Construction continues whether you are present or at sea.
      </p>

      {built.length > 0 && (
        <>
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.5rem' }}>STANDING STRUCTURES</div>
          <div style={{ marginBottom: '1.5rem' }}>
            {built.map(([k, v]) => (
              <div key={k} className="parchment" style={{ padding: '0.7rem 1rem', marginBottom: '0.5rem', background: 'rgba(255,255,255,0.3)' }}>
                <div className="display" style={{ color: '#5c1a08' }}>{BUILDINGS[k].name}</div>
                <div style={{ fontSize: '0.85em', color: '#6b4423', fontStyle: 'italic' }}>Completed day {v.builtOn}. {BUILDINGS[k].effect}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {queue.length > 0 && (
        <>
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.5rem' }}>UNDER CONSTRUCTION</div>
          <div style={{ marginBottom: '1.5rem' }}>
            {queue.map((q, i) => {
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
        </>
      )}

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

function LettersView({ gs, setGs, onRespond, openLetterId, setOpenLetterId }) {
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
        <div className="parchment" style={{ padding: '1.5rem', background: 'rgba(255,253,245,0.6)' }}>
          <div className="display" style={{ fontSize: '0.85em', color: '#6b4423' }}>FROM</div>
          <div style={{ marginBottom: '0.5rem' }}>{letter.from}</div>
          <div className="display" style={{ fontSize: '0.85em', color: '#6b4423' }}>SUBJECT</div>
          <div className="italic" style={{ marginBottom: '1rem' }}>{letter.subject}</div>
          <Fleuron char="❧" />
          <p style={{ whiteSpace: 'pre-line', fontSize: '1.05em' }}>{letter.body}</p>
          <ImaginePanel prose={letter.body} label="Imagine the sender's hand" />
          <Fleuron />
          {letter.replied ? (
            <div className="italic" style={{ color: '#6b4423' }}>You replied: &ldquo;{letter.replyLabel}&rdquo;</div>
          ) : (
            <div>
              <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.5rem' }}>YOUR REPLY</div>
              {letter.responses.map((r, i) => (
                <div key={i} style={{ marginBottom: '0.5rem' }}>
                  <button
                    className="ghost-button"
                    style={{ width: '100%', textAlign: 'left' }}
                    onClick={() => { setOpenLetterId(null); onRespond(letter, r); }}
                  >
                    &mdash; {r.label}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
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
  charterClosed: gs.charterClosed ? { outcome: gs.charterClosed.outcome, day: gs.charterClosed.day } : null,
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

  const handleReturnToTitle = () => {
    setActiveSaveId(null);
    setPhase('title');
  };

  if (phase === 'loading') {
    return <Page><Loading msg="Unrolling the chart" /></Page>;
  }

  if (phase === 'title') {
    return (
      <Page>
        <TitleScreen
          saves={savesIndex}
          onNewGame={handleNewGame}
          onContinue={handleContinue}
          onRestore={handleRestore}
          onDeleteSlot={handleDeleteSlot}
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

  return <GameHub gs={gs} setGs={setGs} lastSavedAt={lastSavedAt} onReturnToTitle={handleReturnToTitle} />;
}
