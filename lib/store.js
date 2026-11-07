// Tiny persistent store: one JSON file, easy to inspect.
// Every batch and event belongs to one customer account (owner = the PayPal account's user ID, or 'demo' for the
// judges' demo account). Customers only ever read and change their own records.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(process.env.DATA_FILE || 'data/store.json');
let db = { batches: {}, events: [] };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }

// records from before accounts were separated belong to the demo account
for (const b of Object.values(db.batches)) b.owner ||= 'demo';
for (const e of db.events) if (e.owner === undefined) e.owner = e.batchId && db.batches[e.batchId] ? db.batches[e.batchId].owner : null;

let timer = null;
const save = () => { clearTimeout(timer); timer = setTimeout(() => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 1)); }, 100); };

const sorted = (xs) => xs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const batches = {
  // a customer's own batch, or nothing (someone else's batch is treated as not found)
  get: (id, owner) => { const b = db.batches[id]; return b && b.owner === owner ? b : undefined; },
  list: (owner) => sorted(Object.values(db.batches).filter((b) => b.owner === owner)),
  put: (b) => { if (!b.owner) throw new Error('A batch needs an owner'); db.batches[b.id] = b; save(); return b; },
  // PayPal webhooks carry no customer, so they are matched to the batch + row that owns the PayPal item
  findItem({ itemId, ref, payoutBatchId }) {
    for (const b of Object.values(db.batches)) {
      if (payoutBatchId && !(b.payout?.batches || []).some((x) => x.id === payoutBatchId)) continue;
      const row = b.rows.find((r) => (itemId && r.payout?.itemId === itemId) || (ref && r.ref === ref && r.payout));
      if (row) return { batch: b, row };
    }
    return null;
  },
  findPayPalBatch: (payoutBatchId) => Object.values(db.batches).find((x) => (x.payout?.batches || []).some((p) => p.id === payoutBatchId)),
};

export const events = {
  add: (e) => { if (e.owner === undefined) e.owner = e.batchId && db.batches[e.batchId] ? db.batches[e.batchId].owner : null; db.events.unshift(e); db.events = db.events.slice(0, 2000); save(); return e; },
  list: (owner, batchId) => db.events.filter((e) => e.owner === owner && (!batchId || e.batchId === batchId)),
  seen: (id) => db.events.some((e) => e.id === id),
  save,
};
