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
