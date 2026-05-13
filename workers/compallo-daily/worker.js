const COUNTRY_CONFIG = {
  at: { hl: 'de', flag: '🇦🇹', label: 'AUSTRIJA', lang: 'German' },
  de: { hl: 'de', flag: '🇩🇪', label: 'NJEMAČKA', lang: 'German' },
  ch: { hl: 'de', flag: '🇨🇭', label: 'ŠVICARSKA', lang: 'German' },
  hr: { hl: 'hr', flag: '🇭🇷', label: 'HRVATSKA', lang: 'Croatian' },
  ba: { hl: 'hr', flag: '🇧🇦', label: 'BIH', lang: 'Croatian' },
};

const JOB_PORTALS = [
  'karriere.at','stepstone.at','stepstone.de','jobs.at','jooble.org','jooble.com',
  'metajob.at','willhaben.at','hokify.at','indeed.com','indeed.at','indeed.de',
  'linkedin.com','xing.com','monster.at','monster.de','jobboerse.arbeitsagentur.de',
  'jobrapido.com','kimeta.de','yourfirm.de','jobanzeiger.de','stellenanzeigen.de',
  'jobboerse.de','jobware.de','jobs.de','stellenonline.de','jobscout24.at',
  'jobrobot.de','jobs.ch','jobscout24.ch','jobup.ch','jobagent.ch',
];

function isJobPortal(url) {
  if (!url) return false;
  const domain = url.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  return JOB_PORTALS.some(p => domain === p || domain.endsWith('.' + p));
}

function isPortalEmail(email) {
  if (!email) return false;
  const domain = (email.split('@')[1] || '').toLowerCase();
  return JOB_PORTALS.some(p => domain === p || domain.endsWith('.' + p));
}

function normalizeCompany(name) {
  return (name || '').toLowerCase()
    .replace(/\b(firma|gmbh\s*&\s*co\.?\s*kg|gmbh|ag|og|kg|e\.u\.|ug|ohg|gbr|gesmbh|s\.r\.o\.|ltd|inc|llc|plc|bv|nv)\b\.?/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function extractEmailFromText(text) {
  const m = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
  if (!m) return null;
  return m.find(e => !isPortalEmail(e)) || null;
}

async function fetchPageEmail(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CAMOutputBot/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return extractEmailFromText(text);
  } catch {
    return null;
  }
}

async function findEmail(baseUrl) {
  const base = baseUrl.replace(/^(https?:\/\/[^/]+).*/, '$1');
  // Homepage only — saves subrequests for Claude API calls
  return await fetchPageEmail(base);
}

async function searchCountry(query, country, env) {
  const cfg = COUNTRY_CONFIG[country] || { hl: 'de' };
  const loc = env.SEARCH_LOCATION ? ` ${env.SEARCH_LOCATION}` : '';
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': env.SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query + loc, gl: country, hl: cfg.hl, num: 3 }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.organic || []).filter(r => r.link && !isJobPortal(r.link));
}

async function generateEmail(companyName, snippet, lang, claudeKey) {
  const langName = lang || 'German';
  const prompt = 'You are writing a short outreach email for Danko from CAMOutput (Graz, Austria) — CAM programmer.\n\n'
    + 'Company: ' + companyName + '\n'
    + 'Context: ' + snippet + '\n\n'
    + 'Write a short cold email in ' + langName + '.\n\n'
    + 'Rules:\n'
    + '1. Subject: ALWAYS "CAM-Unterstützung für ' + companyName + '" (German) or "CAM Support for ' + companyName + '" (English) — NEVER "Kurze Frage"\n'
    + '2. Greeting: "Hallo ' + companyName + '-Team,"\n'
    + '3. First sentence: about the company — what they do or their industry\n'
    + '4. Introduce Danko: name, 10+ Jahre Erfahrung mit SolidCAM/SolidWorks, Mastercam und Fusion 360\n'
    + '5. One sentence what you offer — colleague tone. NO words: Remote, Freelance, flexibel, schneller, Angebot\n'
    + '6. CTA: www.camoutput.com — NO phone calls\n'
    + '7. Sign: CAMOutput | info@camoutput.com\n'
    + '8. Max 4-5 sentences total\n'
    + '9. First person singular ONLY (ich)\n\n'
    + 'Format EXACTLY:\nSUBJECT:[subject line]\n[email body only]';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text = (data.content && data.content[0] ? data.content[0].text : '').trim();
    const lines = text.split('\n');
    const subjectLine = lines.find(l => l.startsWith('SUBJECT:'));
    const subject = subjectLine ? subjectLine.replace('SUBJECT:', '').trim() : 'CAM-Unterstützung für ' + companyName;
    const body = lines.filter((_, i) => i > lines.indexOf(subjectLine)).join('\n').trim();
    return { subject, body };
  } catch {
    return {
      subject: 'CAM-Unterstützung für ' + companyName,
      body: '',
    };
  }
}

function buildMailtoLink(email, subject, body) {
  if (!email) return null;
  return 'mailto:' + email
    + '?subject=' + encodeURIComponent(subject)
    + '&body=' + encodeURIComponent(body);
}

async function getSentCompanies(kv) {
  const raw = await kv.get('sent_companies');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function saveSentCompanies(kv, sent) {
  await kv.put('sent_companies', JSON.stringify(sent));
}

function isRecentlySent(sent, normName, days = 30) {
  const entry = sent[normName];
  if (!entry) return false;
  return Date.now() - entry < days * 24 * 60 * 60 * 1000;
}

function buildHtmlEmail(byCountry, total, date) {
  const sections = Object.entries(byCountry).map(([country, leads]) => {
    const cfg = COUNTRY_CONFIG[country] || { flag: '🌍', label: country.toUpperCase() };
    const rows = leads.map(l => {
      const mailto = buildMailtoLink(l.email, l.subject, l.body);
      const bodyPreview = (l.body || '').replace(/\n/g, '<br>');
      return `
        <tr>
          <td style="padding:16px 0;border-bottom:2px solid #ddd;vertical-align:top">
            <table style="width:100%">
              <tr>
                <td>
                  <strong style="font-size:15px;color:#111">${l.name}</strong>
                  &nbsp;
                  <a href="${l.url}" style="font-size:11px;color:#888">${l.url.replace(/^https?:\/\//, '').split('/')[0]}</a>
                </td>
                <td style="text-align:right;white-space:nowrap">
                  ${l.email
                    ? `<a href="${mailto}" style="background:#1a6fff;color:#fff;padding:6px 14px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold">✉ Pošalji</a>`
                    : `<span style="color:#999;font-size:12px">Email nije pronađen</span>`
                  }
                </td>
              </tr>
            </table>
            ${l.email ? `<div style="font-size:12px;color:#555;margin:4px 0 8px">
              📧 <a href="mailto:${l.email}" style="color:#1a6fff">${l.email}</a>
            </div>` : ''}
            <div style="background:#f5f7fa;border-left:3px solid #1a6fff;padding:10px 14px;margin-top:8px;border-radius:0 4px 4px 0">
              <div style="font-size:12px;color:#666;margin-bottom:4px">
                <strong>Subject:</strong> ${l.subject}
              </div>
              <div style="font-size:12px;color:#333;line-height:1.6">${bodyPreview}</div>
            </div>
          </td>
        </tr>`;
    }).join('');

    return `
      <tr><td style="padding:20px 0 8px">
        <span style="font-size:17px;font-weight:bold">${cfg.flag} ${cfg.label}</span>
        <span style="font-size:13px;color:#888;margin-left:8px">${leads.length} novih leadova</span>
      </td></tr>
      ${rows}`;
  }).join('');

  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:660px;margin:0 auto;padding:0 12px">
      <h2 style="color:#1a6fff;margin-bottom:4px">🔍 ${total} novih leadova • ${date}</h2>
      <p style="color:#777;margin-top:0;font-size:13px">
        Automatska dnevna pretraga — CAMOutput Prospecting<br>
        <em>Klikni "Pošalji" da otvoriš email klijent s već sastavljenom porukom.</em>
      </p>
      <table style="width:100%;border-collapse:collapse">${sections}</table>
      <p style="color:#aaa;font-size:11px;margin-top:24px">
        Generirano automatski •
        <a href="mailto:info@camoutput.com" style="color:#aaa">info@camoutput.com</a>
      </p>
    </div>`;
}

async function sendEmail(htmlContent, subject, env) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_KEY },
    body: JSON.stringify({
      sender: { name: 'CAMOutput Prospecting', email: 'info@camoutput.com' },
      to: [{ email: env.NOTIFY_EMAIL }],
      subject,
      htmlContent,
    }),
  });
  return res.ok;
}

async function run(env) {
  const missing = [];
  if (!env.SERPER_KEY) missing.push('SERPER_KEY');
  if (!env.BREVO_KEY) missing.push('BREVO_KEY');
  if (!env.CLAUDE_KEY) missing.push('CLAUDE_KEY');
  if (!env.NOTIFY_EMAIL) missing.push('NOTIFY_EMAIL');
  if (!env.SENT_COMPANIES) missing.push('SENT_COMPANIES (KV binding)');
  if (missing.length) throw new Error('Missing env/bindings: ' + missing.join(', '));

  const countries = (env.SEARCH_COUNTRIES || 'at').split(',').map(c => c.trim()).filter(Boolean);
  const query = env.SEARCH_QUERY || 'CAM Programmierer Stellenangebote';

  const sent = await getSentCompanies(env.SENT_COMPANIES);
  const byCountry = {};
  let total = 0;

  for (const country of countries) {
    const cfg = COUNTRY_CONFIG[country] || { lang: 'German' };
    const results = await searchCountry(query, country, env);
    const leads = [];

    for (const r of results) {
      const normName = normalizeCompany(r.title || '');
      if (!normName || isRecentlySent(sent, normName)) continue;

      const email = await findEmail(r.link);
      const { subject, body } = await generateEmail(r.title, r.snippet || '', cfg.lang, env.CLAUDE_KEY);

      leads.push({
        name: r.title || r.link,
        url: r.link,
        email,
        subject,
        body,
        desc: (r.snippet || '').slice(0, 120),
      });
      sent[normName] = Date.now();
      total++;
    }

    if (leads.length) byCountry[country] = leads;
  }

  if (total === 0) return { sent: false, total: 0 };

  const date = new Date().toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const subject = `🔍 ${total} novih leadova danas - ${date}`;
  const html = buildHtmlEmail(byCountry, total, date);

  const ok = await sendEmail(html, subject, env);
  if (ok) await saveSentCompanies(env.SENT_COMPANIES, sent);

  return { sent: ok, total };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },

  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/run') {
      return new Response('CAMOutput Daily Prospecting Worker\nGET /run to trigger manually', { status: 200 });
    }
    try {
      const result = await run(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({
        error: e.message,
        stack: e.stack || null,
        env_check: {
          SERPER_KEY: !!env.SERPER_KEY,
          BREVO_KEY: !!env.BREVO_KEY,
          CLAUDE_KEY: !!env.CLAUDE_KEY,
          NOTIFY_EMAIL: env.NOTIFY_EMAIL || null,
          SEARCH_COUNTRIES: env.SEARCH_COUNTRIES || null,
          SEARCH_QUERY: env.SEARCH_QUERY || null,
          SENT_COMPANIES_bound: !!env.SENT_COMPANIES,
        }
      }, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
