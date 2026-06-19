// shopflow-ai — proxies Claude calls for the ShopFlow app.
// Holds the real Anthropic key server-side (env.CLAUDE_KEY, set via `wrangler secret put`).
// Browser never sees it: callers must send a valid Supabase session token instead.

const ALLOWED_ORIGINS = [
  'https://shop-flow-black.vercel.app',
];

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS_CAP = 800;
const DEFAULT_DAILY_LIMIT = 500;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

async function getUserId(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user.id : null;
  } catch {
    return null;
  }
}

async function checkAndBumpRateLimit(env, userId) {
  if (!env.AI_RATE_LIMIT) return true; // KV not bound — fail open rather than break the feature
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${userId}:${day}`;
  const current = parseInt((await env.AI_RATE_LIMIT.get(key)) || '0', 10);
  const limit = parseInt(env.DAILY_LIMIT || String(DEFAULT_DAILY_LIMIT), 10);
  if (current >= limit) return false;
  await env.AI_RATE_LIMIT.put(key, String(current + 1), { expirationTtl: 172800 });
  return true;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const { pathname } = new URL(request.url);
    if (pathname !== '/generate' || request.method !== 'POST') {
      return new Response('ShopFlow AI Worker\nPOST /generate (Authorization: Bearer <supabase access token>)', {
        status: 404,
        headers: cors,
      });
    }

    try {
      const userId = await getUserId(request, env);
      if (!userId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      const allowed = await checkAndBumpRateLimit(env, userId);
      if (!allowed) {
        return new Response(JSON.stringify({ error: 'Dnevni limit AI poziva je dosegnut.' }), {
          status: 429,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      const { max_tokens, messages } = await request.json();
      if (!Array.isArray(messages) || !messages.length) {
        return new Response(JSON.stringify({ error: 'Missing messages' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      const cappedTokens = Math.min(parseInt(max_tokens, 10) || 400, MAX_TOKENS_CAP);

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.CLAUDE_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: MODEL, max_tokens: cappedTokens, messages }),
      });

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
};
