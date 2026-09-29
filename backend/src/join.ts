// Live demo: people in the room join as families from their phones. Each phone makes its own TRON wallet and
// keeps the key. The operator accepts them as contacts, and they are paid like any other family: inside the
// owner's signed limits, after the owner's approval, from the vault. Payments go to the joiner's GasFree
// account, so the phone can send USDT back with GasFree while the wallet holds no TRX.
import { randomBytes, randomUUID } from 'node:crypto';
import { db, nowSec, type Row } from './db';
import { logEvent } from './log';
import { validAddress, contactProblem } from './screen';
import { gasfree, gasfreeConfig, permitDomain, permitTypes } from './gasfree';
import { tw, usdtBalance, vaultInfo, isTetherFrozen } from './tron';
import { addContact, payeeBook, screenRules, receiptToken, paidAtMs, walletCheck, reported, type Risk } from './desk';

type Join = {
  token: string; address: string; wallet: string; name: string; country: string; city: string | null;
  status: 'pending' | 'accepted' | 'rejected'; sent_back: string | null; created_at: number;
  mode: 'own' | 'phone' | null; // their own wallet, or one the phone page made
  risk: string | null; // the wallet check of their own address, made when they join
};
type SentBack = { traceId: string; state: string; value: number; txnHash: string | null; at: number; checkedAt: number };

const COUNTRIES = ['Vietnam', 'Philippines', 'Nepal'];
// ponytail: a fixed cap on pending joins keeps a public page from flooding the operator's list; per-person limits if it goes public for real
const MAX_PENDING = 30;
const FINAL = new Set(['SUCCEED', 'FAILED']);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function getJoin(token: string) {
  const j = db.prepare('SELECT * FROM joins WHERE token = ?').get(token) as Join | undefined;
  if (!j) throw new Error('This join link is not known.');
  return j;
}

// A person joins with their own TRON wallet, or one the phone page made. Ansim pays their GasFree account,
// which GasFree derives from that wallet: only the wallet's key can move money out of it, and GasFree takes its
// fee in USDT, so they never need TRX. Blocking checks run now, so a bad wallet is turned away at the door.
export async function requestJoin(input: { address?: unknown; name?: unknown; country?: unknown; city?: unknown; mode?: unknown }) {
  const address = String(input.address ?? '').trim();
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const country = COUNTRIES.find((c) => c === input.country);
  const city = String(input.city ?? '').trim().slice(0, 60) || null;
  const mode = input.mode === 'own' ? 'own' : 'phone';
  if (!validAddress(address)) throw new Error('That is not a valid TRON address. It starts with T and has 34 characters.');
  if (!name) throw new Error('Enter a name.');
  if (!country) throw new Error('Pick Vietnam, the Philippines or Nepal.');
  if (db.prepare('SELECT 1 FROM joins WHERE address = ?').get(address)) throw new Error('This wallet has already joined.');
  const pending = (db.prepare("SELECT COUNT(*) AS n FROM joins WHERE status = 'pending'").get() as { n: number }).n;
  if (pending >= MAX_PENDING) throw new Error('Too many people are waiting to be accepted. Try again in a minute.');
  const { gasFreeAddress } = await gasfree.account(address);
  const bad = reported();
  const blocked =
    (bad.has(address) ? 'This wallet is on the reported scam list.' : null) ??
    contactProblem(gasFreeAddress, payeeBook(), bad) ??
    ((await isTetherFrozen(address)) === true ? 'Tether has frozen this wallet on mainnet.' : null);
  if (blocked) {
    logEvent('JOIN_BLOCKED', { name, country, mode, address, reason: blocked });
    throw new Error(`Ansim can’t add this wallet: ${blocked}`);
  }
  const token = randomBytes(12).toString('base64url');
  db.prepare('INSERT INTO joins (token, address, wallet, name, country, city, mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(token, address, gasFreeAddress, name, country, city, mode, nowSec());
  logEvent('JOIN_REQUESTED', { name, country, city, mode, address, wallet: gasFreeAddress });
  // The wallet's public history on mainnet, with the AI's plain-words explanation. Code sets the flags; the operator decides.
  void walletCheck(address).then((risk) => {
    db.prepare('UPDATE joins SET risk = ? WHERE token = ?').run(JSON.stringify(risk), token);
    logEvent('JOIN_CHECKED', { name, address, level: risk.level ?? null, flags: risk.flags ?? [], error: risk.error ?? null });
  });
  return { token };
}

// GasFree's status for the phone's transfer back, asked again at most every 3 seconds while it is not final.
// Asking on read, not in a background loop, means a restart loses nothing.
async function sentBackOf(j: Join): Promise<SentBack | null> {
  const sb = j.sent_back ? (JSON.parse(j.sent_back) as SentBack) : null;
  if (!sb || FINAL.has(sb.state) || Date.now() - sb.checkedAt < 3000) return sb;
  const s = await gasfree.status(sb.traceId).catch(() => null);
  const next = { ...sb, checkedAt: Date.now(), state: s?.state ?? sb.state, txnHash: s?.txnHash ?? sb.txnHash };
  db.prepare('UPDATE joins SET sent_back = ? WHERE token = ?').run(JSON.stringify(next), j.token);
  if (next.state === 'SUCCEED' && sb.state !== 'SUCCEED') logEvent('JOIN_SENT_BACK', { name: j.name, wallet: j.wallet, value: next.value, txnHash: next.txnHash });
  return next;
}

// USDT in the joiner's GasFree account, cached briefly: every phone and the stage screen poll.
const balances = new Map<string, { at: number; value: number }>();
async function balanceOf(wallet: string) {
  const c = balances.get(wallet);
  if (c && Date.now() - c.at < 4000) return c.value;
  const value = await usdtBalance(wallet);
  balances.set(wallet, { at: Date.now(), value });
  return value;
}

// Local currency for the family's screen. USDT is taken at one US dollar. The rate is fetched once an hour,
// with fixed rates if the rate service is down.
const CURRENCY: Record<string, string> = { Vietnam: 'VND', Philippines: 'PHP', Nepal: 'NPR' };
const FIXED: Record<string, number> = { VND: 26_300, PHP: 57.5, NPR: 136 };
let fx: { at: number; rates: Record<string, number>; live: boolean } | null = null;
async function fxFor(country: string) {
  if (!fx || Date.now() - fx.at > 3_600_000) {
    const j = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(4000) }).then((r) => r.json()).catch(() => null);
    // A failed fetch keeps the fixed rates for 5 minutes before trying again.
    fx = j?.result === 'success' ? { at: Date.now(), rates: j.rates, live: true } : { at: Date.now() - 3_300_000, rates: FIXED, live: false };
  }
  const currency = CURRENCY[country];
  return currency ? { currency, perUsdt: fx.rates[currency] ?? FIXED[currency], live: fx.live } : null;
}

const riskOf = (j: Join) => {
  const r = j.risk ? (JSON.parse(j.risk) as Risk) : null;
  return r && { level: r.level ?? null, flags: r.flags ?? [], note: r.note ?? null, error: r.error ?? null };
};

async function view(j: Join, withBalance: boolean) {
  const contact = payeeBook().find((p) => p.address === j.wallet);
  // A row still in a draft (READY) has not been sent, so the latest sent or refused one is the payment.
  const row = db.prepare("SELECT * FROM rows WHERE receiver = ? AND decision = 'pay' AND state != 'READY' ORDER BY id DESC LIMIT 1").get(j.wallet) as Row | undefined;
  const sentBack = await sentBackOf(j);
  return {
    token: j.token, status: j.status, name: j.name, country: j.country, city: j.city, address: j.address, wallet: j.wallet, joinedAt: j.created_at,
    mode: j.mode ?? 'phone', risk: riskOf(j),
    // New contacts wait before they can be paid (the delayed-transfer rule); seeded contacts have created_at 0.
    payableAt: contact?.created_at ? contact.created_at + screenRules().waitSec : null,
    payment: row ? { state: row.state, amount: row.amount, reason: row.reason, txnHash: row.txn_hash, receiptToken: receiptToken(row), paidAt: row.state === 'SUCCEED' ? paidAtMs(row.id) : null, confirmed: !!row.ack } : null,
    sentBack,
    balance: withBalance && j.status === 'accepted' ? await balanceOf(j.wallet).catch(() => null) : null,
  };
}

export async function joinStatus(token: string) {
  const j = getJoin(token);
  return { ...(await view(j, true)), fx: await fxFor(j.country) };
}

/* The operator's side: accept or reject, and watch everyone on the stage screen. */

export async function listJoins() {
  const all = db.prepare("SELECT * FROM joins WHERE status != 'rejected' ORDER BY created_at").all() as Join[];
  return Promise.all(all.map((j) => view(j, false)));
}

// Accepting adds the phone's GasFree account as a contact, through the same checks as any new contact:
// valid address, not a lookalike, not reported, not frozen by Tether, and the wallet-history risk check.
export async function acceptJoin(token: string) {
  const j = getJoin(token);
  if (j.status !== 'pending') throw new Error(`${j.name} is already ${j.status}.`);
  // The risk is their own wallet's history; the GasFree account paid is new and has none of its own.
  const risk = j.risk ? (JSON.parse(j.risk) as Risk) : await walletCheck(j.address);
  await addContact({ name: j.name, country: j.country, city: j.city ?? undefined, address: j.wallet, usual: 0, risk });
  db.prepare("UPDATE joins SET status = 'accepted' WHERE token = ?").run(token);
  logEvent('JOIN_ACCEPTED', { name: j.name, wallet: j.wallet });
  return listJoins();
}

export async function rejectJoin(token: string) {
  const j = getJoin(token);
  if (j.status === 'accepted') throw new Error(`${j.name} is already a contact. Remove them from the contacts instead.`);
  db.prepare("UPDATE joins SET status = 'rejected' WHERE token = ?").run(token);
  logEvent('JOIN_REJECTED', { name: j.name, wallet: j.wallet });
  return listJoins();
}

/* The phone sends its USDT back to the operator's vault. The phone signs; Ansim only relays. */

export async function sendBackDraft(token: string) {
  const j = getJoin(token);
  if (j.status !== 'accepted') throw new Error('The operator has not accepted this phone yet.');
  const vault = vaultInfo();
  if (!vault) throw new Error('There is no vault to send it back to.');
  const sb = await sentBackOf(j);
  if (sb && !FINAL.has(sb.state)) throw new Error('A transfer back is already on its way.');
  const [{ token: usdt, provider }, acct] = await Promise.all([gasfreeConfig(), gasfree.account(j.address)]);
  balances.delete(j.wallet);
  const balance = await balanceOf(j.wallet);
  const transferFee = Number(usdt.transferFee), activation = acct.active ? 0 : Number(usdt.activateFee);
  const value = balance - transferFee - activation;
  if (value <= 0) throw new Error(`This wallet holds ${(balance / 1e6).toFixed(2)} USDT, not enough for GasFree’s ${((transferFee + activation) / 1e6).toFixed(2)} USDT fee.`);
  const cfg = provider.config ?? ({} as Partial<typeof provider.config>);
  const deadline = nowSec() + clamp(cfg.defaultDeadlineDuration ?? 180, cfg.minDeadlineDuration ?? 60, cfg.maxDeadlineDuration ?? 600);
  return {
    domain: permitDomain, types: permitTypes,
    message: { token: usdt.tokenAddress, serviceProvider: provider.address, user: j.address, receiver: vault.address, value: String(value), maxFee: String(transferFee + activation), deadline, version: 1, nonce: acct.nonce },
    fee: { transfer: transferFee, activation },
  };
}

export async function sendBack(token: string, input: { message?: Record<string, unknown>; sig?: unknown }) {
  const j = getJoin(token);
  const m = input.message ?? {};
  const sig = String(input.sig ?? '').replace(/^0x/, '');
  const vault = vaultInfo();
  if (!/^[0-9a-f]{130}$/i.test(sig)) throw new Error('The phone’s signature is missing.');
  // Only one transfer is ever relayed: from this phone's own GasFree account to the operator's vault.
  if (j.status !== 'accepted' || !vault || m.user !== j.address || m.receiver !== vault.address) throw new Error('Ansim only relays a transfer from this phone back to the operator’s vault.');
  const sb = await sentBackOf(j);
  if (sb && !FINAL.has(sb.state)) throw new Error('A transfer back is already on its way.');
  const { token: usdt } = await gasfreeConfig();
  const message = {
    token: String(m.token), serviceProvider: String(m.serviceProvider), user: j.address, receiver: vault.address,
    value: String(m.value), maxFee: String(m.maxFee), deadline: Number(m.deadline), version: 1, nonce: Number(m.nonce),
  };
  if (message.token !== usdt.tokenAddress || !(Number(message.value) > 0)) throw new Error('Only USDT can be sent back.');
  let ok = false;
  try {
    ok = await tw.trx.verifyTypedData(permitDomain, permitTypes, message, '0x' + sig, j.address);
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('The phone’s signature does not match this transfer.');
  const r = await gasfree.submit({ requestId: randomUUID(), ...message, sig });
  const next: SentBack = { traceId: r.id, state: r.state ?? 'WAITING', value: Number(message.value), txnHash: r.txnHash ?? null, at: nowSec(), checkedAt: Date.now() };
  db.prepare('UPDATE joins SET sent_back = ? WHERE token = ?').run(JSON.stringify(next), token);
  logEvent('JOIN_SEND_BACK_SUBMITTED', { name: j.name, wallet: j.wallet, value: next.value, traceId: r.id, nonce: message.nonce });
  balances.delete(j.wallet);
  return joinStatus(token);
}
