const ALLOWED_ORIGINS = [
  'https://shop-flow-black.vercel.app',
];

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

function formatEmailAsHtml(body) {
  function linkify(text) {
    return text
      .replace(/(https?:\/\/[^\s<]+|www\.[^\s<]+)/g, url => {
        const href = url.startsWith('http') ? url : 'https://' + url;
        return '<a href="' + href + '" style="color:#1a6fff">' + url + '</a>';
      })
      .replace(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g,
        '<a href="mailto:$1">$1</a>');
  }

  // Split into paragraphs by blank lines
  const blocks = body.split(/\n{2,}/);
  // Last block is the signature
  const signatureIdx = blocks.length - 1;

  const htmlBlocks = blocks.map((block, i) => {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (i === signatureIdx && blocks.length > 1) {
      // Signature: lines joined with <br>
      return '<p style="margin:16px 0 0">' + lines.map(linkify).join('<br>') + '</p>';
    }
    // Regular paragraph: each line as its own <p>
    return lines.map(l => '<p style="margin:0 0 10px">' + linkify(l) + '</p>').join('');
  });

  return '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px">'
    + htmlBlocks.join('')
    + '</div>';
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    const userId = await getUserId(request, env);
    if (!userId) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    try {
      const { to, from, fromName, subject, body } = await request.json();

      const brevoPayload = {
        sender: { name: fromName || 'Danko Camo | CAMOutput', email: from || 'info@camoutput.com' },
        to: [{ email: to }],
        bcc: [{ email: 'info@camoutput.com', name: 'Danko Camo | CAMOutput' }],
        subject: subject,
        htmlContent: formatEmailAsHtml(body)
      };

      const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': env.BREVO_API_KEY
        },
        body: JSON.stringify(brevoPayload)
      });

      const result = await resp.json();

      return new Response(JSON.stringify({ success: resp.ok, ...result }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
        status: resp.ok ? 200 : 500
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
        status: 500
      });
    }
  }
};
