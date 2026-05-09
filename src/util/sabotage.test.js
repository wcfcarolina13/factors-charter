import { describe, it, expect } from 'vitest';
import {
  canOfferSabotage,
  resolveSabotage,
  sabotageChannel,
  SABOTAGE_RIVALS,
  SABOTAGE_TABLE,
} from './sabotage.js';
import { makeInitialRivals } from './rivalry.js';

function baseGs(over = {}) {
  return {
    day: 400,
    charterClosed: null,
    flags: {
      hardacreIntelPlant: true,
      terborchIntelPlant: true,
      lowjiIntelPlant: true,
    },
    rivals: makeInitialRivals(),
    quotas: {
      pepper:   { have: 0, target: 400 },
      cinnamon: { have: 0, target: 200 },
    },
    rivalPressureModifiers: [],
    reputation: {},
    ...over,
  };
}

// pressuredGs: forces computeRivalPressure >= 60 by giving Hardacre a
// tonnage advantage on both commodities (+10 + +10 over baseline 50).
function pressuredGs(over = {}) {
  const gs = baseGs(over);
  gs.rivals.hardacre.pepper = 100;
  gs.rivals.hardacre.cinnamon = 50;
  return gs;
}

describe('canOfferSabotage', () => {
  it('passes all gates when fully eligible (hardacre)', () => {
    expect(canOfferSabotage('hardacre', pressuredGs())).toBe(true);
  });

  it('passes for terborch and lowji when pressured', () => {
    expect(canOfferSabotage('terborch', pressuredGs())).toBe(true);
    expect(canOfferSabotage('lowji', pressuredGs())).toBe(true);
  });

  it('fails for an unknown rival key', () => {
    expect(canOfferSabotage('nope', pressuredGs())).toBe(false);
  });

  it('fails when charter is closed', () => {
    expect(canOfferSabotage('hardacre', pressuredGs({ charterClosed: { day: 400 } }))).toBe(false);
  });

  it('fails before day 365', () => {
    expect(canOfferSabotage('hardacre', pressuredGs({ day: 364 }))).toBe(false);
  });

  it('passes at the day-365 boundary', () => {
    expect(canOfferSabotage('hardacre', pressuredGs({ day: 365 }))).toBe(true);
  });

  it('fails when the offer flag is already set', () => {
    const gs = pressuredGs();
    gs.flags.sabotage_hardacre_offered = true;
    expect(canOfferSabotage('hardacre', gs)).toBe(false);
  });

  it('fails when the rival is already broken', () => {
    const gs = pressuredGs();
    gs.rivals.hardacre.state = 'broken';
    expect(canOfferSabotage('hardacre', gs)).toBe(false);
  });

  it('fails when pressure is below 60', () => {
    expect(canOfferSabotage('hardacre', baseGs())).toBe(false);
  });

  it('fails when the channel intel-plant flag is missing', () => {
    const gs = pressuredGs();
    gs.flags.hardacreIntelPlant = false;
    expect(canOfferSabotage('hardacre', gs)).toBe(false);
  });

  it('terborch gate uses terborchIntelPlant', () => {
    const gs = pressuredGs();
    gs.flags.terborchIntelPlant = false;
    expect(canOfferSabotage('terborch', gs)).toBe(false);
  });

  it('lowji gate uses lowjiIntelPlant', () => {
    const gs = pressuredGs();
    gs.flags.lowjiIntelPlant = false;
    expect(canOfferSabotage('lowji', gs)).toBe(false);
  });
});

describe('resolveSabotage', () => {
  const fixed = (v) => () => v;

  it('returns success when roll is below the success cutoff', () => {
    const gs = { reputation: { pirates: 50 } };
    expect(resolveSabotage('hardacre', gs, { method: 'commission', randFn: fixed(0.30) }))
      .toBe('success');
  });

  it('returns partial in the mid band', () => {
    const gs = { reputation: { pirates: 50 } };
    expect(resolveSabotage('hardacre', gs, { method: 'commission', randFn: fixed(0.65) }))
      .toBe('partial');
  });

  it('returns failure above the partial band', () => {
    const gs = { reputation: { pirates: 50 } };
    expect(resolveSabotage('hardacre', gs, { method: 'commission', randFn: fixed(0.85) }))
      .toBe('failure');
  });

  it('rapport raises the success cutoff', () => {
    const gs = { reputation: { pirates: 100 } };
    // base 60 + min(25, (100-50)/2)=25 → cutoff 85; 0.80 → success
    expect(resolveSabotage('hardacre', gs, { method: 'commission', randFn: fixed(0.80) }))
      .toBe('success');
  });

  it('rep below floor does not penalise — base rate stands', () => {
    const gs = { reputation: { pirates: 0 } };
    expect(resolveSabotage('hardacre', gs, { method: 'commission', randFn: fixed(0.55) }))
      .toBe('success');
  });

  it('negotiate has lower base success rate', () => {
    const gs = { reputation: { pirates: 50 } };
    // base 40, partial mid 60, roll 0.50 → partial
    expect(resolveSabotage('hardacre', gs, { method: 'negotiate', randFn: fixed(0.50) }))
      .toBe('partial');
  });

  it('terborch uses rajah rep for rapport', () => {
    const gs = { reputation: { rajah: 100 } };
    expect(resolveSabotage('terborch', gs, { method: 'commission', randFn: fixed(0.80) }))
      .toBe('success');
  });

  it('lowji uses company rep for rapport', () => {
    const gs = { reputation: { company: 100 } };
    expect(resolveSabotage('lowji', gs, { method: 'commission', randFn: fixed(0.80) }))
      .toBe('success');
  });

  it('returns failure for an unknown rival', () => {
    expect(resolveSabotage('nope', {}, { method: 'commission', randFn: fixed(0) }))
      .toBe('failure');
  });

  it('returns failure for an unknown method', () => {
    expect(resolveSabotage('hardacre', {}, { method: 'sneak', randFn: fixed(0) }))
      .toBe('failure');
  });
});

describe('SABOTAGE_TABLE / sabotageChannel', () => {
  it('exposes a channel per rival', () => {
    expect(sabotageChannel('hardacre')).toBe('brotherhood');
    expect(sabotageChannel('terborch')).toBe('vizier');
    expect(sabotageChannel('lowji')).toBe('cama');
  });

  it('returns null for an unknown rival', () => {
    expect(sabotageChannel('nope')).toBe(null);
  });

  it('SABOTAGE_RIVALS matches table keys', () => {
    expect([...SABOTAGE_RIVALS].sort()).toEqual(Object.keys(SABOTAGE_TABLE).sort());
  });

  it('table and method entries are frozen', () => {
    expect(Object.isFrozen(SABOTAGE_TABLE)).toBe(true);
    expect(Object.isFrozen(SABOTAGE_TABLE.hardacre)).toBe(true);
    expect(Object.isFrozen(SABOTAGE_TABLE.hardacre.methods)).toBe(true);
    expect(Object.isFrozen(SABOTAGE_TABLE.hardacre.methods.commission)).toBe(true);
  });

  it('SABOTAGE_RIVALS is frozen', () => {
    expect(Object.isFrozen(SABOTAGE_RIVALS)).toBe(true);
  });
});
