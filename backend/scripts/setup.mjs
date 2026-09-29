// One-time setup: creates Nile test wallets in backend/.env.local (never overwriting existing values)
// and writes the demo payee book, reported-wallet list and payout spreadsheet into backend/data/.
// Usage: npm run setup            (add --force-data to regenerate the demo files)
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { TronWeb } from 'tronweb';
import * as XLSX from 'xlsx';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

const ENV = new URL('../.env.local', import.meta.url);
const DATA = new URL('../data/', import.meta.url);
fs.mkdirSync(new URL('demo/', DATA), { recursive: true });

/* ---------- wallets ---------- */
const existing = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
const has = (k) => new RegExp(`^${k}=.+`, 'm').test(existing);
const lines = [];
const addKey = async (k, note) => {
  if (has(k)) return;
  const a = await TronWeb.createAccount();
  lines.push(`# ${note}: ${a.address.base58}`, `${k}=${a.privateKey}`);
};
await addKey('PAYER_PRIVATE_KEY', 'Payer. Signs GasFree permits. Its GasFree address needs Nile USDT');
await addKey('OWNER_PRIVATE_KEY', 'Owner fallback. Signs the policy when TronLink is not used');
await addKey('NOTARY_PRIVATE_KEY', 'Notary. Deploys and writes the registry contract. Needs Nile TRX');
const placeholders = {
  GASFREE_BASE: 'https://open-test.gasfree.io/nile/',
  GASFREE_API_KEY: '',
  GASFREE_API_SECRET: '',
  TRON_FULLHOST: 'https://nile.trongrid.io',
  TRONGRID_API_KEY: '',
  KILN_BASE_URL: '',
  KILN_API_KEY: '',
  KILN_MODEL: 'gpt-oss-120b',
  SIMULATE_LOST_RESPONSE_LINE: '',
};
for (const [k, v] of Object.entries(placeholders)) if (!new RegExp(`^${k}=`, 'm').test(existing)) lines.push(`${k}=${v}`);
if (lines.length) fs.appendFileSync(ENV, (existing && !existing.endsWith('\n') ? '\n' : '') + lines.join('\n') + '\n');
fs.chmodSync(ENV, 0o600);

const env = Object.fromEntries(
  fs.readFileSync(ENV, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const addr = (k) => (env[k] ? TronWeb.address.fromPrivateKey(env[k]) : '(not set)');
console.log('Wallets in backend/.env.local (keys stay in that file):');
console.log(`  payer   ${addr('PAYER_PRIVATE_KEY')}`);
console.log(`  owner   ${addr('OWNER_PRIVATE_KEY')}`);
console.log(`  notary  ${addr('NOTARY_PRIVATE_KEY')}  <- send Nile TRX here from https://nileex.io/join/getJoinPage`);

/* ---------- demo data ---------- */
const force = process.argv.includes('--force-data');
if (fs.existsSync(new URL('payees.json', DATA)) && !force) {
  console.log('\nDemo data already exists. Use --force-data to regenerate it.');
  process.exit(0);
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha = (b) => createHash('sha256').update(b).digest();
function base58(buf) {
  let x = BigInt('0x' + buf.toString('hex'));
  let s = '';
  while (x > 0n) {
    s = ALPHABET[Number(x % 58n)] + s;
    x /= 58n;
  }
  return s;
}
const addressFrom = (body20) => {
  const body = Buffer.concat([Buffer.from([0x41]), body20]);
  return base58(Buffer.concat([body, sha(sha(body)).subarray(0, 4)]));
};
const randomAddress = () => addressFrom(randomBytes(20));

// Address poisoning demo: two real wallets, with private keys, that share their first 4 and last 4
// characters. A birthday search needs about two million keys. Consecutive keys are cheap: each public
// key is the previous one plus the curve's generator, so no key needs a full multiplication.
function lookalikeKeys() {
  const n = secp256k1.CURVE.n;
  const k0 = BigInt('0x' + randomBytes(32).toString('hex')) % (n - 100_000_000n);
  const G = secp256k1.ProjectivePoint.BASE;
  const hex = (k) => k.toString(16).padStart(64, '0');
  let P = G.multiply(k0);
  const seen = new Map();
  for (let i = 1; i < 60_000_000; i++) {
    P = P.add(G);
    const a = addressFrom(Buffer.from(keccak_256(P.toRawBytes(false).subarray(1))).subarray(12));
    const k = a.slice(0, 4) + a.slice(-4);
    const j = seen.get(k);
    if (j !== undefined) return [{ address: TronWeb.address.fromPrivateKey(hex(k0 + BigInt(j))), privateKey: hex(k0 + BigInt(j)) }, { address: a, privateKey: hex(k0 + BigInt(i)) }];
    seen.set(k, i);
  }
  throw new Error('No lookalike pair found');
}

// A wallet Tether has actually frozen on mainnet, read from its AddedBlackList events.
async function frozenAddress() {
  const url = 'https://api.trongrid.io/v1/contracts/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t/events?event_name=AddedBlackList&limit=20&order_by=block_timestamp,desc';
  const main = new TronWeb({ fullHost: 'https://api.trongrid.io' });
  main.setAddress('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb');
  const usdt = await main.contract().at('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  const j = await (await fetch(url)).json();
  for (const e of j.data ?? []) {
    const a = TronWeb.address.fromHex('41' + e.result._user.replace(/^0x/, ''));
    if (await usdt.isBlackListed(a).call()) return a;
  }
  throw new Error('Could not find a frozen USDT wallet');
}

console.log('\nSearching for a lookalike wallet pair...');
const t0 = Date.now();
const [first, poisoner] = lookalikeKeys();
const poisoned = poisoner.address;
console.log(`  found ${first.address} / ${poisoned} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const frozen = await frozenAddress();
console.log(`  Tether-frozen wallet: ${frozen}`);

// Demo contacts are real Nile wallets named Dummy 1 to Dummy 6. Their private keys go to
// data/demo-wallets.local.json (git-ignored), so a wallet can be opened in TronLink to watch USDT arrive.
const wallets = [first];
for (let i = 0; i < 5; i++) {
  const a = await TronWeb.createAccount();
  wallets.push({ address: a.address.base58, privateKey: a.privateKey });
}
const COUNTRIES = ['Vietnam', 'Vietnam', 'Philippines', 'Nepal', 'Philippines', 'Nepal'];
const USUAL = [3, 2.5, 2, 3, 2, 2];
const CITIES = ['Ho Chi Minh City', 'Hanoi', 'Cebu City', 'Pokhara', 'Davao City', 'Kathmandu'];
const payees = wallets.map((w, i) => ({ name: `Dummy ${i + 1}`, country: COUNTRIES[i], city: CITIES[i], address: w.address, usual: USUAL[i] }));
const keyFile = new URL('demo-wallets.local.json', DATA);
fs.writeFileSync(keyFile, JSON.stringify(wallets.map((w, i) => ({ name: `Dummy ${i + 1}`, ...w })), null, 2));
fs.chmodSync(keyFile, 0o600);
const [P1, P2, P3, P4, P5, P6] = payees.map((p) => p.address);
const mule = randomAddress();
const reportedWallet = randomAddress();
let typo = P5;
while (TronWeb.isAddress(typo)) typo = P5.slice(0, 20) + ALPHABET[Math.floor(Math.random() * 58)] + P5.slice(21);

const header = ['송금인', '수취인', '수취인 지갑주소', '금액(USDT)', '비고'];
// Senders are the workers in Korea. Recipients 7 to 9 are not contacts: the mule, frozen and reported wallets.
const rows = [
  ['Sender 1', 'Dummy 1', P1, '3.00', '9월 생활비'],
  ['Sender 2', 'Dummy 2', P2, '2.50', '9월 생활비'],
  ['Sender 3', 'Dummy 3', P3, '2.00', '학비 tuition'],
  ['Sender 4', 'Dummy 4', P4, '10.00', '추석 보너스 송금'],
  ['Sender 2', 'Dummy 2', P2, '2.50', '9월 생활비'],
  ['Sender 1', 'Dummy 1', poisoned, '3.00', '9월 생활비 (새 지갑)'],
  ['Sender 5', 'Dummy 5', typo, '2.00', 'rent'],
  ['Sender 7', 'Dummy 7', mule, '1.00', '대리 송금'],
  ['Sender 8', 'Dummy 7', mule, '1.00', '대리 송금'],
  ['Sender 9', 'Dummy 7', mule, '1.00', '대리 송금'],
  ['Sender 10', 'Dummy 8', frozen, '2.00', '가족 송금'],
  ['Sender 11', 'Dummy 9', reportedWallet, '1.50', '급전 요청'],
  ['Sender 6', 'Dummy 6', P6, '2.00', '9월 생활비'],
];

fs.writeFileSync(new URL('payees.json', DATA), JSON.stringify(payees, null, 2));
fs.writeFileSync(new URL('reported.json', DATA), JSON.stringify([reportedWallet], null, 2));
const csv = [header, ...rows].map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
fs.writeFileSync(new URL('demo/ansim-demo-payouts.csv', DATA), '﻿' + csv);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), '송금목록');
fs.writeFileSync(new URL('demo/ansim-demo-payouts.xlsx', DATA), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log('\nWrote backend/data/payees.json, reported.json, demo/ansim-demo-payouts.csv/.xlsx and demo-wallets.local.json (private keys, git-ignored)');
