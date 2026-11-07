// HOME · what is happening to my payouts right now (PayPal-home layout, live data only)
import { $, $$, esc, api } from '../util.js';

export async function render(el, app) {
  const nCountries = app.countryList.length, nSend = app.countryList.filter((c) => c.canSendPayouts).length;
  const currencies = await api('/api/currencies').catch(() => []);
  const nCur = currencies.filter((c) => c.payment).length;
  const TOOLS = {
    check: { lead: 'Check every row before any money moves. Stop the routes PayPal\'s published rules don\'t allow, and get a plain reason for each one.', items: [
      ['Verify', 'Bring a batch, map its columns and check every row.', '#/preflight'], ['Routes', 'Trace one origin, recipient and currency through each rule.', '#/routes'], ['Rules', `The published policy for ${nCountries} countries and ${currencies.length} currencies.`, '#/rules']] },
    send: { lead: 'Send only the rows you approve. Batches are split by currency automatically, because PayPal rejects mixed-currency batches.', items: [
      ['Tracking', 'Follow every payout sent, with the live status PayPal reports.', '#/payouts'], ['Signals', 'Webhooks and API responses, and how each was processed.', '#/signals'], ['Export', 'Download batch and payout records as CSV.', '#/payouts']] },
    recover: { lead: 'Fix what PayPal didn\'t complete. Live status is re-checked first, and nothing is cancelled without your confirmation.', items: [
      ['Resolve', 'Failed, held, blocked and unclaimed payouts, most urgent first.', '#/resolve'], ['Cancel', 'Return unclaimed payouts to your balance before the 30-day auto-return.', '#/resolve'], ['PayPal AI', 'Explanations that keep PayPal facts, rules and suggestions apart.', '#ask']] },
  };
  el.innerHTML = `
    <section class="hero how"><div class="wrap hero-in">
      <div class="hero-t"><h1>Every payout, checked before money moves</h1>
        <ol class="how-steps" id="how-steps">
          ${[['Import', 'Upload a CSV, paste rows or load the sample. Columns are mapped automatically.'],
             ['Check', 'Every row is compared with PayPal\'s published country and currency rules. Restricted rows stop here, before any money moves.'],
             ['Split', 'Approved rows are grouped by currency, because PayPal rejects mixed-currency batches.'],
             ['Send', 'Each group goes to the PayPal Payouts API as its own batch.'],
             ['Listen', 'PayPal webhooks are signature-checked and every status change is recorded.'],
             ['Resolve', 'Paid payouts close. Unclaimed, held or failed ones go to Resolve with a clear next step.']]
            .map(([t, d], i) => `<li data-i="${i}"><b>${i + 1}</b><div><h3>${t}</h3><p>${d}</p></div></li>`).join('')}
        </ol>
        </div>
      <figure class="flow" aria-label="Animated diagram of how a payout batch moves through the system"><svg id="flow" viewBox="0 0 640 420" role="img">
        <defs>
          <path id="j-usd" d="M48 210 H160 H275 C305 210 315 120 350 120 H420 C450 120 450 210 470 210 H520 C545 210 555 110 588 110"/>
          <path id="j-eur" d="M48 210 H160 H275 H420 H470 H520 C545 210 555 310 588 310"/>
          <path id="j-gbp" d="M48 210 H160 H275 C305 210 315 300 350 300 H420 C450 300 450 210 470 210 H520 C545 210 555 110 588 110"/>
          <path id="j-stop" d="M48 210 H160 L142 228 C122 250 100 300 100 336"/>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
        </defs>
        <g class="f-grid">${Array.from({ length: 9 }, (_, i) => `<line x1="${i * 80}" y1="0" x2="${i * 80}" y2="420"/>`).join('')}${Array.from({ length: 6 }, (_, i) => `<line x1="0" y1="${i * 84}" x2="640" y2="${i * 84}"/>`).join('')}</g>
        <g class="f-wires">
          <path d="M48 210 H520"/><path d="M275 210 C305 210 315 120 350 120 H420 C450 120 450 210 470 210"/><path d="M275 210 C305 210 315 300 350 300 H420 C450 300 450 210 470 210"/>
          <path class="f-stop" d="M142 228 C122 250 100 300 100 336"/><path class="f-ok" d="M520 210 C545 210 555 110 588 110"/><path class="f-rev" d="M520 210 C545 210 555 310 588 310"/>
        </g>
        <g class="f-lane">${[['USD', 120], ['EUR', 210], ['GBP', 300]].map(([c, y]) => `<g transform="translate(352 ${y})"><g class="pill"><rect x="-22" y="-11" width="44" height="22" rx="11"/><text y="4.5">${c}</text></g></g>`).join('')}</g>
        ${[[48, 210, 'Import', 'rows', 0], [160, 210, 'Rules', 'checked', 1], [275, 210, 'Split', 'batches', 2], [420, 210, 'PayPal', 'sent', 3], [520, 210, 'Webhook', 'events', 4]]
          .map(([x, y, t, u, i]) => `<g class="f-node" data-i="${i}" transform="translate(${x} ${y})"><circle class="halo" r="30"/><circle class="core" r="22"/>${i === 3 ? '<image href="/paypal-mark.svg" x="-11" y="-11" width="22" height="22"/>' : `<text class="ic" y="5">${['⇪', '✓', '⑂', '', '⚡'][i]}</text>`}<text class="t" y="46">${t}</text></g>`).join('')}
        <g class="f-node end ok" data-i="5" transform="translate(588 110)"><circle class="halo" r="26"/><circle class="core" r="18"/><text class="ic" y="5">✓</text><text class="t" y="-30">Paid</text></g>
        <g class="f-node end rev" data-i="5" transform="translate(588 310)"><circle class="halo" r="26"/><circle class="core" r="18"/><text class="ic" y="5">!</text><text class="t" y="42">Resolve</text></g>
        <g class="f-node end stop" data-i="1" transform="translate(100 352)"><circle class="halo" r="24"/><circle class="core" r="16"/><text class="ic" y="5">✕</text><text class="t" y="38">Stopped</text></g>
        <g class="f-pk">
          ${[['usd', 'var(--blue)', 0], ['stop', 'var(--restricted)', -1.5], ['eur', 'var(--sky)', -3], ['gbp', '#ffffff', -4.5]].map(([j, c, b]) => `
          <g><circle r="9" fill="${c}" opacity=".35" filter="url(#glow)"><animateMotion dur="6s" begin="${b}s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;.85;1" calcMode="linear"><mpath href="#j-${j}"/></animateMotion></circle>
          <circle r="5.5" fill="${c}" stroke="#fff" stroke-width="2"><animateMotion dur="6s" begin="${b}s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;.85;1" calcMode="linear"><mpath href="#j-${j}"/></animateMotion></circle></g>`).join('')}
        </g>
      </svg></figure>
    </div></section>

    <section class="pp-sec grey center pp-works" aria-labelledby="works-h"><div class="wrap">
      <h2 class="pp-h2" id="works-h">How PayOut works</h2>
      <p class="pp-lead">It checks before money moves, monitors while money moves, and helps when something goes wrong.</p>
      <div class="pp-3">
        ${[['Before', 'Prevent', 'Check routes, currencies and recipient information.'],
           ['During', 'Process', 'Approve and send eligible payouts through PayPal.'],
           ['After', 'Resolve', 'Monitor transactions and investigate exceptions with AI.']]
          .map(([w, t, d], i) => `<div><span class="pp-works-n">${i + 1}</span><p class="pp-eyebrow">${w}</p><h3>${t}</h3><p>${d}</p></div>`).join('')}
      </div>
    </div></section>

    <section class="pp-sec center"><div class="wrap">
      <h2 class="pp-h2">Pay across borders with confidence</h2>
      <p class="pp-lead">Checked before you send. Followed after. We compare every row with PayPal's published Payouts rules, send only what you approve, and track what PayPal reports back.</p>
      <div class="pp-3">
        <div><b class="pp-num">${nCountries}<small>Countries</small></b><h3>Check payouts to ${nCountries} countries</h3><p>Country rules for sending, receiving and currency conversion, ${nSend} of them able to send.</p></div>
        <div><b class="pp-num">${nCur}<small>Currencies</small></b><h3>Pay in ${nCur} payment currencies</h3><p>Zero-decimal and in-country-only currencies are caught before PayPal rejects them.</p></div>
        <div><b class="pp-num">30<small>Days</small></b><h3>Recover before the auto-return</h3><p>Unclaimed payouts return after 30 days. We count down and let you act first.</p></div>
      </div>
    </div></section>


    <section class="pp-sec grey"><div class="wrap">
      <h2 class="pp-h2 center">Payout tools you need. One platform.</h2>
      <div class="pp-tabs" data-tabs="tools" role="tablist">${[['check', 'Check'], ['send', 'Send'], ['recover', 'Recover']].map(([k, l], i) => `<button role="tab" data-tab="${k}" aria-selected="${!i}">${l}</button>`).join('')}</div>
      ${Object.entries(TOOLS).map(([k, t], i) => `<div class="pp-panel" data-panel="tools:${k}" ${i ? 'hidden' : ''}><div class="pp-tool"><div class="pp-tool-l"><h3>${esc({ check: 'Check', send: 'Send', recover: 'Recover' }[k])}</h3><p>${esc(t.lead)}</p></div>
        <ul class="pp-tool-r">${t.items.map(([n, d]) => `<li><div class="pp-feat"><b>${esc(n)}</b><span>${esc(d)}</span></div></li>`).join('')}</ul></div></div>`).join('')}
    </div></section>

    <section class="pp-sec"><div class="wrap pp-start">
      <div><h2 class="pp-h2">Import, check<br>and send</h2><p class="pp-lead">Bring a CSV, paste rows or try the sample. Approve what passes, then send it to PayPal. It's that simple.</p></div>
      <ol class="pp-steps"><li><b>1</b><div><h3>Import</h3><p>Sample, upload or paste. Columns are mapped for you.</p></div></li><li><b>2</b><div><h3>Check</h3><p>Every row is checked against the published rules.</p></div></li><li><b>3</b><div><h3>Send</h3><p>Approved rows go to PayPal, one batch per currency.</p></div></li></ol>
    </div></section>

    <section class="pp-close"><div class="wrap"><div class="pp-close-in">
      <p class="pp-eyebrow">PayPal's Payout</p><h2>One check<br>for every payout</h2><p>Check before. Follow after. Recover when it matters.</p>
    </div></div></section>`;

  // PayPal-style tabs
  $$('[data-tabs]', el).forEach((g) => $$('[data-tab]', g).forEach((b) => b.addEventListener('click', () => {
    $$('[data-tab]', g).forEach((x) => x.setAttribute('aria-selected', x === b));
    $$(`[data-panel^="${g.dataset.tabs}:"]`, el).forEach((p) => (p.hidden = p.dataset.panel !== `${g.dataset.tabs}:${b.dataset.tab}`));
  })));

  // highlight the step on the left that matches the stage the animation is passing through
  const STAGE_MS = 1000;
  let stage = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tick = () => {
    $$('#how-steps li', el).forEach((li) => li.classList.toggle('on', +li.dataset.i === stage));
    stage = (stage + 1) % 6;
  };
  tick();
  const ticker = reduce ? null : setInterval(tick, STAGE_MS);

  // circles pulse only when a moving dot actually reaches them; Import pulses as a dot leaves it.
  // Each dot's position is read from the SVG animation clock, so the pulse matches what is on screen.
  const svg = $('#flow', el);
  const nodes = $$('.f-node', el).map((g) => {
    const [, x, y] = g.getAttribute('transform').match(/translate\(([\d.]+) ([\d.]+)\)/);
    return { g, x: +x, y: +y, r: +$('.core', g).getAttribute('r') + 4, start: +x === 48 && +y === 210, t: 0 };
  });
  const dots = $$('.f-pk > g', el).map((g) => {
    const m = $('animateMotion', g), path = $(m.querySelector('mpath').getAttribute('href'), el);
    return { path, len: path.getTotalLength(), begin: parseFloat(m.getAttribute('begin')), dur: parseFloat(m.getAttribute('dur')), inside: null };
  });
  const pulse = (n) => {
    n.g.classList.remove('on'); void n.g.getBoundingClientRect(); n.g.classList.add('on');
    clearTimeout(n.t); n.t = setTimeout(() => n.g.classList.remove('on'), 1000);
  };
  let raf = 0;
  const frame = () => {
    const now = svg.getCurrentTime();
    for (const d of dots) {
      const f = ((((now - d.begin) % d.dur) + d.dur) % d.dur) / d.dur; // keyTimes 0;.85;1: travel, then rest at the end
      const p = d.path.getPointAtLength(Math.min(f / 0.85, 1) * d.len);
      const inside = new Set(nodes.filter((n) => Math.hypot(p.x - n.x, p.y - n.y) < n.r));
      if (d.inside) for (const n of nodes) {
        if (n.start ? d.inside.has(n) && !inside.has(n) : !d.inside.has(n) && inside.has(n)) pulse(n);
      }
      d.inside = inside; // the first frame only records where each dot is, so nothing pulses before a dot arrives
    }
    raf = requestAnimationFrame(frame);
  };
  if (!reduce && svg.getCurrentTime) raf = requestAnimationFrame(frame);
  return () => { clearInterval(ticker); cancelAnimationFrame(raf); nodes.forEach((n) => clearTimeout(n.t)); };
}
