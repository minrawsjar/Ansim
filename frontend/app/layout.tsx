import type { Metadata } from 'next';
import Link from 'next/link';
import { IBM_Plex_Sans_KR, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const plex = IBM_Plex_Sans_KR({ weight: ['400', '500', '700'], preload: false, variable: '--font-plex' });
const plexMono = IBM_Plex_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-plex-mono' });

export const metadata: Metadata = {
  title: 'Ansim 안심',
  description: 'AI payout desk for USDT on TRON through GasFree, inside limits the owner signed.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${plex.variable} ${plexMono.variable}`}>
      <body className="min-h-screen font-sans text-[15px] antialiased">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-celadon">안심</span>
              <span className="font-mono text-sm font-medium">Ansim</span>
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="hover:text-celadon">Console</Link>
              <Link href="/metrics" className="hover:text-celadon">Tokens &amp; energy</Link>
            </nav>
            <span className="ml-auto rounded-full border border-line px-2.5 py-1 font-mono text-xs text-muted">TRON Nile testnet</span>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
