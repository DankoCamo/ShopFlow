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
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
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
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        status: resp.ok ? 200 : 500
      });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        status: 500
      });
    }
  }
};
