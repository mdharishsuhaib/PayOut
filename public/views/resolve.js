// RESOLVE · the customer's own payouts that PayPal didn't complete → one payout's page. Issue → Evidence → Explain → Action → Confirm.
import { $, $$, esc, api, toast, statusPill, money, confirmDialog, STATUS_LABEL, srcTag, stamp, docName, band } from '../util.js';
import { mountThread } from '../thread.js';
import { listShell, renderFilters, passes, tally } from '../list.js';

const PRI = { FAILED: 1, BLOCKED: 1, DENIED: 1, REVERSED: 1, ONHOLD: 2, UNCLAIMED: 3, RETURNED: 4, REFUNDED: 4, PENDING: 5 };
const tone = (s) => (PRI[s] === 1 ? 'restricted' : PRI[s] === 5 ? 'pending' : s === 'SUCCESS' ? 'ready' : 'review');
const PRI_WORD = { 1: 'Act now', 2: 'Act soon', 3: 'Waiting on recipient', 4: 'Returned', 5: 'In progress' };

export async function render(el, app, [bId, ref]) {
  if (bId && ref) return caseView(el, app, bId, ref);
  const all = await api('/api/payouts');
  const cases = all.filter((p) => p.status !== 'SUCCESS').map((p) => ({ ...p, pri: PRI[p.status] || 9, left: p.status === 'UNCLAIMED' ? Math.max(0, 30 - p.ageDays) : null }))
    .sort((a, b) => a.pri - b.pri || (a.left ?? 99) - (b.left ?? 99));
  el.innerHTML = band({ title: 'Resolve', lead: 'Your payouts that PayPal hasn\'t completed, starting with the ones that need you. PayOut checks the live status with PayPal before suggesting anything, and nothing is cancelled unless you confirm it.',
    facts: `<span class="tag navy">${cases.length} to fix</span>${cases.filter((c) => c.pri === 1).length ? `<span class="st restricted">${cases.filter((c) => c.pri === 1).length} need you now</span>` : ''}` })
    + listShell({ id: 'rs', placeholder: 'Search name or reference', sortOptions: [['pri', 'Needs you first'], ['amount', 'Amount'], ['left', 'Days left']] });
  const state = { status: new Set(), pri: new Set() };
  const draw = () => {
    const q = $('#rs-q', el).value.trim().toLowerCase(), sort = $('#rs-s', el).value;
    renderFilters($('#rs-f', el), [
      { key: 'pri', label: 'What to do', options: Object.entries(tally(cases, (c) => c.pri)).map(([v, n]) => ({ v, label: PRI_WORD[v] || v, n })) },
      { key: 'status', label: 'Status', options: Object.entries(tally(cases, (c) => c.status)).map(([v, n]) => ({ v, label: STATUS_LABEL[v] || v, n })) },
    ], state, draw);
    let xs = cases.filter((c) => passes(state, c, (x, k) => x[k]) && (!q || `${c.ref} ${c.name} ${c.receiver}`.toLowerCase().includes(q)));
    if (sort === 'amount') xs = [...xs].sort((a, b) => Number(b.amount) - Number(a.amount));
    if (sort === 'left') xs = [...xs].sort((a, b) => (a.left ?? 99) - (b.left ?? 99));
    $('#rs-n', el).textContent = `Showing ${xs.length} of ${cases.length} payouts`;
    $('#rs-l', el).innerHTML = xs.length ? xs.map((c) => `
      <a class="rcard" href="#/resolve/${esc(c.batchId)}/${esc(c.ref)}"><i class="edge ${tone(c.status)}"></i>
        <div class="rc-m"><b>${esc(c.name || c.receiver)}</b><small>${esc(c.receiver)}${c.error ? ` · <span class="mono">${esc(c.error)}</span>` : ''}</small>
          <div class="rc-t"><span class="tag ${c.pri === 1 ? '' : 'navy'}">${PRI_WORD[c.pri]}</span>${statusPill(c.status)}${c.left !== null ? `<span class="tag">${c.left} days left</span>` : ''}${c.demo ? '<span class="st demo">Demo</span>' : ''}</div></div>
        <div class="rc-r"><b class="mono">${esc(money(c.amount, c.currency))}</b><span class="pill sm">Fix</span></div></a>`).join('')
      : `<div class="pane empty">${cases.length ? 'No payouts match these filters.' : 'Nothing to fix. Every payout you sent through PayPal is paid.'}</div>`;
  };
  $('#rs-q', el).addEventListener('input', draw);
  $('#rs-s', el).addEventListener('change', draw);
  draw();
}

async function caseView(el, app, b, r) {
  const done = {};
  el.innerHTML = `<section class="band"><div class="wrap"><a class="crumb" href="#/resolve">← Resolve</a><h1>Checking with PayPal…</h1><div style="height:32px"></div></div></section>`;
  async function open() {
    let x, batch;
    try { [x, batch] = await Promise.all([api(`/api/batches/${b}/rows/${encodeURIComponent(r)}/recovery`), api(`/api/batches/${b}`)]); app.synced(); }
    catch (e) { el.innerHTML = band({ title: 'Payout unavailable', lead: `${esc(e.message)} · <a class="link" href="#/resolve">Resolve</a>` }); return; }
    const row = batch.rows.find((y) => y.ref === r), p = x.playbook, pay = row.payout;
    if (done.pending) Object.assign(done, { pending: false, title: `PayPal reports ${x.status}`, detail: x.demo ? 'This row carries a demo status; PayPal was not asked.' : `Checked with PayPal at ${new Date(x.checkedAt).toLocaleTimeString()}.` });
    const left = pay.status === 'UNCLAIMED' ? Math.max(0, 30 - Math.floor((Date.now() - Date.parse(batch.payout.submittedAt)) / 86_400_000)) : null;
    app.setContext({ label: `${row.ref} · ${row.name || row.receiver} · ${STATUS_LABEL[x.status] || x.status}`, batchId: b, ref: r });
    el.innerHTML = `<section class="band"><div class="wrap"><a class="crumb" href="#/resolve">← Resolve</a><h1>${esc(row.name || row.ref)}</h1>
      <p class="lead">${esc(row.receiver)} · ${esc(app.countries[row.country]?.name || row.country)} · <span class="mono">${esc(row.ref)}</span></p>
      <div class="facts">${statusPill(x.status)}<span class="tag navy mono">${esc(money(row.amount, row.currency))}</span>${left !== null ? `<span class="tag">${left} days left</span>` : ''}${x.demo ? '<span class="st demo">Demo · not PayPal</span>' : ''}</div><div style="height:32px"></div></div></section>
      <div class="wrap body"><div class="page2"><div class="p-main">
        <section class="card-xl"><div class="thr-box" id="thr"></div></section>
        <ol class="steps5">
          <li class="on"><span class="n">1</span><div><h3>Issue</h3><p><b>${esc(p.title)}.</b> ${esc(p.meaning)}</p>${left !== null ? `<p class="clock"><b class="mono">${left}</b> days until PayPal returns the money automatically if nobody claims it.</p>` : ''}</div></li>
          <li class="on"><span class="n">2</span><div><h3>Evidence</h3><dl class="kv">
            <dt>Status</dt><dd class="mono">${esc(x.status)} ${srcTag(x.demo ? 'demo' : pay.source === 'webhook' ? 'webhook' : 'paypal')}</dd>
            ${p.error ? `<dt>Error</dt><dd><span class="mono" style="color:var(--restricted)">${esc(p.error.name)}</span>${p.error.hint ? ` · ${esc(p.error.hint)}` : ''}</dd>` : ''}
            <dt>Checked</dt><dd>${x.demo ? 'Demo status, not checked with PayPal' : esc(stamp(x.checkedAt))}</dd>
            <dt>Batch</dt><dd class="mono">${esc(pay.batchId || '—')}</dd><dt>Item</dt><dd class="mono">${esc(pay.itemId || '—')}</dd></dl>
            <p style="margin-top:8px">${(p.sources || []).map((s) => `<a class="link" href="${esc(s)}" target="_blank" rel="noopener">${esc(docName(s))} ↗</a>`).join(' · ')}</p></div></li>
          <li class="on ai"><span class="n">3</span><div><h3>Explain</h3><span class="lbl">${x.ai ? 'AI · suggestion' : 'Playbook · suggestion'}</span><p>${esc(x.text)}</p>
            ${x.draft ? `<blockquote id="draft">${esc(x.draft)}</blockquote>` : ''}<p class="muted" style="font-size:13px;margin-top:8px">PayPal can't see inside the recipient's PayPal account. Account-specific reasons must be confirmed with the recipient or PayPal.</p></div></li>
          <li class="on"><span class="n">4</span><div><h3>Action</h3><p class="muted">${esc(x.canCancel ? 'Cancel returns the money to your PayPal balance. PayPal allows it only while the payout is unclaimed.' : p.next)}</p>
            <div class="acts"><button class="pill ghost sm" data-a="refresh">Refresh</button>${x.draft ? '<button class="pill ghost sm" data-a="copy">Copy</button>' : ''}${x.canCancel ? '<button class="btn danger sm" data-a="cancel">Cancel</button>' : ''}</div>
            ${app.user?.demo && !x.demo && pay.itemId ? `<details class="rehearse"><summary>Practice</summary><p class="muted">Demo only: give this payout a labelled practice status to try the fix flow. It is never shown as a PayPal status.</p><div class="acts">${['FAILED', 'BLOCKED', 'ONHOLD'].map((s) => `<button class="pill ghost sm" data-demo="${s}">${STATUS_LABEL[s]}</button>`).join('')}</div></details>` : ''}</div></li>
          <li class="${done.title ? 'on ok' : ''}"><span class="n">5</span><div><h3>Confirm</h3>${done.title ? `<p><b>${esc(done.title)}</b></p><p class="muted">${esc(done.detail)}</p>` : '<p class="muted">The outcome of your action, as PayPal reports it, appears here.</p>'}</div></li>
        </ol></div>
      <aside class="p-side"><div class="side-box"><span class="lbl">Amount</span><b class="big mono">${esc(money(row.amount, row.currency))}</b>
        <div class="side-a"><a class="pill ghost" href="#/payouts/${esc(b)}/${esc(r)}">Tracking</a><button class="pill ghost" id="cask">Ask</button></div></div>
        <div class="side-box"><span class="lbl">Next</span><p style="font-size:14px">${esc(p.next)}</p></div></aside></div></div>`;
    mountThread($('#thr', el), row, { key: r, size: 'md', label: `Route for ${row.ref}` });
    const act = (a) => el.querySelector(`[data-a=${a}]`);
    act('refresh').addEventListener('click', () => { done.pending = true; open(); });
    act('copy')?.addEventListener('click', () => { navigator.clipboard.writeText($('#draft', el).textContent); toast('Copied'); Object.assign(done, { title: 'Message copied', detail: 'Send it to the recipient yourself. PayPal never contacts recipients.' }); open(); });
    act('cancel')?.addEventListener('click', async () => {
      const ok = await confirmDialog('Cancel this unclaimed payout?', `<p><b>${esc(money(row.amount, row.currency))}</b> to ${esc(row.receiver)} goes back to your PayPal balance. PayPal re-checks the status right before calling <span class="mono">POST /v1/payments/payouts-item/{id}/cancel</span>.</p>`, 'Cancel', true);
      if (!ok) return;
      try {
        const nb = await api(`/api/batches/${b}/rows/${encodeURIComponent(r)}/cancel`, { body: { confirm: true } });
        Object.assign(done, { title: `PayPal reports ${nb.rows.find((y) => y.ref === r).payout.status}`, detail: `Cancelled at ${new Date().toLocaleTimeString()}. The funds return to your PayPal balance.` });
        toast('Cancelled. PayPal returned the funds.'); open(); app.refreshCases();
      } catch (e) { Object.assign(done, { title: 'Not cancelled', detail: e.message }); open(); toast(e.message, true); }
    });
    $$('[data-demo]', el).forEach((d) => d.addEventListener('click', async () => {
      await api(`/api/batches/${b}/rows/${encodeURIComponent(r)}/demo-status`, { body: { status: d.dataset.demo } });
      Object.assign(done, { title: `Practice ${STATUS_LABEL[d.dataset.demo]}`, detail: 'Labelled as practice everywhere; not a PayPal status.' });
      open(); app.refreshCases();
    }));
    $('#cask', el).addEventListener('click', () => app.ask());
  }
  await open();
}
