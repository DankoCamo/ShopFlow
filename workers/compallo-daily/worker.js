const COUNTRY_CONFIG = {
  at: { hl: 'de', flag: '🇦🇹', label: 'AUSTRIJA' },
  de: { hl: 'de', flag: '🇩🇪', label: 'NJEMAČKA' },
  ch: { hl: 'de', flag: '🇨🇭', label: 'ŠVICARSKA' },
  hr: { hl: 'hr', flag: '🇭🇷', label: 'HRVATSKA' },
};

const JOB_PORTALS = [
  'karriere.at','stepstone.at','stepstone.de','jobs.at','jooble.org','jooble.com',
  'metajob.at','willhaben.at','hokify.at','indeed.com','indeed.at','indeed.de',
  'linkedin.com','xing.com','monster.at','monster.de','jobboerse.arbeitsagentur.de',
  'jobrapido.com','kimeta.de','yourfirm.de','jobanzeiger.de','stellenanzeigen.de',
  'jobboerse.de','jobware.de','jobs.de','stellenonline.de','jobscout24.at',
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
      signal: AbortSignal.timeout(8000),
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
  const subpages = ['', '/impressum', '/kontakt', '/contact', '/about', '/ueber-uns'];
  for (const path of subpages) {
    const email = await fetchPageEmail(base + path);
    if (email) return email;
  }
  return null;
}

async function searchCountry(query, country, env) {
  const cfg = COUNTRY_CONFIG[country] || { hl: 'de' };
  const loc = env.SEARCH_LOCATION ? ` ${env.SEARCH_LOCATION}` : '';
  const payload = {
    q: query + loc,
    gl: country,
    hl: cfg.hl,
    num: 10,
  };
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': env.SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.organic || []).filter(r => r.link && !isJobPortal(r.link));
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
    const rows = leads.map(l => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eee;vertical-align:top">
          <strong style="font-size:14px">${l.name}</strong><br>
          ${l.email ? `<a href="mailto:${l.email}" style="color:#1a6fff">${l.email}</a><br>` : '<span style="color:#999;font-size:12px">Email nije pronađen</span><br>'}
          <a href="${l.url}" style="color:#555;font-size:12px">${l.url.replace(/^https?:\/\//, '').split('/')[0]}</a><br>
          <span style="color:#777;font-size:12px">${l.desc || ''}</span>
        </td>
      </tr>`).join('');
    return `
      <tr><td style="padding:16px 0 4px">
        <strong style="font-size:16px">${cfg.flag} ${cfg.label} (${leads.length} novih)</strong>
      </td></tr>
      ${rows}`;
  }).join('');

  return `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:640px;margin:0 auto">
      <h2 style="color:#1a6fff;margin-bottom:4px">🔍 ${total} novih leadova • ${date}</h2>
      <p style="color:#777;margin-top:0">Automatska dnevna pretraga — CAMOutput Prospecting</p>
      <table style="width:100%;border-collapse:collapse">${sections}</table>
      <p style="color:#aaa;font-size:11px;margin-top:24px">
        Generirano automatski •
        <a href="mailto:info@camoutput.com" style="color:#aaa">info@camoutput.com</a>
      </p>
    </div>`;
}

async function sendEmail(htmlContent, subject, env) {
  const payload = {
    sender: { name: 'CAMOutput Prospecting', email: 'info@camoutput.com' },
    to: [{ email: env.NOTIFY_EMAIL }],
    subject,
    htmlContent,
  };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_KEY },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

async function run(env) {
  const countries = (env.SEARCH_COUNTRIES || 'at').split(',').map(c => c.trim()).filter(Boolean);
  const query = env.SEARCH_QUERY || 'CAM Programmierer Stellenangebote';

  const sent = await getSentCompanies(env.SENT_COMPANIES);
  const byCountry = {};
  let total = 0;

  for (const country of countries) {
    const results = await searchCountry(query, country, env);
    const leads = [];

    for (const r of results) {
      const normName = normalizeCompany(r.title || '');
      if (!normName || isRecentlySent(sent, normName)) continue;

      const email = await findEmail(r.link);

      leads.push({ name: r.title || r.link, url: r.link, email, desc: (r.snippet || '').slice(0, 120) });
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

  // Allow manual trigger via GET /run (for testing)
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/run') {
      return new Response('CAMOutput Daily Prospecting Worker\nGET /run to trigger manually', { status: 200 });
    }
    const result = await run(env);
    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
