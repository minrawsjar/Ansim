// Independent auditor check for an Ansim evidence export.
// It uses only the export file and public TRON Nile data, and re-implements every rule itself
// instead of importing Ansim's code.
// Usage: node scripts/verify.mjs <ansim-evidence.json>
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { TronWeb, utils } from 'tronweb';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/verify.mjs <ansim-evidence.json>');
  process.exit(2);
}
const ev = JSON.parse(fs.readFileSync(file, 'utf8'));
const tw = new TronWeb({ fullHost: process.env.TRON_FULLHOST ?? 'https://nile.trongrid.io' });
tw.setAddress('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb');
const USDT = ev.token ?? 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const usdt = (n) => (Number(n) / 1e6).toFixed(2);

let passed = 0;
let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  ok ? passed++ : failed++;
};
const info = (label) => console.log(`INFO  ${label}`);

console.log(`Ansim evidence check · batch ${ev.batch.id} · ${ev.network} · exported ${ev.exportedAt}\n`);

/* 1. The event log is an unbroken hash chain. */
let prev = '0'.repeat(64);
let brokenAt = null;
for (const e of ev.events) {
  if (e.prev !== prev || sha(e.prev + e.body) !== e.hash) {
    brokenAt = e.id;
    break;
  }
  prev = e.hash;
}
check(brokenAt === null, 'Event log hash chain is intact', brokenAt === null ? `${ev.events.length} events` : `breaks at event #${brokenAt}`);
const events = ev.events.map((e) => ({ id: e.id, hash: e.hash, ...JSON.parse(e.body) }));

/* 2. Each policy was signed by its owner, and its hash matches the log and the chain. */
const REGISTRY_ABI = [
  { type: 'function', name: 'policies', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [
    { name: 'policyHash', type: 'bytes32' }, { name: 'payer', type: 'address' }, { name: 'owner', type: 'address' },
    { name: 'budget', type: 'uint256' }, { name: 'perPayment', type: 'uint256' }, { name: 'deadline', type: 'uint64' },
    { name: 'grantedAt', type: 'uint64' }, { name: 'stoppedAt', type: 'uint64' }] },
  { type: 'function', name: 'batches', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [
    { name: 'logHash', type: 'bytes32' }, { name: 'policyId', type: 'uint256' }, { name: 'paid', type: 'uint32' },
    { name: 'refused', type: 'uint32' }, { name: 'amountPaid', type: 'uint256' }, { name: 'fees', type: 'uint256' }, { name: 'sealedAt', type: 'uint64' }] },
];
const registry = ev.registry ? tw.contract(REGISTRY_ABI, ev.registry) : null;
const hex = (v) => String(v ?? '').replace(/^0x/, '').toLowerCase();

const policies = new Map();
const usedPolicies = new Set(events.filter((e) => e.batch === ev.batch.id && e.data?.policyId).map((e) => e.data.policyId));
for (const p of ev.policies.filter((x) => usedPolicies.has(x.id))) {
  policies.set(p.id, p);
  let sigOk = false;
  try {
    sigOk = await tw.trx.verifyTypedData(p.domain, p.types, p.value, p.signature, p.owner);
  } catch {
    sigOk = false;
  }
  check(sigOk, `Policy ${p.id} was signed by its owner`, `${p.owner}, ${p.signedBy}`);
  check('0x' + sha([...p.payees].sort().join(',')) === p.value.payeesHash, `Policy ${p.id} payee list matches the signed payee hash`, `${p.payees.length} payees`);
  const h = sha(JSON.stringify([p.value.payer, p.value.budget, p.value.perPayment, p.value.payeesHash, p.value.deadline, p.value.policyNonce, p.signature]));
  const logged = events.find((e) => e.type === 'POLICY_ACTIVATED' && e.data.policyId === p.id);
  check(h === p.policyHash && logged?.data.policyHash === h, `Policy ${p.id} hash matches the log`);
  if (registry && p.recordTx) {
    const rec = await registry.policies(p.recordKey ?? p.id).call();
    check(hex(rec.policyHash ?? rec[0]) === h, `Policy ${p.id} hash is recorded in the registry contract`, p.recordTx);
  } else {
    info(`Policy ${p.id} was not recorded on chain`);
  }
}

/* 3. The batch's closing hash is in the log and sealed on chain. */
const closed = events.find((e) => e.type === 'BATCH_CLOSED' && e.batch === ev.batch.id);
if (closed) {
  check(closed.hash === ev.batch.closeHash, 'Batch closing hash matches the log');
  if (registry && ev.batch.sealTx) {
    const seal = await registry.batches(ev.batch.recordKey ?? ev.batch.id).call();
    check(hex(seal.logHash ?? seal[0]) === closed.hash, 'Batch closing hash is sealed in the registry contract', ev.batch.sealTx);
  } else info('Batch was not sealed on chain');
} else info('Batch is not closed yet');

/* 4. The owner approved exactly the rows that were paid, before the first one was signed. */
const APPROVAL_TYPES = { BatchApproval: [
  { name: 'batchId', type: 'uint256' }, { name: 'policyId', type: 'uint256' }, { name: 'rowsHash', type: 'bytes32' },
  { name: 'count', type: 'uint256' }, { name: 'total', type: 'uint256' }] };
const rowsHash = (rows) => '0x' + sha([...rows].sort((a, b) => a.line - b.line).map((r) => `${r.line}:${r.receiver}:${r.amount}`).join(','));
const firstSigned = events.find((e) => e.type === 'ROW_SIGNED' && e.batch === ev.batch.id);
const approval = events.filter((e) => e.type === 'BATCH_APPROVED' && e.batch === ev.batch.id && (!firstSigned || e.id < firstSigned.id)).at(-1);
if (!approval && !firstSigned) info('No payment signed yet, and the owner has not approved the batch yet');
else if (!approval) check(false, 'The owner approved the batch before the first payment was signed');
else {
  const a = approval.data;
  const p = policies.get(a.policyId);
  const value = { batchId: String(ev.batch.id), policyId: String(a.policyId), rowsHash: a.rowsHash, count: String(a.count), total: String(a.total) };
  let ok = false;
  try {
    ok = !!p && a.owner === p.owner && (await tw.trx.verifyTypedData(p.domain, APPROVAL_TYPES, value, a.signature, a.owner));
  } catch {
    ok = false;
  }
  check(ok, 'The policy owner signed the batch approval before the first payment', `${a.count} rows, ${usdt(a.total)} USDT, ${a.signedBy}`);
  const pay = ev.rows.filter((r) => r.decision === 'pay');
  check(rowsHash(pay) === a.rowsHash && pay.length === a.count, 'The rows marked to pay are exactly the rows the owner approved');
}

/* 5. The vault released no more than the owner approved, and the chain agrees. */
const e = utils.ethersUtils;
const kec = (t) => e.keccak256(e.toUtf8Bytes(t));
function e712digest(batchId, a) {
  const abi = e.AbiCoder.defaultAbiCoder();
  const p = policies.get(a.policyId);
  const domain = e.keccak256(abi.encode(['bytes32', 'bytes32', 'bytes32', 'uint256'], [kec('EIP712Domain(string name,string version,uint256 chainId)'), kec(p?.domain.name ?? 'Ansim'), kec(p?.domain.version ?? '1'), p?.domain.chainId ?? 3448148188]));
  const struct = e.keccak256(abi.encode(['bytes32', 'uint256', 'uint256', 'bytes32', 'uint256', 'uint256'], [kec('BatchApproval(uint256 batchId,uint256 policyId,bytes32 rowsHash,uint256 count,uint256 total)'), batchId, a.policyId, a.rowsHash, a.count, a.total]));
  return e.keccak256(e.concat(['0x1901', domain, struct]));
}
const VAULT_ABI = [
  { type: 'function', name: 'released', stateMutability: 'view', inputs: [{ name: '', type: 'bytes32' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'feePerPayment', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
];
const release = events.find((e) => e.type === 'VAULT_RELEASED' && e.batch === ev.batch.id);
if (ev.vault && release) {
  const vault = tw.contract(VAULT_ABI, ev.vault.address);
  const r = release.data;
  // Releases are keyed by the TIP-712 digest of the approval, recomputed here from the logged approval.
  const digest = approval ? e712digest(ev.batch.id, approval.data) : '0x' + '0'.repeat(64);
  const onChain = BigInt(await vault.released(digest).call());
  const fee = BigInt(await vault.feePerPayment().call());
  check(onChain === BigInt(r.amount), 'The vault contract shows the same release for this batch', `${usdt(r.amount)} USDT, ${r.txid}`);
  const a = approval?.data;
  check(!!a && r.rowsHash === a.rowsHash && BigInt(r.amount) <= BigInt(a.total) + BigInt(a.count) * fee, 'The vault released only the approved total plus GasFree fees', a ? `${usdt(a.total)} + ${a.count} × ${usdt(fee)}` : 'no approval');
  check(!firstSigned || release.id < firstSigned.id, 'The vault released the money before the first payment was signed');
} else if (ev.vault) info('The vault has not released money for this batch');

/* 6. Every payment matches its signed record, the chain and the policy. Every refusal was required. */
function refuseReason(p, committed, to, value, maxFee, now, payeeMonth) {
  if (p.status === 'STOPPED') return 'STOPPED_BY_OWNER';
  if (p.status !== 'ACTIVE') return 'NO_ACTIVE_POLICY';
  if (now > p.deadline) return 'DEADLINE_PASSED';
  if (!p.payees.includes(to)) return 'PAYEE_NOT_ALLOWED';
  if (value > p.perPayment) return 'OVER_PER_PAYMENT_CAP';
  if (p.perPayeeMonthly && payeeMonth + value > p.perPayeeMonthly) return 'OVER_MONTHLY_PAYEE_CAP';
  if (committed + value + maxFee > p.budget) return 'OVER_BUDGET_WITH_FEES';
  return null;
}
const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const usdtHex = tw.address.toHex(USDT).slice(2).toLowerCase();
async function usdtTransfers(txid) {
  const txInfo = await tw.trx.getTransactionInfo(txid);
  const list = (txInfo.log ?? [])
    .filter((l) => l.address.toLowerCase() === usdtHex && l.topics?.[0] === TRANSFER_TOPIC)
    .map((l) => ({ from: tw.address.fromHex('41' + l.topics[1].slice(-40)), to: tw.address.fromHex('41' + l.topics[2].slice(-40)), value: BigInt('0x' + l.data) }));
  return { list, time: Math.floor((txInfo.blockTimeStamp ?? 0) / 1000), ok: txInfo.receipt?.result === 'SUCCESS' };
}

const spent = new Map();
const paidTo = new Map(); // receiver -> paid earlier in this batch, a lower bound for the logged 30-day total
const waitMs = (ev.rules?.contactWaitHours ?? 0) * 3600_000;
const travelMin = ev.rules?.travelRuleMin ? BigInt(ev.rules.travelRuleMin) : null;
const batchEvents = events.filter((e) => e.batch === ev.batch.id);
const lastOf = (type, line) => batchEvents.filter((e) => e.type === type && e.data.line === line).at(-1);

for (const r of ev.rows) {
  const label = `Row ${r.line} (${r.recipient || r.receiver})`;
  if (r.decision !== 'pay') {
    info(`${label}: held by the operator, not paid${r.flags.length ? ` [${r.flags.join(', ')}]` : ''}`);
    continue;
  }
  if (r.state === 'SUCCEED') {
    const signed = lastOf('ROW_SIGNED', r.line);
    check(!!signed && signed.data.receiver === r.receiver && signed.data.value === r.amount, `${label}: export matches the signed record`, `${usdt(r.amount)} USDT`);
    if (!signed) continue;
    const p = policies.get(signed.data.policyId);
    if (!r.txnHash) {
      check(false, `${label}: has a transaction hash`);
      continue;
    }
    const t = await usdtTransfers(r.txnHash);
    const pay = t.list.find((x) => x.to === r.receiver && x.value === BigInt(r.amount));
    const fee = pay ? t.list.filter((x) => x.from === pay.from && x !== pay).reduce((s, x) => s + x.value, 0n) : 0n;
    check(t.ok && !!pay, `${label}: chain shows the same receiver and amount`, r.txnHash);
    if (!p) continue;
    const payees = p.payees;
    const s = (spent.get(p.id) ?? 0n) + BigInt(r.amount) + fee;
    spent.set(p.id, s);
    const before = paidTo.get(r.receiver) ?? 0n;
    paidTo.set(r.receiver, before + BigInt(r.amount));
    const month = BigInt(signed.data.payeeMonth ?? 0);
    const cap = BigInt(p.value.perPayeeMonthly ?? 0);
    const monthOk = month >= before && (!cap || month + BigInt(r.amount) <= cap);
    const inside = payees.includes(r.receiver) && BigInt(r.amount) <= BigInt(p.value.perPayment) && t.time <= Number(p.value.deadline) && s <= BigInt(p.value.budget) && fee <= BigInt(signed.data.maxFee) && monthOk;
    check(inside, `${label}: inside policy ${p.id}`, `fee ${usdt(fee)}, spent ${usdt(s)} of ${usdt(p.value.budget)}${cap ? `, 30 days ${usdt(month + BigInt(r.amount))} of ${usdt(cap)}` : ''}`);
    const added = events.filter((e) => e.type === 'CONTACT_ADDED' && e.data.address === r.receiver && e.id < signed.id).at(-1);
    if (waitMs && added) check(signed.ts - added.ts >= waitMs, `${label}: the new contact's waiting period had passed`, `added ${new Date(added.ts).toISOString()}`);
    if (travelMin !== null && BigInt(r.amount) >= travelMin) check(!!(r.travel?.originatorId && r.travel?.purpose), `${label}: Travel Rule details were recorded`, `threshold ${usdt(travelMin)} USDT`);
  } else if (r.state === 'REFUSED') {
    const e = lastOf('ROW_REFUSED', r.line);
    const p = e && policies.get(e.data.policyId);
    if (!e || !p) {
      check(false, `${label}: refusal is recorded`);
      continue;
    }
    const stopped = events.some((x) => x.type === 'POLICY_STOPPED' && x.data.policyId === p.id && x.id < e.id);
    const replaced = events.some((x) => x.type === 'POLICY_ACTIVATED' && x.data.policyId > p.id && x.id < e.id);
    const expect = refuseReason(
      { status: stopped ? 'STOPPED' : replaced ? 'REPLACED' : 'ACTIVE', deadline: Number(p.value.deadline), payees: p.payees, perPayment: Number(p.value.perPayment), budget: Number(p.value.budget), perPayeeMonthly: Number(p.value.perPayeeMonthly ?? 0) },
      e.data.committed, e.data.receiver, e.data.value, e.data.maxFee, e.ts / 1000, e.data.payeeMonth ?? 0,
    );
    check(expect === e.data.reason && r.reason === e.data.reason && e.data.receiver === r.receiver, `${label}: refusal was required by policy ${p.id}`, e.data.reason);
  } else {
    info(`${label}: ${r.state}${r.reason ? ` (${r.reason})` : ''}`);
  }
}

console.log(`\nRESULT: ${failed ? 'FAIL' : 'PASS'}  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
