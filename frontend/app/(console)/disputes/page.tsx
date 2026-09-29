'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, usdt, when, REASONS } from '../../lib';
import { Addr, Button, Callout, Card, ErrorLine, FlagChip, StatePill, TxLink } from '../../ui';

type Payment = {
  id: number; batchId: number; batchCreated: number; line: number; sender: string | null; name: string | null; receiver: string;
  amount: number | null; note: string | null; flags: string[]; decision: string; state: string; reason: string | null;
  txnHash: string | null; fee: number | null; receiptToken: string | null;
  events: { id: number; ts: number; type: string; data: Record<string, unknown> }[];
};
type Proof = { found: false } | { found: true; success: boolean; block: number; time: number; transfers: { from: string; to: string; value: number }[] };

// What the chain says about one transaction, fetched when the operator asks for it.
function ChainProof({ p }: { p: Payment }) {
  const [proof, setProof] = useState<Proof | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!p.txnHash) return null;
  if (!proof) {
    return (
      <div className="grid gap-1">
        <button type="button" className="w-fit text-xs text-celadon hover:underline" onClick={() => api<Proof>(`/api/chain/${p.txnHash}`).then(setProof).catch((e) => setError(e.message))}>
          Check on chain →
        </button>
        <ErrorLine error={error} />
      </div>
    );
  }
  if (!proof.found) return <p className="text-xs text-stop">The chain has no transaction with this hash.</p>;
  const toFamily = proof.transfers.find((t) => t.to === p.receiver);
  return (
    <div className="grid gap-1 rounded-md border border-[#26382c] bg-sunken px-3 py-2.5 font-mono text-[11px]">
      <span className={proof.success && toFamily ? 'text-celadon' : 'text-stop'}>
        {proof.success ? (toFamily ? `Arrived: ${usdt(toFamily.value)} USDT to the family’s wallet` : 'Succeeded, but not to the family’s wallet') : 'The transaction failed on chain'}
      </span>
      <span className="text-muted">Block {proof.block} · {new Date(proof.time).toLocaleString('ko-KR')}</span>
      {proof.transfers.map((t, i) => (
        <span key={i} className="text-muted">{usdt(t.value)} USDT → {t.to === p.receiver ? 'family' : 'GasFree fee'} <Addr a={t.to} /></span>
      ))}
    </div>
  );
}

export default function DisputesPage() {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ q: string; payments: Payment[] } | null>(null);
  const [question, setQuestion] = useState('My family says the money did not arrive. Did it?');
  const [answer, setAnswer] = useState<{ ko: string; en: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy('search');
    setError(null);
    setAnswer(null);
    try {
      setFound({ q, payments: await api<Payment[]>(`/api/disputes?q=${encodeURIComponent(q)}`) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const ask = async () => {
    if (!found) return;
    setBusy('ask');
    setError(null);
    try {
      setAnswer(await api<{ ko: string; en: string }>('/api/disputes/ask', { json: { q: found.q, question } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-[18px] pb-2">
      <section className="pt-9 pb-4 sm:pt-[54px]">
        <div className="eyebrow flex items-center gap-2.5"><span className="pulse" />Dispute desk</div>
        <h1 className="my-[18px] text-[38px] leading-[1.08] font-[450] tracking-[-0.05em] text-balance sm:text-[clamp(34px,3.7vw,52px)]">
          “My family didn’t get it.”<br /><em className="text-celadon not-italic">Answer from the records.</em>
        </h1>
        <p className="max-w-[64ch] text-[13px] leading-[1.8] text-muted">
          Find a payment by the sender’s or recipient’s name, the note, the wallet or the transaction hash. Every answer comes from the hash-chained log and the TRON chain, not from memory.
        </p>
      </section>

      <Card eyebrow="Step 1" title="Find the payment">
        <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <input id="dispute-q" required minLength={2} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sender 1, Dummy 2, 9월 생활비, T… wallet or transaction hash" className="px-3 py-2.5 text-sm" />
          <Button kind="primary" type="submit" busy={busy === 'search'}>Search →</Button>
        </form>
      </Card>

      <ErrorLine error={error} />

      {found && (
        <Card eyebrow={`Step 2 · ${found.payments.length} ${found.payments.length === 1 ? 'match' : 'matches'}`} title={`Payments for “${found.q}”`}>
          {found.payments.length === 0 ? (
            <p className="text-xs text-muted">No payment matches. Try the sender’s name as written in the payout file, or the family’s wallet address.</p>
          ) : (
            <ol className="grid gap-3">
              {found.payments.map((p) => (
                <li key={p.id} className="grid gap-3 rounded-lg border border-line p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="grid content-start gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {p.decision === 'pay' ? <StatePill state={p.state} /> : <span className="font-mono text-[10px] text-muted uppercase">{p.decision}</span>}
                      <Link href={`/batch/${p.batchId}`} className="font-mono text-[11px] text-muted hover:text-celadon">Batch #{p.batchId} · line {p.line} · {when(p.batchCreated)}</Link>
                    </div>
                    <p className="text-[13px]">
                      <b>{p.sender || '–'}</b> → <b>{p.name || '–'}</b> · <span className="num">{usdt(p.amount)} USDT</span> {p.note && <span className="text-muted">· {p.note}</span>}
                    </p>
                    <Addr a={p.receiver} full />
                    {p.reason && <span className="text-xs text-stop">{REASONS[p.reason] ?? p.reason}</span>}
                    {p.flags.length > 0 && <div className="flex flex-wrap gap-1">{p.flags.map((f) => <FlagChip key={f} flag={f} />)}</div>}
                    <div className="flex flex-wrap items-center gap-3">
                      <TxLink hash={p.txnHash} />
                      {p.receiptToken && <a href={`/r/${p.receiptToken}`} target="_blank" rel="noopener" className="text-xs text-celadon hover:underline">Family receipt ↗</a>}
                    </div>
                    <ChainProof p={p} />
                  </div>
                  <ol className="grid content-start gap-1 border-t border-line pt-3 font-mono text-[10px] text-muted lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4">
                    {p.events.length === 0 && <li>No payment events yet.</li>}
                    {p.events.map((e) => (
                      <li key={e.id} className="flex gap-2">
                        <span className="shrink-0 text-[#718b78]">{new Date(e.ts).toLocaleTimeString('ko-KR')}</span>
                        <span className={/REFUSED|FAILED/.test(e.type) ? 'text-stop' : /RECOVERED/.test(e.type) || e.data.state === 'SUCCEED' ? 'text-celadon' : 'text-ink'}>#{e.id} {e.type}{typeof e.data.state === 'string' ? ` ${e.data.state}` : ''}</span>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {found && found.payments.length > 0 && (
        <Card eyebrow="Step 3 · gpt-oss-120b" title="Draft the answer">
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); ask(); }}>
            <textarea id="dispute-question" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} className="px-3 py-2.5 text-[13px]" />
            <div><Button kind="primary" type="submit" busy={busy === 'ask'}>Draft an answer in Korean and English →</Button></div>
            {answer && (
              <Callout>
                <span className="grid gap-2 whitespace-pre-wrap"><span>{answer.ko}</span><span className="text-muted">{answer.en}</span></span>
              </Callout>
            )}
            <p className="text-[11px] text-muted">The model sees only these payments, their log events and what the chain shows for each transaction. It cites event numbers so you can check every claim.</p>
          </form>
        </Card>
      )}
    </div>
  );
}
