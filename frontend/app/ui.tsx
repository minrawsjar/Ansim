'use client';

import { useState } from 'react';
import { FLAGS, tronscanTx } from './lib';

export function Card({ title, action, children, className = '' }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border border-line bg-surface ${className}`}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-bold">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Button({ kind = 'secondary', busy, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean }) {
  const styles = {
    primary: 'bg-celadon text-white hover:brightness-110 border-celadon',
    secondary: 'bg-surface text-ink hover:border-celadon border-line',
    danger: 'bg-surface text-stop border-stop/40 hover:bg-stop/5',
  }[kind];
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-celadon disabled:cursor-not-allowed disabled:opacity-45 ${styles} ${props.className ?? ''}`}
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
  RUNNING: 'bg-celadon-soft text-celadon border-celadon/30',
  WAITING: 'bg-celadon-soft text-celadon border-celadon/30',
  INPROGRESS: 'bg-celadon-soft text-celadon border-celadon/30',
  CONFIRMING: 'bg-celadon-soft text-celadon border-celadon/30',
  SIGNED: 'bg-celadon-soft text-celadon border-celadon/30',
  SUBMITTED: 'bg-celadon-soft text-celadon border-celadon/30',
};
const STATE_LABEL: Record<string, string> = {
  READY: 'Ready', SIGNED: 'Signed', SUBMITTED: 'Sent', WAITING: 'Waiting', INPROGRESS: 'Processing', CONFIRMING: 'Confirming',
  SUCCEED: 'Paid', FAILED: 'Failed', REFUSED: 'Refused', UNKNOWN: 'Checking', REVIEW: 'In review', RUNNING: 'Paying',
  PAUSED: 'Paused', CLOSED: 'Closed', ACTIVE: 'Active', STOPPED: 'Stopped', REPLACED: 'Replaced', DRAFT: 'Draft',
};

export function StatePill({ state }: { state: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium ${STATE_STYLE[state] ?? 'border-line bg-paper text-muted'}`}>
      {STATE_LABEL[state] ?? state}
    </span>
  );
}

export function FlagChip({ flag }: { flag: string }) {
  const f = FLAGS[flag] ?? { label: flag, tip: flag };
  return (
    <span title={f.tip} className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium ${f.blocking ? 'border-stop/40 bg-stop/10 text-stop' : 'border-warn/40 bg-warn/10 text-warn'}`}>
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
      className="rounded border border-line px-1.5 text-[11px] text-muted hover:border-celadon hover:text-celadon"
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-md border border-stop/30 bg-stop/5 px-3 py-2 text-sm text-stop">{error}</p>;
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'stop' }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'stop' ? 'text-stop' : 'text-ink';
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className={`num font-mono text-lg font-medium ${color}`}>{value}</div>
    </div>
  );
}
