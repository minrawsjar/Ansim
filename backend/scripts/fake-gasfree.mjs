// Local stand-in for the GasFree API, for testing Ansim without a GasFree key. Never use it for a demo:
// its transaction hashes are made up, and verify.mjs will rightly fail them against the chain.
// It checks request signing headers and the TIP-712 permit signature, enforces nonces, and walks each
// transfer through WAITING → INPROGRESS → CONFIRMING → SUCCEED over a few seconds.
// Usage: node scripts/fake-gasfree.mjs   (listens on :4100, base URL http://localhost:4100/nile/)
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { TronWeb } from 'tronweb';

const USDT = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const PROVIDER = TronWeb.address.fromHex('41' + '11'.repeat(20));
const TRANSFER_FEE = 500_000;
const ACTIVATE_FEE = 1_000_000;
const tw = new TronWeb({ fullHost: 'https://nile.trongrid.io' });
const domain = { name: 'GasFreeController', version: 'V1.0.0', chainId: 3448148188, verifyingContract: 'THQGuFzL87ZqhxkgqYEryRAd7gqFqL5rdc' };
const types = { PermitTransfer: ['token', 'serviceProvider', 'user', 'receiver'].map((n) => ({ name: n, type: 'address' })).concat(['value', 'maxFee', 'deadline', 'version', 'nonce'].map((n) => ({ name: n, type: 'uint256' }))) };

const accounts = new Map(); // user -> { nonce, active }
const transfers = new Map(); // id -> transfer
const bySig = new Map(); // sig -> id
const account = (u) => accounts.get(u) ?? (accounts.set(u, { nonce: 0, active: false }), accounts.get(u));
const gasFreeAddress = (u) => TronWeb.address.fromHex('41' + createHash('sha256').update('gasfree:' + u).digest('hex').slice(0, 40));
const ok = (res, data) => res.end(JSON.stringify({ code: 200, reason: null, message: null, data }));
const fail = (res, reason, message) => res.end(JSON.stringify({ code: 400, reason, message }));

function advance(t) {
  const steps = ['WAITING', 'INPROGRESS', 'CONFIRMING', 'SUCCEED'];
  const i = Math.min(Math.floor((Date.now() - t.createdAt) / 1500), 3);
  if (steps[i] === 'SUCCEED' && t.state !== 'SUCCEED') {
    const a = account(t.user);
    const fee = TRANSFER_FEE + (a.active ? 0 : ACTIVATE_FEE);
    a.active = true;
    Object.assign(t, { txnHash: randomBytes(32).toString('hex'), txnTotalFee: fee, txnTransferFee: TRANSFER_FEE, txnAmount: t.value });
  }
  t.state = steps[i];
  return t;
}

http
  .createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (!req.headers.authorization?.startsWith('ApiKey ') || !req.headers.timestamp) return res.end('Authorization or timestamp not found.');
    const path = req.url.replace(/^\/nile/, '');
    let body = '';
    for await (const c of req) body += c;
    if (path === '/api/v1/config/token/all') return ok(res, { tokens: [{ tokenAddress: USDT, symbol: 'USDT', activateFee: ACTIVATE_FEE, transferFee: TRANSFER_FEE, decimal: 6, supported: true }] });
    if (path === '/api/v1/config/provider/all') return ok(res, { providers: [{ address: PROVIDER, name: 'Local fake provider', config: { maxPendingTransfer: 1, minDeadlineDuration: 60, maxDeadlineDuration: 600, defaultDeadlineDuration: 180 } }] });
    let m = path.match(/^\/api\/v1\/address\/(T\w+)$/);
    if (m) {
      for (const t of transfers.values()) advance(t);
      const a = account(m[1]);
      return ok(res, { accountAddress: m[1], gasFreeAddress: gasFreeAddress(m[1]), active: a.active, nonce: a.nonce, allowSubmit: true, assets: [] });
    }
    if (path === '/api/v1/gasfree/submit' && req.method === 'POST') {
      const p = JSON.parse(body);
      if (bySig.has(p.sig)) return ok(res, transfers.get(bySig.get(p.sig))); // same permit sent twice: same transfer
      const { sig, ...message } = p;
      let valid = false;
      try {
        valid = await tw.trx.verifyTypedData(domain, types, message, '0x' + sig, p.user);
      } catch {
        valid = false;
      }
      if (!valid) return fail(res, 'InvalidSignature', 'Permit signature does not match the user');
      const a = account(p.user);
      if (Number(p.nonce) !== a.nonce) return fail(res, 'InvalidNonce', `Expected nonce ${a.nonce}`);
      if (Number(p.deadline) < Date.now() / 1000) return fail(res, 'DeadlineExceeded', 'Permit deadline has passed');
      if (Number(p.maxFee) < TRANSFER_FEE + (a.active ? 0 : ACTIVATE_FEE)) return fail(res, 'MaxFeeExceeded', 'maxFee is below the required fee');
      a.nonce += 1; // reserved on submit, like a pending transfer
      const t = { id: randomBytes(8).toString('hex'), createdAt: Date.now(), state: 'WAITING', user: p.user, value: p.value, estimatedTransferFee: TRANSFER_FEE };
      transfers.set(t.id, t);
      bySig.set(p.sig, t.id);
      return ok(res, t);
    }
    m = path.match(/^\/api\/v1\/gasfree\/(\w+)$/);
    if (m && transfers.has(m[1])) return ok(res, advance(transfers.get(m[1])));
    return fail(res, 'NotFound', path);
  })
  .listen(4100, () => console.log('Fake GasFree on http://localhost:4100/nile/'));
