// nextAmbition — the single nearest rung the Factor is reaching for, surfaced as
// a quiet goal-gradient line on the Journal hub ("£430 yet wanting for the
// brigantine"). The goal gradient pulls hardest when the target is NEAR, so we
// pick the unowned upgrade with the SMALLEST funding gap; if everything is
// affordable, we point at the grandest unowned thing as a nudge to reach up;
// if nothing is left to build, the quota is the remaining work.
//
// Pure + testable. The monolith assembles `aspirations` from its registries
// (the brigantine path, unowned ventures, available buildings) and renders the
// returned shape into the Factor's first-person voice.

export function nextAmbition({ money, aspirations = [], quota } = {}) {
  const m = money || 0;
  const valid = (aspirations || []).filter(a => a && typeof a.cost === 'number');

  // Nearest thing you cannot yet afford — the strongest pull.
  const unaffordable = valid
    .filter(a => a.cost > m)
    .sort((a, b) => (a.cost - m) - (b.cost - m));
  if (unaffordable.length) {
    const a = unaffordable[0];
    return { kind: 'reach', key: a.key, label: a.label, cost: a.cost, gap: a.cost - m };
  }

  // Everything is affordable — point at the grandest unowned aspiration.
  if (valid.length) {
    const a = [...valid].sort((x, y) => y.cost - x.cost)[0];
    return { kind: 'afford', key: a.key, label: a.label, cost: a.cost, gap: 0 };
  }

  // No upgrades left to take — the charter itself is the remaining work.
  if (quota) {
    const pepGap = Math.max(0, (quota.pepper?.needed || 0) - (quota.pepper?.secured || 0));
    const cinGap = Math.max(0, (quota.cinnamon?.needed || 0) - (quota.cinnamon?.secured || 0));
    if (pepGap > 0 || cinGap > 0) return { kind: 'quota', pepGap, cinGap };
    return { kind: 'quota-met' };
  }

  return null;
}
