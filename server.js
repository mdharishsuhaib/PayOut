import './lib/env.js';
import express from 'express';
import fs from 'node:fs';
import { preflight, checkRoute, decide, countryProfile, currencyRules, COUNTRIES, DOCS, RULES_VERSION, normCountry } from './lib/rules.js';
import * as pp from './lib/paypal.js';
import { askRoute, askContext, explainRow, recoveryNote, parseBatch, llmLive, llmModel, searchLive, SEARCH_NAME } from './lib/ai.js';
import { playbookFor, WEBHOOK_STATUS } from './lib/recovery.js';
import { library as faqLibrary } from './lib/faq.js';
import { toRows, toRowsWithMap } from './lib/csv.js';
import { batches, events } from './lib/store.js';
import * as login from './lib/login.js';

const app = express();
// Deployed: the pages are served by a Cloudflare Worker that forwards /api, /auth and /vendor here (Render), so the
// browser only ever talks to one site. Trust the proxies' X-Forwarded-Proto (Secure cookies) and use the public host
// the Worker reports, so redirects, cookies and the demo's same-site check use the address the customer sees.
app.set('trust proxy', true);
const hostOf = (req) => req.get('x-payout-host') || req.get('host');
// Log in with PayPal returns to the host registered on developer.paypal.com (PAYPAL_RETURN_URL). The session cookie
// belongs to one host, so page visits on any other host (e.g. localhost vs 127.0.0.1) are sent to that one first.
const canonical = process.env.PAYPAL_RETURN_URL ? new URL(process.env.PAYPAL_RETURN_URL).host : null;
const samePort = (h) => (h || '').split(':')[1] === (canonical || '').split(':')[1]; // test servers on other ports are left alone
app.use((req, res, next) => {
  if (canonical && req.method === 'GET' && hostOf(req) !== canonical && samePort(hostOf(req)) && !req.path.startsWith('/api/') && req.path !== '/healthz') {
    return res.redirect(302, `${new URL(process.env.PAYPAL_RETURN_URL).protocol}//${canonical}${req.originalUrl}`);
  }
  next();
});
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: 'text/csv', limit: '5mb' }));
app.use(express.static('public', { extensions: ['html'], setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.use('/vendor/ag-grid', express.static('node_modules/ag-grid-community/dist'));

const SENDER = () => normCountry(process.env.SENDER_COUNTRY || 'US');
const SANDBOX_RECEIVER = () => process.env.SANDBOX_RECEIVER_EMAIL || 'sb-receiver@personal.example.com';
const id = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(e.status && e.status < 500 ? e.status : 500).json({ error: e.message, paypal: e.data }));

// ---- Log in with PayPal ----
// The browser is sent to PayPal's own login page; PayPal redirects back here with a one-time code.
const NEXT_OK = new Set(['routes', 'preflight', 'payouts', 'signals', 'resolve', 'rules']);
const back = (res, err, next = 'login') => res.redirect(`/${err ? `?auth_error=${encodeURIComponent(err)}` : ''}#/${next}`);
app.get('/auth/paypal/login', async (req, res) => {
  if (!login.loginConfigured()) return back(res, 'not_configured');
  const next = NEXT_OK.has(req.query.next) ? req.query.next : 'preflight';
  const redirectUri = login.returnUrl(req);
  // until PayPal knows this app's return URL, open PayPal's own login page rather than its "Sorry about that" error
  if (!(await login.loginReady(redirectUri))) {
    console.warn(`Log in with PayPal: PayPal does not accept the return URL ${redirectUri} yet. Opening PayPal's login page instead. Add it under "Log in with PayPal" for this app on developer.paypal.com.`);
    return res.redirect(login.signinPage());
  }
  res.redirect(login.authorizeUrl({ state: login.beginLogin(next, req.query.tab === '1'), redirectUri }));
});
// Login opened in its own tab: tell the PayOut tab it's signed in, then close this one
const tabDone = (res, next, err) => res.type('html').send(`<!doctype html><meta charset="utf-8"><title>PayOut</title>
<body style="font:16px system-ui;padding:40px;text-align:center;color:#001435">
<p>${err ? 'PayPal login did not finish.' : 'You are logged in with PayPal.'} You can close this tab.</p>
<p><a href="/${err ? `?auth_error=${encodeURIComponent(err)}` : ''}#/${next}">Back to PayOut</a></p>
<script>
  const msg = ${JSON.stringify({ type: 'payout-auth', ok: !err, error: err || null, next })};
  try { new BroadcastChannel('payout-auth').postMessage(msg); } catch {}
  setTimeout(() => window.close(), 400);
</script>`);
app.get('/auth/paypal/callback', async (req, res) => {
  const { code, state, error, error_description: desc } = req.query;
  const p = state && login.takeState(String(state));
  const fail = (err) => (p?.tab ? tabDone(res, 'login', err) : back(res, err));
  if (error) return fail(error === 'access_denied' ? 'cancelled' : `${error}${desc ? `: ${desc}` : ''}`);
  if (!p) return back(res, 'expired');
  if (!code) return fail('no_code');
  try {
    const t = await login.exchangeCode(String(code));
    const user = await login.userInfo(t.access_token);
    login.createSession(res, req, user);
    p.tab ? tabDone(res, p.next) : back(res, null, p.next);
  } catch (e) { console.error('Log in with PayPal:', e.message); fail(e.code === 'invalid_client' || /invalid_client/.test(e.message) ? 'invalid_client' : e.message); }
});
app.post('/auth/logout', (req, res) => { login.endSession(req, res); res.json({ ok: true }); });
// Demo for judges: a labelled session without a PayPal login. Everything runs against PayOut's own PayPal Sandbox
// business account, so no real money moves. Turn it off with DEMO_LOGIN=0.
const demoOn = () => process.env.DEMO_LOGIN !== '0';
app.post('/auth/demo', (req, res) => {
  if (!demoOn()) return res.status(403).json({ error: 'The demo is turned off on this server.' });
  // only the Try the demo button on PayOut's own Login and Sign Up pages can start it
  const from = req.get('origin') || req.get('referer') || '';
  let sameSite = false; try { sameSite = new URL(from).host === hostOf(req); } catch { /* missing or bad header */ }
  if (!sameSite || !['login', 'signup'].includes(req.body?.page)) return res.status(403).json({ error: 'Start the demo from the Login or Sign Up page.' });
  login.createSession(res, req, { id: 'demo', name: 'Demo', givenName: 'Demo', email: null, verified: false, country: process.env.SENDER_COUNTRY || 'US', accountType: 'demo', demo: true });
  res.json({ ok: true, next: NEXT_OK.has(req.body?.next) ? req.body.next : 'preflight' });
});
app.get('/api/me', async (req, res) => res.json({
  user: login.currentUser(req), configured: login.loginConfigured(), returnUrl: login.returnUrl(req), ready: await login.loginReady(login.returnUrl(req)), demo: demoOn(),
  loginUrl: '/auth/paypal/login', signupUrl: `${login.webBase()}/bizsignup/`, paypalHost: new URL(login.webBase()).host,
}));
// Everything except the public pages' data and PayPal's webhook needs a signed-in PayPal user.
// req.owner is that customer's account: every batch, payout and event read or changed below is limited to it.
const PUBLIC_API = [/^\/api\/(config|countries|currencies|me)$/, /^\/api\/route\/(check|ask)$/, /^\/api\/ask(\/library)?$/, /^\/api\/webhooks\/paypal$/];
const ownerOf = (u) => (!u ? null : u.demo ? 'demo' : `pp:${u.id}`);
app.use('/api', (req, res, next) => {
  const u = login.currentUser(req);
  req.user = u; req.owner = ownerOf(u);
  if (PUBLIC_API.some((r) => r.test(req.baseUrl + req.path)) || u) return next();
  res.status(401).json({ error: 'Log in with PayPal to use this.', auth: true });
});

// ---- live updates (server-sent events), only to the customer the change belongs to ----
const clients = new Set();
const push = (owner, type, data) => { if (!owner) return; const s = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) if (c.owner === owner) c.res.write(s); };
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }).flushHeaders();
  const c = { res, owner: req.owner }; clients.add(c); const t = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { clearInterval(t); clients.delete(c); });
});

// ---- helpers ----
function normalise(raw, i) {
  const receiver = String(raw.receiver || '').trim().replace('{{SANDBOX_RECEIVER}}', SANDBOX_RECEIVER()).replace('{{SANDBOX_RECEIVER_IN}}', process.env.SANDBOX_RECEIVER_IN_EMAIL || 'kavya.iyer@example.com');
  const t = String(raw.recipientType || '').toUpperCase();
  return {
    line: i + 1, ref: String(raw.ref || '').trim() || `PG-${String(i + 1).padStart(4, '0')}`, name: String(raw.name || '').trim(),
    receiver, recipientType: ['EMAIL', 'PHONE', 'PAYPAL_ID'].includes(t) ? t : /^\+?\d[\d ()-]+$/.test(receiver) ? 'PHONE' : 'EMAIL',
    wallet: String(raw.wallet || '').toUpperCase() === 'VENMO' ? 'VENMO' : 'PAYPAL',
    country: raw.country || '', currency: raw.currency || '', amount: raw.amount === undefined ? '' : String(raw.amount).trim(),
    fromCountry: raw.fromCountry || '', note: raw.note || '',
  };
}
function evaluate(b) {
  const { rows, batchFindings } = preflight(b.rows.map(({ findings, decision, ...r }) => r), { senderCountry: b.senderCountry });
  // across batches: the same payout must never be paid twice. Everything this customer already sent from another
  // batch is compared with the rows still waiting here.
  const paidRef = new Map(), paidKey = new Map();
  for (const o of b.owner ? batches.list(b.owner) : []) {
    if (o.id === b.id) continue;
    for (const r of o.rows) if (r.payout) {
      const when = new Date(r.payout.sentAt || o.payout?.submittedAt || o.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      paidRef.set(r.ref, { name: o.name, when });
      paidKey.set([String(r.receiver || '').toLowerCase(), r.currency, Number(r.amount)].join('|'), { name: o.name, when, ref: r.ref });
    }
  }
  for (const r of rows) {
    if (b.rows.find((x) => x.ref === r.ref)?.payout) continue; // already sent from this batch: nothing to check
    const ref = paidRef.get(r.ref), key = paidKey.get([String(r.receiver || '').toLowerCase(), r.currency, Number(r.amount)].join('|'));
    if (ref) r.findings.push({ severity: 'block', code: 'ALREADY_PAID', title: 'Already paid', detail: `Reference ${r.ref} was already sent to PayPal from "${ref.name}" on ${ref.when}. Sending it again would pay the same person twice.` });
    else if (key) r.findings.push({ severity: 'review', code: 'PAID_BEFORE', title: 'Paid before', detail: `You already paid this recipient the same amount and currency (${key.ref}, "${key.name}", ${key.when}). Confirm this is a new payment, not a repeat.` });
    if (ref || key) r.decision = decide(r.findings);
  }
  b.rows = rows.map((r, i) => {
    const prev = b.rows[i];
    if (prev.decision && prev.decision !== r.decision) return { ...prev, ...r, approved: r.decision === 'eligible', acknowledged: false };
    return { ...prev, ...r, approved: r.decision === 'eligible' ? prev.approved ?? true : r.decision === 'review' ? !!prev.acknowledged && prev.approved !== false : false };
  });
  b.batchFindings = batchFindings;
  b.summary = summary(b);
  return b;
}
function summary(b) {
  const s = { total: b.rows.length, eligible: 0, review: 0, blocked: 0, approved: 0, approvedAmount: {}, countries: {} };
  for (const r of b.rows) {
    s[r.decision]++;
    (s.countries[r.country || '??'] ||= { eligible: 0, review: 0, blocked: 0 })[r.decision]++;
    if (r.approved && !r.payout) { s.approved++; s.approvedAmount[r.currency] = +((s.approvedAmount[r.currency] || 0) + Number(r.amount)).toFixed(2); }
  }
  return s;
}
const publicBatch = (b) => ({ ...b, senderCountryName: COUNTRIES[b.senderCountry]?.name || b.senderCountry });
function newBatch(owner, rawRows, source, name, mapping = null) {
  const b = { id: id('B'), owner, name: name || `Batch ${new Date().toISOString().slice(0, 10)}`, source, senderCountry: SENDER(), createdAt: new Date().toISOString(), rows: rawRows.map(normalise), payout: null, mapping };
  return batches.put(evaluate(b));
}
function applyStatus(batch, row, status, extra = {}) {
  if (!row.payout) return;
  const prev = row.payout.status;
  Object.assign(row.payout, { status, ...extra, updatedAt: new Date().toISOString() });
  if (prev !== status) {
    // every status change becomes part of the payout's history (Payouts + Signals)
    const source = extra.source || 'paypal';
    events.add({ id: id('E'), at: new Date().toISOString(), owner: batch.owner, batchId: batch.id, ref: row.ref, type: 'ITEM.STATUS', source, prev, status,
      item: { payout_item_id: row.payout.itemId, payout_batch_id: row.payout.batchId, transaction_status: status, error: row.payout.error || null },
      summary: `${row.ref} ${prev || 'NEW'} → ${status}${source === 'demo' ? ' (demo, not from PayPal)' : source === 'webhook' ? ' (PayPal webhook)' : ' (PayPal API)'}` });
    push(batch.owner, 'item', { batchId: batch.id, ref: row.ref, status, prev, source });
  }
}

// ---- config / health ----
app.get('/healthz', (_q, res) => res.send('ok'));
app.get('/api/config', wrap(async (_q, res) => res.json({
  paypal: await pp.checkAccess(), ai: { live: llmLive(), model: llmModel(), search: searchLive() ? SEARCH_NAME : null },
  senderCountry: SENDER(), senderCountryName: COUNTRIES[SENDER()]?.name, rulesVersion: RULES_VERSION, docs: DOCS,
  webhookVerification: !!process.env.PAYPAL_WEBHOOK_ID,
})));

// ---- route intelligence ----
app.get('/api/countries', (_q, res) => res.json(Object.values(COUNTRIES).map((c) => countryProfile(c.code))));
app.get('/api/currencies', (_q, res) => res.json(currencyRules()));
app.post('/api/route/check', (req, res) => { const findings = checkRoute(req.body); res.json({ decision: decide(findings), findings }); });
// Ask: contextual. The screen sends what is selected (a row, a payout, a route) so answers are about it.
app.post('/api/ask', wrap(async (req, res) => {
  const q = String(req.body.question || '').slice(0, 600), c = req.body.context || {};
  const user = req.user;
  // questions about the customer's own payouts are answered from their own stored PayPal records, signed in only
  const ws = user ? workspaceAnswer(q, req.owner) : null;
  if (!user && workspaceAnswer(q, null)) return res.json({ kind: 'general', ai: false, layers: { note: 'Log in with PayPal to ask about your own payouts.' } });
  if (ws) return res.json(ws);
  let ctx = null;
  if (user && c.batchId && c.ref) { // a payout's details are only read for the customer who owns it
    const b = batches.get(c.batchId, req.owner), row = b?.rows.find((r) => r.ref === c.ref);
    if (row) ctx = { kind: 'row', row, playbook: row.payout ? playbookFor(row.payout.status, row.payout.error) : null };
  } else if (c.route?.from && c.route?.to) ctx = { kind: 'route', route: c.route };
  res.json(await askContext(q, ctx));
}));
app.get('/api/ask/library', (_q, res) => res.json(faqLibrary()));

// "Which payouts need my attention today?" and friends: computed from real PayPal statuses, never guessed
function workspaceAnswer(q, owner) {
  const s = q.toLowerCase(), rows = sentRows(owner), open = rows.filter((r) => !['SUCCESS', 'PENDING'].includes(r.status));
  const name = (r) => `${r.ref} ${r.name || r.receiver} (${r.amount} ${r.currency}, ${r.status})`;
  const fact = (text) => ({ kind: 'workspace', ai: false, layers: { fact: text, sources: [] } });
  if (/attention|need.*(action|me)|today/.test(s)) {
    if (!open.length) return fact(`None. Of ${rows.length} payouts sent, PayPal reports none that are unclaimed, held, blocked, failed or returned.`);
    return { kind: 'workspace', ai: false, layers: { fact: `${open.length} of ${rows.length} payouts need attention: ${open.map(name).join('; ')}.`, suggestion: 'Open Resolve to work through them, most urgent first.', sources: [] } };
  }
  if (/deadline|30.day|approaching|expir/.test(s)) {
    const un = rows.filter((r) => r.status === 'UNCLAIMED').map((r) => ({ ...r, left: Math.max(0, 30 - r.ageDays) })).sort((a, b) => a.left - b.left);
    if (!un.length) return fact('No payouts are unclaimed, so none are counting down to the 30-day return.');
    return { kind: 'workspace', ai: false, layers: { fact: `${un.length} unclaimed: ${un.map((r) => `${r.ref} ${r.name || r.receiver}, ${r.left} day${r.left === 1 ? '' : 's'} left`).join('; ')}.`, suggestion: 'Remind each recipient to claim it, or cancel it from Resolve if the address is wrong.', sources: [] } };
  }
  if (/last (payout )?batch|latest batch|recent batch/.test(s)) {
    const b = batches.list(owner).find((x) => x.payout);
    if (!b) return fact('No batch has been sent to PayPal yet.');
    const items = b.rows.filter((r) => r.payout), by = items.reduce((m, r) => ({ ...m, [r.payout.status]: (m[r.payout.status] || 0) + 1 }), {});
    return fact(`"${b.name}" went to PayPal as ${(b.payout.batches || []).map((p) => `${p.currency} ${p.id} (${p.status})`).join(', ')}. Items: ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ')}. ${b.rows.length - items.length} rows were held back.`);
  }
  if (/fee|spent|spend/.test(s) && /my|i |total|how much/.test(s)) {
    const withFee = rows.filter((r) => r.fee?.value);
    if (!withFee.length) return fact('PayPal has not reported a fee on any of your payouts yet.');
    const tot = withFee.reduce((m, r) => ({ ...m, [r.fee.currency]: +((m[r.fee.currency] || 0) + Number(r.fee.value)).toFixed(2) }), {});
    return fact(`PayPal reported fees on ${withFee.length} payouts: ${Object.entries(tot).map(([c, v]) => `${v} ${c}`).join(' + ')}.`);
  }
  return null;
}
app.post('/api/route/ask', wrap(async (req, res) => res.json(await askRoute(String(req.body.question || '').slice(0, 600)))));

// ---- batches ----
app.get('/api/batches', (req, res) => res.json(batches.list(req.owner).map((b) => ({ id: b.id, name: b.name, createdAt: b.createdAt, summary: b.summary, payout: b.payout }))));
app.get('/api/batches/:id', (req, res) => { const b = batches.get(req.params.id, req.owner); b ? res.json(publicBatch(b)) : res.status(404).json({ error: 'not found' }); });

// one sample batch per customer: pressing Sample again opens it instead of creating a duplicate copy
app.post('/api/batches/sample', (req, res) => {
  const have = batches.list(req.owner).find((b) => b.source === 'sample');
  if (have) return res.json({ ...publicBatch(batches.put(evaluate(have))), reopened: true });
  const m = toRowsWithMap(fs.readFileSync('data/sample.csv', 'utf8'));
  res.json(publicBatch(newBatch(req.owner, m.rows, 'sample', 'Contractors, October (sample data)', { fields: m.mapping, ignored: m.ignored })));
});
app.post('/api/batches/csv', wrap(async (req, res) => {
  const text = typeof req.body === 'string' ? req.body : req.body.csv;
  const m = toRowsWithMap(String(text || ''));
  if (!m.rows.length) return res.status(400).json({ error: 'No rows found. The first line must be a header, e.g. reference,name,receiver,country,currency,amount' });
  res.json(publicBatch(newBatch(req.owner, m.rows, 'csv', req.query.name || req.body.name, { fields: m.mapping, ignored: m.ignored })));
}));
app.post('/api/batches/text', wrap(async (req, res) => {
  const { rows, ai } = await parseBatch(String(req.body.text || '').slice(0, 8000));
  if (!rows.length) return res.status(400).json({ error: 'No payouts found in that text. Give each payout an email, an amount with currency and a country.' });
  res.json({ ...publicBatch(newBatch(req.owner, rows, ai ? 'ai' : 'text', 'Typed batch')), parsedBy: ai ? 'ai' : 'rules' });
}));

// edit a row (fix suggestions, inline grid edits) and re-run the deterministic checks
app.patch('/api/batches/:id/rows/:ref', (req, res) => {
  const b = batches.get(req.params.id, req.owner), r = b?.rows.find((x) => x.ref === req.params.ref);
  if (!r) return res.status(404).json({ error: 'not found' });
  if (r.payout) return res.status(409).json({ error: 'This row was already sent to PayPal and can no longer be edited.' });
  const allowed = ['name', 'receiver', 'recipientType', 'wallet', 'country', 'currency', 'amount', 'fromCountry', 'note', 'approved', 'acknowledged'];
  for (const k of allowed) if (k in req.body) r[k] = req.body[k];
  if ('acknowledged' in req.body && req.body.acknowledged) r.approved = true;
  r.explanation = null;
  batches.put(evaluate(b));
  res.json(publicBatch(b));
});

app.get('/api/batches/:id/rows/:ref/explain', wrap(async (req, res) => {
  const b = batches.get(req.params.id, req.owner), r = b?.rows.find((x) => x.ref === req.params.ref);
  if (!r) return res.status(404).json({ error: 'not found' });
  if (!r.explanation) { r.explanation = await explainRow(r); batches.put(b); }
  res.json(r.explanation);
}));

// ---- execution: only approved rows that the rules engine did not block ----
app.post('/api/batches/:id/submit', wrap(async (req, res) => {
  const b = batches.get(req.params.id, req.owner);
  if (!b) return res.status(404).json({ error: 'not found' });
  if (b.payout) return res.status(409).json({ error: 'This batch was already submitted.', payout: b.payout });
  evaluate(b); // re-check right before money moves
  const send = b.rows.filter((r) => r.approved && r.decision !== 'blocked' && (r.decision === 'eligible' || r.acknowledged));
  if (!send.length) return res.status(400).json({ error: 'No approved rows to send.' });
  if (b.senderCountry && !COUNTRIES[b.senderCountry]?.canSend) return res.status(400).json({ error: 'The sending country cannot originate Payouts.' });

  // PayPal rejects mixed currencies in one request ("Multiple currencies within a batch is not allowed"),
  // so approved rows are split into one PayPal batch per currency.
  const groups = {};
  for (const r of send) (groups[r.currency] ||= []).push(r);
  const created = [], failures = [];
  for (const [cur, rows] of Object.entries(groups)) {
    try {
      const d = await pp.createBatch({ batchId: `${b.id}-${cur}`, rows, subject: req.body.subject, message: req.body.message });
      created.push({ currency: cur, id: d.batch_header.payout_batch_id, status: d.batch_header.batch_status, simulated: !!d.simulated, count: rows.length, links: d.links });
      for (const r of rows) r.payout = { status: 'PENDING', itemId: null, batchId: d.batch_header.payout_batch_id, sentAt: new Date().toISOString() };
    } catch (e) {
      failures.push({ currency: cur, error: e.message, paypal: e.data });
    }
  }
  if (!created.length) return res.status(502).json({ error: failures[0].error, paypal: failures[0].paypal });
  b.payout = { id: created.map((c) => c.id).join(', '), batches: created, failures, status: created.every((c) => c.status === 'SUCCESS') ? 'SUCCESS' : 'PENDING',
    simulated: created.every((c) => c.simulated), submittedAt: new Date().toISOString() };
  batches.put(b);
  for (const c of created) events.add({ id: id('E'), at: b.payout.submittedAt, batchId: b.id, type: 'BATCH.SUBMITTED', source: c.simulated ? 'simulated' : 'paypal',
    summary: `${c.count} ${c.currency} payout${c.count > 1 ? 's' : ''} accepted by PayPal as ${c.id}` });
  for (const f of failures) events.add({ id: id('E'), at: b.payout.submittedAt, batchId: b.id, type: 'BATCH.REJECTED', source: 'paypal', summary: `${f.currency} batch rejected: ${f.error}` });
  push(b.owner, 'batch', { batchId: b.id });
  res.json(publicBatch(b));
}));

// pull the real state from PayPal: GET /v1/payments/payouts/{id}, once per currency batch
async function syncBatch(b) {
  if (!b.payout) return b;
  for (const pb of b.payout.batches || []) {
    const d = await pp.getBatch(pb.id);
    pb.status = d.batch_header?.batch_status || pb.status;
    pb.fees = d.batch_header?.fees;
    for (const it of d.items || []) {
      // match by PayPal's item ID first; the reference alone is only used before PayPal has assigned an item ID
      const r = b.rows.find((x) => x.payout && x.payout.batchId === pb.id && (x.payout.itemId ? x.payout.itemId === it.payout_item_id : x.ref === it.payout_item?.sender_item_id));
      if (!r) continue;
      r.payout.itemId = it.payout_item_id;
      r.payout.transactionId = it.transaction_id;
      r.payout.fee = it.payout_item_fee;
      r.payout.error = it.errors?.name || null;
      applyStatus(b, r, it.transaction_status, { source: d.simulated ? 'simulated' : 'paypal' });
    }
  }
  const st = (b.payout.batches || []).map((x) => x.status);
  b.payout.status = st.every((s) => s === 'SUCCESS') ? 'SUCCESS' : st.includes('DENIED') ? 'PARTIAL' : st[0] || b.payout.status;
  b.payout.syncedAt = new Date().toISOString();
  batches.put(b);
  return b;
}
app.post('/api/batches/:id/sync', wrap(async (req, res) => {
  const b = batches.get(req.params.id, req.owner);
  if (!b) return res.status(404).json({ error: 'not found' });
  res.json(publicBatch(await syncBatch(b)));
}));

// ---- recovery ----
app.get('/api/batches/:id/rows/:ref/recovery', wrap(async (req, res) => {
  const b = batches.get(req.params.id, req.owner), r = b?.rows.find((x) => x.ref === req.params.ref);
  if (!r?.payout) return res.status(404).json({ error: 'This row has not been sent.' });
  // always fetch the real current status before recommending anything
  if (r.payout.itemId && !r.payout.demo) {
    const it = await pp.getItem(r.payout.itemId);
    r.payout.error = it.errors?.name || r.payout.error || null;
    applyStatus(b, r, it.transaction_status, { source: it.simulated ? 'simulated' : 'paypal' });
    batches.put(b);
  }
  const play = playbookFor(r.payout.status, r.payout.error);
  const note = await recoveryNote(r, play);
  res.json({ ref: r.ref, status: r.payout.status, demo: !!r.payout.demo, checkedAt: new Date().toISOString(), playbook: play, ...note,
    canCancel: r.payout.status === 'UNCLAIMED' && !!r.payout.itemId && !r.payout.demo });
}));

app.post('/api/batches/:id/rows/:ref/cancel', wrap(async (req, res) => {
  const b = batches.get(req.params.id, req.owner), r = b?.rows.find((x) => x.ref === req.params.ref);
  if (!r?.payout?.itemId) return res.status(404).json({ error: 'No PayPal payout item for this row.' });
  if (!req.body.confirm) return res.status(400).json({ error: 'Confirm that you want to cancel this payout.' });
  const live = await pp.getItem(r.payout.itemId); // re-check: PayPal only cancels UNCLAIMED items
  if (live.transaction_status !== 'UNCLAIMED') { applyStatus(b, r, live.transaction_status); batches.put(b); return res.status(409).json({ error: `PayPal reports ${live.transaction_status}; only UNCLAIMED payouts can be cancelled.` }); }
  let d;
  try { d = await pp.cancelItem(r.payout.itemId); }
  catch (e) {
    // PayPal answered with an error, so nothing was cancelled; say so plainly and keep a record in Signals
    const dbg = e.data?.debug_id ? ` (PayPal debug ID ${e.data.debug_id})` : '';
    const msg = e.status >= 500
      ? `PayPal${/sandbox/.test(process.env.PAYPAL_API_BASE || 'sandbox') ? ' Sandbox' : ''} had an internal error and did not cancel ${r.ref}${dbg}. Nothing changed: it is still UNCLAIMED. Try again later; if it stays unclaimed, PayPal returns it automatically after 30 days.`
      : `PayPal did not cancel ${r.ref}: ${e.data?.message || e.message}${dbg}.`;
    events.add({ id: id('E'), at: new Date().toISOString(), batchId: b.id, ref: r.ref, type: 'ITEM.CANCEL_FAILED', source: 'paypal', summary: msg });
    push(b.owner, 'event', { batchId: b.id, ref: r.ref });
    return res.status(502).json({ error: msg, paypal: e.data });
  }
  applyStatus(b, r, d.transaction_status || 'RETURNED', { source: d.simulated ? 'simulated' : 'paypal', cancelledAt: new Date().toISOString() });
  batches.put(b);
  events.add({ id: id('E'), at: new Date().toISOString(), batchId: b.id, ref: r.ref, type: 'ITEM.CANCELLED', source: d.simulated ? 'simulated' : 'paypal', summary: `You cancelled unclaimed payout ${r.ref}; the funds returned to your PayPal balance` });
  res.json(publicBatch(b));
}));

// clearly-labelled practice statuses, for statuses the sandbox can't produce on demand. Demo account only: a real
// customer's payouts only ever show what PayPal reports.
app.post('/api/batches/:id/rows/:ref/demo-status', (req, res) => {
  if (req.owner !== 'demo') return res.status(403).json({ error: 'Practice statuses are only available in the demo.' });
  const b = batches.get(req.params.id, req.owner), r = b?.rows.find((x) => x.ref === req.params.ref);
  const status = String(req.body.status || '').toUpperCase();
  if (!r?.payout) return res.status(404).json({ error: 'This row has not been sent.' });
  if (!['FAILED', 'BLOCKED', 'ONHOLD', 'UNCLAIMED', 'RETURNED'].includes(status)) return res.status(400).json({ error: 'Unsupported demo status.' });
  r.payout.demo = true;
  applyStatus(b, r, status, { source: 'demo', error: req.body.error || (status === 'FAILED' ? 'RECEIVER_UNREGISTERED' : null) });
  batches.put(b);
  res.json(publicBatch(b));
});

app.get('/api/events', (req, res) => res.json(events.list(req.owner, req.query.batch)));

// every row the customer sent to PayPal, across their batches (Tracking + Resolve)
const sentRows = (owner) => batches.list(owner).flatMap((b) => b.rows.filter((r) => r.payout).map((r) => ({
  ...r.payout, payoutBatchId: r.payout.batchId,
  batchId: b.id, batchName: b.name, submittedAt: b.payout?.submittedAt, ref: r.ref, name: r.name, receiver: r.receiver, country: r.country,
  currency: r.currency, amount: r.amount,
  ageDays: (r.payout.sentAt || b.payout?.submittedAt) ? Math.floor((Date.now() - Date.parse(r.payout.sentAt || b.payout.submittedAt)) / 86_400_000) : 0,
})));
app.get('/api/payouts', (req, res) => res.json(sentRows(req.owner)));

app.get('/api/overview', (req, res) => {
  const all = batches.list(req.owner), rows = all.flatMap((b) => b.rows.filter((r) => !r.payout)), sent = sentRows(req.owner);
  const by = (k) => rows.filter((r) => r.decision === k).length;
  const routes = {};
  for (const r of all.flatMap((b) => b.rows)) {
    const k = r.country || '??';
    (routes[k] ||= { country: k, name: COUNTRIES[k]?.name || k, eligible: 0, review: 0, blocked: 0, sent: 0 });
    if (r.payout) routes[k].sent++; else routes[k][r.decision]++;
  }
  const attention = sent.filter((s) => !['SUCCESS', 'PENDING'].includes(s.status)).map((s) => ({ ...s, daysLeft: s.status === 'UNCLAIMED' ? Math.max(0, 30 - s.ageDays) : null }));
  res.json({
    counts: { ready: by('eligible'), review: by('review'), blocked: by('blocked'), pending: sent.filter((s) => s.status === 'PENDING').length, paid: sent.filter((s) => s.status === 'SUCCESS').length, exceptions: attention.length },
    batches: all.slice(0, 6).map((b) => ({ id: b.id, name: b.name, createdAt: b.createdAt, summary: b.summary, payout: b.payout && { id: b.payout.id, status: b.payout.status, simulated: b.payout.simulated, batches: b.payout.batches } })),
    routes: Object.values(routes).sort((a, b) => (b.blocked + b.review) - (a.blocked + a.review) || a.name.localeCompare(b.name)),
    attention, events: events.list(req.owner).slice(0, 8),
  });
});

// ---- PayPal webhooks: PAYMENT.PAYOUTSBATCH.* and PAYMENT.PAYOUTS-ITEM.* ----
app.post('/api/webhooks/paypal', wrap(async (req, res) => {
  const ev = req.body;
  if (!ev?.event_type) return res.status(400).json({ error: 'not a PayPal event' });
  if (ev.id && events.seen(ev.id)) return res.json({ ok: true, duplicate: true }); // PayPal retries up to 25 times: process once
  const at = () => new Date().toISOString();
  const steps = [{ step: 'received', at: at() }];
  let verified = 'UNVERIFIED';
  try { verified = await pp.verifyWebhook(req.headers, ev); } catch { verified = 'ERROR'; }
  steps.push({ step: 'verified', at: at(), result: verified });
  if (verified === 'FAILURE') return res.status(400).json({ error: 'signature verification failed' });

  const res0 = ev.resource || {};
  const item = { payout_item_id: res0.payout_item_id || null, payout_batch_id: res0.payout_batch_id || res0.batch_header?.payout_batch_id || null, sender_item_id: res0.payout_item?.sender_item_id || null,
    transaction_status: res0.transaction_status || res0.batch_header?.batch_status || null, error: res0.errors?.name || null };
  const rec = events.add({ id: ev.id || id('E'), at: ev.create_time || at(), receivedAt: at(), type: ev.event_type, source: 'webhook', verified, steps, owner: null, batchId: null, ref: null, item, summary: ev.summary || ev.event_type });
  steps.push({ step: 'recorded', at: at() });
  res.json({ ok: true, verified }); // acknowledge fast with 2xx; the rest happens after the response

  try {
    const r = ev.resource || {};
    if (ev.event_type.startsWith('PAYMENT.PAYOUTS-ITEM.')) {
      const hit = batches.findItem({ itemId: r.payout_item_id, ref: r.payout_item?.sender_item_id, payoutBatchId: r.payout_batch_id });
      const status = WEBHOOK_STATUS[ev.event_type] || r.transaction_status;
      if (hit && status && verified === 'SUCCESS') {
        hit.row.payout.itemId ||= r.payout_item_id;
        hit.row.payout.error = r.errors?.name || hit.row.payout.error || null;
        applyStatus(hit.batch, hit.row, status, { source: 'webhook' });
        batches.put(hit.batch);
        Object.assign(rec, { owner: hit.batch.owner, batchId: hit.batch.id, ref: hit.row.ref, summary: `${hit.row.ref} is now ${status} (PayPal webhook)` });
        steps.push({ step: 'updated', at: at(), detail: `${hit.row.ref} → ${status}` });
      } else if (hit && hit.row.payout.itemId && !hit.row.payout.demo) {
        // signature not verified: the event body is not trusted. Use it only as a cue to ask PayPal directly.
        const it = await pp.getItem(hit.row.payout.itemId);
        hit.row.payout.error = it.errors?.name || hit.row.payout.error || null;
        applyStatus(hit.batch, hit.row, it.transaction_status, { source: it.simulated ? 'simulated' : 'paypal' });
        batches.put(hit.batch);
        Object.assign(rec, { owner: hit.batch.owner, batchId: hit.batch.id, ref: hit.row.ref, summary: `Unverified webhook for ${hit.row.ref}; PayPal API reports ${it.transaction_status}` });
        steps.push({ step: 'confirmed', at: at(), detail: `Signature not verified, so the status was read from GET /v1/payments/payouts-item/${hit.row.payout.itemId}: ${it.transaction_status}` });
      } else if (hit) {
        Object.assign(rec, { owner: hit.batch.owner, batchId: hit.batch.id, ref: hit.row.ref, summary: `Unverified webhook for ${hit.row.ref} ignored` });
        steps.push({ step: 'ignored', at: at(), detail: 'Signature not verified and no PayPal item ID to confirm against, so nothing was changed' });
      } else steps.push({ step: 'unmatched', at: at(), detail: 'No local payout matches this item' });
    } else if (ev.event_type.startsWith('PAYMENT.PAYOUTSBATCH.')) {
      // batch webhooks carry no item details: follow up with GET /v1/payments/payouts/{id} to hydrate every item
      const pbId = r.batch_header?.payout_batch_id;
      const b = batches.findPayPalBatch(pbId);
      if (b) {
        await syncBatch(b);
        Object.assign(rec, { owner: b.owner, batchId: b.id, summary: `PayPal batch ${pbId} is ${r.batch_header?.batch_status}; item details fetched` });
        steps.push({ step: 'hydrated', at: at(), detail: `GET /v1/payments/payouts/${pbId}` }, { step: 'updated', at: at() });
      } else steps.push({ step: 'unmatched', at: at(), detail: 'No local batch matches' });
    }
  } catch (e) {
    steps.push({ step: 'error', at: at(), detail: e.message });
  }
  events.save();
  push(rec.owner, 'event', { batchId: rec.batchId });
}));

const port = process.env.PORT || 3100;
app.listen(port, () => console.log(`PayPal on http://localhost:${port}  ·  PayPal ${pp.paypalLive() ? 'sandbox' : 'simulated'}  ·  AI ${llmLive() ? llmModel() : 'templates'}${searchLive() ? ` (fallback ${SEARCH_NAME} PayPal docs search)` : ''}`));
