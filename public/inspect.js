// Inspect: a row's Thread plus the evidence behind the selected checkpoint.
import { $, $$, esc, api, pill, statusPill, DECISION_LABEL, money, docName, ICONS, richText } from './util.js';
import { mountThread, threadModel } from './thread.js';

const SEV = { pass: 'Pass', note: 'Note', review: 'Review', block: 'Stopped' };
const ICON = { pass: ICONS.check, note: ICONS.info, review: ICONS.bang, block: ICONS.x };

export function evidenceItem(x) {
  const src = x.source ? `<a class="srcl" href="${esc(x.source)}" target="_blank" rel="noopener">Source · ${esc(docName(x.source))} ↗</a>` : '<span class="srcl muted">PayOut safety check, not a PayPal rule</span>';
  const fix = x.fix ? `<div class="fix"><button class="btn sm" data-fix='${esc(JSON.stringify(x.fix))}'>Apply</button><span>${esc(x.fix.label)}</span></div>` : '';
  return `<li class="ev ${x.severity}"><span class="ic" aria-hidden="true">${ICON[x.severity]}</span><div><b>${esc(x.title)}</b> <span class="sev">${SEV[x.severity]}</span><p>${esc(x.detail)}</p>${src}${fix}</div></li>`;
}

function paypalEvidence(p) {
  return `<dl class="kv">
    <dt>Status</dt><dd>${statusPill(p.status)}${p.demo ? ' <span class="st demo">Demo · not PayPal</span>' : ''}</dd>
    <dt>Batch</dt><dd class="mono">${esc(p.batchId || '—')}</dd>
    <dt>Item</dt><dd class="mono">${esc(p.itemId || 'Not assigned yet')}</dd>
    ${p.transactionId ? `<dt>Transaction</dt><dd class="mono">${esc(p.transactionId)}</dd>` : ''}
    ${p.error ? `<dt>Error</dt><dd class="mono" style="color:var(--restricted)">${esc(p.error)}</dd>` : ''}
    ${p.fee ? `<dt>Fee</dt><dd class="mono">${esc(money(p.fee.value, p.fee.currency))}</dd>` : ''}
    ${p.updatedAt ? `<dt>Updated</dt><dd>${esc(new Date(p.updatedAt).toLocaleString())}</dd>` : ''}
  </dl>`;
}

// ctx: { batchId, patchRow?, onAsk? }  state is kept on el so the selected node survives re-renders
export function renderInspect(el, row, ctx) {
  if (!row) { el.innerHTML = '<p class="empty">Select a row to trace its route. Each checkpoint shows the rule or PayPal response behind it.</p>'; el._ins = null; return; }
  const m = threadModel(row);
  const same = el._ins?.ref === row.ref;
  const firstBad = m.nodes.find((n) => ['block', 'review'].includes(n.state));
  const node = same && el._ins.node ? el._ins.node : row.payout ? 'result' : firstBad?.key || 'rules';
  el._ins = { ref: row.ref, node };
  const issues = row.findings.filter((x) => x.severity !== 'pass');
  el.innerHTML = `
    <header class="ins-h">
      <div><h3>${esc(row.name || 'Unnamed recipient')}</h3><p><span class="mono">${esc(row.ref)}</span> · ${esc(row.receiver || 'no receiver')}</p></div>
      <div class="r"><b class="amt mono">${esc(money(row.amount, row.currency))}</b>${row.payout ? statusPill(row.payout.status) : pill(row.decision, DECISION_LABEL[row.decision])}</div>
    </header>
    <div class="ins-t" id="ins-t"></div>
    <section class="ins-e reveal" id="ins-e" aria-live="polite"></section>
    ${!row.payout && row.decision === 'review' ? `<label class="ack"><input type="checkbox" id="ack" ${row.acknowledged ? 'checked' : ''}><span>Confirmed with the recipient. Approve this row.</span></label>` : ''}
    ${!row.payout ? '<section class="explain" id="explain"><span class="lbl">AI Explanation</span><div class="skeleton" style="width:85%;margin-top:6px"></div><div class="skeleton" style="width:60%;margin-top:6px"></div></section>' : ''}
    <div class="ins-a">
      ${row.payout && row.payout.status !== 'SUCCESS' ? `<a class="btn sm primary" href="#/resolve/${esc(ctx.batchId)}/${esc(row.ref)}">Resolve</a>` : ''}
      <button class="btn sm" id="ins-ask">Ask</button>
      ${issues.length ? `<span class="muted" style="font-size:12px">${issues.length} finding${issues.length > 1 ? 's' : ''}</span>` : ''}
    </div>`;

  const showNode = (key) => {
    el._ins.node = key;
    const n = m.nodes.find((x) => x.key === key);
    const box = $('#ins-e', el);
    box.classList.remove('reveal'); void box.offsetWidth; box.classList.add('reveal');
    if (key === 'paypal' || key === 'result') {
      box.innerHTML = `<span class="lbl">${n.label}</span>${row.payout ? paypalEvidence(row.payout)
        : `<p class="muted">${m.cut >= 0 ? `This row stops at ${m.nodes[m.cut].label}, so it will not be sent.` : 'Not sent yet. This checkpoint fills in from PayPal\'s own response after Send.'}</p>`}`;
    } else {
      box.innerHTML = `<span class="lbl">${n.label}${n.value ? ` · <span class="mono">${esc(n.value)}</span>` : ''}</span>${n.evidence.length ? `<ul class="evs">${n.evidence.map(evidenceItem).join('')}</ul>` : `<p class="muted">${n.state === 'off' ? 'Inactive: the route stopped earlier.' : 'No findings at this checkpoint.'}</p>`}`;
      $$('[data-fix]', box).forEach((b) => b.addEventListener('click', async () => {
        const fix = JSON.parse(b.dataset.fix), patch = { ...fix.patch };
        if (fix.needs === 'amount') { const v = prompt(`New amount in ${patch.currency}?`, ''); if (!v) return; patch.amount = v; }
        ctx.patchRow?.(row.ref, patch);
      }));
    }
    $$('.t-node', el).forEach((b) => b.setAttribute('aria-pressed', b.dataset.node === key));
  };
  const tEl = $('#ins-t', el);
  tEl._thread = el._tstate; // keep Thread memory across re-renders so only real changes animate (Trace)
  mountThread(tEl, row, { key: row.ref, selected: node, size: 'sm', onNode: showNode, label: `Route for ${row.ref}` });
  el._tstate = tEl._thread;
  showNode(node);

  $('#ack', el)?.addEventListener('change', (e) => ctx.patchRow?.(row.ref, { acknowledged: e.target.checked, approved: e.target.checked }));
  $('#ins-ask', el).addEventListener('click', () => ctx.onAsk?.());
  if (!row.payout && ctx.batchId) {
    api(`/api/batches/${ctx.batchId}/rows/${encodeURIComponent(row.ref)}/explain`).then((x) => {
      const box = $('#explain', el); if (!box || el._ins?.ref !== row.ref) return;
      box.innerHTML = `<span class="lbl">${x.ai ? 'AI Explanation' : 'Rules Explanation'}</span><p>${richText(x.text)}</p>`;
    }).catch(() => $('#explain', el)?.remove());
  }
}
