// Cloudflare Pages Function for in-game illustrations.
//
// GET /api/illustrate?prompt=<urlencoded>&seed=<int>  → 200 image/png | 4xx | 5xx
//
// Calls Workers AI (`@cf/black-forest-labs/flux-1-schnell`) and streams the
// rendered image back. Same-origin, so the existing CSP `img-src 'self'`
// covers it without any pollinations.ai allowance.
//
// Caching: same prompt + seed always produces the same URL, so we set
// Cache-Control: public, max-age=31536000, immutable. Cloudflare's edge
// cache will hit on repeat requests; the client's localStorage cache
// (src/util/illustration-cache.js) still does its own LRU layer for offline
// re-renders of the same scene.
//
// Bindings required (Cloudflare Pages → Settings → Functions):
//   AI  →  Workers AI binding

const MAX_PROMPT_BYTES = 2048;
const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = 30;    // requests per window per IP

async function checkRateLimit(env, ip) {
  if (!ip || !env.SAVES_KV) return true;
  const key = `illrate:${ip}`;
  const raw = await env.SAVES_KV.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= RATE_LIMIT_MAX) return false;
  await env.SAVES_KV.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW });
  return true;
}

function errorResponse(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') {
    return errorResponse('method not allowed', 405);
  }
  if (!env.AI) {
    return errorResponse('AI binding not configured', 503);
  }

  const url = new URL(request.url);
  const prompt = url.searchParams.get('prompt') || '';
  const seedRaw = url.searchParams.get('seed') || '1';

  if (!prompt) return errorResponse('missing prompt', 400);
  if (prompt.length > MAX_PROMPT_BYTES) return errorResponse('prompt too long', 413);

  const seed = parseInt(seedRaw, 10);
  if (!Number.isFinite(seed)) return errorResponse('invalid seed', 400);

  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!(await checkRateLimit(env, ip))) {
    return errorResponse('rate limit exceeded', 429);
  }

  let aiResponse;
  try {
    aiResponse = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt,
      seed: Math.abs(seed) % 2_147_483_647,
      steps: 4,
    });
  } catch (err) {
    return errorResponse(`AI run failed: ${err.message || 'unknown'}`, 502);
  }

  // flux-1-schnell on Workers AI returns { image: '<base64-png>' }.
  if (!aiResponse || typeof aiResponse.image !== 'string') {
    return errorResponse('unexpected AI response shape', 502);
  }

  const binary = Uint8Array.from(atob(aiResponse.image), (c) => c.charCodeAt(0));

  return new Response(binary, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
