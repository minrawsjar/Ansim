'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, usdt, tronscanTx } from '../../lib';

type Receipt = {
  status: 'paid' | 'on_the_way' | 'not_sent'; sender: string | null; name: string | null; amount: number | null; note: string | null;
  wallet: string; country: string | null; txnHash: string | null; paidAt: number | null;
};
type Words = {
  locale: string; heading: string; check: string; noFee: string;
  paid: (s: string, n: string, a: string, w: string, date: string, time: string) => string;
  onTheWay: (s: string, n: string, a: string) => string;
  notSent: string;
};

// Plain, short sentences so they survive translation. They should still be checked by a native speaker.
const LANG: Record<string, Words> = {
  vi: {
    locale: 'vi-VN', heading: 'Biên nhận chuyển tiền', check: 'Kiểm tra trên TRONSCAN', noFee: 'Số tiền nhận được không bị trừ phí.',
    paid: (s, n, a, w, date, time) => `${s} đã gửi ${a} USDT cho ${n}. Tiền đã vào ví có đuôi ${w} lúc ${time} ngày ${date}.`,
    onTheWay: (s, n, a) => `${s} đang gửi ${a} USDT cho ${n}. Tiền đang trên đường đến.`,
    notSent: 'Khoản tiền này chưa được gửi. Vui lòng liên hệ người gửi.',
  },
  tl: {
    locale: 'fil-PH', heading: 'Resibo ng padala', check: 'Tingnan sa TRONSCAN', noFee: 'Walang bayad na ibinawas sa halagang ito.',
    paid: (s, n, a, w, date, time) => `Nagpadala si ${s} ng ${a} USDT kay ${n}. Pumasok ito sa wallet na nagtatapos sa ${w} noong ${date}, ${time}.`,
    onTheWay: (s, n, a) => `Nagpapadala si ${s} ng ${a} USDT kay ${n}. Papunta na ito.`,
    notSent: 'Hindi naipadala ang perang ito. Makipag-ugnayan sa nagpadala.',
  },
  ne: {
    locale: 'ne-NP', heading: 'रकम पठाएको रसिद', check: 'TRONSCAN मा हेर्नुहोस्', noFee: 'यो रकमबाट कुनै शुल्क काटिएको छैन।',
    paid: (s, n, a, w, date, time) => `${s} ले ${n} लाई ${a} USDT पठाउनुभयो। यो ${date} ${time} मा ${w} मा अन्त्य हुने वालेटमा आइपुग्यो।`,
    onTheWay: (s, n, a) => `${s} ले ${n} लाई ${a} USDT पठाउँदै हुनुहुन्छ। यो बाटोमा छ।`,
    notSent: 'यो रकम पठाइएको छैन। कृपया पठाउने व्यक्तिलाई सम्पर्क गर्नुहोस्।',
  },
  ko: {
    locale: 'ko-KR', heading: '송금 영수증', check: 'TRONSCAN에서 확인하기', noFee: '받는 금액에서 수수료가 빠지지 않았습니다.',
    paid: (s, n, a, w, date, time) => `${s}님이 ${n}님께 ${a} USDT를 보냈습니다. ${date} ${time}에 끝자리 ${w} 지갑으로 입금되었습니다.`,
    onTheWay: (s, n, a) => `${s}님이 ${n}님께 ${a} USDT를 보내는 중입니다.`,
    notSent: '이 송금은 보내지지 않았습니다. 송금한 분께 문의해 주세요.',
  },
  en: {
    locale: 'en-GB', heading: 'Payment receipt', check: 'Check it on TRONSCAN', noFee: 'No fee was taken from this amount.',
    paid: (s, n, a, w, date, time) => `${s} sent ${a} USDT to ${n}. It arrived in the wallet ending ${w} on ${date} at ${time}.`,
    onTheWay: (s, n, a) => `${s} is sending ${a} USDT to ${n}. It is on its way.`,
    notSent: 'This payment was not sent. Please contact the sender.',
  },
};
const BY_COUNTRY: Record<string, string> = { vietnam: 'vi', philippines: 'tl', nepal: 'ne' };

function Block({ w, r, big }: { w: Words; r: Receipt; big?: boolean }) {
  const s = r.sender || '—';
  const n = r.name || '—';
  const a = usdt(r.amount);
  const at = r.paidAt ?? 0;
  const date = new Intl.DateTimeFormat(w.locale, { dateStyle: 'long' }).format(at);
  const time = new Intl.DateTimeFormat(w.locale, { timeStyle: 'short' }).format(at);
  const line = r.status === 'paid' ? w.paid(s, n, a, r.wallet.slice(-4), date, time) : r.status === 'on_the_way' ? w.onTheWay(s, n, a) : w.notSent;
  return (
    <div lang={w.locale} className="grid gap-1.5">
      <div className="eyebrow">{w.heading}</div>
      <p className={big ? 'text-[19px] leading-snug tracking-[-0.01em]' : 'text-[14px] leading-relaxed text-[#d3ddcf]'}>{line}</p>
      {r.status === 'paid' && <p className="text-[13px] text-muted">{w.noFee}</p>}
      {r.txnHash && (
        <a href={tronscanTx(r.txnHash)} target="_blank" rel="noopener" className="w-fit text-[13px] text-celadon underline-offset-2 hover:underline">{w.check} ↗</a>
      )}
    </div>
  );
}

export default function FamilyReceipt() {
  const { token } = useParams<{ token: string }>();
  const [r, setR] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Receipt>(`/api/receipts/${token}`).then(setR).catch((e) => setError(e.message));
  }, [token]);

  const lang = BY_COUNTRY[(r?.country ?? '').toLowerCase()] ?? 'en';
  const tone = r?.status === 'paid' ? 'text-celadon' : r?.status === 'not_sent' ? 'text-stop' : 'text-warn';
  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-celadon text-lg font-bold text-on-celadon">안</span>
        <b className="text-[22px] tracking-[-0.05em]">Ansim</b>
      </div>
      {error && <p className="text-sm text-stop">{error}</p>}
      {!r && !error && <p className="text-muted">…</p>}
      {r && (
        <section className="grid gap-6 rounded-xl border border-line bg-surface p-6">
          <div className="grid gap-1">
            <span className={`font-mono text-[11px] tracking-[0.12em] uppercase ${tone}`}>{r.status === 'paid' ? '● Arrived' : r.status === 'on_the_way' ? '● On its way' : '● Not sent'}</span>
            <span className="num text-[44px] leading-none tracking-[-0.04em]">{usdt(r.amount)} <span className="text-lg text-muted">USDT</span></span>
            {r.note && <span className="text-[13px] text-muted">{r.note}</span>}
          </div>
          <Block w={LANG[lang]} r={r} big />
          <div className="border-t border-line pt-5"><Block w={LANG.ko} r={r} /></div>
          {lang !== 'en' && <div className="border-t border-line pt-5"><Block w={LANG.en} r={r} /></div>}
          <p className="border-t border-line pt-4 font-mono text-[11px] break-all text-muted">{r.wallet}</p>
        </section>
      )}
    </main>
  );
}
