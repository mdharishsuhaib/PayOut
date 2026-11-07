// Deterministic PayPal Payouts route policy.
// Every rule below is transcribed from PayPal's published documentation and carries its source.
// The AI layer never decides eligibility: it only reads these results and explains them.

export const DOCS = {
  countries: 'https://developer.paypal.com/docs/payouts/standard/reference/country-feature/',
  conversion: 'https://developer.paypal.com/docs/payouts/standard/reference/country-feature/#currency-conversion',
  currencies: 'https://developer.paypal.com/api/rest/reference/currency-codes/',
  api: 'https://developer.paypal.com/docs/api/payments.payouts-batch/v1/',
  webhooks: 'https://developer.paypal.com/api/rest/webhooks/event-names/#payouts',
};
export const RULES_VERSION = 'PayPal docs as of 2026-09-10 (countries) / 2026-08-17 (currencies)';

// Feature sets: S = send, receive, withdraw · L = …in local currency · F = fully localized · R = receive and withdraw only
const T = `AD Andorra S|AR Argentina S|AU Australia F|AT Austria F|BS Bahamas S|BH Bahrain S|BE Belgium F|BM Bermuda S|
BW Botswana S|BR Brazil F|BG Bulgaria S|CA Canada F|KY Cayman Islands S|CL Chile S|C2 China F|CO Colombia S|CR Costa Rica S|
HR Croatia S|CY Cyprus L|CZ Czech Republic L|DK Denmark F|DO Dominican Republic S|EC Ecuador L|SV El Salvador S|EE Estonia S|
FO Faroe Islands S|FI Finland L|FR France F|GE Georgia S|DE Germany F|GI Gibraltar S|GR Greece L|GL Greenland S|GT Guatemala S|
HN Honduras S|HK Hong Kong SAR China F|HU Hungary L|IS Iceland S|IN India R|ID Indonesia S|IE Ireland S|IL Israel F|IT Italy F|
JM Jamaica S|JP Japan F|JO Jordan S|KZ Kazakhstan S|KE Kenya S|KW Kuwait S|LV Latvia S|LS Lesotho S|LI Liechtenstein L|
LT Lithuania S|LU Luxembourg L|MY Malaysia L|MT Malta L|MU Mauritius S|MX Mexico R|MD Moldova S|MC Monaco S|MA Morocco S|
MZ Mozambique S|NL Netherlands F|NZ New Zealand L|NI Nicaragua S|NO Norway F|OM Oman S|PA Panama S|PE Peru S|PH Philippines L|
PL Poland F|PT Portugal F|QA Qatar S|RE Réunion S|RO Romania S|SM San Marino L|SA Saudi Arabia S|SN Senegal S|RS Serbia S|
SG Singapore F|SK Slovakia S|SI Slovenia L|ZA South Africa S|ES Spain F|SE Sweden F|CH Switzerland F|TR Turkey F|
AE United Arab Emirates S|GB United Kingdom F|US United States F|UY Uruguay S|VE Venezuela S|VN Vietnam S`;

const SETS = { S: 'Send, receive, and withdraw', L: 'Send, receive, and withdraw in local currency', F: 'Fully localized', R: 'Receive and withdraw' };
export const COUNTRIES = Object.fromEntries(T.split('|').map((s) => s.trim()).map((s) => {
  const m = s.match(/^(\w\w) (.+) ([SLFR])$/);
  return [m[1], { code: m[1], name: m[2], set: m[3], label: SETS[m[3]], canSend: m[3] !== 'R' }];
}));
// "Cross-border only" footnote: Colombia and Monaco can only send and receive cross-border payouts.
const CROSS_BORDER_ONLY = new Set(['CO', 'MC']);

// Not in PayPal's eligible list but commonly typed: names we recognise so we can say so explicitly.
const OTHER_NAMES = { NG: 'Nigeria', PK: 'Pakistan', BD: 'Bangladesh', EG: 'Egypt', KR: 'South Korea', TW: 'Taiwan', TH: 'Thailand',
  BO: 'Bolivia', PY: 'Paraguay', GY: 'Guyana', SR: 'Suriname', BB: 'Barbados', AW: 'Aruba', AI: 'Anguilla', AG: 'Antigua and Barbuda',
  VG: 'British Virgin Islands', FK: 'Falkland Islands', GD: 'Grenada', MS: 'Montserrat', AN: 'Netherlands Antilles', VC: 'Saint Vincent and the Grenadines',
  RU: 'Russia', UA: 'Ukraine', GH: 'Ghana', LK: 'Sri Lanka', NP: 'Nepal' };
export const countryName = (c) => COUNTRIES[c]?.name || OTHER_NAMES[c] || c;

// Currency conversion exclusions (payouts TO these destinations cannot be auto-converted).
const EXCL_ASIA = ['C2', 'IN', 'KR', 'TW', 'TH', 'TR'];
const EXCL_CARIB = ['AI', 'AG', 'AW', 'BS', 'BB', 'BM', 'VG', 'KY', 'FK', 'GD', 'JM', 'MS', 'AN', 'VC', 'SR'];
const EXCL_LATAM = ['AR', 'BO', 'CL', 'CO', 'CR', 'DO', 'EC', 'SV', 'GT', 'GY', 'HN', 'NI', 'PA', 'PY', 'PE', 'UY', 'VE'];
export const NO_CONVERSION = new Map([...EXCL_ASIA.map((c) => [c, 'Asia']), ...EXCL_CARIB.map((c) => [c, 'Caribbean']), ...EXCL_LATAM.map((c) => [c, 'Latin America'])]);

// REST API currency codes. Zero-decimal currencies error if a decimal amount is passed.
export const CURRENCIES = ['AUD', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'EUR', 'HKD', 'HUF', 'ILS', 'JPY', 'MYR', 'MXN', 'TWD', 'NZD', 'NOK', 'PHP', 'PLN', 'GBP', 'RUB', 'SGD', 'SEK', 'CHF', 'THB', 'USD'];
const NO_DECIMALS = new Set(['HUF', 'JPY', 'TWD']);
const IN_COUNTRY_ONLY = { CNY: 'C2', MYR: 'MY' }; // footnote 3
// Currencies PayPal Payouts can auto-convert into the recipient's account currency.
const AUTO_CONVERT = new Set(['AUD', 'CAD', 'EUR', 'MXN', 'GBP', 'USD', 'CHF', 'SEK', 'PLN', 'NOK', 'HUF', 'DKK', 'CZK', 'ILS', 'HKD', 'NZD', 'IDR', 'PHP', 'JPY', 'SGD']);

// Local currency per destination, used only to tell whether a conversion would be needed.
const EUR = 'AD AT BE HR CY EE FI FR DE GR IE IT LV LT LU MT MC NL PT SM SK SI ES RE'.split(' ');
const LOCAL = { ...Object.fromEntries(EUR.map((c) => [c, 'EUR'])), US: 'USD', EC: 'USD', SV: 'USD', PA: 'USD', GB: 'GBP', AU: 'AUD', CA: 'CAD',
  CH: 'CHF', LI: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', FO: 'DKK', GL: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', IL: 'ILS', HK: 'HKD',
  NZ: 'NZD', ID: 'IDR', PH: 'PHP', JP: 'JPY', SG: 'SGD', MX: 'MXN', BR: 'BRL', MY: 'MYR', C2: 'CNY', IN: 'INR', TR: 'TRY', TH: 'THB' };

// Not a PayPal rule: a safety check so the customer confirms an unusually large single payout before it is sent.
export const REVIEW_AMOUNT = Number(process.env.REVIEW_AMOUNT || 2500);
export const MAX_ITEMS = 15000; // PayPal: up to 15,000 payments per batch request

const ALIASES = { CN: 'C2', UK: 'GB', USA: 'US', INDIA: 'IN' };
export function normCountry(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return '';
  if (ALIASES[s]) return ALIASES[s];
  if (s.length === 2) return s;
  const hit = Object.values(COUNTRIES).find((c) => c.name.toUpperCase() === s) || Object.entries(OTHER_NAMES).find(([, n]) => n.toUpperCase() === s);
  return hit ? (hit.code || hit[0]) : s;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9][0-9 ()-]{6,18}$/;
const PAYPAL_ID = /^[A-Z0-9]{13}$/;

const f = (severity, code, title, detail, source, fix) => ({ severity, code, title, detail, source, ...(fix ? { fix } : {}) });

// One route = sender country → recipient country in a currency. Used by the preflight and by the AI's tool.
export function checkRoute({ from, to, currency, wallet = 'PAYPAL' }) {
  const out = [];
  from = normCountry(from); to = normCountry(to); currency = String(currency || '').trim().toUpperCase();
  const F = COUNTRIES[from], R = COUNTRIES[to];

  if (!from) out.push(f('block', 'SENDER_MISSING', 'Sending country missing', 'Set the country of the PayPal business account that sends this batch.', DOCS.countries));
  else if (!F) out.push(f('block', 'SENDER_NOT_ELIGIBLE', `${countryName(from)} can't send Payouts`, `${countryName(from)} is not on PayPal's list of countries eligible for Payouts.`, DOCS.countries));
  else if (!F.canSend) out.push(f('block', 'SENDER_RECEIVE_ONLY', `${F.name} can't send Payouts`, `PayPal classifies ${F.name} as "Receive and withdraw": merchants cannot send payouts from this country. Accounts there can still receive payouts from eligible countries.`, DOCS.countries));
  else out.push(f('pass', 'SENDER_OK', `${F.name} can send`, `Feature set: ${F.label}.`, DOCS.countries));

  if (!to) out.push(f('block', 'RECIPIENT_COUNTRY_MISSING', 'Recipient country missing', 'Add the recipient\'s country so the route can be checked.', DOCS.countries));
  else if (!R) out.push(f('block', 'RECIPIENT_NOT_ELIGIBLE', `${countryName(to)} isn't a Payouts destination`, `${countryName(to)} is not on PayPal's list of countries eligible for Payouts.`, DOCS.countries));
  else out.push(f('pass', 'RECIPIENT_OK', `${R.name} can receive`, `Feature set: ${R.label}.`, DOCS.countries));

  if (F && R && CROSS_BORDER_ONLY.has(from) && from === to) out.push(f('block', 'CROSS_BORDER_ONLY', `${F.name} payouts must be cross-border`, `PayPal notes ${F.name} can only send and receive cross-border payouts.`, DOCS.countries));
  if (wallet === 'VENMO' && to && to !== 'US') out.push(f('block', 'VENMO_US_ONLY', 'Venmo is US-only', 'Venmo can be used as a payout method only for recipients in the United States.', DOCS.countries, { label: 'Send to PayPal instead', patch: { wallet: 'PAYPAL' } }));

  if (!currency) out.push(f('block', 'CURRENCY_MISSING', 'Currency missing', 'Set an ISO-4217 currency code.', DOCS.currencies));
  else if (!CURRENCIES.includes(currency)) {
    const usd = { label: 'Pay in USD instead', patch: { currency: 'USD', amount: null }, needs: 'amount' };
    out.push(f('block', 'CURRENCY_UNSUPPORTED', `${currency} isn't a PayPal currency`, `${currency} is not in PayPal's REST API currency list, so the payout would be rejected.${to === 'IN' ? ' Indian recipients are usually paid in USD and withdraw to their bank in INR.' : ''}`, DOCS.currencies, usd));
  } else {
    const home = IN_COUNTRY_ONLY[currency];
    if (home && (from !== home || to !== home)) out.push(f('block', 'IN_COUNTRY_CURRENCY', `${currency} is in-country only`, `PayPal supports ${currency} only for in-country ${countryName(home)} accounts.`, DOCS.currencies, { label: 'Pay in USD instead', patch: { currency: 'USD', amount: null }, needs: 'amount' }));
    if (currency === 'BRL' && to !== 'BR') out.push(f('review', 'BRL_CONVERTED', 'BRL will be converted', 'BRL is supported only for in-country Brazilian accounts. PayPal converts it into the recipient\'s primary currency, at a rate that includes PayPal\'s spread.', DOCS.currencies));

    // conversion into the destination
    const local = LOCAL[to], region = NO_CONVERSION.get(to);
    if (region && currency !== local) {
      if (region !== 'Asia' && currency === 'USD') out.push(f('pass', 'USD_ADVISED', 'USD is the advised currency', `PayPal can't auto-convert payouts to ${countryName(to)}; send USD and the recipient withdraws in local currency from their bank.`, DOCS.conversion));
      else if (region === 'Asia' && currency === 'USD') out.push(f('note', 'NO_CONVERSION_USD', `No automatic conversion to ${countryName(to)}`, `PayPal does not auto-convert payouts to ${countryName(to)}. A USD payout arrives as USD; confirm the recipient's account accepts USD.`, DOCS.conversion));
      else out.push(f('review', 'NO_CONVERSION', `${currency} can't be converted for ${countryName(to)}`, `PayPal excludes ${countryName(to)} (${region}) from automatic payout currency conversion. A ${currency} payout only works if the recipient already holds ${currency}.${region !== 'Asia' ? ' PayPal advises sending USD.' : ''}`, DOCS.conversion, currency !== 'USD' ? { label: 'Pay in USD instead', patch: { currency: 'USD', amount: null }, needs: 'amount' } : undefined));
    } else if (local && currency !== local) {
      if (!AUTO_CONVERT.has(currency)) out.push(f('review', 'NOT_AUTO_CONVERTIBLE', `${currency} isn't auto-convertible`, `${currency} is not on PayPal's list of currencies for automatic payout conversion, and the usual currency in ${countryName(to)} is ${local}.`, DOCS.conversion));
      else out.push(f('note', 'CONVERSION', `Converts to ${local}`, `If the recipient holds ${local}, PayPal converts ${currency} at a rate that includes its spread or fee.`, DOCS.conversion));
    }
    if (currency === 'MYR' && from === 'MY' && to !== 'MY') out.push(f('block', 'MYR_RESTRICTED', 'MYR cannot leave Malaysia', 'Malaysian users cannot send MYR balances to non-Malaysian users, or payouts that require exchange to or from MYR.', DOCS.countries));
  }
  return out;
}

function checkRecipient(row) {
  const { receiver, recipientType } = row, out = [];
  if (!receiver) return [f('block', 'RECEIVER_MISSING', 'Recipient missing', 'No email, phone or PayPal ID was given. A payout to a wrong address may not be reversible, so it is never guessed.', DOCS.api)];
  const ok = recipientType === 'PHONE' ? PHONE.test(receiver) : recipientType === 'PAYPAL_ID' ? PAYPAL_ID.test(receiver) : EMAIL.test(receiver);
  if (!ok) out.push(f('block', 'RECEIVER_MALFORMED', `Malformed ${recipientType.toLowerCase().replace('_', ' ')}`, `"${receiver}" is not a valid ${recipientType.toLowerCase().replace('_', ' ')}. Payouts to a wrong address may be unrecoverable.`, DOCS.api));
  else out.push(f('pass', 'RECEIVER_OK', 'Recipient looks valid', `${recipientType}: ${receiver}`, DOCS.api));
  return out;
}

function checkAmount(row) {
  const { amount, currency } = row, out = [];
  if (amount === null || amount === '' || !Number.isFinite(Number(amount))) return [f('block', 'AMOUNT_MISSING', 'Amount missing', 'Enter the amount to pay.', DOCS.api)];
  const n = Number(amount);
  if (n <= 0) return [f('block', 'AMOUNT_INVALID', 'Amount must be above zero', `Got ${amount}.`, DOCS.api)];
  const dec = (String(amount).split('.')[1] || '').length;
  if (NO_DECIMALS.has(currency) && dec > 0 && Number(String(amount).split('.')[1]) > 0) out.push(f('block', 'NO_DECIMALS', `${currency} has no decimals`, `PayPal returns an error if a decimal amount is passed for ${currency}.`, DOCS.currencies, { label: `Round to ${Math.round(n)}`, patch: { amount: String(Math.round(n)) } }));
  else if (dec > 2) out.push(f('block', 'TOO_MANY_DECIMALS', 'Too many decimals', 'Amounts can have at most two decimal places.', DOCS.api, { label: `Round to ${n.toFixed(2)}`, patch: { amount: n.toFixed(2) } }));
  if (currency === 'USD' && n >= REVIEW_AMOUNT) out.push(f('review', 'LARGE_AMOUNT', 'Large payout', `${n.toFixed(2)} USD is above PayOut's large-payout check of ${REVIEW_AMOUNT} USD. Confirm the amount before you send it. (PayOut safety check, not a PayPal rule.)`, null));
  return out;
}

const RANK = { pass: 0, note: 0, review: 1, block: 2 };
export const decide = (findings) => ['eligible', 'review', 'blocked'][Math.max(0, ...findings.map((x) => RANK[x.severity]))];

// Evaluates a whole batch: per-row route/recipient/amount checks plus cross-row duplicate checks.
export function preflight(rows, { senderCountry = 'US' } = {}) {
  const seenKey = new Map(), seenRef = new Map();
  const batchFindings = rows.length > MAX_ITEMS ? [f('block', 'TOO_MANY_ITEMS', 'Batch too large', `PayPal accepts up to ${MAX_ITEMS} payouts per batch; split this file.`, DOCS.api)] : [];
  const curs = [...new Set(rows.map((r) => String(r.currency || '').trim().toUpperCase()).filter((c) => CURRENCIES.includes(c)))];
  if (curs.length > 1) batchFindings.push(f('note', 'SPLIT_BY_CURRENCY', `Sent as ${curs.length} PayPal batches`, `PayPal rejects a payout request that mixes currencies ("Multiple currencies within a batch is not allowed"), so approved rows go out as one batch per currency: ${curs.join(', ')}.`, DOCS.api));
  const out = rows.map((r) => {
    const row = { ...r, fromCountry: normCountry(r.fromCountry || senderCountry), country: normCountry(r.country), currency: String(r.currency || '').trim().toUpperCase() };
    const findings = [
      ...checkRoute({ from: row.fromCountry, to: row.country, currency: row.currency, wallet: row.wallet }),
      ...checkRecipient(row),
      ...checkAmount(row),
    ];
    if (row.fromCountry !== normCountry(senderCountry) && COUNTRIES[row.fromCountry]?.canSend) findings.push(f('review', 'OTHER_ENTITY', 'Different paying entity', `This row is marked as paid from ${countryName(row.fromCountry)}, but you send from a ${countryName(normCountry(senderCountry))} PayPal account. Confirm which account should pay it.`, null));
    if (row.ref && seenRef.has(row.ref)) findings.push(f('block', 'DUPLICATE_REFERENCE', 'Duplicate reference', `Reference ${row.ref} is already used on line ${seenRef.get(row.ref)}. Each payout needs a unique sender_item_id.`, DOCS.api));
    if (row.ref) seenRef.set(row.ref, row.line);
    const key = [String(row.receiver || '').toLowerCase(), row.currency, Number(row.amount)].join('|');
    if (row.receiver && seenKey.has(key)) findings.push(f('review', 'POSSIBLE_DUPLICATE', 'Possible duplicate payment', `Same recipient, amount and currency as line ${seenKey.get(key)}. Confirm it is intended before paying twice.`, null));
    else if (row.receiver) seenKey.set(key, row.line);
    return { ...row, findings, decision: decide(findings) };
  });
  return { rows: out, batchFindings };
}

export function countryProfile(code) {
  const c = normCountry(code), C = COUNTRIES[c];
  return {
    code: c, name: countryName(c), eligible: !!C, featureSet: C?.label || 'Not eligible for Payouts',
    canSendPayouts: !!C?.canSend, canReceivePayouts: !!C, localCurrency: LOCAL[c] || null,
    automaticConversion: NO_CONVERSION.has(c) ? `Excluded (${NO_CONVERSION.get(c)})` : 'Available',
    source: DOCS.countries,
  };
}

const CUR_NAMES = { AUD: 'Australian dollar', BRL: 'Brazilian real', CAD: 'Canadian dollar', CNY: 'Chinese renminbi', CZK: 'Czech koruna', DKK: 'Danish krone', EUR: 'Euro',
  HKD: 'Hong Kong dollar', HUF: 'Hungarian forint', ILS: 'Israeli new shekel', JPY: 'Japanese yen', MYR: 'Malaysian ringgit', MXN: 'Mexican peso', TWD: 'New Taiwan dollar',
  NZD: 'New Zealand dollar', NOK: 'Norwegian krone', PHP: 'Philippine peso', PLN: 'Polish złoty', GBP: 'Pound sterling', RUB: 'Russian ruble', SGD: 'Singapore dollar',
  SEK: 'Swedish krona', CHF: 'Swiss franc', THB: 'Thai baht', USD: 'United States dollar', INR: 'Indian rupee', IDR: 'Indonesian rupiah' };
const CUR_NOTE = {
  BRL: 'Payment currency and balance for in-country Brazilian accounts only; converted for recipients outside Brazil.',
  CNY: 'Supported only for in-country China accounts.', MYR: 'Supported only for in-country Malaysia accounts; cannot leave Malaysia.',
  INR: 'Not a PayPal REST currency. Pay Indian recipients in USD; they withdraw to their bank in INR.',
  IDR: 'Accepted for automatic conversion, but not listed as a REST payment currency.',
};
export function currencyRules() {
  const all = [...new Set([...CURRENCIES, ...AUTO_CONVERT, 'INR'])];
  return all.sort().map((code) => ({
    code, name: CUR_NAMES[code] || code, payment: CURRENCIES.includes(code), autoConvert: AUTO_CONVERT.has(code),
    decimals: !NO_DECIMALS.has(code), inCountryOnly: IN_COUNTRY_ONLY[code] ? countryName(IN_COUNTRY_ONLY[code]) : null,
    note: CUR_NOTE[code] || (NO_DECIMALS.has(code) ? 'Whole amounts only: a decimal amount causes an error.' : ''),
    source: CURRENCIES.includes(code) ? DOCS.currencies : DOCS.conversion,
  }));
}
