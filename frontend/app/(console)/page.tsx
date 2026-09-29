'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, usdt, when, waitText, WALLET_FLAGS, signWithTronLink, sendWithTronLink, tronscanAddress, FLAGS, REASONS, type BatchItem, type Policy, type Payee, type Rules, type Status, type TypedDraft, type Vault } from '../lib';
import { Addr, Button, Callout, Card, ErrorLine, StatePill, Stat, TxLink, WaitingForTronLink } from '../ui';
import { FlowMap, type FlowPayment } from '../flow-map';
import { citiesOf, countries } from '../places';

type Draft = TypedDraft & { id: number };

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
    { ok: s.telegram && s.telegramChats > 0, label: `Telegram alerts${s.telegram ? ` · ${s.telegramChats} ${s.telegramChats === 1 ? 'chat' : 'chats'}` : ''}`, hint: s.telegram ? 'connect a chat' : 'optional, add TELEGRAM_BOT_TOKEN' },
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
        {s.telegram && <ConnectTelegram />}
        {s.telegram && s.telegramChats > 0 && <TestAlert />}
      </div>
    </section>
  );
}

type DeskProps = { status: Status; policy: Policy | null; committed: number; reload: () => void };

// Step 1 picks who may be paid; step 2 signs the limits for exactly that selection.
// Opens the bot with a one-time code. Pressing Start in Telegram subscribes that chat to the owner's alerts.
function ConnectTelegram() {
  const [note, setNote] = useState<string | null>(null);
  const connect = async () => {
    const tab = window.open('about:blank', '_blank'); // opened now, while the click still counts, then pointed at the bot
    try {
      const { url } = await api<{ url: string }>('/api/telegram/link', { json: {} });
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setNote('Press Start in Telegram');
    } catch (e) {
      tab?.close();
      setNote((e as Error).message);
    }
  };
  return (
    <button type="button" onClick={connect} className="text-celadon underline-offset-2 hover:underline">
      {note ?? 'Connect my Telegram ↗'}
    </button>
  );
}

function TestAlert() {
  const [note, setNote] = useState<string | null>(null);
  const send = () => api('/api/alerts/test', { json: {} }).then(() => setNote('Sent')).catch((e) => setNote(e.message));
  return (
    <button type="button" onClick={send} className="text-celadon underline-offset-2 hover:underline">
      {note ?? 'Send a test alert'}
    </button>
  );
}

function PolicyDesk({ status, policy, committed, reload }: DeskProps) {
  const signed: string[] = policy ? JSON.parse(policy.payees) : [];
  const active = policy?.status === 'ACTIVE';
  // Start from the signed wallets that are still contacts, so removed contacts show up as unsigned changes.
  const [selected, setSelected] = useState<string[]>(() =>
    active ? signed.filter((a) => status.payees.some((p) => p.address === a)) : status.payees.map((p) => p.address),
  );
  const changes = active ? [...new Set([...selected, ...signed])].filter((a) => selected.includes(a) !== signed.includes(a)).length : 0;
  // Every signed wallet was removed from the contacts: the limits would refuse every payment.
  const coversNone = active && !status.payees.some((p) => signed.includes(p.address));
  const selectAll = () => setSelected(status.payees.map((p) => p.address));
  return (
    <div className="grid min-w-0 gap-[18px]">
      <Contacts payees={status.payees} rules={status.rules} signed={active ? signed : []} selected={selected} setSelected={setSelected} reload={reload} />
      <Limits status={status} policy={policy} committed={committed} reload={reload} selected={selected} changes={changes} coversNone={coversNone} selectAll={selectAll} />
    </div>
  );
}

const EMPTY_CONTACT = { name: '', country: '', city: '', address: '', usual: '' };

// What the wallet's public history on mainnet says. Code sets the flags; the model only explains them.
function RiskLine({ p, onCheck, busy }: { p: Payee; onCheck: () => void; busy: boolean }) {
  const r = p.risk;
  const button = (label: string) => (
    <button type="button" disabled={busy} onClick={onCheck} className="text-[11px] text-celadon hover:underline disabled:opacity-50">{busy ? 'Checking the chain…' : label}</button>
  );
  if (!r) return <span className="block">{button('Check wallet history')}</span>;
  if (r.error) return <span className="block text-[11px] text-warn">Wallet check failed: {r.error} {button('Try again')}</span>;
  const tone = r.level === 'high' ? 'text-stop' : r.level === 'review' ? 'text-warn' : 'text-muted';
  return (
    <span className={`mt-1 block text-[11px] leading-relaxed ${tone}`}>
      {r.flags?.length ? r.flags.map((f) => WALLET_FLAGS[f] ?? f).join(' · ') : `No risk signals in the public record${r.facts && !r.facts.used ? ' · never used on mainnet' : ''}`}
      {r.note && <span className="block text-muted">{r.note.ko} {r.note.en}</span>}
    </span>
  );
}

function Contacts({ payees, rules, signed, selected, setSelected, reload }: {
  payees: Status['payees']; rules: Rules; signed: string[]; selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>; reload: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_CONTACT);
  const [now] = useState(() => Date.now() / 1000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = (k: keyof typeof EMPTY_CONTACT) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value })) });

  const save = async () => {
    setBusy('add');
    setError(null);
    try {
      await api('/api/payees', { json: form });
      setSelected((s) => [...s, form.address.trim()]);
      setForm(EMPTY_CONTACT);
      setAdding(false);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async (address: string) => {
    setBusy(address);
    setError(null);
    try {
      await api(`/api/payees/${address}`, { method: 'DELETE' });
      setSelected((s) => s.filter((a) => a !== address));
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const setCity = async (address: string, city: string) => {
    setBusy(`city:${address}`);
    setError(null);
    try {
      await api(`/api/payees/${address}`, { method: 'PATCH', json: { city } });
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const check = async (address: string) => {
    setBusy(`check:${address}`);
    setError(null);
    try {
      await api(`/api/payees/${address}/check`, { json: {} });
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const orphans = signed.filter((a) => !payees.some((p) => p.address === a));

  return (
    <Card
      id="contacts"
      eyebrow={`Step 1 · payee book · ${payees.filter((p) => selected.includes(p.address)).length} of ${payees.length} ticked`}
      title="Contacts"
      action={!adding && <Button kind="secondary" onClick={() => setAdding(true)}>+ Add contact</Button>}
    >
      <div className="grid gap-4">
        <ErrorLine error={error} />
        {adding && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-3 rounded-lg border border-[#26382c] bg-sunken p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <label className="grid gap-2 text-[11px] text-muted">Name
                <input id="contact-name" required autoComplete="off" placeholder="Recipient’s full name" className="px-3 py-2.5 text-sm" {...field('name')} />
              </label>
              <label className="grid gap-2 text-[11px] text-muted">Country
                <input id="contact-country" list="country-list" autoComplete="off" placeholder="Vietnam" className="px-3 py-2.5 text-sm" {...field('country')} />
                <datalist id="country-list">{countries().map((c) => <option key={c} value={c} />)}</datalist>
              </label>
              <label className="grid gap-2 text-[11px] text-muted">City
                <input id="contact-city" list="city-list" autoComplete="off" placeholder={citiesOf(form.country)[0] ?? 'Hanoi'} className="px-3 py-2.5 text-sm" {...field('city')} />
                <datalist id="city-list">{citiesOf(form.country).map((c) => <option key={c} value={c} />)}</datalist>
              </label>
              <label className="grid gap-2 text-[11px] text-muted">Usual amount, USDT
                <input id="contact-usual" type="number" min="0" step="0.01" placeholder="3.00" className="num px-3 py-2.5 font-mono text-sm" {...field('usual')} />
              </label>
              <label className="grid gap-2 text-[11px] text-muted sm:col-span-4">TRON wallet address
                <input id="contact-address" required autoComplete="off" spellCheck={false} placeholder="T…" className="px-3 py-2.5 font-mono text-sm" {...field('address')} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button kind="primary" type="submit" busy={busy === 'add'}>Save contact</Button>
              <Button kind="quiet" type="button" onClick={() => { setAdding(false); setError(null); }}>Cancel</Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted">Before saving, Ansim refuses a wallet that is invalid, looks like an existing contact’s wallet, is on the reported scam list or is frozen by Tether. It also reads the wallet’s history on TRON mainnet: a smart contract, money from frozen wallets or five or more senders in a week marks it risky, and its payments are held for review. The usual amount is used to flag an unusually large payment.</p>
          </form>
        )}
        {payees.length === 0 ? (
          <p className="text-xs text-muted">No contacts yet. Add the people this business pays.</p>
        ) : (
          <ul className="grid gap-1.5 xl:grid-cols-2">
            {payees.map((p) => {
              const on = selected.includes(p.address);
              const was = signed.includes(p.address);
              const tag = on && was ? ['SIGNED', 'text-celadon'] : on && signed.length ? ['TO ADD', 'text-warn'] : was ? ['TO REMOVE', 'text-warn'] : null;
              const payableFrom = p.created_at ? p.created_at + rules.contactWaitHours * 3600 : 0;
              return (
                <li key={p.address} className={`flex items-center gap-3 rounded-[7px] border px-3 py-2.5 transition ${p.risk?.level === 'high' ? 'border-stop/40' : on ? 'border-[#3f5a3d] bg-celadon-soft' : 'border-line'}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    aria-label={`Allow payments to ${p.name}`}
                    onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.address] : s.filter((a) => a !== p.address)))}
                  />
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#38493b] text-xs text-celadon">{p.name[0]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-1.5 text-[13px]">
                      <span className="truncate">{p.name}</span>
                      {citiesOf(p.country).length > 0 ? (
                        <select
                          aria-label={`${p.name}’s city`}
                          value={p.city ?? ''}
                          disabled={busy === `city:${p.address}`}
                          onChange={(e) => setCity(p.address, e.target.value)}
                          className="!w-auto !rounded-[4px] !border-transparent !bg-transparent px-0.5 py-0 text-[11px] text-muted hover:!border-line"
                        >
                          <option value="">City?</option>
                          {citiesOf(p.country).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : p.city ? <span className="text-[11px] text-muted">{p.city}</span> : null}
                      <span className="text-[11px] text-muted">{p.country}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2">
                      <Addr a={p.address} />
                      <span className="num font-mono text-[10px] text-muted">usual {p.usual.toFixed(2)} · 30 days {usdt(p.month)}</span>
                    </span>
                    {payableFrom > now && <span className="block text-[11px] text-warn">New contact: can be paid from {when(payableFrom)}</span>}
                    <RiskLine p={p} busy={busy === `check:${p.address}`} onCheck={() => check(p.address)} />
                  </span>
                  {tag && <span className={`font-mono text-[9px] tracking-[0.08em] whitespace-nowrap ${tag[1]}`}>{tag[0]}</span>}
                  <button
                    type="button"
                    title={`Remove ${p.name} from contacts`}
                    aria-label={`Remove ${p.name} from contacts`}
                    disabled={busy === p.address}
                    onClick={() => remove(p.address)}
                    className="rounded-[5px] px-1.5 py-0.5 text-base leading-none text-muted transition hover:bg-raised hover:text-stop disabled:opacity-40"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {orphans.length > 0 && <p className="text-[11px] text-warn">{orphans.length === 1 ? '1 removed contact is' : `${orphans.length} removed contacts are`} still allowed by the signed limits until the owner signs new ones.</p>}
        <p className="text-[11px] text-muted">
          Ticked contacts are the only wallets the next signed limits allow.{' '}
          {rules.contactWaitHours > 0 && <>A new contact can be paid only after {waitText(rules.contactWaitHours)}, like a bank’s delayed transfer (지연이체). </>}
          Adding or removing a contact is written to the log.
        </p>
      </div>
    </Card>
  );
}

function Limits({ status, policy, committed, reload, selected, changes, coversNone, selectAll }: DeskProps & { selected: string[]; changes: number; coversNone: boolean; selectAll: () => void }) {
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState('30');
  const [cap, setCap] = useState('15');
  const [monthly, setMonthly] = useState('30');
  const [deadline, setDeadline] = useState(() => {
    const d = new Date(Date.now() + 8 * 3600_000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const edit = () => {
    // Nothing ticked yet: start from every current contact, so one click leads to a form ready to sign.
    if (!status.payees.some((p) => selected.includes(p.address))) selectAll();
    if (policy) {
      setBudget(String(policy.budget / 1e6));
      setCap(String(policy.per_payment / 1e6));
      setMonthly(String((policy.per_payee_monthly ?? 0) / 1e6));
    }
    setEditing(true);
  };

  const grant = async (how: 'tronlink' | 'server') => {
    setBusy(how);
    setError(null);
    try {
      const w = window as unknown as { tronLink?: unknown; tronWeb?: unknown };
      if (how === 'tronlink' && !w.tronLink && !w.tronWeb) throw new Error('TronLink is not installed in this browser. Use the demo owner key instead.');
      const draft = await api<Draft>('/api/policy/draft', { json: { budget: Number(budget), perPayment: Number(cap), perPayeeMonthly: Number(monthly || 0), deadline: Math.floor(new Date(deadline).getTime() / 1000), payees: selected } });
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

  const signed: string[] = policy ? JSON.parse(policy.payees) : [];
  const used = policy ? Math.min(100, (committed / policy.budget) * 100) : 0;
  const names = status.payees.filter((p) => selected.includes(p.address)).map((p) => p.name);

  return (
    <Card
      id="limits"
      eyebrow={policy ? `Step 2 · owner-signed · policy #${policy.id}` : 'Step 2 · owner-signed'}
      title="Payment limits"
      action={
        <div className="flex gap-2">
          {policy?.status === 'ACTIVE' && <Button kind="danger" busy={busy === 'stop'} onClick={stop}>Stop all payments</Button>}
          {!editing && <Button kind={policy?.status === 'ACTIVE' && !changes ? 'secondary' : 'primary'} onClick={edit}>{policy ? 'Change limits' : 'Set limits'}</Button>}
        </div>
      }
    >
      <div className="grid gap-5">
        <ErrorLine error={error} />
        {coversNone && !editing && (
          <Callout tone="warn">
            The signed limits cover none of your current contacts, so every payment would be refused.{' '}
            <button type="button" onClick={edit} className="font-semibold underline">Sign new limits for your contacts</button>
          </Callout>
        )}
        {changes > 0 && !coversNone && !editing && (
          <Callout tone="warn">
            {changes === 1 ? '1 contact change is' : `${changes} contact changes are`} not signed yet. Payments still follow the signed list until the owner signs new limits.{' '}
            <button type="button" onClick={edit} className="font-semibold underline">Sign new limits</button>
          </Callout>
        )}
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
              <div className="mt-2 flex justify-between gap-3 font-mono text-[9px] tracking-[0.1em] text-[#8ca492]">
                <span>{Math.round(used)}% USED · PAID + IN FLIGHT + FEES</span>
                <span className="num">{usdt(Math.max(0, policy.budget - committed))} LEFT</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-4">
              <Stat label="Cap per payment" value={usdt(policy.per_payment)} />
              <Stat label="Per contact, 30 days" value={policy.per_payee_monthly ? usdt(policy.per_payee_monthly) : 'No cap'} />
              <Stat label="Deadline" value={<span className="text-base">{when(policy.deadline)}</span>} />
              <Stat label="Contacts allowed" value={signed.length} />
            </div>
            <dl className="grid gap-2 border-t border-line pt-4 text-xs text-muted">
              <div className="flex justify-between gap-3"><dt>Signed by</dt><dd><Addr a={policy.owner ?? ''} /></dd></div>
              <div className="flex justify-between gap-3"><dt>Policy hash</dt><dd className="font-mono text-[11px] text-[#c6d6bf]">{policy.policy_hash?.slice(0, 20)}…</dd></div>
              <div className="flex justify-between gap-3"><dt>AnsimRegistry record</dt><dd>{policy.anchor_tx ? <TxLink hash={policy.anchor_tx} /> : 'Not recorded yet'}</dd></div>
            </dl>
          </>
        )}
        {!policy && !editing && <Callout>No limits signed yet. Tick who can be paid in the contacts above, then set a budget that includes fees, a cap per payment and a deadline. Ansim cannot pay anything outside them.</Callout>}
        {editing && (
          <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <label className="grid gap-2 text-[11px] text-muted">Budget in USDT, fees included
                <input id="budget" type="number" min="0" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} className="num px-3 py-2.5 font-mono text-sm" />
              </label>
              <label className="grid gap-2 text-[11px] text-muted">Cap per payment
                <input id="cap" type="number" min="0" step="0.01" value={cap} onChange={(e) => setCap(e.target.value)} className="num px-3 py-2.5 font-mono text-sm" />
              </label>
              <label className="grid gap-2 text-[11px] text-muted">Per contact, 30 days (0 = no cap)
                <input id="monthly" type="number" min="0" step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} className="num px-3 py-2.5 font-mono text-sm" />
              </label>
              <label className="grid gap-2 text-[11px] text-muted">Deadline
                <input id="deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="px-3 py-2.5 text-sm" />
              </label>
            </div>
            <div className="text-[13px]">
              <div className="eyebrow mb-1.5">Signing for {names.length} {names.length === 1 ? 'contact' : 'contacts'}</div>
              {names.length ? <p className="text-muted">{names.join(', ')}</p> : <p className="text-stop">Tick at least one contact above.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button kind="primary" type="button" disabled={!names.length} busy={busy === 'tronlink'} onClick={() => grant('tronlink')}>Sign with TronLink ↗</Button>
              {status.ownerFallback && <Button kind="secondary" type="button" disabled={!names.length} busy={busy === 'server'} onClick={() => grant('server')}>Sign with demo owner key</Button>}
              <Button kind="quiet" type="button" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
            {busy === 'tronlink' && <WaitingForTronLink />}
            <Callout>Signing new limits replaces the current ones. The signature is TIP-712 typed data, checked by the backend and again by the auditor script.</Callout>
          </form>
        )}
      </div>
    </Card>
  );
}

// The owner says what to pay in plain words; the agent drafts a batch from the contacts. The batch still
// goes through every check, the owner's approval and the vault before anything moves.
// Example instructions. The last one asks for more than the limits allow, to show the refusals.
const AGENT_PROMPTS = [
  'Pay everyone their usual monthly support.',
  'Pay everyone their usual amount, but skip anyone new or with a risky wallet.',
  'Send a 5 USDT Chuseok bonus to each contact in Vietnam.',
  'Pay only the families in Nepal their usual amount.',
  'Send 20 USDT to every contact.',
];

function AgentCard() {
  const router = useRouter();
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: number }>('/api/agent/plan', { json: { instruction } });
      router.push(`/batch/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Card eyebrow="Step 3 · ask the agent" title="Payout agent">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); plan(); }}>
        <ErrorLine error={error} />
        <div className="flex flex-wrap gap-1.5">
          {AGENT_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setInstruction(p)}
              className={`rounded-full border px-2.5 py-1 text-left text-[11px] transition ${instruction === p ? 'border-celadon/60 bg-celadon-soft text-celadon' : 'border-line text-[#c8d1c7] hover:border-edge hover:bg-raised'}`}
            >
              {p}
            </button>
          ))}
        </div>
        <textarea
          id="agent-instruction"
          rows={3}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Tell the agent what to pay today, or pick an example above."
          className="px-3 py-2.5 text-[13px]"
        />
        <Button kind="primary" type="submit" busy={busy} disabled={instruction.trim().length < 5} className="w-full">Draft a batch →</Button>
        <p className="text-[11px] leading-relaxed text-muted">
          The model proposes payments only to your contacts, with a reason for each. Code drops anything else, then runs every check. Nothing is paid until the owner approves and the vault releases the money.
        </p>
      </form>
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
    <Card eyebrow="Or import today’s file" title="Import and screen" action={<Counter n={Object.keys(FLAGS).length} />}>
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

// The operator's USDT sits in AnsimVault. Money reaches the families only through an owner-approved release.
function VaultCard() {
  const [v, setV] = useState<Vault | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<Vault | null>('/api/vault').then(setV).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (name: string, action: () => Promise<Vault | null>) => {
    setBusy(name);
    setError(null);
    try {
      setV(await action());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const freeze = (frozen: boolean) =>
    run('freeze', async () =>
      v!.ownerIsDemoKey
        ? api<Vault>('/api/vault/freeze', { json: { frozen } })
        : api<Vault>('/api/vault/freeze', { json: { txid: await sendWithTronLink(v!.address, v!.abi, 'setFrozen', [frozen]) } }),
    );

  if (v === undefined) return <Card eyebrow="On-chain vault · AnsimVault" title="Vault"><ErrorLine error={error} /><p className="text-xs text-muted">Reading the vault on Nile…</p></Card>;
  if (v === null) return <Card eyebrow="On-chain vault · AnsimVault" title="Vault"><Callout>No vault is deployed yet. Run npm run deploy:vault.</Callout></Card>;
  return (
    <Card
      id="vault"
      eyebrow="On-chain vault · AnsimVault"
      title={v.frozen ? 'Vault frozen by the owner' : 'Vault'}
      action={<Button kind={v.frozen ? 'primary' : 'danger'} busy={busy === 'freeze'} onClick={() => freeze(!v.frozen)}>{v.frozen ? 'Unfreeze vault' : 'Freeze vault'}</Button>}
    >
      <div className="grid gap-5">
        <ErrorLine error={error} />
        {v.frozen && <Callout tone="warn">No batch can take money from the vault until the owner unfreezes it.</Callout>}
        <div className="rounded-lg border border-[#26382c] bg-sunken p-5">
          <div className="flex flex-wrap justify-between gap-2 font-mono text-[9px] tracking-[0.1em] text-[#8ca492]">
            <span>HELD BY THE CONTRACT</span>
            <span>RELEASES ONLY OWNER-APPROVED BATCHES</span>
          </div>
          <div className="mt-5 flex flex-wrap items-baseline gap-x-3">
            <span className="num text-[44px] leading-none tracking-[-0.04em]">{usdt(v.balance)}</span>
            <span className="text-muted">USDT in the vault</span>
          </div>
          <ol className="mt-5 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 font-mono text-[10px]">
            <li className="rounded-md border border-[#3f5a3d] bg-celadon-soft px-2.5 py-2 text-celadon">VAULT<span className="block text-[#c6d6bf]">{usdt(v.balance)}</span></li>
            <li aria-hidden className="text-muted">→</li>
            <li className="rounded-md border border-line px-2.5 py-2 text-[#c8d1c7]">GASFREE ACCOUNT<span className="block text-muted">{usdt(v.payoutBalance)}</span></li>
            <li aria-hidden className="text-muted">→</li>
            <li className="rounded-md border border-line px-2.5 py-2 text-[#c8d1c7]">FAMILIES<span className="block text-muted">no TRX needed</span></li>
          </ol>
        </div>
        <div className="grid grid-cols-2 gap-y-4 sm:grid-cols-3">
          <Stat label="Released so far" value={usdt(v.releasedTotal)} />
          <Stat label="Approved batches" value={v.releases} />
          <Stat label="Owner" value={<span className="text-sm"><Addr a={v.owner} /></span>} />
        </div>
        {v.payoutBalance > v.feePerPayment && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-3.5 py-3 text-xs text-muted">
            <span>{usdt(v.payoutBalance)} USDT is sitting idle in the GasFree account.</span>
            <Button kind="secondary" busy={busy === 'return'} onClick={() => run('return', () => api<Vault>('/api/vault/return', { json: {} }))}>Move it into the vault</Button>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-muted">
          The contract sends money only to the payer’s GasFree account, only for a batch the owner approved with a TIP-712 signature, once per approval, and never more than the approved total plus {usdt(v.feePerPayment)} USDT per payment. It checks the owner’s signature itself, so even a hacked Ansim server cannot take more than one approved batch.
        </p>
        <a href={tronscanAddress(v.address)} target="_blank" rel="noopener" className="w-fit text-xs text-celadon hover:underline">AnsimVault on TronScan ↗</a>
      </div>
    </Card>
  );
}

// Recent payments across all batches, drawn from Seoul to each family's country.
function RecentMap() {
  const [payments, setPayments] = useState<FlowPayment[]>([]);
  useEffect(() => {
    let stop = false;
    const tick = () => api<FlowPayment[]>('/api/payments/recent').then((p) => !stop && setPayments(p)).catch(() => {});
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return (
    <Card eyebrow="Observable evidence · live" title="Where the money went">
      <FlowMap payments={payments} />
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
  ['The contact stays under its 30-day cap', 'OVER_MONTHLY_PAYEE_CAP'],
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

  // A new policy's registry record confirms a few seconds after signing. Look again until it shows, for up to a minute.
  const recording = policy.policy?.status === 'ACTIVE' && !policy.policy.anchor_tx ? policy.policy.id : null;
  useEffect(() => {
    if (!recording) return;
    let tries = 0;
    const t = setInterval(() => (++tries > 15 ? clearInterval(t) : load()), 4000);
    return () => clearInterval(t);
  }, [recording, load]);

  return (
    <div>
      <Hero />
      {status && <Modebar s={status} />}
      <ErrorLine error={error} />
      {!status && !error && <p className="text-muted">Loading…</p>}
      {status && (
        <>
          <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1.8fr)_minmax(315px,1fr)]">
            <PolicyDesk status={status} policy={policy.policy} committed={policy.committed} reload={load} />
            <div className="grid min-w-0 gap-[18px]">
              <AgentCard />
              <ImportCard />
            </div>
          </div>
          <div className="mt-[18px] grid items-start gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <VaultCard />
            <RecentMap />
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
