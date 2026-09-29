import type { Metadata } from 'next';
import Link from 'next/link';
import { Inter, IBM_Plex_Sans_KR, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// Inter for Latin text; Plex Sans KR fills in the Hangul glyphs Inter lacks.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const plex = IBM_Plex_Sans_KR({ weight: ['400', '500', '700'], preload: false, variable: '--font-plex' });
const plexMono = IBM_Plex_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-plex-mono' });

const REPO = 'https://github.com/minrawsjar/Ansim';

export const metadata: Metadata = {
  title: 'Ansim 안심',
  description: 'AI payout desk for USDT on TRON through GasFree, inside limits the owner signed.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${inter.variable} ${plex.variable} ${plexMono.variable}`}>
      <body className="min-h-screen font-sans text-sm leading-normal antialiased">
        <header className="border-b border-line">
          <div className="mx-auto flex h-[72px] max-w-[1510px] items-center justify-between gap-6 px-4 sm:h-[84px] sm:px-[4.5%]">
            <Link href="/" aria-label="Ansim home" className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-celadon text-lg font-bold text-on-celadon">안</span>
              <b className="text-[24px] tracking-[-0.05em] sm:text-[26px]">Ansim</b>
              <span className="ml-1.5 hidden max-w-32 border-l border-line pl-4 font-mono text-[9px] leading-[1.7] tracking-[0.15em] text-muted lg:block">PAYOUTS, INSIDE THE SIGNED LINE</span>
            </Link>
            <nav className="hidden gap-7 text-xs text-muted md:flex">
              <Link href="/#policy" className="hover:text-celadon">Spending policy</Link>
              <Link href="/#batches" className="hover:text-celadon">Batches</Link>
              <Link href="/metrics" className="hover:text-celadon">Tokens &amp; energy</Link>
            </nav>
            <a href={REPO} target="_blank" rel="noopener" className="rounded-[7px] border border-line px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap transition hover:bg-raised">
              Source on GitHub ↗
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-[1510px] px-4 sm:px-[4.5%]">{children}</main>
        <footer className="mx-auto flex max-w-[1510px] flex-col gap-3 px-4 py-8 text-[11px] text-[#7d9181] sm:flex-row sm:items-center sm:justify-between sm:px-[4.5%]">
          <div>
            <b className="mr-4 text-[17px] tracking-[-0.05em] text-[#a9baa9]">Ansim</b>
            <span>Pays inside the line. Records every refusal.</span>
          </div>
          <span>
            USDT on TRON Nile through GasFree · AI on FuriosaAI Kiln, gpt-oss-120b ·{' '}
            <a href={REPO} target="_blank" rel="noopener" className="underline hover:text-celadon">Source ↗</a>
          </span>
        </footer>
      </body>
    </html>
  );
}
