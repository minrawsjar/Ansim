// Deploys AnsimVault to TRON Nile and writes contracts/deployments/nile-vault.json, which the backend reads.
// The vault's owner is VAULT_OWNER if set (for example your TronLink address), otherwise the demo owner key.
// The notary key pays for the deployment and becomes the agent, the only caller of release().
// Usage: npm run deploy:vault
import '../src/env';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TronWeb } from 'tronweb';
import { gasfree, gasfreeConfig } from '../src/gasfree';
import { addressFromKey, NILE_HOST, NILE_USDT, NILE_CHAIN_ID } from '../src/tron';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is missing from backend/.env.local`);
  return v;
};
const notaryKey = need('NOTARY_PRIVATE_KEY');
const notary = addressFromKey(notaryKey);
const owner = process.env.VAULT_OWNER || addressFromKey(need('OWNER_PRIVATE_KEY'));
const payer = addressFromKey(need('PAYER_PRIVATE_KEY'));
const [{ token }, acct] = await Promise.all([gasfreeConfig(), gasfree.account(payer)]);
const feePerPayment = Number(token.transferFee);

execFileSync(process.execPath, [fileURLToPath(new URL('../../contracts/scripts/compile.mjs', import.meta.url))], { stdio: 'inherit' });
const { abi, bytecode } = JSON.parse(fs.readFileSync(new URL('../../contracts/build/AnsimVault.json', import.meta.url), 'utf8'));

const tw = new TronWeb({ fullHost: NILE_HOST, privateKey: notaryKey });
console.log(`Owner ${owner}\nAgent ${notary}\nPayout (payer's GasFree account) ${acct.gasFreeAddress}\nFee per payment ${feePerPayment / 1e6} USDT`);
const tx = await tw.transactionBuilder.createSmartContract(
  {
    abi, bytecode, name: 'AnsimVault', feeLimit: 1_500_000_000, callValue: 0, userFeePercentage: 100, originEnergyLimit: 10_000_000,
    parameters: [NILE_USDT, owner, notary, acct.gasFreeAddress, feePerPayment, NILE_CHAIN_ID],
  },
  notary,
);
const signed = await tw.trx.sign(tx, notaryKey);
const res = await tw.trx.sendRawTransaction(signed);
if (!res.result) throw new Error(`Deployment rejected: ${JSON.stringify(res)}`);
const address = tw.address.fromHex(tx.contract_address);
console.log(`Sent ${signed.txID}. Waiting for confirmation...`);

for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const info = await tw.trx.getTransactionInfo(signed.txID);
  if (!info?.receipt) continue;
  if (info.receipt.result !== 'SUCCESS') throw new Error(`Deployment failed on chain: ${info.receipt.result}`);
  const out = {
    network: 'nile', address, txid: signed.txID, owner, agent: notary, payout: acct.gasFreeAddress,
    token: NILE_USDT, feePerPayment, chainId: NILE_CHAIN_ID, abi, deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(new URL('../../contracts/deployments/nile-vault.json', import.meta.url), JSON.stringify(out, null, 2));
  console.log(`AnsimVault deployed at ${address}\nhttps://nile.tronscan.org/#/contract/${address}`);
  process.exit(0);
}
throw new Error(`No confirmation after 90 s. Check ${signed.txID} on Tronscan.`);
