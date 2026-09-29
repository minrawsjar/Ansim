// Shared types and helpers for the console. Amounts from the backend are USDT base units (6 decimals).

export type Payee = { name: string; country: string | null; address: string; usual: number };
export type Status = {
  gasfree: boolean; kiln: boolean; payer: string | null; ownerFallback: boolean; notary: boolean;
  registry: string | null; simulateLostLine: number | null; payees: Payee[];
};
export type Policy = {
  id: number; payer: string; owner: string | null; budget: number; per_payment: number; payees: string;
  payees_hash: string; deadline: number; signature: string | null; signed_by: string | null;
  policy_hash: string | null; anchor_tx: string | null; status: 'DRAFT' | 'ACTIVE' | 'STOPPED' | 'REPLACED';
};
export type BatchItem = { id: number; source: string; status: string; mapped_by: string; created_at: number; row_count: number };
export type Row = {
  id: number; line: number; sender: string | null; name: string | null; receiver: string; amount: number | null;
  amount_raw: string | null; note: string | null; flags: string[]; agent: { ko: string; en: string; action: string } | null;
  decision: 'pay' | 'hold' | 'remove'; state: string; reason: string | null; request_id: string | null; trace_id: string | null;
  txn_hash: string | null; fee: number | null; max_fee: number | null; error: string | null;
};
export type Summary = { total: number; paid: number; failed: number; refused: number; held: number; ready: number; awaiting: number; amountPaid: number; fees: number };
export type BatchEvent = { id: number; type: string; ts: number; hash: string; data: Record<string, unknown> };
export type BatchView = {
  batch: { id: number; source: string; status: string; mapped_by: string; columns: Record<string, string>; receipt: { ko: string; en: string } | null; close_hash: string | null; anchor_tx: string | null; policy_id: number | null };
  policy: Policy | null; rows: Row[]; summary: Summary; events: BatchEvent[]; running: boolean;
};
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
export const tronscanTx = (h: string) => `https://nile.tronscan.org/#/transaction/${h}`;
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
};

export const REASONS: Record<string, string> = {
  STOPPED_BY_OWNER: 'Stopped by the owner',
  NO_ACTIVE_POLICY: 'No active policy',
  DEADLINE_PASSED: 'Policy deadline passed',
  PAYEE_NOT_ALLOWED: 'Payee not in the signed list',
  OVER_PER_PAYMENT_CAP: 'Above the per-payment cap',
  OVER_BUDGET_WITH_FEES: 'Over budget once fees are added',
  REJECTED_BY_GASFREE: 'Rejected by GasFree',
};
