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
        textContent: body
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
