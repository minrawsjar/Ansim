// Local stand-ins for GasFree and Kiln, for testing Ansim without keys. Never use them for a demo:
// the transaction hashes are made up (verify.mjs rightly fails them against the chain), and the
// "AI" replies are canned text marked [fake].
// GasFree: checks request signing headers and the TIP-712 permit signature, enforces nonces, and walks
// each transfer through WAITING → INPROGRESS → CONFIRMING → SUCCEED over a few seconds.
// Kiln: answers /v1/chat/completions with JSON in the shape each Ansim flow expects.
// Usage: node scripts/fake-services.mjs
//   GASFREE_BASE=http://localhost:4100/nile/  KILN_BASE_URL=http://localhost:4100/v1
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

async function fakeKiln(req, res) {
  let raw = '';
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  const system = body.messages[0].content;
  const input = JSON.parse(body.messages[1].content);
  let out;
  if (system.includes('map the columns')) {
    const pick = (re) => input.header.find((h) => re.test(h)) ?? null;
    out = { receiver: pick(/지갑|wallet|address/i), amount: pick(/금액|amount/i), sender: pick(/송금인|sender/i), name: input.header.find((h) => /수취인|recipient/i.test(h) && !/지갑/.test(h)) ?? null, note: pick(/비고|note/i) };
  } else if (system.includes('check a USDT payout batch')) {
    out = { rows: input.rows.map((r) => ({ line: r.line, ko: `[fake] ${r.flags.join(', ')} 확인이 필요합니다.`, en: `[fake] Check ${r.flags.join(', ')}.`, action: r.flags.includes('UNUSUAL_AMOUNT') && r.flags.length === 1 ? 'pay' : 'hold' })) };
  } else if (system.includes('judge a recipient wallet')) {
    out = input.flags.length ? { ko: `[fake] 위험 신호: ${input.flags.join(', ')}`, en: `[fake] Risk signals: ${input.flags.join(', ')}.` } : { ko: '[fake] 공개 기록에서 위험 신호가 없습니다.', en: '[fake] No risk signals in the public record.' };
  } else if (system.includes('answer a customer')) {
    const p = input.payments[0];
    out = p ? { ko: `[fake] ${p.sender}님의 ${p.amountUSDT} USDT 송금은 ${p.state} 상태입니다.`, en: `[fake] ${p.sender}'s ${p.amountUSDT} USDT payment is ${p.state}. See [#${p.events.at(-1)?.id ?? 0}].` } : { ko: '[fake] 기록이 없습니다.', en: '[fake] No matching payment.' };
  } else if (system.includes('receipt')) {
    out = { ko: `[fake] ${input.paidCount}건, ${input.amountPaidUSDT} USDT 지급 완료.`, en: `[fake] Paid ${input.paidCount} rows, ${input.amountPaidUSDT} USDT.` };
  } else {
    out = { answer: `[fake] ${input.events.length} events in the log. See [#${input.events.at(-1)?.id ?? 0}].` };
  }
  const content = JSON.stringify(out);
  const prompt = Math.ceil(raw.length / 4);
  const completion = Math.ceil(content.length / 4);
  res.end(JSON.stringify({ id: 'fake-' + randomBytes(6).toString('hex'), object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion } }));
}

http
  .createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/chat/completions') return fakeKiln(req, res);
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
      return ok(res, { accountAddress: m[1], gasFreeAddress: gasFreeAddress(m[1]), active: a.active, nonce: a.nonce, allow_submit: true, assets: [] }); // docs spelling
    }
    if (path === '/api/v1/gasfree/submit' && req.method === 'POST') {
      const p = JSON.parse(body);
      if (bySig.has(p.sig)) return ok(res, transfers.get(bySig.get(p.sig))); // same permit sent twice: same transfer
      const { sig, requestId, ...message } = p; // eslint-disable-line no-unused-vars
      let valid = false;
      try {
        valid = await tw.trx.verifyTypedData(domain, types, message, '0x' + sig, p.user);
      } catch {
        valid = false;
      }
      // Exception names as documented at docs.gasfree.io
      if (!valid) return fail(res, 'InvalidSignatureException', 'Permit signature does not match the user');
      const a = account(p.user);
      if ([...transfers.values()].some((t) => t.user === p.user && !['SUCCEED', 'FAILED'].includes(advance(t).state)))
        return fail(res, 'TooManyPendingTransferException', 'Only one pending transfer per account');
      if (Number(p.nonce) !== a.nonce) return fail(res, 'NonceNotMatchException', `Expected nonce ${a.nonce}`);
      if (Number(p.deadline) < Date.now() / 1000) return fail(res, 'DeadlineExceededException', 'Permit deadline has passed');
      if (Number(p.maxFee) < TRANSFER_FEE + (a.active ? 0 : ACTIVATE_FEE)) return fail(res, 'MaxFeeExceededException', 'maxFee is below the required fee');
      a.nonce += 1; // reserved on submit, like a pending transfer
      const t = { id: randomBytes(8).toString('hex'), requestId, createdAt: Date.now(), state: 'WAITING', user: p.user, value: p.value, estimatedTransferFee: TRANSFER_FEE };
      transfers.set(t.id, t);
      bySig.set(p.sig, t.id);
      return ok(res, t);
    }
    m = path.match(/^\/api\/v1\/gasfree\/(\w+)$/);
    if (m && transfers.has(m[1])) return ok(res, advance(transfers.get(m[1])));
    return fail(res, 'NotFound', path);
  })
  .listen(4100, () => console.log('Fake GasFree on http://localhost:4100/nile/ and fake Kiln on http://localhost:4100/v1'));
