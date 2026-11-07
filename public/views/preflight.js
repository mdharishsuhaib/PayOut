// PREFLIGHT · Import → Map → Check → Review → Send
import { $, $$, esc, api, toast, money, confirmDialog, ICONS, srcTag, countUp } from '../util.js';
import { renderInspect } from '../inspect.js';

// The table library (AG Grid, ~1.9 MB) is only needed here, so it loads on first use instead of holding up every page.
let gridLoad = null;
export function loadGrid() {
  gridLoad ||= new Promise((ok, fail) => {
    if (window.agGrid) return ok();
    const s = document.createElement('script');
    s.src = '/vendor/ag-grid-community-36.3.0.min.js';
    s.onload = ok;
    s.onerror = () => { s.remove(); fail(new Error('The payout table could not load. Check your connection and refresh the page.')); };
    document.head.append(s);
  }).then(() => import('../grid.js')).catch((e) => { gridLoad = null; throw e; });
  return gridLoad;
}

const STEPS = ['Import', 'Map', 'Check', 'Review', 'Send'];
const FIELD = { ref: 'Ref', name: 'Name', receiver: 'Receiver', recipientType: 'Type', wallet: 'Wallet', country: 'Country', currency: 'Currency', amount: 'Amount', fromCountry: 'Origin', note: 'Note' };

export async function render(el, app, [batchId]) {
  const ctx = { batch: null, selected: null, filter: 'all' };
  el.innerHTML = `
    <section class="band"><div class="wrap"><button type="button" class="back" id="pf-back" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Back to Verify</button><h1 id="pf-h">Verify</h1><p class="lead" id="pf-lead">Check a payout batch against PayPal's published country and currency rules before any money moves. Only rows you approve go to PayPal.</p><div class="facts" id="pf-facts"></div><div style="height:32px"></div></div></section>
    <div class="wrap body">
    <section class="intake" id="intake">
      <div class="intake-o" role="group" aria-label="Import">
        <button class="opt" id="o-sample">${ICONS.sheet}<b>Sample</b><span>11 synthetic contractors in 9 countries</span></button>
        <label class="opt" for="o-file">${ICONS.upload}<b>Upload</b><span>CSV with reference, name, receiver, country, currency, amount</span><input type="file" id="o-file" accept=".csv,text/csv" hidden></label>
        <button class="opt" id="o-paste">${ICONS.type}<b>Paste</b><span>CSV rows, or plain lines like "Priya priya@studio.in 200 USD India"</span></button>
      </div>
      <form class="paste" id="paste" hidden><label class="lbl" for="paste-t">Paste</label><textarea id="paste-t" rows="5" placeholder="reference,name,receiver,country,currency,amount&#10;PG-1,Priya Nair,priya@studio.in,IN,USD,200&#10;&#10;or one per line: Diego Ramos diego@qa.mx 300 USD Mexico"></textarea><div class="row-end"><button class="pill" type="submit">Check</button></div></form>
      <div class="recent" id="recent"></div>
    </section>

    <section class="desk" id="desk" hidden>
      <aside class="d-rail">
        <div class="d-name"><b id="b-name"></b><small id="b-sub"></small></div>
        <ol class="steps" id="steps"></ol>
        <div class="buckets" role="toolbar" aria-label="Filter" id="buckets"></div>
        <details class="map" id="map"><summary>Map</summary><div id="map-b"></div></details>
        <div id="b-notes"></div>
      </aside>
      <section class="pane d-grid">
        <div class="pane-h"><input type="search" id="q" placeholder="Search" aria-label="Search rows"><div class="tools"><button class="btn sm" id="export">Export</button><button class="btn sm" id="new">Import</button></div></div>
        <div class="grid-wrap"><div id="grid" class="grid"></div><i class="scan" id="scan" aria-hidden="true"></i></div>
      </section>
      <aside class="pane d-ins" id="ins" aria-live="polite"></aside>
      <div class="approve" id="approve"><div id="ap-sum"></div><button class="btn primary" id="send">Send</button></div>
    </section></div>`;

  const visible = (r) => ctx.filter === 'all' ? true : ctx.filter === 'sent' ? !!r.payout : r.decision === ctx.filter && !r.payout;
  const firstList = batchId ? null : api('/api/batches').catch(() => []); // fetched while the table library loads
  const firstBatch = batchId ? api(`/api/batches/${batchId}`) : null;
  firstBatch?.catch(() => {});
  const { createBatchGrid } = await loadGrid();
  const grid = createBatchGrid($('#grid', el), {
    onSelect: (ref) => { ctx.selected = ref; inspect(); },
    onEdit: (ref, patch) => ctx.patchRow(ref, patch),
    isVisible: visible, autoHeight: true,
  });
  const rowOf = (ref) => ctx.batch?.rows.find((r) => r.ref === ref);
  const inspect = () => {
    const r = ctx.selected ? rowOf(ctx.selected) : null;
    renderInspect($('#ins', el), r, { batchId: ctx.batch.id, patchRow: ctx.patchRow, onAsk: () => app.ask() });
    app.setContext(r ? { label: `${r.ref} · ${r.name || r.receiver} · ${r.fromCountry}→${r.country} ${r.currency}`, batchId: ctx.batch.id, ref: r.ref } : null);
  };

  const stepAt = (b) => (b.payout ? 5 : b.summary.review && b.rows.some((r) => r.decision === 'review' && !r.acknowledged) ? 3 : 4);
  function steps(b) {
    const s = stepAt(b);
    const sub = [b.source === 'sample' ? 'Sample · synthetic' : b.source === 'csv' ? 'CSV' : b.source === 'ai' ? 'Text · AI parsed' : 'Text',
      b.mapping ? `${b.mapping.fields.filter((f) => f.column).length} fields` : 'Parsed', `${b.rows.length} rows`,
      b.summary.review ? `${b.rows.filter((r) => r.decision === 'review' && !r.acknowledged).length} open` : 'Clear',
      b.payout ? `${(b.payout.batches || []).length} sent` : `${b.summary.approved} approved`];
    $('#steps', el).innerHTML = STEPS.map((n, i) => `<li class="${i < s ? 'done' : i === s ? 'now' : ''}"><i>${i < s ? '✓' : i + 1}</i><b>${n}</b><small>${esc(sub[i])}</small></li>`).join('');
  }
  function buckets(b) {
    const sent = b.rows.filter((r) => r.payout).length, open = (k) => b.rows.filter((r) => r.decision === k && !r.payout).length;
    const xs = [['all', 'All', b.rows.length, ''], ['eligible', 'Ready', open('eligible'), 'ready'], ['review', 'Review', open('review'), 'review'], ['blocked', 'Restricted', open('blocked'), 'restricted'], ['sent', 'Sent', sent, 'pending']];
    $('#buckets', el).innerHTML = xs.map(([f, l, n, t]) => `<button data-f="${f}" class="${t}" aria-pressed="${ctx.filter === f}"><span>${l}</span><b data-n="${n}">${n}</b></button>`).join('');
    $$('#buckets button', el).forEach((x) => x.addEventListener('click', () => { ctx.filter = x.dataset.f; buckets(ctx.batch); grid.refilter(); }));
  }
  function mapping(b) {
    const m = b.mapping;
    $('#map', el).hidden = !m;
    if (!m) return;
    $('#map-b', el).innerHTML = `<ul>${m.fields.filter((f) => f.column || f.required).map((f) => `<li class="${f.column ? '' : 'miss'}"><span>${FIELD[f.field]}</span><code>${esc(f.column || 'missing')}</code></li>`).join('')}</ul>${m.ignored?.length ? `<p class="muted">Ignored: ${esc(m.ignored.join(', '))}</p>` : ''}`;
  }
  function approveBar() {
    const b = ctx.batch, s = b.summary, btn = $('#send', el);
    if (b.payout) {
      const n = (b.payout.batches || []).length;
      $('#ap-sum', el).innerHTML = `<b>Sent</b> as ${n} PayPal batch${n === 1 ? '' : 'es'} ${srcTag(b.payout.simulated ? 'simulated' : 'paypal')} <span class="mono">${esc(b.payout.id)}</span>${b.payout.failures?.length ? ` · <span style="color:var(--restricted)">${b.payout.failures.length} rejected</span>` : ''}`;
      btn.textContent = 'Refresh'; btn.className = 'btn'; btn.disabled = false; btn.onclick = sync;
      return;
    }
    const amt = Object.entries(s.approvedAmount).map(([c, v]) => money(v, c)).join(' + ') || 'nothing';
    const held = s.total - s.approved, cur = Object.keys(s.approvedAmount).length;
    $('#ap-sum', el).innerHTML = `<b>${s.approved}</b> of ${s.total} approved · <span class="mono">${esc(amt)}</span>${held ? ` · ${held} held back` : ''}${cur > 1 ? ` · ${cur} PayPal batches, one per currency` : ''}`;
    btn.textContent = 'Send'; btn.className = 'btn primary'; btn.disabled = !s.approved; btn.onclick = send;
    requestAnimationFrame(() => app.clearFab?.());
  }

  ctx.setBatch = (b, fresh = false) => {
    ctx.batch = b;
    if (location.hash !== `#/preflight/${b.id}`) history.replaceState(null, '', `#/preflight/${b.id}`);
    $('#intake', el).hidden = true; $('#desk', el).hidden = false; $('#pf-back', el).hidden = false;
    $('#pf-h', el).textContent = b.name;
    $('#pf-lead', el).innerHTML = `${b.rows.length} payouts from a ${esc(b.senderCountryName || b.senderCountry)} business account · imported ${esc(new Date(b.createdAt).toLocaleString())}`;
    $('#pf-facts', el).innerHTML = `<span class="tag navy">${b.source === 'sample' ? 'Sample · synthetic data' : b.source === 'csv' ? 'CSV' : 'Text'}</span><span class="st ready">${b.summary.eligible} Ready</span><span class="st review">${b.summary.review} Review</span><span class="st restricted">${b.summary.blocked} Restricted</span>${b.payout ? '<span class="tag">Sent</span>' : ''}`;
    $('#b-name', el).textContent = b.name;
    $('#b-sub', el).innerHTML = `${b.senderCountry} business account · ${new Date(b.createdAt).toLocaleDateString()}`;
    $('#b-notes', el).innerHTML = (b.batchFindings || []).map((f) => `<p class="note">${ICONS.info}<span><b>${esc(f.title)}.</b> ${esc(f.detail)}</span></p>`).join('')
      + (b.payout?.failures || []).map((f) => `<p class="note bad">${ICONS.x}<span><b>PayPal rejected the ${esc(f.currency)} batch.</b> ${esc(f.error)}</span></p>`).join('');
    grid.layout(b.rows.length <= 18);
    $('#grid', el).style.height = b.rows.length <= 18 ? '' : 'calc(100vh - 290px)';
    grid.setRows(b.rows, ctx.selected);
    steps(b); buckets(b); mapping(b); approveBar();
    if (!ctx.selected) { const first = b.rows.find((r) => r.decision === 'blocked') || b.rows[0]; ctx.selected = first?.ref; grid.api.getRowNode(ctx.selected)?.setSelected(true, true); }
    inspect();
    if (fresh) scan();
  };
  // Scan: a sweep across the actual rows while the counts land on their real values
  function scan() {
    const s = $('#scan', el);
    s.classList.remove('go'); void s.offsetWidth; s.classList.add('go');
    $$('#buckets [data-n]', el).forEach((b) => countUp(b, +b.dataset.n, 560));
  }
  ctx.patchRow = async (ref, patch) => {
    try { ctx.setBatch(await api(`/api/batches/${ctx.batch.id}/rows/${encodeURIComponent(ref)}`, { method: 'PATCH', body: patch })); }
    catch (e) { toast(e.message, true); }
  };
  const sync = async () => {
    try { ctx.setBatch(await api(`/api/batches/${ctx.batch.id}/sync`, { body: {} })); app.synced(); app.refreshCases(); }
    catch (e) { toast(e.message, true); }
  };

  async function send() {
    const b = ctx.batch, rows = b.rows.filter((r) => r.approved && !r.payout && r.decision !== 'blocked');
    const by = {}; for (const r of rows) (by[r.currency] ||= []).push(r);
    const ok = await confirmDialog(`Send ${rows.length} payout${rows.length > 1 ? 's' : ''}?`,
      `<p>${app.config.paypal.ok ? 'PayPal calls PayPal Sandbox <span class="mono">POST /v1/payments/payouts</span> once per currency.' : 'No sandbox keys are set, so this run is simulated and labelled as such.'} Restricted rows and unconfirmed reviews are never sent.</p>
       <ul>${Object.entries(by).map(([c, rs]) => `<li><b>${esc(c)}</b> · ${rs.length} payout${rs.length > 1 ? 's' : ''} · ${esc(money(rs.reduce((a, r) => a + Number(r.amount), 0), c))}</li>`).join('')}</ul>`, 'Send');
    if (!ok) return;
    $('#send', el).disabled = true;
    try {
      ctx.setBatch(await api(`/api/batches/${b.id}/submit`, { body: {} }));
      toast('PayPal accepted the batch');
      setTimeout(sync, 3000); setTimeout(sync, 12000);
    } catch (e) { toast(e.message, true); approveBar(); }
  }

  const load = async (p) => { try { ctx.selected = null; ctx.filter = 'all'; ctx.setBatch(await p, true); } catch (e) { toast(e.message, true); } };
  $('#o-sample', el).addEventListener('click', () => load(api('/api/batches/sample', { body: {} })));
  $('#o-file', el).addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    load(api(`/api/batches/csv?name=${encodeURIComponent(f.name.replace(/\.csv$/i, ''))}`, { body: await f.text() }));
    e.target.value = '';
  });
  $('#o-paste', el).addEventListener('click', () => { const t = $('#paste', el); t.hidden = !t.hidden; if (!t.hidden) $('#paste-t', el).focus(); });
  $('#paste', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('#paste-t', el).value.trim(); if (!t) return;
    const csv = /^[^\n]*,(.*)?(receiver|email|currency|amount)/i.test(t.split('\n')[0]);
    load(csv ? api('/api/batches/csv?name=Pasted%20batch', { body: t }) : api('/api/batches/text', { body: { text: t } }));
  });
  $('#q', el).addEventListener('input', (e) => grid.search(e.target.value));
  $('#export', el).addEventListener('click', () => grid.api.exportDataAsCsv({ fileName: `${ctx.batch.name}-paypal-preflight.csv`, columnKeys: ['decision', 'ref', 'name', 'receiver', 'route', 'amount', 'issue', 'approved', 'paypal'] }));
  const toIntake = () => { history.replaceState(null, '', '#/preflight'); ctx.batch = null; ctx.selected = null; $('#desk', el).hidden = true; $('#intake', el).hidden = false; $('#pf-back', el).hidden = true; $('#pf-h', el).textContent = 'Verify'; $('#pf-lead', el).textContent = 'Check a payout batch against PayPal\'s published country and currency rules before any money moves. Only rows you approve go to PayPal.'; $('#pf-facts', el).innerHTML = ''; app.setContext(null); recent(); window.scrollTo({ top: 0 }); };
  $('#new', el).addEventListener('click', toIntake);
  $('#pf-back', el).addEventListener('click', toIntake);

  async function recent(first) {
    const bs = await (first || api('/api/batches').catch(() => []));
    $('#recent', el).innerHTML = bs.length ? `<span class="lbl">Batches</span><ol>${bs.slice(0, 5).map((b) => `<li><a href="#/preflight/${esc(b.id)}"><b>${esc(b.name)}</b><span class="muted">${b.summary.total} rows · ${b.payout ? 'sent' : 'not sent'}</span><span class="mono muted">${new Date(b.createdAt).toLocaleDateString()}</span></a></li>`).join('')}</ol>` : '';
  }
  if (batchId) { try { ctx.setBatch(await firstBatch); } catch { recent(); } } else recent(firstList);
  return app.on((type, d) => { if (ctx.batch && (!d.batchId || d.batchId === ctx.batch.id)) api(`/api/batches/${ctx.batch.id}`).then((b) => ctx.setBatch(b)); });
}
