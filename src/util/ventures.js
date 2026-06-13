// VENTURES — the sprawling enterprise. Large optional investments the Factor
// pours money into, each growing the operation in a DIFFERENT direction:
// Shipping (a fleet that remits passive income), Network (agents abroad that
// cheapen yr. trade), Capital (a financial stake), Production (yr. own supply,
// Phase 2). A carrot money sink: the late game stops being "money has no use"
// and becomes "what do I build next." Established ventures are lasting world
// state — they persist across succession/renewal like the outpost.
//
// Pure data + logic so it's testable and the monolith just renders it.
// gs.ventures shape: { [id]: { established: true, establishedDay, lastPaidDay } }

export const VENTURES = {
  coastal_trader: {
    name: 'The Kingfisher — a coastal trader',
    category: 'Shipping',
    cost: 600,
    income: 90,        // £ remitted each quarter (90 days)
    blurb: 'A single-masted country boat under a hired master, to run the near coast for small cargoes. The first vessel of a fleet that is not yet a fleet.',
    establishText: 'The Kingfisher is bought and a master engaged; she will run the coast and remit her takings each quarter.',
  },
  kota_agent: {
    name: 'An agent at Kota Pinang',
    category: 'Network',
    cost: 450,
    // Mechanical benefit: cheaper pepper & cinnamon when buying at Kota Pinang.
    buyDiscount: { port: 'Kota Pinang', commodities: ['pepper', 'cinnamon'], mult: 0.9 },
    blurb: 'A resident factor of yr. own at the Sultan’s port, to hold the pepper against yr. arrival and shave the Sultan’s men from the price.',
    establishText: 'Yr. man is installed at Kota Pinang. The pepper comes cheaper now, and is there when you call.',
  },
  bazaar_stake: {
    name: 'A stake in the bazaar',
    category: 'Capital',
    cost: 800,
    income: 70,
    blurb: 'A silent share in Mehmet Pasha’s lending house. The bazaar’s coin is always in motion, and a portion of its motion becomes yrs.',
    establishText: 'Yr. stake is laid with Mehmet Pasha. A share of the bazaar’s interest will come to you each quarter.',
  },
  country_ship: {
    name: 'The Carnatic — a country ship',
    category: 'Shipping',
    cost: 1500,
    income: 240,
    requires: { venture: 'coastal_trader' },
    blurb: 'A full country ship, two-masted and crewed, running the Bengal and Coromandel trade under yr. flag while you keep yr. own deck. This is a fleet.',
    establishText: 'The Carnatic is yrs., and a fleet with her. She runs the Bay under yr. flag and remits each quarter.',
  },
  // PRODUCTION path — yr. own supply. Gardens of yr. own that lodge spice into
  // the godown each quarter, reducing reliance on the Sultan's port. The
  // make-vs-buy axis: vertical integration instead of arbitrage. Pepper first,
  // then a fuller estate that adds the scarcer cinnamon. Mirrors the plantation
  // BUILDING's harvest, but as a private venture on yr. own account.
  pepper_garden: {
    name: 'A pepper garden of yr. own',
    category: 'Production',
    cost: 700,
    produce: [{ commodity: 'pepper', amount: 16 }],
    blurb: 'Cleared ground inland, held on yr. own account and apart from the Company’s plantation, planted thick to pepper. The vine pays the patient man — a crop lodged in yr. godown each season, bought from no one.',
    establishText: 'The ground is taken and the first rows go in. The garden will lodge its pepper in yr. godown each quarter, yr. own and owing nothing to the Sultan’s price.',
  },
  spice_estate: {
    name: 'A spice estate at the river-head',
    category: 'Production',
    cost: 1300,
    requires: { venture: 'pepper_garden' },
    produce: [{ commodity: 'cinnamon', amount: 10 }, { commodity: 'pepper', amount: 6 }],
    blurb: 'A proper estate above the river-head — cinnamon ground added to the pepper, with a kiln and a drying-floor and men kept the year round. The cinnamon, which comes from one port only, now comes from yr. own land.',
    establishText: 'The estate is yrs.: cinnamon and pepper both, lodged in the godown each quarter. The scarcer spice no longer waits on the Sultan’s warehouse.',
  },
  // HOME path — not freely purchasable (viaQuest). Established through the
  // Wexley matter: yr. sister's letters about the family's portion in a Bristol
  // trading house. Dividends cross two oceans — Crusoe's off-stage estate.
  bristol_concern: {
    name: 'Yr. portion in Pyne & Wexley, of Bristol',
    category: 'Home',
    income: 110,
    viaQuest: true,
    blurb: 'The late yr. father’s share in a Bristol trading house, secured and increased by money sent home through yr. sister’s hand. It works while you sleep, an ocean away.',
  },
};

export const VENTURE_QUARTER = 90;

// Whether a venture's prerequisites are met by the current ventures state.
export function ventureUnlocked(id, venturesState) {
  const def = VENTURES[id];
  if (!def) return false;
  const req = def.requires;
  if (!req) return true;
  if (req.venture && !venturesState?.[req.venture]?.established) return false;
  return true;
}

// Quarterly income remittance for established income-ventures. Pure: returns a
// new ventures map (with advanced lastPaidDay), the total income this tick, and
// per-venture lines for the journal/digest. Catches up over multiple quarters
// if a long gap passed (advances lastPaidDay by whole quarters).
export function accrueVentureIncome(venturesState, day) {
  const ventures = { ...(venturesState || {}) };
  let income = 0;
  const lines = [];
  for (const [id, v] of Object.entries(ventures)) {
    if (!v?.established) continue;
    const def = VENTURES[id];
    if (!def?.income) continue;
    let last = typeof v.lastPaidDay === 'number' ? v.lastPaidDay
             : (typeof v.establishedDay === 'number' ? v.establishedDay : day);
    let paid = 0;
    while (day - last >= VENTURE_QUARTER) { paid += def.income; last += VENTURE_QUARTER; }
    if (paid > 0) {
      income += paid;
      lines.push({ id, name: def.name, amount: paid });
      ventures[id] = { ...v, lastPaidDay: last };
    }
  }
  return { ventures, income, lines };
}

// Quarterly produce for established Production ventures (yr. own gardens/estate).
// Pure: returns a new ventures map (advanced lastPaidDay) and the per-commodity
// yields produced this tick. Catches up over multiple quarters, mirroring
// accrueVentureIncome. Production and income ventures are disjoint (a venture has
// `income` OR `produce`, never both), so each advances lastPaidDay independently.
// The monolith lodges the yields into the godown, respecting its capacity
// (surplus rots in the rains, as the plantation harvest does).
export function accrueVentureProduce(venturesState, day) {
  const ventures = { ...(venturesState || {}) };
  const yields = [];   // { id, name, commodity, amount }
  for (const [id, v] of Object.entries(ventures)) {
    if (!v?.established) continue;
    const def = VENTURES[id];
    if (!def?.produce) continue;
    let last = typeof v.lastPaidDay === 'number' ? v.lastPaidDay
             : (typeof v.establishedDay === 'number' ? v.establishedDay : day);
    let quarters = 0;
    while (day - last >= VENTURE_QUARTER) { quarters += 1; last += VENTURE_QUARTER; }
    if (quarters > 0) {
      for (const p of def.produce) {
        yields.push({ id, name: def.name, commodity: p.commodity, amount: p.amount * quarters });
      }
      ventures[id] = { ...v, lastPaidDay: last };
    }
  }
  return { ventures, yields };
}

// Buy-price multiplier from an established network agent for a given port +
// commodity. 1 when no agent applies. Folded into priceFor's buy side.
export function ventureBuyMult(venturesState, portKey, commodity) {
  let mult = 1;
  for (const [id, v] of Object.entries(venturesState || {})) {
    if (!v?.established) continue;
    const d = VENTURES[id]?.buyDiscount;
    if (d && d.port === portKey && d.commodities.includes(commodity)) mult *= d.mult;
  }
  return mult;
}

// Total quarterly passive income from all established income-ventures — for
// the UI "the enterprise remits £N each quarter" line.
export function ventureQuarterlyIncome(venturesState) {
  let total = 0;
  for (const [id, v] of Object.entries(venturesState || {})) {
    if (v?.established && VENTURES[id]?.income) total += VENTURES[id].income;
  }
  return total;
}

// ─── Enterprise worth — the prestige metric behind the merchant-prince finish ───

// Book value of a single established venture: what it took to raise (its cost),
// or, for a quest-granted income venture with no purchase price (the Bristol
// concern), its income capitalized at ~12% (×8).
export function ventureWorth(id, v) {
  const def = VENTURES[id];
  if (!def || !v?.established) return 0;
  if (typeof def.cost === 'number') return def.cost;
  if (typeof def.income === 'number') return def.income * 8;
  return 0;
}

// Total book value of all established ventures.
export function venturesWorth(venturesState) {
  let total = 0;
  for (const [id, v] of Object.entries(venturesState || {})) total += ventureWorth(id, v);
  return total;
}

// How many ventures are established — the count the merchant-prince destiny
// gates on (a sprawling concern built on the Factor's own account).
export function establishedVentureCount(venturesState) {
  let n = 0;
  for (const v of Object.values(venturesState || {})) if (v?.established) n += 1;
  return n;
}

// ─── Living ventures — the enterprise writes back ───
//
// Established ventures occasionally throw an event: a windfall, a setback, or
// news worth pursuing. Turns flat passive income into a narrated, VARIABLE
// stream that feels like the concern is doing things — and, via `hook`, can
// surface a thread the player chooses to Pursue (agency through the existing
// system). Pure data; the monolith schedules (cooldown + roll) and applies it.
//
// Each event:
//   id       — stable key (used for once-tracking + anti-repeat)
//   venture  — the venture id that must be established for it to fire
//   text     — the journal / away-log line, in the Factor's voice
//   money    — £ delta (windfall + / setback −), optional
//   produce  — { commodity, amount } lodged to the godown (a bumper crop), optional
//   hook     — a thread string planted for the player to Pursue, optional
//   once     — if true, fires at most once per charter (the hook/news beats)
//   weight   — relative selection weight (default 1)
export const VENTURE_EVENTS = [
  // Shipping — the Kingfisher
  { id: 'kingfisher_prize',  venture: 'coastal_trader', money: 35,
    text: 'The Kingfisher fell in with a derelict country boat off the shoals and brought her rice safe in — a small windfall, honestly come by.' },
  { id: 'kingfisher_storm',  venture: 'coastal_trader', money: -30,
    text: 'The Kingfisher sprang a plank in a sudden blow and lay three weeks under repair; the cost came to yr. account.' },

  // Shipping — the Carnatic
  { id: 'carnatic_freight',  venture: 'country_ship', money: 90,
    text: 'The Carnatic came back deep-laden from the Coromandel, every foot of her hold spoken for — a rich freight this season.' },
  { id: 'carnatic_becalmed', venture: 'country_ship', money: -45,
    text: 'The Carnatic lay becalmed a fortnight in the Bay and missed the best of the season’s freight.' },
  { id: 'carnatic_wreck',    venture: 'country_ship', once: true,
    hook: 'The Carnatic’s master reports a Dutch wreck on the Pratas with saltpetre aboard, ungoverned — a thing that might repay a closer look.',
    text: 'The Carnatic’s master sends word of a Dutch ship gone on the Pratas reef, her saltpetre cargo ungoverned. He thinks it might repay a closer look.' },

  // Capital — the bazaar stake
  { id: 'bazaar_flush',      venture: 'bazaar_stake', money: 50,
    text: 'A flush quarter at Mehmet Pasha’s house — the bazaar’s coin ran fast, and yr. share of it ran with it.' },
  { id: 'bazaar_default',    venture: 'bazaar_stake', money: -40,
    text: 'A debtor of Mehmet Pasha’s house defaulted and fled to the hills; the quarter’s interest came the shorter for it.' },

  // Production — the pepper garden
  { id: 'garden_bumper',     venture: 'pepper_garden', produce: { commodity: 'pepper', amount: 10 },
    text: 'A kind monsoon and a heavy set on the vines — the garden gave a bumper crop, lodged with the rest.' },
  { id: 'garden_blight',     venture: 'pepper_garden', money: -20,
    text: 'A blight ran through the pepper rows; Aman Singh saved what he could, but the cost of it came to yr. account.' },

  // Production — the spice estate
  { id: 'estate_cinnamon',   venture: 'spice_estate', produce: { commodity: 'cinnamon', amount: 8 },
    text: 'The cinnamon peeled clean and dried fair this season; an extra weight of it came down to the godown.' },
  { id: 'estate_fire',       venture: 'spice_estate', money: -60,
    text: 'A fire took hold in the drying-floor and a season’s cinnamon with it; the rebuilding came to yr. account.' },

  // Network — the Kota Pinang agent
  { id: 'agent_intel',       venture: 'kota_agent', once: true,
    hook: 'Yr. Kota Pinang agent reports the Sultan’s pepper price will fall before the next ships — an opening for a well-timed buy.',
    text: 'Yr. man at Kota Pinang sends word under seal: the Sultan’s warehouses are over-full, and the price of pepper there will fall before the next ships call.' },
  { id: 'agent_gift',        venture: 'kota_agent', money: 20,
    text: 'Yr. agent at Kota Pinang sent up the season’s first mangosteens and a quiet £20 besides, being yr. share of a brokerage he turned on the side.' },

  // Home — the Bristol concern
  { id: 'bristol_dividend',  venture: 'bristol_concern', money: 55,
    text: 'A letter from Eliza: Pyne & Wexley had a strong half-year, and an extra dividend rode home with the usual — a fat sum beyond the quarter.' },
  { id: 'bristol_slow',      venture: 'bristol_concern', money: -25,
    text: 'Eliza writes that the West-Country cloth sold slow this season; the dividend will be the lighter for it, though the house stands sound.' },
];

// Pick a venture event to fire now, or null. Eligible = the venture is
// established and the event is not excluded (a spent `once` event, or the one
// just fired — anti-repeat). `roll` in [0,1) selects among the eligible pool by
// weight. The monolith decides IF an event fires (cooldown + a gate roll) and
// supplies this selection roll + the exclude list.
export function pickVentureEvent(venturesState, excludeIds, roll) {
  const excl = new Set(excludeIds || []);
  const pool = VENTURE_EVENTS.filter(e =>
    venturesState?.[e.venture]?.established && !excl.has(e.id)
  );
  if (!pool.length) return null;
  const total = pool.reduce((s, e) => s + (e.weight || 1), 0);
  let r = (typeof roll === 'number' ? roll : 0) * total;
  for (const e of pool) { r -= (e.weight || 1); if (r < 0) return e; }
  return pool[pool.length - 1];
}
