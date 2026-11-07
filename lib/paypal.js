// PayPal Payouts REST client (sandbox by default).
// When no credentials are set, calls are simulated and every response is marked `simulated: true`.
const base = () => process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';
export const paypalLive = () => !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

let token = null;
async function accessToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${base()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`PayPal auth failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000, scope: j.scope || '' };
  return token.value;
}

export class PayPalError extends Error {
  constructor(status, data, path) {
    super(`PayPal ${path} ${status}: ${data?.message || data?.name || 'request failed'}`);
    Object.assign(this, { status, data, name: data?.name || 'PAYPAL_ERROR' });
  }
}

async function call(path, { method = 'GET', body, requestId } = {}) {
  const r = await fetch(`${base()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new PayPalError(r.status, data, path);
  return data;
}

// Go/no-go check: credentials work and the app has the Payouts scope.
export async function checkAccess() {
  if (!paypalLive()) return { live: false, ok: false, reason: 'No PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in .env, so payouts are simulated.' };
  try {
    await accessToken();
    const payouts = /payouts/i.test(token.scope);
    return { live: true, ok: payouts, base: base(), reason: payouts ? 'Sandbox credentials valid, Payouts scope granted.' : 'Credentials valid, but this app has no Payouts scope. Enable Payouts for the app in the PayPal Developer Dashboard.' };
  } catch (e) {
    return { live: true, ok: false, base: base(), reason: e.message };
  }
}

const sim = (p) => p + Math.random().toString(36).slice(2, 12).toUpperCase();
const simStore = new Map(); // payout_batch_id -> items, only used in simulation

const itemBody = (r) => ({
  recipient_type: r.recipientType || 'EMAIL',
  amount: { value: String(r.amount), currency: r.currency },
  receiver: r.receiver,
  note: r.note || 'Payment sent with PayPal',
  sender_item_id: r.ref,
  ...(r.wallet === 'VENMO' ? { recipient_wallet: 'VENMO' } : {}),
});

// POST /v1/payments/payouts
export async function createBatch({ batchId, rows, subject, message }) {
  const body = {
    sender_batch_header: { sender_batch_id: batchId, email_subject: subject || 'You have a payout', email_message: message || 'You received a payout. Thanks for your work.' },
    items: rows.map(itemBody),
  };
  if (!paypalLive()) {
    const id = sim('SIM-');
    simStore.set(id, rows.map((r) => ({ payout_item_id: sim('SIMI-'), transaction_status: 'PENDING', payout_item: itemBody(r) })));
    return { simulated: true, request: body, batch_header: { payout_batch_id: id, batch_status: 'PENDING', sender_batch_header: body.sender_batch_header } };
  }
  const d = await call('/v1/payments/payouts', { method: 'POST', body, requestId: batchId });
  return { ...d, request: body };
}

// GET /v1/payments/payouts/{payout_batch_id}
export async function getBatch(id) {
  if (id.startsWith('SIM-')) {
    const items = (simStore.get(id) || []).map((it) => {
      // simulated settlement: valid sandbox-looking addresses succeed, example.com stays unclaimed
      if (it.transaction_status === 'PENDING') it.transaction_status = /@example\./i.test(it.payout_item.receiver) ? 'UNCLAIMED' : 'SUCCESS';
      return it;
    });
    return { simulated: true, batch_header: { payout_batch_id: id, batch_status: 'SUCCESS' }, items };
  }
  return call(`/v1/payments/payouts/${encodeURIComponent(id)}?fields=batch_header,items&page_size=1000`);
}

// GET /v1/payments/payouts-item/{payout_item_id}
export async function getItem(id) {
  if (id.startsWith('SIMI-')) {
    for (const items of simStore.values()) { const it = items.find((x) => x.payout_item_id === id); if (it) return { simulated: true, ...it }; }
    throw new PayPalError(404, { name: 'INVALID_RESOURCE_ID' }, id);
  }
  return call(`/v1/payments/payouts-item/${encodeURIComponent(id)}`);
}

// POST /v1/payments/payouts-item/{payout_item_id}/cancel  (only allowed while UNCLAIMED)
export async function cancelItem(id) {
  if (id.startsWith('SIMI-')) {
    for (const items of simStore.values()) {
      const it = items.find((x) => x.payout_item_id === id);
      if (it) { it.transaction_status = 'RETURNED'; return { simulated: true, ...it }; }
    }
    throw new PayPalError(404, { name: 'INVALID_RESOURCE_ID' }, id);
  }
  return call(`/v1/payments/payouts-item/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

// POST /v1/notifications/verify-webhook-signature
export async function verifyWebhook(headers, event) {
  if (!paypalLive() || !process.env.PAYPAL_WEBHOOK_ID) return 'UNVERIFIED';
  const d = await call('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: {
      auth_algo: headers['paypal-auth-algo'], cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'], transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'], webhook_id: process.env.PAYPAL_WEBHOOK_ID, webhook_event: event,
    },
  });
  return d.verification_status; // SUCCESS | FAILURE
}
