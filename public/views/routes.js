// ROUTES · inspection workbench. Left: choose. Centre: the Thread. Right: evidence.
import { $, $$, esc, api, pill, DECISION_LABEL, statusPill, money, docName, richText } from '../util.js';
import { mountThread } from '../thread.js';
import { evidenceItem } from '../inspect.js';

const CURS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'MXN', 'BRL', 'CNY', 'MYR', 'PHP', 'SGD', 'HKD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'ILS', 'NZD', 'THB', 'TWD', 'RUB', 'INR'];
const EXTRA = [['NG', 'Nigeria'], ['PK', 'Pakistan'], ['BD', 'Bangladesh'], ['KR', 'South Korea'], ['TH', 'Thailand'], ['TW', 'Taiwan'], ['EG', 'Egypt']];
// one-word case names; the route itself is the description
const CASES = [
  { name: 'Origin', from: 'IN', to: 'US', currency: 'USD', why: 'India can receive but not send' },
  { name: 'Conversion', from: 'US', to: 'IN', currency: 'EUR', why: 'No automatic conversion into India' },
  { name: 'Clear', from: 'US', to: 'IN', currency: 'USD', why: 'The supported way to pay India' },
  { name: 'Unsupported', from: 'US', to: 'IN', currency: 'INR', why: 'INR is not a REST payment currency' },
  { name: 'Decimals', from: 'US', to: 'JP', currency: 'JPY', why: 'JPY takes whole amounts only' },
  { name: 'Venmo', from: 'US', to: 'MX', currency: 'USD', wallet: 'VENMO', why: 'Venmo pays US recipients only' },
];

export async function render(el, app, [from0, to0, cur0]) {
  const opts = [...app.countryList.map((c) => [c.code, c.name]), ...EXTRA].sort((a, b) => a[1].localeCompare(b[1]));
  const sel = (id, v) => `<select id="${id}">${opts.map(([c, n]) => `<option value="${c}" ${c === v ? 'selected' : ''}>${esc(n)} · ${c}</option>`).join('')}</select>`;
  el.innerHTML = `
    <section class="band"><div class="wrap"><h1>Routes</h1><p class="lead">Pick an origin, a recipient country and a currency. PayPal traces the route through PayPal's published rules and shows the evidence behind every checkpoint.</p><div style="height:32px"></div></div></section>
    <div class="wrap body">
    <div class="bench">
      <aside class="pane b-left">
        <form id="rf" class="pane-b">
          <label class="fld"><span class="lbl">Origin</span>${sel('from', from0 || app.config.senderCountry)}</label>
          <button type="button" class="swap" id="swap" aria-label="Swap origin and recipient"><svg viewBox="0 0 24 24"><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/></svg></button>
          <label class="fld"><span class="lbl">Recipient</span>${sel('to', to0 || 'IN')}</label>
          <div class="two">
            <label class="fld"><span class="lbl">Currency</span><select id="cur">${CURS.map((c) => `<option ${c === (cur0 || 'USD') ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
            <label class="fld"><span class="lbl">Wallet</span><select id="wallet"><option value="PAYPAL">PayPal</option><option value="VENMO">Venmo</option></select></label>
          </div>
          <button class="btn primary" type="submit" style="width:100%">Inspect</button>
        </form>
        <div class="cases"><span class="lbl">Cases</span><ol>${CASES.map((c, i) => `<li><button type="button" data-case="${i}"><b>${c.name}</b><code>${c.from}→${c.to} ${c.currency}${c.wallet ? ' · Venmo' : ''}</code><small>${esc(c.why)}</small></button></li>`).join('')}</ol></div>
      </aside>
      <section class="pane b-centre">
        <div class="pane-h"><h2 id="r-h">Route</h2><span class="muted" style="font-size:12px">Published rules only · not a payout</span></div>
        <div class="b-stage"><div class="ends" id="ends"></div><div id="thread"></div><div class="verdict" id="verdict"></div></div>
        <div class="b-hist"><div class="pane-h"><h2>History <span class="c" id="hist-c"></span></h2></div><div id="hist"></div></div>
      </section>
      <aside class="pane b-right">
        <div class="pane-h"><h2 id="ev-h">Evidence</h2></div>
        <div class="pane-b reveal" id="ev"></div>
        <div class="pane-b b-explain" id="explain"></div>
      </aside>
    </div></div>`;

  const profile = (code) => app.countries[code] || { code, name: EXTRA.find((e) => e[0] === code)?.[1] || code, eligible: false, featureSet: 'Not eligible for Payouts', canSendPayouts: false, canReceivePayouts: false, automaticConversion: '—', localCurrency: null, source: app.config.docs.countries };
  const policy = (p, role) => `<div class="cty"><div class="cty-h"><b>${esc(p.name)}</b><code>${esc(p.code)}</code><span class="muted">${role}</span></div>
    <dl class="kv"><dt>Feature</dt><dd>${esc(p.featureSet)}</dd><dt>Send</dt><dd>${p.canSendPayouts ? pill('eligible', 'Yes') : pill('blocked', 'No')}</dd><dt>Receive</dt><dd>${p.canReceivePayouts ? pill('eligible', 'Yes') : pill('blocked', 'No')}</dd>
    <dt>Conversion</dt><dd>${p.automaticConversion === 'Available' ? 'Automatic' : esc(String(p.automaticConversion).replace('Excluded', 'Excluded'))}</dd><dt>Local</dt><dd class="mono">${esc(p.localCurrency || '—')}</dd></dl>
    <a class="srcl" href="${esc(p.source)}" target="_blank" rel="noopener">Source · ${esc(docName(p.source))} ↗</a></div>`;

  let q, res;
  const showNode = (key, m) => {
    const n = m.nodes.find((x) => x.key === key);
    const box = $('#ev', el); box.classList.remove('reveal'); void box.offsetWidth; box.classList.add('reveal');
    $('#ev-h', el).textContent = n.label;
    const F = profile(q.from), T = profile(q.to);
    let html = n.evidence?.length ? `<ul class="evs">${n.evidence.map(evidenceItem).join('')}</ul>` : '';
    if (key === 'origin') html += policy(F, 'Origin');
    else if (key === 'recipient') html += policy(T, 'Recipient');
    else if (key === 'paypal' || key === 'result') html = `<p class="muted">An inspection never moves money, so PayPal has nothing to report here. These checkpoints fill in from PayPal's own response once a real payout on this route is sent. ${res.hist.length ? 'See History for real payouts on this route.' : ''}</p>`;
    else if (!html) html = `<p class="muted">${n.state === 'off' ? 'Inactive: the route stopped earlier.' : 'No findings at this checkpoint.'}</p>`;
    box.innerHTML = html;
    $$('#thread .t-node', el).forEach((b) => b.setAttribute('aria-pressed', b.dataset.node === key));
    $$('[data-fix]', box).forEach((b) => b.addEventListener('click', () => { const p = JSON.parse(b.dataset.fix).patch; if (p.currency) $('#cur', el).value = p.currency; if (p.wallet) $('#wallet', el).value = p.wallet; inspect(); }));
  };

  async function inspect() {
    q = { from: $('#from', el).value, to: $('#to', el).value, currency: $('#cur', el).value, wallet: $('#wallet', el).value };
    history.replaceState(null, '', `#/routes/${q.from}/${q.to}/${q.currency}`);
    const [r, sent] = await Promise.all([api('/api/route/check', { body: q }), api('/api/payouts').catch(() => [])]);
    const F = profile(q.from), T = profile(q.to);
    res = { ...r, hist: sent.filter((s) => s.country === q.to && s.currency === q.currency && q.from === app.config.senderCountry) };
    $('#r-h', el).innerHTML = `${esc(F.name)} → ${esc(T.name)} <span class="c">${esc(q.currency)}${q.wallet === 'VENMO' ? ' · Venmo' : ''}</span>`;
    $('#ends', el).innerHTML = `<span><code>${esc(q.from)}</code>${esc(F.name)}</span><span class="mono">${esc(q.currency)}</span><span><code>${esc(q.to)}</code>${esc(T.name)}</span>`;
    const m = mountThread($('#thread', el), { findings: r.findings, payout: null, fromCountry: q.from, country: q.to, currency: q.currency, amount: '' },
      { key: `${q.from}${q.to}${q.currency}${q.wallet}`, size: 'lg', onNode: (k, mm) => showNode(k, mm), label: 'Route checkpoints' });
    const issues = r.findings.filter((x) => x.severity !== 'pass');
    $('#verdict', el).className = `verdict ${r.decision}`;
    $('#verdict', el).innerHTML = `${pill(r.decision, DECISION_LABEL[r.decision])}<p>${esc(r.decision === 'eligible' ? 'This route meets PayPal\'s published rules. PayPal\'s response on a real payout is still the final word.' : r.decision === 'review' ? issues.find((x) => x.severity === 'review')?.detail : issues.find((x) => x.severity === 'block')?.detail)}</p>`;
    $('#hist-c', el).textContent = res.hist.length || '';
    $('#hist', el).innerHTML = res.hist.length ? `<ol class="queue">${res.hist.slice(0, 5).map((s) => `<li><a href="#/payouts/${esc(s.batchId)}/${esc(s.ref)}"><span><b>${esc(s.name || s.ref)}</b><small class="mono">${esc(s.ref)} · ${esc(s.itemId || 'no item yet')}</small></span><span class="r"><span class="mono">${esc(money(s.amount, s.currency))}</span>${statusPill(s.status)}</span></a></li>`).join('')}</ol>`
      : '<p class="empty">No real payouts on this route yet.</p>';
    const first = m.nodes.find((n) => ['block', 'review'].includes(n.state));
    showNode(first?.key || 'recipient', m);
    app.setContext({ label: `${q.from}→${q.to} ${q.currency}${q.wallet === 'VENMO' ? ' Venmo' : ''}`, route: q });
    explain();
    $$('[data-case]', el).forEach((b) => { const c = CASES[b.dataset.case]; b.setAttribute('aria-pressed', c.from === q.from && c.to === q.to && c.currency === q.currency && (c.wallet || 'PAYPAL') === q.wallet); });
  }
  async function explain() {
    const box = $('#explain', el), key = JSON.stringify(q);
    box.innerHTML = '<span class="lbl">AI Explanation</span><div class="skeleton" style="width:80%;margin-top:8px"></div>';
    try {
      const x = await api('/api/ask', { body: { question: 'Explain this route in two sentences', context: { route: q } } });
      if (key !== JSON.stringify(q)) return;
      box.innerHTML = `<span class="lbl">${x.ai ? 'AI Explanation' : 'Rules Explanation'}</span><p>${richText(x.layers.suggestion || x.layers.policy)}</p><button class="btn sm" id="r-ask">Ask</button>`;
      $('#r-ask', el).addEventListener('click', () => app.ask());
    } catch { box.innerHTML = ''; }
  }

  $('#rf', el).addEventListener('submit', (e) => { e.preventDefault(); inspect(); });
  ['from', 'to', 'cur', 'wallet'].forEach((k) => $(`#${k}`, el).addEventListener('change', inspect));
  $('#swap', el).addEventListener('click', () => { const a = $('#from', el).value; $('#from', el).value = $('#to', el).value; $('#to', el).value = a; inspect(); });
  $$('[data-case]', el).forEach((b) => b.addEventListener('click', () => {
    const c = CASES[b.dataset.case];
    $('#from', el).value = c.from; $('#to', el).value = c.to; $('#cur', el).value = c.currency; $('#wallet', el).value = c.wallet || 'PAYPAL';
    inspect();
  }));
  await inspect();
}
