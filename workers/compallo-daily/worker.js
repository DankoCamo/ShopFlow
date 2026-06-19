const COUNTRY_CONFIG = {
  at: { hl: 'de', flag: '🇦🇹', label: 'AUSTRIJA', lang: 'German' },
  de: { hl: 'de', flag: '🇩🇪', label: 'NJEMAČKA', lang: 'German' },
  ch: { hl: 'de', flag: '🇨🇭', label: 'ŠVICARSKA', lang: 'German' },
  hr: { hl: 'hr', flag: '🇭🇷', label: 'HRVATSKA', lang: 'Croatian' },
  ba: { hl: 'hr', flag: '🇧🇦', label: 'BIH', lang: 'Croatian' },
};

// Top job portals per country — kept short to stay within Cloudflare's 50 subrequest limit
const PORTAL_SEARCH_SITES = {
  at: ['karriere.at', 'jobs.at', 'stepstone.at'],
  de: ['stepstone.de', 'stellenanzeigen.de', 'ingenieur.de', 'yourfirm.de'],
  ch: ['jobs.ch', 'jobscout24.ch', 'topjobs.ch'],
  hr: ['moj-posao.net', 'njuskalo.hr', 'index.hr'],
  ba: ['posao.ba'],
};

const MAX_LEADS_PER_COUNTRY = 4;

// Search keywords per language
const PORTAL_KEYWORDS = {
  German: '"CAM Programmierer" OR "CNC Programmierer" OR "CAM-Programmierer"',
  Croatian: '"CNC programer" OR "CAM programer" OR "CNC operater" OR "programer obradnih centara"',
};

const BLOCKED_DOMAINS = [
  // Job portals
  'karriere.at','stepstone.at','stepstone.de','jobs.at','jooble.org','jooble.com',
  'metajob.at','willhaben.at','hokify.at','indeed.com','indeed.at','indeed.de',
  'linkedin.com','xing.com','monster.at','monster.de','jobboerse.arbeitsagentur.de',
  'jobrapido.com','kimeta.de','yourfirm.de','jobanzeiger.de','stellenanzeigen.de',
  'jobboerse.de','jobware.de','jobs.de','stellenonline.de','jobscout24.at',
  'jobrobot.de','jobs.ch','jobscout24.ch','jobup.ch','jobagent.ch',
  'glassdoor.at','glassdoor.de','glassdoor.com','kununu.com',
  'experteer.de','experteer.at','absolventa.de','azubiyo.de',
  'rzjob.ch','jobwinner.ch','jobillico.com','jobteaser.com',
  // Video / content — never companies
  'youtube.com','youtu.be','vimeo.com','dailymotion.com',
  // B2B directories — not real companies
  'wlw.at','wlw.de','europages.com','europages.at','europages.de',
  'kompass.com','herold.at','gelbeseiten.de','firmenabc.at','firmen.at',
  'industrystock.de','eceurope.com','b2b.de','yellowpages.com',
  'yelp.at','yelp.de','yelp.com','trustpilot.com','foursquare.com',
  // Error tracking / system emails
  'sentry.io','ingest.sentry.io','bugsnag.com','rollbar.com',
];

// Platform/CMS domains whose emails should never be used as company contacts
const PLATFORM_EMAIL_DOMAINS = [
  'wordpress.org','wordpress.com','automattic.com',
  'wix.com','squarespace.com','webflow.io','jimdo.com','weebly.com',
  'shopify.com','godaddy.com','strikingly.com',
];

// Keep old name as alias used in isJobPortal/isPortalEmail
const JOB_PORTALS = BLOCKED_DOMAINS;

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

function isPortalName(name) {
  const n = (name || '').toLowerCase().replace(/\s+/g, '');
  return BLOCKED_DOMAINS.some(p => {
    const pn = p.split('.')[0];
    return n === pn || n === p.replace('.', '');
  });
}

function isValidContactEmail(email) {
  if (!email) return false;
  if (isPortalEmail(email)) return false;
  const domain = (email.split('@')[1] || '').toLowerCase();
  if (PLATFORM_EMAIL_DOMAINS.some(p => domain === p || domain.endsWith('.' + p))) return false;
  const local = email.split('@')[0];
  // Reject hash-like local parts (Sentry, error tracking, etc.)
  if (local.length > 20 && /^[a-f0-9]+$/.test(local)) return false;
  return true;
}

function extractBestEmail(text, siteDomain) {
  const m = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g);
  if (!m) return null;
  const valid = m.filter(e => isValidContactEmail(e));
  if (!valid.length) return null;
  // Prefer email whose domain matches the company site
  const siteRoot = (siteDomain || '').replace(/^www\./, '');
  if (siteRoot) {
    const onDomain = valid.find(e => {
      const d = (e.split('@')[1] || '').toLowerCase().replace(/^www\./, '');
      return d === siteRoot || d.endsWith('.' + siteRoot);
    });
    if (onDomain) return onDomain;
  }
  return valid[0];
}

async function fetchPageEmail(url, siteDomain) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CAMOutputBot/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return extractBestEmail(text, siteDomain);
  } catch {
    return null;
  }
}

async function findEmail(baseUrl) {
  const base = baseUrl.replace(/^(https?:\/\/[^/]+).*/, '$1');
  const siteDomain = base.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  return await fetchPageEmail(base, siteDomain);
}

async function searchPortalListings(country, env) {
  const portals = PORTAL_SEARCH_SITES[country] || [];
  const cfg = COUNTRY_CONFIG[country] || { hl: 'de', lang: 'German' };
  const keyword = PORTAL_KEYWORDS[cfg.lang] || PORTAL_KEYWORDS['German'];
  const seenUrls = new Set();
  const all = [];

  for (const portal of portals) {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': env.SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `site:${portal} ${keyword}`, gl: country, hl: cfg.hl, num: 2 }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      if (!r.link || seenUrls.has(r.link)) continue;
      seenUrls.add(r.link);
      all.push(r);
    }
  }
  return all;
}

async function findCompanyWebsite(companyName, country, env) {
  if (!companyName || companyName === 'Unbekannt') return null;
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': env.SERPER_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: `"${companyName}" Impressum Kontakt`, gl: country, num: 3 }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const result = (data.organic || []).find(r => r.link && !isJobPortal(r.link));
  return result ? result.link : null;
}

async function searchCountry(queries, country, env) {
  const cfg = COUNTRY_CONFIG[country] || { hl: 'de' };
  const loc = env.SEARCH_LOCATION ? ` ${env.SEARCH_LOCATION}` : '';
  const seenDomains = new Set();
  const all = [];

  for (const query of queries) {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': env.SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query + loc, gl: country, hl: cfg.hl, num: 3 }),
    });
    if (!res.ok) continue;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      if (!r.link || isJobPortal(r.link)) continue;
      const domain = r.link.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
      if (seenDomains.has(domain)) continue;
      seenDomains.add(domain);
      all.push(r);
    }
  }
  return all;
}

function fallbackBody(companyName) {
  return `Hallo ${companyName}-Team,\n\nich bin Danko von CAMOutput aus Graz und bringe über 10 Jahre Erfahrung mit SolidCAM, SolidWorks, Mastercam und Fusion 360 mit. Ich unterstütze CNC-Betriebe bei der CAM-Programmierung und Optimierung der Fertigungsprozesse. Schaut gerne auf www.camoutput.com vorbei.\n\nBeste Grüße,\nDanko\nCAMOutput | info@camoutput.com`;
}

async function generateEmail(rawTitle, snippet, lang, claudeKey) {
  const langName = lang || 'German';
  const prompt = 'You are writing a short outreach email for Danko from CAMOutput (Graz, Austria) — CAM programmer.\n\n'
    + 'Page title (may be a full page/job title, NOT necessarily the company name): ' + rawTitle + '\n'
    + 'Context/snippet: ' + snippet + '\n\n'
    + 'TASK: First extract the SHORT company name (the employer/business), then write a cold email in ' + langName + '.\n\n'
    + 'CRITICAL — company name extraction:\n'
    + '- "CNC-Programmierer Job | Baier GmbH Bruck an der Mur" → company is "Baier GmbH"\n'
    + '- "Lohnfertigung Mustermann GmbH - Wien" → company is "Mustermann GmbH"\n'
    + '- If the title is a job position (contains Programmierer, Engineer, Manager, etc.) look after "|" or "-" for the real company name\n'
    + '- NEVER use job title words (Programmierer, Engineer, Techniker, Manager, Job, Stelle) as the company name\n'
    + '- If company name truly unknown: use "Unbekannt"\n\n'
    + 'Rules:\n'
    + '1. Subject: "CAM-Unterstützung für [ShortCompanyName]" (German) or "CAM Support for [ShortCompanyName]" (English) — short name only, NEVER full page title\n'
    + '2. Greeting: "Hallo [ShortCompanyName]-Team," — if unknown: "Hallo,"\n'
    + '3. First sentence: about the company — what they do or their industry. NOT about yourself\n'
    + '4. Introduce Danko: name, 10+ Jahre Erfahrung mit SolidCAM/SolidWorks, Mastercam und Fusion 360 — DO NOT mention HyperMill\n'
    + '5. One sentence what you offer — colleague tone. FORBIDDEN: Remote, Freelance, flexibel, schneller, günstiger, Angebot, Lösung\n'
    + '6. CTA: www.camoutput.com — NO phone calls\n'
    + '7. Sign: CAMOutput | info@camoutput.com\n'
    + '8. Max 4-5 sentences total\n'
    + '9. First person singular ONLY (ich), NEVER wir\n\n'
    + 'Format EXACTLY:\nCOMPANY:[short company name]\nSUBJECT:[subject line]\n[email body only]';

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
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text = (data.content && data.content[0] ? data.content[0].text : '').trim();
    const lines = text.split('\n');
    const companyLine = lines.find(l => l.startsWith('COMPANY:'));
    const extractedCompany = companyLine ? companyLine.replace('COMPANY:', '').trim() : '';
    const subjectLine = lines.find(l => l.startsWith('SUBJECT:'));
    const subject = subjectLine ? subjectLine.replace('SUBJECT:', '').trim() : 'CAM-Unterstützung für ' + (extractedCompany || rawTitle);
    const headerPrefixes = ['COMPANY:', 'SUBJECT:'];
    const bodyLines = lines.filter(l => !headerPrefixes.some(p => l.startsWith(p)));
    const body = bodyLines.join('\n').trim() || fallbackBody(extractedCompany || rawTitle);
    return { subject, body, company: extractedCompany };
  } catch {
    return {
      subject: 'CAM-Unterstützung für ' + rawTitle,
      body: fallbackBody(rawTitle),
      company: '',
    };
  }
}

function buildAddToCompalloLink(lead, shopflowUrl) {
  if (!shopflowUrl) return null;
  const params = new URLSearchParams({
    addLead: '1',
    name: lead.name,
    url: lead.url,
    email: lead.email || '',
    desc: lead.desc || '',
    subject: lead.subject || '',
    body: lead.body || '',
  });
  return shopflowUrl.replace(/\/$/, '') + '?' + params.toString();
}

async function getSentCompanies(kv) {
  const raw = await kv.get('sent_companies');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function saveSentCompanies(kv, sent) {
  await kv.put('sent_companies', JSON.stringify(sent));
}

async function getSearchSettings(kv) {
  const raw = await kv.get('search_settings');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function saveSearchSettings(kv, settings) {
  await kv.put('search_settings', JSON.stringify(settings));
}

function isRecentlySent(sent, normName, days = 30) {
  const entry = sent[normName];
  if (!entry) return false;
  return Date.now() - entry < days * 24 * 60 * 60 * 1000;
}

function buildHtmlEmail(byCountry, total, date, env) {
  const sections = Object.entries(byCountry).map(([country, leads]) => {
    const cfg = COUNTRY_CONFIG[country] || { flag: '🌍', label: country.toUpperCase() };
    const shopflowUrl = (env && env.SHOPFLOW_URL) || null;
    const rows = leads.map(l => {
      const compalloLink = buildAddToCompalloLink(l, shopflowUrl);
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
                  ${compalloLink
                    ? `<a href="${compalloLink}" style="background:#1a6fff;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold">Pregledaj i pošalji →</a>`
                    : `<span style="color:#999;font-size:12px">Postavi SHOPFLOW_URL</span>`
                  }
                </td>
              </tr>
            </table>
            ${l.email
              ? `<div style="font-size:12px;color:#555;margin:4px 0 8px">📧 <a href="mailto:${l.email}" style="color:#1a6fff">${l.email}</a></div>`
              : `<div style="font-size:12px;color:#f90;margin:4px 0 8px">⚠ Email nije pronađen — unesi ručno u "To" polje</div>`
            }
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

async function run(env, force = false) {
  const missing = [];
  if (!env.SERPER_KEY) missing.push('SERPER_KEY');
  if (!env.BREVO_KEY) missing.push('BREVO_KEY');
  if (!env.CLAUDE_KEY) missing.push('CLAUDE_KEY');
  if (!env.NOTIFY_EMAIL) missing.push('NOTIFY_EMAIL');
  if (!env.SENT_COMPANIES) missing.push('SENT_COMPANIES (KV binding)');
  if (missing.length) throw new Error('Missing env/bindings: ' + missing.join(', '));

  const settings = await getSearchSettings(env.SENT_COMPANIES);

  // Schedule check — skip if not the right day/hour (bypass with force=true)
  if (!force && settings.scheduleDays && settings.scheduleDays.length > 0) {
    const now = new Date();
    const todayDay = now.getUTCDay();
    const todayHour = now.getUTCHours();
    const targetHourCET = parseInt(settings.scheduleHour ?? '8');
    const targetHourUTC = (targetHourCET - 1 + 24) % 24; // CET = UTC+1
    if (!settings.scheduleDays.includes(todayDay) || todayHour !== targetHourUTC) {
      return { sent: false, total: 0, skipped: 'not scheduled now' };
    }
  }

  const countries = (settings.countries || env.SEARCH_COUNTRIES || '').split(',').map(c => c.trim()).filter(Boolean);
  if (!countries.length) return { sent: false, total: 0, skipped: 'no countries selected — search paused' };

  const sent = await getSentCompanies(env.SENT_COMPANIES);
  const byCountry = {};
  let total = 0;

  for (const country of countries) {
    const cfg = COUNTRY_CONFIG[country] || { lang: 'German' };
    const portalResults = await searchPortalListings(country, env);
    const leads = [];

    for (const r of portalResults) {
      if (leads.length >= MAX_LEADS_PER_COUNTRY) break;
      // Extract company name + generate email via Claude
      const { subject, body, company } = await generateEmail(r.title, r.snippet || '', cfg.lang, env.CLAUDE_KEY);

      // Skip if company name could not be extracted or is a portal name
      if (!company || company === 'Unbekannt' || isPortalName(company)) continue;

      const normName = normalizeCompany(company);
      if (!normName || isRecentlySent(sent, normName)) continue;

      // Find real company website — skip if not found or resolves to a portal
      const companyUrl = await findCompanyWebsite(company, country, env);
      if (!companyUrl || isJobPortal(companyUrl)) continue;

      const email = await findEmail(companyUrl);

      leads.push({
        name: company,
        url: companyUrl,
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
  const html = buildHtmlEmail(byCountry, total, date, env);

  const ok = await sendEmail(html, subject, env);
  if (ok) await saveSentCompanies(env.SENT_COMPANIES, sent);

  return { sent: ok, total };
}

function isAuthorized(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env));
  },

  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (pathname === '/run' || pathname === '/settings') {
      if (!isAuthorized(request, env)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
    }

    if (pathname === '/settings') {
      if (request.method === 'GET') {
        const s = await getSearchSettings(env.SENT_COMPANIES);
        return new Response(JSON.stringify(s), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      if (request.method === 'POST') {
        const s = await request.json();
        await saveSearchSettings(env.SENT_COMPANIES, s);
        return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      }
    }

    if (pathname !== '/run') {
      return new Response('CAMOutput Daily Prospecting Worker\nGET /run — pokreni\nGET /run?force=1 — pokreni bez provjere rasporeda\nGET /settings — dohvati postavke\nPOST /settings — spremi postavke', { status: 200 });
    }
    const force = new URL(request.url).searchParams.get('force') === '1';
    try {
      const result = await run(env, force);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { ...cors, 'Content-Type': 'application/json' },
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
          SHOPFLOW_URL: env.SHOPFLOW_URL || null,
          SENT_COMPANIES_bound: !!env.SENT_COMPANIES,
        }
      }, null, 2), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
};
