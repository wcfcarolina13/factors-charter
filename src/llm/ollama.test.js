import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ollama } from './ollama.js';

describe('ollama provider', () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('exports the expected metadata shape', () => {
    expect(ollama.id).toBe('ollama');
    expect(ollama.fields.find(f => f.key === 'endpoint')).toBeTruthy();
    expect(ollama.fields.find(f => f.key === 'model')).toBeTruthy();
  });

  it('posts to <endpoint>/api/chat with system + user messages and JSON format', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '{"ok":true}' } }),
    });

    const text = await ollama.call({
      system: 'sys',
      prompt: 'hi',
      maxTokens: 800,
      endpoint: 'http://localhost:11434',
      model: 'llama3.1:8b',
    });

    expect(text).toBe('{"ok":true}');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe('llama3.1:8b');
    expect(body.format).toBe('json');
    expect(body.stream).toBe(false);
    expect(body.options.num_predict).toBe(800);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('throws on non-2xx response', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'down' });
    await expect(
      ollama.call({ system: 's', prompt: 'p', maxTokens: 1, endpoint: 'http://x', model: 'm' })
    ).rejects.toThrow(/503/);
  });

  it('returns empty string when message.content is missing', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const text = await ollama.call({ system: 's', prompt: 'p', maxTokens: 1, endpoint: 'http://x', model: 'm' });
    expect(text).toBe('');
  });
});
