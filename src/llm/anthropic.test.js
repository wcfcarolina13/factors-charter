import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { anthropic } from './anthropic.js';

describe('anthropic provider', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports the expected metadata shape', () => {
    expect(anthropic.id).toBe('anthropic');
    expect(anthropic.label).toMatch(/anthropic/i);
    expect(Array.isArray(anthropic.fields)).toBe(true);
    expect(anthropic.fields.find(f => f.key === 'apiKey')).toBeTruthy();
    expect(anthropic.fields.find(f => f.key === 'model')).toBeTruthy();
  });

  it('posts to /v1/messages with correct headers and body', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{"hello":true}' }] }),
    });

    const text = await anthropic.call({
      system: 'sys',
      prompt: 'hi',
      maxTokens: 500,
      apiKey: 'sk-abc',
      model: 'claude-x',
    });

    expect(text).toBe('{"hello":true}');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'sk-abc',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }),
      })
    );
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe('claude-x');
    expect(body.system).toBe('sys');
    expect(body.max_tokens).toBe(500);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('throws on non-2xx response', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    });
    await expect(
      anthropic.call({ system: 's', prompt: 'p', maxTokens: 100, apiKey: 'bad', model: 'x' })
    ).rejects.toThrow(/401/);
  });

  it('joins multiple text blocks in the response', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'a' },
          { type: 'tool_use' },
          { type: 'text', text: 'b' },
        ],
      }),
    });
    const text = await anthropic.call({ system: 's', prompt: 'p', maxTokens: 100, apiKey: 'k', model: 'x' });
    expect(text).toBe('ab');
  });
});
