// PayPal shell: router, health strip, contextual Ask, live updates (Trace).
import { $, $$, esc, api, toast, time, docName, cached, early } from './util.js';
import * as home from './views/home.js';
import * as routes from './views/routes.js';
import * as preflight from './views/preflight.js';
import * as payouts from './views/payouts.js';
import * as signals from './views/signals.js';
import * as resolve from './views/resolve.js';
import * as rules from './views/rules.js';
import * as auth from './views/auth.js';

const VIEWS = {
  home: { mod: home, sub: 'What is happening to my payouts right now' },
  routes: { mod: routes, sub: 'Inspect one international route' },
  preflight: { mod: preflight, sub: 'Check a batch before money moves' },
  payouts: { mod: payouts, sub: 'Everything sent to PayPal' },
  signals: { mod: signals, sub: 'PayPal webhooks and system events' },
  resolve: { mod: resolve, sub: 'Failed, blocked and unclaimed payouts' },
  rules: { mod: rules, sub: 'Published country and currency policy' },
  login: { mod: auth, sub: 'Log in' },
  signup: { mod: auth, sub: 'Sign up' },
};
const PUBLIC = new Set(['home', 'login', 'signup']);
const TITLE = (k) => (k === 'payouts' ? 'Tracking' : k === 'preflight' ? 'Verify' : k[0].toUpperCase() + k.slice(1));

export const app = { config: null, countries: {}, countryList: [], current: null, listeners: new Set(), lastSync: null, context: null };
app.go = (hash) => { location.hash = hash; };
app.on = (fn) => { app.listeners.add(fn); return () => app.listeners.delete(fn); };

// ---- router ----
let cleanup = null;
async function router() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'ask') { openAsk(); history.replaceState(null, '', `#/${app.current || 'home'}`); if (app.current) return; }
  const key = VIEWS[name] ? name : 'home';
  // every tool except Home needs a signed-in (demo) session; visitors go to Login and come back after
  if (!app.signedIn() && !PUBLIC.has(key)) { location.replace(`#/login/${key}`); return; }
  // Home is the public page only; once logged in, the tools start at Preflight
  if (app.signedIn() && (key === 'home' || key === 'login' || key === 'signup')) { location.replace(`#/${VIEWS[rest[0]] && !PUBLIC.has(rest[0]) ? rest[0] : 'preflight'}`); return; }
  const v = VIEWS[key];
  $$('#nav a[data-view]').forEach((a) => (a.dataset.view === key ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  closeDrawer();
  document.title = `PayOut · ${key === 'login' ? 'Log in' : key === 'signup' ? 'Sign up' : TITLE(key)}`;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const el = $('#view');
  if (app.current !== key) app.setContext(null);
  app.current = key;
  el.className = `view v-${key}`;
  el.innerHTML = '';
  // each navigation renders into its own host, so a slow response from the previous page lands in a detached node
  const host = document.createElement('div');
  host.style.minHeight = '100vh'; // holds the footer below the fold until the page has drawn
  el.append(host);
  window.scrollTo(0, 0);
  const args = v.mod === auth ? [key, rest[0]] : rest.map(decodeURIComponent);
  try { cleanup = (await v.mod.render(host, app, args)) || null; }
  catch (e) { host.innerHTML = `<div class="wrap body"><div class="err-box">${esc(e.message)}</div></div>`; }
  host.style.minHeight = '';
  el.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// ---- session: Log in with PayPal. The server holds the session; the browser only learns who is signed in ----
app.user = null; app.auth = null;
app.signedIn = () => !!app.user;
function applySession() {
  const on = app.signedIn();
  document.body.classList.toggle('signed-in', on);
  $('#side').hidden = !on; $('#burger').hidden = !on; if (!on) closeDrawer();
  $('#login').hidden = on; $('#signup').hidden = on; $('#logout').hidden = !on;
  const tag = $('#user-tag'); tag.hidden = !on; tag.classList.toggle('demo', !!app.user?.demo);
  if (on) { tag.textContent = app.user.demo ? 'Judge' : app.user.givenName || app.user.name || app.user.email || 'PayPal user'; tag.title = app.user.demo ? 'Demo session · no PayPal login, PayPal Sandbox only' : `Signed in with PayPal${app.user.email ? ` as ${app.user.email}` : ''}`; }
  renderTry(); // signed-in users also get questions about their own payouts
}
async function loadMe(first) {
  try { app.auth = await (first ? early('/api/me') : api('/api/me')); app.user = app.auth.user; } catch { app.auth = null; app.user = null; }
  applySession();
}
// Demo for judges: a labelled session with no PayPal login, on PayOut's PayPal Sandbox account
app.startDemo = async (next) => {
  const r = await api('/auth/demo', { body: { next, page: app.current } });
  await loadMe(); startStream(); refreshCases();
  toast('Demo started · PayPal Sandbox, no real money');
  location.hash = `#/${r.next || 'preflight'}`;
  router();
};
app.toast = toast;
async function signOut() {
  await api('/auth/logout', { body: {} }).catch(() => {});
  app.user = null; applySession(); closeAsk(); stopStream();
  app.go('#/home'); router(); toast('Logged out');
}

// ---- header status removed from the UI; keep sync time for views ----
function renderHealth() {}
app.synced = () => { app.lastSync = new Date().toISOString(); renderHealth(); };

async function refreshCases() {
  if (!app.signedIn()) { $('#nav-n').hidden = true; return; }
  try { const o = await api('/api/overview'); const n = o.counts.exceptions, b = $('#nav-n'); b.hidden = !n; b.textContent = n; } catch { /* ignore */ }
}
app.refreshCases = refreshCases;

// ---- Ask: knows what is selected ----
const TRY = {
  row: ['Why did this stop?', 'What should I do next?', 'Write a note to the recipient'],
  route: ['Explain this route', 'Which currency should I use?', 'What would make it pass?'],
};
let LIB = null, topic = null; // question library from /api/ask/library; topic = open category
const qBtn = (q) => `<button type="button" class="q-s">${esc(q)}</button>`;
function renderTry() {
  const ctx = app.context, box = $('#ask-try');
  let html;
  if (ctx) html = `<p class="ask-sub">About ${esc(ctx.label)}</p>${TRY[ctx.route ? 'route' : 'row'].map(qBtn).join('')}`;
  else if (!LIB) html = '';
  else if (topic) {
    const t = LIB.topics.find((x) => x.id === topic);
    html = `<button type="button" class="ask-back" id="ask-back">← All topics</button><p class="ask-sub">${esc(t.label)} · ${esc(t.hint)}</p>${t.questions.map(qBtn).join('')}`;
  } else {
    html = `<p class="ask-sub">Suggested</p>${LIB.suggested.map(qBtn).join('')}
      ${app.signedIn() ? `<p class="ask-sub">About your payouts</p>${LIB.workspace.map(qBtn).join('')}` : ''}
      <p class="ask-sub">Topics</p><div class="ask-topics">${LIB.topics.map((t) => `<button type="button" data-topic="${esc(t.id)}"><b>${esc(t.label)}</b><span>${esc(t.hint)}</span></button>`).join('')}</div>`;
  }
  box.innerHTML = html;
  // choosing a question fills the box so it can be edited or sent
  $$('.q-s', box).forEach((b) => b.addEventListener('click', () => { const i = $('#ask-q'); i.value = b.textContent; i.focus(); }));
  $$('[data-topic]', box).forEach((b) => b.addEventListener('click', () => { topic = b.dataset.topic; renderTry(); }));
  $('#ask-back', box)?.addEventListener('click', () => { topic = null; renderTry(); });
}
app.setContext = (ctx) => {
  app.context = ctx; topic = null;
  const c = $('#ask-ctx'); if (c) { c.textContent = ctx ? ctx.label : ''; c.title = ctx ? ctx.label : ''; }
  renderTry();
};
function openAsk(q) {
  $('#ask').hidden = false; placeAsk();
  $('#ppfab').setAttribute('aria-expanded', 'true'); $('#ppfab').classList.add('on');
  if (q) ask(q); else $('#ask-q').focus({ preventScroll: true });
}
function closeAsk() { $('#ask').hidden = true; $('#ppfab').setAttribute('aria-expanded', 'false'); $('#ppfab').classList.remove('on'); }
app.ask = openAsk;

// ---- PayPal AI launcher: movable anywhere, remembers its spot, the AI box opens beside it ----
const fab = $('#ppfab'), FAB_KEY = 'paypal.ai.fab', GAP = 12;
const clampFab = (x, y) => {
  const s = fab.offsetWidth || 64, W = document.documentElement.clientWidth, H = window.innerHeight;
  return [Math.min(Math.max(GAP, x), W - s - GAP), Math.min(Math.max(GAP, y), H - s - GAP)];
};
function setFab(x, y, save) {
  [x, y] = clampFab(x, y);
  fab.style.left = `${x}px`; fab.style.top = `${y}px`;
  if (save) localStorage.setItem(FAB_KEY, JSON.stringify({ rx: x / document.documentElement.clientWidth, ry: y / window.innerHeight }));
  if (!$('#ask').hidden) placeAsk();
  clearFab();
}
// the sticky Send bar sits at the bottom of the screen; if the launcher is parked there, the bar makes room for it
function clearFab() {
  const bar = $('.approve'); if (!bar) return;
  bar.style.marginLeft = bar.style.marginRight = '';
  const f = fab.getBoundingClientRect(), H = window.innerHeight, box = bar.parentElement.getBoundingClientRect();
  if (f.bottom < H - 160) return; // launcher is not in the bar's strip
  if (f.left + f.width / 2 > (box.left + box.right) / 2) bar.style.marginRight = `${Math.max(0, box.right - f.left + 8)}px`;
  else bar.style.marginLeft = `${Math.max(0, f.right - box.left + 8)}px`;
}
app.clearFab = clearFab;
function homeFab() {
  const s = fab.offsetWidth || 64;
  let p = null; try { p = JSON.parse(localStorage.getItem(FAB_KEY)); } catch { /* ignore */ }
  if (p && Number.isFinite(p.rx)) setFab(p.rx * document.documentElement.clientWidth, p.ry * window.innerHeight);
  else setFab(document.documentElement.clientWidth - s - 24, window.innerHeight - s - 24); // default: bottom right
}
// the box opens on whichever side has room: left/right of centre decides alignment, top/bottom half decides above/below
function placeAsk() {
  const box = $('#ask'), f = fab.getBoundingClientRect(), W = document.documentElement.clientWidth, H = window.innerHeight;
  const above = f.top + f.height / 2 > H / 2, room = above ? f.top - 2 * GAP : H - f.bottom - 2 * GAP;
  const bw = Math.min(400, W - 2 * GAP), h = Math.max(Math.min(620, room), Math.min(320, H - 2 * GAP));
  box.style.width = `${bw}px`; box.style.height = `${h}px`;
  let x = f.left + f.width / 2 > W / 2 ? f.right - bw : f.left;
  let y = above ? f.top - h - GAP : f.bottom + GAP;
  x = Math.min(Math.max(GAP, x), W - bw - GAP); y = Math.min(Math.max(GAP, y), H - h - GAP);
  box.style.left = `${x}px`; box.style.top = `${y}px`;
}
let drag = null;
fab.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const r = fab.getBoundingClientRect();
  drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
  fab.setPointerCapture(e.pointerId);
});
fab.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
  drag.moved = true; fab.classList.add('dragging');
  setFab(e.clientX - drag.dx, e.clientY - drag.dy, false);
});
const endDrag = (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  fab.classList.remove('dragging');
  if (drag.moved) { setFab(parseFloat(fab.style.left), parseFloat(fab.style.top), true); fab.dataset.justDragged = '1'; }
  drag = null;
};
fab.addEventListener('pointerup', endDrag);
fab.addEventListener('pointercancel', endDrag);
fab.addEventListener('click', () => {
  if (fab.dataset.justDragged) { delete fab.dataset.justDragged; return; }
  $('#ask').hidden ? openAsk() : closeAsk();
});
fab.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 80 : 20, m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!m) return;
  e.preventDefault();
  setFab(parseFloat(fab.style.left) + m[0], parseFloat(fab.style.top) + m[1], true);
});
window.addEventListener('resize', homeFab);
homeFab();

const links = (xs) => (xs || []).map((s) => `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(docName(s))} ↗</a>`).join('<br>');
async function ask(q) {
  // once a conversation starts, the suggestion list steps aside so the answer is in view
  $('#ask-b').classList.add('chatting');
  const box = $('#thread-q');
  box.insertAdjacentHTML('beforeend', `<div class="q">${esc(q)}</div>`);
  const a = document.createElement('div');
  a.className = 'a';
  a.innerHTML = '<section><div class="skeleton" style="width:70%"></div><div class="skeleton" style="width:45%;margin-top:8px"></div></section>';
  box.append(a); a.scrollIntoView({ block: 'end', behavior: 'smooth' });
  const c = app.context;
  try {
    const x = await api('/api/ask', { body: { question: q, context: c ? { batchId: c.batchId, ref: c.ref, route: c.route } : null } });
    const L = x.layers || {};
    a.innerHTML = `
      ${c ? `<section><span class="lbl">Context</span>${esc(c.label)}</section>` : ''}
      ${L.fact ? `<section class="fact"><span class="lbl">${x.kind === 'workspace' ? 'PayPal · your payouts' : 'PayPal · response'}</span>${esc(L.fact)}</section>` : ''}
      ${L.note ? `<section class="note"><span class="lbl">No open payout</span>${esc(L.note)}</section>` : ''}
      ${L.policy ? `<section class="policy"><span class="lbl">Rules · published policy</span>${esc(L.policy)}</section>` : ''}
      ${L.suggestion ? `<section class="ai"><span class="lbl">${x.ai ? `AI · suggestion (${esc(x.model || app.config.ai.model || 'LLM')})` : 'Playbook · suggestion'}</span>${esc(L.suggestion)}</section>` : ''}
      ${L.search ? `<section class="ai"><span class="lbl">${esc(L.searchVia || 'Search')} · PayPal docs search</span>${esc(L.search)}</section>` : ''}
      ${(L.sources || []).length ? `<section><span class="lbl">Source</span>${links(L.sources)}</section>` : ''}`;
  } catch (e) { a.innerHTML = `<section class="err-box">${esc(e.message)}</section>`; }
  a.scrollIntoView({ block: 'end', behavior: 'smooth' });
}
// Left sidebar (PayPal Developer Dashboard style). Wide screens: the « chevron (or ☰) shrinks it to an icon rail and
// back, and the choice is remembered. Narrower screens: a drawer that slides over the page and closes after a pick.
const wide = matchMedia('(min-width: 1101px)');
const syncBurger = () => {
  const mini = document.body.classList.contains('side-mini');
  $('#burger').setAttribute('aria-expanded', wide.matches ? !mini : document.body.classList.contains('side-open'));
  // the sidebar edge says what a double-click will do: open the icon rail, or shrink the open sidebar back to it
  const grip = $('#side-grip'), tip = mini ? 'Double-click to expand' : 'Double-click to hide';
  grip.title = tip; grip.setAttribute('aria-label', `${tip}. Drag or use the arrow keys to resize the sidebar.`);
};
function closeDrawer() { document.body.classList.remove('side-open'); $('#side-dim').hidden = true; syncBurger(); }
try { if (['mini', 'closed'].includes(localStorage.getItem('payout.side'))) document.body.classList.add('side-mini'); } catch { /* storage off */ }
function toggleSide() {
  if (wide.matches) {
    const mini = document.body.classList.toggle('side-mini');
    try { localStorage.setItem('payout.side', mini ? 'mini' : 'open'); } catch { /* storage off */ }
  } else {
    const open = document.body.classList.toggle('side-open'); $('#side-dim').hidden = !open;
    if (open) $('#side a[aria-current=page], #side a')?.focus();
  }
  syncBurger();
}
$('#burger').addEventListener('click', toggleSide);
$('#side-ai').addEventListener('click', () => { closeDrawer(); app.ask(); });
$('#side-dim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('side-open')) { closeDrawer(); $('#burger').focus(); } });
wide.addEventListener('change', () => { closeDrawer(); syncBurger(); });
syncBurger();
// Drag the sidebar's right edge to resize it (232–360px, so no label is ever cut off). Dragging below 150px snaps it to the icon rail; dragging the
// rail back out opens it again. Double-click the edge to hide it to the rail or expand it back; ←/→ on the focused edge resize from the keyboard.
{
  const MIN = 232, MAX = 360, SNAP = 150, root = document.documentElement, grip = $('#side-grip');
  const setW = (w) => { root.style.setProperty('--side-full', `${w}px`); grip.setAttribute('aria-valuenow', w); };
  const save = () => { try { localStorage.setItem('payout.sideW', parseInt(getComputedStyle(root).getPropertyValue('--side-full'), 10)); localStorage.setItem('payout.side', document.body.classList.contains('side-mini') ? 'mini' : 'open'); } catch { /* storage off */ } };
  grip.setAttribute('aria-valuemin', MIN); grip.setAttribute('aria-valuemax', MAX);
  try { const w = +localStorage.getItem('payout.sideW'); if (w >= MIN && w <= MAX) setW(w); else setW(248); } catch { setW(248); }
  grip.addEventListener('pointerdown', (e) => {
    if (!wide.matches || e.button !== 0) return;
    e.preventDefault(); grip.setPointerCapture(e.pointerId); document.body.classList.add('side-dragging');
    const move = (ev) => {
      const x = ev.clientX, mini = document.body.classList.contains('side-mini');
      if (x < SNAP) { if (!mini) { document.body.classList.add('side-mini'); syncBurger(); } return; }
      if (mini) { document.body.classList.remove('side-mini'); syncBurger(); }
      setW(Math.round(Math.min(MAX, Math.max(MIN, x))));
    };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      document.body.classList.remove('side-dragging'); save(); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => { if (wide.matches) toggleSide(); });
  grip.addEventListener('keydown', (e) => {
    if (!wide.matches || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const mini = document.body.classList.contains('side-mini'), w = parseInt(getComputedStyle(root).getPropertyValue('--side-full'), 10);
    if (e.key === 'ArrowRight') { if (mini) document.body.classList.remove('side-mini'); else setW(Math.min(MAX, w + 16)); }
    else if (!mini) { if (w - 16 < MIN) document.body.classList.add('side-mini'); else setW(w - 16); }
    syncBurger(); save();
  });
}
$('#logout').addEventListener('click', signOut);
$('#ask-close').addEventListener('click', closeAsk);
$('#ask-more').addEventListener('click', () => { $('#ask-b').classList.remove('chatting'); $('#thread-q').innerHTML = ''; topic = null; renderTry(); $('#ask-b').scrollTop = 0; });
$('#ask-f').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#ask-q').value.trim(); if (q) { $('#ask-q').value = ''; ask(q); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#ask').hidden && !$('#confirm').open) closeAsk(); });

// ---- live updates: server-sent events drive Trace (only while signed in) ----
let es = null;
const fire = (type) => (m) => { const d = JSON.parse(m.data); for (const fn of app.listeners) fn(type, d); refreshCases(); };
function startStream() { if (es || !app.signedIn()) return; es = new EventSource('/api/stream'); ['item', 'batch', 'event'].forEach((t) => es.addEventListener(t, fire(t))); }
function stopStream() { if (es) { es.close(); es = null; } }

// ---- boot ----
(async () => {
  // all first-page requests run at once (index.html already started them); the session check no longer waits for config
  const me = loadMe(true);
  cached('/api/currencies').catch(() => {});
  const [config, countries] = await Promise.all([cached('/api/config'), cached('/api/countries')]);
  app.config = config;
  app.countryList = countries;
  app.countries = Object.fromEntries(countries.map((c) => [c.code, c]));
  renderHealth();
  const d = config.docs;
  const setHref = (s, v) => { const n = $(s); if (n && v) n.href = v; };
  setHref('#f-countries', d.countries); setHref('#f-currencies', d.currencies); setHref('#f-api', d.api); setHref('#f-hooks', d.webhooks);
  $('#f-ver').textContent = config.rulesVersion.replace(/^PayPal docs as of /, '');
  if (!localStorage.getItem('paypal.geo')) $('#geo').hidden = false;
  $('#geo-x').addEventListener('click', () => { $('#geo').hidden = true; localStorage.setItem('paypal.geo', '1'); homeFab(); });
  $('#geo-go').addEventListener('click', () => { $('#geo').hidden = true; localStorage.setItem('paypal.geo', '1'); });
  app.setContext(null);
  cached('/api/ask/library').then((l) => { LIB = l; renderTry(); }).catch(() => {});
  await me;
  renderTry();
  startStream();
  refreshCases();
  window.addEventListener('hashchange', router);
  // Login with PayPal runs in its own tab; when it finishes there, this tab picks up the new session
  const signedInElsewhere = async (next) => {
    const was = app.signedIn(); await loadMe();
    if (!was && app.signedIn()) { startStream(); refreshCases(); toast('Logged in with PayPal'); location.hash = `#/${next || 'preflight'}`; router(); }
  };
  try {
    new BroadcastChannel('payout-auth').onmessage = (e) => {
      if (e.data?.type !== 'payout-auth') return;
      if (e.data.ok) signedInElsewhere(e.data.next);
      else if (e.data.error) toast(`PayPal login did not finish (${e.data.error})`, true);
    };
  } catch { /* old browsers: the focus check below still catches it */ }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !app.signedIn() && ['login', 'signup'].includes(app.current)) signedInElsewhere(); });
  router();
})().catch((e) => toast(e.message, true));
