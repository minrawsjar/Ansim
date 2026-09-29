// One-time setup: creates Nile test wallets in backend/.env.local (never overwriting existing values)
// and writes the demo payee book, reported-wallet list and payout spreadsheet into backend/data/.
// Usage: npm run setup            (add --force-data to regenerate the demo files)
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { TronWeb } from 'tronweb';
import * as XLSX from 'xlsx';

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

// Address poisoning demo: find two real, valid addresses that share their first 4 and last 4 characters.
// A birthday search over random addresses finds a pair in about a million tries.
function lookalikePair() {
  const seen = new Map();
  const seed = randomBytes(16);
  const at = (i) => addressFrom(sha(Buffer.concat([seed, Buffer.from(String(i))])).subarray(0, 20));
  for (let i = 0; i < 20_000_000; i++) {
    const a = at(i);
    const k = a.slice(0, 4) + a.slice(-4);
    const j = seen.get(k);
    if (j !== undefined) return [at(j), a];
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

console.log('\nSearching for a lookalike address pair...');
const t0 = Date.now();
const [lan, poisoned] = lookalikePair();
console.log(`  found ${lan} / ${poisoned} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const frozen = await frozenAddress();
console.log(`  Tether-frozen wallet: ${frozen}`);

const payees = [
  { name: 'Nguyen Thi Lan', country: 'Vietnam', address: lan, usual: 3 },
  { name: 'Tran Van Minh', country: 'Vietnam', address: randomAddress(), usual: 2.5 },
  { name: 'Maria Santos', country: 'Philippines', address: randomAddress(), usual: 2 },
  { name: 'Sita Gurung', country: 'Nepal', address: randomAddress(), usual: 3 },
  { name: 'Juan dela Cruz', country: 'Philippines', address: randomAddress(), usual: 2 },
  { name: 'Ram Thapa', country: 'Nepal', address: randomAddress(), usual: 2 },
];
const [P1, P2, P3, P4, P5, P6] = payees.map((p) => p.address);
const mule = randomAddress();
const reportedWallet = randomAddress();
let typo = P5;
while (TronWeb.isAddress(typo)) typo = P5.slice(0, 20) + ALPHABET[Math.floor(Math.random() * 58)] + P5.slice(21);

const header = ['송금인', '수취인', '수취인 지갑주소', '금액(USDT)', '비고'];
const rows = [
  ['Nguyen Van An', 'Nguyen Thi Lan', P1, '3.00', '9월 생활비'],
  ['Tran Quoc Bao', 'Tran Van Minh', P2, '2.50', '9월 생활비'],
  ['Maria Reyes', 'Maria Santos', P3, '2.00', '학비 tuition'],
  ['Bikash Gurung', 'Sita Gurung', P4, '10.00', '추석 보너스 송금'],
  ['Tran Quoc Bao', 'Tran Van Minh', P2, '2.50', '9월 생활비'],
  ['Nguyen Van An', 'Nguyen Thi Lan', poisoned, '3.00', '9월 생활비 (새 지갑)'],
  ['Juan Cruz', 'Juan dela Cruz', typo, '2.00', 'rent'],
  ['김민수', 'Le Van Hung', mule, '1.00', '대리 송금'],
  ['박지훈', 'Le Van Hung', mule, '1.00', '대리 송금'],
  ['최서연', 'Le Van Hung', mule, '1.00', '대리 송금'],
  ['Sokha Chan', 'Chan Dara', frozen, '2.00', '가족 송금'],
  ['Aung Min', 'Hla Hla', reportedWallet, '1.50', '급전 요청'],
  ['Ram Bahadur', 'Ram Thapa', P6, '2.00', '9월 생활비'],
];

fs.writeFileSync(new URL('payees.json', DATA), JSON.stringify(payees, null, 2));
fs.writeFileSync(new URL('reported.json', DATA), JSON.stringify([reportedWallet], null, 2));
const csv = [header, ...rows].map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
fs.writeFileSync(new URL('demo/ansim-demo-payouts.csv', DATA), '﻿' + csv);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), '송금목록');
fs.writeFileSync(new URL('demo/ansim-demo-payouts.xlsx', DATA), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log('\nWrote backend/data/payees.json, reported.json and demo/ansim-demo-payouts.csv/.xlsx');
