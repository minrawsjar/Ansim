'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, usdt, when, type BatchItem, type Policy, type Status } from './lib';
import { Addr, Button, Card, ErrorLine, StatePill, Stat, TxLink } from './ui';

type Draft = { id: number; domain: object; types: object; value: Record<string, string> };

/* eslint-disable @typescript-eslint/no-explicit-any */
async function signWithTronLink(draft: Draft) {
  const w = window as any;
  if (!w.tronLink && !w.tronWeb) throw new Error('TronLink is not installed in this browser. Use the demo owner key instead.');
  if (w.tronLink?.request) await w.tronLink.request({ method: 'tron_requestAccounts' });
  const tronWeb = w.tronLink?.tronWeb || w.tronWeb;
  const owner: string | undefined = tronWeb?.defaultAddress?.base58;
  if (!owner) throw new Error('Unlock TronLink and connect an account first.');
  const sign = tronWeb.trx.signTypedData ?? tronWeb.trx._signTypedData;
  const signature: string = await sign.call(tronWeb.trx, draft.domain, draft.types, draft.value);
  return { owner, signature };
}

function Setup({ s }: { s: Status }) {
  const items = [
    { ok: !!s.payer, label: 'Payer wallet', hint: 'Run npm run setup' },
    { ok: s.gasfree, label: 'GasFree API key', hint: 'Add GASFREE_API_KEY and GASFREE_API_SECRET' },
    { ok: s.kiln, label: 'Kiln API (gpt-oss-120b)', hint: 'Add KILN_BASE_URL and KILN_API_KEY' },
    { ok: !!s.registry, label: 'Registry contract', hint: 'Run npm run deploy:contracts' },
    { ok: s.notary, label: 'Notary key', hint: 'Run npm run setup' },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <span key={i.label} title={i.ok ? 'Ready' : i.hint} className={`rounded-full border px-2.5 py-1 text-xs ${i.ok ? 'border-ok/30 bg-ok/5 text-ok' : 'border-warn/40 bg-warn/5 text-warn'}`}>
          {i.ok ? '✓' : '!'} {i.label}
          {!i.ok && <span className="text-muted"> · {i.hint}</span>}
        </span>
      ))}
      {s.simulateLostLine && <span className="rounded-full border border-warn/40 px-2.5 py-1 text-xs text-warn">Demo: response for line {s.simulateLostLine} will be dropped</span>}
    </div>
  );
}

function PolicyCard({ status, policy, committed, reload }: { status: Status; policy: Policy | null; committed: number; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState('30');
  const [cap, setCap] = useState('15');
  const [deadline, setDeadline] = useState(() => {
    const d = new Date(Date.now() + 8 * 3600_000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [allowed, setAllowed] = useState<string[]>(status.payees.map((p) => p.address));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grant = async (how: 'tronlink' | 'server') => {
    setBusy(how);
    setError(null);
    try {
      const w = window as any;
      if (how === 'tronlink' && !w.tronLink && !w.tronWeb) throw new Error('TronLink is not installed in this browser. Use the demo owner key instead.');
      const draft = await api<Draft>('/api/policy/draft', { json: { budget: Number(budget), perPayment: Number(cap), deadline: Math.floor(new Date(deadline).getTime() / 1000), payees: allowed } });
      const body = how === 'server' ? { id: draft.id, serverSign: true } : { id: draft.id, ...(await signWithTronLink(draft)) };
      await api('/api/policy/activate', { json: body });
      setEditing(false);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy('stop');
    try {
      await api('/api/policy/stop', { json: {} });
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const payees: string[] = policy ? JSON.parse(policy.payees) : [];
  const nameOf = (a: string) => status.payees.find((p) => p.address === a)?.name ?? a;

  return (
    <Card
      title="Spending policy"
      action={
        <div className="flex gap-2">
          {policy?.status === 'ACTIVE' && <Button kind="danger" busy={busy === 'stop'} onClick={stop}>Stop all payments</Button>}
          {!editing && <Button onClick={() => setEditing(true)}>{policy ? 'New policy' : 'Create policy'}</Button>}
        </div>
      }
    >
      <div className="grid gap-4">
        <ErrorLine error={error} />
        {policy && !editing && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatePill state={policy.status} />
              <span className="text-sm text-muted">Policy #{policy.id}, signed by <Addr a={policy.owner ?? ''} /> {policy.signed_by === 'server-demo-key' ? '(demo owner key)' : 'in TronLink'}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Budget incl. fees" value={`${usdt(policy.budget)}`} />
              <Stat label="Committed" value={usdt(committed)} tone={committed > policy.budget * 0.8 ? 'warn' : undefined} />
              <Stat label="Per payment cap" value={usdt(policy.per_payment)} />
              <Stat label="Deadline" value={<span className="text-sm">{when(policy.deadline)}</span>} />
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-paper">
              <div className="h-full bg-celadon" style={{ width: `${Math.min(100, (committed / policy.budget) * 100)}%` }} />
            </div>
            <div className="text-sm">
              <div className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Allowed payees · {payees.length}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">{payees.map((a) => <span key={a}>{nameOf(a)}</span>)}</div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>Policy hash <span className="font-mono">{policy.policy_hash?.slice(0, 16)}…</span></span>
              {policy.anchor_tx ? <span>Recorded on chain <TxLink hash={policy.anchor_tx} /></span> : <span>Not recorded on chain yet</span>}
            </div>
          </>
        )}
        {!policy && !editing && <p className="text-sm text-muted">No policy yet. The owner signs a budget, a per-payment cap, a deadline and the allowed payees. Ansim cannot pay anything outside it.</p>}
        {editing && (
          <form className="grid gap-3" onSubmit={(e) => e.preventDefault()}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="grid gap-1 text-sm">Budget in USDT, fees included
                <input id="budget" type="number" min="0" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} className="num rounded-md border border-line px-2 py-1.5 font-mono" />
              </label>
              <label className="grid gap-1 text-sm">Cap per payment
                <input id="cap" type="number" min="0" step="0.01" value={cap} onChange={(e) => setCap(e.target.value)} className="num rounded-md border border-line px-2 py-1.5 font-mono" />
              </label>
              <label className="grid gap-1 text-sm">Deadline
                <input id="deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="rounded-md border border-line px-2 py-1.5" />
              </label>
            </div>
            <fieldset className="grid gap-1">
              <legend className="mb-1 text-sm">Allowed payees</legend>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {status.payees.map((p) => (
                  <label key={p.address} className="flex items-center gap-2 text-sm">
                    <input
                      id={`payee-${p.address}`}
                      type="checkbox"
                      checked={allowed.includes(p.address)}
                      onChange={(e) => setAllowed((a) => (e.target.checked ? [...a, p.address] : a.filter((x) => x !== p.address)))}
                    />
                    <span>{p.name}</span>
                    <span className="text-xs text-muted">{p.country}</span>
                    <Addr a={p.address} />
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button kind="primary" busy={busy === 'tronlink'} onClick={() => grant('tronlink')}>Sign with TronLink</Button>
              {status.ownerFallback && <Button busy={busy === 'server'} onClick={() => grant('server')}>Sign with demo owner key</Button>}
              <Button onClick={() => setEditing(false)}>Cancel</Button>
            </div>
            <p className="text-xs text-muted">Signing a new policy replaces the current one. The signature is TIP-712 typed data, checked by the backend and by the auditor script.</p>
          </form>
        )}
      </div>
    </Card>
  );
}

function ImportCard() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/batches', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error ?? 'Import failed');
      router.push(`/batch/${j.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Card title="Import a payout file">
      <div className="grid gap-3">
        <ErrorLine error={error} />
        <input id="payout-file" type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-paper file:px-3 file:py-1.5 file:text-sm" />
        <div className="flex flex-wrap items-center gap-3">
          <Button kind="primary" busy={busy} disabled={!file} onClick={upload}>Import and screen</Button>
          <span className="text-xs text-muted">Demo file: backend/data/demo/ansim-demo-payouts.xlsx</span>
        </div>
        <p className="text-xs text-muted">Every row is checked for bad addresses, duplicates, lookalike wallets, money-mule patterns, reported wallets and Tether’s freeze list before anything can be paid.</p>
      </div>
    </Card>
  );
}

export default function Console() {
  const [status, setStatus] = useState<Status | null>(null);
  const [policy, setPolicy] = useState<{ policy: Policy | null; committed: number }>({ policy: null, committed: 0 });
  const [batches, setBatches] = useState<BatchItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, p, b] = await Promise.all([api<Status>('/api/status'), api<{ policy: Policy | null; committed: number }>('/api/policy'), api<BatchItem[]>('/api/batches')]);
      setStatus(s);
      setPolicy(p);
      setBatches(b);
      setError(null);
    } catch (e) {
      setError(`Cannot reach the backend: ${(e as Error).message}. Start it with npm run dev.`);
    }
  }, []);
  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <h1 className="text-2xl font-bold">Payout desk</h1>
        <p className="max-w-3xl text-muted">Pay a day’s USDT remittances on TRON through GasFree. Neither you nor the families need TRX. Every payment stays inside the policy the owner signed, and every payment and refusal is recorded.</p>
        {status && <Setup s={status} />}
      </div>
      <ErrorLine error={error} />
      {!status && !error && <p className="text-muted">Loading…</p>}
      {status && (
        <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
          <PolicyCard status={status} policy={policy.policy} committed={policy.committed} reload={load} />
          <div className="grid content-start gap-5">
            <ImportCard />
            <Card title="Batches">
              {batches.length === 0 ? (
                <p className="text-sm text-muted">No batches yet. Import a payout file to start.</p>
              ) : (
                <ul className="grid divide-y divide-line">
                  {batches.map((b) => (
                    <li key={b.id}>
                      <Link href={`/batch/${b.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 hover:text-celadon">
                        <span className="font-mono text-sm">#{b.id}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{b.source}</span>
                        <span className="text-xs text-muted">{b.row_count} rows</span>
                        <StatePill state={b.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
