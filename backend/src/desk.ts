import fs from 'node:fs';
import { randomInt, randomBytes } from 'node:crypto';
import { db, getBatch, getPolicy, getRow, batchRows, updateRow, activePolicy, nowSec, recordKey, type Row, type Batch } from './db';
import { logEvent, allEvents, batchEvents } from './log';
import { policyDomain, policyTypesFor, policyValue, policyHash, payeesHash, approvalTypes, approvalValue } from './policy';
import { parseSheet, headerSignature, ruleMapping, validMapping, toRows, type Mapping } from './importer';
import { screen, contactProblem, BLOCKING, type Payee, type ScreenRow } from './screen';
import { ask, kilnConfigured, PROMPTS, MODEL } from './agent';
import { tw, isTetherFrozen, recordPolicy, recordStop, registryInfo, addressFromKey, usdtTransferProof, usdtBalance, vaultInfo, vaultState, vaultReleased, vaultRelease, vaultSetFrozen, NILE_USDT } from './tron';
import { gasfree, gasfreeConfig, signPermit } from './gasfree';
import { payerAddress, payerKey, summarize, msg, payeeMonth, startRun, isRunning } from './orchestrator';
import { telegramConfigured } from './alerts';

const dataFile = (name: string) => new URL(`../data/${name}`, import.meta.url);
const readJson = <T>(name: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')) as T;
  } catch {
    return fallback;
  }
};

// Screening settings. New contacts wait before they can be paid, like the delayed-transfer service
// (지연이체) Korean banks offer against voice phishing, which holds transfers for at least 3 hours.
// Korea's Travel Rule applies to virtual-asset transfers of ₩1,000,000 or more; the KRW rate is set here.
export function screenRules() {
  const krwPerUsdt = Number(process.env.KRW_PER_USDT || 1400);
  const travelKrw = Number(process.env.TRAVEL_RULE_KRW || 1_000_000);
  return {
    waitSec: Number(process.env.CONTACT_WAIT_HOURS ?? 3) * 3600,
    travelMin: Math.ceil((travelKrw / krwPerUsdt) * 1e6),
    krwPerUsdt, travelKrw,
  };
}

// The payee book (contacts): wallets this business pays, with the usual amount in USDT.
// Seeded once from data/payees.json, then edited in the console. user_version records which seed steps
// ran, so removing every contact does not bring the demo contacts back. Seeded contacts get
// created_at 0: they were paid before, so they skip the waiting period for new contacts.
type Contact = { address: string; name: string; country: string | null; usual: number; created_at: number };
export function payeeBook(): Contact[] {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version < 2) {
    const seed = readJson<Contact[]>('payees.json', []);
    const add = db.prepare('INSERT OR IGNORE INTO payees (address, name, country, usual, created_at) VALUES (?, ?, ?, ?, 0)');
    const old = db.prepare('UPDATE payees SET created_at = 0 WHERE address = ?');
    for (const p of seed) {
      if (version < 1) add.run(p.address, p.name, p.country ?? null, p.usual ?? 0);
      else old.run(p.address);
    }
    db.pragma('user_version = 2');
  }
  return db.prepare('SELECT address, name, country, usual, created_at FROM payees ORDER BY created_at, rowid').all() as Contact[];
}

export async function addContact(input: { name?: string; country?: string; address?: string; usual?: number | string }) {
  const name = String(input.name ?? '').trim().slice(0, 80);
  const address = String(input.address ?? '').trim();
  const usual = Number(input.usual || 0);
  if (!name) throw new Error('Enter the recipient’s name.');
  if (!Number.isFinite(usual) || usual < 0) throw new Error('The usual amount must be a positive number.');
  const problem = contactProblem(address, payeeBook(), reported());
  if (problem) throw new Error(problem);
  if ((await isTetherFrozen(address)) === true) throw new Error('Tether has frozen this wallet on mainnet.');
  const country = String(input.country ?? '').trim().slice(0, 40) || null;
  db.prepare('INSERT INTO payees (address, name, country, usual, created_at) VALUES (?, ?, ?, ?, ?)').run(address, name, country, usual, nowSec());
  logEvent('CONTACT_ADDED', { address, name, country, usual });
  return payeeBook();
}

// Removing a contact does not change a policy that is already signed.
export function removeContact(address: string) {
  const c = payeeBook().find((p) => p.address === address);
  if (!c) throw new Error('That wallet is not in the contacts.');
  db.prepare('DELETE FROM payees WHERE address = ?').run(address);
  logEvent('CONTACT_REMOVED', { address, name: c.name });
  return payeeBook();
}

const bookMap = () => new Map<string, Payee>(payeeBook().map((p) => [p.address, { ...p, usual: Math.round(p.usual * 1e6), added: p.created_at }]));
// Stand-in for wallets reported to police and exchanges.
const reported = () => new Set(readJson<string[]>('reported.json', []));

/* ---------------- policy ---------------- */

export function draftPolicy(input: { budget: number; perPayment: number; perPayeeMonthly?: number; deadline: number; payees: string[] }) {
  if (!(input.budget > 0) || !(input.perPayment > 0)) throw new Error('Budget and per-payment cap must be above zero.');
  if (!(input.deadline > nowSec())) throw new Error('The deadline must be in the future.');
  if (!input.payees.length) throw new Error('Allow at least one payee.');
  const payees = [...new Set(input.payees)].sort();
  // 0 means no monthly cap per contact.
  const monthly = Math.round(Number(input.perPayeeMonthly ?? 0) * 1e6);
  if (!Number.isFinite(monthly) || monthly < 0) throw new Error('The monthly cap per contact must be zero or more.');
  if (monthly && monthly < Math.round(input.perPayment * 1e6)) throw new Error('The monthly cap per contact must be at least the cap per payment.');
  const r = db
    .prepare(
      `INSERT INTO policies (payer, budget, per_payment, per_payee_monthly, payees, payees_hash, deadline, policy_nonce, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
    )
    .run(payerAddress(), Math.round(input.budget * 1e6), Math.round(input.perPayment * 1e6), monthly, JSON.stringify(payees), payeesHash(payees), Math.floor(input.deadline), randomInt(1, 2 ** 31), nowSec());
  const p = getPolicy(Number(r.lastInsertRowid))!;
  return { id: p.id, domain: policyDomain, types: policyTypesFor(p), value: policyValue(p) };
}

export async function activatePolicy(input: { id: number; signature?: string; owner?: string; serverSign?: boolean }) {
  const p = getPolicy(input.id);
  if (!p || p.status !== 'DRAFT') throw new Error('That policy draft does not exist or was already used.');
  const value = policyValue(p);
  let { signature, owner } = input;
  let signedBy = 'tronlink';
  if (input.serverSign) {
    const key = process.env.OWNER_PRIVATE_KEY;
    if (!key) throw new Error('OWNER_PRIVATE_KEY is not set, so the server cannot sign as the owner.');
    signature = await tw.trx.signTypedData(policyDomain, policyTypesFor(p), value, key);
    owner = addressFromKey(key);
    signedBy = 'server-demo-key';
  }
  if (!signature || !owner) throw new Error('A signature and the owner address are required.');
  let ok = false;
  try {
    ok = await tw.trx.verifyTypedData(policyDomain, policyTypesFor(p), value, signature, owner);
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('The signature does not match the policy and owner address.');
  const hash = policyHash(p, signature);
  db.prepare("UPDATE policies SET status = 'REPLACED' WHERE status IN ('ACTIVE', 'STOPPED')").run();
  db.prepare("UPDATE policies SET status = 'ACTIVE', owner = ?, signature = ?, signed_by = ?, policy_hash = ? WHERE id = ?").run(owner, signature, signedBy, hash, p.id);
  logEvent('POLICY_ACTIVATED', { policyId: p.id, policyHash: hash, owner, signedBy, payer: p.payer, budget: p.budget, perPayment: p.per_payment, perPayeeMonthly: p.per_payee_monthly, deadline: p.deadline, payeesHash: p.payees_hash });
  try {
    const key = recordKey(p.id);
    const txid = await recordPolicy({ id: key, hash, payer: p.payer, owner, budget: p.budget, perPayment: p.per_payment, deadline: p.deadline });
    if (txid) {
      db.prepare('UPDATE policies SET anchor_tx = ?, record_key = ? WHERE id = ?').run(txid, key, p.id);
      logEvent('POLICY_RECORDED', { policyId: p.id, recordKey: key, txid });
    }
  } catch (e) {
    logEvent('POLICY_RECORD_FAILED', { policyId: p.id, error: msg(e) });
  }
  return getPolicy(p.id);
}

export async function stopPolicy() {
  const p = activePolicy();
  if (!p || p.status !== 'ACTIVE') throw new Error('There is no active policy to stop.');
  db.prepare("UPDATE policies SET status = 'STOPPED' WHERE id = ?").run(p.id);
  logEvent('POLICY_STOPPED', { policyId: p.id });
  recordStop(p.record_key ?? p.id)
    .then((txid) => txid && logEvent('POLICY_STOP_RECORDED', { policyId: p.id, txid }))
    .catch((e) => logEvent('POLICY_RECORD_FAILED', { policyId: p.id, error: msg(e) }));
  return getPolicy(p.id);
}

/* ---------------- import & review ---------------- */

async function mapColumns(header: string[], body: string[][]): Promise<{ mapping: Mapping; mappedBy: string }> {
  const sig = headerSignature(header);
  const hit = db.prepare('SELECT mapping FROM column_maps WHERE signature = ?').get(sig) as { mapping: string } | undefined;
  if (hit && validMapping(JSON.parse(hit.mapping), header)) return { mapping: JSON.parse(hit.mapping), mappedBy: 'cache' };
  if (kilnConfigured()) {
    try {
      const m = await ask<Mapping>('map_columns', PROMPTS.map_columns, { header, samples: body.slice(0, 3) }, { maxTokens: 600 });
      if (validMapping(m, header)) {
        db.prepare('INSERT OR REPLACE INTO column_maps (signature, mapping) VALUES (?, ?)').run(sig, JSON.stringify(m));
        return { mapping: m, mappedBy: 'kiln' };
      }
    } catch (e) {
      logEvent('AGENT_ERROR', { flow: 'map_columns', error: msg(e) });
    }
  }
  const rules = ruleMapping(header);
  if (!validMapping(rules, header)) throw new Error('Could not find the wallet address and amount columns in this file.');
  return { mapping: rules, mappedBy: 'rules' };
}

// Re-runs every check for the whole batch, because duplicates and many-senders depend on other rows.
async function rescreen(batchId: number) {
  const rows = batchRows(batchId);
  const list: (ScreenRow & { id: number })[] = rows.map((r) => ({ id: r.id, line: r.line, sender: r.sender ?? '', receiver: r.receiver, amount: r.amount, note: r.note ?? '', flags: [], travel: !!r.travel }));
  const result = await screen(list, bookMap(), reported(), isTetherFrozen, screenRules());
  const tx = db.transaction(() => {
    for (const s of list) {
      const r = rows.find((x) => x.id === s.id)!;
      const blocked = s.flags.some((f) => BLOCKING.has(f));
      updateRow(r.id, { flags: JSON.stringify(s.flags), ...(blocked && r.decision === 'pay' ? { decision: 'hold' as const } : {}) });
    }
  });
  tx();
  return result;
}

export async function importFile(buf: Buffer, filename: string) {
  const { header, body } = parseSheet(buf, filename);
  const { mapping, mappedBy } = await mapColumns(header, body);
  const parsed = toRows(header, body, mapping);
  const b = db.prepare('INSERT INTO batches (source, columns, mapped_by, created_at) VALUES (?, ?, ?, ?)').run(filename, JSON.stringify(mapping), mappedBy, nowSec());
  const batchId = Number(b.lastInsertRowid);
  const ins = db.prepare(
    'INSERT INTO rows (batch_id, line, sender, name, receiver, amount, amount_raw, note, decision, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const r of parsed) ins.run(batchId, r.line, r.sender, r.name, r.receiver, r.amount, r.amount_raw, r.note, 'pay', Date.now());
  })();
  const { freezeCheckFailed } = await rescreen(batchId);
  // Flagged rows start on hold. The operator confirms, fixes or removes each one.
  for (const r of batchRows(batchId)) if (JSON.parse(r.flags).length) updateRow(r.id, { decision: 'hold' });
  const flagged = batchRows(batchId).filter((r) => JSON.parse(r.flags).length).length;
  logEvent('BATCH_IMPORTED', { source: filename, rows: parsed.length, flagged, mappedBy, columns: mapping, freezeCheckFailed }, batchId);
  return batchId;
}

export async function editRow(rowId: number, patch: { receiver?: string; amount?: string; decision?: 'pay' | 'hold' | 'remove'; travel?: { originatorId?: string; purpose?: string } }) {
  const row = getRow(rowId);
  if (!row) throw new Error('Row not found.');
  const batch = getBatch(row.batch_id)!;
  if (batch.status !== 'REVIEW') throw new Error('Rows can only be changed before the batch is paid.');
  const before = { receiver: row.receiver, amount: row.amount, decision: row.decision };
  if (patch.receiver !== undefined || patch.amount !== undefined) {
    const amount = patch.amount !== undefined ? Math.round(Number(patch.amount) * 1e6) : row.amount;
    updateRow(rowId, { receiver: (patch.receiver ?? row.receiver).trim(), amount: Number.isFinite(amount) && (amount ?? 0) > 0 ? amount : null, amount_raw: patch.amount ?? row.amount_raw, agent: null });
    await rescreen(row.batch_id);
    const after = getRow(rowId);
    updateRow(rowId, { decision: JSON.parse(after.flags).length ? 'hold' : 'pay' });
  }
  if (patch.travel) {
    // Travel Rule details stay off chain and out of the shared log; only the fact that they were added is logged.
    const originatorId = String(patch.travel.originatorId ?? '').trim().slice(0, 100);
    const purpose = String(patch.travel.purpose ?? '').trim().slice(0, 100);
    if (!originatorId || !purpose) throw new Error('Enter the sender’s customer ID or date of birth, and the purpose of the transfer.');
    updateRow(rowId, { travel: JSON.stringify({ originatorId, purpose, addedAt: nowSec() }) });
    await rescreen(row.batch_id);
  }
  if (patch.decision) {
    const flags: string[] = JSON.parse(getRow(rowId).flags);
    const blocking = flags.filter((f) => BLOCKING.has(f));
    if (patch.decision === 'pay' && blocking.length) throw new Error(`This row cannot be paid: ${blocking.join(', ')}.`);
    updateRow(rowId, { decision: patch.decision });
  }
  const after = getRow(rowId);
  logEvent('ROW_EDITED', { line: row.line, before, after: { receiver: after.receiver, amount: after.amount, decision: after.decision }, flags: JSON.parse(after.flags), ...(patch.travel ? { travelRuleDetailsAdded: true } : {}) }, row.batch_id, rowId);
  if (batch.approval) {
    db.prepare('UPDATE batches SET approval = NULL WHERE id = ?').run(row.batch_id);
    logEvent('APPROVAL_CLEARED', { reason: `Line ${row.line} changed after the owner approved` }, row.batch_id);
  }
  return after;
}

// Runs every check again, for example after a new contact's waiting period has passed.
export async function recheck(batchId: number) {
  if (getBatch(batchId)!.status !== 'REVIEW') throw new Error('Checks can only run again before the batch is paid.');
  await rescreen(batchId);
  const flagged = batchRows(batchId).filter((r) => JSON.parse(r.flags).length).length;
  logEvent('BATCH_RECHECKED', { flagged }, batchId);
  return { flagged };
}

/* ---------------- owner approval ---------------- */

const payRows = (batchId: number) => batchRows(batchId).filter((r) => r.decision === 'pay');

export function approvalDraft(batchId: number) {
  const batch = getBatch(batchId)!;
  if (batch.status === 'CLOSED' || batch.status === 'RUNNING') throw new Error('This batch is already being paid or closed.');
  const policy = activePolicy();
  if (!policy || policy.status !== 'ACTIVE') throw new Error('Sign the payment limits first.');
  const rows = payRows(batchId);
  if (!rows.length) throw new Error('No rows are marked to pay.');
  return { domain: policyDomain, types: approvalTypes, value: approvalValue(batchId, policy.id, rows), owner: policy.owner };
}

export async function approveBatch(batchId: number, input: { signature?: string; owner?: string; serverSign?: boolean }) {
  const draft = approvalDraft(batchId);
  let { signature, owner } = input;
  let signedBy = 'tronlink';
  if (input.serverSign) {
    const key = process.env.OWNER_PRIVATE_KEY;
    if (!key) throw new Error('OWNER_PRIVATE_KEY is not set, so the server cannot sign as the owner.');
    signature = await tw.trx.signTypedData(policyDomain, approvalTypes, draft.value, key);
    owner = addressFromKey(key);
    signedBy = 'server-demo-key';
  }
  if (!signature || !owner) throw new Error('A signature and the owner address are required.');
  if (owner !== draft.owner) throw new Error('Only the owner who signed the payment limits can approve this batch.');
  let ok = false;
  try {
    ok = await tw.trx.verifyTypedData(policyDomain, approvalTypes, draft.value, signature, owner);
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('The signature does not match this batch and owner address.');
  const approval = { value: draft.value, signature, owner, signedBy, at: nowSec() };
  db.prepare('UPDATE batches SET approval = ? WHERE id = ?').run(JSON.stringify(approval), batchId);
  const v = draft.value;
  logEvent('BATCH_APPROVED', { policyId: Number(v.policyId), rowsHash: v.rowsHash, count: Number(v.count), total: Number(v.total), owner, signedBy, signature }, batchId);
  return approval;
}

type Approval = { value: ReturnType<typeof approvalValue>; signature: string; owner: string; signedBy: string; at: number };

// Why this batch cannot be paid yet, or null. The approval must cover exactly the rows marked to pay,
// under the policy that is active now.
function approvalProblem(batch: Batch): string | null {
  if (!batch.approval) return 'The owner has not approved this batch yet.';
  const a = JSON.parse(batch.approval) as Approval;
  const policy = activePolicy();
  if (!policy || String(policy.id) !== a.value.policyId) return 'New payment limits were signed after the owner approved. Ask the owner to approve again.';
  if (approvalValue(batch.id, policy.id, payRows(batch.id)).rowsHash !== a.value.rowsHash) return 'The rows changed after the owner approved. Ask the owner to approve again.';
  return null;
}

// Before paying, every check runs again: the freeze list is live, and a contact could have been
// removed and added again. Then the owner's approval must still match the rows.
export async function payBatch(batchId: number) {
  if (isRunning(batchId)) return;
  const batch = getBatch(batchId)!;
  if (batch.status === 'CLOSED') throw new Error('This batch is already closed.');
  if (batch.status === 'REVIEW') await rescreen(batchId);
  const problem = approvalProblem(getBatch(batchId)!);
  if (problem) throw new Error(problem);
  if (vaultInfo()) await releaseFromVault(batchId);
  startRun(batchId);
}

/* ---------------- vault ---------------- */

// The vault checks the owner's approval signature itself and sends exactly this batch's money,
// plus GasFree's fee per payment, to the payer's GasFree account. Once per batch.
async function releaseFromVault(batchId: number) {
  const a = JSON.parse(getBatch(batchId)!.approval!) as Approval;
  if ((await vaultReleased(a.value)) > 0) return; // released before, for example when a start failed later
  const v = (await vaultState())!;
  const amount = Number(a.value.total) + Number(a.value.count) * v.feePerPayment;
  const facts = { vault: v.address, policyId: Number(a.value.policyId), rowsHash: a.value.rowsHash, count: Number(a.value.count), total: Number(a.value.total), amount };
  let reason: string | null = null;
  if (v.frozen) reason = 'The owner has frozen the vault.';
  else if (v.owner !== a.owner) reason = `The vault’s owner is ${v.owner}, but ${a.owner} approved this batch. The vault only accepts its owner’s approval.`;
  else if (v.balance < amount) reason = `The vault holds ${(v.balance / 1e6).toFixed(2)} USDT, less than this batch needs (${(amount / 1e6).toFixed(2)}). Move USDT into the vault first.`;
  if (!reason) {
    try {
      const txid = await vaultRelease({ ...a.value, signature: a.signature });
      logEvent('VAULT_RELEASED', { ...facts, txid }, batchId);
      return;
    } catch (e) {
      reason = msg(e);
    }
  }
  logEvent('VAULT_REFUSED', { ...facts, reason }, batchId);
  throw new Error(reason);
}

export async function vaultView() {
  const v = await vaultState();
  if (!v) return null;
  const released = db.prepare("SELECT body FROM events WHERE type = 'VAULT_RELEASED'").all() as { body: string }[];
  return {
    ...v,
    releasedTotal: released.reduce((s, e) => s + JSON.parse(e.body).data.amount, 0),
    releases: released.length,
    ownerIsDemoKey: !!process.env.OWNER_PRIVATE_KEY && addressFromKey(process.env.OWNER_PRIVATE_KEY) === v.owner,
    // Just enough ABI for TronLink to send setFrozen when the owner is a TronLink account.
    abi: vaultInfo()!.abi.filter((f: { name?: string }) => f.name === 'setFrozen'),
  };
}

export async function freezeVault(frozen: boolean) {
  const key = process.env.OWNER_PRIVATE_KEY;
  const v = await vaultState();
  if (!v) throw new Error('No vault is deployed. Run npm run deploy:vault.');
  if (!key || addressFromKey(key) !== v.owner) throw new Error('The vault’s owner is not the demo owner key. Freeze it from TronLink.');
  const txid = await vaultSetFrozen(key, frozen);
  logEvent(frozen ? 'VAULT_FROZEN' : 'VAULT_UNFROZEN', { vault: v.address, txid, by: 'server-demo-key' });
  return vaultView();
}

// Records a freeze the owner sent from TronLink, after checking the chain agrees.
export async function noteVaultFreeze(txid: string) {
  const v = await vaultState();
  if (!v) throw new Error('No vault is deployed.');
  const info: any = await tw.trx.getTransactionInfo(txid); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (info?.receipt?.result !== 'SUCCESS') throw new Error('That transaction did not succeed on chain.');
  logEvent(v.frozen ? 'VAULT_FROZEN' : 'VAULT_UNFROZEN', { vault: v.address, txid, by: 'tronlink' });
  return vaultView();
}

// Moves the USDT sitting idle in the payer's GasFree account back into the vault, as one GasFree
// transfer. The destination is fixed to the vault, so this cannot pay anyone else.
export async function returnToVault() {
  const v = vaultInfo();
  if (!v) throw new Error('No vault is deployed. Run npm run deploy:vault.');
  const busy = db.prepare("SELECT id FROM batches WHERE status IN ('RUNNING', 'PAUSED')").get() as { id: number } | undefined;
  if (busy) throw new Error(`Batch #${busy.id} is still being paid or is paused. Finish it first.`);
  const payer = payerAddress();
  const [{ token, provider }, acct] = await Promise.all([gasfreeConfig(), gasfree.account(payer)]);
  const fee = Number(token.transferFee) + (acct.active ? 0 : Number(token.activateFee));
  const balance = await usdtBalance(acct.gasFreeAddress);
  const amount = balance - fee;
  if (amount <= 0) throw new Error('The GasFree account holds no idle USDT beyond the transfer fee.');
  const deadline = nowSec() + (provider.config?.defaultDeadlineDuration ?? 180);
  const permit = await signPermit(
    { token: token.tokenAddress, serviceProvider: provider.address, user: payer, receiver: v.address, value: String(amount), maxFee: String(fee), deadline, nonce: acct.nonce },
    payerKey(),
  );
  const { id } = await gasfree.submit(permit);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const t = await gasfree.status(id).catch(() => null);
    if (t?.state === 'SUCCEED' && t.txnHash) {
      logEvent('VAULT_FUNDED', { vault: v.address, from: acct.gasFreeAddress, amount, fee: t.txnTotalFee ?? fee, txnHash: t.txnHash, traceId: id });
      return vaultView();
    }
    if (t?.state === 'FAILED') throw new Error('GasFree could not complete the transfer to the vault.');
  }
  throw new Error(`The transfer to the vault is still pending (GasFree trace ${id}). Check again shortly.`);
}

type Review = { rows: { line: number; ko: string; en: string; action: 'fix' | 'hold' | 'pay' }[] };

export async function reviewFlags(batchId: number) {
  if (!kilnConfigured()) throw new Error('Kiln is not configured. Set KILN_BASE_URL and KILN_API_KEY in backend/.env.local.');
  const rows = batchRows(batchId);
  const flagged = rows.filter((r) => JSON.parse(r.flags).length);
  if (!flagged.length) return { sent: 0, total: rows.length };
  const book = bookMap();
  const input = flagged.map((r) => {
    const p = book.get(r.receiver);
    return {
      line: r.line, sender: r.sender, recipient: r.name, amountUSDT: r.amount != null ? r.amount / 1e6 : r.amount_raw,
      note: r.note, flags: JSON.parse(r.flags),
      payee: p ? { name: p.name, usualUSDT: p.usual / 1e6 } : null,
    };
  });
  const out = await ask<Review>('review_flags', PROMPTS.review_flags, { rows: input }, { maxTokens: 1500, batchId });
  for (const a of out?.rows ?? []) {
    const r = flagged.find((x) => x.line === a.line);
    if (r) updateRow(r.id, { agent: JSON.stringify({ ko: a.ko, en: a.en, action: a.action }) });
  }
  logEvent('AGENT_REVIEW', { sent: flagged.length, total: rows.length, lines: flagged.map((r) => r.line), model: MODEL }, batchId);
  return { sent: flagged.length, total: rows.length };
}

export async function writeReceipt(batchId: number) {
  if (!kilnConfigured()) throw new Error('Kiln is not configured.');
  const rows = batchRows(batchId);
  const s = summarize(rows);
  const input = {
    batch: batchId, paidCount: s.paid, amountPaidUSDT: s.amountPaid / 1e6, feesUSDT: s.fees / 1e6,
    refused: rows.filter((r) => r.state === 'REFUSED').map((r) => ({ line: r.line, recipient: r.name, reason: r.reason })),
    failed: rows.filter((r) => r.state === 'FAILED').map((r) => ({ line: r.line, reason: r.reason })),
    held: rows.filter((r) => r.decision !== 'pay').map((r) => ({ line: r.line, recipient: r.name, flags: JSON.parse(r.flags) })),
  };
  const out = await ask<{ ko: string; en: string }>('receipt', PROMPTS.receipt, input, { maxTokens: 900, batchId });
  db.prepare('UPDATE batches SET receipt = ? WHERE id = ?').run(JSON.stringify(out), batchId);
  return out;
}

export async function askAuditor(batchId: number, question: string) {
  if (!kilnConfigured()) throw new Error('Kiln is not configured.');
  const batch = getBatch(batchId)!;
  const policy = batch.policy_id ? getPolicy(batch.policy_id) : activePolicy();
  const input = {
    question,
    policy: policy && { id: policy.id, budgetUSDT: policy.budget / 1e6, perPaymentUSDT: policy.per_payment / 1e6, deadline: new Date(policy.deadline * 1000).toISOString(), payees: JSON.parse(policy.payees), status: policy.status },
    rows: batchRows(batchId).map((r) => ({ line: r.line, recipient: r.name, receiver: r.receiver, amountUSDT: (r.amount ?? 0) / 1e6, decision: r.decision, state: r.state, reason: r.reason, flags: JSON.parse(r.flags), txnHash: r.txn_hash })),
    events: batchEvents(batchId).map((e) => ({ id: e.id, ...JSON.parse(e.body) })),
  };
  return ask<{ answer: string }>('audit_qa', PROMPTS.audit_qa, input, { maxTokens: 900, batchId });
}

/* ---------------- read models ---------------- */

const requestIdOf = (r: Row) => (r.permit ? (JSON.parse(r.permit).requestId as string | undefined) ?? null : null);

// Each row to pay gets an unguessable link for the family's receipt page, made the first time it is needed.
function receiptToken(r: Row) {
  if (r.decision !== 'pay') return null;
  if (r.receipt_token) return r.receipt_token;
  const token = randomBytes(12).toString('base64url');
  db.prepare('UPDATE rows SET receipt_token = ? WHERE id = ?').run(token, r.id);
  return token;
}

const parseRow = (r: Row) => ({
  ...r, flags: JSON.parse(r.flags) as string[], agent: r.agent ? JSON.parse(r.agent) : null, permit: undefined,
  request_id: requestIdOf(r), receipt_token: receiptToken(r), travel: r.travel ? JSON.parse(r.travel) : null,
});

export function batchView(batchId: number) {
  const batch = getBatch(batchId);
  if (!batch) throw new Error('Batch not found.');
  const rows = batchRows(batchId);
  return {
    batch: { ...batch, columns: JSON.parse(batch.columns), receipt: batch.receipt ? JSON.parse(batch.receipt) : null, approval: batch.approval ? (JSON.parse(batch.approval) as Approval) : null },
    approvalProblem: batch.status === 'CLOSED' ? null : approvalProblem(batch),
    policy: batch.policy_id ? getPolicy(batch.policy_id) : null,
    rows: rows.map(parseRow),
    summary: summarize(rows),
    events: batchEvents(batchId).map((e) => ({ id: e.id, type: e.type, ts: e.ts_ms, hash: e.hash, data: JSON.parse(e.body).data })),
  };
}

export function evidence(batchId: number) {
  const batch = getBatch(batchId)!;
  const policies = (db.prepare("SELECT * FROM policies WHERE status != 'DRAFT' ORDER BY id").all() as ReturnType<typeof getPolicy>[]).map((p) => ({
    id: p!.id, owner: p!.owner, signedBy: p!.signed_by, signature: p!.signature, status: p!.status,
    payees: JSON.parse(p!.payees), policyHash: p!.policy_hash, recordTx: p!.anchor_tx, recordKey: p!.record_key ?? p!.id,
    domain: policyDomain, types: policyTypesFor(p!), value: policyValue(p!),
  }));
  const rules = screenRules();
  return {
    format: 'ansim-evidence-2',
    network: 'tron-nile',
    token: NILE_USDT,
    exportedAt: new Date().toISOString(),
    registry: registryInfo()?.address ?? null,
    vault: vaultInfo() && { address: vaultInfo()!.address, payout: vaultInfo()!.payout, feePerPayment: vaultInfo()!.feePerPayment },
    batch: { id: batch.id, source: batch.source, policyId: batch.policy_id, status: batch.status, closeHash: batch.close_hash, sealTx: batch.anchor_tx, recordKey: batch.record_key ?? batch.id },
    rules: { travelRuleMin: rules.travelMin, travelRuleKrw: rules.travelKrw, krwPerUsdt: rules.krwPerUsdt, contactWaitHours: rules.waitSec / 3600 },
    policies,
    rows: batchRows(batchId).map((r) => ({
      line: r.line, sender: r.sender, recipient: r.name, receiver: r.receiver, amount: r.amount, note: r.note,
      flags: JSON.parse(r.flags), decision: r.decision, state: r.state, reason: r.reason,
      nonce: r.nonce, maxFee: r.max_fee, requestId: requestIdOf(r), traceId: r.trace_id, txnHash: r.txn_hash, fee: r.fee,
      travel: r.travel ? JSON.parse(r.travel) : null, // Travel Rule details: in this file for the auditor, never on chain
    })),
    events: allEvents().map((e) => ({ id: e.id, body: e.body, prev: e.prev, hash: e.hash })),
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportCsv(batchId: number) {
  const head = ['line', 'sender', 'recipient', 'wallet', 'amount_usdt', 'note', 'decision', 'status', 'reason', 'request_id', 'trace_id', 'txn_hash', 'fee_usdt', 'flags', 'receipt_link'];
  const lines = batchRows(batchId).map((r) =>
    [r.line, r.sender, r.name, r.receiver, r.amount != null ? (r.amount / 1e6).toFixed(6) : r.amount_raw, r.note, r.decision, r.state, r.reason, requestIdOf(r), r.trace_id, r.txn_hash, r.fee != null ? (r.fee / 1e6).toFixed(6) : '', JSON.parse(r.flags).join(' '), r.decision === 'pay' ? `/r/${receiptToken(r)}` : '']
      .map(csvCell)
      .join(','),
  );
  return '﻿' + [head.join(','), ...lines].join('\n');
}

/* ---------------- family receipts & disputes ---------------- */

// The family's receipt page. Public, but only reachable through the row's unguessable token.
export function familyReceipt(token: string) {
  const r = db.prepare('SELECT * FROM rows WHERE receipt_token = ?').get(token) as Row | undefined;
  if (!r || r.decision !== 'pay') throw new Error('Receipt not found.');
  const paid = db
    .prepare(`SELECT ts_ms FROM events WHERE row_id = ? AND (type = 'ROW_RECOVERED' OR (type = 'ROW_STATE' AND body LIKE '%"state":"SUCCEED"%')) ORDER BY id DESC LIMIT 1`)
    .get(r.id) as { ts_ms: number } | undefined;
  const status = r.state === 'SUCCEED' ? 'paid' : r.state === 'REFUSED' || r.state === 'FAILED' ? 'not_sent' : 'on_the_way';
  return {
    status, sender: r.sender, name: r.name, amount: r.amount, note: r.note, wallet: r.receiver,
    country: payeeBook().find((p) => p.address === r.receiver)?.country ?? null,
    txnHash: status === 'paid' ? r.txn_hash : null, paidAt: paid?.ts_ms ?? null,
  };
}

const rowEvents = (rowId: number) =>
  (db.prepare('SELECT id, ts_ms, type, body FROM events WHERE row_id = ? ORDER BY id').all(rowId) as { id: number; ts_ms: number; type: string; body: string }[])
    .map((e) => ({ id: e.id, ts: e.ts_ms, type: e.type, data: JSON.parse(e.body).data }));

// "My family did not get the money": find the payments by sender, recipient, note, wallet or transaction hash.
export function findPayments(q: string) {
  const s = q.trim();
  if (s.length < 2) throw new Error('Type at least two characters.');
  const like = `%${s}%`;
  const rows = db
    .prepare(
      `SELECT r.*, b.created_at AS batch_created FROM rows r JOIN batches b ON b.id = r.batch_id
       WHERE r.sender LIKE ? OR r.name LIKE ? OR r.note LIKE ? OR r.receiver = ? OR r.txn_hash = ?
       ORDER BY r.id DESC LIMIT 20`,
    )
    .all(like, like, like, s, s) as (Row & { batch_created: number })[];
  return rows.map((r) => ({
    id: r.id, batchId: r.batch_id, batchCreated: r.batch_created, line: r.line, sender: r.sender, name: r.name, receiver: r.receiver,
    amount: r.amount, note: r.note, flags: JSON.parse(r.flags) as string[], decision: r.decision, state: r.state, reason: r.reason,
    txnHash: r.txn_hash, fee: r.fee, receiptToken: r.receipt_token, events: rowEvents(r.id),
  }));
}

export async function askDispute(q: string, question: string) {
  if (!kilnConfigured()) throw new Error('Kiln is not configured. Set KILN_BASE_URL and KILN_API_KEY.');
  const payments = findPayments(q);
  const chain = await Promise.all(
    payments.filter((p) => p.txnHash).slice(0, 5).map(async (p) => ({ txnHash: p.txnHash, chain: await usdtTransferProof(p.txnHash!).catch(() => null) })),
  );
  const input = {
    question,
    payments: payments.map((p) => ({ ...p, receiptToken: undefined, amountUSDT: (p.amount ?? 0) / 1e6, feeUSDT: p.fee != null ? p.fee / 1e6 : null })),
    chain,
  };
  return ask<{ ko: string; en: string }>('dispute', PROMPTS.dispute, input, { maxTokens: 900 });
}

// Energy upper bound per output token: 2 RNGD cards × 180 W × 5.8 ms (FuriosaAI's published figures).
export const JOULES_PER_OUTPUT_TOKEN = 2 * 180 * 0.0058;

export function metrics() {
  const flows = db
    .prepare('SELECT flow, COUNT(*) AS calls, SUM(prompt) AS prompt, SUM(completion) AS completion, SUM(total) AS total, ROUND(AVG(ms)) AS avg_ms FROM tokens GROUP BY flow ORDER BY flow')
    .all() as { flow: string; calls: number; prompt: number; completion: number; total: number; avg_ms: number }[];
  const reviews = (db.prepare("SELECT body FROM events WHERE type = 'AGENT_REVIEW'").all() as { body: string }[]).map((e) => JSON.parse(e.body).data);
  const sent = reviews.reduce((s, r) => s + r.sent, 0);
  const total = reviews.reduce((s, r) => s + r.total, 0);
  let provider: string | null = null;
  try {
    provider = process.env.KILN_BASE_URL ? new URL(process.env.KILN_BASE_URL).host : null;
  } catch {
    provider = null;
  }
  return {
    model: MODEL,
    provider,
    flows: flows.map((f) => ({ ...f, joules: Math.round((f.completion ?? 0) * JOULES_PER_OUTPUT_TOKEN) })),
    rowsReviewed: { sent, total, skippedShare: total ? 1 - sent / total : null },
    joulesPerOutputToken: JOULES_PER_OUTPUT_TOKEN,
  };
}

export function status() {
  const rules = screenRules();
  let payer: string | null = null;
  try {
    payer = payerAddress();
  } catch {
    payer = null;
  }
  return {
    gasfree: !!(process.env.GASFREE_API_KEY && process.env.GASFREE_API_SECRET),
    kiln: kilnConfigured(),
    payer,
    ownerFallback: !!process.env.OWNER_PRIVATE_KEY,
    notary: !!process.env.NOTARY_PRIVATE_KEY,
    registry: registryInfo()?.address ?? null,
    simulateLostLine: process.env.SIMULATE_LOST_RESPONSE_LINE ? Number(process.env.SIMULATE_LOST_RESPONSE_LINE) : null,
    telegram: telegramConfigured(),
    rules: { contactWaitHours: rules.waitSec / 3600, travelRuleMin: rules.travelMin, travelRuleKrw: rules.travelKrw, krwPerUsdt: rules.krwPerUsdt },
    payees: payeeBook().map((p) => ({ ...p, month: payeeMonth(p.address) })),
  };
}
