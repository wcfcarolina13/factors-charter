import { describe, it, expect } from 'vitest';
import { detectConflict } from './sync-conflict.js';

describe('detectConflict', () => {
  it('returns push when remote is null', () => {
    expect(detectConflict({ local: { day: 5 }, remote: null, lastKnown: null })).toBe('push');
    expect(detectConflict({ local: { day: 5 }, remote: null, lastKnown: { version: 3, day: 5 } })).toBe('push');
  });

  it('returns conflict when lastKnown is null but remote exists', () => {
    expect(detectConflict({ local: { day: 5 }, remote: { version: 1, day: 5 }, lastKnown: null })).toBe('conflict');
  });

  it('returns none when remote.version equals lastKnown.version', () => {
    expect(detectConflict({ local: { day: 10 }, remote: { version: 5, day: 8 }, lastKnown: { version: 5, day: 8 } })).toBe('none');
  });

  it('returns pull when remote progressed but local did not', () => {
    expect(detectConflict({
      local: { day: 8 },
      remote: { version: 6, day: 12 },
      lastKnown: { version: 5, day: 8 },
    })).toBe('pull');
  });

  it('returns conflict when both remote and local progressed past lastKnown', () => {
    expect(detectConflict({
      local: { day: 11 },
      remote: { version: 6, day: 12 },
      lastKnown: { version: 5, day: 8 },
    })).toBe('conflict');
  });

  it('returns push when remote.version is somehow lower than lastKnown', () => {
    expect(detectConflict({
      local: { day: 10 },
      remote: { version: 3, day: 5 },
      lastKnown: { version: 5, day: 8 },
    })).toBe('push');
  });

  it('handles missing day fields gracefully', () => {
    expect(detectConflict({ local: {}, remote: { version: 6, day: 12 }, lastKnown: { version: 5 } })).toBe('pull');
  });
});
