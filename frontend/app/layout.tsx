import type { Metadata } from 'next';
import { Inter, IBM_Plex_Sans_KR, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// Inter for Latin text; Plex Sans KR fills in the Hangul glyphs Inter lacks.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const plex = IBM_Plex_Sans_KR({ weight: ['400', '500', '700'], preload: false, variable: '--font-plex' });
const plexMono = IBM_Plex_Mono({ weight: ['400', '500'], subsets: ['latin'], variable: '--font-plex-mono' });

export const metadata: Metadata = {
  title: 'Ansim 안심',
  description: 'AI payout desk for USDT on TRON through GasFree, inside limits the owner signed.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${inter.variable} ${plex.variable} ${plexMono.variable}`}>
      <body className="min-h-screen font-sans text-sm leading-normal antialiased">
        {children}
      </body>
    </html>
  );
}
