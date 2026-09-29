import fs from 'node:fs';
import { randomInt } from 'node:crypto';
import { db, getBatch, getPolicy, getRow, batchRows, updateRow, activePolicy, nowSec, type Row } from './db';
import { logEvent, allEvents, batchEvents } from './log';
import { policyDomain, policyTypes, policyValue, policyHash, payeesHash } from './policy';
import { parseSheet, headerSignature, ruleMapping, validMapping, toRows, type Mapping } from './importer';
import { screen, BLOCKING, type Payee, type ScreenRow } from './screen';
import { ask, kilnConfigured, PROMPTS, MODEL } from './agent';
import { tw, isTetherFrozen, recordPolicy, recordStop, registryInfo, addressFromKey, NILE_USDT } from './tron';
import { payerAddress, summarize, msg } from './orchestrator';

const dataFile = (name: string) => new URL(`../data/${name}`, import.meta.url);
const readJson = <T>(name: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')) as T;
  } catch {
    return fallback;
  }
};

// The payee book: wallets this business has paid before, with the usual amount in USDT.
export const payeeBook = () => readJson<{ address: string; name: string; usual: number }[]>('payees.json', []);
const bookMap = () => new Map<string, Payee>(payeeBook().map((p) => [p.address, { ...p, usual: Math.round(p.usual * 1e6) }]));
// Stand-in for wallets reported to police and exchanges.
const reported = () => new Set(readJson<string[]>('reported.json', []));

/* ---------------- policy ---------------- */

export function draftPolicy(input: { budget: number; perPayment: number; deadline: number; payees: string[] }) {
  if (!(input.budget > 0) || !(input.perPayment > 0)) throw new Error('Budget and per-payment cap must be above zero.');
  if (!(input.deadline > nowSec())) throw new Error('The deadline must be in the future.');
  if (!input.payees.length) throw new Error('Allow at least one payee.');
  const payees = [...new Set(input.payees)].sort();
  const r = db
    .prepare(
      `INSERT INTO policies (payer, budget, per_payment, payees, payees_hash, deadline, policy_nonce, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
    )
    .run(payerAddress(), Math.round(input.budget * 1e6), Math.round(input.perPayment * 1e6), JSON.stringify(payees), payeesHash(payees), Math.floor(input.deadline), randomInt(1, 2 ** 31), nowSec());
  const p = getPolicy(Number(r.lastInsertRowid))!;
  return { id: p.id, domain: policyDomain, types: policyTypes, value: policyValue(p) };
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
    signature = await tw.trx.signTypedData(policyDomain, policyTypes, value, key);
    owner = addressFromKey(key);
    signedBy = 'server-demo-key';
  }
  if (!signature || !owner) throw new Error('A signature and the owner address are required.');
  let ok = false;
  try {
    ok = await tw.trx.verifyTypedData(policyDomain, policyTypes, value, signature, owner);
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('The signature does not match the policy and owner address.');
  const hash = policyHash(p, signature);
  db.prepare("UPDATE policies SET status = 'REPLACED' WHERE status IN ('ACTIVE', 'STOPPED')").run();
  db.prepare("UPDATE policies SET status = 'ACTIVE', owner = ?, signature = ?, signed_by = ?, policy_hash = ? WHERE id = ?").run(owner, signature, signedBy, hash, p.id);
  logEvent('POLICY_ACTIVATED', { policyId: p.id, policyHash: hash, owner, signedBy, payer: p.payer, budget: p.budget, perPayment: p.per_payment, deadline: p.deadline, payeesHash: p.payees_hash });
  try {
    const txid = await recordPolicy({ id: p.id, hash, payer: p.payer, owner, budget: p.budget, perPayment: p.per_payment, deadline: p.deadline });
    if (txid) {
      db.prepare('UPDATE policies SET anchor_tx = ? WHERE id = ?').run(txid, p.id);
      logEvent('POLICY_RECORDED', { policyId: p.id, txid });
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
  recordStop(p.id)
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
  const list: (ScreenRow & { id: number })[] = rows.map((r) => ({ id: r.id, line: r.line, sender: r.sender ?? '', receiver: r.receiver, amount: r.amount, note: r.note ?? '', flags: [] }));
  const result = await screen(list, bookMap(), reported(), isTetherFrozen);
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

export async function editRow(rowId: number, patch: { receiver?: string; amount?: string; decision?: 'pay' | 'hold' | 'remove' }) {
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
  if (patch.decision) {
    const flags: string[] = JSON.parse(getRow(rowId).flags);
    const blocking = flags.filter((f) => BLOCKING.has(f));
    if (patch.decision === 'pay' && blocking.length) throw new Error(`This row cannot be paid: ${blocking.join(', ')}.`);
    updateRow(rowId, { decision: patch.decision });
  }
  const after = getRow(rowId);
  logEvent('ROW_EDITED', { line: row.line, before, after: { receiver: after.receiver, amount: after.amount, decision: after.decision }, flags: JSON.parse(after.flags) }, row.batch_id, rowId);
  return after;
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

const parseRow = (r: Row) => ({ ...r, flags: JSON.parse(r.flags) as string[], agent: r.agent ? JSON.parse(r.agent) : null, permit: undefined });

export function batchView(batchId: number) {
  const batch = getBatch(batchId);
  if (!batch) throw new Error('Batch not found.');
  const rows = batchRows(batchId);
  return {
    batch: { ...batch, columns: JSON.parse(batch.columns), receipt: batch.receipt ? JSON.parse(batch.receipt) : null },
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
    payees: JSON.parse(p!.payees), policyHash: p!.policy_hash, recordTx: p!.anchor_tx,
    domain: policyDomain, types: policyTypes, value: policyValue(p!),
  }));
  return {
    format: 'ansim-evidence-1',
    network: 'tron-nile',
    token: NILE_USDT,
    exportedAt: new Date().toISOString(),
    registry: registryInfo()?.address ?? null,
    batch: { id: batch.id, source: batch.source, policyId: batch.policy_id, status: batch.status, closeHash: batch.close_hash, sealTx: batch.anchor_tx },
    policies,
    rows: batchRows(batchId).map((r) => ({
      line: r.line, sender: r.sender, recipient: r.name, receiver: r.receiver, amount: r.amount, note: r.note,
      flags: JSON.parse(r.flags), decision: r.decision, state: r.state, reason: r.reason,
      nonce: r.nonce, maxFee: r.max_fee, traceId: r.trace_id, txnHash: r.txn_hash, fee: r.fee,
    })),
    events: allEvents().map((e) => ({ id: e.id, body: e.body, prev: e.prev, hash: e.hash })),
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportCsv(batchId: number) {
  const head = ['line', 'sender', 'recipient', 'wallet', 'amount_usdt', 'note', 'decision', 'status', 'reason', 'request_id', 'txn_hash', 'fee_usdt', 'flags'];
  const lines = batchRows(batchId).map((r) =>
    [r.line, r.sender, r.name, r.receiver, r.amount != null ? (r.amount / 1e6).toFixed(6) : r.amount_raw, r.note, r.decision, r.state, r.reason, r.trace_id, r.txn_hash, r.fee != null ? (r.fee / 1e6).toFixed(6) : '', JSON.parse(r.flags).join(' ')]
      .map(csvCell)
      .join(','),
  );
  return '﻿' + [head.join(','), ...lines].join('\n');
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
  return {
    model: MODEL,
    flows: flows.map((f) => ({ ...f, joules: Math.round((f.completion ?? 0) * JOULES_PER_OUTPUT_TOKEN) })),
    rowsReviewed: { sent, total, skippedShare: total ? 1 - sent / total : null },
    joulesPerOutputToken: JOULES_PER_OUTPUT_TOKEN,
  };
}

export function status() {
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
    payees: payeeBook(),
  };
}
