import React, { useState, useEffect, useRef } from 'react';

// ═══════════════════════════════════════════════════════════════
//  THE FACTOR'S CHARTER — playable prototype
//  A text-based colonial trading game in the spirit of
//  Robinson Crusoe, Sunless Sea, and House Hlaalu.
// ═══════════════════════════════════════════════════════════════

// ─────────── DATA ───────────

const COMMODITIES = {
  pepper:     { name: 'Pepper',     unit: 'cwt',    basePrice: 12 },
  cinnamon:   { name: 'Cinnamon',   unit: 'cwt',    basePrice: 18 },
  calico:     { name: 'Calico',     unit: 'bolt',   basePrice: 8  },
  silver:     { name: 'Silver',     unit: 'oz',     basePrice: 25 },
  sandalwood: { name: 'Sandalwood', unit: 'log',    basePrice: 6  },
  opium:      { name: 'Opium',      unit: 'chest',  basePrice: 45 },
  rice:       { name: 'Rice',       unit: 'sack',   basePrice: 3  },
  rum:        { name: 'Rum',        unit: 'barrel', basePrice: 7  },
  saltpetre:  { name: 'Saltpetre',  unit: 'cask',   basePrice: 22 },
};

const PORTS = {
  'Bayan-Kor': {
    name: 'Bayan-Kor',
    blurb: 'Your station. A thatched godown, a leaky dock, and the Rajah\u2019s palace on the hill.',
    daysFromHome: 0, isHome: true,
    sells: { rice: 0.85, sandalwood: 0.75 },
    buys:  { calico: 1.3, rum: 1.4, silver: 1.2 },
    faction: 'rajah',
  },
  'Kota Pinang': {
    name: 'Kota Pinang',
    blurb: 'A pepper port up the strait. The Sultan tolerates Europeans, and taxes them.',
    daysFromHome: 3,
    sells: { pepper: 0.7, cinnamon: 0.85, sandalwood: 0.9 },
    buys:  { calico: 1.4, opium: 1.5, silver: 1.1, rum: 1.2 },
    faction: 'rajah',
  },
  'Port St. Eustace': {
    name: 'Port St. Eustace',
    blurb: 'A Dutch harbor, whitewashed and orderly. Their factor watches you closely.',
    daysFromHome: 5,
    sells: { calico: 0.75, opium: 0.85, saltpetre: 0.8 },
    buys:  { pepper: 1.4, cinnamon: 1.5, sandalwood: 1.2, silver: 1.05 },
    faction: 'dutch', rivalRisk: true,
  },
  'The Pelican\u2019s Nest': {
    name: 'The Pelican\u2019s Nest',
    blurb: 'A hidden cove east of the chart. The Brotherhood holds court here. No flag flies.',
    daysFromHome: 7, requiresRep: { pirates: 10 },
    sells: { silver: 0.65, opium: 0.7, saltpetre: 0.6 },
    buys:  { rum: 1.7, calico: 1.3, rice: 1.5 },
    faction: 'pirates',
  },
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

const repTone = (n) => {
  if (n >= 50) return 'cordial';
  if (n >= 20) return 'warm';
  if (n >= 5) return 'agreeable';
  if (n >= -5) return 'neutral';
  if (n >= -20) return 'cool';
  if (n >= -50) return 'hostile';
  return 'inimical';
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

  return {
  day: 1,
  location: 'Bayan-Kor',
  player: { name, title: 'Factor' },
  money: 500,
  goods: { rum: 5, rice: 8 },
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
  },
  awayLog: [],          // events accrued while away from Bayan-Kor; cleared on digest
  quotas: { pepper: { needed: 400, have: 0 }, cinnamon: { needed: 200, have: 0 } },
  daysRemaining: 1095,
  journal: [],
  letters: [directorLetter, wilbrahamPapers],
  hooks: ['The inland teak concession \u2014 ter Borch wants it.'],
  visited: ['Bayan-Kor'],
  seenOpening: false,
  lettersGenerated: 2,
  firstLetterPresented: false,
  };
};

// ─────────── HOME SIMULATION ───────────
// Each day the Factor is away (or any day passes), the colony lives.
// Construction progresses, NPCs act, small incidents accrue.
// All events accumulate in awayLog and are surfaced on return home.

function tickDays(gs, days) {
  let s = {
    ...gs,
    npcs: JSON.parse(JSON.stringify(gs.npcs)),
    outpost: { ...gs.outpost, buildings: { ...gs.outpost.buildings }, queue: [...gs.outpost.queue] },
    reputation: { ...gs.reputation },
    goods: { ...gs.goods },
    awayLog: [...gs.awayLog],
  };
  const hasStockade = !!s.outpost.buildings.stockade?.built;
  const hasBarracks = !!s.outpost.buildings.barracks?.built;
  const incidentBaseChance = hasStockade || hasBarracks ? 0.012 : 0.025;

  for (let i = 0; i < days; i++) {
    s.day += 1;
    s.daysRemaining = Math.max(0, s.daysRemaining - 1);

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

    // ── plantation harvest every 30 days after built
    const plant = s.outpost.buildings.plantation;
    if (plant?.built && (s.day - plant.builtOn) > 0 && (s.day - plant.builtOn) % 30 === 0) {
      const yield_ = 5;
      s.goods.pepper = (s.goods.pepper || 0) + yield_;
      s.awayLog.push({ day: s.day, type: 'harvest', text: `The plantation yielded ${yield_} cwt of pepper.` });
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
  }
  return s;
}

// ─────────── API: GENERATIVE PROSE ───────────

const SYSTEM_PROMPT = `You are the narrator of "The Factor's Charter," a text-based game in the spirit of Robinson Crusoe, Sunless Sea, and Morrowind's House Hlaalu. Setting: a vaguely Southeast-Asian colonial frontier, early 1720s. POV: a junior trading-company Factor.

VOICE: Dry, observational, period-appropriate. Sensory details (heat, salt, mildew, palm oil, gun smoke). No anachronisms — no "okay," no modern idiom. Specific, not generic. Slight melancholy, occasional dark humor. Names of people and ships should sound period-plausible.

WORLD GROUNDING (do not violate):
- The Factor's home station is Bayan-Kor. The named characters who live there are Mr. Hodge (clerk, drunkard), Sgt. Dass (sepoy), the Rajah's Vizier, and Reverend Pyke (at the Mission). These characters can ONLY appear in scenes set at Bayan-Kor or via correspondence.
- The other ports — Kota Pinang, Port St. Eustace, The Pelican's Nest — are reached only by voyage. They have their own anonymous local populations (harbormasters, merchants, soldiers, etc.).
- A scene that takes place at sea or in a non-home port must NOT introduce home-station characters in person. If they appear, they must be aboard the Factor's ship explicitly, or referenced via letters, never bumped into ashore elsewhere.
- The Mission is at Bayan-Kor. The Reverend cannot be "visited" at any other port.

CONSTRAINTS: Output ONLY valid JSON. No code fences, no preamble, no commentary. Stay within the requested length.`;

async function callClaude(prompt, schema) {
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
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const cleaned = text.replace(/```json|```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch (e) {
    console.error('API error:', e);
    return null;
  }
}

const stateContext = (gs) => {
  const reps = Object.entries(gs.reputation)
    .filter(([,v]) => v !== 0)
    .map(([k,v]) => `${FACTIONS[k].short}: ${v > 0 ? '+' : ''}${v} (${repTone(v)})`)
    .join(', ') || 'none of note';
  const recentJournal = gs.journal.slice(-3).map(j => j.entry).join(' / ') || 'none';
  const hooks = gs.hooks.slice(-3).join(' | ') || 'none';
  return `Day ${gs.day}. Location: ${gs.location}. Crew: ${gs.crew.map(c=>`${c.name} (${c.trait} ${c.role})`).join(', ')}. Reputation: ${reps}. Recent: ${recentJournal}. Open threads: ${hooks}.`;
};

async function genVoyageEncounter(gs, fromPort, toPort) {
  const prompt = `Generate a voyage encounter at sea, sailing from ${fromPort} toward ${toPort}.
${stateContext(gs)}

SCENE CONSTRAINT: This encounter happens on the open water during the voyage, not at any port. The Factor is aboard the pinnace with anonymous crew (a bosun, sailors). Do NOT introduce Mr. Hodge, Sgt. Dass, the Vizier, or Reverend Pyke unless you state plainly that they have been brought aboard for this voyage. New characters (e.g. another ship's captain, a passenger, a castaway) should have period-plausible names.

Return JSON:
{
  "prose": "3-4 sentences of period prose. Concrete sensory detail. Set the scene and present a situation requiring a decision.",
  "choices": [
    { "label": "5-9 word verb phrase", "seed": "what tonally happens if chosen" },
    { "label": "5-9 word verb phrase", "seed": "what tonally happens if chosen" },
    { "label": "5-9 word verb phrase", "seed": "what tonally happens if chosen" }
  ]
}`;
  return await callClaude(prompt) || {
    prose: 'A line of squalls runs along the horizon. The wind drops, then turns. The bosun looks to you for orders.',
    choices: [
      { label: 'Run before the weather, lose a day', seed: 'lose time but no harm' },
      { label: 'Stand on the course, trust the rigging', seed: 'risk damage for time' },
      { label: 'Reef and ride it out', seed: 'safe but slow' },
    ],
  };
}

async function genOutcome(gs, encounterProse, choice, opts = {}) {
  const isLetter = !!opts.isLetter;
  const constraintLine = isLetter
    ? `SCENE CONSTRAINT: This is the Factor writing a reply at his desk. The outcome is what proceeds from the words he writes — no travel, no scenes elsewhere, no time of consequence passing. Set "days" to 0.`
    : `SCENE CONSTRAINT: The outcome must follow plainly from the encounter as set up above. Do not introduce new characters or settings unrelated to that scene. The Factor cannot meet home-station characters (Hodge, Dass, the Vizier, Reverend Pyke) outside Bayan-Kor.`;
  const prompt = `In the encounter: "${encounterProse}"
The Factor chose: "${choice.label}" (${choice.seed})
${stateContext(gs)}

${constraintLine}

Generate the outcome. Return JSON:
{
  "prose": "2-3 sentences of period prose describing what happens.",
  "changes": {
    "money": integer delta (often 0; range -200 to +200),
    "days": integer days passed (${isLetter ? '0 only' : '0-3'}),
    "reputation": { "company": int, "crown": int, "rajah": int, "pirates": int, "mission": int, "dutch": int },
    "goods": { "commodity_name": int delta },
    "journal": "one-sentence note for the journal in past tense",
    "hook": "optional: a thread that may return later, or empty string"
  }
}
Reputation deltas should be small (-15 to +15). Only include factions that actually shift. Goods can include any of: pepper, cinnamon, calico, silver, sandalwood, opium, rice, rum, saltpetre.`;
  return await callClaude(prompt) || {
    prose: 'It plays out as you might expect, neither as well nor as ill as feared.',
    changes: { money: 0, days: isLetter ? 0 : 1, reputation: {}, goods: {}, journal: 'A day passed without consequence.', hook: '' },
  };
}

async function genLetter(gs) {
  const senders = [
    { from: 'The Court of Directors', faction: 'company', mood: 'imperious, demanding quarterly returns' },
    { from: 'Mrs. Eliza Wexley, your sister', faction: null, mood: 'familial, news of home, gentle reproach' },
    { from: 'Capt. Faulke of the Albatross', faction: null, mood: 'weather-beaten, offering passage or news' },
    { from: 'Reverend Pyke of the Mission', faction: 'mission', mood: 'pious, requesting favors or warning of moral peril' },
    { from: 'An Anonymous Hand', faction: 'pirates', mood: 'guarded, suggesting an arrangement profitable to both parties' },
    { from: 'Mynheer ter Borch', faction: 'dutch', mood: 'formal, suspicious, perhaps offering a deal' },
    { from: 'The Rajah\u2019s Vizier', faction: 'rajah', mood: 'elaborate, oblique, with a request behind the courtesy' },
  ];
  const sender = senders[gs.lettersGenerated % senders.length];
  const prompt = `Generate a letter delivered to the Factor at ${gs.location}.
From: ${sender.from} (${sender.mood})
${stateContext(gs)}

Return JSON:
{
  "from": "${sender.from}",
  "subject": "5-8 word subject",
  "body": "3-5 sentences of a period letter. Sign off appropriately. Reference the current situation if natural. Should imply something the Factor might respond to or act upon.",
  "responses": [
    { "label": "5-8 word response", "seed": "tonal consequence" },
    { "label": "5-8 word response", "seed": "tonal consequence" },
    { "label": "Set aside, do not reply", "seed": "ignore, possible drift" }
  ]
}`;
  const result = await callClaude(prompt);
  return result || {
    from: sender.from,
    subject: 'A Matter Requiring Your Attention',
    body: 'Sir, — I trust this finds you in such health as the climate permits. There is a matter I should wish to lay before you when next our paths cross. Yr. obedient servant, &c.',
    responses: [
      { label: 'Reply with cautious interest', seed: 'opens dialogue' },
      { label: 'Reply with formal refusal', seed: 'closes door politely' },
      { label: 'Set aside, do not reply', seed: 'silence' },
    ],
  };
}

async function genArrivalVignette(gs, port) {
  const prompt = `The Factor arrives at ${port}. ${PORTS[port].blurb}
${stateContext(gs)}
Return JSON:
{
  "prose": "2-3 sentences of arrival prose. Sensory, specific to this port. Period."
}`;
  const result = await callClaude(prompt);
  return result?.prose || `The ${port} pilot comes aboard at first light. The harbor smells of fish and woodsmoke.`;
}

async function genAwayDigest(gs, log) {
  if (!log || log.length === 0) return null;
  const events = log.slice(-12).map(e => `Day ${e.day}: ${e.text}`).join('\n');
  const prompt = `The Factor returns to Bayan-Kor after a period away. In his absence, the following came to pass:

${events}

Compose a single paragraph (4-6 sentences) in the Factor\u2019s journal voice, written upon his return. He is reading the household ledger, hearing Hodge stammer through reports, and walking the compound. Period prose, dry observation, sensory detail. Do not list the events; weave them.

Return JSON: { "prose": "..." }`;
  const result = await callClaude(prompt);
  return result?.prose || 'Returned to find the godown standing and the ledger half-kept. The work of catching up begins tomorrow.';
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

function TitleScreen({ savedData, onNewGame, onContinue, onRestore }) {
  const [name, setName] = useState('Jonathan Wexley');
  const [showRestore, setShowRestore] = useState(false);
  const [restoreText, setRestoreText] = useState('');
  const [flash, setFlash] = useState('');

  const hasSave = !!(savedData && savedData.gs);

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
    if (hasSave) {
      const ok = window.confirm('Beginning a new charter will overwrite your charter in progress. Continue?');
      if (!ok) return;
    }
    onNewGame(name || 'Jonathan Wexley');
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

      {/* CONTINUE existing save */}
      {hasSave && (
        <div className="parchment" style={{
          padding: '1rem 1.2rem', marginTop: '1.5rem', marginBottom: '1.5rem',
          background: 'rgba(255,253,245,0.55)', textAlign: 'center',
        }}>
          <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.1em', marginBottom: '0.3rem' }}>
            ⁂ A CHARTER IN PROGRESS
          </div>
          <div style={{ fontStyle: 'italic', color: '#4a3220', marginBottom: '0.7rem' }}>
            {savedData.gs.player.name}, Factor at {savedData.gs.location} &middot; Day {savedData.gs.day} of {savedData.gs.day + savedData.gs.daysRemaining}
          </div>
          <button className="wax-button" onClick={onContinue}>Resume Your Charter</button>
        </div>
      )}

      {/* NEW GAME */}
      <div style={{ marginTop: '1.5rem' }}>
        <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', marginBottom: '0.5rem' }}>
          {hasSave ? 'OR BEGIN ANEW' : 'INSCRIBE THY NAME'}
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
          <button className={hasSave ? 'ghost-button' : 'wax-button'} onClick={handleNewGame}>
            {hasSave ? 'Begin a New Charter' : 'Open the Charter'}
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

  // Open a specific letter from anywhere (e.g. the Journal "Read" card).
  const openLetterById = (id) => {
    setTab('letters');
    setOpenLetterId(id);
  };

  // Apply non-time changes (money, reputation, goods, journal, hook) to a state object
  // Returns a new state. Does NOT advance time — voyage time is handled separately via tickDays.
  const applyOutcomeChangesPure = (state, changes) => {
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
    return next;
  };

  // Whenever days pass (sailing), check on arriving home if there's an away digest to show.
  const arriveAt = async (newGs, dest) => {
    const returningHome = dest === 'Bayan-Kor';
    const hasEvents = newGs.awayLog.length > 0;

    if (returningHome && hasEvents) {
      setPending(true);
      setPendingMsg('Surveying what passed in your absence');
      const digestProse = await genAwayDigest(newGs, newGs.awayLog);
      setPending(false);
      setAwayDigest({ log: newGs.awayLog, prose: digestProse });
      // Clear the awayLog now that it's shown
      setGs({ ...newGs, awayLog: [] });
    } else {
      setGs(newGs);
      setPending(true);
      setPendingMsg('Coming into port');
      const prose = await genArrivalVignette(newGs, dest);
      setPending(false);
      setArrivalProse({ port: dest, prose });
      setTab(returningHome ? 'journal' : 'port');
    }
  };

  const sailTo = async (portKey) => {
    const port = PORTS[portKey];
    const hasShipwright = !!gs.outpost.buildings.shipwright?.built;
    setPending(true);
    setPendingMsg('Stowing the cargo, hoisting sail');
    const haveEncounter = Math.random() < 0.6;

    if (haveEncounter) {
      const enc = await genVoyageEncounter(gs, gs.location, portKey);
      setPending(false);
      setEncounter({ ...enc, type: 'voyage', destination: portKey });
    } else {
      const baseDays = Math.max(1, (port.daysFromHome || 1) - (hasShipwright ? 1 : 0));
      setPendingMsg('The voyage is uneventful');
      await new Promise(r => setTimeout(r, 600));

      let newGs = tickDays(gs, baseDays);
      newGs = {
        ...newGs,
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
    const result = await genOutcome(gs, encounter.prose, choice);
    setPending(false);
    setOutcome({ ...result, encounter });
  };

  const concludeOutcome = async () => {
    if (encounter.type === 'voyage') {
      const dest = encounter.destination;
      const port = PORTS[dest];
      const hasShipwright = !!gs.outpost.buildings.shipwright?.built;
      const baseDays = Math.max(1, (port.daysFromHome || 1) - (hasShipwright ? 1 : 0));
      const totalDays = baseDays + (outcome.changes.days || 0);

      // Apply outcome changes (no time)
      let newGs = applyOutcomeChangesPure(gs, outcome.changes);
      // Tick the voyage days (advances day, runs home sim)
      newGs = tickDays(newGs, totalDays);
      // Land
      newGs = {
        ...newGs,
        location: dest,
        visited: newGs.visited.includes(dest) ? newGs.visited : [...newGs.visited, dest],
        journal: [...newGs.journal, { day: newGs.day, entry: `Made landfall at ${dest} after ${totalDays} days at sea.` }],
      };

      setEncounter(null);
      setOutcome(null);

      await arriveAt(newGs, dest);
    } else if (encounter.type === 'letter') {
      // Letter responses: instant in game time
      const newGs = applyOutcomeChangesPure(gs, outcome.changes);
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
    setPending(true);
    setPendingMsg('Sealing the letter');
    const result = await genOutcome(gs, `Letter from ${letter.from}: ${letter.body}`, response, { isLetter: true });
    setPending(false);
    setGs(prev => ({
      ...prev,
      letters: prev.letters.map(l => l.id === letter.id ? { ...l, replied: true, replyLabel: response.label } : l),
    }));
    // Letter replies are instant in game time. Strip any days the model invented
    // so the summary and the actual state agree.
    const safeChanges = { ...result.changes, days: 0 };
    setOutcome({ ...result, changes: safeChanges, encounter: { type: 'letter' } });
  };

  const requestNewLetter = async () => {
    setPending(true);
    setPendingMsg('A messenger crosses the compound');
    const letter = await genLetter(gs);
    setPending(false);
    setGs(prev => ({
      ...prev,
      letters: [...prev.letters, { ...letter, id: Date.now(), read: false }],
      lettersGenerated: prev.lettersGenerated + 1,
    }));
    setTab('letters');
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

  const buyGood = (commodity, qty, price) => {
    const cost = qty * price;
    if (gs.money < cost) return;
    setGs(prev => ({
      ...prev,
      money: prev.money - cost,
      goods: { ...prev.goods, [commodity]: (prev.goods[commodity] || 0) + qty },
      journal: [...prev.journal, { day: prev.day, entry: `Bought ${qty} ${COMMODITIES[commodity].unit} of ${COMMODITIES[commodity].name} at ${gs.location} for £${cost}.` }],
    }));
  };

  const sellGood = (commodity, qty, price) => {
    if ((gs.goods[commodity] || 0) < qty) return;
    const proceeds = qty * price;
    setGs(prev => {
      const next = {
        ...prev,
        money: prev.money + proceeds,
        goods: { ...prev.goods, [commodity]: prev.goods[commodity] - qty },
        journal: [...prev.journal, { day: prev.day, entry: `Sold ${qty} ${COMMODITIES[commodity].unit} of ${COMMODITIES[commodity].name} at ${gs.location} for £${proceeds}.` }],
      };
      // Quota tracking: shipped to home or to St. Eustace counts toward quota partial
      if (prev.location === 'Bayan-Kor' && next.quotas?.[commodity]) {
        // Selling at home doesn't count; you need to ship to London. Skip for prototype.
      }
      return next;
    });
  };

  // ─────── RENDER ───────

  if (awayDigest) {
    return <AwayDigestScreen digest={awayDigest} onContinue={handleDigestContinue} />;
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
          {tab === 'port' && <PortView gs={gs} buyGood={buyGood} sellGood={sellGood} arrivalProse={arrivalProse} setTab={setTab} />}
          {tab === 'outpost' && atHome && <OutpostView gs={gs} startBuild={startBuild} />}
          {tab === 'letters' && <LettersView gs={gs} setGs={setGs} onRespond={handleLetterResponse} onRequestNew={requestNewLetter} openLetterId={openLetterId} setOpenLetterId={setOpenLetterId} />}
        </div>
        <ProvisionsDrawer gs={gs} setGs={setGs} requestNewLetter={requestNewLetter} lastSavedAt={lastSavedAt} />
      </div>
    </Page>
  );
}

// ─────────── HEADER ───────────

function Header({ gs, onReturnToTitle }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [flash, setFlash] = useState('');

  const showFlash = (msg) => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 2200);
  };

  const downloadManuscript = () => {
    try {
      const data = JSON.stringify({ gs, phase: 'game', exportedAt: Date.now() }, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `factors-charter-day${gs.day}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showFlash('Manuscript downloaded.');
      setMenuOpen(false);
    } catch (e) {
      showFlash('Download failed; try Copy.');
    }
  };

  const copyManuscript = () => {
    try {
      const data = JSON.stringify({ gs, phase: 'game', exportedAt: Date.now() });
      navigator.clipboard.writeText(data).then(
        () => { showFlash('Copied to clipboard.'); setMenuOpen(false); },
        () => showFlash('Clipboard refused; use marginalia.')
      );
    } catch (e) {
      showFlash('Copy failed.');
    }
  };

  return (
    <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid rgba(74,44,20,0.3)', paddingBottom: '1rem', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="display" style={{ fontSize: '1.6em', color: '#5c1a08', margin: 0, lineHeight: 1.1 }}>
            {gs.player.name}, Factor at {gs.location}
          </h1>
          <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', letterSpacing: '0.1em', marginTop: '0.3rem' }}>
            DAY {gs.day} · £{gs.money} · {gs.daysRemaining} DAYS REMAIN
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
            onClick={downloadManuscript}
          >
            ↓ Download manuscript (JSON)
          </button>
          <button
            className="ghost-button"
            style={{ width: '100%', textAlign: 'left', marginBottom: '0.6rem' }}
            onClick={copyManuscript}
          >
            ⎘ Copy to clipboard
          </button>

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
      <div className="cols-2">
        <div>
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.5rem' }}>STORES</div>
          {goodsList.length === 0 ? (
            <p className="italic">The godown is empty.</p>
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
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginTop: '1.5rem', marginBottom: '0.5rem' }}>QUOTAS (TO LONDON)</div>
          <table style={{ width: '100%', fontSize: '0.95em' }}>
            <tbody>
              {Object.entries(gs.quotas).map(([k, q]) => (
                <tr key={k}><td>{COMMODITIES[k].name}</td><td style={{ textAlign: 'right' }}>{q.have} / {q.needed} {COMMODITIES[k].unit}</td></tr>
              ))}
            </tbody>
          </table>
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
  const ports = Object.entries(PORTS).filter(([k]) => k !== gs.location);

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
                  disabled={blocked}
                  onClick={() => sailTo(k)}
                >
                  {blocked ? 'Not Welcome' : 'Sail Here'}
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
                          return (
                            <div key={c} style={{ marginBottom: '0.15rem' }}>
                              {COMMODITIES[c].name} <span style={{ color: '#6b4423' }}>£{price}</span>{' '}
                              <span style={{ color: tag.color, fontStyle: 'italic', fontSize: '0.85em' }}>({tag.label})</span>
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

function PortView({ gs, buyGood, sellGood, arrivalProse, setTab }) {
  const port = PORTS[gs.location];
  const sells = Object.keys(port.sells || {});
  const buys = Object.keys(port.buys || {});
  return (
    <div>
      <h2 className="display" style={{ fontSize: '1.4em', color: '#5c1a08', marginTop: 0 }}>{port.name} &mdash; The Wharf</h2>
      <p className="italic" style={{ color: '#4a3220', marginBottom: '1rem' }}>{port.blurb}</p>
      {arrivalProse?.port === gs.location && (
        <div style={{ padding: '0.8rem', borderLeft: '3px solid #5c1a08', background: 'rgba(255,255,255,0.3)', marginBottom: '1.5rem' }}>
          <p className="italic" style={{ margin: 0 }}>{arrivalProse.prose}</p>
        </div>
      )}

      <div className="cols-2">
        <div>
          <div className="display" style={{ fontSize: '0.9em', color: '#6b4423', marginBottom: '0.5rem' }}>FOR SALE BY THE PORT</div>
          {sells.length === 0 ? <p className="italic">Nothing to be had here.</p> : sells.map(c => {
            const price = priceFor(gs.location, c, gs.day);
            return (
              <div key={c} className="trade-row">
                <div>
                  <div>{COMMODITIES[c].name}</div>
                  <div style={{ fontSize: '0.85em', color: '#6b4423' }}>£{price} per {COMMODITIES[c].unit}</div>
                </div>
                <div className="actions">
                  <button className="ghost-button-sm" disabled={gs.money < price} onClick={() => buyGood(c, 1, price)}>Buy 1</button>
                  <button className="ghost-button-sm" disabled={gs.money < price * 5} onClick={() => buyGood(c, 5, price)}>Buy 5</button>
                  <button className="ghost-button-sm" disabled={gs.money < price * 10} onClick={() => buyGood(c, 10, price)}>Buy 10</button>
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
            return (
              <div key={c} className="trade-row">
                <div>
                  <div>{COMMODITIES[c].name} <span style={{ fontSize: '0.85em', color: '#6b4423' }}>(have {have})</span></div>
                  <div style={{ fontSize: '0.85em', color: '#6b4423' }}>£{price} per {COMMODITIES[c].unit}</div>
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

// ─────────── OUTPOST VIEW ───────────

function OutpostView({ gs, startBuild }) {
  const built = Object.entries(gs.outpost.buildings).filter(([,v]) => v.built);
  const queue = gs.outpost.queue;
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
              return (
                <div key={i} className="parchment" style={{ padding: '0.7rem 1rem', marginBottom: '0.5rem', background: 'rgba(255,253,245,0.5)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span className="display" style={{ color: '#5c1a08' }}>{b.name}</span>
                    <span className="display" style={{ fontSize: '0.85em', color: '#6b4423' }}>{q.daysLeft} day{q.daysLeft !== 1 ? 's' : ''} remaining</span>
                  </div>
                  <div style={{ height: '5px', background: 'rgba(74,44,20,0.15)', marginTop: '0.4rem', borderRadius: '2px' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#5c1a08', borderRadius: '2px' }} />
                  </div>
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

function AwayDigestScreen({ digest, onContinue }) {
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
        <div className="text-center">
          <button className="wax-button" onClick={onContinue}>Take Up the Work</button>
        </div>
      </div>
    </Page>
  );
}

// ─────────── LETTERS VIEW ───────────

function LettersView({ gs, setGs, onRespond, onRequestNew, openLetterId, setOpenLetterId }) {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem' }}>
        <h2 className="display" style={{ fontSize: '1.4em', color: '#5c1a08', margin: 0 }}>Correspondence</h2>
        <button className="ghost-button" onClick={onRequestNew}>Await the post</button>
      </div>
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

function ProvisionsDrawer({ gs, setGs, requestNewLetter, lastSavedAt }) {
  const [open, setOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMode, setImportMode] = useState(false);
  const [flash, setFlash] = useState('');

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

  const exportJSON = () => {
    try {
      const data = JSON.stringify({ gs, phase: 'game', exportedAt: Date.now() }, null, 2);
      // Try download
      try {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `factors_charter_day${gs.day}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showFlash('Manuscript copied to your downloads.');
      } catch (e) {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(data).then(
          () => showFlash('Manuscript copied to clipboard.'),
          () => showFlash('Could not export. Try the text copy below.')
        );
      }
    } catch (e) {
      showFlash('Export failed.');
    }
  };

  const copyToClipboard = () => {
    try {
      const data = JSON.stringify({ gs, phase: 'game', exportedAt: Date.now() });
      navigator.clipboard.writeText(data).then(
        () => showFlash('Copied to clipboard. Paste somewhere safe.'),
        () => showFlash('Clipboard refused. Long-press the text below to copy.')
      );
    } catch (e) {
      showFlash('Copy failed.');
    }
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
            <button className="ghost-button-sm" onClick={exportJSON}>Download manuscript</button>
            <button className="ghost-button-sm" onClick={copyToClipboard}>Copy to clipboard</button>
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

          <div className="display" style={{ fontSize: '0.85em', color: '#6b4423', marginTop: '1.2rem', marginBottom: '0.5rem' }}>OTHER</div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <button className="ghost-button-sm" onClick={requestNewLetter}>Conjure a letter</button>
            <button className="ghost-button-sm" onClick={async () => {
              if (window.confirm('Begin a fresh charter? Current progress will be lost unless you have downloaded the manuscript.')) {
                await safeStorage.delete('factor_save');
                window.location.reload();
              }
            }}>Begin anew</button>
          </div>
        </div>
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

export default function FactorsCharter() {
  const [phase, setPhase] = useState('loading');
  const [gs, setGs] = useState(null);
  const [savedData, setSavedData] = useState(null);
  const [lastSavedAt, setLastSavedAt] = useState(null);

  // Load saved state — but DO NOT auto-resume; always start at title screen.
  useEffect(() => {
    (async () => {
      const value = await safeStorage.get('factor_save');
      if (value) {
        try {
          const parsed = JSON.parse(value);
          if (parsed.gs && parsed.gs.player) {
            setSavedData(parsed);
            setLastSavedAt(parsed.savedAt || Date.now());
          }
        } catch (e) { /* corrupted save, ignore */ }
      }
      setPhase('title');
    })();
  }, []);

  // Persist whenever the in-game state changes
  useEffect(() => {
    if (!gs || phase === 'loading' || phase === 'title') return;
    (async () => {
      const savedAt = Date.now();
      const ok = await safeStorage.set('factor_save', JSON.stringify({ gs, phase, savedAt }));
      if (ok) {
        setLastSavedAt(savedAt);
        setSavedData({ gs, phase, savedAt });
      }
    })();
  }, [gs, phase]);

  const handleNewGame = async (name) => {
    await safeStorage.delete('factor_save');
    setSavedData(null);
    setLastSavedAt(null);
    setGs(makeInitialState(name));
    setPhase('opening');
  };

  const handleContinue = () => {
    if (savedData && savedData.gs) {
      setGs(savedData.gs);
      setPhase(savedData.phase || 'game');
    }
  };

  const handleRestore = (restoredGs) => {
    setGs(restoredGs);
    setPhase('game');
  };

  const handleReturnToTitle = () => {
    setPhase('title');
  };

  if (phase === 'loading') {
    return <Page><Loading msg="Unrolling the chart" /></Page>;
  }

  if (phase === 'title') {
    return (
      <Page>
        <TitleScreen
          savedData={savedData}
          onNewGame={handleNewGame}
          onContinue={handleContinue}
          onRestore={handleRestore}
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
