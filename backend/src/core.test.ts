// Checks the logic that guards money: the policy gate, the screening rules, parsing, and the log chain.
// Run with: npm run check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refuseReason, payeesHash } from './policy';
import { screen, looksAlike, validAddress } from './screen';
import { parseAmount, ruleMapping } from './importer';

const A = 'TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH';
const B = 'TPJjH3zykTkZ9NsgPo115kU5PxCfuyTjEd';
const policy = { status: 'ACTIVE', deadline: 2_000_000_000, payees: JSON.stringify([A]), per_payment: 50_000_000, budget: 100_000_000 };

test('policy gate refuses everything outside the signed limits', () => {
  assert.equal(refuseReason(policy, 0, A, 10_000_000, 1_000_000, 1_900_000_000), null);
  assert.equal(refuseReason(policy, 0, B, 10_000_000, 1_000_000, 1_900_000_000), 'PAYEE_NOT_ALLOWED');
  assert.equal(refuseReason(policy, 0, A, 60_000_000, 1_000_000, 1_900_000_000), 'OVER_PER_PAYMENT_CAP');
  // 90 already committed + 9.5 value fits, but not once the 1 USDT fee cap is added
  assert.equal(refuseReason(policy, 90_000_000, A, 9_500_000, 0, 1_900_000_000), null);
  assert.equal(refuseReason(policy, 90_000_000, A, 9_500_000, 1_000_000, 1_900_000_000), 'OVER_BUDGET_WITH_FEES');
  assert.equal(refuseReason(policy, 0, A, 1, 0, 2_100_000_000), 'DEADLINE_PASSED');
  assert.equal(refuseReason({ ...policy, status: 'STOPPED' }, 0, A, 1, 0, 1_900_000_000), 'STOPPED_BY_OWNER');
});

test('payee hash ignores order', () => {
  assert.equal(payeesHash([A, B]), payeesHash([B, A]));
});

test('screening flags scams and data errors', async () => {
  const lookalike = 'TLyqAAAAAAAAAAAAAAAAAAAAAAAAAAZYH'; // not a real address, only to test the rule
  assert.ok(looksAlike(A, A.slice(0, 4) + 'x'.repeat(26) + A.slice(-4)));
  assert.ok(!looksAlike(A, A));
  assert.ok(validAddress(A) && !validAddress(A.slice(0, -1) + 'x') && !validAddress(lookalike));
  const book = new Map([[A, { address: A, name: 'Lan', usual: 3_000_000 }]]);
  const rows = [
    { line: 2, sender: 'an', receiver: A, amount: 3_000_000, note: 'Sept', flags: [] as string[] },
    { line: 3, sender: 'an', receiver: A, amount: 3_000_000, note: 'Sept', flags: [] as string[] },
    { line: 4, sender: 'an', receiver: A, amount: 20_000_000, note: 'bonus', flags: [] as string[] },
    { line: 5, sender: 'k1', receiver: B, amount: 1_000_000, note: '', flags: [] as string[] },
    { line: 6, sender: 'k2', receiver: B, amount: 1_000_000, note: '', flags: [] as string[] },
    { line: 7, sender: 'k3', receiver: B, amount: 1_000_000, note: '', flags: [] as string[] },
    { line: 8, sender: 'x', receiver: 'Tnotanaddress', amount: null, note: '', flags: [] as string[] },
  ];
  await screen(rows, book, new Set([B]), async (a) => a === B);
  assert.deepEqual(rows[0].flags, []);
  assert.deepEqual(rows[1].flags, ['DUPLICATE']);
  assert.deepEqual(rows[2].flags, ['UNUSUAL_AMOUNT']);
  assert.deepEqual(rows[3].flags, ['NEW_PAYEE', 'REPORTED_WALLET', 'MANY_SENDERS_ONE_WALLET', 'TETHER_FROZEN']);
  assert.deepEqual(rows[6].flags, ['INVALID_AMOUNT', 'INVALID_ADDRESS']);
});

test('amounts and Korean headers parse', () => {
  assert.equal(parseAmount('1,234.50 USDT'), 1_234_500_000);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('abc'), null);
  const m = ruleMapping(['송금인', '수취인', '수취인 지갑주소', '금액(USDT)', '비고']);
  assert.deepEqual(m, { receiver: '수취인 지갑주소', amount: '금액(USDT)', sender: '송금인', name: '수취인', note: '비고' });
});

test('event log is a hash chain', async () => {
  process.env.ANSIM_DB = ':memory:';
  const { logEvent, allEvents, sha256, GENESIS } = await import('./log');
  logEvent('A', { x: 1 });
  logEvent('B', { y: 2 });
  const [e1, e2] = allEvents();
  assert.equal(e1.prev, GENESIS);
  assert.equal(e1.hash, sha256(e1.prev + e1.body));
  assert.equal(e2.prev, e1.hash);
  assert.equal(e2.hash, sha256(e2.prev + e2.body));
});
