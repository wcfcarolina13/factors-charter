import { describe, it, expect } from 'vitest';
import { pickPlate, PLATES } from './plates.js';

describe('pickPlate', () => {
  it('returns null for empty input', () => {
    expect(pickPlate('')).toBeNull();
    expect(pickPlate(null)).toBeNull();
    expect(pickPlate(undefined)).toBeNull();
  });

  it('returns null when no keywords match', () => {
    expect(pickPlate('utterly unmatched gibberish that hits no keyword')).toBeNull();
  });

  it('matches the squall plate on weather keywords', () => {
    const p = pickPlate('the squall passed and the gale slackened');
    expect(p).not.toBeNull();
    expect(p.id).toBe('plate-vii');
  });

  it('matches the prahu-sighted plate on sea-encounter keywords', () => {
    const p = pickPlate('a lateen-rigged prahu put out from the lee shore');
    expect(p).not.toBeNull();
    expect(p.id).toBe('plate-viii');
  });

  it('matches the strange-island plate on castaway keywords', () => {
    const p = pickPlate('the castaway pointed to the cove on the strange island');
    expect(p).not.toBeNull();
    expect(p.id).toBe('plate-xi');
  });

  it('is case-insensitive', () => {
    const lower = pickPlate('squall');
    const mixed = pickPlate('Squall');
    const upper = pickPlate('SQUALL');
    expect(lower?.id).toBe('plate-vii');
    expect(mixed?.id).toBe('plate-vii');
    expect(upper?.id).toBe('plate-vii');
  });

  it('emits paths under /plates/ for the PWA runtime', () => {
    // The PLATES module evaluated under jsdom (`window.storage` undefined),
    // so paths should be relative — what the PWA build serves.
    for (const p of PLATES) {
      expect(p.src).toMatch(/^\/plates\/plate-[a-z]+\.jpg$/);
    }
  });

  it('has six plates with unique ids', () => {
    expect(PLATES).toHaveLength(6);
    const ids = new Set(PLATES.map((p) => p.id));
    expect(ids.size).toBe(6);
  });
});
