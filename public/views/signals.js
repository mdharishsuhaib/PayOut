// SIGNALS · Devpost-style feed with filters; selecting an event opens its processing detail.
import { $, $$, esc, api, srcTag, stamp, ago, band } from '../util.js';
import { renderFilters, passes, tally } from '../list.js';
import { SEARCH_ICON } from '../util.js';

const STEPS = [['received', 'Received'], ['verified', 'Signature'], ['recorded', 'Stored'], ['hydrated', 'Hydrated'], ['updated', 'Updated']];
const SRC = { webhook: 'Webhook', paypal: 'PayPal API', simulated: 'Simulated', demo: 'Demo' };
const verifyWord = (v) => (v === 'SUCCESS' ? 'Verified' : v === 'FAILURE' ? 'Failed' : v === 'ERROR' ? 'Error' : 'Unverified');

export async function render(el, app, [evId]) {
  let sel = evId || null, list = [];
  const state = { source: new Set() };
  el.innerHTML = band({ title: 'Signals', lead: 'Every update PayPal sent about your payouts: PayPal API responses and PayPal webhooks, with how each one was checked and applied.',
    facts: app.config.webhookVerification ? '<span class="st ready">PayPal webhooks verified</span>' : '<span class="st review">PayPal webhooks not verified</span>' })
    + `<div class="wrap body"><div class="dp sig">
      <aside class="filters" id="sg-f"></aside>
      <section class="dp-main"><div class="dp-top"><label class="search">${SEARCH_ICON}<input type="search" id="sg-q" placeholder="Search events" aria-label="Search events"></label></div><p class="dp-count" id="sg-n"></p><ol class="feed pane" id="sg-l"></ol></section>
      <aside class="p-side"><div class="side-box sig-d" id="sg-d"></div></aside></div></div>`;

  function feed() {
    const q = $('#sg-q', el).value.trim().toLowerCase();
    renderFilters($('#sg-f', el), [{ key: 'source', label: 'Source', options: Object.entries(tally(list, (e) => e.source)).map(([v, n]) => ({ v, label: SRC[v] || v, n })) }], state, feed);
    const xs = list.filter((e) => passes(state, e, (x, k) => x[k]) && (!q || `${e.type} ${e.summary} ${e.ref || ''}`.toLowerCase().includes(q)));
    $('#sg-n', el).textContent = `Showing ${Math.min(xs.length, 150)} of ${list.length} events`;
    $('#sg-l', el).innerHTML = xs.length ? xs.slice(0, 150).map((e) => `<li><a href="#/signals/${esc(e.id)}" data-id="${esc(e.id)}" aria-current="${e.id === sel}"><span class="when mono">${esc(ago(e.at))}</span>
      <span class="s"><code>${esc(e.type)}</code><br><small class="muted">${esc(e.summary)}</small></span><span class="tags">${srcTag(e.source)}${e.source === 'webhook' ? `<span class="src ${e.verified === 'SUCCESS' ? 'paypal' : 'demo'}">${verifyWord(e.verified)}</span>` : ''}</span></a></li>`).join('')
      : `<li class="empty">${list.length ? 'No events match.' : 'No updates yet. When you send payouts, every PayPal update about them appears here.'}</li>`;
    $$('#sg-l a', el).forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); sel = a.dataset.id; history.replaceState(null, '', `#/signals/${sel}`); feed(); detail(); }));
  }
  function detail() {
    const e = list.find((x) => x.id === sel), box = $('#sg-d', el);
    if (!e) { box.innerHTML = '<p class="muted">Select an event to inspect it.</p>'; return; }
    const isHook = e.source === 'webhook', done = Object.fromEntries((e.steps || []).map((s) => [s.step, s])), it = e.item || {};
    const flow = isHook ? STEPS.map(([k, l]) => {
      const s = done[k], st = !s ? 'idle' : k === 'verified' ? (s.result === 'SUCCESS' ? 'ok' : 'warn') : 'ok';
      return `<li class="${st}"><i></i><div><b>${l}</b><small>${s ? (k === 'verified' ? verifyWord(s.result) : s.detail ? esc(s.detail) : esc(stamp(s.at))) : k === 'hydrated' && !e.type.includes('PAYOUTSBATCH') ? 'Not needed' : '—'}</small></div></li>`;
    }).join('') + (done.unmatched ? `<li class="warn"><i></i><div><b>Unmatched</b><small>${esc(done.unmatched.detail)}</small></div></li>` : '') + (done.error ? `<li class="bad"><i></i><div><b>Error</b><small>${esc(done.error.detail)}</small></div></li>` : '') : '';
    box.innerHTML = `<span class="lbl">Event</span><h3 class="mono" style="font-size:14px;margin:6px 0">${esc(e.type)}</h3><p style="font-size:14px">${esc(e.summary)}</p><div style="margin:10px 0">${srcTag(e.source)}</div>
      ${isHook ? `<span class="lbl">Processing</span><ol class="vflow">${flow}</ol>` : `<p class="note">${e.source === 'demo' ? 'Practice status: set by you in the demo, not by PayPal.' : 'Recorded from a PayPal REST API response, not a webhook.'}</p>`}
      <dl class="kv" style="margin-top:12px"><dt>ID</dt><dd class="mono">${esc(e.id)}</dd><dt>Time</dt><dd>${esc(stamp(e.at))}</dd>${isHook ? `<dt>Signature</dt><dd>${verifyWord(e.verified)}</dd>` : ''}
        ${e.prev ? `<dt>Change</dt><dd class="mono">${esc(e.prev)} → ${esc(e.status)}</dd>` : ''}${it.payout_batch_id ? `<dt>Batch</dt><dd class="mono">${esc(it.payout_batch_id)}</dd>` : ''}
        ${it.payout_item_id ? `<dt>Item</dt><dd class="mono">${esc(it.payout_item_id)}</dd>` : ''}${it.error ? `<dt>Error</dt><dd class="mono" style="color:var(--restricted)">${esc(it.error)}</dd>` : ''}</dl>
      ${e.batchId && e.ref ? `<div class="side-a"><a class="pill ghost sm" href="#/payouts/${esc(e.batchId)}/${esc(e.ref)}">Tracking</a></div>` : ''}`;
    app.setContext(e.batchId && e.ref ? { label: `${e.ref} · ${e.type}`, batchId: e.batchId, ref: e.ref } : null);
  }
  async function load() {
    list = await api('/api/events');
    if (!sel || !list.some((e) => e.id === sel)) sel = list[0]?.id || null;
    feed(); detail();
  }
  $('#sg-q', el).addEventListener('input', feed);
  await load();
  let t;
  return app.on(() => { clearTimeout(t); t = setTimeout(() => load().catch(() => {}), 250); });
}
