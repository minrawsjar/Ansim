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
    <div className="grid gap-5">
      <div className="grid gap-2">
        <h1 className="text-2xl font-bold">Tokens and energy</h1>
        <p className="max-w-3xl text-muted">Every Kiln call is logged under the flow that made it. Rules, limits and refusals run in code, so they cost no tokens.</p>
      </div>
      <ErrorLine error={error} />
      {m && (
        <>
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-5">
            <Stat label="Model" value={<span className="text-base">{m.model}</span>} />
            <Stat label="Calls" value={sum('calls')} />
            <Stat label="Tokens" value={sum('total').toLocaleString()} />
            <Stat label="Est. energy" value={`≤ ${sum('joules').toLocaleString()} J`} />
            <Stat label="Rows that skipped the model" value={m.rowsReviewed.skippedShare == null ? '–' : `${Math.round(m.rowsReviewed.skippedShare * 100)}%`} tone="ok" />
          </div>
          <Card title="By flow">
            <div className="-m-4 overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="bg-paper text-[11px] tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-3 py-2 font-medium">Flow</th>
                    <th className="px-3 py-2 text-right font-medium">Calls</th>
                    <th className="px-3 py-2 text-right font-medium">Prompt</th>
                    <th className="px-3 py-2 text-right font-medium">Output</th>
                    <th className="px-3 py-2 text-right font-medium">Avg ms</th>
                    <th className="px-3 py-2 text-right font-medium">Est. J</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {m.flows.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-muted">No Kiln calls yet. Import a file and press “Explain flagged rows with AI”.</td></tr>}
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
          <Card title="How the energy estimate works">
            <div className="grid gap-2 text-sm">
              <p className="font-mono">2 RNGD cards × 180 W × 5.8 ms ≈ {m.joulesPerOutputToken.toFixed(2)} J per output token</p>
              <p className="text-muted">FuriosaAI reports gpt-oss-120b on two RNGD cards at 5.8 ms per output token, with each card well under 180 W. This is an upper bound: real power is lower and batching shares it across many requests. Prompt tokens are processed in parallel and are left out of the estimate.</p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
