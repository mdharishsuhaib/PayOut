// Common customer questions about PayPal Payouts, grouped by topic, with grounded answers.
// "policy" is what PayPal's published documentation / PayOut's rule tables say; "next" is the suggested action.
// Nothing here is transaction-specific: when no payout is open, answers say there is no PayPal response to inspect.
import { COUNTRIES, CURRENCIES, DOCS, MAX_ITEMS, currencyRules } from './rules.js';

const FEES = 'https://www.paypal.com/us/webapps/mpp/merchant-fees';
const ITEM = 'https://developer.paypal.com/docs/payouts/standard/reference/payout-item-status/';
const nCountries = Object.keys(COUNTRIES).length;
const nSend = Object.values(COUNTRIES).filter((c) => c.canSend).length;
const receiveOnly = Object.values(COUNTRIES).filter((c) => !c.canSend).map((c) => c.name).join(' and ');
const noDec = currencyRules().filter((c) => c.payment && !c.decimals).map((c) => c.code).join(', ');

// status: true marks questions about one payout; asked with nothing open, the answer says so
const Q = [
  // ---- Status ----
  { t: 'status', q: 'Why is my payout still pending?', k: /pending|still processing|taking (so )?long/, status: true,
    policy: 'PENDING means PayPal is still processing the payout item. It is not complete, and it has not failed.',
    next: 'Wait for PayPal\'s next update and refresh the status. Do not resend it while it is pending: that risks paying the same person twice.', src: [ITEM] },
  { t: 'status', q: 'Has my recipient received the money?', k: /receiv(e|ed) the (money|payment)|got (the|my) (money|payment)|been paid|credited/, status: true,
    policy: 'Only SUCCESS means the funds reached the recipient\'s PayPal account. UNCLAIMED means PayPal is holding the money until the recipient claims it.',
    next: 'Open the payout in Tracking to see the status PayPal reports for that item.', src: [ITEM] },
  { t: 'status', q: 'What does the UNCLAIMED status mean?', k: /unclaimed/,
    policy: 'The recipient has not claimed the payment, usually because the email or phone has no PayPal account yet. PayPal returns unclaimed payouts to the sender after 30 days.',
    next: 'Remind the recipient to claim it, or cancel it from Resolve if the address is wrong.', src: [ITEM] },
  { t: 'status', q: 'What does ONHOLD mean?', k: /on ?hold|under review|held/,
    policy: 'ONHOLD means PayPal placed the payout under review. PayPal decides the outcome.',
    next: 'Wait for the review and refresh. Do not resend a held payout.', src: [ITEM] },
  { t: 'status', q: 'What is the difference between batch status and payout status?', k: /batch status|difference between/,
    policy: 'A batch status describes the whole request; each payout item inside it has its own status. A batch can be SUCCESS (processed) while some items are UNCLAIMED, FAILED or BLOCKED.',
    next: 'Always check item statuses before treating a batch as fully paid.', src: [DOCS.api, ITEM] },

  // ---- Sending ----
  { t: 'sending', q: 'How do I send payouts to multiple recipients?', k: /multiple recipients|many (people|recipients)|mass payout|bulk/,
    policy: `One PayPal Payouts request can carry up to ${MAX_ITEMS.toLocaleString('en-US')} payout items, each with its own recipient, amount and currency.`,
    next: 'In Verify, import a CSV or paste rows. PayOut checks every row, and only the rows you approve go to PayPal.', src: [DOCS.api] },
  { t: 'sending', q: 'How many recipients can I pay in one batch?', k: /how many (recipients|payouts|people)|batch (size|limit)|maximum.*batch/,
    policy: `PayPal accepts up to ${MAX_ITEMS.toLocaleString('en-US')} payouts per batch request.`,
    next: 'Split larger files into several batches.', src: [DOCS.api] },
  { t: 'sending', q: 'What fees does PayPal charge for payouts?', k: /fee|charge|cost/,
    policy: 'PayPal charges the sender a fee per payout item. The amount depends on the sending country, the destination and the currency, and PayPal returns it with each item as payout_item_fee. Currency conversion adds PayPal\'s exchange-rate spread.',
    next: 'Check PayPal\'s fee page for your country. After sending, PayOut shows the fee PayPal reported on each payout.', src: [FEES] },
  { t: 'sending', q: 'What is the maximum amount I can send?', k: /maximum amount|how much can i send|limit/,
    policy: 'Sending and receiving limits depend on the PayPal account and its verification. They are not published as one fixed number.',
    next: 'Check the limits on your PayPal business account, or ask PayPal. PayOut also asks for a second look at unusually large single payouts.', src: [DOCS.api] },
  { t: 'sending', q: 'Can I send payouts in different currencies?', k: /different currencies|several currencies|multiple currencies/,
    policy: 'Yes, but PayPal rejects a single request that mixes currencies ("Multiple currencies within a batch is not allowed").',
    next: 'PayOut splits approved rows into one PayPal batch per currency automatically.', src: [DOCS.api] },

  // ---- Countries ----
  { t: 'countries', q: 'Can I send payouts from India?', k: /from india|indian business|india.*send/,
    policy: 'PayPal classifies India as "Receive and withdraw": merchants in India cannot send (originate) Payouts. PayPal accounts in India can still receive payouts sent from eligible countries.',
    next: 'Send from a PayPal business account in an eligible sending country, or use another payout provider for India-originated payouts.', src: [DOCS.countries] },
  { t: 'countries', q: 'Which countries can receive payouts?', k: /which countries|what countries|countries (can|that)/,
    policy: `PayPal lists ${nCountries} countries for Payouts. All of them can receive; ${nSend} can also send. ${receiveOnly} can only receive and withdraw.`,
    next: 'Open Rules to search any country, or Routes to check a specific sender, recipient and currency.', src: [DOCS.countries] },
  { t: 'countries', q: 'Can I send money from the US to India?', k: /us to india|united states to india|usa to india/,
    policy: 'Yes. The US can send Payouts and India can receive them. PayPal does not auto-convert payouts into India, so send USD: the recipient withdraws to their bank in INR.',
    next: 'Use USD for Indian recipients. INR is not a PayPal REST currency and is blocked before sending.', src: [DOCS.countries, DOCS.conversion] },
  { t: 'countries', q: 'Why is my destination country restricted?', k: /restricted|not (allowed|supported)|blocked country/,
    policy: 'A destination is restricted when it is not on PayPal\'s list of Payouts countries, or when the currency can\'t be converted into it.',
    next: 'Open the row in Verify: each restriction names the exact rule and links to PayPal\'s source.', src: [DOCS.countries] },

  // ---- Currency ----
  { t: 'currency', q: 'Which currencies does PayPal support?', k: /which currencies|supported currenc|what currencies/,
    policy: `PayPal's REST API accepts ${CURRENCIES.length} payment currencies: ${CURRENCIES.join(', ')}. CNY and MYR work only for in-country accounts.`,
    next: 'Open Rules → Currency for the full list with notes.', src: [DOCS.currencies] },
  { t: 'currency', q: 'Which currencies take no decimals?', k: /decimal/,
    policy: `${noDec} are zero-decimal: PayPal returns an error if you send a decimal amount in them.`,
    next: 'Use whole amounts. In Verify, PayOut blocks decimal amounts in these currencies and offers to round them.', src: [DOCS.currencies] },
  { t: 'currency', q: 'Can I pay Brazil in BRL from the US?', k: /brl|brazil/,
    policy: 'BRL is supported only for in-country Brazilian accounts. A BRL payout from outside Brazil is converted into the recipient\'s primary currency, at a rate that includes PayPal\'s spread.',
    next: 'Check this route in Routes; in Verify, PayOut flags BRL from outside Brazil for review.', src: [DOCS.currencies] },
  { t: 'currency', q: 'Why are different currencies split into separate batches?', k: /split|separate batches/,
    policy: 'PayPal rejects a payout request that mixes currencies, so each currency has to go in its own batch.',
    next: 'Nothing to do: PayOut sends one PayPal batch per currency for you.', src: [DOCS.api] },
  { t: 'currency', q: 'How are exchange rates calculated?', k: /exchange rate|conversion rate|convert/,
    policy: 'When PayPal converts a payout, it uses its own exchange rate, which includes a currency-conversion spread.',
    next: 'Where PayPal can\'t auto-convert into a country, send USD. In Verify, PayOut flags those routes.', src: [DOCS.conversion] },

  // ---- Failures ----
  { t: 'failures', q: 'Why did my payout fail?', k: /fail/, status: true,
    policy: 'A FAILED payout item did not go through. PayPal returns an error name with it, for example RECEIVER_UNREGISTERED or INSUFFICIENT_FUNDS.',
    next: 'Fix the cause PayPal names, then send a new payout. Open the payout in Resolve to see PayPal\'s error explained.', src: [ITEM] },
  { t: 'failures', q: 'Why was my payout batch denied?', k: /denied|batch.*rejected|rejected.*batch/, status: true,
    policy: 'A DENIED batch was rejected as a whole, so none of its items were paid. PayPal returns the reason with the batch, for example insufficient funds or an invalid request.',
    next: 'Fix the reason PayPal gives, then submit a new batch. Resending the same denied batch will fail again.', src: [DOCS.api] },
  { t: 'failures', q: 'Why are some payouts successful while others failed?', k: /some.*(success|paid).*(fail|other)|others failed|partly/,
    policy: 'Each payout item is processed on its own, so one batch can contain SUCCESS, UNCLAIMED, FAILED and BLOCKED items together.',
    next: 'Open Resolve: it lists every item that did not complete, most urgent first.', src: [ITEM] },
  { t: 'failures', q: 'What happens if I enter the wrong email?', k: /wrong (email|address|recipient)|incorrect (email|recipient)|mistake/,
    policy: 'PayPal cannot reverse a payout just because it was sent to the wrong address. If it is still UNCLAIMED, it can be cancelled and the money comes back.',
    next: 'Check the payout status now. If it is UNCLAIMED, cancel it from Resolve and pay the correct address in a new batch.', src: [ITEM] },
  { t: 'failures', q: 'How can I avoid duplicate payments?', k: /duplicate|twice|double/,
    policy: 'Every payout needs a unique sender_item_id. Resending a payout that is still pending or unclaimed can pay the same person twice.',
    next: 'PayOut blocks repeated references, holds same-recipient, same-amount rows for review, and refuses to submit the same batch twice.', src: [DOCS.api] },

  // ---- Recovery ----
  { t: 'recovery', q: 'Can I cancel an unclaimed payout?', k: /cancel/,
    policy: 'Yes. PayPal lets you cancel a payout item only while it is UNCLAIMED; the money returns to your balance. Unclaimed payouts that are not cancelled return automatically after 30 days.',
    next: 'Open the payout in Resolve. PayOut re-checks the live status with PayPal and asks you to confirm before cancelling.', src: [ITEM] },
  { t: 'recovery', q: 'Can I reverse a successful payout?', k: /reverse|undo|take back|get .*money back/,
    policy: 'The Payouts API cannot reverse a SUCCESS payout. Only UNCLAIMED items can be cancelled. A recipient can choose to refund a payout, which shows as REFUNDED.',
    next: 'Contact the recipient and ask them to refund it, or contact PayPal support.', src: [ITEM] },
  { t: 'recovery', q: 'How long does a recipient have to claim a payout?', k: /how long|claim (it|a payout)|30 days|deadline/,
    policy: 'An unclaimed payout is returned to the sender after 30 days.',
    next: 'Resolve shows the days left on each unclaimed payout, so you can remind the recipient in time.', src: [ITEM] },
  { t: 'recovery', q: 'What should I do if a payout is returned?', k: /returned/,
    policy: 'RETURNED means the money came back to your account, either because it was cancelled while unclaimed or because nobody claimed it within 30 days.',
    next: 'Confirm the recipient\'s details before paying again in a new batch.', src: [ITEM] },
];

export const TOPICS = [
  { id: 'status', label: 'Status', hint: 'Track payment progress' }, { id: 'sending', label: 'Sending', hint: 'Sending money and fees' },
  { id: 'countries', label: 'Countries', hint: 'International eligibility' }, { id: 'currency', label: 'Currency', hint: 'Conversion and restrictions' },
  { id: 'failures', label: 'Failures', hint: 'Investigate payment issues' }, { id: 'recovery', label: 'Recovery', hint: 'Cancellation and resolution' },
];
export const SUGGESTED = ['Why is my payout still pending?', 'Why did my payout fail?', 'Has my recipient received the money?',
  'Can I cancel an unclaimed payout?', 'What fees does PayPal charge for payouts?', 'Why was my payout batch denied?'];
// questions answered from the signed-in workspace's own PayPal records
export const WORKSPACE = ['Which payouts need my attention today?', 'Which payouts are approaching their 30-day deadline?',
  'What happened to my last payout batch?', 'How much did I spend on payout fees?'];

export const library = () => ({ topics: TOPICS.map((t) => ({ ...t, questions: Q.filter((x) => x.t === t.id).map((x) => x.q) })), suggested: SUGGESTED, workspace: WORKSPACE });

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// exact question first, then the first entry whose keywords match. Route questions naming two countries go to the route checker instead.
export function matchFaq(question) {
  const n = norm(question);
  return Q.find((x) => norm(x.q) === n) || Q.find((x) => x.k.test(n)) || null;
}
export const NO_OPEN = 'No payout is open, so there is no transaction-specific PayPal response to inspect. Open a payout in Tracking or Resolve and ask again to see what PayPal returned for it.';
