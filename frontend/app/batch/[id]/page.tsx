'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, usdt, FLAGS, REASONS, type BatchView, type Precheck, type Row } from '../../lib';
import { Addr, Button, Card, Copy, ErrorLine, FlagChip, StatePill, Stat, TxLink } from '../../ui';

const MAPPED_BY: Record<string, string> = { kiln: 'Columns mapped by Kiln (gpt-oss-120b)', cache: 'Columns mapped from cache (0 tokens)', rules: 'Columns mapped by header rules' };

function RowLine({ r, editable, onSaved, setError }: { r: Row; editable: boolean; onSaved: () => void; setError: (e: string | null) => void }) {
  const [edit, setEdit] = useState(false);
  const [wallet, setWallet] = useState(r.receiver);
  const [amount, setAmount] = useState(r.amount != null ? String(r.amount / 1e6) : r.amount_raw ?? '');
  const blocking = r.flags.some((f) => FLAGS[f]?.blocking);

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
    <tr className={`align-top ${r.decision !== 'pay' ? 'bg-paper/60' : ''}`}>
      <td className="num px-3 py-2 font-mono text-xs text-muted">{r.line}</td>
      <td className="px-3 py-2">
        <div className="text-sm">{r.name || '–'}</div>
        <div className="text-xs text-muted">from {r.sender || '–'}</div>
      </td>
      <td className="px-3 py-2">
        {edit ? (
          <input id={`wallet-${r.id}`} value={wallet} onChange={(e) => setWallet(e.target.value)} className="w-80 rounded border border-line px-1.5 py-1 font-mono text-xs" />
        ) : (
          <Addr a={r.receiver} />
        )}
      </td>
      <td className="num px-3 py-2 text-right font-mono text-sm whitespace-nowrap">
        {edit ? <input id={`amount-${r.id}`} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-20 rounded border border-line px-1.5 py-1 text-right font-mono text-xs" /> : r.amount != null ? usdt(r.amount) : <span className="text-stop">{r.amount_raw || '–'}</span>}
      </td>
      <td className="max-w-40 px-3 py-2 text-xs">{r.note}</td>
      <td className="max-w-md min-w-56 px-3 py-2">
        <div className="flex flex-wrap gap-1">{r.flags.length ? r.flags.map((f) => <FlagChip key={f} flag={f} />) : <span className="text-xs text-ok">All checks passed</span>}</div>
        {r.agent && (
          <div className="mt-1.5 grid gap-0.5 border-l-2 border-celadon/40 pl-2 text-xs">
            <span>{r.agent.ko}</span>
            <span className="text-muted">{r.agent.en}</span>
            <span className="font-medium text-celadon">AI suggests: {r.agent.action === 'pay' ? 'pay' : r.agent.action === 'fix' ? 'fix the data' : 'hold'}</span>
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {editable ? (
          <div className="grid gap-1.5">
            <div className="inline-flex overflow-hidden rounded-md border border-line text-xs">
              {(['pay', 'hold', 'remove'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={d === 'pay' && blocking}
                  onClick={() => patch({ decision: d })}
                  className={`px-2 py-1 capitalize disabled:cursor-not-allowed disabled:opacity-35 ${r.decision === d ? (d === 'pay' ? 'bg-celadon text-white' : d === 'hold' ? 'bg-warn/15 text-warn' : 'bg-stop/10 text-stop') : 'bg-surface hover:bg-paper'}`}
                >
                  {d}
                </button>
              ))}
            </div>
            {edit ? (
              <div className="flex gap-1">
                <Button className="!px-2 !py-0.5 text-xs" kind="primary" onClick={() => patch({ receiver: wallet, amount })}>Save</Button>
                <Button className="!px-2 !py-0.5 text-xs" onClick={() => setEdit(false)}>Cancel</Button>
              </div>
            ) : (
              <button type="button" onClick={() => setEdit(true)} className="text-left text-xs text-celadon hover:underline">Edit wallet or amount</button>
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
          {r.fee != null && <span className="num font-mono text-[11px] text-muted">fee {usdt(r.fee)}</span>}
          {r.error && r.state !== 'SUCCEED' && <span className="max-w-48 text-[11px] break-words text-warn">{r.error}</span>}
        </div>
      </td>
    </tr>
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
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
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
      {p.warnings.map((x) => <p key={x} className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-warn">{x}</p>)}
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

  if (!view) return <div className="grid gap-3"><ErrorLine error={error} /><p className="text-muted">Loading batch…</p></div>;
  const { batch, rows, summary, events, policy } = view;
  const review = batch.status === 'REVIEW';
  const flagged = rows.filter((r) => r.flags.length).length;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-muted hover:text-celadon">← Console</Link>
        <h1 className="text-2xl font-bold">Batch #{batch.id}</h1>
        <span className="text-muted">{batch.source}</span>
        <StatePill state={live ? 'RUNNING' : batch.status} />
        <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{MAPPED_BY[batch.mapped_by] ?? batch.mapped_by}</span>
      </div>

      <div className="grid grid-cols-3 gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-7">
        <Stat label="Rows" value={summary.total} />
        <Stat label="To pay" value={summary.ready + summary.awaiting} />
        <Stat label="Held" value={summary.held} tone={summary.held ? 'warn' : undefined} />
        <Stat label="Paid" value={summary.paid} tone={summary.paid ? 'ok' : undefined} />
        <Stat label="Refused" value={summary.refused} tone={summary.refused ? 'stop' : undefined} />
        <Stat label="Failed" value={summary.failed} tone={summary.failed ? 'stop' : undefined} />
        <Stat label="Paid USDT" value={usdt(summary.amountPaid)} />
      </div>

      <ErrorLine error={error} />

      <div className="flex flex-wrap gap-2">
        {review && <Button busy={busy === 'review'} disabled={!flagged} onClick={() => act('review')}>Explain {flagged} flagged rows with AI</Button>}
        {batch.status !== 'CLOSED' && <Button busy={busy === 'precheck'} onClick={() => act<Precheck>('precheck', {}, setPre)}>Pre-check balance and fees</Button>}
        {(review || batch.status === 'PAUSED') && !live && (
          <Button kind="primary" busy={busy === 'run'} disabled={summary.ready + summary.awaiting === 0} onClick={() => act('run')}>
            Pay {summary.ready + summary.awaiting} approved rows
          </Button>
        )}
        {batch.status === 'PAUSED' && !live && <Button busy={busy === 'recover'} onClick={() => act('recover')}>Recover unknown payments</Button>}
        <a href={`/api/batches/${batch.id}/export?format=csv`} className="inline-flex items-center rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-celadon">Export CSV</a>
        <a href={`/api/batches/${batch.id}/export`} className="inline-flex items-center rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-celadon">Export evidence</a>
        {batch.status === 'CLOSED' && <Button busy={busy === 'receipt'} onClick={() => act('receipt')}>Write receipt with AI</Button>}
      </div>

      {pre && <Card title="Pre-check" action={<button type="button" className="text-xs text-muted hover:text-ink" onClick={() => setPre(null)}>Hide</button>}><PrecheckPanel p={pre} /></Card>}

      <Card title={`Rows · ${flagged} flagged`} className="overflow-hidden">
        <div className="-m-4 overflow-x-auto">
          <table className="w-full min-w-[68rem] border-collapse text-left">
            <thead className="bg-paper text-[11px] tracking-wide text-muted uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Line</th>
                <th className="px-3 py-2 font-medium">Recipient</th>
                <th className="px-3 py-2 font-medium">Wallet</th>
                <th className="px-3 py-2 text-right font-medium">USDT</th>
                <th className="px-3 py-2 font-medium">Note</th>
                <th className="px-3 py-2 font-medium">Checks</th>
                <th className="px-3 py-2 font-medium">Decision</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => <RowLine key={`${r.id}-${r.receiver}-${r.amount}`} r={r} editable={review} onSaved={load} setError={setError} />)}
            </tbody>
          </table>
        </div>
      </Card>

      {batch.receipt && (
        <Card title="Receipt for the owner">
          <div className="grid gap-2 text-sm"><p>{batch.receipt.ko}</p><p className="text-muted">{batch.receipt.en}</p></div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Independent audit"
          action={
            <div className="flex gap-2">
              <Button busy={busy === 'verify'} onClick={() => act('verify', {}, setVerify)}>Run verify</Button>
              <Button busy={busy === 'verify-t'} onClick={async () => { setBusy('verify-t'); try { setVerify(await api(`/api/batches/${id}/verify`, { json: { tamper: true } })); } catch (e) { setError((e as Error).message); } finally { setBusy(null); } }}>Verify a tampered copy</Button>
            </div>
          }
        >
          <div className="grid gap-3">
            <p className="text-sm text-muted">Runs <span className="font-mono">backend/scripts/verify.mjs</span> on a fresh evidence export. It uses only that file and the Nile chain, and re-checks the owner’s signature, the hash chain, every payment and every refusal.</p>
            {verify && (
              <pre className={`max-h-96 overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed ${verify.ok ? 'border-ok/30 bg-ok/5' : 'border-stop/30 bg-stop/5'}`}>
                {verify.tampered ? '# Tampered copy: one paid amount was raised by 1 USDT\n' : ''}
                {verify.output}
              </pre>
            )}
          </div>
        </Card>
        <Card title="Ask the auditor AI">
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); act<{ answer: string }>('ask', { question }, (r) => setAnswer(r.answer)); }}>
            <textarea id="question" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} className="rounded-md border border-line px-2 py-1.5 text-sm" />
            <div><Button kind="primary" busy={busy === 'ask'} type="submit">Ask</Button></div>
            {answer && <p className="rounded-md bg-celadon-soft px-3 py-2 text-sm whitespace-pre-wrap">{answer}</p>}
            <p className="text-xs text-muted">The answer cites event numbers from the log below.</p>
          </form>
        </Card>
      </div>

      <Card title={`Event log · ${events.length} events`}>
        <div className="grid gap-2 text-xs text-muted">
          <p>Each event’s hash covers the previous hash, so changing any past entry breaks every later one. {policy ? `Governed by policy #${policy.id}.` : ''} {batch.anchor_tx && <>Batch sealed on chain <TxLink hash={batch.anchor_tx} />.</>}</p>
          <div className="max-h-96 overflow-auto rounded-md border border-line">
            <table className="w-full min-w-[40rem] text-left">
              <tbody className="divide-y divide-line">
                {[...events].reverse().map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="num px-2 py-1 font-mono">#{e.id}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{new Date(e.ts).toLocaleTimeString('ko-KR')}</td>
                    <td className="px-2 py-1 font-mono font-medium text-ink">{e.type}</td>
                    <td className="px-2 py-1 font-mono break-all">{JSON.stringify(e.data)}</td>
                    <td className="px-2 py-1 font-mono">{e.hash.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
}
