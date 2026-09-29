import { createHash } from 'node:crypto';

// The owner signs this as TIP-712 typed data in TronLink. scripts/verify.mjs checks the signature.
export const policyDomain = { name: 'Ansim', version: '1', chainId: 3448148188 };
export const policyTypes = {
  SpendingPolicy: [
    { name: 'payer', type: 'address' },
    { name: 'budget', type: 'uint256' },
    { name: 'perPayment', type: 'uint256' },
    { name: 'payeesHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
    { name: 'policyNonce', type: 'uint256' },
  ],
};

export type PolicyFields = { payer: string; budget: number; per_payment: number; payees: string; payees_hash: string; deadline: number; policy_nonce: number };

export const payeesHash = (payees: string[]) =>
  '0x' + createHash('sha256').update([...payees].sort().join(',')).digest('hex');

export const policyValue = (p: PolicyFields) => ({
  payer: p.payer,
  budget: String(p.budget),
  perPayment: String(p.per_payment),
  payeesHash: p.payees_hash,
  deadline: String(p.deadline),
  policyNonce: String(p.policy_nonce),
});

// Hash written on-chain when the policy is granted. verify.mjs recomputes it the same way.
export const policyHash = (p: PolicyFields, signature: string) => {
  const v = policyValue(p);
  return createHash('sha256')
    .update(JSON.stringify([v.payer, v.budget, v.perPayment, v.payeesHash, v.deadline, v.policyNonce, signature]))
    .digest('hex');
};

// The boundary. The signer runs this before every signature. `committed` is everything already
// paid under this policy plus the value and fee cap of payments still in flight.
export function refuseReason(
  p: { status: string; deadline: number; payees: string; per_payment: number; budget: number },
  committed: number, to: string, value: number, maxFee: number, nowSec = Date.now() / 1000,
): string | null {
  if (p.status === 'STOPPED') return 'STOPPED_BY_OWNER';
  if (p.status !== 'ACTIVE') return 'NO_ACTIVE_POLICY';
  if (nowSec > p.deadline) return 'DEADLINE_PASSED';
  if (!(JSON.parse(p.payees) as string[]).includes(to)) return 'PAYEE_NOT_ALLOWED';
  if (value > p.per_payment) return 'OVER_PER_PAYMENT_CAP';
  if (committed + value + maxFee > p.budget) return 'OVER_BUDGET_WITH_FEES';
  return null;
}
