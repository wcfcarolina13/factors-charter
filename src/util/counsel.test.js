import { describe, it, expect } from 'vitest';
import { winCounsel } from './counsel.js';

const base = {
  daysRemaining: 1000, charterLength: 1095,
  pepperSecured: 0, pepperNeeded: 400,
  cinnamonSecured: 0, cinnamonNeeded: 200,
  indiamanInDays: 120, money: 500,
  hasBrigantine: false, hasShipyard: false,
  hasPepperGarden: false, hasSpiceEstate: false,
  hasPlantation: false, plantationEligible: false,
  pepperGardenCost: 700, spiceEstateCost: 1300, brigCost: 900,
};

describe('winCounsel', () => {
  it('reports won when both quotas are met', () => {
    expect(winCounsel({ ...base, pepperSecured: 400, cinnamonSecured: 200 }).kind).toBe('won');
  });

  it('early + poor + no engine → build capital', () => {
    expect(winCounsel(base).kind).toBe('capital');
  });

  it('with brigantine money → advises the brigantine first', () => {
    expect(winCounsel({ ...base, money: 950 }).kind).toBe('brigantine');
  });

  it('brigantine advice notes whether the yard is up', () => {
    expect(winCounsel({ ...base, money: 950, hasShipyard: false }))
      .toMatchObject({ kind: 'brigantine', hasShipyard: false });
    expect(winCounsel({ ...base, money: 950, hasShipyard: true }))
      .toMatchObject({ kind: 'brigantine', hasShipyard: true });
  });

  it('once you have the brigantine, points at the pepper garden', () => {
    expect(winCounsel({ ...base, money: 750, hasBrigantine: true }).kind).toBe('pepper-garden');
  });

  it('garden owned + cinnamon lagging + funds → the spice estate', () => {
    const r = winCounsel({
      ...base, money: 1400, hasBrigantine: true, hasPepperGarden: true,
      pepperSecured: 200, cinnamonSecured: 0, // cinnamon far behind pepper
    });
    expect(r.kind).toBe('spice-estate');
  });

  it('engine built, cinnamon still lagging, no funds → cinnamon runs', () => {
    const r = winCounsel({
      ...base, money: 100, hasBrigantine: true, hasPepperGarden: true, hasSpiceEstate: true,
      pepperSecured: 200, cinnamonSecured: 20,
    });
    expect(r.kind).toBe('cinnamon-runs');
  });

  it('engine built and on pace → steady, carrying the Indiaman countdown', () => {
    const r = winCounsel({
      ...base, money: 100, hasBrigantine: true, hasPepperGarden: true, hasSpiceEstate: true,
      pepperSecured: 120, cinnamonSecured: 60, daysRemaining: 700, indiamanInDays: 40,
    });
    expect(r.kind).toBe('steady');
    expect(r.indiamanInDays).toBe(40);
  });

  it('suggests the plantation when eligible, has a garden, modest funds', () => {
    const r = winCounsel({
      ...base, money: 300, hasBrigantine: true, hasPepperGarden: true,
      plantationEligible: true, hasPlantation: false,
      pepperSecured: 100, cinnamonSecured: 60, // not lagging
    });
    expect(r.kind).toBe('plantation');
  });

  it('late and well behind → behind, focused on the laggard', () => {
    const r = winCounsel({
      ...base, daysRemaining: 150,
      pepperSecured: 120, cinnamonSecured: 10, // cinnamon worst, overall behind
      money: 2000, hasBrigantine: true, hasPepperGarden: true, hasSpiceEstate: true,
    });
    expect(r.kind).toBe('behind');
    expect(r.focus).toBe('cinnamon');
  });

  it('does not cry "behind" early even at zero progress', () => {
    // day ~50, nothing shipped yet — that is normal, not behind
    expect(winCounsel({ ...base, daysRemaining: 1045 }).kind).not.toBe('behind');
  });
});
