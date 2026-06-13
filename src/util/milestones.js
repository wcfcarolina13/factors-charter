// Wealth milestones — the clearest sign the country trade is compounding.
// Each fires once, dropping a turning-point reflection in the Factor's own
// journal (his voice, period-dry). The flag is the once-only guard.
//
// Money changes in many places (trades, the Indiaman payout, outcomes), so a
// guarded effect on gs.money is the single chokepoint; ensureShape seeds the
// flags for thresholds already met on an existing save so they don't fire
// retroactively.

export const WEALTH_MILESTONES = [
  {
    flag: 'wealth_1k',
    threshold: 1000,
    entry: 'The strongbox passed a thousand pounds this evening. A modest sum in Leadenhall, and a great one at this wharf. I have begun to be a merchant, and not merely a clerk with a charter.',
  },
  {
    flag: 'wealth_2_5k',
    threshold: 2500,
    entry: 'Two thousand five hundred pounds in the box, counted twice. Wilbraham never saw the like at one time, by his papers. The country trade rewards the patient and buries the bold in equal measure; I mean to stay patient.',
  },
  {
    flag: 'wealth_5k',
    threshold: 5000,
    entry: 'Five thousand pounds. I could lay down a second vessel and take a share in a third. The Court would not credit the figure, and I shall not trouble them with it — what is privately got is privately kept.',
  },
  {
    flag: 'wealth_10k',
    threshold: 10000,
    entry: 'Ten thousand pounds. A man might go home on this — a house in the green shires, and never smell salt or palm-oil again. I find, to my surprise, that I am in no hurry to.',
  },
];

// Milestones whose threshold is met and whose flag is not yet set. Returns an
// array (a single large gain can cross more than one at once), lowest first.
export function pendingWealthMilestones(money, flags) {
  const f = flags || {};
  const m = typeof money === 'number' ? money : 0;
  return WEALTH_MILESTONES.filter(ms => m >= ms.threshold && !f[ms.flag]);
}

// For ensureShape: mark every already-met threshold as flagged WITHOUT
// journaling, so an existing save crossing into this feature doesn't fire a
// retroactive run of milestones. Returns a new flags object (or the same one
// if nothing changed) — callers may keep the reference.
export function seedWealthFlags(money, flags) {
  const f = flags && typeof flags === 'object' ? flags : {};
  const m = typeof money === 'number' ? money : 0;
  let changed = false;
  const next = { ...f };
  for (const ms of WEALTH_MILESTONES) {
    if (m >= ms.threshold && !next[ms.flag]) {
      next[ms.flag] = true;
      changed = true;
    }
  }
  return changed ? next : f;
}
