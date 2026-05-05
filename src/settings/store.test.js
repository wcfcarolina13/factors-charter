import { describe, it, expect, beforeEach } from 'vitest';
import { readConfig, writeConfig, clearConfig } from './store.js';

describe('settings store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no config is stored', () => {
    expect(readConfig()).toBeNull();
  });

  it('round-trips a config object', () => {
    const cfg = { providerId: 'anthropic', settings: { apiKey: 'sk-test', model: 'claude-x' } };
    writeConfig(cfg);
    expect(readConfig()).toEqual(cfg);
  });

  it('returns null when stored value is malformed JSON', () => {
    localStorage.setItem('factor_charter_llm_config_v1', '{not json');
    expect(readConfig()).toBeNull();
  });

  it('clearConfig removes the stored value', () => {
    writeConfig({ providerId: 'anthropic', settings: {} });
    clearConfig();
    expect(readConfig()).toBeNull();
  });
});
