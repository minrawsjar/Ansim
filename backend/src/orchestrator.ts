import { db, getBatch, getPolicy, getRow, batchRows, updateRow, nowSec, activePolicy, recordKey, type Row } from './db';
import { logEvent } from './log';
import { gasfree, gasfreeConfig, signPermit, GasFreeRejected, type Permit, type GasFreeTransfer } from './gasfree';
import { refuseReason, MONTH_SEC } from './policy';
import { addressFromKey, findUsdtTransfer, recordBatchSeal, usdtBalance, vaultInfo, vaultState } from './tron';

const IN_FLIGHT = ['SIGNED', 'SUBMITTED', 'WAITING', 'INPROGRESS', 'CONFIRMING', 'UNKNOWN'];
const DONE = new Set(['SUCCEED', 'FAILED', 'REFUSED']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function payerKey() {
  const k = process.env.PAYER_PRIVATE_KEY;
  if (!k) throw new Error('PAYER_PRIVATE_KEY is not set in backend/.env.local. Run npm run setup.');
  return k;
}
export const payerAddress = () => addressFromKey(payerKey());

// Everything already paid under this policy, plus the value and fee cap of payments still in flight.
export function committed(policyId: number): number {
  const states = ['SUCCEED', ...IN_FLIGHT].map((s) => `'${s}'`).join(', ');
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(r.amount + COALESCE(CASE WHEN r.state = 'SUCCEED' AND r.fee IS NOT NULL THEN r.fee ELSE r.max_fee END, 0)), 0) AS c
       FROM rows r JOIN batches b ON b.id = r.batch_id
       WHERE b.policy_id = ? AND r.state IN (${states})`,
    )
    .get(policyId) as { c: number };
  return r.c;
}

// What this receiver got, or has in flight, in the last 30 days, under any policy and batch.
export function payeeMonth(receiver: string): number {
  const states = ['SUCCEED', ...IN_FLIGHT].map((s) => `'${s}'`).join(', ');
  const r = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS m FROM rows WHERE receiver = ? AND state IN (${states}) AND signed_at_ms >= ?`)
    .get(receiver, Date.now() - MONTH_SEC * 1000) as { m: number };
  return r.m;
}

export async function precheck(batchId: number) {
  // Only rows not yet signed: a payment already in flight has its money set aside by GasFree.
  const rows = batchRows(batchId).filter((r) => r.decision === 'pay' && r.state === 'READY');
  const inFlight = batchRows(batchId).some((r) => r.decision === 'pay' && IN_FLIGHT.includes(r.state));
  const policy = activePolicy();
  const payer = payerAddress();
  const [{ token, provider }, acct] = await Promise.all([gasfreeConfig(), gasfree.account(payer)]);
  const balance = await usdtBalance(acct.gasFreeAddress);
  const frozen = Number(acct.assets?.find((a) => a.tokenAddress === token.tokenAddress)?.frozen ?? 0);
  const amount = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const transferFees = rows.length * Number(token.transferFee);
  const activation = acct.active ? 0 : Number(token.activateFee);
  const total = amount + transferFees + activation;
  const remaining = policy ? policy.budget - committed(policy.id) : 0;
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!policy || policy.status !== 'ACTIVE') problems.push('There is no active signed policy.');
  // GasFree allows one pending transfer per account, so it says no while a payment is in flight.
  if (!acct.allowSubmit && inFlight) warnings.push('A payment is in flight. GasFree takes one transfer at a time, so the next one waits for it.');
  else if (!acct.allowSubmit) problems.push('GasFree does not accept transfers from this account right now.');
  // With the vault, the GasFree account is filled when Pay is pressed, so the vault's balance is what counts.
  const v = vaultInfo() ? await vaultState().catch(() => null) : null;
  const available = balance - frozen + (v && !v.frozen ? v.balance : 0);
  if (total > 0 && available < total) {
    problems.push(v ? 'The vault and the GasFree account together hold less USDT than this batch needs. Top up the vault first.' : 'The GasFree address holds less USDT than the batch total. Send test USDT to it first.');
  } else if (v && total > 0 && balance - frozen < total) {
    warnings.push(`The vault holds ${(v.balance / 1e6).toFixed(2)} USDT and releases this batch's money when you press Pay.`);
  }
  if (v?.frozen) problems.push('The owner has frozen the vault, so it cannot release money for this batch.');
  if (policy && total > remaining) warnings.push('The batch total is above the remaining budget. The policy will refuse the rows that do not fit.');
  return {
    payer, gasFreeAddress: acct.gasFreeAddress, active: acct.active, allowSubmit: acct.allowSubmit, nonce: acct.nonce,
    token: { symbol: token.symbol, address: token.tokenAddress, transferFee: Number(token.transferFee), activateFee: Number(token.activateFee), decimal: token.decimal },
    provider: { address: provider.address, name: provider.name, maxPendingTransfer: provider.config?.maxPendingTransfer },
    balance, frozen, count: rows.length, amount, transferFees, activation, total, vaultBalance: v?.balance ?? null,
    budget: policy?.budget ?? 0, remaining, problems, warnings,
  };
}

const g = globalThis as unknown as { __ansimRuns?: Set<number> };
const running = (g.__ansimRuns ??= new Set<number>());
export const isRunning = (batchId: number) => running.has(batchId);

export function startRun(batchId: number) {
  if (running.has(batchId)) return;
  const policy = activePolicy();
  if (!policy || policy.status !== 'ACTIVE') throw new Error('Sign an active spending policy first.');
  payerKey();
  if (!process.env.GASFREE_API_KEY || !process.env.GASFREE_API_SECRET) throw new Error('Set GASFREE_API_KEY and GASFREE_API_SECRET in backend/.env.local first.');
  const batch = getBatch(batchId);
  if (!batch || batch.status === 'CLOSED') throw new Error('This batch is already closed.');
  db.prepare("UPDATE batches SET status = 'RUNNING', policy_id = ? WHERE id = ?").run(policy.id, batchId);
  logEvent('BATCH_STARTED', { policyId: policy.id }, batchId);
  launch(batchId, () => runBatch(batchId));
}

function launch(batchId: number, work: () => Promise<void>) {
  running.add(batchId);
  work()
    .catch((e) => {
      db.prepare("UPDATE batches SET status = 'PAUSED' WHERE id = ?").run(batchId);
      logEvent('BATCH_PAUSED', { reason: msg(e) }, batchId);
    })
    .finally(() => running.delete(batchId));
}

// A deploy or crash kills the process mid-batch, leaving it RUNNING with nothing paying it. On startup, settle
// every in-flight row the never-pay-twice way (a row may have been signed and sent but not yet recorded), then
// pay the rest. Every row still goes through the policy gate, so a stop or passed deadline is respected.
export function resumeRuns() {
  for (const { id } of db.prepare("SELECT id FROM batches WHERE status = 'RUNNING'").all() as { id: number }[]) {
    logEvent('BATCH_RESUMED', { reason: 'The server restarted while this batch was paying' }, id);
    launch(id, async () => {
      for (const r of batchRows(id).filter((x) => x.decision === 'pay' && IN_FLIGHT.includes(x.state))) {
        if (!(await recoverRow(r, true))) {
          db.prepare("UPDATE batches SET status = 'PAUSED' WHERE id = ?").run(id);
          logEvent('BATCH_PAUSED', { line: r.line, reason: 'Payment outcome still unknown. Press Recover later.' }, id);
          return;
        }
      }
      await runBatch(id);
    });
  }
}

async function runBatch(batchId: number) {
  for (const { id } of batchRows(batchId).filter((r) => r.decision === 'pay')) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let row = getRow(id);
      if (DONE.has(row.state)) break;
      try {
        await payRow(row);
      } catch (e) {
        row = getRow(id);
        if (!row.permit) {
          // Failed before anything was signed (network or config). Nothing can have been paid: pause.
          updateRow(id, { state: 'READY', error: msg(e) });
          db.prepare("UPDATE batches SET status = 'PAUSED' WHERE id = ?").run(batchId);
          logEvent('BATCH_PAUSED', { line: row.line, reason: msg(e) }, batchId);
          return;
        }
        updateRow(id, { state: 'UNKNOWN', error: msg(e) });
        logEvent('ROW_ERROR', { line: row.line, error: msg(e) }, batchId, id);
      }
      row = getRow(id);
      if (DONE.has(row.state)) break;
      // Never move on while a payment's outcome is unknown: the next row would get the same nonce.
      if (!(await recoverRow(row, true))) {
        db.prepare("UPDATE batches SET status = 'PAUSED' WHERE id = ?").run(batchId);
        logEvent('BATCH_PAUSED', { line: row.line, reason: 'Payment outcome still unknown. Press Recover later.' }, batchId);
        return;
      }
      // A READY row here had an expired, unused permit. Loop once more to sign a fresh one.
    }
  }
  await closeIfDone(batchId);
}

async function payRow(row: Row) {
  const policy = getPolicy(getBatch(row.batch_id)!.policy_id!)!;
  if (!row.permit) {
    const { token, provider } = await gasfreeConfig();
    const payer = payerAddress();
    const acct = await gasfree.account(payer);
    const maxFee = Number(token.transferFee) + (acct.active ? 0 : Number(token.activateFee));
    const value = row.amount ?? 0;
    const c = committed(policy.id);
    const month = payeeMonth(row.receiver);
    const facts = { policyId: policy.id, line: row.line, receiver: row.receiver, value, maxFee, committed: c, payeeMonth: month };
    const reason = refuseReason(policy, c, row.receiver, value, maxFee, Date.now() / 1000, month);
    if (reason) {
      updateRow(row.id, { state: 'REFUSED', reason });
      logEvent('ROW_REFUSED', { ...facts, reason }, row.batch_id, row.id);
      return;
    }
    const cfg = provider.config ?? ({} as Partial<typeof provider.config>);
    const duration = clamp(cfg.defaultDeadlineDuration ?? 180, cfg.minDeadlineDuration ?? 60, cfg.maxDeadlineDuration ?? 600);
    const deadline = Math.min(nowSec() + duration, policy.deadline);
    const permit = await signPermit(
      { token: token.tokenAddress, serviceProvider: provider.address, user: payer, receiver: row.receiver, value: String(value), maxFee: String(maxFee), deadline, nonce: acct.nonce },
      payerKey(),
    );
    updateRow(row.id, { state: 'SIGNED', permit: JSON.stringify(permit), nonce: acct.nonce, deadline, max_fee: maxFee, signed_at_ms: Date.now(), error: null });
    logEvent('ROW_SIGNED', { ...facts, nonce: acct.nonce, deadline, requestId: permit.requestId }, row.batch_id, row.id);
    row = getRow(row.id);
  }
  if (!row.trace_id) await submit(row, false);
  row = getRow(row.id);
  if (row.trace_id && !DONE.has(row.state)) await poll(row);
}

// Rejections that mean "this permit will never run, sign a fresh one" (reasons from docs.gasfree.io).
const RETRY_WITH_NEW_PERMIT = new Set(['NonceNotMatchException', 'DeadlineExceededException', 'TooManyPendingTransferException']);

const simulateLost = (row: Row) =>
  Number(process.env.SIMULATE_LOST_RESPONSE_LINE) === row.line &&
  !db.prepare("SELECT 1 FROM events WHERE row_id = ? AND type = 'ROW_SUBMIT_LOST'").get(row.id);

async function submit(row: Row, resend: boolean) {
  const permit = JSON.parse(row.permit!) as Permit;
  const policy = getPolicy(getBatch(row.batch_id)!.policy_id!)!;
  if (!resend && policy.status === 'STOPPED') {
    // Signed a moment before the owner pressed Stop, but never sent. Drop it.
    updateRow(row.id, { state: 'REFUSED', reason: 'STOPPED_BY_OWNER', permit: null });
    logEvent('ROW_REFUSED', { policyId: policy.id, line: row.line, receiver: row.receiver, value: row.amount, maxFee: row.max_fee, committed: committed(policy.id), payeeMonth: payeeMonth(row.receiver), reason: 'STOPPED_BY_OWNER', signedButNeverSent: true }, row.batch_id, row.id);
    return;
  }
  try {
    const r = await gasfree.submit(permit);
    if (!resend && simulateLost(row)) {
      updateRow(row.id, { state: 'UNKNOWN', error: 'Response dropped on purpose to show recovery (SIMULATE_LOST_RESPONSE_LINE)' });
      logEvent('ROW_SUBMIT_LOST', { line: row.line, simulated: true }, row.batch_id, row.id);
      return;
    }
    updateRow(row.id, { state: r.state ?? 'WAITING', trace_id: r.id, error: null });
    logEvent(resend ? 'ROW_RESENT' : 'ROW_SUBMITTED', { line: row.line, requestId: permit.requestId, traceId: r.id, nonce: permit.nonce, sameSignature: resend }, row.batch_id, row.id);
  } catch (e) {
    if (e instanceof GasFreeRejected && !resend) {
      // GasFree refused this permit, so it is not queued and can never execute. Dropping it is safe.
      if (RETRY_WITH_NEW_PERMIT.has(e.reason)) {
        updateRow(row.id, { state: 'READY', permit: null, nonce: null, deadline: null, max_fee: null, signed_at_ms: null, error: msg(e) });
        logEvent('ROW_PERMIT_DROPPED', { line: row.line, reason: e.reason, requestId: permit.requestId }, row.batch_id, row.id);
        if (e.reason === 'TooManyPendingTransferException') await sleep(5000);
        return;
      }
      if (e.reason === 'InsufficientBalanceException') {
        updateRow(row.id, { state: 'READY', permit: null, nonce: null, deadline: null, max_fee: null, signed_at_ms: null, error: msg(e) });
        logEvent('ROW_PERMIT_DROPPED', { line: row.line, reason: e.reason, requestId: permit.requestId }, row.batch_id, row.id);
        throw new Error('GasFree says the balance is too low. Top up the GasFree address, then press Pay again.');
      }
      updateRow(row.id, { state: 'FAILED', reason: 'REJECTED_BY_GASFREE', error: msg(e) });
      logEvent('ROW_FAILED', { line: row.line, reason: e.reason, error: msg(e), requestId: permit.requestId }, row.batch_id, row.id);
      return;
    }
    updateRow(row.id, { state: 'UNKNOWN', error: msg(e) });
    logEvent(resend ? 'ROW_RESEND_REJECTED' : 'ROW_SUBMIT_UNKNOWN', { line: row.line, error: msg(e), requestId: permit.requestId }, row.batch_id, row.id);
  }
}

async function poll(row: Row, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let s: GasFreeTransfer | null = null;
    try {
      s = await gasfree.status(row.trace_id!);
    } catch {
      // keep polling
    }
    if (s) {
      const fee = s.txnTotalFee != null ? Number(s.txnTotalFee) : null;
      if (s.state !== row.state || (s.txnHash && s.txnHash !== row.txn_hash)) {
        updateRow(row.id, {
          state: s.state, txn_hash: s.txnHash ?? row.txn_hash, fee: fee ?? row.fee,
          reason: s.state === 'FAILED' ? s.txnState ?? 'FAILED' : row.reason,
        });
        logEvent('ROW_STATE', { line: row.line, state: s.state, txnHash: s.txnHash ?? null, fee }, row.batch_id, row.id);
        row = getRow(row.id);
      }
      if ((s.state === 'SUCCEED' && s.txnHash) || s.state === 'FAILED') return;
    }
    await sleep(2500);
  }
  updateRow(row.id, { state: 'UNKNOWN', error: `No final status within ${timeoutMs / 1000} s` });
  logEvent('ROW_TIMEOUT', { line: row.line, traceId: row.trace_id }, row.batch_id, row.id);
}

// Settles a row whose outcome is unknown without ever paying twice:
// 1. A request ID exists: ask GasFree for its status.
// 2. The permit is still inside its deadline: resend the same signed permit. Its nonce works only
//    once, so GasFree either returns the transfer it already has or rejects the copy.
// 3. The account nonce moved past the permit's nonce: it was used. Find the transfer on chain.
// 4. The deadline passed and the nonce never moved: the permit is dead, so a new one is safe.
export async function recoverRow(row: Row, patient: boolean): Promise<boolean> {
  const until = Date.now() + (patient ? 240_000 : 20_000);
  do {
    row = getRow(row.id);
    if (DONE.has(row.state) || row.state === 'READY') return true;
    if (row.trace_id) {
      await poll(row, 30_000);
      if (DONE.has(getRow(row.id).state)) return true;
      continue;
    }
    if (!row.permit) {
      updateRow(row.id, { state: 'READY' });
      return true;
    }
    const permit = JSON.parse(row.permit) as Permit;
    if (nowSec() < permit.deadline) {
      await submit(row, true);
      if (getRow(row.id).trace_id) continue;
    }
    const acct = await gasfree.account(permit.user);
    if (acct.nonce > permit.nonce) {
      const hash = await findUsdtTransfer(acct.gasFreeAddress, row.receiver, Number(permit.value), (row.signed_at_ms ?? Date.now()) - 60_000);
      if (hash) {
        updateRow(row.id, { state: 'SUCCEED', txn_hash: hash, error: null });
        logEvent('ROW_RECOVERED', { line: row.line, txnHash: hash, how: 'Nonce was used; matching transfer found on chain' }, row.batch_id, row.id);
        return true;
      }
    } else if (nowSec() >= permit.deadline) {
      updateRow(row.id, { state: 'READY', permit: null, nonce: null, deadline: null, max_fee: null, error: null, signed_at_ms: null });
      logEvent('ROW_PERMIT_EXPIRED', { line: row.line, nonce: permit.nonce, deadline: permit.deadline }, row.batch_id, row.id);
      return true;
    }
    await sleep(4000);
  } while (Date.now() < until);
  return false;
}

export async function recoverBatch(batchId: number) {
  if (running.has(batchId)) throw new Error('This batch is still running.');
  for (const r of batchRows(batchId).filter((x) => x.decision === 'pay' && IN_FLIGHT.includes(x.state))) {
    await recoverRow(r, false);
  }
  await closeIfDone(batchId);
}

export function summarize(rows: Row[]) {
  const pay = rows.filter((r) => r.decision === 'pay');
  const paid = pay.filter((r) => r.state === 'SUCCEED');
  return {
    total: rows.length,
    paid: paid.length,
    failed: pay.filter((r) => r.state === 'FAILED').length,
    refused: pay.filter((r) => r.state === 'REFUSED').length,
    held: rows.length - pay.length,
    ready: pay.filter((r) => r.state === 'READY').length,
    awaiting: pay.filter((r) => !DONE.has(r.state) && r.state !== 'READY').length,
    amountPaid: paid.reduce((s, r) => s + (r.amount ?? 0), 0),
    fees: paid.reduce((s, r) => s + (r.fee ?? 0), 0),
  };
}

async function closeIfDone(batchId: number) {
  const batch = getBatch(batchId)!;
  const rows = batchRows(batchId);
  const summary = summarize(rows);
  if (summary.awaiting > 0 || summary.ready > 0) {
    db.prepare("UPDATE batches SET status = 'PAUSED' WHERE id = ?").run(batchId);
    return;
  }
  const { hash } = logEvent('BATCH_CLOSED', { policyId: batch.policy_id, ...summary }, batchId);
  db.prepare("UPDATE batches SET status = 'CLOSED', close_hash = ? WHERE id = ?").run(hash, batchId);
  try {
    const policy = batch.policy_id ? getPolicy(batch.policy_id) : undefined;
    const key = recordKey(batchId);
    const txid = await recordBatchSeal({ batchId: key, policyId: policy?.record_key ?? batch.policy_id ?? 0, logHash: hash, ...summary });
    if (txid) {
      db.prepare('UPDATE batches SET anchor_tx = ?, record_key = ? WHERE id = ?').run(txid, key, batchId);
      logEvent('BATCH_SEALED', { txid, logHash: hash, recordKey: key }, batchId);
    } else {
      logEvent('SEAL_SKIPPED', { reason: 'Registry contract not deployed or NOTARY_PRIVATE_KEY missing' }, batchId);
    }
  } catch (e) {
    logEvent('SEAL_FAILED', { error: msg(e) }, batchId);
  }
}
