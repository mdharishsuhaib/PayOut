import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { preflight, checkRoute, decide } from '../lib/rules.js';
import { toRows } from '../lib/csv.js';

const codes = (fs_) => fs_.filter((x) => x.severity !== 'pass').map((x) => x.code);

test('sample batch gets the documented decisions', () => {
  const rows = toRows(fs.readFileSync('data/sample.csv', 'utf8')).map((r, i) => ({ ...r, line: i + 1, receiver: r.receiver.replace(/\{\{SANDBOX_RECEIVER(_IN)?\}\}/, 'sb-test@personal.example.com'), recipientType: 'EMAIL', wallet: 'PAYPAL' }));
  const out = Object.fromEntries(preflight(rows, { senderCountry: 'US' }).rows.map((r) => [r.ref, r]));
  const expect = { 'PG-1001': 'eligible', 'PG-1002': 'blocked', 'PG-1003': 'eligible', 'PG-1004': 'review', 'PG-1005': 'blocked', 'PG-1006': 'review',
    'PG-1007': 'eligible', 'PG-1008': 'blocked', 'PG-1009': 'review', 'PG-1010': 'blocked', 'PG-1011': 'blocked' };
  for (const [ref, d] of Object.entries(expect)) assert.equal(out[ref].decision, d, `${ref}: ${codes(out[ref].findings)}`);
  assert.ok(codes(out['PG-1002'].findings).includes('SENDER_RECEIVE_ONLY'));
  assert.ok(codes(out['PG-1005'].findings).includes('CURRENCY_UNSUPPORTED'));
  assert.ok(codes(out['PG-1006'].findings).includes('POSSIBLE_DUPLICATE'));
  assert.ok(codes(out['PG-1008'].findings).includes('NO_DECIMALS'));
});

test('India can receive but not send', () => {
  assert.equal(decide(checkRoute({ from: 'IN', to: 'US', currency: 'USD' })), 'blocked');
  assert.equal(decide(checkRoute({ from: 'US', to: 'IN', currency: 'USD' })), 'eligible');
  assert.equal(decide(checkRoute({ from: 'US', to: 'IN', currency: 'EUR' })), 'review');
});

test('Mexico is receive-only; Venmo is US-only; CNY is in-country only', () => {
  assert.equal(decide(checkRoute({ from: 'MX', to: 'US', currency: 'USD' })), 'blocked');
  assert.equal(decide(checkRoute({ from: 'US', to: 'GB', currency: 'GBP', wallet: 'VENMO' })), 'blocked');
  assert.equal(decide(checkRoute({ from: 'US', to: 'C2', currency: 'CNY' })), 'blocked');
  assert.equal(decide(checkRoute({ from: 'US', to: 'AR', currency: 'USD' })), 'eligible');
});
