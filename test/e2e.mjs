// End-to-end test against the real PayPal Sandbox (credentials from .env).
// Runs the actual server in this process with its own data file, and signs in through the app's own
// session code (lib/login.js), so the server has no test-only backdoor.
//   node test/e2e.mjs
import fs from 'node:fs';

process.env.PORT = process.env.E2E_PORT || '3199';
process.env.DATA_FILE = 'data/e2e-store.json';
fs.rmSync(process.env.DATA_FILE, { force: true });

await import('../server.js');
const login = await import('../lib/login.js');
const B = `http://localhost:${process.env.PORT}`;
await new Promise((r) => setTimeout(r, 500));

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = '';
const call = async (p, body, method) => {
  const r = await fetch(B + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
};

// ---- 1. authentication and credential protection ----
console.log('\n# Authentication');
check((await call('/api/batches')).status === 401, 'workspace API refuses signed-out requests');
check((await call('/api/payouts')).status === 401, 'payout list refuses signed-out requests');
const cfg = await call('/api/config');
const raw = JSON.stringify(cfg.data);
check(!raw.includes(process.env.PAYPAL_CLIENT_SECRET) && !raw.includes(process.env.PAYPAL_CLIENT_ID), 'public config does not expose PayPal client ID or secret');
check(cfg.data.paypal.ok === true, 'PayPal Sandbox credentials valid with Payouts scope', cfg.data.paypal.reason);
const shown = (await fetch(`${B}/app.js`).then((r) => r.text())) + (await fetch(`${B}/index.html`).then((r) => r.text()));
check(!shown.includes(process.env.PAYPAL_CLIENT_SECRET), 'browser files do not contain the client secret');

const fakeRes = { setHeader: (_k, v) => { cookie = v.split(';')[0]; } };
login.createSession(fakeRes, { secure: false }, { name: 'E2E Tester', email: 'e2e@example.com' });
check((await call('/api/batches')).status === 200, 'signed-in session can use the workspace API');

// ---- 2. preflight: duplicates, restrictions, currency rules ----
console.log('\n# Preflight');
let b = (await call('/api/batches/sample', {})).data;
const row = (ref) => b.rows.find((r) => r.ref === ref);
const codes = (ref) => row(ref).findings.map((f) => f.code);
check(codes('PG-1006').includes('POSSIBLE_DUPLICATE') && row('PG-1006').decision === 'review', 'repeated payment to the same recipient is held for review (PG-1006)');
check(row('PG-1006').approved === false, 'possible duplicate is not approved automatically');
check(row('PG-1005').decision === 'blocked', 'INR payout is blocked (PG-1005)', codes('PG-1005').filter((c) => !/_OK$/.test(c)).join(', '));
check(row('PG-1008').decision === 'blocked' && codes('PG-1008').includes('NO_DECIMALS'), 'JPY with decimals is blocked (PG-1008)');
check(row('PG-1011').decision === 'blocked' && codes('PG-1011').includes('RECEIVER_MISSING'), 'missing recipient is blocked (PG-1011)');
check(row('PG-1004').decision === 'review', 'EUR to India needs confirmation (PG-1004)', codes('PG-1004').filter((c) => !/_OK$/.test(c)).join(', '));
const india = (await call('/api/route/check', { from: 'IN', to: 'US', currency: 'USD' })).data;
check(india.decision === 'blocked' && india.findings.some((f) => f.code === 'SENDER_RECEIVE_ONLY'), 'India as a sending country is blocked (Receive and withdraw)');

b = (await call(`/api/batches/${b.id}/rows/PG-1004`, { acknowledged: true }, 'PATCH')).data;
const willSend = b.rows.filter((r) => r.approved && r.decision !== 'blocked');
const curs = [...new Set(willSend.map((r) => r.currency))].sort();
console.log(`      approved to send: ${willSend.map((r) => `${r.ref} ${r.currency}`).join(', ')}`);

// ---- 3. real sandbox payout creation and currency split ----
console.log('\n# Sandbox payout');
const sub = await call(`/api/batches/${b.id}/submit`, {});
check(sub.status === 200, 'batch submitted to PayPal', sub.status !== 200 ? JSON.stringify(sub.data).slice(0, 200) : '');
b = sub.data;
const pbs = b.payout?.batches || [];
check(pbs.length === curs.length && pbs.map((p) => p.currency).sort().join() === curs.join(), `one PayPal batch per currency (${curs.join(', ')})`, pbs.map((p) => `${p.currency}=${p.id}`).join(' '));
check(pbs.every((p) => p.simulated === false && !p.id.startsWith('SIM-')), 'every batch is a real PayPal Sandbox batch, not simulated');
check(!b.rows.some((r) => r.payout && ['PG-1005', 'PG-1006', 'PG-1008', 'PG-1011'].includes(r.ref)), 'blocked and unconfirmed rows were not sent');
const again = await call(`/api/batches/${b.id}/submit`, {});
check(again.status === 409, 'submitting the same batch twice is refused (no double payment)');

// ---- 4. batch retrieval and item status ----
console.log('\n# Status from PayPal');
for (let i = 0; i < 12; i++) {
  b = (await call(`/api/batches/${b.id}/sync`, {})).data;
  if (!b.rows.some((r) => r.payout && (r.payout.status === 'PENDING' || !r.payout.itemId))) break;
  await sleep(5000);
}
const sent = b.rows.filter((r) => r.payout);
for (const r of sent) console.log(`      ${r.ref} ${r.currency} ${r.payout.status.padEnd(9)} item ${r.payout.itemId}${r.payout.error ? ` error ${r.payout.error}` : ''}`);
check(sent.every((r) => r.payout.itemId), 'batch retrieval returned a PayPal item ID for every sent row');
const first = sent[0];
const rec = await call(`/api/batches/${b.id}/rows/${first.ref}/recovery`);
check(rec.status === 200 && rec.data.status === b.rows.find((r) => r.ref === first.ref).payout.status, `individual item status retrieved from PayPal (${first.ref} ${rec.data.status})`);

// ---- 5. webhooks: unverified events are not trusted, duplicates are processed once ----
console.log('\n# Webhooks');
check(cfg.data.webhookVerification === !!process.env.PAYPAL_WEBHOOK_ID, `signature verification ${process.env.PAYPAL_WEBHOOK_ID ? 'enabled' : 'not configured (PAYPAL_WEBHOOK_ID empty)'}`);
const target = sent.find((r) => r.payout.status !== 'SUCCESS') || first;
const before = target.payout.status;
const evId = `WH-E2E-${Date.now()}`;
const forged = { id: evId, event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', resource: { payout_item_id: target.payout.itemId, transaction_status: 'SUCCESS' } };
const w1 = await call('/api/webhooks/paypal', forged);
check(w1.status === 200 && w1.data.verified !== 'SUCCESS', `unsigned event accepted for review only (verified=${w1.data.verified})`);
await sleep(3000);
b = (await call(`/api/batches/${b.id}`)).data;
const after = b.rows.find((r) => r.ref === target.ref).payout.status;
const live = (await call(`/api/batches/${b.id}/rows/${target.ref}/recovery`)).data.status;
check(after === live, `unsigned "SUCCEEDED" did not override PayPal: ${target.ref} ${before} -> ${after}, PayPal API says ${live}`);
const evs = (await call('/api/events')).data;
const logged = evs.find((e) => e.id === evId);
check(logged && logged.steps.some((s) => s.step === 'confirmed'), 'unsigned event was confirmed against GET payouts-item', logged?.steps.map((s) => s.step).join(' > '));
const w2 = await call('/api/webhooks/paypal', forged);
check(w2.data.duplicate === true && evs.filter((e) => e.id === evId).length === 1, 'repeated event ID is processed once');
check((await call('/api/webhooks/paypal', { hello: 1 })).status === 400, 'non-PayPal body is rejected');

// ---- 6. unclaimed cancellation ----
console.log('\n# Unclaimed cancellation');
const un = b.rows.find((r) => r.payout?.status === 'UNCLAIMED');
if (!un) check(false, 'an UNCLAIMED item to cancel', 'none in this run');
else {
  const r0 = (await call(`/api/batches/${b.id}/rows/${un.ref}/recovery`)).data;
  check(r0.canCancel === true, `${un.ref} is UNCLAIMED and offered for cancellation`);
  check((await call(`/api/batches/${b.id}/rows/${un.ref}/cancel`, {})).status === 400, 'cancel without explicit confirmation is refused');
  const c = await call(`/api/batches/${b.id}/rows/${un.ref}/cancel`, { confirm: true });
  if (c.status === 200) check(['RETURNED', 'REFUNDED'].includes(c.data.rows.find((r) => r.ref === un.ref).payout.status), `${un.ref} cancelled by PayPal, funds returned`);
  else check(c.status === 502 && /did not cancel|internal error/i.test(c.data.error), `PayPal refused the cancel; reported plainly, status left unchanged`, c.data.error.slice(0, 160));
  const stillPaid = (await call(`/api/batches/${b.id}`)).data.rows.find((r) => r.ref === un.ref).payout.status;
  check(c.status === 200 || stillPaid === 'UNCLAIMED', `local status matches PayPal after the attempt (${stillPaid})`);
}

// ---- 7. explanations against real PayPal responses ----
console.log('\n# Explanations');
check(cfg.data.ai.live, `AI model connected`, cfg.data.ai.live ? cfg.data.ai.model : 'AI_API_KEY empty: explanations use the built-in PayPal playbook text');
for (const r of sent.filter((x) => x.payout.status !== 'SUCCESS').slice(0, 2)) {
  const e = (await call(`/api/batches/${b.id}/rows/${r.ref}/recovery`)).data;
  check(e.playbook?.status === e.status && e.text?.length > 20, `explanation matches PayPal status ${e.status} for ${r.ref}`, e.text.slice(0, 120));
}
const ask = (await call('/api/route/ask', { question: 'Can an Indian business send PayPal payouts?' })).data;
check(/receive|can.?t|cannot|not/i.test(ask.answer || ''), 'route question answered from the published rules', (ask.answer || '').slice(0, 120));

console.log(`\n${pass} passed, ${fail} failed`);
await sleep(300);
fs.rmSync(process.env.DATA_FILE, { force: true });
process.exit(fail ? 1 : 0);
