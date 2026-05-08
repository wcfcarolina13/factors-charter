// Pure rivalry logic — registries, initial state, and (in subsequent tasks)
// scheduling, pressure formula, baseline trajectory functions. React-free.
//
// Companion file: ./price-windows.js for arbitrage window arithmetic.

export const RIVAL_KEYS = ['hardacre', 'terborch', 'lowji'];

export function makeInitialRivals() {
  return {
    hardacre: {
      name: 'Mr. Hardacre',
      station: 'Bencoolen',
      faction: 'company',
      pepper: 0,
      cinnamon: 0,
      standing: 50,
      state: 'steady',
      eventsFired: [],
      lastEventDay: 0,
    },
    terborch: {
      name: 'Mynheer ter Borch',
      station: 'Port St. Eustace',
      faction: 'dutch',
      standing: 50,
      state: 'steady',
      eventsFired: [],
      lastEventDay: 0,
    },
    lowji: {
      name: 'Mr. Lowji Nusserwanji',
      station: 'Bombay',
      faction: null,
      standing: 50,
      state: 'steady',
      eventsFired: [],
      lastEventDay: 0,
    },
  };
}

// Per-rival metadata. `baselineFn` is filled in by Task 1.3.
// `intelChannel` ties each rival to one intel-buy sender.
export const RIVALS_REGISTRY = [
  { key: 'hardacre', intelChannel: 'brotherhood' },
  { key: 'terborch', intelChannel: 'vizier' },
  { key: 'lowji',    intelChannel: 'cama' },
];
