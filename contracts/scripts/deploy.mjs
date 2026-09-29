// Deploys AnsimRegistry to TRON Nile with the notary key from backend/.env.local and writes
// deployments/nile.json, which the backend and verify script read.
// Usage: npm run deploy:contracts   (the notary address needs Nile TRX from https://nileex.io/join/getJoinPage)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TronWeb } from 'tronweb';

try {
  process.loadEnvFile(new URL('../../backend/.env.local', import.meta.url));
} catch {
  // fall back to the current environment
}
const key = process.env.NOTARY_PRIVATE_KEY;
if (!key) {
  console.error('NOTARY_PRIVATE_KEY is missing. Run npm run setup first.');
  process.exit(1);
}

execFileSync(process.execPath, [fileURLToPath(new URL('./compile.mjs', import.meta.url))], { stdio: 'inherit' });
const { abi, bytecode } = JSON.parse(fs.readFileSync(new URL('../build/AnsimRegistry.json', import.meta.url), 'utf8'));

const tw = new TronWeb({ fullHost: process.env.TRON_FULLHOST ?? 'https://nile.trongrid.io', privateKey: key });
const notary = tw.defaultAddress.base58;
const trx = (await tw.trx.getBalance(notary)) / 1e6;
console.log(`Notary ${notary} has ${trx} TRX on Nile`);
if (trx < 50) {
  console.error('Fund the notary with Nile TRX first: https://nileex.io/join/getJoinPage');
  process.exit(1);
}

const tx = await tw.transactionBuilder.createSmartContract(
  { abi, bytecode, feeLimit: 1_000_000_000, callValue: 0, userFeePercentage: 100, originEnergyLimit: 10_000_000, name: 'AnsimRegistry' },
  notary,
);
const signed = await tw.trx.sign(tx, key);
const res = await tw.trx.sendRawTransaction(signed);
if (!res.result) {
  console.error('Deployment rejected:', res);
  process.exit(1);
}
const address = tw.address.fromHex(tx.contract_address);
console.log(`Sent deployment ${signed.txID}. Waiting for confirmation...`);

for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const info = await tw.trx.getTransactionInfo(signed.txID);
  if (info?.receipt) {
    if (info.receipt.result !== 'SUCCESS') {
      console.error('Deployment failed on chain:', info.receipt.result);
      process.exit(1);
    }
    const out = { network: 'nile', address, txid: signed.txID, notary, abi, deployedAt: new Date().toISOString() };
    fs.mkdirSync(new URL('../deployments/', import.meta.url), { recursive: true });
    fs.writeFileSync(new URL('../deployments/nile.json', import.meta.url), JSON.stringify(out, null, 2));
    console.log(`AnsimRegistry deployed at ${address}`);
    console.log(`https://nile.tronscan.org/#/contract/${address}`);
    process.exit(0);
  }
}
console.error('No confirmation after 90 s. Check the transaction on Tronscan:', signed.txID);
process.exit(1);
