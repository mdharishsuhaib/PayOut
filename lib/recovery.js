// What each Payouts item status means and which actions are safe. Deterministic: the AI may reword
// this for the customer, but the allowed actions come only from here and from the live PayPal status.
import { DOCS } from './rules.js';

const ITEM_DOC = 'https://developer.paypal.com/docs/payouts/standard/reference/payout-item-status/';

export const PLAYBOOK = {
  SUCCESS: { tone: 'ok', title: 'Paid', meaning: 'The funds reached the recipient\'s account.', next: 'Nothing to do.', actions: [] },
  PENDING: { tone: 'wait', title: 'Processing', meaning: 'PayPal is still processing this payout.', next: 'Wait and refresh the status. Do not resend: that risks paying twice.', actions: ['refresh'] },
  UNCLAIMED: { tone: 'warn', title: 'Unclaimed', meaning: 'The recipient has not claimed the payment, usually because the email or phone has no PayPal account yet. If it stays unclaimed for 30 days, the money is returned to you.', next: 'Ask the recipient to claim it or to confirm the address. If the address is wrong, cancel the payout to get the money back now.', actions: ['refresh', 'notify', 'cancel'] },
  ONHOLD: { tone: 'warn', title: 'On hold', meaning: 'PayPal placed the payout on hold for review.', next: 'Wait for PayPal\'s review and refresh. Do not resend while it is held.', actions: ['refresh'] },
  BLOCKED: { tone: 'bad', title: 'Blocked', meaning: 'PayPal blocked this payout, for example because the recipient\'s account cannot receive it.', next: 'Do not retry the same route. Ask the recipient for another PayPal account, then pay that one in a new batch.', actions: ['refresh', 'notify'] },
  FAILED: { tone: 'bad', title: 'Failed', meaning: 'The payout did not go through. PayPal returns an error name explaining why.', next: 'Fix the cause named by PayPal, then send a new payout. The failed one is not charged.', actions: ['refresh'] },
  RETURNED: { tone: 'neutral', title: 'Returned', meaning: 'The money came back to your account: either it was cancelled while unclaimed, or nobody claimed it within 30 days.', next: 'Confirm the recipient\'s details before paying again.', actions: ['notify'] },
  REFUNDED: { tone: 'neutral', title: 'Refunded', meaning: 'The recipient refunded the payout.', next: 'Check with the recipient why it was refunded.', actions: [] },
  REVERSED: { tone: 'bad', title: 'Reversed', meaning: 'PayPal reversed the payout.', next: 'Contact PayPal support with the payout item ID.', actions: [] },
  DENIED: { tone: 'bad', title: 'Denied', meaning: 'PayPal denied the payout.', next: 'Check the error and your account standing before retrying.', actions: [] },
};

// Error names PayPal attaches to failed items. Hints, never certainties.
export const ERROR_HINTS = {
  RECEIVER_UNREGISTERED: 'The recipient has no PayPal account for this address.',
  RECEIVER_UNCONFIRMED: 'The recipient has not confirmed their email or phone.',
  RECEIVER_COUNTRY_NOT_ALLOWED: 'The recipient\'s country cannot receive this payout.',
  RECEIVER_ACCOUNT_LOCKED: 'The recipient\'s account is locked or limited.',
  RECEIVER_YOUTH_ACCOUNT: 'Youth accounts cannot receive payouts.',
  RECEIVING_LIMIT_EXCEEDED: 'The recipient hit a receiving limit.',
  CURRENCY_COMPLIANCE: 'The currency or amount breaks a compliance rule for this route.',
  REGULATORY_PENDING: 'PayPal is holding this payout for a regulatory review. Wait for the review; do not resend.',
  REGULATORY_BLOCKED: 'PayPal blocked this payout for regulatory reasons. It cannot be overridden; do not retry the same route.',
  TRANSACTION_LIMIT_EXCEEDED: 'The payout is above a sending or transaction limit on this account. Lower the amount or ask PayPal about the limit.',
  INSUFFICIENT_FUNDS: 'Your PayPal balance can\'t cover this payout.',
  NON_HOLDING_CURRENCY: 'The recipient doesn\'t hold this currency.',
};

export const WEBHOOK_STATUS = {
  'PAYMENT.PAYOUTS-ITEM.SUCCEEDED': 'SUCCESS', 'PAYMENT.PAYOUTS-ITEM.FAILED': 'FAILED', 'PAYMENT.PAYOUTS-ITEM.BLOCKED': 'BLOCKED',
  'PAYMENT.PAYOUTS-ITEM.HELD': 'ONHOLD', 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED': 'UNCLAIMED', 'PAYMENT.PAYOUTS-ITEM.RETURNED': 'RETURNED',
  'PAYMENT.PAYOUTS-ITEM.CANCELED': 'RETURNED', 'PAYMENT.PAYOUTS-ITEM.REFUNDED': 'REFUNDED', 'PAYMENT.PAYOUTS-ITEM.DENIED': 'DENIED',
};

export function playbookFor(status, errorName) {
  const p = PLAYBOOK[status] || { tone: 'neutral', title: status || 'Unknown', meaning: 'PayPal returned a status this tool does not know yet.', next: 'Check the item in the PayPal dashboard.', actions: ['refresh'] };
  return { status, ...p, error: errorName ? { name: errorName, hint: ERROR_HINTS[errorName] || null } : null, sources: [ITEM_DOC, DOCS.webhooks] };
}
