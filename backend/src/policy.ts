import { createHash } from 'node:crypto';

// The owner signs this as TIP-712 typed data in TronLink. scripts/verify.mjs checks the signature.
export const policyDomain = { name: 'Ansim', version: '1', chainId: 3448148188 };
const baseFields = [
  { name: 'payer', type: 'address' },
  { name: 'budget', type: 'uint256' },
  { name: 'perPayment', type: 'uint256' },
  { name: 'payeesHash', type: 'bytes32' },
  { name: 'deadline', type: 'uint256' },
  { name: 'policyNonce', type: 'uint256' },
];
export const policyTypes = { SpendingPolicy: [...baseFields, { name: 'perPayeeMonthly', type: 'uint256' }] };
// Policies signed before the monthly cap existed keep the shape their signature covers.
const policyTypesV1 = { SpendingPolicy: baseFields };
export const policyTypesFor = (p: { per_payee_monthly: number | null }) => (p.per_payee_monthly == null ? policyTypesV1 : policyTypes);

export type PolicyFields = {
  payer: string; budget: number; per_payment: number; payees: string; payees_hash: string; deadline: number; policy_nonce: number;
  per_payee_monthly: number | null;
};

export const payeesHash = (payees: string[]) =>
  '0x' + createHash('sha256').update([...payees].sort().join(',')).digest('hex');

export const policyValue = (p: PolicyFields) => ({
  payer: p.payer,
  budget: String(p.budget),
  perPayment: String(p.per_payment),
  payeesHash: p.payees_hash,
  deadline: String(p.deadline),
  policyNonce: String(p.policy_nonce),
  ...(p.per_payee_monthly != null ? { perPayeeMonthly: String(p.per_payee_monthly) } : {}),
});

// Hash written on-chain when the policy is granted. verify.mjs recomputes it the same way.
export const policyHash = (p: PolicyFields, signature: string) => {
  const v = policyValue(p);
  return createHash('sha256')
    .update(JSON.stringify([v.payer, v.budget, v.perPayment, v.payeesHash, v.deadline, v.policyNonce, signature]))
    .digest('hex');
};

export const MONTH_SEC = 30 * 86400;

// The boundary. The signer runs this before every signature. `committed` is everything already
// paid under this policy plus the value and fee cap of payments still in flight. `payeeMonth` is what
// this receiver got (or has in flight) in the last 30 days, under any policy.
export function refuseReason(
  p: { status: string; deadline: number; payees: string; per_payment: number; budget: number; per_payee_monthly?: number | null },
  committed: number, to: string, value: number, maxFee: number, nowSec = Date.now() / 1000, payeeMonth = 0,
): string | null {
  if (p.status === 'STOPPED') return 'STOPPED_BY_OWNER';
  if (p.status !== 'ACTIVE') return 'NO_ACTIVE_POLICY';
  if (nowSec > p.deadline) return 'DEADLINE_PASSED';
  if (!(JSON.parse(p.payees) as string[]).includes(to)) return 'PAYEE_NOT_ALLOWED';
  if (value > p.per_payment) return 'OVER_PER_PAYMENT_CAP';
  if (p.per_payee_monthly && payeeMonth + value > p.per_payee_monthly) return 'OVER_MONTHLY_PAYEE_CAP';
  if (committed + value + maxFee > p.budget) return 'OVER_BUDGET_WITH_FEES';
  return null;
}

// The owner signs this before a batch is paid: exactly these rows, under this policy.
// Changing any row afterwards changes rowsHash, so the approval no longer matches.
export const approvalTypes = {
  BatchApproval: [
    { name: 'batchId', type: 'uint256' },
    { name: 'policyId', type: 'uint256' },
    { name: 'rowsHash', type: 'bytes32' },
    { name: 'count', type: 'uint256' },
    { name: 'total', type: 'uint256' },
  ],
};

export const rowsHash = (rows: { line: number; receiver: string; amount: number | null }[]) =>
  '0x' + createHash('sha256').update([...rows].sort((a, b) => a.line - b.line).map((r) => `${r.line}:${r.receiver}:${r.amount}`).join(',')).digest('hex');

export const approvalValue = (batchId: number, policyId: number, rows: { line: number; receiver: string; amount: number | null }[]) => ({
  batchId: String(batchId),
  policyId: String(policyId),
  rowsHash: rowsHash(rows),
  count: String(rows.length),
  total: String(rows.reduce((s, r) => s + (r.amount ?? 0), 0)),
});
