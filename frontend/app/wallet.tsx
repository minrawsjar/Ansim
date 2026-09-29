'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, connectTronLink, tronLinkState, tronscanAddress } from './lib';

type State = Awaited<ReturnType<typeof tronLinkState>>;
const BUTTON = 'inline-flex items-center gap-2 rounded-[7px] border px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap transition disabled:opacity-50';

// TronLink's account and network, kept current: TronLink injects itself shortly after the page loads and
// posts a message when the account or network changes. Never opens a popup.
export function useTronLink() {
  const [state, setState] = useState<State | null>(null);
  const refresh = useCallback(() => {
    tronLinkState().then(setState).catch(() => {});
  }, []);
  useEffect(() => {
    const timers = [0, 800, 2500].map((ms) => setTimeout(refresh, ms));
    const onMessage = (e: MessageEvent) => {
      if (e.data?.isTronLink || e.data?.message?.action) refresh();
    };
    window.addEventListener('message', onMessage);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('message', onMessage);
    };
  }, [refresh]);
  return { state, refresh };
}

// The owner's TronLink in the header. Connecting asks TronLink for the account and switches it to Nile;
// signing the payment limits, approving a batch and freezing the vault then use this account.
export function ConnectWallet() {
  const { state: s, refresh } = useTronLink();
  const [owner, setOwner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ owner: string } | null>('/api/vault').then((v) => setOwner(v?.owner ?? null)).catch(() => {});
  }, []);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectTronLink();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (s && !s.installed) {
    return (
      <a href="https://www.tronlink.org/" target="_blank" rel="noopener" className={`${BUTTON} border-line hover:bg-raised`}>
        Install TronLink ↗
      </a>
    );
  }
  if (!s?.address) {
    return (
      <button type="button" onClick={connect} disabled={busy} title={error ?? undefined} className={`${BUTTON} border-celadon bg-celadon text-on-celadon hover:bg-[#d8f6cd]`}>
        {busy ? 'Connecting…' : error ? 'Retry connecting' : 'Connect TronLink'}
      </button>
    );
  }
  if (s.onNile === false) {
    return (
      <button type="button" onClick={connect} disabled={busy} title="Ansim runs on TRON Nile testnet" className={`${BUTTON} border-warn/50 bg-warn/10 text-warn`}>
        {busy ? 'Switching…' : 'Switch TronLink to Nile'}
      </button>
    );
  }
  const isOwner = owner === s.address;
  return (
    <a
      href={tronscanAddress(s.address)}
      target="_blank"
      rel="noopener"
      title={`${s.address}${owner && !isOwner ? `\nThe vault's owner is ${owner}` : ''}`}
      className={`${BUTTON} border-[#3f5a3d] bg-celadon-soft text-[#d4e6cd] hover:bg-raised`}
    >
      <i className="h-1.5 w-1.5 rounded-full bg-celadon shadow-[0_0_6px_var(--color-celadon)]" />
      <span className="font-mono text-[10px] tracking-[0.08em] text-muted">NILE</span>
      <span className="font-mono">{s.address.slice(0, 4)}…{s.address.slice(-4)}</span>
      {isOwner && <span className="rounded-[4px] border border-celadon/40 px-1 font-mono text-[9px] tracking-[0.08em] text-celadon">OWNER</span>}
    </a>
  );
}
