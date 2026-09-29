import crypto from 'node:crypto';
import { tw, NILE_CHAIN_ID, NILE_USDT } from './tron';

const BASE = process.env.GASFREE_BASE ?? 'https://open-test.gasfree.io/nile/';
const CONTROLLER = process.env.GASFREE_CONTROLLER ?? 'THQGuFzL87ZqhxkgqYEryRAd7gqFqL5rdc'; // Nile

// A GasFree API rejection: the request reached GasFree and it said no. `reason` is GasFree's
// exception name, such as NonceNotMatchException (see docs.gasfree.io).
export class GasFreeRejected extends Error {
  constructor(public reason: string, message: string) {
    super(message ? `${reason}: ${message}` : reason);
  }
}

async function gf(method: 'GET' | 'POST', path: string, body?: unknown) {
  const key = process.env.GASFREE_API_KEY, secret = process.env.GASFREE_API_SECRET;
  if (!key || !secret) throw new Error('GasFree API key and secret are not set in .env.local');
  const ts = Math.floor(Date.now() / 1000);
  const basePath = new URL(BASE).pathname.replace(/\/$/, ''); // "/nile"
  const sig = crypto.createHmac('sha256', secret).update(`${method}${basePath}${path}${ts}`).digest('base64');
  const res = await fetch(new URL(path.slice(1), BASE), {
    method,
    headers: { 'Content-Type': 'application/json', Timestamp: String(ts), Authorization: `ApiKey ${key}:${sig}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let j: { code?: number; reason?: string; message?: string; data?: unknown };
  try {
    j = JSON.parse(text);
  } catch {
    throw new GasFreeRejected(`HTTP${res.status}`, text.slice(0, 200));
  }
  if (j.code !== 200) throw new GasFreeRejected(j.reason ?? 'GasFreeError', j.message ?? '');
  return j.data as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type GasFreeToken = { tokenAddress: string; symbol: string; activateFee: number; transferFee: number; decimal: number };
export type GasFreeProvider = {
  address: string; name: string;
  config: { maxPendingTransfer: number; minDeadlineDuration: number; maxDeadlineDuration: number; defaultDeadlineDuration: number };
};
export type GasFreeAccount = {
  accountAddress: string; gasFreeAddress: string; active: boolean; nonce: number;
  allowSubmit: boolean; // the docs spell it allow_submit, the SDKs allowSubmit; account() fills both
  assets: { tokenAddress: string; tokenSymbol: string; frozen: number }[];
};
export type GasFreeTransfer = {
  id: string; state: 'WAITING' | 'INPROGRESS' | 'CONFIRMING' | 'SUCCEED' | 'FAILED';
  txnHash?: string; txnState?: string; txnTotalFee?: number; txnTransferFee?: number; txnActivateFee?: number;
  estimatedTransferFee?: number; estimatedActivateFee?: number;
};

export const gasfree = {
  tokens: async () => (await gf('GET', '/api/v1/config/token/all')).tokens as GasFreeToken[],
  providers: async () => (await gf('GET', '/api/v1/config/provider/all')).providers as GasFreeProvider[],
  account: async (address: string) => {
    const a = await gf('GET', `/api/v1/address/${address}`);
    return { ...a, allowSubmit: a.allowSubmit ?? a.allow_submit ?? true } as GasFreeAccount;
  },
  submit: async (permit: object) => (await gf('POST', '/api/v1/gasfree/submit', permit)) as GasFreeTransfer,
  status: async (id: string) => (await gf('GET', `/api/v1/gasfree/${id}`)) as GasFreeTransfer,
};

let cached: { at: number; token: GasFreeToken; provider: GasFreeProvider } | undefined;
export async function gasfreeConfig() {
  if (cached && Date.now() - cached.at < 60_000) return cached;
  const [tokens, providers] = await Promise.all([gasfree.tokens(), gasfree.providers()]);
  const token = tokens.find((t) => t.tokenAddress === NILE_USDT) ?? tokens.find((t) => t.symbol === 'USDT');
  const provider = providers[0];
  if (!token) throw new Error('GasFree does not list USDT on this network');
  if (!provider) throw new Error('GasFree returned no service provider');
  cached = { at: Date.now(), token, provider };
  return cached;
}

const domain = { name: 'GasFreeController', version: 'V1.0.0', chainId: NILE_CHAIN_ID, verifyingContract: CONTROLLER };
const types = {
  PermitTransfer: [
    { name: 'token', type: 'address' }, { name: 'serviceProvider', type: 'address' },
    { name: 'user', type: 'address' }, { name: 'receiver', type: 'address' },
    { name: 'value', type: 'uint256' }, { name: 'maxFee', type: 'uint256' },
    { name: 'deadline', type: 'uint256' }, { name: 'version', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

export type Permit = {
  requestId?: string; // our own id for the submission, sent to GasFree for tracing; not part of the signature
  token: string; serviceProvider: string; user: string; receiver: string;
  value: string; maxFee: string; deadline: number; version: number; nonce: number; sig: string;
};

// Signs one TIP-712 transfer permit. The fee cap and deadline are part of the signed message,
// so GasFree's controller contract cannot charge more or execute later than this.
export async function signPermit(m: Omit<Permit, 'version' | 'sig' | 'requestId'>, privateKey: string): Promise<Permit> {
  const message = { ...m, version: 1 };
  const sig = await tw.trx.signTypedData(domain, types, message, privateKey);
  return { requestId: crypto.randomUUID(), ...message, sig: sig.replace(/^0x/, '') };
}
