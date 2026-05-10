// Cloudflare Pages Function for cross-device charter discovery.
//
// GET /api/factor-saves?key=<factor-key>
//   → 200 { charters: [{ id, day, daysRemaining, location, factorName, savedAt, version, charterClosed? }, ...] }
//   | 400 (invalid key) | 429 (rate limit)
//
// Lists every charter saved under the given factor key. The data is read from
// KV.list metadata (populated by /api/save on each PUT) so this endpoint
// makes ONE KV operation regardless of how many charters the player has.
//
// Authoritative answer to "what charters does this player have, across all
// devices?" — the title screen on a fresh device calls this with the
// device's factor key to discover charters that exist only on the cloud.

const ID_PATTERN = /^[a-z]+-[a-z]+-[a-z]+-\d{4}$/;
const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = 60;
const MAX_PAGE = 200; // Cap returned charters per call. Realistic players have <10.

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isValidThemedId(s) {
  return typeof s === 'string' && ID_PATTERN.test(s);
}

async function checkRateLimit(env, ip) {
  if (!ip) return true;
  const key = `rate:${ip}`;
  const raw = await env.SAVES_KV.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= RATE_LIMIT_MAX) return false;
  await env.SAVES_KV.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW });
  return true;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }

  const url = new URL(request.url);
  const factorKey = url.searchParams.get('key');
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '';

  if (!isValidThemedId(factorKey)) {
    return jsonResponse({ error: 'invalid factor key' }, 400);
  }

  if (!(await checkRateLimit(env, ip))) {
    return jsonResponse({ error: 'rate limit exceeded' }, 429);
  }

  const prefix = `save:${factorKey}:`;
  const list = await env.SAVES_KV.list({ prefix, limit: MAX_PAGE });

  const charters = list.keys.map((entry) => {
    const id = entry.name.slice(prefix.length);
    const meta = entry.metadata || {};
    return {
      id,
      day: meta.day || 0,
      daysRemaining: meta.daysRemaining || 0,
      location: meta.location || '',
      factorName: meta.factorName || '',
      savedAt: meta.savedAt || null,
      version: meta.version || 0,
      charterClosed: meta.charterClosed || null,
    };
  });

  // Most-recently-saved first so the title screen shows the active charter
  // at the top of the roster.
  charters.sort((a, b) => {
    const ta = a.savedAt ? Date.parse(a.savedAt) : 0;
    const tb = b.savedAt ? Date.parse(b.savedAt) : 0;
    return tb - ta;
  });

  return jsonResponse({ charters, truncated: list.list_complete === false }, 200);
}
