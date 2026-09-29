// Compiles the contracts in src/ with solc-js into build/<Name>.json.
// evmVersion is pinned to istanbul so the bytecode avoids opcodes the TRON VM may not support (such as PUSH0).
import fs from 'node:fs';
import solc from 'solc';

const NAMES = ['AnsimRegistry', 'AnsimVault'];
const input = {
  language: 'Solidity',
  sources: Object.fromEntries(NAMES.map((n) => [`${n}.sol`, { content: fs.readFileSync(new URL(`../src/${n}.sol`, import.meta.url), 'utf8') }])),
  settings: {
    evmVersion: 'istanbul',
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
for (const e of out.errors ?? []) console[e.severity === 'error' ? 'error' : 'warn'](e.formattedMessage);
if (errors.length) process.exit(1);

fs.mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
for (const n of NAMES) {
  const c = out.contracts[`${n}.sol`][n];
  fs.writeFileSync(
    new URL(`../build/${n}.json`, import.meta.url),
    JSON.stringify({ abi: c.abi, bytecode: c.evm.bytecode.object, compiler: solc.version(), evmVersion: 'istanbul' }, null, 2),
  );
  console.log(`Compiled ${n} with solc ${solc.version()}: ${c.evm.bytecode.object.length / 2} bytes`);
}
