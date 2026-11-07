// THREAD: a payout drawn as one route through six checkpoints.
// Origin → Currency → Recipient → Rules → PayPal → Result
// Every node's state comes from real data: rule findings before sending, PayPal's response after.
// A restriction cuts the thread at that node; later nodes stay inactive.
import { esc, STATUS_LABEL } from './util.js';

export const NODES = [
  { key: 'origin', label: 'Origin', codes: ['SENDER_MISSING', 'SENDER_NOT_ELIGIBLE', 'SENDER_RECEIVE_ONLY', 'SENDER_OK', 'OTHER_ENTITY', 'CROSS_BORDER_ONLY', 'MYR_RESTRICTED'] },
  { key: 'currency', label: 'Currency', codes: ['CURRENCY_MISSING', 'CURRENCY_UNSUPPORTED', 'IN_COUNTRY_CURRENCY', 'BRL_CONVERTED', 'NO_CONVERSION', 'NO_CONVERSION_USD', 'USD_ADVISED', 'NOT_AUTO_CONVERTIBLE', 'CONVERSION', 'NO_DECIMALS', 'TOO_MANY_DECIMALS'] },
  { key: 'recipient', label: 'Recipient', codes: ['RECIPIENT_COUNTRY_MISSING', 'RECIPIENT_NOT_ELIGIBLE', 'RECIPIENT_OK', 'VENMO_US_ONLY', 'RECEIVER_MISSING', 'RECEIVER_MALFORMED', 'RECEIVER_OK'] },
  { key: 'rules', label: 'Rules' }, // amounts, duplicates, workspace policy and anything else
  { key: 'paypal', label: 'PayPal' },
  { key: 'result', label: 'Result' },
];
const RANK = { pass: 0, note: 1, review: 2, block: 3 };
const WORD = { pass: 'Pass', note: 'Pass', review: 'Review', block: 'Stopped', wait: 'Waiting', idle: 'Waiting', off: 'Inactive', live: 'Accepted' };
const GLYPH = {
  pass: '<path d="M6 12.5l4 4L18 8"/>', note: '<path d="M6 12.5l4 4L18 8"/>', live: '<path d="M6 12.5l4 4L18 8"/>',
  review: '<path d="M12 6.5v7M12 17.5v.5"/>', block: '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>',
  wait: '<circle cx="12" cy="12" r="1.6"/>', idle: '<circle cx="12" cy="12" r="1.6"/>', off: '',
};
const RESULT = (s) => s === 'SUCCESS' ? 'pass' : s === 'PENDING' ? 'wait' : ['UNCLAIMED', 'ONHOLD', 'RETURNED', 'REFUNDED'].includes(s) ? 'review' : 'block';

// row = { findings, payout, fromCountry, country, currency, amount, receiver }
export function threadModel(row) {
  const known = new Set(NODES.flatMap((n) => n.codes || []));
  const findings = row.findings || [];
  const nodes = NODES.slice(0, 4).map((n) => {
    const fs = findings.filter((x) => (n.codes ? n.codes.includes(x.code) : !known.has(x.code)));
    const state = fs.reduce((w, x) => (RANK[x.severity] > RANK[w] ? x.severity : w), 'pass');
    const value = { origin: row.fromCountry, currency: row.currency, recipient: row.country, rules: row.amount !== undefined && row.amount !== '' ? `${row.amount}` : '' }[n.key];
    return { ...n, state, value, evidence: fs };
  });
  const p = row.payout;
  nodes.push(p
    ? { ...NODES[4], state: 'live', value: p.batchId ? 'Batch' : '', evidence: [], paypal: p }
    : { ...NODES[4], state: 'idle', value: '', evidence: [] });
  nodes.push(p
    ? { ...NODES[5], state: RESULT(p.status), value: STATUS_LABEL[p.status] || p.status, evidence: [], paypal: p, demo: !!p.demo }
    : { ...NODES[5], state: 'idle', value: '', evidence: [] });
  // interruption: everything after the first stop is inactive
  const cut = nodes.findIndex((n) => n.state === 'block' && n.key !== 'result');
  if (cut >= 0) nodes.forEach((n, i) => { if (i > cut) n.state = 'off'; });
  return { nodes, cut };
}

// seg i joins node i and i+1
const segState = (m, i) => {
  if (m.cut >= 0 && i >= m.cut) return 'cut';
  const next = m.nodes[i + 1].state;
  return next === 'idle' || next === 'wait' ? 'wait' : next === 'review' ? 'warn' : next === 'block' ? 'bad' : 'on';
};

export function threadHTML(m, { selected = null, size = 'md', label = 'Payout route' } = {}) {
  const n = m.nodes.length;
  const segs = m.nodes.slice(0, -1).map((_, i) => `<i class="t-seg ${segState(m, i)}" style="--i:${i}"></i>`).join('');
  const nodes = m.nodes.map((x, i) => `
    <li style="--i:${i}">
      <button type="button" class="t-node ${x.state}${x.demo ? ' demo' : ''}" data-node="${x.key}" aria-pressed="${selected === x.key}" ${x.state === 'off' ? 'aria-disabled="true"' : ''}
        aria-label="${esc(`${x.label}: ${WORD[x.state]}${x.value ? `, ${x.value}` : ''}`)}">
        <span class="t-dot"><svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH[x.state]}</svg></span>
        <b>${x.label}</b><small>${esc(x.state === 'off' ? WORD.off : x.key === 'result' && x.value ? x.value : WORD[x.state])}</small>
        ${size !== 'sm' && x.value && !['result', 'paypal'].includes(x.key) ? `<code>${esc(x.value)}</code>` : ''}
      </button>
      ${i === m.cut ? `<svg class="t-exit" viewBox="0 0 72 34" aria-hidden="true"><path d="M2 33 C 24 33, 26 6, 54 6"/><path class="x" d="M60 2l7 8M67 2l-7 8"/></svg>` : ''}
    </li>`).join('');
  return `<div class="thread ${size}${m.cut >= 0 ? ' has-cut' : ''}" style="--n:${n}" role="group" aria-label="${esc(label)}"><div class="t-track" aria-hidden="true">${segs}</div><ol class="t-nodes">${nodes}</ol></div>`;
}

// mount with motion that follows real state: draw when a new route is shown, pop only nodes that changed (Trace)
export function mountThread(el, row, { key, selected, size, onNode, label } = {}) {
  const m = threadModel(row);
  const prev = el._thread;
  el.innerHTML = threadHTML(m, { selected, size, label });
  const t = el.firstElementChild;
  if (prev && prev.key === key) {
    t.classList.add('still');
    m.nodes.forEach((x, i) => { if (prev.states[i] !== x.state) t.querySelectorAll('.t-node')[i].classList.add('trace'); });
  }
  el._thread = { key, states: m.nodes.map((x) => x.state) };
  if (onNode) t.querySelectorAll('.t-node:not([aria-disabled])').forEach((b) => b.addEventListener('click', () => onNode(b.dataset.node, m)));
  return m;
}

export const nodeWord = (s) => WORD[s];
