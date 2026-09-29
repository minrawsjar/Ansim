'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, usdt, when, signWithTronLink, BANK_FEE_RATE, GASFREE_FEE, FLAGS, REASONS, type BatchView, type Precheck, type Row, type TypedDraft } from '../../../lib';
import { Addr, Button, Callout, Card, Copy, ErrorLine, FlagChip, StatePill, Stat, TxLink, WaitingForTronLink } from '../../../ui';

const LINK_BUTTON = 'inline-flex items-center rounded-[7px] border border-line px-3.5 py-2.5 text-xs font-semibold text-[#c8d1c7] transition hover:bg-raised';
const STATUS_WORD: Record<string, string> = { REVIEW: 'in review', PAUSED: 'paused', CLOSED: 'closed', RUNNING: 'paying' };
const EVENT_TONE = (t: string) => (/REFUSED|FAILED|STOP|REJECT/.test(t) ? 'text-stop' : /SUCCEED|SEALED|CLOSED|CONFIRMED/.test(t) ? 'text-celadon' : 'text-ink');

const MAPPED_BY: Record<string, string> = { kiln: 'Columns mapped by Kiln (gpt-oss-120b)', cache: 'Columns mapped from cache (0 tokens)', rules: 'Columns mapped by header rules' };

function RowLine({ r, editable, onSaved, setError }: { r: Row; editable: boolean; onSaved: () => void; setError: (e: string | null) => void }) {
  const [edit, setEdit] = useState(false);
  const [wallet, setWallet] = useState(r.receiver);
  const [amount, setAmount] = useState(r.amount != null ? String(r.amount / 1e6) : r.amount_raw ?? '');
  const blocking = r.flags.some((f) => FLAGS[f]?.blocking);
  const [travelOpen, setTravelOpen] = useState(false);
  const [travel, setTravel] = useState({ originatorId: '', purpose: '' });

  const patch = async (body: object) => {
    setError(null);
    try {
      await api(`/api/rows/${r.id}`, { method: 'PATCH', json: body });
      setEdit(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <tr className={`border-b border-[#2b3a30] align-top ${r.decision !== 'pay' ? 'bg-paper/50' : ''}`}>
      <td className="num px-3 py-2 font-mono text-xs text-muted">{r.line}</td>
      <td className="px-3 py-2">
        <div className="text-sm">{r.name || '–'}</div>
        <div className="text-xs text-muted">from {r.sender || '–'}</div>
      </td>
      <td className="px-3 py-2">
        {edit ? (
          <input id={`wallet-${r.id}`} value={wallet} onChange={(e) => setWallet(e.target.value)} className="w-80 px-2 py-1.5 font-mono text-xs" />
        ) : (
          <Addr a={r.receiver} />
        )}
      </td>
      <td className="num px-3 py-2 text-right font-mono text-sm whitespace-nowrap">
        {edit ? <input id={`amount-${r.id}`} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-20 px-2 py-1.5 text-right font-mono text-xs" /> : r.amount != null ? usdt(r.amount) : <span className="text-stop">{r.amount_raw || '–'}</span>}
      </td>
      <td className="max-w-40 px-3 py-2 text-xs">{r.note}</td>
      <td className="max-w-md min-w-56 px-3 py-2">
        <div className="flex flex-wrap gap-1">{r.flags.length ? r.flags.map((f) => <FlagChip key={f} flag={f} />) : <span className="text-xs text-ok">All checks passed</span>}</div>
        {r.agent && (
          <div className="mt-2 grid gap-0.5 rounded-md border border-[#354b38] bg-[#202d23] px-2.5 py-2 text-xs">
            <span>{r.agent.ko}</span>
            <span className="text-muted">{r.agent.en}</span>
            <span className="font-medium text-celadon">AI suggests: {r.agent.action === 'pay' ? 'pay' : r.agent.action === 'fix' ? 'fix the data' : 'hold'}</span>
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {editable ? (
          <div className="grid gap-1.5">
            <div className="inline-flex gap-0.5 rounded-[7px] border border-line p-0.5 text-[11px]">
              {(['pay', 'hold', 'remove'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={d === 'pay' && blocking}
                  onClick={() => patch({ decision: d })}
                  className={`rounded-[5px] px-2 py-1 capitalize disabled:cursor-not-allowed disabled:opacity-35 ${r.decision === d ? (d === 'pay' ? 'bg-celadon-soft text-celadon' : d === 'hold' ? 'bg-warn/15 text-warn' : 'bg-stop/15 text-stop') : 'text-muted hover:bg-raised'}`}
                >
                  {d}
                </button>
              ))}
            </div>
            {edit ? (
              <div className="flex gap-1">
                <Button className="!px-2 !py-1" kind="primary" onClick={() => patch({ receiver: wallet, amount })}>Save</Button>
                <Button className="!px-2 !py-1" kind="quiet" onClick={() => setEdit(false)}>Cancel</Button>
              </div>
            ) : (
              <button type="button" onClick={() => setEdit(true)} className="text-left text-xs text-celadon hover:underline">Edit wallet or amount</button>
            )}
            {r.flags.includes('TRAVEL_RULE_INFO') && !travelOpen && (
              <button type="button" onClick={() => setTravelOpen(true)} className="text-left text-xs text-warn hover:underline">Add Travel Rule details</button>
            )}
            {travelOpen && (
              <form className="grid w-56 gap-1.5" onSubmit={(e) => { e.preventDefault(); patch({ travel }); }}>
                <input id={`travel-id-${r.id}`} required placeholder="Sender customer ID or birth date" value={travel.originatorId} onChange={(e) => setTravel((t) => ({ ...t, originatorId: e.target.value }))} className="px-2 py-1.5 text-xs" />
                <input id={`travel-purpose-${r.id}`} required placeholder="Purpose, e.g. family support" value={travel.purpose} onChange={(e) => setTravel((t) => ({ ...t, purpose: e.target.value }))} className="px-2 py-1.5 text-xs" />
                <div className="flex gap-1">
                  <Button className="!px-2 !py-1" kind="primary" type="submit">Save</Button>
                  <Button className="!px-2 !py-1" kind="quiet" type="button" onClick={() => setTravelOpen(false)}>Cancel</Button>
                </div>
                <span className="text-[10px] text-muted">Kept off chain and out of the shared log.</span>
              </form>
            )}
          </div>
        ) : (
          <span className="text-xs capitalize text-muted">{r.decision}</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="grid gap-1">
          {r.decision === 'pay' ? <StatePill state={r.state} /> : <span className="text-xs text-muted">Not paid</span>}
          {r.reason && <span className="text-xs text-stop">{REASONS[r.reason] ?? r.reason}</span>}
          <TxLink hash={r.txn_hash} />
          {r.request_id && <span title={`Request ${r.request_id}${r.trace_id ? `\nGasFree trace ${r.trace_id}` : ''}`} className="font-mono text-[11px] text-muted">req {r.request_id.slice(0, 8)}</span>}
          {r.fee != null && <span className="num font-mono text-[11px] text-muted">fee {usdt(r.fee)}</span>}
          {r.error && r.state !== 'SUCCEED' && <span className="max-w-48 text-[11px] break-words text-warn">{r.error}</span>}
          {r.travel && <span className="text-[11px] text-celadon">Travel Rule details recorded</span>}
          {r.receipt_token && (
            <span className="flex items-center gap-1.5">
              <a href={`/r/${r.receipt_token}`} target="_blank" rel="noopener" className="text-[11px] text-celadon hover:underline">Family receipt ↗</a>
              <Copy text={`${window.location.origin}/r/${r.receipt_token}`} />
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

// Maker-checker: the operator prepares the batch, the owner signs the exact rows and total before anything is paid.
function OwnerApproval({ view, reload }: { view: BatchView; reload: () => void }) {
  const { batch, approvalProblem, rows } = view;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pay = rows.filter((r) => r.decision === 'pay');
  const total = pay.reduce((s, r) => s + (r.amount ?? 0), 0);
  const a = batch.approval;
  const approved = !!a && !approvalProblem;
  const canApprove = batch.status === 'REVIEW' || batch.status === 'PAUSED';

  const approve = async (how: 'tronlink' | 'server') => {
    setBusy(how);
    setError(null);
    try {
      const body = how === 'server'
        ? { serverSign: true }
        : await signWithTronLink(await api<TypedDraft>(`/api/batches/${batch.id}/approval-draft`, { json: {} }));
      await api(`/api/batches/${batch.id}/approve`, { json: body });
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!approved && !canApprove) return null;
  return (
    <Card
      eyebrow="Maker and checker · TIP-712"
      title={approved ? 'Approved by the owner' : 'Waiting for the owner’s approval'}
      action={!approved && canApprove && (
        <div className="flex flex-wrap gap-2">
          <Button kind="primary" busy={busy === 'tronlink'} disabled={!pay.length} onClick={() => approve('tronlink')}>Approve in TronLink ↗</Button>
          <Button kind="secondary" busy={busy === 'server'} disabled={!pay.length} onClick={() => approve('server')}>Approve with demo owner key</Button>
        </div>
      )}
    >
      <div className="grid gap-3">
        <ErrorLine error={error} />
        {busy === 'tronlink' && <WaitingForTronLink />}
        {approved ? (
          <p className="text-[13px] text-muted">
            <Addr a={a!.owner} /> approved <b className="text-ink">{a!.value.count} payments, {usdt(Number(a!.value.total))} USDT</b> on {when(a!.at)}, {a!.signedBy === 'server-demo-key' ? 'with the demo owner key' : 'in TronLink'}. Changing any row clears this approval.
          </p>
        ) : (
          <>
            {approvalProblem && batch.approval && <Callout tone="warn">{approvalProblem}</Callout>}
            <p className="text-[13px] text-muted">
              The operator prepared <b className="text-ink">{pay.length} payments, {usdt(total)} USDT</b>. Nothing is paid until the owner who signed the payment limits signs these exact rows. The signature is checked again by the auditor script.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

// What the same payouts would cost through a bank, against GasFree's flat fee per transfer.
function Savings({ view }: { view: BatchView }) {
  const { summary, rows } = view;
  const done = summary.amountPaid > 0;
  const pay = rows.filter((r) => r.decision === 'pay' && r.state !== 'REFUSED' && r.state !== 'FAILED');
  const amount = done ? summary.amountPaid : pay.reduce((s, r) => s + (r.amount ?? 0), 0);
  const fees = done ? summary.fees : pay.length * GASFREE_FEE;
  if (!amount) return null;
  const bank = Math.round(amount * BANK_FEE_RATE);
  const saved = bank - fees;
  const breakEven = GASFREE_FEE / BANK_FEE_RATE;
  return (
    <Card eyebrow={done ? 'Compared with a bank' : 'Estimate before paying'} title={saved >= 0 ? `${usdt(saved)} USDT less than a bank` : 'A bank is cheaper at these test amounts'}>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-4">
          <Stat label={done ? 'Sent' : 'To send'} value={usdt(amount)} />
          <Stat label="Bank at 5.15%" value={usdt(bank)} tone="warn" />
          <Stat label={done ? 'GasFree fees paid' : 'GasFree fees'} value={usdt(fees)} tone="ok" />
          <Stat label="Families receive" value="100%" tone="ok" />
        </div>
        <p className="text-[11px] leading-relaxed text-muted">
          5.15% is the average cost of sending money from Korea to Vietnam through banks and remittance firms. GasFree charges a flat {usdt(GASFREE_FEE)} USDT per transfer from the sender’s account (a new account also pays 1.00 USDT once to activate), so each family gets the full amount and needs no TRX. The flat fee is cheaper for any transfer above {usdt(breakEven)} USDT; on a 300 USDT transfer a bank takes {usdt(300_000_000 * BANK_FEE_RATE)} USDT.
        </p>
      </div>
    </Card>
  );
}

function PrecheckPanel({ p }: { p: Precheck }) {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Rows to pay" value={p.count} />
        <Stat label="Amount" value={usdt(p.amount)} />
        <Stat label="Transfer fees" value={usdt(p.transferFees)} />
        <Stat label="Activation fee" value={usdt(p.activation)} />
        <Stat label="Total" value={usdt(p.total)} tone={p.total > p.balance - p.frozen ? 'stop' : 'ok'} />
        <Stat label="Budget left" value={usdt(p.remaining)} tone={p.total > p.remaining ? 'warn' : undefined} />
      </div>
      <dl className="grid gap-x-6 gap-y-2 border-t border-line pt-4 text-[13px] sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">GasFree payer</dt>
        <dd><Addr a={p.payer} full /></dd>
        <dt className="text-muted">GasFree address</dt>
        <dd className="flex flex-wrap items-center gap-2"><Addr a={p.gasFreeAddress} full /><Copy text={p.gasFreeAddress} /><span className="text-xs text-muted">send test USDT here</span></dd>
        <dt className="text-muted">Balance</dt>
        <dd className="num font-mono">{usdt(p.balance)} {p.token.symbol}{p.frozen ? ` · ${usdt(p.frozen)} pending` : ''}</dd>
        <dt className="text-muted">Token</dt>
        <dd>{p.token.symbol} <Addr a={p.token.address} /> · fee {usdt(p.token.transferFee)} per transfer, {usdt(p.token.activateFee)} once to activate</dd>
        <dt className="text-muted">Account</dt>
        <dd>{p.active ? 'Active' : 'Not active yet. The first transfer pays the activation fee.'} · nonce {p.nonce} · {p.allowSubmit ? 'accepting transfers' : 'not accepting transfers'}</dd>
        <dt className="text-muted">Service provider</dt>
        <dd>{p.provider.name} <Addr a={p.provider.address} /></dd>
      </dl>
      {p.problems.map((x) => <ErrorLine key={x} error={x} />)}
      {p.warnings.map((x) => <Callout key={x} tone="warn">{x}</Callout>)}
    </div>
  );
}

export default function BatchPage() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<BatchView | null>(null);
  const [pre, setPre] = useState<Precheck | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; output: string; tampered: boolean } | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [question, setQuestion] = useState('Was every payment inside the signed policy?');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api<BatchView>(`/api/batches/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  const live = view?.running || view?.batch.status === 'RUNNING';
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [live, load]);

  const act = async <T,>(name: string, body: object = {}, after?: (r: T) => void) => {
    setBusy(name);
    setError(null);
    try {
      const r = await api<T>(`/api/batches/${id}/${name}`, { json: body });
      after?.(r);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!view) return <div className="grid gap-3 py-10"><ErrorLine error={error} /><p className="text-muted">Loading batch…</p></div>;
  const { batch, rows, summary, events, policy } = view;
  const review = batch.status === 'REVIEW';
  const flagged = rows.filter((r) => r.flags.length).length;

  return (
    <div className="grid gap-[18px]">
      <section className="flex flex-wrap items-end justify-between gap-6 pt-9 pb-7 sm:pt-12">
        <div className="min-w-0">
          <Link href="/" className="eyebrow hover:text-celadon">← Payout desk</Link>
          <h1 className="mt-4 text-[34px] leading-[1.08] font-[450] tracking-[-0.05em] sm:text-[44px]">
            Batch #{batch.id} <em className="text-celadon not-italic">{live ? 'paying' : STATUS_WORD[batch.status] ?? batch.status.toLowerCase()}</em>
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="font-mono">{batch.source}</span>
            <span>{MAPPED_BY[batch.mapped_by] ?? batch.mapped_by}</span>
            {policy && <span>Governed by policy #{policy.id}</span>}
          </p>
        </div>
        <StatePill state={live ? 'RUNNING' : batch.status} />
      </section>

      <div className="grid grid-cols-3 gap-y-4 rounded-xl border border-line bg-surface px-5 py-5 sm:grid-cols-7 sm:px-6">
        <Stat label="Rows" value={summary.total} />
        <Stat label="To pay" value={summary.ready + summary.awaiting} />
        <Stat label="Held" value={summary.held} tone={summary.held ? 'warn' : undefined} />
        <Stat label="Paid" value={summary.paid} tone={summary.paid ? 'ok' : undefined} />
        <Stat label="Refused" value={summary.refused} tone={summary.refused ? 'stop' : undefined} />
        <Stat label="Failed" value={summary.failed} tone={summary.failed ? 'stop' : undefined} />
        <Stat label="Paid USDT" value={usdt(summary.amountPaid)} />
      </div>

      <ErrorLine error={error} />

      <div className="flex flex-wrap items-center gap-2">
        {review && <Button kind="secondary" busy={busy === 'review'} disabled={!flagged} onClick={() => act('review')}>Explain {flagged} flagged rows with AI ↗</Button>}
        {review && <Button kind="quiet" busy={busy === 'recheck'} onClick={() => act('recheck')}>Run checks again</Button>}
        {batch.status !== 'CLOSED' && <Button kind="secondary" busy={busy === 'precheck'} onClick={() => act<Precheck>('precheck', {}, setPre)}>Pre-check balance and fees</Button>}
        {(review || batch.status === 'PAUSED') && !live && (
          <Button kind="primary" busy={busy === 'run'} disabled={summary.ready + summary.awaiting === 0 || !!view.approvalProblem} title={view.approvalProblem ?? undefined} onClick={() => act('run')}>
            Pay {summary.ready + summary.awaiting} rows →
          </Button>
        )}
        {batch.status === 'PAUSED' && !live && <Button kind="secondary" busy={busy === 'recover'} onClick={() => act('recover')}>Recover unknown payments</Button>}
        {live && (
          <Button
            kind="danger"
            busy={busy === 'stop'}
            onClick={async () => {
              setBusy('stop');
              try {
                await api('/api/policy/stop', { json: {} });
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
          >
            Stop all payments
          </Button>
        )}
        {batch.status === 'CLOSED' && <Button kind="secondary" busy={busy === 'receipt'} onClick={() => act('receipt')}>Write receipt with AI ↗</Button>}
        <span className="flex gap-2 sm:ml-auto">
          <a href={`/api/batches/${batch.id}/export?format=csv`} className={LINK_BUTTON}>Export CSV ↓</a>
          <a href={`/api/batches/${batch.id}/export`} className={LINK_BUTTON}>Export evidence ↓</a>
        </span>
      </div>

      <OwnerApproval view={view} reload={load} />
      <Savings view={view} />

      {pre && <Card eyebrow="GasFree account" title="Pre-check" action={<button type="button" className="text-xs text-celadon hover:underline" onClick={() => setPre(null)}>Hide</button>}><PrecheckPanel p={pre} /></Card>}

      <Card eyebrow="Screened in code" title={`Rows · ${flagged} flagged`} className="overflow-hidden">
        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full min-w-[68rem] border-collapse text-left [&_tr>*:first-child]:pl-5 sm:[&_tr>*:first-child]:pl-6 [&_tr>*:last-child]:pr-5">
            <thead className="border-y border-line font-mono text-[9px] tracking-[0.1em] text-muted uppercase">
              <tr>
                <th className="px-3 py-2.5 font-normal">Line</th>
                <th className="px-3 py-2.5 font-normal">Recipient</th>
                <th className="px-3 py-2.5 font-normal">Wallet</th>
                <th className="px-3 py-2.5 text-right font-normal">USDT</th>
                <th className="px-3 py-2.5 font-normal">Note</th>
                <th className="px-3 py-2.5 font-normal">Checks</th>
                <th className="px-3 py-2.5 font-normal">Decision</th>
                <th className="px-3 py-2.5 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <RowLine key={`${r.id}-${r.receiver}-${r.amount}`} r={r} editable={review} onSaved={load} setError={setError} />)}
            </tbody>
          </table>
        </div>
      </Card>

      {batch.receipt && (
        <Card eyebrow="Written by Kiln" title="Receipt for the owner">
          <div className="grid gap-2 text-[13px] leading-relaxed"><p>{batch.receipt.ko}</p><p className="text-muted">{batch.receipt.en}</p></div>
        </Card>
      )}

      <div className="grid items-start gap-[18px] lg:grid-cols-2">
        <Card
          eyebrow="Anyone can check"
          title="Independent audit"
          action={
            <div className="flex gap-2">
              <Button kind="secondary" busy={busy === 'verify'} onClick={() => act('verify', {}, setVerify)}>Run verify</Button>
              <Button kind="quiet" busy={busy === 'verify-t'} onClick={async () => { setBusy('verify-t'); try { setVerify(await api(`/api/batches/${id}/verify`, { json: { tamper: true } })); } catch (e) { setError((e as Error).message); } finally { setBusy(null); } }}>Verify a tampered copy</Button>
            </div>
          }
        >
          <div className="grid gap-3">
            <p className="text-xs leading-relaxed text-muted">Runs <span className="font-mono">backend/scripts/verify.mjs</span> on a fresh evidence export. It uses only that file and the Nile chain, and re-checks the owner’s signature, the hash chain, every payment and every refusal.</p>
            {verify && (
              <pre className={`max-h-96 overflow-auto rounded-md border bg-sunken p-3 font-mono text-[11px] leading-relaxed ${verify.ok ? 'border-ok/30 text-[#c6d6bf]' : 'border-stop/40 text-stop'}`}>
                {verify.tampered ? '# Tampered copy: one paid amount was raised by 1 USDT\n' : ''}
                {verify.output}
              </pre>
            )}
          </div>
        </Card>
        <Card eyebrow="Kiln · gpt-oss-120b" title="Ask the auditor AI">
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); act<{ answer: string }>('ask', { question }, (r) => setAnswer(r.answer)); }}>
            <textarea id="question" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} className="px-3 py-2.5 text-[13px]" />
            <div><Button kind="primary" busy={busy === 'ask'} type="submit">Ask →</Button></div>
            {answer && <Callout><span className="whitespace-pre-wrap">{answer}</span></Callout>}
            <p className="text-[11px] text-muted">The answer cites event numbers from the journal below.</p>
          </form>
        </Card>
      </div>

      <Card eyebrow="Observable evidence" title="Execution journal" action={<span className="font-mono text-[11px] text-muted">{events.length} events</span>}>
        <div className="grid gap-3">
          <p className="text-xs leading-relaxed text-muted">Each event’s hash covers the previous one, so changing any past entry breaks every later hash. {batch.anchor_tx && <>The closing hash is sealed on chain: <TxLink hash={batch.anchor_tx} /></>}</p>
          <ol className="max-h-[480px] overflow-auto">
            {[...events].reverse().map((e) => (
              <li key={e.id} className="flex items-start gap-3 border-b border-[#26372c] py-2.5 text-xs">
                <time className="num shrink-0 pt-0.5 font-mono text-[10px] text-[#718b78]">{new Date(e.ts).toLocaleTimeString('ko-KR')}</time>
                <span className="min-w-0 flex-1">
                  <span className={`font-mono ${EVENT_TONE(e.type)}`}>#{e.id} {e.type}</span>
                  <small className="mt-0.5 block font-mono text-[10px] break-all text-muted">{JSON.stringify(e.data)}</small>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[#718b78]">{e.hash.slice(0, 10)}</span>
              </li>
            ))}
          </ol>
        </div>
      </Card>
    </div>
  );
}
