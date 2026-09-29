import fs from 'node:fs';
import { TronWeb } from 'tronweb';

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

export async function recordPolicy(p: { id: number; hash: string; payer: string; owner: string; budget: number; perPayment: number; deadline: number }) {
  const c = registryContract();
  if (!c) return null;
  return (await c.grantPolicy(p.id, b32(p.hash), p.payer, p.owner, p.budget, p.perPayment, p.deadline).send({ feeLimit: FEE_LIMIT })) as string;
}

export async function recordStop(policyId: number) {
  const c = registryContract();
  if (!c) return null;
  return (await c.stopPolicy(policyId).send({ feeLimit: FEE_LIMIT })) as string;
}

export async function recordBatchSeal(s: { batchId: number; policyId: number; logHash: string; paid: number; refused: number; amountPaid: number; fees: number }) {
  const c = registryContract();
  if (!c) return null;
  return (await c.sealBatch(s.batchId, s.policyId, b32(s.logHash), s.paid, s.refused, s.amountPaid, s.fees).send({ feeLimit: FEE_LIMIT })) as string;
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
