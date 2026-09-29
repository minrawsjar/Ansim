'use client';

import { useState } from 'react';
import { FLAGS, tronscanTx } from './lib';

export function Card({ eyebrow, title, action, children, className = '', id }: { eyebrow?: string; title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`min-w-0 scroll-mt-6 rounded-xl border border-line bg-surface ${className}`}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4 sm:px-6">
          <div className="min-w-0">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 className="mt-1.5 text-lg font-medium tracking-[-0.025em]">{title}</h2>
          </div>
          {action}
        </div>
      )}
      <div className={`px-5 pb-5 sm:px-6 ${title ? '' : 'pt-5'}`}>{children}</div>
    </section>
  );
}

// A quiet note inside a panel, for context that should not compete with the data.
export function Callout({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  const color = tone === 'warn' ? 'border-warn/30 bg-warn/5 text-warn' : 'border-[#354b38] bg-[#202d23] text-[#b6cdae]';
  return <div className={`rounded-md border px-3.5 py-3 text-xs leading-relaxed ${color}`}>{children}</div>;
}

export function Button({ kind = 'secondary', busy, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'quiet' | 'danger'; busy?: boolean }) {
  const styles = {
    primary: 'bg-celadon text-on-celadon border-celadon hover:bg-[#d8f6cd] hover:border-[#d8f6cd]',
    secondary: 'bg-raised text-[#d4e6cd] border-edge hover:bg-[#314a34]',
    quiet: 'bg-transparent text-[#c8d1c7] border-line hover:bg-raised',
    danger: 'bg-[#302723] text-[#e4b0a6] border-[#704941] hover:bg-[#47332d]',
  }[kind];
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-[7px] border px-3.5 py-2.5 text-xs font-semibold transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 ${styles} ${props.className ?? ''}`}
    >
      {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

const STATE_STYLE: Record<string, string> = {
  SUCCEED: 'bg-ok/10 text-ok border-ok/30',
  ACTIVE: 'bg-ok/10 text-ok border-ok/30',
  CLOSED: 'bg-ok/10 text-ok border-ok/30',
  REFUSED: 'bg-stop/10 text-stop border-stop/30',
  FAILED: 'bg-stop/10 text-stop border-stop/30',
  STOPPED: 'bg-stop/10 text-stop border-stop/30',
  UNKNOWN: 'bg-warn/10 text-warn border-warn/30',
  PAUSED: 'bg-warn/10 text-warn border-warn/30',
  RUNNING: 'bg-celadon-soft text-celadon border-celadon/35',
  WAITING: 'bg-celadon-soft text-celadon border-celadon/35',
  INPROGRESS: 'bg-celadon-soft text-celadon border-celadon/35',
  CONFIRMING: 'bg-celadon-soft text-celadon border-celadon/35',
  SIGNED: 'bg-celadon-soft text-celadon border-celadon/35',
  SUBMITTED: 'bg-celadon-soft text-celadon border-celadon/35',
};
const STATE_LABEL: Record<string, string> = {
  READY: 'Ready', SIGNED: 'Signed', SUBMITTED: 'Sent', WAITING: 'Waiting', INPROGRESS: 'Processing', CONFIRMING: 'Confirming',
  SUCCEED: 'Paid', FAILED: 'Failed', REFUSED: 'Refused', UNKNOWN: 'Checking', REVIEW: 'In review', RUNNING: 'Paying',
  PAUSED: 'Paused', CLOSED: 'Closed', ACTIVE: 'Active', STOPPED: 'Stopped', REPLACED: 'Replaced', DRAFT: 'Draft',
};

export function StatePill({ state }: { state: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-[4px] border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] uppercase ${STATE_STYLE[state] ?? 'border-line text-muted'}`}>
      {STATE_LABEL[state] ?? state}
    </span>
  );
}

export function FlagChip({ flag }: { flag: string }) {
  const f = FLAGS[flag] ?? { label: flag, tip: flag };
  return (
    <span title={f.tip} className={`inline-block whitespace-nowrap rounded-[4px] border px-1.5 py-0.5 text-[11px] font-medium ${f.blocking ? 'border-stop/40 bg-stop/10 text-stop' : 'border-warn/40 bg-warn/10 text-warn'}`}>
      {f.label}
    </span>
  );
}

// Shows the first and last four characters in bold: the part most wallets display, and the part
// address-poisoning scams copy.
export function Addr({ a, full }: { a: string; full?: boolean }) {
  if (!a) return <span className="text-muted">–</span>;
  if (a.length < 12) return <span className="font-mono text-xs">{a}</span>;
  return (
    <span title={a} className="font-mono text-xs whitespace-nowrap">
      <b className="font-semibold">{a.slice(0, 4)}</b>
      <span className="text-muted">{full ? a.slice(4, -4) : `${a.slice(4, 8)}…${a.slice(-8, -4)}`}</span>
      <b className="font-semibold">{a.slice(-4)}</b>
    </span>
  );
}

export function TxLink({ hash, label }: { hash: string | null | undefined; label?: string }) {
  if (!hash) return null;
  return (
    <a href={tronscanTx(hash)} target="_blank" rel="noopener" className="font-mono text-xs text-celadon underline-offset-2 hover:underline">
      {label ?? `${hash.slice(0, 8)}…${hash.slice(-6)}`} ↗
    </a>
  );
}

export function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => {})}
      className="rounded-[4px] border border-line px-1.5 text-[11px] text-muted hover:border-celadon hover:text-celadon"
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-md border border-stop/30 bg-stop/10 px-3.5 py-3 text-xs leading-relaxed text-stop">{error}</p>;
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'stop' }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'stop' ? 'text-stop' : 'text-ink';
  return (
    <div className="min-w-0 border-l border-line pl-3">
      <div className="font-mono text-[9px] tracking-[0.1em] text-muted uppercase">{label}</div>
      <div className={`num mt-1 text-xl font-normal tracking-[-0.02em] ${color}`}>{value}</div>
    </div>
  );
}

// Shown while TronLink waits for the owner. A TIP-712 signature is not a transaction, so TronLink's history stays empty.
export function WaitingForTronLink() {
  return (
    <p className="text-[11px] leading-relaxed text-warn">
      Confirm the signature in the TronLink window. If none opened, click the TronLink icon in the toolbar. This is a signature, not a transaction: it costs nothing and does not appear in TronLink’s history.
    </p>
  );
}
