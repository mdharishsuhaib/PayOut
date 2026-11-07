// Shared helpers for the console.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers: {} };
  if (opts.body !== undefined) {
    if (typeof opts.body === 'string') { init.headers['Content-Type'] = 'text/csv'; init.body = opts.body; }
    else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  }
  const r = await fetch(path, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

// Read-only data the first page needs. index.html starts these requests before the scripts load (window.__early);
// every caller shares one response, so nothing is fetched twice or one after another.
const memo = new Map();
// the request index.html already started for this path (used once), or a fresh one
export function early(path) {
  const p = window.__early?.[path];
  if (!p) return api(path);
  delete window.__early[path];
  return p.then((r) => r.json().catch(() => ({})).then((d) => { if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`); return d; }), () => api(path));
}
export function cached(path) {
  if (!memo.has(path)) memo.set(path, early(path).catch((e) => { memo.delete(path); throw e; }));
  return memo.get(path);
}

let toastTimer;
export function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${err ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3600);
}

const ST_CLASS = { eligible: 'ready', blocked: 'restricted' };
export const pill = (cls, label) => `<span class="st ${esc(ST_CLASS[cls] || cls)}">${esc(label)}</span>`;
export const DECISION_LABEL = { eligible: 'Ready', review: 'Review', blocked: 'Restricted' };
export const STATUS_LABEL = { SUCCESS: 'Paid', PENDING: 'Pending', UNCLAIMED: 'Unclaimed', ONHOLD: 'Held', BLOCKED: 'Blocked', FAILED: 'Failed', RETURNED: 'Returned', REFUNDED: 'Refunded', REVERSED: 'Reversed', DENIED: 'Denied' };
export const statusPill = (s) => pill(s, STATUS_LABEL[s] || s);
export const srcTag = (s) => `<span class="src ${esc(s)}">${esc({ paypal: 'PayPal', webhook: 'Webhook', demo: 'Demo', simulated: 'Simulated', paypal: 'PayPal' }[s] || s || 'PayPal')}</span>`;
export const docName = (u) => { try { return new URL(u).pathname.split('/').filter(Boolean).pop().replace(/-/g, ' '); } catch { return 'source'; } };
// AI text for display: escaped first, then **bold** becomes bold and bare or 【bracketed】 links become short named links
export const richText = (v) => esc(String(v ?? '').trim())
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/[【[(]?(https?:\/\/[^\s【】<>()[\]]+?)[.,;:]?[】\])]?(?=\s|$|【)/g, (_, u) => { const h = u.replace(/&amp;/g, '&'); return ` <a href="${esc(h)}" target="_blank" rel="noopener">${esc(docName(h))} ↗</a>`; })
  .replace(/\s*\n\s*/g, '<br>');
export const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
export const stamp = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
// count up to a real number (Scan); instant when reduced motion is on
export function countUp(el, to, ms = 520) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !to) { el.textContent = to; return; }
  const t0 = performance.now();
  const f = (t) => { const k = Math.min(1, (t - t0) / ms); el.textContent = Math.round(to * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}
export const ICONS = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  bang: '<svg viewBox="0 0 24 24"><path d="M12 5v9M12 18.5v.5"/></svg>',
  info: '<svg viewBox="0 0 24 24"><path d="M12 11v7M12 6.5v.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
  dash: '<svg viewBox="0 0 24 24"><path d="M7 12h10"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
  sheet: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/></svg>',
  type: '<svg viewBox="0 0 24 24"><path d="M4 7V5h16v2M12 5v14M9 19h6"/></svg>',
  wire: '<svg viewBox="0 0 120 18"><path d="M2 9h112M106 3l8 6-8 6"/></svg>',
};

export const money = (amount, cur) => {
  const n = Number(amount);
  if (amount === '' || amount === null || !Number.isFinite(n)) return `— ${cur || ''}`.trim();
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${cur || ''}`.trim();
};

export const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Devpost-style page band: title, lead line, fact tags, optional tabs
export function band({ title, lead, facts = '', tabs = '' }) {
  return `<section class="band"><div class="wrap"><h1>${esc(title)}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}${facts ? `<div class="facts">${facts}</div>` : ''}${tabs ? `<nav class="tabs" aria-label="${esc(title)}">${tabs}</nav>` : '<div style="height:32px"></div>'}</div></section>`;
}
export const SEARCH_ICON = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';

export function confirmDialog(title, html, yesLabel = 'Confirm', danger = false) {
  const d = $('#confirm');
  $('#confirm-h').textContent = title;
  $('#confirm-body').innerHTML = html;
  $('#confirm-yes').textContent = yesLabel;
  $('#confirm-yes').className = `btn ${danger ? 'danger' : 'primary'}`;
  d.returnValue = '';
  d.showModal();
  return new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true }));
}
