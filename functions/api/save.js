// Cloudflare Pages Function for cross-device save sync.
//
// GET  /api/save?id=<playthrough-id>  → 200 { body, version, savedAt } | 404 | 400 | 429
// PUT  /api/save?id=<playthrough-id>  body: <save-json>
//                                      → 200 { version, savedAt } | 4xx
//
// Storage:
//   save:<id>   → { body, version, savedAt }   (TTL 365 days, renews per PUT)
//   rate:<ip>   → counter                       (TTL 60 seconds)
//
// Auth: the playthrough ID is the secret. No accounts.
// Rate limit: 60 req/min per IP.

const ID_PATTERN = /^[a-z]+-[a-z]+-[a-z]+-\d{4}$/;
const MAX_BODY_BYTES = 256 * 1024; // 256 KB
const SAVE_TTL_SECONDS = 60 * 60 * 24 * 365; // 365 days
const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = 60; // requests per window

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isValidId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

async function checkRateLimit(env, ip) {
  if (!ip) return true; // can't identify, allow through
  const key = `rate:${ip}`;
  const raw = await env.SAVES_KV.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= RATE_LIMIT_MAX) return false;
  await env.SAVES_KV.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW });
  return true;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';

  if (!isValidId(id)) {
    return jsonResponse({ error: 'invalid id' }, 400);
  }

  if (!(await checkRateLimit(env, ip))) {
    return jsonResponse({ error: 'rate limit exceeded' }, 429);
  }

  if (request.method === 'GET') {
    const raw = await env.SAVES_KV.get(`save:${id}`);
    if (!raw) return jsonResponse({ error: 'not found' }, 404);
    try {
      const parsed = JSON.parse(raw);
      return jsonResponse(parsed, 200);
    } catch (e) {
      return jsonResponse({ error: 'corrupt save' }, 500);
    }
  }

  if (request.method === 'PUT') {
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'body too large' }, 413);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: 'invalid json' }, 400);
    }

    // Read existing to compute next version
    const existingRaw = await env.SAVES_KV.get(`save:${id}`);
    let prevVersion = 0;
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw);
        prevVersion = existing.version || 0;
      } catch (e) { /* corrupt; start fresh */ }
    }

    const record = {
      body,
      version: prevVersion + 1,
      savedAt: new Date().toISOString(),
    };

    await env.SAVES_KV.put(`save:${id}`, JSON.stringify(record), {
      expirationTtl: SAVE_TTL_SECONDS,
    });

    return jsonResponse({ version: record.version, savedAt: record.savedAt }, 200);
  }

  return jsonResponse({ error: 'method not allowed' }, 405);
}
