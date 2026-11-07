// RULES · Devpost-style searchable library: tabs, filter sidebar, rich cards, detail sheet.
import { $, $$, esc, api, pill, docName, band, cached } from '../util.js';
import { listShell, renderFilters, passes, tally } from '../list.js';

export async function render(el, app, [tab0]) {
  const tab = tab0 === 'currency' ? 'currency' : 'country';
  const countries = app.countryList, currencies = await cached('/api/currencies');
  const tabs = `<a href="#/rules/country" ${tab === 'country' ? 'aria-current="page"' : ''}>Country <b class="tc">${countries.length}</b></a><a href="#/rules/currency" ${tab === 'currency' ? 'aria-current="page"' : ''}>Currency <b class="tc">${currencies.length}</b></a>`;
  el.innerHTML = band({ title: 'Rules', lead: 'The published PayPal Payouts policy PayOut checks against, in plain English, each entry linked to its PayPal source.',
    facts: `<span class="tag navy">${esc(app.config.rulesVersion)}</span>`, tabs })
    + listShell({ id: 'ru', placeholder: tab === 'country' ? 'Search country or code' : 'Search currency or code', sortOptions: [['name', 'Name'], ['code', 'Code']] });

  const yes = (v, a = 'Yes', b = 'No') => (v ? pill('eligible', a) : pill('blocked', b));
  const C = {
    country: {
      items: countries, groups: [
        { key: 'send', label: 'Send', get: (c) => (c.canSendPayouts ? 'yes' : 'no'), name: { yes: 'Can send', no: 'Receive only' } },
        { key: 'conv', label: 'Conversion', get: (c) => (c.automaticConversion === 'Available' ? 'auto' : 'excluded'), name: { auto: 'Automatic', excluded: 'Excluded' } },
        { key: 'feat', label: 'Feature', get: (c) => c.featureSet, name: {} }],
      card: (c) => `<button class="rcard" data-k="${esc(c.code)}"><i class="edge ${c.canSendPayouts ? 'ready' : 'review'}"></i><span class="flag mono">${esc(c.code)}</span>
        <div class="rc-m"><b>${esc(c.name)}</b><small>${esc(c.featureSet)}</small><div class="rc-t">${c.canSendPayouts ? '<span class="tag navy">Send</span>' : ''}<span class="tag navy">Receive</span>${c.automaticConversion === 'Available' ? '<span class="tag grey">Conversion</span>' : '<span class="st review">No conversion</span>'}${c.localCurrency ? `<span class="tag grey mono">${esc(c.localCurrency)}</span>` : ''}</div></div>
        <div class="rc-r"><span class="link">Inspect →</span></div></button>`,
      sheet: (p) => `<span class="lbl">Country</span><h2 id="sheet-h">${esc(p.name)} <span class="mono muted" style="font-size:16px">${esc(p.code)}</span></h2>
        <p class="plain">${esc(p.canSendPayouts ? `Businesses in ${p.name} can send Payouts, and people there can receive them.` : `People in ${p.name} can receive and withdraw payouts, but businesses there cannot send Payouts.`)}${p.automaticConversion !== 'Available' ? ' PayPal does not convert currency automatically for recipients here: pay in a currency they hold, usually USD.' : ''}</p>
        <dl class="kv"><dt>Feature</dt><dd>${esc(p.featureSet)}</dd><dt>Send</dt><dd>${yes(p.canSendPayouts)}</dd><dt>Receive</dt><dd>${yes(p.canReceivePayouts)}</dd><dt>Conversion</dt><dd>${esc(p.automaticConversion)}</dd><dt>Local</dt><dd class="mono">${esc(p.localCurrency || '—')}</dd><dt>Updated</dt><dd class="mono">2026-09-10</dd></dl>
        <div class="side-a"><a class="pill" href="#/routes/${esc(app.config.senderCountry)}/${esc(p.code)}/USD">Inspect</a><a class="pill ghost" href="${esc(p.source)}" target="_blank" rel="noopener">Source ↗</a></div>`,
    },
    currency: {
      items: currencies, groups: [
        { key: 'pay', label: 'Payment', get: (c) => (c.payment ? 'yes' : 'no'), name: { yes: 'Payment currency', no: 'Not a payment currency' } },
        { key: 'dec', label: 'Decimals', get: (c) => (c.decimals ? 'two' : 'none'), name: { two: 'Two decimals', none: 'Whole amounts' } },
        { key: 'scope', label: 'Scope', get: (c) => (c.inCountryOnly ? 'in' : 'cross'), name: { in: 'In-country only', cross: 'Cross-border' } }],
      card: (c) => `<button class="rcard" data-k="${esc(c.code)}"><i class="edge ${c.payment && !c.inCountryOnly ? 'ready' : c.payment ? 'review' : 'restricted'}"></i><span class="flag mono">${esc(c.code)}</span>
        <div class="rc-m"><b>${esc(c.name)}</b><small>${esc(c.note || (c.payment ? 'Payouts payment currency' : 'Accepted for conversion only'))}</small><div class="rc-t">${c.payment ? '<span class="tag navy">Payment</span>' : '<span class="st restricted">Not payment</span>'}${c.autoConvert ? '<span class="tag grey">Conversion</span>' : ''}${!c.decimals ? '<span class="st review">Whole</span>' : ''}${c.inCountryOnly ? `<span class="tag">In ${esc(c.inCountryOnly)}</span>` : ''}</div></div>
        <div class="rc-r"><span class="link">Source →</span></div></button>`,
      sheet: (c) => `<span class="lbl">Currency</span><h2 id="sheet-h">${esc(c.name)} <span class="mono muted" style="font-size:16px">${esc(c.code)}</span></h2>
        <p class="plain">${esc(c.note || (c.payment ? `${c.code} can be used as a Payouts currency${c.autoConvert ? ', and PayPal converts it automatically where conversion is allowed' : ''}.` : `${c.code} is not a PayPal REST payment currency.`))}</p>
        <dl class="kv"><dt>Payment</dt><dd>${yes(c.payment)}</dd><dt>Conversion</dt><dd>${c.autoConvert ? 'Automatic' : 'None'}</dd><dt>Decimals</dt><dd>${c.decimals ? 'Two' : 'None · whole amounts'}</dd><dt>Scope</dt><dd>${c.inCountryOnly ? `In ${esc(c.inCountryOnly)} only` : 'Cross-border'}</dd><dt>Updated</dt><dd class="mono">2026-08-17</dd></dl>
        <div class="side-a"><a class="pill ghost" href="${esc(c.source)}" target="_blank" rel="noopener">Source ↗</a></div>`,
    },
  }[tab];

  const state = Object.fromEntries(C.groups.map((g) => [g.key, new Set()]));
  const draw = () => {
    const q = $('#ru-q', el).value.trim().toLowerCase(), sort = $('#ru-s', el).value;
    renderFilters($('#ru-f', el), C.groups.map((g) => ({ key: g.key, label: g.label, options: Object.entries(tally(C.items, g.get)).map(([v, n]) => ({ v, label: g.name[v] || v, n })) })), state, draw);
    const xs = C.items.filter((c) => passes(state, c, (x, k) => C.groups.find((g) => g.key === k).get(x)) && (!q || `${c.name} ${c.code}`.toLowerCase().includes(q)))
      .sort((a, b) => (sort === 'code' ? a.code.localeCompare(b.code) : a.name.localeCompare(b.name)));
    $('#ru-n', el).textContent = `Showing ${xs.length} of ${C.items.length} ${tab === 'country' ? 'countries' : 'currencies'}`;
    $('#ru-l', el).innerHTML = xs.length ? xs.map(C.card).join('') : '<div class="pane empty">Nothing matches.</div>';
    $$('#ru-l [data-k]', el).forEach((b) => b.addEventListener('click', () => {
      $('#sheet-b').innerHTML = C.sheet(C.items.find((c) => c.code === b.dataset.k));
      $('#sheet').showModal();
    }));
  };
  $('#ru-q', el).addEventListener('input', draw);
  $('#ru-s', el).addEventListener('change', draw);
  draw();
}
