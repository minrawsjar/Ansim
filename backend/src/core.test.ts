// Checks the logic that guards money: the policy gate, the screening rules, parsing, and the log chain.
// Run with: npm run check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refuseReason, payeesHash, rowsHash, approvalValue } from './policy';
import { screen, looksAlike, validAddress, contactProblem, walletRisk } from './screen';
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

test('a new contact is refused when it is invalid, saved already, a lookalike or reported', () => {
  // A real pair with the same first and last four characters, found by setup.mjs for the demo file.
  const lan = 'TXZit1DZuH3oLxZmxooogX3Uh5nuYiXDVt';
  const twin = 'TXZiWc1wHoxz5dj8WeZZyhUBLE3VV8XDVt';
  const book = [{ address: lan, name: 'Lan' }];
  assert.equal(contactProblem(B, book, new Set()), null);
  assert.match(contactProblem('T123', book, new Set())!, /valid TRON address/);
  assert.match(contactProblem(lan, book, new Set())!, /already saved as Lan/);
  assert.match(contactProblem(twin, book, new Set())!, /address-poisoning/);
  assert.match(contactProblem(B, book, new Set([B]))!, /reported/);
});

test('the monthly cap per contact counts what the contact already got in 30 days', () => {
  const capped = { ...policy, per_payee_monthly: 20_000_000 };
  assert.equal(refuseReason(capped, 0, A, 10_000_000, 0, 1_900_000_000, 10_000_000), null);
  assert.equal(refuseReason(capped, 0, A, 10_000_000, 0, 1_900_000_000, 10_000_001), 'OVER_MONTHLY_PAYEE_CAP');
  assert.equal(refuseReason({ ...policy, per_payee_monthly: 0 }, 0, A, 10_000_000, 0, 1_900_000_000, 99_000_000), null);
});

test('the batch approval covers exactly the rows, in any order', () => {
  const rows = [{ line: 3, receiver: A, amount: 2_000_000 }, { line: 2, receiver: B, amount: 1_000_000 }];
  assert.equal(rowsHash(rows), rowsHash([...rows].reverse()));
  assert.notEqual(rowsHash(rows), rowsHash([rows[0], { ...rows[1], amount: 1_000_001 }]));
  assert.deepEqual(approvalValue(7, 2, rows), { batchId: '7', policyId: '2', rowsHash: rowsHash(rows), count: '2', total: '3000000' });
});

test('new contacts wait, and large transfers need Travel Rule details', async () => {
  const now = 1_900_000_000;
  const book = new Map([[A, { address: A, name: 'Lan', usual: 0, added: now - 3600 }], [B, { address: B, name: 'Minh', usual: 0, added: 0 }]]);
  const rows = [
    { line: 2, sender: 'x', receiver: A, amount: 1_000_000, note: '', flags: [] as string[] },
    { line: 3, sender: 'y', receiver: B, amount: 800_000_000, note: '', flags: [] as string[] },
    { line: 4, sender: 'z', receiver: B, amount: 800_000_000, note: 'b', flags: [] as string[], travel: true },
  ];
  await screen(rows, book, new Set(), async () => false, { now, waitSec: 3 * 3600, travelMin: 714_285_715 });
  assert.deepEqual(rows.map((r) => r.flags), [['NEW_CONTACT_WAIT'], ['TRAVEL_RULE_INFO'], []]);
});

test('wallet history flags contracts, mule inflows, frozen senders and new wallets, and never calls a wallet safe', () => {
  const now = 1_900_000_000_000;
  const clean = { used: true, createdAt: now - 400 * 86_400_000, isContract: false, trx: 5, usdtIn7d: { transfers: 1, senders: 1, total: 1 }, frozenSenders: [] };
  assert.deepEqual(walletRisk(clean, now), { flags: [], level: 'none' });
  assert.deepEqual(walletRisk({ ...clean, used: false, createdAt: null }, now), { flags: [], level: 'none' });
  assert.deepEqual(walletRisk({ ...clean, createdAt: now - 86_400_000 }, now), { flags: ['WALLET_NEW'], level: 'review' });
  assert.equal(walletRisk({ ...clean, usdtIn7d: { transfers: 9, senders: 7, total: 9 } }, now).level, 'high');
  assert.equal(walletRisk({ ...clean, frozenSenders: [A] }, now).level, 'high');
  assert.equal(walletRisk({ ...clean, isContract: true }, now).level, 'high');
});

test('CSV cells cannot run as spreadsheet formulas', async () => {
  const { csvCell } = await import('./desk');
  assert.equal(csvCell('=HYPERLINK("http://x","click")'), `"'=HYPERLINK(""http://x"",""click"")"`);
  assert.equal(csvCell('+82 10'), "'+82 10");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('9월 생활비'), '9월 생활비');
  assert.equal(csvCell('2.500000'), '2.500000');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell(null), '');
});
