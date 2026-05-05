# Factor's Charter — PWA Port Design

**Date:** 2026-05-05
**Status:** Design approved, awaiting implementation plan
**Author:** Bradley + Claude

---

## Problem

The Factor's Charter currently runs only inside Claude as a single-file React artifact. The goal is to make it playable directly on mobile (and desktop) without requiring the Claude app, while preserving the artifact-runnable path for ongoing development.

The trickiest piece is the AI: `callClaude` at [factors_charter.jsx:3636](../../../factors_charter.jsx) calls `https://api.anthropic.com/v1/messages` with no auth header. That works because the artifact host injects credentials and bridges CORS. Outside the artifact, the same request 401s and is CORS-blocked.

## Goals (v1)

- Playable as a PWA on iOS and Android (Add to Home Screen, fullscreen launch)
- Same code runs in any desktop browser
- AI calls work via player-supplied Anthropic API key (BYO)
- Provider layer is pluggable; Ollama supported as a free desktop-only alternative
- Existing artifact workflow continues to work unchanged
- Existing saves load without migration

## Non-goals (v1)

- Cloud save sync (existing manuscript export covers cross-device)
- More than two providers shipped (others are one new file each, deferred)
- App Store / Play Store distribution
- Push notifications, share sheet, haptics
- User accounts, leaderboards, multiplayer
- Analytics / telemetry
- Refactoring the JSX monolith

## Architecture

The monolith stays at the repo root for artifact compatibility. A small Vite scaffold around it produces a static build; a PWA manifest + service worker make it installable.

```
factors-charter/
  factors_charter.jsx           ← unchanged location, ~1 function rewired
  index.html                    ← Vite entry
  vite.config.js                ← Vite + vite-plugin-pwa
  package.json
  src/
    main.jsx                    ← mounts FactorsCharter to #root
    llm/
      index.js                  ← callLLM dispatcher
      anthropic.js              ← BYO-key provider
      ollama.js                 ← localhost provider
    settings/
      SettingsPanel.jsx         ← provider config UI
      store.js                  ← localStorage-backed config
  public/
    manifest.webmanifest
    icon-192.png, icon-512.png, icon-512-maskable.png
  CLAUDE.md, WORLD_NOTES.md, …  ← unchanged
```

The only edit to `factors_charter.jsx` is replacing the body of `callClaude` (~25 lines at line 3636) with a thin wrapper that delegates to `callLLM` and preserves the existing return shape `{ parsed, raw, prompt, startedAt, endedAt, error }`. Every existing callsite continues to work unchanged.

`safeStorage` already prefers `localStorage` when `window.storage` is absent — no change needed. The `window.storage` branch becomes dead code in the PWA environment but stays in for artifact compatibility.

## Provider layer

```js
// src/llm/index.js
import { anthropic } from './anthropic.js';
import { ollama } from './ollama.js';
import { readConfig } from '../settings/store.js';

const PROVIDERS = { anthropic, ollama };

export async function callLLM({ system, prompt, maxTokens = 1000 }) {
  const cfg = readConfig();
  const provider = PROVIDERS[cfg?.providerId];
  if (!provider) {
    return { parsed: null, raw: '', error: 'No LLM provider configured', startedAt: Date.now(), endedAt: Date.now() };
  }
  const startedAt = Date.now();
  try {
    const text = await provider.call({ system, prompt, maxTokens, ...cfg.settings });
    const cleaned = text.replace(/```json|```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    let parsed = null, parseError = null;
    if (match) try { parsed = JSON.parse(match[0]); } catch (e) { parseError = e.message; }
    return { parsed, raw: text, prompt, startedAt, endedAt: Date.now(), error: parseError };
  } catch (e) {
    return { parsed: null, raw: '', prompt, startedAt, endedAt: Date.now(), error: e.message };
  }
}
```

Each provider exports the same shape:

```js
// src/llm/anthropic.js
export const anthropic = {
  id: 'anthropic',
  label: 'Anthropic API (BYO key)',
  fields: [
    { key: 'apiKey', label: 'API key', type: 'password', required: true },
    { key: 'model', label: 'Model', type: 'text', default: 'claude-sonnet-4-20250514' },
  ],
  call: async ({ system, prompt, maxTokens, apiKey, model }) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data?.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  },
};
```

```js
// src/llm/ollama.js
export const ollama = {
  id: 'ollama',
  label: 'Ollama (local, desktop only)',
  fields: [
    { key: 'endpoint', label: 'Endpoint', type: 'text', default: 'http://localhost:11434' },
    { key: 'model', label: 'Model', type: 'text', default: 'llama3.1:8b' },
  ],
  call: async ({ system, prompt, maxTokens, endpoint, model }) => {
    const res = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        format: 'json',
        stream: false,
        options: { num_predict: maxTokens },
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data?.message?.content || '';
  },
};
```

**JSON output discipline.** Anthropic adheres to "ONLY valid JSON" reliably. Ollama with `format: 'json'` constrains syntactic validity but not schema. The existing lenient parser (`cleaned.match(/\{[\s\S]*\}/)` + try/catch) handles both. The game's existing deterministic fallbacks render in-tone prose when parsing fails — that's the experiment's natural escape hatch.

**Adding providers later** (OpenRouter, Groq, Gemini Flash, Together): one new file in `src/llm/` and one entry in the `PROVIDERS` registry. No other code changes.

## Settings UI

A `SettingsPanel` component reachable from two places:

- A "⚙ Settings" button on the title-screen footer
- An entry in the in-game `☰ Menu`

Same component both places. On first launch with no provider configured, the title screen surfaces a banner: "Set up an AI provider to begin," opening Settings directly.

The panel is a parchment-style card matching the existing aesthetic. Layout:

- **Active provider** — radio list of registered providers. Picking one reveals its `fields` below.
- **Provider fields** — rendered from the provider's `fields` array. Password-type fields use `<input type="password">` with a "show" toggle.
- **Test connection** button — fires a tiny prompt (`Reply with the JSON {"ok": true}`) and shows ✓ or the error inline.
- **Save** button — persists config and returns to wherever Settings was opened from.

Storage:

```js
// src/settings/store.js
const KEY = 'factor_charter_llm_config_v1';

export function readConfig() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export function writeConfig(cfg) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}
export function clearConfig() {
  localStorage.removeItem(KEY);
}
```

Namespaced separately from `safeStorage` save slots — completely independent. The API key sits in `localStorage` of the user's own browser, never transmitted anywhere except Anthropic's API. A one-line warning under the field reads: *"Stored locally on this device only."*

## PWA build & deploy

**Vite config** uses `vite-plugin-pwa` (Workbox-backed):

```js
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: "The Factor's Charter",
        short_name: 'Charter',
        description: 'A 1720s mercantile RPG.',
        theme_color: '#5c1a08',
        background_color: '#f0e3c4',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        runtimeCaching: [{
          urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
          handler: 'CacheFirst',
          options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
        }],
      },
    }),
  ],
});
```

**`index.html`** at repo root links `src/main.jsx`:

```jsx
// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import FactorsCharter from '../factors_charter.jsx';
ReactDOM.createRoot(document.getElementById('root')).render(<FactorsCharter />);
```

**Caching strategy.** Static assets (HTML, JS, CSS, fonts, icons) are precached for offline launch. API calls (Anthropic, Ollama) bypass the SW entirely. Google Fonts CSS + woff2 cached aggressively.

**Icons.** Three required: 192×192, 512×512, 512×512 maskable. A wax-seal "⁂" or "❦" on parchment cream fits the aesthetic. Placeholders are acceptable for first deploy.

**Deploy: Cloudflare Pages.**

1. Push to `main`.
2. Cloudflare Pages → Connect to GitHub → `wcfcarolina13/factors-charter`. Build command `npm run build`, output `dist/`.
3. First deploy assigns `factors-charter.pages.dev`. Custom domain optional.
4. Every push to `main` rebuilds. PR previews automatic.

Free tier covers this comfortably.

**Install flow.** iOS Safari → share → "Add to Home Screen" → launches fullscreen with parchment splash. Android Chrome shows install prompt once SW + manifest are detected.

## Compatibility & migration

- **Existing artifact path:** unchanged. `factors_charter.jsx` continues to run inside Claude artifacts. See the Open Question below for how the AI call resolves in artifact mode.
- **Existing saves:** `safeStorage` keys (`factor_save_*`, `factor_saves_index`, etc.) are untouched. New LLM config uses a distinct namespaced key (`factor_charter_llm_config_v1`).
- **Sibling docs** (`CLAUDE.md`, `WORLD_NOTES.md`, `DESIGN_NOTES.md`, `CHANGELOG.md`, `HANDOFF.md`): unchanged.

## Open question

**Artifact-mode behaviour.** The current `callClaude` makes an unauthenticated request and relies on the artifact host to inject credentials. After the rewire, if the artifact-mode user has not configured a provider (because they don't need to inside Claude), `callLLM` returns the "no provider configured" error and the game falls back to deterministic prose throughout. Two ways to handle:

1. **Detect artifact mode** (presence of `window.storage`) and use the legacy unauthenticated direct-fetch path automatically — no settings needed inside the artifact.
2. **Require Settings configuration** even in the artifact, with the user pasting their key once.

Option 1 preserves the current artifact UX exactly; option 2 unifies the code path. Recommend (1) for the implementation plan unless we have reason to prefer the unified path.

## Test plan

- `npm run dev` → game loads in localhost browser
- Settings → Anthropic with valid key → Test connection succeeds
- Play a turn that triggers `callLLM` → AI prose renders
- Settings → Ollama (with local Ollama running, e.g. `llama3.1:8b`) → Test succeeds
- Same turn with Ollama active → prose renders (or falls back gracefully)
- `npm run build` → `dist/` produced, no errors
- `npx vite preview` → game runs from production build
- Lighthouse PWA audit → installable
- iPhone Safari → Add to Home Screen → launches fullscreen
- Android Chrome → install prompt → launches standalone
- Cloudflare Pages deploy from `main` → public URL works
- Artifact path: open the JSX inside a fresh Claude artifact → game plays as before
- Existing save (manuscript JSON from prior session) → restore works in PWA build
