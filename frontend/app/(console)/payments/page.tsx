'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, usdt, when, REASONS } from '../../lib';
import { Addr, Card, ErrorLine, Stat, StatePill, TxLink } from '../../ui';

type Payment = {
  id: number; batchId: number; name: string | null; receiver: string; city: string | null; country: string | null;
  amount: number | null; fee: number | null; state: string; reason: string | null; txnHash: string | null;
  atMs: number | null; receiptToken: string | null; confirmed: { at: number; city: string | null } | null;
};

const LINK_BUTTON = 'inline-flex items-center rounded-[7px] border border-line px-3.5 py-2.5 text-xs font-semibold text-[#c8d1c7] transition hover:bg-raised';

// Every payment across all batches, newest first. Paid, in flight, refused and failed, each with its proof on chain.
export default function PaymentsPage() {
  const [list, setList] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Payment[]>('/api/payments').then(setList).catch((e) => setError(e.message));
  }, []);
  const paid = list?.filter((p) => p.state === 'SUCCEED') ?? [];
  const sum = (ps: Payment[], k: 'amount' | 'fee') => ps.reduce((s, p) => s + (p[k] ?? 0), 0);

  return (
    <div className="grid gap-[18px] pb-2">
      <section className="pt-9 pb-4 sm:pt-[54px]">
        <div className="eyebrow">Every batch · newest first</div>
        <h1 className="my-[18px] text-[38px] leading-[1.08] font-[450] tracking-[-0.05em] text-balance sm:text-[clamp(34px,3.7vw,52px)]">
          Payment history.<br /><em className="text-celadon not-italic">Paid, refused and failed.</em>
        </h1>
        <p className="max-w-[64ch] text-[13px] leading-[1.8] text-muted">
          Every payment Ansim sent or refused, across all batches. Each paid row links to its transfer on TronScan and to the family’s receipt. Drafts and rows held back are not listed, since nothing was sent.
        </p>
      </section>
      <ErrorLine error={error} />
      {!list && !error && <p className="text-muted">Loading…</p>}
      {list && (
        <>
          <div className="grid grid-cols-2 gap-y-4 rounded-xl border border-line bg-surface px-5 py-5 sm:grid-cols-3 lg:grid-cols-5 sm:px-6">
            <Stat label="Paid USDT" value={usdt(sum(paid, 'amount'))} tone="ok" />
            <Stat label="GasFree fees" value={usdt(sum(paid, 'fee'))} />
            <Stat label="Payments" value={paid.length} />
            <Stat label="Families" value={new Set(paid.map((p) => p.receiver)).size} />
            <Stat label="Refused or failed" value={list.filter((p) => p.state === 'REFUSED' || p.state === 'FAILED').length} tone="warn" />
          </div>

          <Card
            eyebrow="From the hash-chained log"
            title={`${list.length} ${list.length === 1 ? 'payment' : 'payments'}`}
            className="overflow-hidden"
            action={list.length > 0 && <a href="/api/payments?format=csv" className={LINK_BUTTON}>Export CSV ↓</a>}
          >
            {list.length === 0 ? (
              <p className="text-xs text-muted">No payments yet. Approve and pay a batch from the payout desk.</p>
            ) : (
              <div className="-mx-5 overflow-x-auto sm:-mx-6">
                <table className="w-full min-w-[66rem] border-collapse text-left text-[13px] [&_tr>*:first-child]:pl-5 sm:[&_tr>*:first-child]:pl-6 [&_tr>*:last-child]:pr-5">
                  <thead className="border-y border-line font-mono text-[9px] tracking-[0.1em] text-muted uppercase">
                    <tr>
                      {['When', 'Recipient', 'Wallet', 'USDT', 'Fee', 'Status', 'Transaction', 'Batch', 'Receipt', 'Family'].map((h) => (
                        <th key={h} className={`px-3 py-2.5 font-normal ${h === 'USDT' || h === 'Fee' ? 'text-right' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p) => (
                      <tr key={p.id} className="border-b border-line/60 align-top last:border-0">
                        <td className="px-3 py-3 whitespace-nowrap text-muted">{p.atMs ? when(p.atMs / 1000) : '–'}</td>
                        <td className="px-3 py-3">
                          <div>{p.name ?? '–'}</div>
                          {(p.city || p.country) && <div className="text-[11px] text-muted">{[p.city, p.country].filter(Boolean).join(', ')}</div>}
                        </td>
                        <td className="px-3 py-3"><Addr a={p.receiver} /></td>
                        <td className="num px-3 py-3 text-right">{usdt(p.amount)}</td>
                        <td className="num px-3 py-3 text-right text-muted">{p.state === 'SUCCEED' ? usdt(p.fee) : '–'}</td>
                        <td className="px-3 py-3">
                          <StatePill state={p.state} />
                          {p.reason && p.state !== 'SUCCEED' && <div className="mt-1 text-[11px] text-warn">{REASONS[p.reason] ?? p.reason}</div>}
                        </td>
                        <td className="px-3 py-3"><TxLink hash={p.txnHash} /></td>
                        <td className="px-3 py-3"><Link href={`/batch/${p.batchId}`} className="font-mono text-xs text-celadon hover:underline">#{p.batchId}</Link></td>
                        <td className="px-3 py-3 text-[11px] whitespace-nowrap">
                          {p.state === 'SUCCEED' && p.txnHash ? (
                            <a href={`/api/payments/${p.id}/receipt`} className="text-celadon hover:underline">Download ↓</a>
                          ) : (
                            <span className="text-muted">–</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-[11px]">
                          {p.confirmed && <div className="text-celadon">✓ Received{p.confirmed.city ? ` · ${p.confirmed.city}` : ''}</div>}
                          {p.state === 'SUCCEED' && p.receiptToken ? (
                            <a href={`/r/${p.receiptToken}`} target="_blank" rel="noopener" className="text-muted hover:text-celadon hover:underline">Family page ↗</a>
                          ) : (
                            !p.confirmed && <span className="text-muted">–</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
