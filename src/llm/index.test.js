import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callLLM } from './index.js';
import { writeConfig, clearConfig } from '../settings/store.js';

describe('callLLM dispatcher', () => {
  beforeEach(() => {
    clearConfig();
    localStorage.clear();
  });

  it('returns an error result when no provider is configured', async () => {
    const result = await callLLM({ system: 's', prompt: 'p' });
    expect(result.parsed).toBeNull();
    expect(result.error).toMatch(/no.*provider/i);
    expect(result.startedAt).toBeTypeOf('number');
    expect(result.endedAt).toBeTypeOf('number');
  });

  it('returns an error result when the configured provider id is unknown', async () => {
    writeConfig({ providerId: 'nonexistent', settings: {} });
    const result = await callLLM({ system: 's', prompt: 'p' });
    expect(result.error).toMatch(/no.*provider|unknown/i);
  });

  it('parses valid JSON from a successful provider response', async () => {
    writeConfig({ providerId: 'anthropic', settings: { apiKey: 'k', model: 'm' } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{"days": 3, "summary": "ok"}' }] }),
    });
    const result = await callLLM({ system: 's', prompt: 'p' });
    expect(result.parsed).toEqual({ days: 3, summary: 'ok' });
    expect(result.raw).toBe('{"days": 3, "summary": "ok"}');
    expect(result.error).toBeNull();
  });

  it('strips ```json fences before parsing', async () => {
    writeConfig({ providerId: 'anthropic', settings: { apiKey: 'k', model: 'm' } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '```json\n{"x":1}\n```' }] }),
    });
    const result = await callLLM({ system: 's', prompt: 'p' });
    expect(result.parsed).toEqual({ x: 1 });
  });

  it('returns parsed=null with parseError set when JSON is malformed', async () => {
    writeConfig({ providerId: 'anthropic', settings: { apiKey: 'k', model: 'm' } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{not valid' }] }),
    });
    const result = await callLLM({ system: 's', prompt: 'p' });
    expect(result.parsed).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('captures provider exceptions in the result', async () => {
    writeConfig({ providerId: 'anthropic', settings: { apiKey: 'k', model: 'm' } });
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await callLLM({ system: 's', prompt: 'p' });
    expect(result.parsed).toBeNull();
    expect(result.error).toMatch(/network down/);
  });

  it('passes provider settings through to the provider call', async () => {
    writeConfig({ providerId: 'ollama', settings: { endpoint: 'http://x:1', model: 'm' } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '{}' } }),
    });
    await callLLM({ system: 's', prompt: 'p' });
    expect(global.fetch).toHaveBeenCalledWith('http://x:1/api/chat', expect.anything());
  });
});
