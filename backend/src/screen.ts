import { TronWeb } from 'tronweb';

export type Payee = { address: string; name: string; usual: number; added?: number; risk?: string }; // usual in base units, added in unix seconds, risk level
export type ScreenRow = { line: number; sender: string; receiver: string; amount: number | null; note: string; flags: string[]; travel?: boolean };
// waitSec: how long a new contact waits before it can be paid. travelMin: the Travel Rule threshold in base units.
export type ScreenRules = { now?: number; waitSec?: number; travelMin?: number };

// Rows with these flags can never be paid, whatever the operator or the model says. The last two
// clear by themselves: once the waiting period passes, or once the Travel Rule details are added.
export const BLOCKING = new Set(['INVALID_ADDRESS', 'INVALID_AMOUNT', 'TETHER_FROZEN', 'REPORTED_WALLET', 'NEW_CONTACT_WAIT', 'TRAVEL_RULE_INFO']);

export const FLAG_INFO: Record<string, string> = {
  INVALID_ADDRESS: 'Not a valid TRON address',
  INVALID_AMOUNT: 'Amount is missing, zero or not a number',
  DUPLICATE: 'Same sender, wallet, amount and note as an earlier row',
  NEW_PAYEE: 'Wallet is not in the payee book',
  LOOKALIKE: 'Looks like a known payee wallet but is a different one (address poisoning)',
  UNUSUAL_AMOUNT: 'More than 3 times this payee’s usual amount',
  REPORTED_WALLET: 'Wallet is on the reported scam list',
  TETHER_FROZEN: 'Tether has frozen this wallet',
  MANY_SENDERS_ONE_WALLET: 'Three or more different senders pay this one new wallet (possible money mule)',
  NEW_CONTACT_WAIT: 'Contact was added too recently; new contacts wait before they can be paid (delayed transfer, 지연이체)',
  TRAVEL_RULE_INFO: 'At or above the Travel Rule threshold; sender and recipient details are required first',
  RISKY_WALLET: 'The contact’s wallet history on mainnet shows risk signals',
};

export type WalletFacts = {
  used: boolean; createdAt: number | null; isContract: boolean; trx: number;
  usdtIn7d: { transfers: number; senders: number; total: number }; frozenSenders: string[];
};
const HIGH = new Set(['WALLET_IS_CONTRACT', 'WALLET_FROZEN_SENDERS', 'WALLET_MANY_SENDERS']);

// Risk signals from a wallet's public history. Code decides; the model only explains. A wallet with no
// signals is not called safe: the record is just clean.
export function walletRisk(f: WalletFacts, nowMs = Date.now()) {
  const flags: string[] = [];
  if (f.isContract) flags.push('WALLET_IS_CONTRACT');
  if (f.frozenSenders.length) flags.push('WALLET_FROZEN_SENDERS');
  if (f.usdtIn7d.senders >= 5) flags.push('WALLET_MANY_SENDERS');
  if (f.createdAt && nowMs - f.createdAt < 30 * 86_400_000) flags.push('WALLET_NEW');
  const level = flags.some((x) => HIGH.has(x)) ? 'high' : flags.length ? 'review' : 'none';
  return { flags, level };
}

const B58 = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
export const validAddress = (a: string) => B58.test(a) && TronWeb.isAddress(a);

// Same first 4 and last 4 characters: what most wallets show when they shorten an address.
export const looksAlike = (a: string, b: string) => a !== b && a.slice(0, 4) === b.slice(0, 4) && a.slice(-4) === b.slice(-4);

// Why a wallet must not be added to the contacts, or null. The Tether freeze check needs the network and runs separately.
export function contactProblem(address: string, book: { address: string; name: string }[], reported: Set<string>): string | null {
  if (!validAddress(address)) return 'Not a valid TRON address.';
  const same = book.find((p) => p.address === address);
  if (same) return `This wallet is already saved as ${same.name}.`;
  const twin = book.find((p) => looksAlike(p.address, address));
  if (twin) return `This wallet starts and ends like ${twin.name}'s but is a different address. That is how address-poisoning scams work, so it was not saved. Check the full address with the recipient.`;
  if (reported.has(address)) return 'This wallet is on the reported scam list.';
  return null;
}

// All checks are plain code. Only rows they flag are sent to the model for an explanation.
export async function screen(
  rows: ScreenRow[],
  book: Map<string, Payee>,
  reported: Set<string>,
  isFrozen: (address: string) => Promise<boolean | null>,
  rules: ScreenRules = {},
) {
  const now = rules.now ?? Date.now() / 1000;
  const seen = new Set<string>();
  const senders = new Map<string, Set<string>>();
  const known = [...book.keys()];

  for (const r of rows) {
    r.flags = [];
    const flag = (f: string) => r.flags.push(f);
    if (r.amount === null || !(r.amount > 0)) flag('INVALID_AMOUNT');
    if (!validAddress(r.receiver)) {
      flag('INVALID_ADDRESS');
      continue;
    }
    const key = `${r.sender.trim().toLowerCase()}|${r.receiver}|${r.amount}|${r.note}`;
    if (seen.has(key)) flag('DUPLICATE');
    seen.add(key);
    const payee = book.get(r.receiver);
    if (!payee) {
      flag('NEW_PAYEE');
      if (known.some((a) => looksAlike(a, r.receiver))) flag('LOOKALIKE');
    } else {
      if (rules.waitSec && payee.added && now - payee.added < rules.waitSec) flag('NEW_CONTACT_WAIT');
      if (payee.risk === 'high') flag('RISKY_WALLET');
      if (r.amount !== null && payee.usual > 0 && r.amount > 3 * payee.usual) flag('UNUSUAL_AMOUNT');
    }
    if (rules.travelMin && r.amount !== null && r.amount >= rules.travelMin && !r.travel) flag('TRAVEL_RULE_INFO');
    if (reported.has(r.receiver)) flag('REPORTED_WALLET');
    if (!senders.has(r.receiver)) senders.set(r.receiver, new Set());
    senders.get(r.receiver)!.add(r.sender.trim().toLowerCase());
  }

  for (const r of rows) {
    if (!book.has(r.receiver) && (senders.get(r.receiver)?.size ?? 0) >= 3) r.flags.push('MANY_SENDERS_ONE_WALLET');
  }

  const unique = [...new Set(rows.filter((r) => validAddress(r.receiver)).map((r) => r.receiver))];
  // One at a time: public TronGrid rate-limits bursts of calls.
  const frozen = new Map<string, boolean | null>();
  for (const a of unique) {
    frozen.set(a, await isFrozen(a));
    await new Promise((r) => setTimeout(r, process.env.TRONGRID_API_KEY ? 50 : 350));
  }
  for (const r of rows) if (frozen.get(r.receiver)) r.flags.push('TETHER_FROZEN');
  return { freezeCheckFailed: [...frozen.values()].some((v) => v === null) };
}
