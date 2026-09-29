import Link from 'next/link';
import { ConnectWallet } from '../wallet';

const REPO = 'https://github.com/minrawsjar/Ansim';

// The operator console: header, navigation and footer. The family receipt page (/r) has none of this.
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex h-[72px] max-w-[1510px] items-center justify-between gap-6 px-4 sm:h-[84px] sm:px-[4.5%]">
          <Link href="/" aria-label="Ansim home" className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-celadon text-lg font-bold text-on-celadon">안</span>
            <b className="text-[24px] tracking-[-0.05em] sm:text-[26px]">Ansim</b>
            <span className="ml-1.5 hidden max-w-32 border-l border-line pl-4 font-mono text-[9px] leading-[1.7] tracking-[0.15em] text-muted lg:block">PAYOUTS, INSIDE THE SIGNED LINE</span>
          </Link>
          <nav className="hidden gap-7 text-xs text-muted md:flex">
            <Link href="/#contacts" className="hover:text-celadon">Contacts</Link>
            <Link href="/#limits" className="hover:text-celadon">Payment limits</Link>
            <Link href="/#batches" className="hover:text-celadon">Batches</Link>
            <Link href="/payments" className="hover:text-celadon">Payments</Link>
            <Link href="/stage" className="text-celadon hover:underline">Live demo</Link>
            <Link href="/disputes" className="hover:text-celadon">Disputes</Link>
            <Link href="/metrics" className="hover:text-celadon">Tokens &amp; energy</Link>
            <a href={REPO} target="_blank" rel="noopener" className="hover:text-celadon">Source ↗</a>
          </nav>
          <ConnectWallet />
        </div>
      </header>
      <main className="mx-auto max-w-[1510px] px-4 sm:px-[4.5%]">{children}</main>
      <footer className="mx-auto flex max-w-[1510px] flex-col gap-3 px-4 py-8 text-[11px] text-[#7d9181] sm:flex-row sm:items-center sm:justify-between sm:px-[4.5%]">
        <div>
          <b className="mr-4 text-[17px] tracking-[-0.05em] text-[#a9baa9]">Ansim</b>
          <span>Pays inside the line. Records every refusal.</span>
        </div>
        <span>
          USDT on TRON Nile through GasFree · AI: gpt-oss ·{' '}
          <a href={REPO} target="_blank" rel="noopener" className="underline hover:text-celadon">Source ↗</a>
        </span>
      </footer>
    </>
  );
}
