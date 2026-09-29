'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, usdt, when, FLAGS, REASONS, type BatchItem, type Policy, type Status } from './lib';
import { Addr, Button, Callout, Card, ErrorLine, StatePill, Stat, TxLink } from './ui';

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

function Hero() {
  return (
    <section className="flex items-center justify-between gap-10 pt-9 pb-7 sm:pt-[54px] sm:pb-[37px]">
      <div className="min-w-0">
        <div className="eyebrow flex items-center gap-2.5"><span className="pulse" />AI payout desk · 안심 means peace of mind</div>
        <h1 className="my-[18px] text-[38px] leading-[1.08] font-[450] tracking-[-0.05em] text-balance sm:text-[clamp(34px,3.7vw,57px)]">
          Pay the families.<br /><em className="text-celadon not-italic">Never outside the line.</em>
        </h1>
        <p className="max-w-[64ch] text-[13px] leading-[1.8] text-muted">
          A payout desk for licensed remittance operators. It pays USDT on TRON through GasFree, only inside a budget, payee list and deadline the owner signed, and records every payment and every refusal.
        </p>
      </div>
      <div className="hidden w-[310px] shrink-0 border-l border-[#64755f] py-3.5 pl-6 md:block">
        <span className="font-mono text-[9px] tracking-[0.15em] text-muted">01 / ANSIM</span>
        <p className="pt-3 pb-4 text-[19px] leading-normal tracking-[-0.02em] text-[#d3ddcf]">“The agent pays.<br />The owner draws the line.”</p>
        <span className="font-mono text-[9px] tracking-[0.15em] text-muted">TRON GASFREE · FURIOSA KILN</span>
      </div>
    </section>
  );
}

function Modebar({ s }: { s: Status }) {
  const items = [
    { ok: !!s.payer, label: 'Payer wallet', hint: 'run npm run setup' },
    { ok: s.gasfree, label: 'GasFree', hint: 'add GASFREE_API_KEY and GASFREE_API_SECRET' },
    { ok: s.kiln, label: 'Kiln AI', hint: 'add KILN_BASE_URL and KILN_API_KEY' },
    { ok: !!s.registry, label: 'Registry', hint: 'run npm run deploy:contracts' },
    { ok: s.notary, label: 'Notary', hint: 'run npm run setup' },
  ];
  return (
    <section className="mb-[18px] flex flex-col gap-3 rounded-lg border border-line bg-[#151d18] px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <span className="w-fit rounded-[4px] border border-[#534638] bg-[#332b23] px-2 py-1.5 font-mono text-[9px] tracking-[0.08em] whitespace-nowrap text-warn">NILE TESTNET</span>
        <span className="text-[11px] text-muted">Real GasFree transfers of test USDT. Policies and batch seals are recorded on the AnsimRegistry contract.</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[10px] tracking-[0.04em]">
        {items.map((i) => (
          <span key={i.label} title={i.ok ? 'Ready' : i.hint} className={`flex items-center gap-1.5 ${i.ok ? 'text-[#c8d1c7]' : 'text-warn'}`}>
            <i className={`h-1.5 w-1.5 rounded-full ${i.ok ? 'bg-celadon' : 'bg-warn'}`} />
            {i.label}
            {!i.ok && <span className="text-muted">· {i.hint}</span>}
          </span>
        ))}
        {s.simulateLostLine && <span className="text-warn">Demo: line {s.simulateLostLine} response dropped</span>}
      </div>
    </section>
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
  const used = policy ? Math.min(100, (committed / policy.budget) * 100) : 0;

  return (
    <Card
      id="policy"
      eyebrow={policy ? `Owner-signed · policy #${policy.id}` : 'Owner-signed'}
      title="Spending policy"
      action={
        <div className="flex gap-2">
          {policy?.status === 'ACTIVE' && <Button kind="danger" busy={busy === 'stop'} onClick={stop}>Stop all payments</Button>}
          {!editing && <Button kind="secondary" onClick={() => setEditing(true)}>{policy ? 'New policy' : 'Create policy'}</Button>}
        </div>
      }
    >
      <div className="grid gap-5">
        <ErrorLine error={error} />
        {policy && !editing && (
          <>
            <div className="rounded-lg border border-[#26382c] bg-sunken p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] tracking-[0.1em] text-[#8ca492]">
                <span className="flex items-center gap-2"><StatePill state={policy.status} /> BUDGET INCLUDING FEES</span>
                <span>TIP-712 · SIGNED {policy.signed_by === 'server-demo-key' ? 'WITH DEMO OWNER KEY' : 'IN TRONLINK'}</span>
              </div>
              <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="num text-[44px] leading-none tracking-[-0.04em]">{usdt(committed)}</span>
                <span className="text-muted">of {usdt(policy.budget)} USDT committed</span>
              </div>
              <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-line">
                <div className={`h-full ${used > 80 ? 'bg-warn' : 'bg-celadon'}`} style={{ width: `${used}%` }} />
              </div>
              <div className="mt-2 flex justify-between font-mono text-[9px] tracking-[0.1em] text-[#8ca492]">
                <span>{Math.round(used)}% USED · PAID + IN FLIGHT + FEES</span>
                <span className="num">{usdt(Math.max(0, policy.budget - committed))} LEFT</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-3">
              <Stat label="Cap per payment" value={usdt(policy.per_payment)} />
              <Stat label="Deadline" value={<span className="text-base">{when(policy.deadline)}</span>} />
              <Stat label="Allowed payees" value={`${payees.length} of ${status.payees.length}`} />
            </div>
            <div>
              <div className="eyebrow mb-2">Payee book</div>
              <ul className="grid gap-1 sm:grid-cols-2">
                {status.payees.map((p) => {
                  const ok = payees.includes(p.address);
                  return (
                    <li key={p.address} className={`flex items-center gap-3 rounded-[7px] border px-2.5 py-2 ${ok ? 'border-[#3f5a3d] bg-celadon-soft' : 'border-transparent opacity-60'}`}>
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#38493b] text-xs text-celadon">{p.name[0]}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{p.name} <span className="text-[11px] text-muted">{p.country}</span></span>
                        <Addr a={p.address} />
                      </span>
                      <span className={`font-mono text-[9px] tracking-[0.08em] ${ok ? 'text-celadon' : 'text-stop'}`}>{ok ? 'ALLOWED' : 'NOT ON LIST'}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <dl className="grid gap-2 border-t border-line pt-4 text-xs text-muted">
              <div className="flex justify-between gap-3"><dt>Signed by</dt><dd><Addr a={policy.owner ?? ''} /></dd></div>
              <div className="flex justify-between gap-3"><dt>Policy hash</dt><dd className="font-mono text-[11px] text-[#c6d6bf]">{policy.policy_hash?.slice(0, 20)}…</dd></div>
              <div className="flex justify-between gap-3"><dt>AnsimRegistry record</dt><dd>{policy.anchor_tx ? <TxLink hash={policy.anchor_tx} /> : 'Not recorded yet'}</dd></div>
            </dl>
          </>
        )}
        {!policy && !editing && <Callout>No policy yet. The owner signs a budget that includes fees, a cap per payment, a deadline and the allowed payees. Ansim cannot pay anything outside it.</Callout>}
        {editing && (
          <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="grid gap-2 text-[11px] text-muted">Budget in USDT, fees included
                <input id="budget" type="number" min="0" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} className="num px-3 py-2.5 font-mono text-sm" />
              </label>
              <label className="grid gap-2 text-[11px] text-muted">Cap per payment
                <input id="cap" type="number" min="0" step="0.01" value={cap} onChange={(e) => setCap(e.target.value)} className="num px-3 py-2.5 font-mono text-sm" />
              </label>
              <label className="grid gap-2 text-[11px] text-muted">Deadline
                <input id="deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="px-3 py-2.5 text-sm" />
              </label>
            </div>
            <fieldset className="grid gap-1">
              <legend className="eyebrow mb-2">Allowed payees</legend>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {status.payees.map((p) => (
                  <label key={p.address} className="flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-[13px] hover:bg-raised">
                    <input
                      id={`payee-${p.address}`}
                      type="checkbox"
                      checked={allowed.includes(p.address)}
                      onChange={(e) => setAllowed((a) => (e.target.checked ? [...a, p.address] : a.filter((x) => x !== p.address)))}
                    />
                    <span>{p.name}</span>
                    <span className="text-[11px] text-muted">{p.country}</span>
                    <span className="ml-auto"><Addr a={p.address} /></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button kind="primary" busy={busy === 'tronlink'} onClick={() => grant('tronlink')}>Sign with TronLink ↗</Button>
              {status.ownerFallback && <Button kind="secondary" busy={busy === 'server'} onClick={() => grant('server')}>Sign with demo owner key</Button>}
              <Button kind="quiet" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
            <Callout>Signing a new policy replaces the current one. The signature is TIP-712 typed data, checked by the backend and again by the auditor script.</Callout>
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
    <Card eyebrow="Today’s file" title="Import and screen" action={<Counter n={Object.keys(FLAGS).length} />}>
      <div className="grid gap-4">
        <ErrorLine error={error} />
        <input id="payout-file" type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full min-w-0 text-xs text-muted file:mr-3 file:rounded-[7px] file:border file:border-edge file:bg-raised file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#d4e6cd]" />
        <Button kind="primary" busy={busy} disabled={!file} onClick={upload} className="w-full">Import and screen →</Button>
        <p className="text-[11px] text-muted">CSV or Excel, Korean or English headers. Demo file: <span className="font-mono">backend/data/demo/ansim-demo-payouts.xlsx</span></p>
        <div className="border-t border-line pt-4">
          <div className="eyebrow mb-2">Checked in code, before anything is paid</div>
          <ul className="grid">
            {Object.entries(FLAGS).map(([k, f]) => (
              <li key={k} className="flex items-baseline justify-between gap-3 border-b border-[#26372c] py-2 last:border-0">
                <span className="min-w-0">
                  <span className="block text-[13px]">{f.label}</span>
                  <span className="block text-[11px] text-muted">{f.tip}</span>
                </span>
                <span className={`font-mono text-[9px] tracking-[0.08em] whitespace-nowrap ${f.blocking ? 'text-stop' : 'text-warn'}`}>{f.blocking ? 'BLOCKS' : 'HOLDS'}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function Counter({ n }: { n: number }) {
  return <span className="rounded-[5px] border border-[#426443] bg-[#253929] px-2 py-1 font-mono text-[11px] text-celadon">{String(n).padStart(2, '0')}</span>;
}

// The same order refuseReason() checks in backend/src/policy.ts.
const GATE: [string, string][] = [
  ['The owner has not pressed Stop', 'STOPPED_BY_OWNER'],
  ['A signed policy is active', 'NO_ACTIVE_POLICY'],
  ['The policy deadline has not passed', 'DEADLINE_PASSED'],
  ['The payee is on the signed list', 'PAYEE_NOT_ALLOWED'],
  ['The amount is within the cap per payment', 'OVER_PER_PAYMENT_CAP'],
  ['Paid, in flight and fees stay inside the budget', 'OVER_BUDGET_WITH_FEES'],
];

function Boundary() {
  return (
    <Card eyebrow="The boundary" title="One budget. Not the whole wallet." action={<Counter n={GATE.length} />}>
      <div className="grid gap-4">
        <div>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line font-mono text-[9px] tracking-[0.1em] text-muted">
                <th className="py-2.5 font-normal">CHECKED BEFORE EVERY SIGNATURE</th>
                <th className="py-2.5 font-normal">IF NOT, THE ROW IS REFUSED</th>
              </tr>
            </thead>
            <tbody>
              {GATE.map(([check, reason]) => (
                <tr key={reason} className="border-b border-[#2b3a30]">
                  <td className="py-3 pr-4 text-[13px]">{check}</td>
                  <td className="py-3 text-xs text-stop">{REASONS[reason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] leading-relaxed text-muted">The budget counts payments still in flight at their fee cap, so a slow confirmation cannot let the agent overspend. Each GasFree permit also carries its own fee cap and deadline, which the GasFree contract enforces on chain.</p>
        <Callout>A refusal is written to the log with its reason. It is never silent, and it costs no AI tokens: the gate is plain code.</Callout>
      </div>
    </Card>
  );
}

function Batches({ batches }: { batches: BatchItem[] }) {
  return (
    <Card id="batches" eyebrow="Observable evidence" title="Batches" action={<Counter n={batches.length} />}>
      {batches.length === 0 ? (
        <p className="text-xs text-muted">No batches yet. Import a payout file to start.</p>
      ) : (
        <ol className="grid max-h-[420px] overflow-auto">
          {batches.map((b) => (
            <li key={b.id} className="border-b border-[#26372c] last:border-0">
              <Link href={`/batch/${b.id}`} className="flex items-start gap-3 py-2.5 hover:text-celadon">
                <time className="num shrink-0 pt-0.5 font-mono text-[10px] text-[#718b78]">{when(b.created_at)}</time>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">#{b.id} · {b.source}</span>
                  <span className="block text-[11px] text-muted">{b.row_count} rows · columns mapped by {b.mapped_by}</span>
                </span>
                <StatePill state={b.status} />
              </Link>
            </li>
          ))}
        </ol>
      )}
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
    <div>
      <Hero />
      {status && <Modebar s={status} />}
      <ErrorLine error={error} />
      {!status && !error && <p className="text-muted">Loading…</p>}
      {status && (
        <>
          <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1.8fr)_minmax(315px,1fr)]">
            <PolicyCard status={status} policy={policy.policy} committed={policy.committed} reload={load} />
            <ImportCard />
          </div>
          <div className="mt-[18px] grid items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <Boundary />
            <Batches batches={batches} />
          </div>
        </>
      )}
    </div>
  );
}
