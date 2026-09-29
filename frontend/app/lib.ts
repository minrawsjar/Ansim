// Shared types and helpers for the console. Amounts from the backend are USDT base units (6 decimals).

// created_at is 0 for contacts from the original payee file; month is base units paid in the last 30 days.
export type Payee = { name: string; country: string | null; address: string; usual: number; created_at: number; month: number };
export type Rules = { contactWaitHours: number; travelRuleMin: number; travelRuleKrw: number; krwPerUsdt: number };
export type Status = {
  gasfree: boolean; kiln: boolean; payer: string | null; ownerFallback: boolean; notary: boolean; telegram: boolean;
  registry: string | null; simulateLostLine: number | null; payees: Payee[]; rules: Rules;
};
export type Policy = {
  id: number; payer: string; owner: string | null; budget: number; per_payment: number; payees: string;
  payees_hash: string; deadline: number; signature: string | null; signed_by: string | null;
  policy_hash: string | null; anchor_tx: string | null; status: 'DRAFT' | 'ACTIVE' | 'STOPPED' | 'REPLACED';
  per_payee_monthly: number | null;
};
export type BatchItem = { id: number; source: string; status: string; mapped_by: string; created_at: number; row_count: number };
export type Row = {
  id: number; line: number; sender: string | null; name: string | null; receiver: string; amount: number | null;
  amount_raw: string | null; note: string | null; flags: string[]; agent: { ko: string; en: string; action: string } | null;
  decision: 'pay' | 'hold' | 'remove'; state: string; reason: string | null; request_id: string | null; trace_id: string | null;
  txn_hash: string | null; fee: number | null; max_fee: number | null; error: string | null;
  receipt_token: string | null; travel: { originatorId: string; purpose: string } | null;
};
export type Summary = { total: number; paid: number; failed: number; refused: number; held: number; ready: number; awaiting: number; amountPaid: number; fees: number };
export type BatchEvent = { id: number; type: string; ts: number; hash: string; data: Record<string, unknown> };
export type Approval = { value: { batchId: string; policyId: string; rowsHash: string; count: string; total: string }; signature: string; owner: string; signedBy: string; at: number };
export type BatchView = {
  batch: { id: number; source: string; status: string; mapped_by: string; columns: Record<string, string>; receipt: { ko: string; en: string } | null; close_hash: string | null; anchor_tx: string | null; policy_id: number | null; approval: Approval | null };
  approvalProblem: string | null;
  policy: Policy | null; rows: Row[]; summary: Summary; events: BatchEvent[]; running: boolean;
};
export type TypedDraft = { domain: object; types: object; value: Record<string, string> };
export type Precheck = {
  payer: string; gasFreeAddress: string; active: boolean; allowSubmit: boolean; nonce: number;
  token: { symbol: string; address: string; transferFee: number; activateFee: number };
  provider: { address: string; name: string; maxPendingTransfer?: number };
  balance: number; frozen: number; count: number; amount: number; transferFees: number; activation: number; total: number;
  budget: number; remaining: number; problems: string[]; warnings: string[];
};

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    ...(json !== undefined ? { method: rest.method ?? 'POST', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } } : {}),
  });
  const data = await res.json().catch(() => ({ error: `Server returned ${res.status}` }));
  // Backend errors always come back as HTTP 400 with { error }. Rows also have an `error` field, so check the status.
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Server returned ${res.status}`);
  return data as T;
}

export const usdt = (n: number | null | undefined) => (n == null ? '–' : (n / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const when = (sec: number) => new Date(sec * 1000).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
// 3 → "3 hours", 0.05 → "3 minutes".
export function waitText(hours: number) {
  const [n, unit] = hours >= 1 ? [+hours.toFixed(1), 'hour'] : [Math.round(hours * 60), 'minute'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

export const tronscanTx = (h: string) => `https://nile.tronscan.org/#/transaction/${h}`;

// Average cost of sending money from Korea to Vietnam through banks and remittance firms (Spark, see README).
export const BANK_FEE_RATE = 0.0515;
// GasFree's Nile transfer fee when this was built. The pre-check shows the live value.
export const GASFREE_FEE = 300_000;

// Nile testnet, the chainId inside every Ansim signature (3448148188). TronLink refuses to sign
// typed data for a chain other than the one it is connected to.
const NILE_CHAIN_ID = '0xcd8690dc';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Signs TIP-712 typed data in TronLink. Used for the payment limits and for batch approvals.
export async function signWithTronLink(draft: TypedDraft) {
  const w = window as any;
  if (!w.tronLink && !w.tronWeb) throw new Error('TronLink is not installed in this browser. Use the demo owner key instead.');
  if (w.tronLink?.request) await w.tronLink.request({ method: 'tron_requestAccounts' });
  let tronWeb = w.tronLink?.tronWeb || w.tronWeb;
  if (!/nile/i.test(tronWeb?.fullNode?.host ?? '')) {
    // Ask TronLink to switch to Nile. Older versions lack this request; signing then fails with the message below.
    const provider = w.tron ?? w.tronLink;
    await provider?.request?.({ method: 'wallet_switchEthereumChain', params: [{ chainId: NILE_CHAIN_ID }] }).catch(() => {});
    tronWeb = w.tronLink?.tronWeb || w.tronWeb;
  }
  const owner: string | undefined = tronWeb?.defaultAddress?.base58;
  if (!owner) throw new Error('Unlock TronLink and connect an account first.');
  const sign = tronWeb.trx.signTypedData ?? tronWeb.trx._signTypedData;
  try {
    const signature: string = await sign.call(tronWeb.trx, draft.domain, draft.types, draft.value);
    return { owner, signature };
  } catch (e) {
    const text = String((e as { message?: unknown } | null)?.message ?? e);
    if (/chain ?id/i.test(text)) throw new Error('TronLink is on another network. Open TronLink, switch the network to Nile Testnet, then sign again.');
    throw e;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
export const tronscanAddress = (a: string) => `https://nile.tronscan.org/#/address/${a}`;

export const FLAGS: Record<string, { label: string; tip: string; blocking?: boolean }> = {
  INVALID_ADDRESS: { label: 'Invalid address', tip: 'Not a valid TRON address', blocking: true },
  INVALID_AMOUNT: { label: 'Invalid amount', tip: 'Amount is missing, zero or not a number', blocking: true },
  DUPLICATE: { label: 'Duplicate', tip: 'Same sender, wallet, amount and note as an earlier row' },
  NEW_PAYEE: { label: 'New payee', tip: 'Wallet is not in the payee book' },
  LOOKALIKE: { label: 'Lookalike wallet', tip: 'Looks like a known payee wallet but is a different one (address poisoning)' },
  UNUSUAL_AMOUNT: { label: 'Unusual amount', tip: 'More than 3 times this payee’s usual amount' },
  REPORTED_WALLET: { label: 'Reported scam wallet', tip: 'Wallet is on the reported scam list', blocking: true },
  TETHER_FROZEN: { label: 'Frozen by Tether', tip: 'Tether has frozen this wallet on mainnet', blocking: true },
  MANY_SENDERS_ONE_WALLET: { label: 'Many senders, one wallet', tip: 'Three or more different senders pay one new wallet (possible money mule)' },
  NEW_CONTACT_WAIT: { label: 'New contact waiting', tip: 'Contact was added recently. New contacts wait before they can be paid, like a bank’s delayed transfer (지연이체). Run the checks again once the wait is over.', blocking: true },
  TRAVEL_RULE_INFO: { label: 'Travel Rule details needed', tip: 'At or above the Travel Rule threshold. Add the sender’s details before this row can be paid.', blocking: true },
};

export const REASONS: Record<string, string> = {
  STOPPED_BY_OWNER: 'Stopped by the owner',
  NO_ACTIVE_POLICY: 'No active policy',
  DEADLINE_PASSED: 'Policy deadline passed',
  PAYEE_NOT_ALLOWED: 'Payee not in the signed list',
  OVER_PER_PAYMENT_CAP: 'Above the per-payment cap',
  OVER_MONTHLY_PAYEE_CAP: 'Over this contact’s 30-day cap',
  OVER_BUDGET_WITH_FEES: 'Over budget once fees are added',
  REJECTED_BY_GASFREE: 'Rejected by GasFree',
};
