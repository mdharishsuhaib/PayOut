// Minimal RFC-4180 CSV parser (quoted fields, commas and newlines inside quotes) + header mapping.
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const HEAD = {
  ref: ['reference', 'ref', 'sender_item_id', 'id', 'invoice'],
  name: ['name', 'recipient_name', 'payee', 'contractor'],
  receiver: ['receiver', 'email', 'recipient', 'paypal_email', 'phone', 'paypal_id'],
  recipientType: ['receiver_type', 'recipient_type', 'type'],
  wallet: ['wallet', 'recipient_wallet', 'method'],
  country: ['country', 'recipient_country', 'to_country', 'destination'],
  currency: ['currency', 'currency_code', 'cur'],
  amount: ['amount', 'value', 'pay'],
  fromCountry: ['from_country', 'sender_country', 'paying_entity_country', 'origin'],
  note: ['note', 'memo', 'description'],
};

export function toRows(text) {
  return toRowsWithMap(text).rows;
}

// also reports which CSV column fed which PayPal field (the Map step)
export function toRowsWithMap(text) {
  const [head, ...body] = parseCsv(text);
  if (!head) return { rows: [], mapping: [] };
  const norm = head.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const idx = Object.fromEntries(Object.entries(HEAD).map(([k, names]) => [k, norm.findIndex((h) => names.includes(h))]));
  const mapping = Object.keys(HEAD).map((k) => ({ field: k, column: idx[k] >= 0 ? head[idx[k]].trim() : null, required: ['receiver', 'country', 'currency', 'amount'].includes(k) }));
  const used = new Set(Object.values(idx).filter((i) => i >= 0));
  const ignored = head.filter((_, i) => !used.has(i)).map((h) => h.trim()).filter(Boolean);
  const rows = body.map((cells) => Object.fromEntries(Object.keys(HEAD).map((k) => [k, idx[k] >= 0 ? (cells[idx[k]] ?? '').trim() : ''])));
  return { rows, mapping, ignored };
}
