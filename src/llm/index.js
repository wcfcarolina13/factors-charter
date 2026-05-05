import { anthropic } from './anthropic.js';
import { ollama } from './ollama.js';
import { readConfig } from '../settings/store.js';

const PROVIDERS = { anthropic, ollama };

export function listProviders() {
  return Object.values(PROVIDERS);
}

export async function callLLM({ system, prompt, maxTokens = 1000 }) {
  const cfg = readConfig();
  const provider = cfg && PROVIDERS[cfg.providerId];
  const startedAt = Date.now();

  if (!provider) {
    return {
      parsed: null,
      raw: '',
      prompt,
      startedAt,
      endedAt: Date.now(),
      error: 'No LLM provider configured',
    };
  }

  try {
    const text = await provider.call({
      system,
      prompt,
      maxTokens,
      ...(cfg.settings || {}),
    });
    const cleaned = text.replace(/```json|```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    let parsed = null;
    let parseError = null;
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch (e) {
        parseError = e.message;
      }
    } else {
      parseError = 'No JSON object found in response';
    }
    return {
      parsed,
      raw: text,
      prompt,
      startedAt,
      endedAt: Date.now(),
      error: parseError,
    };
  } catch (e) {
    return {
      parsed: null,
      raw: '',
      prompt,
      startedAt,
      endedAt: Date.now(),
      error: e.message || String(e),
    };
  }
}
