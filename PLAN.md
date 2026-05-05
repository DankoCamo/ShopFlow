# Compallo — SaaS Migration Plan

## Trenutna arhitektura (analiza)

### Što postoji
- **Jedan HTML fajl** (2674 linija): CSS + HTML + vanilla JS, sve inline
- **State management**: globalni `var S = {...}` objekt u memoriji
- **Persistence**: `localStorage.setItem('shopflow_v1', JSON.stringify(S))`
- **Landing + App** u jednom fajlu, toggle via `display:none/block`
- **Cloudflare Workers** (3 komada, camodanko.workers.dev):
  - `shopflow-search` — Google/Maps pretraga firmi (SerpAPI ili sličan)
  - `shopflow-email` — slanje emailova via Brevo API
  - `shopflow-fetch` — dohvat web stranica + ekstrakcija email adresa
- **Anthropic Claude API** — direktni browser-to-API pozivi (Haiku, `anthropic-dangerous-direct-browser-access`)
- **jsPDF** — generiranje PDF računa na klijentu

### Data model (iz localStorage)
```
S = {
  projects:       [{ id, title, clientId, rate, status(0-4), note }]
  clients:        [{ id, name, contact, email, phone, addr, country, rate, uid, note }]
  timeLogs:       [{ id, projectId, note, duration(sec), date, manual }]
  expenses:       [{ id, desc, projectId, cat, amount, date, note }]
  ganttTasks:     [{ id, title, projectId, start, end, status }]
  invoiceHistory: [{ id, num, client, date, due, total, lang, currency, status, from{}, to{}, items[], note }]
  leads:          [{ id, name, url, desc, status, note, email, emails[], followup, savedAt, query }]
  emailTemplates: [{ id, name, lang, subject, body }]
  settings:       { appLang, appTheme, name, email, addr, uid, iban, bic, rate, vat,
                    currency, note, claudeKey, calUsername }
  invItems:       [{ id, desc, qty, price, vat }]   -- ephemeral, current invoice draft
  timer:          { running, start, interval }       -- ephemeral
  nextId:         number
}
```

### Ograničenja trenutnog stanja
- Svi podaci u browserovom localStorage — nema pristupa s drugog uređaja
- Bez auth — nema korisničkih računa
- Claude API key se sprema u localStorage → vidljiv svima koji otvore DevTools
- Brevo key je hardkodiran u Cloudflare Worker (ne po korisniku)
- Nema backupa osim ručnog JSON exporta
- PDF se generira samo client-side (jsPDF)

---

## Ciljna arhitektura — Compallo SaaS

### Stack odluka
| Komponenta | Odluka | Razlog |
|---|---|---|
| Auth | Supabase Auth | Email/pass + Google OAuth, gotovo, besplatno do 50k users |
| Baza | Supabase PostgreSQL | RLS built-in, realtime, REST API iz browsera |
| File storage | Supabase Storage | PDF invoice arhiva |
| Frontend | Ostaje vanilla JS/HTML | Nema razloga za React, reimplementacija bi trajala tjednima |
| Hosting | Cloudflare Pages | Besplatno, CDN, auto-deploy iz git |
| Workers | Ostaju isti | Search + Fetch worker rade odlično |
| Email worker | Proširi da podržava per-user Brevo key | Ili centralni Brevo account |
| PDF | Ostaje jsPDF client-side | Radi dobro, ne treba server |
| Pretplate | Stripe | Jedino prihvatljivo rješenje za EUR |

---

## Database Schema

### `profiles` (extends Supabase auth.users)
```sql
CREATE TABLE profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text,
  full_name     text,
  company_name  text,
  company_addr  text,
  company_uid   text,        -- UID/Steuernummer
  iban          text,
  bic           text,
  default_rate  numeric DEFAULT 75,
  default_vat   numeric DEFAULT 20,
  currency      text DEFAULT 'EUR',
  invoice_note  text,
  app_lang      text DEFAULT 'hr',
  app_theme     text DEFAULT 'dark',
  claude_key    text,        -- user's own Anthropic key (encrypted at rest)
  brevo_key     text,        -- user's own Brevo key (optional, fallback na centralni)
  cal_username  text,        -- Cal.com username
  paypal_link   text,
  revolut_link  text,
  stripe_customer_id   text,
  stripe_sub_id        text,
  stripe_sub_status    text DEFAULT 'trialing',  -- trialing | active | canceled | past_due
  trial_ends_at        timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own profile" ON profiles
  FOR ALL USING (auth.uid() = id);
```

### `projects`
```sql
CREATE TABLE projects (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  client_id   bigint REFERENCES clients(id) ON DELETE SET NULL,
  rate        numeric DEFAULT 0,
  status      smallint DEFAULT 0,   -- 0=Upit, 1=U izradi, 2=Isporuceno, 3=Fakturirano, 4=Placeno
  note        text DEFAULT '',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own projects" ON projects
  FOR ALL USING (auth.uid() = user_id);
```

### `clients`
```sql
CREATE TABLE clients (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  contact     text DEFAULT '',
  email       text DEFAULT '',
  phone       text DEFAULT '',
  addr        text DEFAULT '',
  country     text DEFAULT 'DE',
  rate        numeric DEFAULT 0,
  uid         text DEFAULT '',     -- UID/Steuernummer klijenta
  note        text DEFAULT '',
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own clients" ON clients
  FOR ALL USING (auth.uid() = user_id);
```

### `time_logs`
```sql
CREATE TABLE time_logs (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id  bigint REFERENCES projects(id) ON DELETE SET NULL,
  note        text DEFAULT '',
  duration    integer NOT NULL,    -- sekunde
  date        date NOT NULL,
  is_manual   boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE time_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own time_logs" ON time_logs
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_time_logs_user_date ON time_logs(user_id, date DESC);
CREATE INDEX idx_time_logs_project ON time_logs(project_id);
```

### `expenses`
```sql
CREATE TABLE expenses (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id  bigint REFERENCES projects(id) ON DELETE SET NULL,
  desc        text NOT NULL,
  cat         text NOT NULL,       -- gorivo | materijal | softver | putovanje | ostalo
  amount      numeric NOT NULL,
  date        date NOT NULL,
  note        text DEFAULT '',
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own expenses" ON expenses
  FOR ALL USING (auth.uid() = user_id);
```

### `gantt_tasks`
```sql
CREATE TABLE gantt_tasks (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id  bigint REFERENCES projects(id) ON DELETE SET NULL,
  title       text NOT NULL,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      text DEFAULT 'active',  -- active | done | late
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE gantt_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own gantt_tasks" ON gantt_tasks
  FOR ALL USING (auth.uid() = user_id);
```

### `invoice_history`
```sql
CREATE TABLE invoice_history (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inv_number      text NOT NULL,
  client_name     text DEFAULT '',
  date            date NOT NULL,
  due_date        date,
  total           numeric NOT NULL,
  lang            text DEFAULT 'de',
  currency        text DEFAULT 'EUR',
  status          text DEFAULT 'draft',  -- draft | sent | paid | overdue
  from_data       jsonb NOT NULL,        -- { name, addr, email, uid, iban, bic }
  to_data         jsonb NOT NULL,        -- { name, addr, email, uid }
  items           jsonb NOT NULL,        -- [{ desc, qty, price, vat }]
  note            text DEFAULT '',
  pdf_url         text,                  -- Supabase Storage URL (opcionalno)
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE invoice_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own invoices" ON invoice_history
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_invoices_user_status ON invoice_history(user_id, status);
CREATE INDEX idx_invoices_user_date ON invoice_history(user_id, date DESC);
```

### `leads`
```sql
CREATE TABLE leads (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  url         text DEFAULT '',
  desc        text DEFAULT '',
  status      text DEFAULT 'novi',   -- novi | kontaktiran | zainteresiran | nije-odgovorio | odbijenica
  note        text DEFAULT '',
  email       text DEFAULT '',
  emails      jsonb DEFAULT '[]',    -- [{ to, subject, sentAt }]
  followup    date,
  saved_at    date DEFAULT CURRENT_DATE,
  query       text DEFAULT '',
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own leads" ON leads
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_leads_user_status ON leads(user_id, status);
CREATE INDEX idx_leads_followup ON leads(user_id, followup) WHERE followup IS NOT NULL;
```

### `email_templates`
```sql
CREATE TABLE email_templates (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  lang        text DEFAULT 'de',
  subject     text DEFAULT '',
  body        text DEFAULT '',
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own templates" ON email_templates
  FOR ALL USING (auth.uid() = user_id);
```

---

## Faza 1 — Auth (tjedan 1-2)

### 1.1 Supabase projekt setup
- Kreirati novi Supabase projekt: `compallo`
- Uključiti Google OAuth provider (Google Cloud Console OAuth credentials)
- Postaviti `Site URL` i `Redirect URLs` na produkcijsku domenu
- Pokrenuti sve CREATE TABLE migracije iz gornje sheme
- Postaviti environment varijable u Cloudflare Pages:
  ```
  SUPABASE_URL=https://xxx.supabase.co
  SUPABASE_ANON_KEY=eyJ...
  ```

### 1.2 Auth stranica
Dodati novi `#auth-page` div između landing i app stranice:
```html
<div id="auth-page" style="display:none">
  <!-- Tab: Login / Register -->
  <!-- Email + password forma -->
  <!-- Google OAuth gumb -->
  <!-- Forgot password link -->
</div>
```

Flow:
```
Landing → "Start free" → #auth-page (register)
#auth-page uspješna prijava → #app-page
#app-page → Supabase session check on load
```

### 1.3 Supabase JS SDK integracija
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script>
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    currentUser = session.user;
    openApp();
  }
}

supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN') { currentUser = session.user; openApp(); }
  if (event === 'SIGNED_OUT') { goToLanding(); }
});
</script>
```

### 1.4 Protected routes
```javascript
function openApp() {
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session) { showAuthPage(); return; }
    // ... existing openApp logic
  });
}
```

### 1.5 Profil tablica
- Nakon prvog logina: INSERT u `profiles` (upsert) s email-om
- Onboarding modal za novi korisnik: unos firma podataka

---

## Faza 2 — Baza (tjedan 3-5)

### 2.1 Strategija migracije

**Pristup**: zamjena `save()`/`load()` funkcija sa Supabase async pozivima.

Trenutni pattern:
```javascript
// Before
function saveProject() { ...push/update S.projects...; save(); renderKanban(); }
function save() { localStorage.setItem('shopflow_v1', JSON.stringify(S)); }
```

Novi pattern:
```javascript
// After
async function saveProject() {
  const data = { ...projectData, user_id: currentUser.id };
  const { error } = await supabase.from('projects').upsert(data);
  if (error) showToast('...', error.message, false);
  else { await loadProjects(); renderKanban(); }
}
```

### 2.2 Redoslijed migracije modula (po prioritetu)

1. **Settings/Profile** — najjednostavniji, jedan row per user
2. **Clients** — nema foreign key dependencija iz gornje razine
3. **Projects** — ovisi o clients
4. **Time logs** — ovisi o projects
5. **Expenses** — ovisi o projects
6. **Invoice history** — jsonb za items, relativamente izolirano
7. **Gantt tasks** — ovisi o projects
8. **Leads + Email templates** — izolirani moduli

### 2.3 Loading pattern

Zamijeniti inicijalni `load()` s:
```javascript
async function initApp() {
  const uid = currentUser.id;
  const [projects, clients, timeLogs, expenses, gantt,
         invoices, leads, templates, profile] = await Promise.all([
    supabase.from('projects').select('*').eq('user_id', uid).order('id'),
    supabase.from('clients').select('*').eq('user_id', uid),
    supabase.from('time_logs').select('*').eq('user_id', uid).order('date', { ascending: false }),
    supabase.from('expenses').select('*').eq('user_id', uid),
    supabase.from('gantt_tasks').select('*').eq('user_id', uid),
    supabase.from('invoice_history').select('*').eq('user_id', uid).order('date', { ascending: false }),
    supabase.from('leads').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    supabase.from('email_templates').select('*').eq('user_id', uid),
    supabase.from('profiles').select('*').eq('id', uid).single()
  ]);
  // Populate S object from Supabase responses
  S.projects = projects.data || [];
  S.clients = clients.data || [];
  // ...etc
  renderDash();
}
```

### 2.4 One-time import postojećih podataka

Za korisnike koji već imaju podatke u localStorage:
```javascript
async function migrateFromLocalStorage() {
  const raw = localStorage.getItem('shopflow_v1');
  if (!raw) return;
  const old = JSON.parse(raw);
  // Insert sve tablice u Supabase
  // Ponudi gumb "Uvezi postojeće podatke" u onboardingu
}
```

### 2.5 RLS provjera
- Svaka tablica ima `user_id uuid REFERENCES auth.users(id)`
- RLS policy: `USING (auth.uid() = user_id)` na svim tablicama
- Ni jedan query ne prolazi bez aktivne sesije
- Client API key (anon key) je siguran jer RLS blokira cross-user pristup

### 2.6 Sensitive data
- `claude_key` i `brevo_key` u `profiles` tablici
- Supabase ih čuva encrypted at rest (AES-256)
- Nikad se ne logiraju, nikad u localStorage

---

## Faza 3 — SaaS Features (tjedan 6-8)

### 3.1 Booking link u AI emailovima
```javascript
// Svaki generirani email automatski dobiva booking link iz profila
const profile = await getProfile();
const bookingLine = profile.cal_username
  ? `\n\nTermin: https://cal.com/${profile.cal_username}`
  : '';
emailBody += bookingLine;
```

Booking link se prikazuje u AI email promptu kao uputa Claudeu:
```
If the user has a booking link, add it naturally at the end as CTA
instead of suggesting a phone call.
```

### 3.2 Stripe integracija

**Plan**: €19/mj, 14-dnevni trial, cancel anytime.

**Potrebni Stripe proizvodi**:
- Product: "Compallo Pro"
- Price: EUR 19.00/month, recurring

**Cloudflare Worker za Stripe** (`compallo-stripe.workers.dev`):
```
POST /create-checkout  → Stripe Checkout Session
POST /webhook          → Stripe webhooks (sub created/canceled/updated)
GET  /portal           → Stripe Customer Portal link
```

**Webhook events za handleati**:
```
checkout.session.completed     → aktiviraj sub, update profiles.stripe_sub_status
invoice.payment_succeeded      → update sub status = 'active'
invoice.payment_failed         → update sub status = 'past_due', pošalji email
customer.subscription.deleted  → update sub status = 'canceled', blokiraj app
```

**App gating**:
```javascript
function checkSubscription(profile) {
  const allowed = ['trialing', 'active'];
  if (!allowed.includes(profile.stripe_sub_status)) {
    showPaywall(); // Overlay s Stripe Checkout linkom
    return false;
  }
  return true;
}
```

**Trial enforcement**:
```javascript
if (profile.stripe_sub_status === 'trialing') {
  const daysLeft = Math.ceil((new Date(profile.trial_ends_at) - new Date()) / 86400000);
  if (daysLeft <= 3) showTrialWarningBanner(daysLeft);
  if (daysLeft <= 0) { updateSubStatus('canceled'); showPaywall(); }
}
```

### 3.3 Email Worker — per-user Brevo key

Proširi `shopflow-email` Worker:
```javascript
// Korisnik šalje vlastiti Brevo key u requestu (dolazi iz Supabase profila)
// Worker ne koristi hardkodirani key
export default {
  async fetch(request) {
    const { to, subject, body, brevoKey, senderName, senderEmail } = await request.json();
    const key = brevoKey || env.CENTRAL_BREVO_KEY; // fallback na centralni
    // ... Brevo API call
  }
}
```

### 3.4 Onboarding flow

Modal koji se prikazuje novom korisniku (nakon prvog logina):
```
Korak 1/3: Podaci tvrtke (ime, adresa, email)
Korak 2/3: Financijski podaci (IBAN, BIC, default rate, PDV)
Korak 3/3: Opcijsko (Cal.com link, Claude key, Brevo key)
```

### 3.5 Follow-up email notifikacije

Cloudflare Cron Trigger (dnevni):
```javascript
// Svaki dan u 07:00 UTC
// SELECT * FROM leads WHERE followup = CURRENT_DATE AND status != 'odbijenica'
// GROUP BY user_id
// Za svakog usera koji ima follow-upe: pošalji summary email via Brevo
```

Ili alternativno: Supabase Edge Function + pg_cron.

---

## Faza 4 — Polish (tjedan 9-12)

### 4.1 Mobile optimizacija
- Već postoji osnovna mobile responsivnost u CSS (max-width:680px)
- Dodati: bottom safe area za iOS, touch gestures za Kanban
- Testirati na iOS Safari i Android Chrome

### 4.2 PWA

`manifest.json`:
```json
{
  "name": "Compallo",
  "short_name": "Compallo",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0d1117",
  "theme_color": "#1D9E75",
  "icons": [...]
}
```

`service-worker.js`:
- Cache app shell (HTML, CSS, jsPDF)
- Background sync za offline unos vremena

### 4.3 Reports / Analytics stranica

Nova stranica `#page-reports`:
- Prihod po mjesecu (bar chart, SVG ili Chart.js)
- Prihod po klijentu (pie chart)
- Sati po projektu
- Expense breakdown po kategoriji
- YTD vs prošla godina usporedba

### 4.4 Cal.com / Calendly opcija

Proširiti profil s:
```sql
booking_type    text DEFAULT 'cal',    -- cal | calendly | custom
booking_url     text                   -- direktni link (custom opcija)
```

Meetings stranica prikazuje embed ovisno o tipu:
```javascript
if (type === 'cal')      iframe.src = `https://cal.com/${username}`;
if (type === 'calendly') iframe.src = `https://calendly.com/${username}`;
if (type === 'custom')   iframe.src = customUrl;
```

---

## Tehničke napomene i rizici

### Kritični: localStorage → Supabase

Sve funkcije koje trenutno pozivaju `save()` moraju postati async.
To je **najveća promjena** — propagira se kroz cijeli codebase (~30 funkcija).

Preporučeni pristup:
1. Ostaviti `S` objekt kao in-memory cache
2. Svaka promjena: update `S` lokalno (instant UI feedback) + async persist u Supabase
3. Na inicijalizaciji: load iz Supabase → populate `S`

```javascript
// Pattern koji minimizira refactoring:
async function persist(table, data, id = null) {
  if (id) {
    await supabase.from(table).update(data).eq('id', id).eq('user_id', currentUser.id);
  } else {
    const { data: row } = await supabase.from(table).insert({ ...data, user_id: currentUser.id }).select().single();
    return row;
  }
}
```

### Cloudflare Workers — nema promjene

Search i Fetch worker ostaju isti. Email worker dobiva mali update (per-user key).
Stripe worker je nov. Svi workers ostaju na `camodanko.workers.dev`.

### Claude API key sigurnost

Trenutno: direktni browser poziv s user-ovim keyom (ok, HTTPS, user-ov key).
Nakon migracije: isto, ali key dolazi iz Supabase profila (ne localStorage).
Nije potreban Claude Proxy Worker jer je to user-ov vlastiti key.

### Stripe i EU porezi

- Za EU korisnike potreban VAT ID collection u Stripe Checkout
- Koristiti Stripe Tax (automatski kalkulira EU VAT po lokaciji)
- Stripe Billing Portal za invoice historiju pretplate

### Multi-device support

Nakon Supabase migracije, korisnik može koristiti app na više uređaja.
Timer je ephemeral (ostaje u memoriji, ne persists između uređaja) —
za multi-device timer trebalo bi Supabase Realtime, to je Faza 5+.

---

## Vremenski plan

| Tjedan | Faza | Rezultat |
|--------|------|----------|
| 1 | Supabase setup, schema, migracije | DB spreman |
| 2 | Auth stranica, login/register, Google OAuth | Prijava radi |
| 3-4 | Settings + Clients + Projects migracija | Osnova radi na DB |
| 4-5 | TimeLogs + Expenses + Gantt + Invoices | Svi alati na DB |
| 5 | Leads + Templates, localStorage import | Puni paritet |
| 6 | Stripe webhook Worker, paywall, trial | Naplata radi |
| 7 | Onboarding flow, per-user Brevo key | UX poliran |
| 8 | Booking link u emailovima, follow-up notifikacije | Sve SaaS featurije |
| 9-10 | Reports stranica, PWA | Polish |
| 11-12 | QA, mobile testiranje, beta korisnici | Launch |

---

## Prioriteti za MVP (Faza 1 + 2 minimum)

Za monetizaciju je dovoljno:
1. ✅ Supabase auth (email/pass, Google)
2. ✅ Profil tablica s osnovnim podacima
3. ✅ Svi moduli na Supabase (RLS)
4. ✅ Stripe trial + pretplata + paywall
5. ✅ Landing page ostaje isti
6. ✅ Onboarding (3 koraka)

Sve ostalo (Reports, PWA, Calendly, notifikacije) je nice-to-have.

---

## Troškovi infrastrukture

| Servis | Plan | Cijena |
|--------|------|--------|
| Supabase | Free → Pro | €0 → €25/mj (kad >500MB ili >50k users) |
| Cloudflare Pages | Free | €0 |
| Cloudflare Workers | Free (100k req/day) | €0 → €5/mj |
| Stripe | - | 1.4% + €0.25 po transakciji (EU cards) |
| Brevo (centralni) | Starter | €0 → €7/mj (300 emailova/dan free) |
| Domena | - | ~€12/god |

**Breakeven**: ~2 plaćena korisnika po €19/mj pokrivaju sve infrastrukturne troškove.
