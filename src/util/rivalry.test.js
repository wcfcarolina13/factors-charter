import { describe, it, expect } from 'vitest';
import {
  makeInitialRivals,
  RIVAL_KEYS,
  RIVALS_REGISTRY,
} from './rivalry.js';

describe('makeInitialRivals', () => {
  it('returns an object with the three rival keys', () => {
    const rivals = makeInitialRivals();
    expect(Object.keys(rivals).sort()).toEqual(['hardacre', 'lowji', 'terborch']);
  });

  it('initialises each rival with standing 50, state "steady", empty eventsFired, lastEventDay 0', () => {
    const rivals = makeInitialRivals();
    for (const key of ['hardacre', 'terborch', 'lowji']) {
      expect(rivals[key].standing).toBe(50);
      expect(rivals[key].state).toBe('steady');
      expect(rivals[key].eventsFired).toEqual([]);
      expect(rivals[key].lastEventDay).toBe(0);
    }
  });

  it('Hardacre carries pepper and cinnamon zero-init', () => {
    const rivals = makeInitialRivals();
    expect(rivals.hardacre.pepper).toBe(0);
    expect(rivals.hardacre.cinnamon).toBe(0);
  });

  it('each rival carries name, station, faction', () => {
    const rivals = makeInitialRivals();
    expect(rivals.hardacre).toMatchObject({ name: 'Mr. Hardacre',           station: 'Bencoolen',         faction: 'company' });
    expect(rivals.terborch).toMatchObject({ name: 'Mynheer ter Borch',      station: 'Port St. Eustace',  faction: 'dutch' });
    expect(rivals.lowji).toMatchObject(   { name: 'Mr. Lowji Nusserwanji',  station: 'Bombay',            faction: null });
  });

  it('returns a fresh object each call (no shared mutable state)', () => {
    const a = makeInitialRivals();
    const b = makeInitialRivals();
    a.hardacre.eventsFired.push('test');
    expect(b.hardacre.eventsFired).toEqual([]);
  });
});

describe('RIVAL_KEYS', () => {
  it('lists all three rival keys', () => {
    expect(RIVAL_KEYS).toEqual(['hardacre', 'terborch', 'lowji']);
  });
});

describe('RIVALS_REGISTRY', () => {
  it('binds each rival to an intel channel', () => {
    const map = Object.fromEntries(RIVALS_REGISTRY.map(r => [r.key, r.intelChannel]));
    expect(map.hardacre).toBe('brotherhood');
    expect(map.terborch).toBe('vizier');
    expect(map.lowji).toBe('cama');
  });
});
