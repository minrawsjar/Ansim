'use client';

import { useEffect, useRef, useState } from 'react';
import { api, usdt, tronscanTx } from '../lib';
import { citiesOf } from '../places';
import type { PermitDraft } from './wallet';

// Live demo: this phone becomes a family. It makes its own TRON wallet (the key never leaves the phone),
// asks the operator to be added as a contact, and then watches its payment arrive. With GasFree it can
// send the USDT back without ever holding TRX.

type Payment = { state: string; amount: number | null; reason: string | null; txnHash: string | null; receiptToken: string | null; paidAt: number | null };
type SentBack = { state: string; value: number; txnHash: string | null };
type Status = {
  status: 'pending' | 'accepted' | 'rejected'; name: string; country: string; city: string | null; address: string; wallet: string;
  payableAt: number | null; payment: Payment | null; sentBack: SentBack | null; balance: number | null;
  fx: { currency: string; perUsdt: number; live: boolean } | null;
};
type Saved = { privateKey: string; address: string; token?: string };
type Draft = PermitDraft & { fee: { transfer: number; activation: number } };

const KEY = 'ansim-join-wallet';
const load = (): Saved | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
};
const save = (s: Saved) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode: the wallet lives until the tab closes
  }
};

// Short lines in the family's language, English under them. They should still be checked by a native speaker.
type Words = { locale: string; waiting: string; accepted: string; onTheWay: (a: string) => string; arrived: (a: string) => string; sendBack: string; sentBack: string };
const WORDS: Record<string, Words> = {
  Vietnam: {
    locale: 'vi-VN', waiting: 'Đang chờ nhà vận hành chấp nhận', accepted: 'Bạn đã là người nhận. Đang chờ chuyển tiền.',
    onTheWay: (a) => `${a} USDT đang trên đường đến`, arrived: (a) => `Đã nhận ${a} USDT`, sendBack: 'Gửi trả lại', sentBack: 'Đã gửi trả lại',
  },
  Philippines: {
    locale: 'fil-PH', waiting: 'Hinihintay na tanggapin ka ng operator', accepted: 'Kasama ka na sa mga padadalhan. Hinihintay ang padala.',
    onTheWay: (a) => `Papunta na ang ${a} USDT`, arrived: (a) => `Dumating na ang ${a} USDT`, sendBack: 'Ibalik ito', sentBack: 'Naibalik na',
  },
  Nepal: {
    locale: 'ne-NP', waiting: 'सञ्चालकले स्वीकार गर्ने प्रतीक्षा गर्दै', accepted: 'तपाईं प्रापक बन्नुभयो। रकम पठाउने प्रतीक्षा गर्दै।',
    onTheWay: (a) => `${a} USDT बाटोमा छ`, arrived: (a) => `${a} USDT आइपुग्यो`, sendBack: 'फिर्ता पठाउनुहोस्', sentBack: 'फिर्ता पठाइयो',
  },
};
const EN: Words = {
  locale: 'en-GB', waiting: 'Waiting for the operator to accept you', accepted: 'You are a contact now. Waiting to be paid.',
  onTheWay: (a) => `${a} USDT is on its way`, arrived: (a) => `${a} USDT arrived`, sendBack: 'Send it back', sentBack: 'Sent back',
};
const FLAG: Record<string, string> = { Vietnam: '🇻🇳', Philippines: '🇵🇭', Nepal: '🇳🇵' };
const DONE = new Set(['SUCCEED', 'FAILED', 'REFUSED']);

function Say({ w, pick, className = '' }: { w: Words; pick: (x: Words) => string; className?: string }) {
  return (
    <span className={`grid gap-0.5 ${className}`}>
      <span lang={w.locale}>{pick(w)}</span>
      {w !== EN && <span lang="en" className="text-[0.8em] opacity-65">{pick(EN)}</span>}
    </span>
  );
}

// A two-note chime and a buzz when the money lands. Browsers only play sound after a tap, so the first tap
// on the page unlocks it; phones without vibration just skip the buzz.
let audio: AudioContext | null = null;
const unlockSound = () => {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    audio = null;
  }
};
function celebrate() {
  navigator.vibrate?.([180, 80, 180, 80, 320]);
  if (!audio) return;
  const t = audio.currentTime;
  [880, 1318.5].forEach((f, i) => {
    const o = audio!.createOscillator(), g = audio!.createGain(), at = t + i * 0.14;
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    o.connect(g).connect(audio!.destination);
    o.start(at);
    o.stop(at + 0.65);
  });
}

const money = (micro: number, fx: Status['fx'], locale: string) =>
  fx ? new Intl.NumberFormat(locale, { style: 'currency', currency: fx.currency, maximumFractionDigits: 0 }).format((micro / 1e6) * fx.perUsdt) : null;

function useNow(every: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

function JoinForm({ wallet, onJoined }: { wallet: Saved; onJoined: (token: string) => void }) {
  const [name, setName] = useState('');
  const [country, setCountry] = useState('Vietnam');
  const [city, setCity] = useState('Hanoi');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    unlockSound();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>('/api/join', { json: { address: wallet.address, name, country, city } });
      onJoined(r.token);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={join} className="grid gap-5 rounded-xl border border-line bg-surface p-6">
      <div className="grid gap-1.5">
        <span className="eyebrow">Your phone made a wallet</span>
        <span className="font-mono text-[13px] break-all">{wallet.address}</span>
        <span className="text-[12px] text-muted">A new TRON Nile test wallet with 0 TRX. The key stays on this phone.</span>
      </div>
      <label className="grid gap-1.5 text-[13px]">
        <span className="text-muted">Your name</span>
        <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Minh" className="px-3 py-3 text-base" autoComplete="off" />
      </label>
      <fieldset className="grid gap-1.5 text-[13px]">
        <legend className="mb-1.5 text-muted">Your family lives in</legend>
        <div className="grid grid-cols-3 gap-2">
          {Object.keys(FLAG).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCountry(c);
                setCity(citiesOf(c)[0] ?? '');
              }}
              className={`rounded-[7px] border px-2 py-3 text-[13px] ${country === c ? 'border-celadon bg-celadon-soft text-celadon' : 'border-line text-[#c8d1c7]'}`}
            >
              <span className="block text-2xl">{FLAG[c]}</span>
              {c}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-1.5 text-[13px]">
        <span className="text-muted">City</span>
        <select value={city} onChange={(e) => setCity(e.target.value)} className="px-3 py-3 text-base">
          {citiesOf(country).map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      {error && <p className="text-[13px] text-stop">{error}</p>}
      <button type="submit" disabled={busy || !name.trim()} className="rounded-[7px] border border-celadon bg-celadon px-4 py-3.5 text-[15px] font-semibold text-on-celadon disabled:opacity-60">
        {busy ? 'Joining…' : 'Join as a family →'}
      </button>
    </form>
  );
}

function SendBack({ s, wallet, words, onSent }: { s: Status; wallet: Saved; words: Words; onSent: (s: Status) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      setDraft(await api<Draft>(`/api/join/${wallet.token}/send-back`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const { signPermit } = await import('./wallet');
      const sig = signPermit(wallet.privateKey, draft); // signed here, on the phone
      onSent(await api<Status>(`/api/join/${wallet.token}/send-back`, { json: { message: draft.message, sig } }));
    } catch (e) {
      setError((e as Error).message);
      setDraft(null);
    } finally {
      setBusy(false);
    }
  };
  const sb = s.sentBack;
  if (sb && sb.state !== 'FAILED') {
    return (
      <div className="grid gap-2 border-t border-line pt-5">
        <span className={`font-mono text-[11px] tracking-[0.12em] uppercase ${sb.state === 'SUCCEED' ? 'text-celadon' : 'text-warn'}`}>{sb.state === 'SUCCEED' ? '● Sent back' : '● Sending back'}</span>
        <Say w={words} pick={(x) => (sb.state === 'SUCCEED' ? `${x.sentBack} · ${usdt(sb.value)} USDT` : `${x.sendBack}… ${usdt(sb.value)} USDT`)} className="text-[17px]" />
        <p className="text-[12px] text-muted">To the operator’s vault, signed on this phone, network fee paid by GasFree. This wallet never needed TRX.</p>
        {sb.txnHash && <a href={tronscanTx(sb.txnHash)} target="_blank" rel="noopener" className="w-fit text-[13px] text-celadon underline-offset-2 hover:underline">Check it on TRONSCAN ↗</a>}
      </div>
    );
  }
  return (
    <div className="grid gap-3 border-t border-line pt-5">
      {!draft ? (
        <button type="button" onClick={prepare} disabled={busy} className="rounded-[7px] border border-line px-4 py-3 text-[14px] font-semibold text-[#c8d1c7] hover:bg-raised disabled:opacity-60">
          {busy ? '…' : <Say w={words} pick={(x) => `↩ ${x.sendBack}`} />}
        </button>
      ) : (
        <div className="grid gap-3 rounded-lg border border-line bg-sunken p-4 text-[13px]">
          <p>
            Send <b>{usdt(Number(draft.message.value))} USDT</b> back to the operator’s vault. GasFree takes <b>{usdt(draft.fee.transfer + draft.fee.activation)} USDT</b> from the USDT
            {draft.fee.activation > 0 ? ` (${usdt(draft.fee.transfer)} fee + ${usdt(draft.fee.activation)} once, to open this wallet’s GasFree account)` : ''}. No TRX.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setDraft(null)} className="rounded-[7px] border border-line px-3 py-2.5 text-[#c8d1c7]">Cancel</button>
            <button type="button" onClick={send} disabled={busy} className="rounded-[7px] border border-celadon bg-celadon px-3 py-2.5 font-semibold text-on-celadon disabled:opacity-60">{busy ? 'Signing…' : 'Sign and send'}</button>
          </div>
        </div>
      )}
      {error && <p className="text-[13px] text-stop">{error}</p>}
    </div>
  );
}

export default function JoinPage() {
  const [wallet, setWallet] = useState<Saved | null>(null);
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const paidBefore = useRef<boolean | null>(null);
  const now = useNow(1000);

  // The wallet is made once and kept in this browser.
  useEffect(() => {
    import('./wallet').then(({ newWallet }) => {
      const w = load() ?? newWallet();
      save(w);
      setWallet(w);
    });
  }, []);
  useEffect(() => {
    window.addEventListener('pointerdown', unlockSound, { once: true });
    return () => window.removeEventListener('pointerdown', unlockSound);
  }, []);

  useEffect(() => {
    if (!wallet?.token) return;
    let stop = false;
    const tick = () =>
      api<Status>(`/api/join/${wallet.token}`)
        .then((next) => {
          if (stop) return;
          const paid = next.payment?.state === 'SUCCEED';
          if (paid && paidBefore.current === false) celebrate(); // only when it lands while watching
          paidBefore.current = paid;
          setS(next);
          setError(null);
        })
        .catch((e) => !stop && setError(e.message));
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [wallet?.token]);

  const words = (s && WORDS[s.country]) || EN;
  const p = s?.payment;
  const paid = p?.state === 'SUCCEED';
  const waitLeft = s?.payableAt ? Math.max(0, s.payableAt * 1000 - now) : 0;

  return (
    <main className="mx-auto grid min-h-screen max-w-md content-start gap-6 px-4 py-8">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-celadon text-lg font-bold text-on-celadon">안</span>
        <b className="text-[22px] tracking-[-0.05em]">Ansim</b>
        <span className="ml-auto font-mono text-[10px] tracking-[0.12em] text-muted">LIVE DEMO · NILE</span>
      </div>
      {!wallet && <p className="text-muted">Making a wallet on this phone…</p>}
      {wallet && !wallet.token && (
        <JoinForm
          wallet={wallet}
          onJoined={(token) => {
            const w = { ...wallet, token };
            save(w);
            paidBefore.current = false;
            setWallet(w);
          }}
        />
      )}
      {wallet?.token && !s && !error && <p className="text-muted">…</p>}
      {error && <p className="text-[13px] text-stop">{error}</p>}
      {s && (
        <section className={`grid gap-6 rounded-xl border bg-surface p-6 transition-colors ${paid ? 'border-celadon shadow-[0_0_40px_-12px_var(--color-celadon)]' : 'border-line'}`}>
          <div className="grid gap-1">
            <span className="text-[13px] text-muted">{FLAG[s.country]} {s.name} · {s.city ?? s.country}</span>
            {s.status === 'rejected' && <p className="text-stop">The operator did not accept this phone.</p>}
            {s.status === 'pending' && (
              <>
                <span className="font-mono text-[11px] tracking-[0.12em] text-warn uppercase"><span className="pulse mr-2 inline-block align-middle" />Waiting</span>
                <Say w={words} pick={(x) => x.waiting} className="text-[19px] leading-snug" />
              </>
            )}
            {s.status === 'accepted' && !p && (
              <>
                <span className="font-mono text-[11px] tracking-[0.12em] text-celadon uppercase">● Contact</span>
                <Say w={words} pick={(x) => x.accepted} className="text-[19px] leading-snug" />
                {waitLeft > 0 && (
                  <p className="mt-2 text-[12px] text-muted">
                    New contacts wait before they can be paid, like a bank’s delayed transfer (지연이체). Payable in{' '}
                    <b className="num text-ink">{Math.floor(waitLeft / 60000)}:{String(Math.floor(waitLeft / 1000) % 60).padStart(2, '0')}</b>.
                  </p>
                )}
              </>
            )}
            {p && !paid && !DONE.has(p.state) && (
              <>
                <span className="font-mono text-[11px] tracking-[0.12em] text-warn uppercase"><span className="pulse mr-2 inline-block align-middle" />On its way</span>
                <Say w={words} pick={(x) => x.onTheWay(usdt(p.amount))} className="text-[24px] leading-snug" />
              </>
            )}
            {p && (p.state === 'REFUSED' || p.state === 'FAILED') && (
              <p className="text-stop">This payment was not sent{p.reason ? `: ${p.reason.replaceAll('_', ' ').toLowerCase()}` : ''}.</p>
            )}
            {paid && p && (
              <>
                <span className="font-mono text-[11px] tracking-[0.12em] text-celadon uppercase">● Arrived</span>
                <span className="num text-[52px] leading-none tracking-[-0.04em] text-celadon">{usdt(p.amount)} <span className="text-lg text-muted">USDT</span></span>
                {s.fx && p.amount != null && (
                  <span className="num text-[20px] text-ink">≈ {money(p.amount, s.fx, words.locale)} <span className="text-[11px] text-muted">{s.fx.live ? 'at today’s rate' : 'approximate rate'}</span></span>
                )}
                <Say w={words} pick={(x) => x.arrived(usdt(p.amount))} className="mt-2 text-[17px]" />
              </>
            )}
          </div>
          {paid && p && (
            <div className="grid gap-2 text-[13px]">
              {p.txnHash && <a href={tronscanTx(p.txnHash)} target="_blank" rel="noopener" className="w-fit text-celadon underline-offset-2 hover:underline">Check it on TRONSCAN ↗</a>}
              {p.receiptToken && <a href={`/r/${p.receiptToken}`} target="_blank" rel="noopener" className="w-fit text-muted underline-offset-2 hover:text-celadon hover:underline">Open the family receipt ↗</a>}
              {s.balance != null && <span className="text-muted">This wallet holds <b className="num text-ink">{usdt(s.balance)} USDT</b> and no TRX.</span>}
            </div>
          )}
          {paid && <SendBack s={s} wallet={wallet!} words={words} onSent={setS} />}
          <p className="border-t border-line pt-4 font-mono text-[11px] break-all text-muted">Paid to this phone’s GasFree account {s.wallet}</p>
        </section>
      )}
      <p className="text-center text-[11px] leading-relaxed text-muted">A test wallet on TRON Nile. Test USDT has no value. The key never leaves this phone.</p>
    </main>
  );
}
