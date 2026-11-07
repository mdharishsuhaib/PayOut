// Log in with PayPal (OpenID Connect, PayPal Sandbox by default).
// The user signs in on paypal.com. This server never sees their PayPal password: PayPal redirects back
// with a one-time code, which is exchanged server-side (client secret never reaches the browser) for the user's profile.
import crypto from 'node:crypto';

const apiBase = () => process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';
// Login is locked to the PayPal Sandbox (test accounts, no real money or real PayPal data).
// Pointing PAYPAL_API_BASE at live PayPal does not switch login to live; that needs PAYPAL_LIVE_LOGIN=1 on purpose.
export const sandboxOnly = () => process.env.PAYPAL_LIVE_LOGIN !== '1';
export const webBase = () => (sandboxOnly() || /sandbox/.test(apiBase()) ? 'https://www.sandbox.paypal.com' : 'https://www.paypal.com');
const loginApiBase = () => (sandboxOnly() ? 'https://api-m.sandbox.paypal.com' : apiBase());
export const loginConfigured = () => !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) && (!sandboxOnly() || /sandbox/.test(apiBase()));
export const SCOPES = 'openid profile email';

export const returnUrl = (req) => process.env.PAYPAL_RETURN_URL || `${req.protocol}://${req.get('x-payout-host') || req.get('host')}/auth/paypal/callback`;
export const signinPage = () => `${webBase()}/signin`; // PayPal's own login page, used when the app's return URL is not registered yet

// PayPal answers an unregistered return URL with its "Sorry about that (invalid client_id or redirect_uri)" page.
// Check it once in a while, so the login button never sends anyone to that error.
const probes = new Map(); // redirectUri -> { ok, at }
export async function loginReady(redirectUri) {
  if (!loginConfigured()) return false;
  const c = probes.get(redirectUri);
  if (c && Date.now() - c.at < (c.ok ? 30 : 5) * 60 * 1000) return c.ok;
  // an older answer is returned at once and refreshed in the background, so no page waits on PayPal
  if (c) { if (!c.pending) { c.pending = true; probe(redirectUri, c.ok).finally(() => { c.pending = false; }); } return c.ok; }
  return probe(redirectUri, false);
}
async function probe(redirectUri, last) {
  let ok = last;
  try {
    const r = await fetch(authorizeUrl({ state: 'probe', redirectUri }), { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    ok = !/invalid client_id or redirect_uri/i.test(await r.text());
  } catch { /* network trouble: keep the last answer */ }
  probes.set(redirectUri, { ok, at: Date.now() });
  return ok;
}

export function authorizeUrl({ state, redirectUri }) {
  const q = new URLSearchParams({ flowEntry: 'static', client_id: process.env.PAYPAL_CLIENT_ID, response_type: 'code', scope: SCOPES, redirect_uri: redirectUri, state });
  return `${webBase()}/signin/authorize?${q}`;
}

export async function exchangeCode(code) {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${loginApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error_description || j.error || `PayPal token exchange failed (${r.status})`), { code: j.error || 'token_failed' });
  return j; // { access_token, refresh_token, id_token, expires_in, scope }
}

export async function userInfo(accessToken) {
  const r = await fetch(`${loginApiBase()}/v1/identity/oauth2/userinfo?schema=paypalv1.1`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error_description || j.message || `PayPal userinfo failed (${r.status})`), { code: 'userinfo_failed' });
  const email = (j.emails || []).find((e) => e.primary)?.value || j.emails?.[0]?.value || j.email || null;
  return {
    id: j.user_id || j.payer_id || j.sub,
    name: j.name || [j.given_name, j.family_name].filter(Boolean).join(' ') || null,
    givenName: j.given_name || null,
    email,
    verified: j.verified_account === true || j.verified_account === 'true',
    country: j.address?.country || null,
    accountType: j.account_type || null,
  };
}

// ---- sessions: random id in an HttpOnly cookie, profile kept server-side ----
const SESSION_MS = 8 * 60 * 60 * 1000;
const sessions = new Map(); // sid -> { user, exp }
const pending = new Map(); // state -> { next, exp }

export const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter(([k]) => k));
const cookie = (name, value, req, maxAgeSec) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${req.secure ? '; Secure' : ''}`;

export function beginLogin(next, tab = false) {
  const state = crypto.randomBytes(24).toString('base64url');
  pending.set(state, { next, tab, exp: Date.now() + 10 * 60 * 1000 });
  return state;
}
export function takeState(state) {
  const p = pending.get(state); pending.delete(state);
  return p && p.exp > Date.now() ? p : null;
}
export function createSession(res, req, user) {
  const sid = crypto.randomBytes(32).toString('base64url');
  sessions.set(sid, { user, exp: Date.now() + SESSION_MS });
  res.setHeader('Set-Cookie', cookie('pp_sid', sid, req, SESSION_MS / 1000));
}
export function currentUser(req) {
  const sid = cookies(req).pp_sid, s = sid && sessions.get(sid);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(sid); return null; }
  return s.user;
}
export function endSession(req, res) {
  const sid = cookies(req).pp_sid; if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', cookie('pp_sid', '', req, 0));
}
