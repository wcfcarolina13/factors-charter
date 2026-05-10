// Cloudflare Pages Function for cross-device save sync.
//
// GET  /api/save?key=<factor-key>&id=<playthrough-id>  → 200 { body, version, savedAt } | 404 | 400 | 429
// PUT  /api/save?key=<factor-key>&id=<playthrough-id>  body: <save-json>
//                                                       → 200 { version, savedAt } | 4xx
//
// Storage:
//   save:<factorKey>:<id>  → { body, version, savedAt }   (TTL 365 days, renews per PUT)
//   rate:<ip>              → counter                       (TTL 60 seconds)
//
//   Per-record KV metadata: { day, factorName, savedAt, version, charterClosed? }
//   Carried by KV.list({ prefix: "save:<factorKey>:" }) so the factor-saves
//   endpoint can enumerate a player's charters without N body fetches.
//
// Auth: the (factorKey, playthroughId) pair is the secret. No accounts.
//   - The factor key namespaces a player's charters across devices.
//   - The playthrough ID names a specific charter under that key.
//   - Anyone with both can read or write that charter.
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

function isValidThemedId(id) {
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

// Construct the canonical KV record key from a (factorKey, playthroughId) pair.
function recordKey(factorKey, id) {
  return `save:${factorKey}:${id}`;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const factorKey = url.searchParams.get('key');
  const id = url.searchParams.get('id');
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';

  if (!isValidThemedId(factorKey)) {
    return jsonResponse({ error: 'invalid factor key' }, 400);
  }
  if (!isValidThemedId(id)) {
    return jsonResponse({ error: 'invalid playthrough id' }, 400);
  }

  if (!(await checkRateLimit(env, ip))) {
    return jsonResponse({ error: 'rate limit exceeded' }, 429);
  }

  const kvKey = recordKey(factorKey, id);

  if (request.method === 'GET') {
    const raw = await env.SAVES_KV.get(kvKey);
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
    const existingRaw = await env.SAVES_KV.get(kvKey);
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

    // Sidecar metadata for fast listing via KV.list. Caps stringy fields so
    // metadata stays well under Cloudflare's 1024-byte limit per entry.
    const factorName = typeof body?.player?.name === 'string' ? body.player.name.slice(0, 80) : '';
    const metadata = {
      day: typeof body?.day === 'number' ? body.day : 0,
      daysRemaining: typeof body?.daysRemaining === 'number' ? body.daysRemaining : 0,
      location: typeof body?.location === 'string' ? body.location.slice(0, 60) : '',
      factorName,
      savedAt: record.savedAt,
      version: record.version,
      charterClosed: body?.charterClosed
        ? {
            outcome: typeof body.charterClosed.outcome === 'string' ? body.charterClosed.outcome.slice(0, 40) : '',
            destiny: typeof body.charterClosed.destiny === 'string' ? body.charterClosed.destiny.slice(0, 40) : '',
            day: typeof body.charterClosed.day === 'number' ? body.charterClosed.day : 0,
          }
        : null,
    };

    await env.SAVES_KV.put(kvKey, JSON.stringify(record), {
      expirationTtl: SAVE_TTL_SECONDS,
      metadata,
    });

    return jsonResponse({ version: record.version, savedAt: record.savedAt }, 200);
  }

  return jsonResponse({ error: 'method not allowed' }, 405);
}
