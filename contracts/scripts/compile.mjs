// Compiles src/AnsimRegistry.sol with solc-js into build/AnsimRegistry.json.
// evmVersion is pinned to istanbul so the bytecode avoids opcodes the TRON VM may not support (such as PUSH0).
import fs from 'node:fs';
import solc from 'solc';

const src = fs.readFileSync(new URL('../src/AnsimRegistry.sol', import.meta.url), 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'AnsimRegistry.sol': { content: src } },
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

const c = out.contracts['AnsimRegistry.sol'].AnsimRegistry;
fs.mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
fs.writeFileSync(
  new URL('../build/AnsimRegistry.json', import.meta.url),
  JSON.stringify({ abi: c.abi, bytecode: c.evm.bytecode.object, compiler: solc.version(), evmVersion: 'istanbul' }, null, 2),
);
console.log(`Compiled AnsimRegistry with solc ${solc.version()}: ${c.evm.bytecode.object.length / 2} bytes`);
