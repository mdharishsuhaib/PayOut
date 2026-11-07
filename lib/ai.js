// AI layer. It interprets questions and explains results; it never decides eligibility.
// Chat model: Ollama Cloud (AI_API_KEY / AI_BASE_URL / AI_MODEL, OpenAI-compatible API).
// Fallback when the model is unavailable: Tavily search restricted to PayPal's own sites (TAVILY_API_KEY),
// and after that the deterministic PayPal rule templates.
import { checkRoute, countryProfile, COUNTRIES, CURRENCIES, decide, normCountry, countryName, DOCS } from './rules.js';
import { matchFaq, NO_OPEN } from './faq.js';

const provider = () => ({ key: process.env.AI_API_KEY, base: process.env.AI_BASE_URL || 'https://ollama.com/v1', model: process.env.AI_MODEL || 'gpt-oss:120b' });
export const llmLive = () => !!provider().key;
export const llmModel = () => (llmLive() ? provider().model : null);
export const searchLive = () => !!process.env.TAVILY_API_KEY;
export const SEARCH_NAME = 'Tavily';

const cleanError = (body) => {
  const t = body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  try { const j = JSON.parse(t); return j.error?.message || j.detail?.error || j.detail || t; } catch { return t; }
};

async function chat(messages, tools) {
  const p = provider();
  if (!p.key) throw new Error('No AI model configured');
  const r = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: p.model, messages, temperature: 0.1, ...(tools ? { tools } : {}) }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) { const e = `${p.model} ${r.status}: ${String(cleanError(await r.text())).slice(0, 140)}`; console.warn(`AI failed: ${e}`); throw new Error(e); }
  const m = (await r.json()).choices?.[0]?.message;
  if (!m || (!m.content && !m.tool_calls?.length)) throw new Error(`${p.model} returned an empty answer`);
  return Object.defineProperty(m, 'model', { value: p.model, enumerable: false });
}

// ---- Tavily: search PayPal's own documentation and help pages for a short, sourced answer ----
const PAYPAL_SITES = ['developer.paypal.com', 'paypal.com'];
export async function searchPayPal(question) {
  if (!searchLive()) return null;
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `PayPal Payouts: ${question}`.slice(0, 380), include_answer: 'basic', max_results: 4, include_domains: PAYPAL_SITES }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) { console.warn(`Tavily failed: ${r.status} ${String(cleanError(await r.text())).slice(0, 140)}`); return null; }
    const j = await r.json();
    const sources = [...new Set((j.results || []).map((x) => x.url).filter((u) => PAYPAL_SITES.some((d) => new URL(u).hostname.endsWith(d))))].slice(0, 3);
    return j.answer ? { answer: j.answer.trim(), sources } : null;
  } catch (e) { console.warn(`Tavily failed: ${e.message}`); return null; }
}

const GROUND = `You are PayPal AI, an operations assistant for PayPal Payouts.
Rules you must follow:
- Eligibility comes ONLY from tool results or the findings you are given. Never invent PayPal rules, limits, fees or countries.
- If the tools don't cover something (account-specific limits, KYC, tax), say it must be checked with PayPal; do not guess.
- Be precise about direction: a country that can't SEND payouts may still RECEIVE them.
- Plain English, short sentences, no marketing. Quote currency codes and country names exactly.`;

const TOOLS = [
  { type: 'function', function: { name: 'country_profile', description: 'PayPal Payouts feature set, local currency and conversion status for one country.', parameters: { type: 'object', properties: { country: { type: 'string', description: 'ISO country code or name' } }, required: ['country'] } } },
  { type: 'function', function: { name: 'check_route', description: 'Deterministic check of a payout route: sending country, recipient country, currency and wallet.', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, currency: { type: 'string' }, wallet: { type: 'string', enum: ['PAYPAL', 'VENMO'] } }, required: ['from', 'to', 'currency'] } } },
];
const runTool = (name, a) => name === 'country_profile' ? countryProfile(a.country) : { decision: decide(checkRoute(a)), findings: checkRoute(a) };

// ---- Route intelligence: "Can an Indian business send mass payouts?" ----
const NAME_INDEX = [...Object.values(COUNTRIES).map((c) => [c.name.toLowerCase(), c.code]),
  ['indian', 'IN'], ['india', 'IN'], ['american', 'US'], ['usa', 'US'], ['u.s.', 'US'], ['uk', 'GB'], ['british', 'GB'], ['britain', 'GB'],
  ['mexican', 'MX'], ['brazilian', 'BR'], ['german', 'DE'], ['french', 'FR'], ['japanese', 'JP'], ['chinese', 'C2'], ['china', 'C2'], ['canadian', 'CA'],
  ['australian', 'AU'], ['nigeria', 'NG'], ['nigerian', 'NG'], ['pakistan', 'PK'], ['philippine', 'PH'], ['filipino', 'PH'], ['kenyan', 'KE'], ['malaysian', 'MY']]
  .sort((a, b) => b[0].length - a[0].length);

function findCountries(q) {
  const s = ` ${q.toLowerCase().replace(/[^a-z.\s]/g, ' ')} `, hits = [];
  for (const [n, c] of NAME_INDEX) {
    const i = s.indexOf(` ${n} `);
    if (i >= 0 && !hits.some((h) => h.c === c)) hits.push({ c, i });
  }
  return hits.sort((a, b) => a.i - b.i);
}

function templateAnswer(q) {
  const hits = findCountries(q), cur = (q.toUpperCase().match(/\b[A-Z]{3}\b/g) || []).find((c) => CURRENCIES.includes(c) || c === 'INR');
  if (!hits.length) return { answer: 'Name at least one country, for example: "Can a business in India send payouts to freelancers in Germany?"', findings: [], sources: [DOCS.countries] };
  const lower = q.toLowerCase();
  const sendsFrom = /\b(send|pay|originate|from|business|merchant|company)\b/.test(lower);
  const from = hits[0].c, to = hits[1]?.c;
  const lines = [], findings = [];
  const P = countryProfile(from);
  if (!to) {
    lines.push(`${P.name}: ${P.featureSet}.`);
    if (P.eligible) lines.push(P.canSendPayouts ? `Merchants in ${P.name} can send Payouts.` : `Merchants in ${P.name} cannot send (originate) Payouts, but PayPal accounts there can receive and withdraw payouts sent from eligible countries.`);
    else lines.push(`${P.name} is not on PayPal's list of Payouts countries, so it can neither send nor receive Payouts.`);
    if (P.eligible) lines.push(`Automatic currency conversion into ${P.name}: ${P.automaticConversion.startsWith('Excluded') ? P.automaticConversion.replace('Excluded', 'not available') : 'available'}.`);
    if (sendsFrom && !P.canSendPayouts && P.eligible) lines.push(`To pay international freelancers, the payouts have to be sent from a PayPal business account in an eligible sending country.`);
    return { answer: lines.join(' '), findings: [], profile: P, sources: [DOCS.countries, DOCS.conversion] };
  }
  const route = checkRoute({ from, to, currency: cur || 'USD' });
  const bad = route.filter((x) => x.severity !== 'pass');
  lines.push(`Route ${countryName(from)} → ${countryName(to)} in ${cur || 'USD'}: ${decide(route)}.`);
  for (const x of bad.length ? bad : route) lines.push(x.detail);
  if (!cur) lines.push('(No currency was named, so USD was assumed.)');
  findings.push(...route);
  return { answer: lines.join(' '), findings, sources: [...new Set(route.map((x) => x.source).filter(Boolean))] };
}

export async function askRoute(question) {
  try { return await askRouteAI(question); } catch (e) { return { ...(await fallbackAnswer(question)), aiError: e.message.slice(0, 120) }; }
}
// model unavailable: PayPal's rule tables answer route questions; Tavily searches PayPal's own pages for everything else
async function fallbackAnswer(question) {
  const t = templateAnswer(question), web = await searchPayPal(question);
  if (!findCountries(question).length && web) return { answer: web.answer, sources: web.sources, findings: [], ai: false, via: SEARCH_NAME };
  return { ...t, ai: false, ...(web ? { web: { ...web, via: SEARCH_NAME } } : {}) };
}
async function askRouteAI(question) {
  if (!llmLive()) return fallbackAnswer(question);
  const messages = [{ role: 'system', content: `${GROUND}\nAlways call a tool before answering any question about a country or route. End with the source URLs you relied on.` }, { role: 'user', content: question }];
  const used = [];
  for (let i = 0; i < 5; i++) {
    const m = await chat(messages, TOOLS);
    messages.push({ role: 'assistant', content: m.content || '', ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) }); // standard fields only, so either provider can continue
    if (!m.tool_calls?.length) {
      const sources = [...new Set(used.flatMap((u) => u.result.findings ? u.result.findings.map((x) => x.source) : [u.result.source]).filter(Boolean))];
      return { answer: m.content, findings: used.flatMap((u) => u.result.findings || []), tools: used, sources, ai: true, model: m.model };
    }
    for (const tc of m.tool_calls) {
      const args = JSON.parse(tc.function.arguments || '{}'), result = runTool(tc.function.name, args);
      used.push({ name: tc.function.name, args, result });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  return fallbackAnswer(question);
}

// ---- Ask: contextual answer with three clearly separated layers ----
// fact   = what PayPal itself returned (status, error) for the selected payout
// policy = what PayPal's published-rule checks found
// ai     = suggestion (LLM when available, otherwise the fixed playbook wording)
export async function askContext(question, ctx) {
  if (!ctx) {
    const faq = matchFaq(question), exact = faq && faq.q.toLowerCase() === question.trim().toLowerCase().replace(/[?.!]+$/, '?');
    // a typed route question ("US to Germany in EUR?") is checked against the rules; known questions use the prepared answer
    if (faq && (exact || findCountries(question).length < 2)) {
      return { kind: 'general', ai: false, faq: faq.q, layers: { note: faq.status ? NO_OPEN : null, policy: faq.policy, suggestion: faq.next, sources: faq.src } };
    }
    const r = await askRoute(question);
    const search = r.via ? r.answer : r.web?.answer;
    return { ...r, kind: 'general', layers: { policy: r.via ? null : r.answer, search, searchVia: r.via || r.web?.via, sources: [...new Set([...(r.sources || []), ...(r.web?.sources || [])])] } };
  }
  if (ctx.kind === 'route') {
    const { from, to, currency, wallet } = ctx.route;
    const findings = checkRoute({ from, to, currency, wallet });
    const issues = findings.filter((x) => x.severity !== 'pass');
    const policy = `${countryName(normCountry(from))} → ${countryName(normCountry(to))} in ${currency}: ${decide(findings)}. ${(issues.length ? issues : findings).map((x) => x.detail).join(' ')}`;
    const r = await askRoute(`Can a business in ${countryName(normCountry(from))} pay someone in ${countryName(normCountry(to))} in ${currency}${wallet === 'VENMO' ? ' using Venmo' : ''}? ${question || ''}`);
    return { kind: 'route', ai: r.ai, model: r.model, layers: { policy, suggestion: r.ai ? r.answer : null, sources: [...new Set(findings.map((x) => x.source).filter(Boolean))] }, findings };
  }
  const { row, playbook } = ctx;
  const issues = row.findings.filter((x) => x.severity !== 'pass');
  const policy = issues.length ? issues.map((x) => `${x.title}: ${x.detail}`).join(' ') : `All published checks passed for ${countryName(row.fromCountry)} → ${countryName(row.country)} in ${row.currency}.`;
  const fact = row.payout ? `PayPal reports ${row.payout.status}${row.payout.error ? ` with error ${row.payout.error}` : ''} for item ${row.payout.itemId || '(not yet assigned)'} in batch ${row.payout.batchId || ''}.${row.payout.demo ? ' This status is a labelled demo, not from PayPal.' : ''}` : 'Not sent to PayPal yet, so there is no PayPal response.';
  let suggestion = playbook ? `${playbook.next}` : issues.find((x) => x.fix)?.fix?.label ? `Suggested fix: ${issues.find((x) => x.fix).fix.label}.` : row.decision === 'eligible' ? 'This row can be approved and sent.' : row.decision === 'review' ? 'Confirm the flagged point with the recipient before approving.' : 'Do not send this row until the restriction is fixed.';
  let ai = false, model = null;
  if (llmLive()) {
    try {
      const m = await chat([
        { role: 'system', content: `${GROUND}\nAnswer the customer's question about ONE of their own payouts in at most 3 sentences. You are given PayPal's actual response (fact), PayPal's rule findings (policy) and the fixed playbook. Never contradict the fact or policy; say when something cannot be determined.` },
        { role: 'user', content: JSON.stringify({ question, fact, policy: row.findings, decision: row.decision, playbook }) },
      ]);
      suggestion = m.content; ai = true; model = m.model;
    } catch { /* keep playbook wording */ }
  }
  return { kind: 'row', ai, model, ref: row.ref, layers: { fact, policy, suggestion, sources: [...new Set(row.findings.map((x) => x.source).filter(Boolean))] } };
}

// ---- Row explanation ----
export async function explainRow(row) {
  const issues = row.findings.filter((x) => x.severity !== 'pass');
  const fallback = issues.length ? issues.map((x) => `${x.title}. ${x.detail}`).join(' ') : `Every published route check passed for ${countryName(row.fromCountry)} → ${countryName(row.country)} in ${row.currency}.`;
  if (!llmLive()) return { text: fallback, ai: false };
  try {
    const m = await chat([
      { role: 'system', content: `${GROUND}\nExplain one payout row's preflight result to the business customer who is sending it, in at most 3 sentences, addressing them as you, then one sentence starting "Next:" with the safest next step. Do not change the decision.` },
      { role: 'user', content: JSON.stringify({ decision: row.decision, route: `${row.fromCountry} -> ${row.country}`, currency: row.currency, amount: row.amount, wallet: row.wallet, findings: row.findings }) },
    ]);
    return { text: m.content, ai: true, model: m.model };
  } catch { return { text: fallback, ai: false }; }
}

// ---- Recovery explanation + recipient message ----
export async function recoveryNote(item, play) {
  const name = item.name || 'there';
  const draft = play.status === 'UNCLAIMED'
    ? `Hi ${name}, we sent you ${item.amount} ${item.currency} through PayPal to ${item.receiver}. It hasn't been claimed yet. Please sign in to (or create) a PayPal account with this address to claim it. If this address is wrong, reply with the correct one and we will reissue the payment.`
    : `Hi ${name}, your payout of ${item.amount} ${item.currency} via PayPal is currently ${play.title.toLowerCase()}. ${play.status === 'BLOCKED' ? 'Could you share another PayPal account we can pay?' : 'We are looking into it and will update you.'}`;
  const fallback = { text: `${play.meaning} ${play.next}${play.error?.hint ? ` PayPal error ${play.error.name}: ${play.error.hint}` : ''}`, draft, ai: false };
  if (!llmLive()) return fallback;
  let m;
  try {
    m = await chat([
      { role: 'system', content: `${GROUND}\nYou get a payout item's live PayPal status and the fixed playbook for it. Reply as JSON {"text": "...", "draft": "..."}: "text" explains what happened and the next step in at most 3 sentences, using only the playbook; "draft" is a short, friendly message to the recipient. Never promise timelines not in the playbook.` },
      { role: 'user', content: JSON.stringify({ item: { status: play.status, amount: item.amount, currency: item.currency, receiver: item.receiver, name: item.name, country: item.country, error: play.error }, playbook: play }) },
    ]);
  } catch { return fallback; }
  try { return { ...JSON.parse(m.content.replace(/^```json|```$/g, '').trim()), ai: true, model: m.model }; } catch { return { text: m.content, draft, ai: true, model: m.model }; }
}

// ---- Natural-language batch: "Pay Priya priya@x.in 200 USD in India, ..." ----
export async function parseBatch(text) {
  if (llmLive()) { try { return await parseBatchAI(text); } catch { /* fall through to rules */ } }
  {
    // deterministic fallback: one payout per line: <name?> <email|phone> <amount> <CUR> <country>
    const rows = text.split(/\n|;/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const receiver = (l.match(/[^\s,]+@[^\s,]+/) || [])[0] || '';
      const amt = l.match(/(\d+(?:\.\d+)?)\s*([A-Za-z]{3})\b/) || [];
      const c = findCountries(l.replace(receiver, ''))[0]?.c || '';
      const name = l.split(/[\s,]+/).filter((w) => /^[A-Z][a-z]+$/.test(w) && !findCountries(w).length).slice(0, 2).join(' ');
      return { name, receiver, amount: amt[1] || '', currency: (amt[2] || '').toUpperCase(), country: c };
    }).filter((r) => r.receiver || r.amount);
    return { rows, ai: false };
  }
}
async function parseBatchAI(text) {
  const m = await chat([
    { role: 'system', content: 'Extract payout rows from the text. Reply ONLY with JSON {"rows":[{"name":"","receiver":"","recipientType":"EMAIL|PHONE|PAYPAL_ID","amount":"","currency":"ISO-4217","country":"ISO-3166 alpha-2","fromCountry":"","note":""}]}. Leave a field empty if it is not stated. Never invent emails or amounts.' },
    { role: 'user', content: text },
  ]);
  const j = JSON.parse(m.content.replace(/^```json|```$/g, '').trim());
  return { rows: (j.rows || []).map((r) => ({ ...r, country: normCountry(r.country) })), ai: true, model: m.model };
}
