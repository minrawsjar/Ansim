import fs from 'node:fs';
import { TronWeb, utils } from 'tronweb';

export const NILE_HOST = process.env.TRON_FULLHOST ?? 'https://nile.trongrid.io';
export const NILE_CHAIN_ID = 3448148188; // 0xcd8690dc
export const NILE_USDT = process.env.USDT_TOKEN ?? 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
export const MAINNET_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ZERO = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'; // any valid address works as the caller of read-only calls

export const tw = new TronWeb({ fullHost: NILE_HOST });
tw.setAddress(ZERO);
// A free TronGrid API key avoids rate limits on the mainnet freeze-list reads.
const gridKey = process.env.TRONGRID_API_KEY;
const mainnet = new TronWeb({ fullHost: 'https://api.trongrid.io', ...(gridKey ? { headers: { 'TRON-PRO-API-KEY': gridKey } } : {}) });
mainnet.setAddress(ZERO);

export const addressFromKey = (key: string) => {
  const a = tw.address.fromPrivateKey(key);
  if (!a) throw new Error('Invalid private key');
  return a;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let usdtMain: Promise<any> | undefined;
let usdtNile: Promise<any> | undefined;
const frozen = new Map<string, boolean>();

// Tether's freeze list lives on the mainnet USDT contract. Returns null when the check could not run.
export async function isTetherFrozen(address: string): Promise<boolean | null> {
  if (frozen.has(address)) return frozen.get(address)!;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      usdtMain ??= mainnet.contract().at(MAINNET_USDT).catch((e: unknown) => {
        usdtMain = undefined;
        throw e;
      });
      const v = Boolean(await (await usdtMain).isBlackListed(address).call());
      frozen.set(address, v);
      return v;
    } catch {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return null;
}

export async function usdtBalance(address: string): Promise<number> {
  usdtNile ??= tw.contract().at(NILE_USDT);
  return Number(await (await usdtNile).balanceOf(address).call());
}

// The AnsimRegistry contract (see /contracts) is the public record: policy grants, stops and
// batch seals. It never moves money. Calls return the transaction id, or null when the contract
// is not deployed or no notary key is set.
const DEPLOYMENT = new URL('../../contracts/deployments/nile.json', import.meta.url);
export function registryInfo(): { address: string; abi: any[] } | null {
  try {
    return JSON.parse(fs.readFileSync(DEPLOYMENT, 'utf8'));
  } catch {
    return null;
  }
}

let registry: any;
function registryContract() {
  const info = registryInfo();
  const key = process.env.NOTARY_PRIVATE_KEY;
  if (!info || !key) return null;
  registry ??= new TronWeb({ fullHost: NILE_HOST, privateKey: key }).contract(info.abi, info.address);
  return registry;
}

const FEE_LIMIT = 100_000_000; // 100 TRX cap per registry call
const b32 = (hex: string) => '0x' + hex.replace(/^0x/, '');

const REGISTRY_ERRORS: Record<string, string> = Object.fromEntries(
  [
    ['NotNotary()', 'Only the notary key can write to the registry.'],
    ['AlreadyRecorded()', 'The registry already has a record under this number.'],
    ['UnknownPolicy()', 'The registry has no policy under this number.'],
  ].map(([sig, text]) => [utils.ethersUtils.id(sig).slice(2, 10), text]),
);

// `id` is the registry key (see recordKey in db.ts). Each call waits until the record is on chain.
export async function recordPolicy(p: { id: number; hash: string; payer: string; owner: string; budget: number; perPayment: number; deadline: number }) {
  const c = registryContract();
  if (!c) return null;
  const txid = (await c.grantPolicy(p.id, b32(p.hash), p.payer, p.owner, p.budget, p.perPayment, p.deadline).send({ feeLimit: FEE_LIMIT })) as string;
  return confirm(txid, REGISTRY_ERRORS, 'registry');
}

export async function recordStop(policyId: number) {
  const c = registryContract();
  if (!c) return null;
  return confirm((await c.stopPolicy(policyId).send({ feeLimit: FEE_LIMIT })) as string, REGISTRY_ERRORS, 'registry');
}

export async function recordBatchSeal(s: { batchId: number; policyId: number; logHash: string; paid: number; refused: number; amountPaid: number; fees: number }) {
  const c = registryContract();
  if (!c) return null;
  const txid = (await c.sealBatch(s.batchId, s.policyId, b32(s.logHash), s.paid, s.refused, s.amountPaid, s.fees).send({ feeLimit: FEE_LIMIT })) as string;
  return confirm(txid, REGISTRY_ERRORS, 'registry');
}

// Finds a USDT transfer from `from` to `to` for exactly `value`, newest first. Used when a payment
// went through but its response was lost.
export async function findUsdtTransfer(from: string, to: string, value: number, sinceMs: number): Promise<string | null> {
  const url = `${NILE_HOST}/v1/accounts/${from}/transactions/trc20?only_from=true&limit=50&min_timestamp=${sinceMs}&contract_address=${NILE_USDT}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j: any = await res.json();
  const hit = (j.data ?? []).find((t: any) => t.to === to && String(t.value) === String(value));
  return hit?.transaction_id ?? null;
}

/* ---------------- wallet history (mainnet) ---------------- */

// Real families' wallets have their history on mainnet, so the risk check reads mainnet even in the Nile demo.
// Public TronGrid rate-limits shared server IPs (HTTP 429), so back off and try again a few times.
async function grid(path: string, body?: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.trongrid.io${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(gridKey ? { 'TRON-PRO-API-KEY': gridKey } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return res.json();
    if (res.status !== 429 || attempt >= 3) throw new Error(`TronGrid answered ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
  }
}

export async function walletFacts(address: string) {
  const since = Date.now() - 7 * 86_400_000;
  const [acct, code, incoming] = await Promise.all([
    grid(`/v1/accounts/${address}`),
    grid('/wallet/getcontract', { value: address, visible: true }),
    grid(`/v1/accounts/${address}/transactions/trc20?only_to=true&limit=200&contract_address=${MAINNET_USDT}&min_timestamp=${since}`),
  ]);
  const a = acct.data?.[0];
  const transfers: { from: string; value: string }[] = incoming.data ?? [];
  const senders = [...new Set(transfers.map((t) => t.from))];
  // Up to five senders, one at a time: public TronGrid rate-limits bursts.
  const frozenSenders: string[] = [];
  for (const s of senders.slice(0, 5)) if ((await isTetherFrozen(s)) === true) frozenSenders.push(s);
  return {
    used: !!a,
    createdAt: (a?.create_time as number | undefined) ?? null,
    isContract: !!code?.bytecode,
    trx: a ? (a.balance ?? 0) / 1e6 : 0,
    usdtIn7d: { transfers: transfers.length, senders: senders.length, total: transfers.reduce((s, t) => s + Number(t.value), 0) },
    frozenSenders,
  };
}

/* ---------------- AnsimVault ---------------- */

// The vault holds the operator's USDT and releases one approved batch at a time to the payer's
// GasFree account. See contracts/src/AnsimVault.sol. Absent until npm run deploy:vault has run.
type VaultInfo = { address: string; abi: any[]; owner: string; agent: string; payout: string; feePerPayment: number };
const VAULT_DEPLOYMENT = new URL('../../contracts/deployments/nile-vault.json', import.meta.url);
export function vaultInfo(): VaultInfo | null {
  try {
    return JSON.parse(fs.readFileSync(VAULT_DEPLOYMENT, 'utf8'));
  } catch {
    return null;
  }
}
const vaultRead = () => tw.contract(vaultInfo()!.abi, vaultInfo()!.address);

export async function vaultState() {
  const v = vaultInfo();
  if (!v) return null;
  const c = vaultRead();
  const [owner, frozen, balance, payoutBalance] = await Promise.all([c.owner().call(), c.frozen().call(), usdtBalance(v.address), usdtBalance(v.payout)]);
  return { address: v.address, owner: tw.address.fromHex(owner), frozen: Boolean(frozen), balance, payout: v.payout, payoutBalance, feePerPayment: v.feePerPayment, agent: v.agent };
}

type ApprovalValue = { batchId: string; policyId: string; rowsHash: string; count: string; total: string };
// What the vault released for this signed approval (0 if nothing yet). Releases are keyed by the approval's digest.
export async function vaultReleased(a: ApprovalValue) {
  const c = vaultRead();
  const digest = await c.approvalDigest(a.batchId, a.policyId, a.rowsHash, a.count, a.total).call();
  return Number(await c.released(digest).call());
}

// The vault's custom errors, by selector, so a revert reads as a sentence.
const VAULT_ERRORS: Record<string, string> = Object.fromEntries(
  [
    ['NotAgent()', 'Only Ansim’s agent key can ask the vault for money.'],
    ['NotOwner()', 'Only the vault’s owner can do that.'],
    ['VaultFrozen()', 'The owner has frozen the vault.'],
    ['AlreadyReleased()', 'The vault already released this batch.'],
    ['BadSignature()', 'The vault did not accept the owner’s signature for this batch.'],
    ['TransferFailed()', 'The vault could not send the USDT. It may hold too little.'],
  ].map(([sig, text]) => [utils.ethersUtils.id(sig).slice(2, 10), text]),
);

// Waits for a contract call to land in a block. Throws with the contract's own reason if it reverted.
// Reads the full node, which answers within a block; the solidified node takes about a minute.
async function confirm(txid: string, errors: Record<string, string>, what: string) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const info: any = await tw.trx.getUnconfirmedTransactionInfo(txid).catch(() => null); // rate limits: keep polling
    if (!info?.receipt) continue;
    if (info.receipt.result === 'SUCCESS') return txid;
    const data = String(info.contractResult?.[0] ?? '');
    throw new Error(errors[data.slice(0, 8)] ?? `The ${what} transaction failed: ${info.receipt.result}`);
  }
  throw new Error(`No confirmation for ${txid} after 60 s. Check it on Tronscan.`);
}

// Sends a transaction to the vault and waits for it.
async function vaultSend(key: string, method: string, args: unknown[]) {
  const v = vaultInfo()!;
  const w = new TronWeb({ fullHost: NILE_HOST, privateKey: key });
  const txid: string = await (await w.contract(v.abi, v.address))[method](...args).send({ feeLimit: FEE_LIMIT });
  return confirm(txid, VAULT_ERRORS, 'vault');
}

export async function vaultRelease(a: ApprovalValue & { signature: string }) {
  const key = process.env.NOTARY_PRIVATE_KEY;
  if (!key) throw new Error('NOTARY_PRIVATE_KEY is not set, so Ansim cannot ask the vault for money.');
  const sig = a.signature.startsWith('0x') ? a.signature : `0x${a.signature}`;
  return vaultSend(key, 'release', [a.batchId, a.policyId, a.rowsHash, a.count, a.total, sig]);
}

// Owner actions signed with the demo owner key. With TronLink as the owner, the console sends them from TronLink.
export const vaultSetFrozen = (key: string, frozen: boolean) => vaultSend(key, 'setFrozen', [frozen]);

const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// What the chain says about a USDT transaction: whether it succeeded, when, and every USDT transfer in it
// (the payment itself and GasFree's fee).
export async function usdtTransferProof(txid: string) {
  const info: any = await tw.trx.getTransactionInfo(txid);
  if (!info?.id) return { found: false as const };
  const usdtHex = tw.address.toHex(NILE_USDT).slice(2).toLowerCase();
  const transfers = (info.log ?? [])
    .filter((l: any) => l.address?.toLowerCase() === usdtHex && l.topics?.[0] === TRANSFER_TOPIC)
    .map((l: any) => ({
      from: tw.address.fromHex('41' + l.topics[1].slice(-40)),
      to: tw.address.fromHex('41' + l.topics[2].slice(-40)),
      value: Number(BigInt('0x' + l.data)),
    }));
  return { found: true as const, success: info.receipt?.result === 'SUCCESS', block: info.blockNumber as number, time: info.blockTimeStamp as number, transfers };
}

export const tronscanTx = (hash: string) => `https://nile.tronscan.org/#/transaction/${hash}`;
