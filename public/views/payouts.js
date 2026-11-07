// PAYOUTS · Devpost-style list (filters + rich cards) and a detail page per payout.
import { $, esc, api, toast, money, statusPill, srcTag, stamp, STATUS_LABEL, band } from '../util.js';
import { mountThread } from '../thread.js';
import { listShell, renderFilters, passes, tally } from '../list.js';

const isOpen = (s) => !['SUCCESS', 'PENDING'].includes(s);
const tone = (s) => (s === 'SUCCESS' ? 'ready' : s === 'PENDING' ? 'pending' : ['FAILED', 'BLOCKED', 'DENIED', 'REVERSED'].includes(s) ? 'restricted' : 'review');

export async function render(el, app, [bId, ref]) {
  if (bId && ref) return detail(el, app, bId, ref);
  const rows = (await api('/api/payouts')).sort((a, b) => Date.parse(b.submittedAt || 0) - Date.parse(a.submittedAt || 0));
  const t = tally(rows, (p) => p.status);
  el.innerHTML = band({ title: 'Tracking', lead: 'Follow every payout you have sent, with the live status PayPal reports for each one.',
    facts: `<span class="tag navy">${rows.length} sent</span>${Object.entries(t).map(([s, n]) => statusPill(s).replace('</span>', ` · ${n}</span>`)).join('')}` })
    + listShell({ id: 'po', placeholder: 'Search name, reference, item ID', sortOptions: [['new', 'Newest'], ['amount', 'Amount'], ['status', 'Status']],
      tools: '<button type="button" class="pill ghost dp-tool" id="export"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/></svg>Export</button>' })
  const state = { status: new Set(), country: new Set(), source: new Set() };
  const get = (p, k) => (k === 'source' ? (p.demo ? 'demo' : 'paypal') : p[k]);
  const draw = () => {
    const q = $('#po-q', el).value.trim().toLowerCase(), sort = $('#po-s', el).value;
    renderFilters($('#po-f', el), [
      { key: 'status', label: 'Status', options: Object.entries(t).map(([v, n]) => ({ v, label: STATUS_LABEL[v] || v, n })) },
      { key: 'country', label: 'Country', options: Object.entries(tally(rows, (p) => p.country)).map(([v, n]) => ({ v, label: app.countries[v]?.name || v, n })) },
      { key: 'source', label: 'Source', options: Object.entries(tally(rows, (p) => (p.demo ? 'demo' : 'paypal'))).map(([v, n]) => ({ v, label: v === 'demo' ? 'Demo' : 'PayPal', n })) },
    ], state, draw);
    let xs = rows.filter((p) => passes(state, p, get) && (!q || `${p.ref} ${p.name} ${p.receiver} ${p.itemId || ''} ${p.payoutBatchId || ''}`.toLowerCase().includes(q)));
    if (sort === 'amount') xs = [...xs].sort((a, b) => Number(b.amount) - Number(a.amount));
    if (sort === 'status') xs = [...xs].sort((a, b) => Number(isOpen(b.status)) - Number(isOpen(a.status)));
    $('#po-n', el).textContent = `Showing ${xs.length} of ${rows.length} payouts`;
    $('#po-l', el).innerHTML = xs.length ? xs.map((p) => `
      <a class="rcard" href="#/payouts/${esc(p.batchId)}/${esc(p.ref)}"><i class="edge ${tone(p.status)}"></i>
        <div class="rc-m"><b>${esc(p.name || p.receiver)}</b><small>${esc(p.receiver)} · ${esc(p.batchName)}</small>
          <div class="rc-t">${statusPill(p.status)}<span class="tag grey">${esc(app.countries[p.country]?.name || p.country)}</span>${p.status === 'UNCLAIMED' ? `<span class="tag">${Math.max(0, 30 - p.ageDays)} days left</span>` : ''}${p.demo ? '<span class="st demo">Demo</span>' : ''}</div></div>
        <div class="rc-r"><b class="mono">${esc(money(p.amount, p.currency))}</b><small class="mono">${esc(p.itemId || p.ref)}</small></div></a>`).join('')
      : `<div class="pane empty">${rows.length ? 'No payouts match these filters.' : 'Nothing sent yet. Approve rows in Verify and press Send.'}</div>`;
  };
  $('#po-q', el).addEventListener('input', draw);
  $('#po-s', el).addEventListener('change', draw);
  $('#export', el).addEventListener('click', () => {
    const head = ['ref', 'name', 'receiver', 'country', 'currency', 'amount', 'status', 'payout_batch_id', 'payout_item_id', 'error', 'demo'];
    const csv = [head.join(','), ...rows.map((p) => [p.ref, p.name, p.receiver, p.country, p.currency, p.amount, p.status, p.payoutBatchId, p.itemId, p.error, !!p.demo].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'paypal-payouts.csv'; a.click();
  });
  draw();
  return app.on(() => {});
}

// Devpost project-page layout: band with tabs, main column + sidebar
async function detail(el, app, bId, ref) {
  let tab = 'overview';
  const load = async () => {
    const [all, batch, evs] = await Promise.all([api('/api/payouts'), api(`/api/batches/${bId}`), api(`/api/events?batch=${encodeURIComponent(bId)}`)]);
    const p = all.find((x) => x.batchId === bId && x.ref === ref);
    if (!p) { el.innerHTML = band({ title: 'Payout not found', lead: '<a class="link" href="#/payouts">← Payouts</a>' }); return; }
    const row = batch.rows.find((r) => r.ref === ref);
    const hist = evs.filter((e) => e.ref === ref || (!e.ref && e.type.startsWith('BATCH.') && (e.summary || '').includes(p.payoutBatchId || '~'))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    app.setContext({ label: `${p.ref} · ${p.name || p.receiver} · ${STATUS_LABEL[p.status] || p.status}`, batchId: bId, ref });
    el.innerHTML = `<section class="band"><div class="wrap"><a class="crumb" href="#/payouts">← Payouts</a><h1>${esc(p.name || p.receiver)}</h1><p class="lead">${esc(p.receiver)} · ${esc(app.countries[p.country]?.name || p.country)} · <span class="mono">${esc(p.ref)}</span></p>
      <div class="facts">${statusPill(p.status)}<span class="tag navy mono">${esc(money(p.amount, p.currency))}</span>${p.status === 'UNCLAIMED' ? `<span class="tag">${Math.max(0, 30 - p.ageDays)} days left</span>` : ''}${p.demo ? '<span class="st demo">Demo · not PayPal</span>' : ''}</div>
      <nav class="tabs" aria-label="Payout"><button data-t="overview" aria-selected="${tab === 'overview'}">Overview</button><button data-t="history" aria-selected="${tab === 'history'}">History <b class="tc">${hist.length}</b></button></nav></div></section>
      <div class="wrap body"><div class="page2"><div class="p-main">
        ${tab === 'overview' ? `<section class="card-xl"><h2>Route</h2><p class="muted">Origin, currency, recipient and rules come from PayPal's checks. PayPal and Result come from PayPal's own response.</p><div class="thr-box" id="thr"></div></section>
          <section class="card-xl"><h2>PayPal</h2><dl class="kv">
          <dt>Batch</dt><dd class="mono">${esc(p.payoutBatchId || '—')}</dd><dt>Item</dt><dd class="mono">${esc(p.itemId || 'Not assigned yet')}</dd>
          ${p.transactionId ? `<dt>Transaction</dt><dd class="mono">${esc(p.transactionId)}</dd>` : ''}<dt>Status</dt><dd class="mono">${esc(p.status)}</dd>
          ${p.error ? `<dt>Error</dt><dd class="mono" style="color:var(--restricted)">${esc(p.error)}</dd>` : ''}${p.fee ? `<dt>Fee</dt><dd class="mono">${esc(money(p.fee.value, p.fee.currency))}</dd>` : ''}
          <dt>Sent</dt><dd>${p.submittedAt ? esc(stamp(p.submittedAt)) : '—'}</dd></dl></section>`
        : `<section class="card-xl"><h2>History</h2>${hist.length ? `<ol class="hist">${hist.map((e) => `<li><i class="${e.status ? tone(e.status) : ''}"></i><div><span class="mono">${esc(stamp(e.at))}</span> ${srcTag(e.source)}<p>${esc(e.summary)}</p></div></li>`).join('')}</ol>` : '<p class="muted">No recorded changes yet.</p>'}</section>`}
      </div><aside class="p-side">
        <div class="side-box"><span class="lbl">Amount</span><b class="big mono">${esc(money(p.amount, p.currency))}</b><div class="side-a">
          ${isOpen(p.status) ? `<a class="pill" href="#/resolve/${esc(bId)}/${esc(ref)}">Resolve</a>` : ''}<button class="pill ghost" id="refresh">Refresh</button><button class="pill ghost" id="pask">Ask</button></div></div>
        <div class="side-box"><span class="lbl">Batch</span><a class="link" href="#/preflight/${esc(bId)}">${esc(p.batchName)}</a><p class="muted" style="font-size:13px;margin-top:4px">Sent ${p.submittedAt ? esc(stamp(p.submittedAt)) : '—'}</p></div>
      </aside></div></div>`;
    if (tab === 'overview') mountThread($('#thr', el), row, { key: ref, size: 'md', label: `Route for ${ref}` });
    el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; load(); }));
    $('#refresh', el).addEventListener('click', async () => { try { await api(`/api/batches/${bId}/sync`, { body: {} }); app.synced(); await load(); toast('Refreshed from PayPal'); } catch (e) { toast(e.message, true); } });
    $('#pask', el).addEventListener('click', () => app.ask());
  };
  await load();
  let t;
  return app.on(() => { clearTimeout(t); t = setTimeout(() => load().catch(() => {}), 300); });
}
