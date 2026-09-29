'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { renderSVG } from 'uqr';
import { api, usdt, signWithTronLink, type Policy, type TypedDraft } from '../../lib';
import { Addr, Button, Callout, Card, ErrorLine, StatePill, TxLink, WaitingForTronLink } from '../../ui';
import { FlowMap } from '../../flow-map';

// The big screen for the live demo. People scan the QR and become families on their phones. The operator
// accepts them, adds them to the owner's signed limits, and pays them like any other batch.

type Joiner = {
  token: string; status: 'pending' | 'accepted'; name: string; country: string; city: string | null; wallet: string; joinedAt: number;
  payableAt: number | null;
  payment: { state: string; amount: number | null; reason: string | null; txnHash: string | null; confirmed: boolean } | null;
  sentBack: { state: string; value: number; txnHash: string | null } | null;
};

const noSubscribe = () => () => {};
const useOrigin = () => useSyncExternalStore(noSubscribe, () => window.location.origin, () => '');

function useNow(every: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

function Qr({ url }: { url: string }) {
  if (!url) return <div className="aspect-square w-full rounded-xl bg-white" />;
  // White quiet zone and dark modules on white, whatever the page theme: phone cameras need the contrast.
  return <div className="aspect-square w-full rounded-xl bg-white p-3 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: renderSVG(url, { ecc: 'M', border: 1 }) }} />;
}

export default function StagePage() {
  const joinUrl = `${useOrigin()}/join`;
  const [joiners, setJoiners] = useState<Joiner[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [amount, setAmount] = useState('3');
  const [batchId, setBatchId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);

  const load = useCallback(() => {
    api<Joiner[]>('/api/joins').then(setJoiners).catch((e) => setError(e.message));
    api<{ policy: Policy | null }>('/api/policy').then((r) => setPolicy(r.policy)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const accepted = joiners.filter((j) => j.status === 'accepted');
  const pending = joiners.filter((j) => j.status === 'pending');
  const signed: string[] = policy?.status === 'ACTIVE' ? JSON.parse(policy.payees) : [];
  const unsigned = accepted.filter((j) => !signed.includes(j.wallet));
  const waiting = accepted.filter((j) => j.payableAt && j.payableAt * 1000 > now);
  const paid = joiners.filter((j) => j.payment?.state === 'SUCCEED');
  const back = joiners.filter((j) => j.sentBack?.state === 'SUCCEED');

  // New limits: the same budget and caps the owner signed, with the accepted joiners added to the payees.
  const addToLimits = () =>
    act('limits', async () => {
      if (!policy || policy.status !== 'ACTIVE') throw new Error('Sign payment limits on the payout desk first.');
      const deadline = policy.deadline - Date.now() / 1000 > 1800 ? policy.deadline : Math.floor(Date.now() / 1000) + 3 * 3600;
      const draft = await api<TypedDraft & { id: number }>('/api/policy/draft', {
        json: {
          budget: policy.budget / 1e6, perPayment: policy.per_payment / 1e6, perPayeeMonthly: (policy.per_payee_monthly ?? 0) / 1e6, deadline,
          payees: [...new Set([...signed, ...accepted.map((j) => j.wallet)])],
        },
      });
      await api('/api/policy/activate', { json: { id: draft.id, ...(await signWithTronLink(draft)) } });
    });

  const draftBatch = () =>
    act('draft', async () => {
      const r = await api<{ id: number }>('/api/agent/plan', { json: { instruction: `Send everyone who joined from the audience ${Number(amount)} USDT.` } });
      setBatchId(r.id);
    });

  const payments = joiners.map((j) => ({
    id: j.token, country: j.country, city: j.city, amount: j.payment?.amount ?? null, state: j.payment?.state ?? 'READY', label: j.name,
    confirmed: j.sentBack?.state === 'SUCCEED' || !!j.payment?.confirmed,
  }));
  const countdown = (at: number) => {
    const left = Math.max(0, at * 1000 - now);
    return `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
  };

  return (
    <div className="grid gap-[18px] pb-2">
      <section className="pt-9 pb-2 sm:pt-12">
        <div className="eyebrow flex items-center gap-2.5"><span className="pulse" />Live demo · TRON Nile</div>
        <h1 className="my-[14px] text-[38px] leading-[1.08] font-[450] tracking-[-0.05em] text-balance sm:text-[clamp(34px,3.7vw,52px)]">
          Scan to become a family.<br /><em className="text-celadon not-italic">Get paid on stage, with no TRX.</em>
        </h1>
      </section>

      <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Card eyebrow="Scan with your phone camera" title="Join as a family">
          <div className="grid gap-4">
            <Qr url={joinUrl} />
            <p className="font-mono text-[12px] break-all text-muted">{joinUrl}</p>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[['Joined', joiners.length], ['Contacts', accepted.length], ['Paid', paid.length], ['Sent back', back.length]].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line py-2">
                  <div className="num text-2xl">{v}</div>
                  <div className="font-mono text-[9px] tracking-[0.1em] text-muted uppercase">{k}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
        <FlowMap title="LIVE · THE AUDIENCE AS FAMILIES" payments={payments} />
      </div>

      <Card eyebrow="Run it" title="Five steps, all inside the signed line">
        <div className="grid gap-4">
          <ErrorLine error={error} />
          {busy === 'limits' && <WaitingForTronLink />}
          <ol className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-5">
            <li className="grid content-start gap-2 rounded-lg border border-line p-4">
              <b>1 · Accept people</b>
              <span className="text-muted">Each wallet gets the same checks as any new contact.</span>
              <span className="num text-warn">{pending.length ? `${pending.length} waiting below` : 'Nobody waiting'}</span>
            </li>
            <li className="grid content-start gap-2 rounded-lg border border-line p-4">
              <b>2 · Add them to the limits</b>
              <span className="text-muted">Same budget and caps{policy ? ` (${usdt(policy.budget)} USDT)` : ''}, signed again in TronLink.</span>
              <Button kind={unsigned.length ? 'primary' : 'secondary'} busy={busy === 'limits'} disabled={!unsigned.length} onClick={addToLimits}>
                {unsigned.length ? `Sign for ${unsigned.length} more ↗` : 'All signed'}
              </Button>
            </li>
            <li className="grid content-start gap-2 rounded-lg border border-line p-4">
              <b>3 · Ask the agent</b>
              <label className="flex items-center gap-2 text-muted">
                <input type="number" min="0.5" step="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} className="num w-20 px-2 py-1.5 font-mono" /> USDT each
              </label>
              <Button kind="secondary" busy={busy === 'draft'} disabled={!accepted.length || waiting.length > 0} onClick={draftBatch}>
                {waiting.length ? `Payable in ${countdown(Math.max(...waiting.map((j) => j.payableAt!)))}` : 'Draft the batch →'}
              </Button>
            </li>
            <li className="grid content-start gap-2 rounded-lg border border-line p-4">
              <b>4 · Approve and pay</b>
              <span className="text-muted">The owner signs the exact rows; the vault releases them on chain.</span>
              {batchId ? <Link href={`/batch/${batchId}`} target="_blank" className="font-semibold text-celadon hover:underline">Open batch #{batchId} ↗</Link> : <span className="text-muted">After step 3</span>}
            </li>
            <li className="grid content-start gap-2 rounded-lg border border-line p-4">
              <b>5 · Phones send it back</b>
              <span className="text-muted">Signed on the phone, gas paid by GasFree, back into the vault.</span>
              <span className="num text-celadon">{back.length} of {paid.length} sent back</span>
            </li>
          </ol>
          {accepted.length > 0 && Math.min(...accepted.map((j) => j.payableAt ?? 0)) * 1000 > now && (
            <Callout>New contacts wait before they can be paid, like a bank’s delayed transfer (지연이체). Accept people early; the countdown is per person.</Callout>
          )}
        </div>
      </Card>

      <Card eyebrow="From the hash-chained log" title={`${joiners.length} ${joiners.length === 1 ? 'person' : 'people'}`} className="overflow-hidden">
        {joiners.length === 0 ? (
          <p className="text-xs text-muted">Nobody has joined yet. Show the QR code.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[52rem] border-collapse text-left text-[13px] [&_tr>*:first-child]:pl-5 sm:[&_tr>*:first-child]:pl-6 [&_tr>*:last-child]:pr-5">
              <thead className="border-y border-line font-mono text-[9px] tracking-[0.1em] text-muted uppercase">
                <tr>{['Name', 'City', 'GasFree account', 'Contact', 'Payment', 'Sent back'].map((h) => <th key={h} className="px-3 py-2.5 font-normal">{h}</th>)}</tr>
              </thead>
              <tbody>
                {joiners.map((j) => (
                  <tr key={j.token} className="border-b border-line/60 align-middle last:border-0">
                    <td className="px-3 py-3">{j.name}</td>
                    <td className="px-3 py-3 text-muted">{j.city ?? '–'}, {j.country}</td>
                    <td className="px-3 py-3"><Addr a={j.wallet} /></td>
                    <td className="px-3 py-3">
                      {j.status === 'pending' ? (
                        <span className="flex gap-2">
                          <Button kind="primary" busy={busy === `a${j.token}`} onClick={() => act(`a${j.token}`, () => api(`/api/joins/${j.token}/accept`, { json: {} }))}>Accept</Button>
                          <Button kind="secondary" busy={busy === `r${j.token}`} onClick={() => act(`r${j.token}`, () => api(`/api/joins/${j.token}/reject`, { json: {} }))}>Reject</Button>
                        </span>
                      ) : j.payableAt && j.payableAt * 1000 > now ? (
                        <span className="num text-warn">Payable in {countdown(j.payableAt)}</span>
                      ) : (
                        <span className="text-celadon">{signed.includes(j.wallet) ? '✓ In the signed limits' : '✓ Contact · not signed yet'}</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {j.payment ? (
                        <span className="flex items-center gap-2"><StatePill state={j.payment.state} /> <span className="num">{usdt(j.payment.amount)}</span> <TxLink hash={j.payment.txnHash} /></span>
                      ) : <span className="text-muted">–</span>}
                    </td>
                    <td className="px-3 py-3">
                      {j.sentBack ? <span className="flex items-center gap-2"><StatePill state={j.sentBack.state} /> <span className="num">{usdt(j.sentBack.value)}</span> <TxLink hash={j.sentBack.txnHash} /></span> : <span className="text-muted">–</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
