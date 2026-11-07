// End-to-end smoke test against a running server (default http://localhost:3100).
const B = process.env.BASE || 'http://localhost:3100';
const j = async (p, body, method) => {
  const r = await fetch(B + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json(); if (!r.ok) throw new Error(`${p} ${r.status} ${d.error}`); return d;
};
const cfg = await j('/api/config');
console.log('paypal:', cfg.paypal.ok ? 'sandbox' : 'simulated', '|', cfg.paypal.reason);
let b = await j('/api/batches/sample', {});
console.log('preflight:', b.summary.eligible, 'eligible,', b.summary.review, 'review,', b.summary.blocked, 'blocked');
for (const r of b.rows) console.log(' ', r.ref, r.decision.padEnd(8), r.findings.filter((x) => x.severity !== 'pass').map((x) => x.code).join(', '));
b = await j(`/api/batches/${b.id}/rows/PG-1004`, { acknowledged: true }, 'PATCH');
console.log('after confirming PG-1004:', b.summary.approved, 'approved');
b = await j(`/api/batches/${b.id}/submit`, {});
console.log('submitted:', b.payout.id, b.payout.status, 'simulated=', b.payout.simulated, 'failures=', JSON.stringify(b.payout.failures));
await new Promise((r) => setTimeout(r, 6000));
b = await j(`/api/batches/${b.id}/sync`, {});
for (const r of b.rows.filter((x) => x.payout)) console.log(' ', r.ref, r.payout.status, r.payout.itemId);
const un = b.rows.find((r) => r.payout?.status === 'UNCLAIMED');
if (un) {
  const rec = await j(`/api/batches/${b.id}/rows/${un.ref}/recovery`);
  console.log('recovery', un.ref, rec.status, 'canCancel=', rec.canCancel, '|', rec.text.slice(0, 90));
  b = await j(`/api/batches/${b.id}/rows/${un.ref}/cancel`, { confirm: true });
  console.log('cancelled ->', b.rows.find((r) => r.ref === un.ref).payout.status);
}
const ev = await j('/api/webhooks/paypal', { id: 'WH-TEST-1', event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', resource: { payout_item_id: b.rows.find((r) => r.payout)?.payout.itemId, transaction_status: 'SUCCESS' } });
console.log('webhook:', JSON.stringify(ev));
const a = await j('/api/route/ask', { question: 'Can an Indian business send PayPal payouts?' });
console.log('ask:', a.answer);
