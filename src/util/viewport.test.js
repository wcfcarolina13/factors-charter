import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectMode, setOverride, DESKTOP_QUERY } from './viewport.js';

const KEY = 'factor_view_override';

function mockMatchMedia(matches) {
  return vi.fn().mockImplementation((query) => ({
    matches: query === DESKTOP_QUERY ? matches : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('detectMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.matchMedia = mockMatchMedia(false);
  });

  it('returns desktop when override is set to desktop', () => {
    window.localStorage.setItem(KEY, 'desktop');
    expect(detectMode()).toBe('desktop');
  });

  it('returns mobile when override is set to mobile', () => {
    window.localStorage.setItem(KEY, 'mobile');
    // Even with the desktop media query matching, the override wins.
    window.matchMedia = mockMatchMedia(true);
    expect(detectMode()).toBe('mobile');
  });

  it('falls back to the media query when no override is set', () => {
    window.matchMedia = mockMatchMedia(true);
    expect(detectMode()).toBe('desktop');

    window.matchMedia = mockMatchMedia(false);
    expect(detectMode()).toBe('mobile');
  });

  it('ignores garbage override values and falls back to media query', () => {
    window.localStorage.setItem(KEY, 'tablet');
    window.matchMedia = mockMatchMedia(true);
    expect(detectMode()).toBe('desktop');
  });

  it('survives a localStorage that throws on getItem', () => {
    const broken = {
      getItem: () => { throw new Error('disabled'); },
      setItem: () => { throw new Error('disabled'); },
      removeItem: () => { throw new Error('disabled'); },
    };
    const orig = window.localStorage;
    Object.defineProperty(window, 'localStorage', { value: broken, configurable: true });
    window.matchMedia = mockMatchMedia(true);
    expect(detectMode()).toBe('desktop');
    Object.defineProperty(window, 'localStorage', { value: orig, configurable: true });
  });
});

describe('setOverride', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.matchMedia = mockMatchMedia(false);
  });

  it('writes the override when the requested mode differs from auto-detect', () => {
    // Auto would be mobile (matchMedia false); requesting desktop writes the key.
    setOverride('desktop');
    expect(window.localStorage.getItem(KEY)).toBe('desktop');
  });

  it('clears the override when the requested mode matches auto-detect', () => {
    window.localStorage.setItem(KEY, 'desktop');
    // Auto would be desktop (matchMedia true); requesting desktop clears the key
    // so future viewport changes are honored.
    window.matchMedia = mockMatchMedia(true);
    setOverride('desktop');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('dispatches a storage event so same-tab listeners react', () => {
    const listener = vi.fn();
    window.addEventListener('storage', listener);
    setOverride('desktop');
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0].key).toBe(KEY);
    window.removeEventListener('storage', listener);
  });

  it('survives a localStorage that throws', () => {
    const broken = {
      getItem: () => { throw new Error('disabled'); },
      setItem: () => { throw new Error('disabled'); },
      removeItem: () => { throw new Error('disabled'); },
    };
    const orig = window.localStorage;
    Object.defineProperty(window, 'localStorage', { value: broken, configurable: true });
    expect(() => setOverride('desktop')).not.toThrow();
    Object.defineProperty(window, 'localStorage', { value: orig, configurable: true });
  });
});
