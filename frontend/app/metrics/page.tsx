'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib';
import { Card, ErrorLine, Stat } from '../ui';

type Metrics = {
  model: string;
  flows: { flow: string; calls: number; prompt: number; completion: number; total: number; avg_ms: number; joules: number }[];
  rowsReviewed: { sent: number; total: number; skippedShare: number | null };
  joulesPerOutputToken: number;
};

const FLOW_INFO: Record<string, string> = {
  map_columns: 'Maps a new spreadsheet layout. Cached afterwards, so a repeat layout costs nothing.',
  review_flags: 'Explains all flagged rows of a batch in one call. Clean rows are never sent.',
  receipt: 'Writes the owner’s receipt once per finished batch.',
  audit_qa: 'Answers an auditor’s question from the records.',
};

export default function MetricsPage() {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Metrics>('/api/metrics').then(setM).catch((e) => setError(e.message));
  }, []);
  const sum = (k: 'calls' | 'prompt' | 'completion' | 'total' | 'joules') => m?.flows.reduce((s, f) => s + (f[k] ?? 0), 0) ?? 0;

  return (
    <div className="grid gap-[18px] pb-2">
      <section className="flex items-center justify-between gap-10 pt-9 pb-4 sm:pt-[54px]">
        <div className="min-w-0">
          <div className="eyebrow flex items-center gap-2.5"><span className="pulse" />FuriosaAI Kiln · RNGD NPU</div>
          <h1 className="my-[18px] text-[38px] leading-[1.08] font-[450] tracking-[-0.05em] text-balance sm:text-[clamp(34px,3.7vw,52px)]">
            Tokens and energy.<br /><em className="text-celadon not-italic">Only where code can’t decide.</em>
          </h1>
          <p className="max-w-[64ch] text-[13px] leading-[1.8] text-muted">Every Kiln call is logged under the flow that made it. Rules, limits and refusals run in code, so they cost no tokens.</p>
        </div>
      </section>
      <ErrorLine error={error} />
      {!m && !error && <p className="text-muted">Loading…</p>}
      {m && (
        <>
          <div className="grid grid-cols-2 gap-y-4 rounded-xl border border-line bg-surface px-5 py-5 sm:grid-cols-5 sm:px-6">
            <Stat label="Model" value={<span className="text-base">{m.model}</span>} />
            <Stat label="Calls" value={sum('calls')} />
            <Stat label="Tokens" value={sum('total').toLocaleString()} />
            <Stat label="Est. energy" value={`≤ ${sum('joules').toLocaleString()} J`} />
            <Stat label="Rows that skipped the model" value={m.rowsReviewed.skippedShare == null ? '–' : `${Math.round(m.rowsReviewed.skippedShare * 100)}%`} tone="ok" />
          </div>
          <Card eyebrow="Per flow" title="Where the tokens went">
            <div className="-mx-5 overflow-x-auto sm:-mx-6">
              <table className="w-full min-w-[44rem] border-collapse text-left text-[13px] [&_tr>*:first-child]:pl-5 sm:[&_tr>*:first-child]:pl-6 [&_tr>*:last-child]:pr-5 sm:[&_tr>*:last-child]:pr-6">
                <thead className="border-y border-line font-mono text-[9px] tracking-[0.1em] text-muted uppercase">
                  <tr>
                    <th className="px-3 py-2.5 font-normal">Flow</th>
                    <th className="px-3 py-2.5 text-right font-normal">Calls</th>
                    <th className="px-3 py-2.5 text-right font-normal">Prompt</th>
                    <th className="px-3 py-2.5 text-right font-normal">Output</th>
                    <th className="px-3 py-2.5 text-right font-normal">Avg ms</th>
                    <th className="px-3 py-2.5 text-right font-normal">Est. J</th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-b [&>tr]:border-[#2b3a30]">
                  {m.flows.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-xs text-muted">No Kiln calls yet. Import a file and press “Explain flagged rows with AI”.</td></tr>}
                  {m.flows.map((f) => (
                    <tr key={f.flow}>
                      <td className="px-3 py-2"><div className="font-mono">{f.flow}</div><div className="text-xs text-muted">{FLOW_INFO[f.flow]}</div></td>
                      <td className="num px-3 py-2 text-right font-mono">{f.calls}</td>
                      <td className="num px-3 py-2 text-right font-mono">{(f.prompt ?? 0).toLocaleString()}</td>
                      <td className="num px-3 py-2 text-right font-mono">{(f.completion ?? 0).toLocaleString()}</td>
                      <td className="num px-3 py-2 text-right font-mono">{f.avg_ms}</td>
                      <td className="num px-3 py-2 text-right font-mono">≤ {f.joules.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card eyebrow="Method note" title="How the energy estimate works">
            <div className="grid gap-3 text-[13px]">
              <p className="rounded-md border border-[#26382c] bg-sunken px-3.5 py-3 font-mono text-xs text-celadon">2 RNGD cards × 180 W × 5.8 ms ≈ {m.joulesPerOutputToken.toFixed(2)} J per output token</p>
              <p className="text-xs leading-relaxed text-muted">FuriosaAI reports gpt-oss-120b on two RNGD cards at 5.8 ms per output token, with each card well under 180 W. This is an upper bound: real power is lower and batching shares it across many requests. Prompt tokens are processed in parallel and are left out of the estimate.</p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
