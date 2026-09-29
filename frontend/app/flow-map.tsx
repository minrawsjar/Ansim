'use client';

import { useSyncExternalStore } from 'react';
import { usdt } from './lib';

export type FlowPayment = {
  id: number | string;
  country: string | null;
  amount: number | null;
  state: string;
  label?: string | null;
};

type Pt = [number, number];
type Kind = 'ready' | 'moving' | 'paid' | 'refused';

// Equirectangular crop 56E–156E, 57N–12S at 10 viewBox units per degree.
const LON0 = 56, LAT0 = 57, W = 1000, H = 690;
const xy = (lat: number, lon: number): Pt => [Math.round((lon - LON0) * 100) / 10, Math.round((LAT0 - lat) * 100) / 10];
// Rounded, so path data stays short.
const s = (p: number[]) => p.map((v) => Math.round(v * 10) / 10).join(' ');

// Land from Natural Earth 110m (public domain), one cell per degree from the top-left corner of the crop.
const LAND = `
##################################################################################..................
#################################################################################..................#
#################################################################################..................#
#####################################################################################.#.............
########################################################################################............
#####################################################################################.##............
#####################################################################################.##............
#####################################################################################.###...........
####################################################################################..#.............
###################################################################################...#.............
##################################################################################....##............
##################################################################################..................
################################################################################.....###............
###############################################################################......#####..........
###########################################################################.........####............
##########################################################################..........#...............
#################################################################.#######...........##..............
################################################################.##..###............##..............
##############################################################.......####..........###..............
##################################################################....###.........###...............
##################################################################....####......#####...............
################################################################......###....########...............
################################################################......##...########.................
#################################################################.........######....................
#################################################################.........##........................
##################################################################........#.........................
##################################################################..................................
##################################################################..................................
##################################################################..................................
#################################################################...................................
.###############################################################....................................
#.##############################################################....................................
#..........####################################################.##..................................
###.........#################################################...##..................................
####.........###############################################....#...................................
###..........####################...####################............................................
###..............##############.....###############...#.............................................
##...............############........#############...##.............................................
#................###########..........############...#...........#..................................
.................##########...........#############.............##..................................
.................#########............##############............##..................................
..................######.................############...........##..................................
..................######..................###########...........###.................................
..................#######.................############...........###................................
...................#####..................##.#########..............#...............................
...................#####..................##...######.............#..#..............................
....................####..................##....####...........#..###...............................
....................###.#.................##.....##...........#...##.#..............................
.....................#..#.................##.......................####.............................
........................##.................##.....................#####.............................
........................##..................##..............##......##..............................
........................................#...###............####.....................................
........................................##..####..........#####.....................................
.........................................###.###.........#####......................................
.........................................#######.......#######......................................
...........................................#####.....##########........##...........................
...........................................####......#########..#####..##...........................
............................................####.....#########.#............##......................
............................................#####.....#######..####........###......................
.............................................#####....#######..###..........###.#####...............
..............................................####......#.###..####...#.###.############........#...
...............................................###.............####............###########.....##...
................................................##.............#..#...............#########.####....
.................................................####..#......................#...##########.......#
...................................................#######........................##########........
.......................................................####..##.###..##...........#.####..###.......
...............................................................#....#......................###......
.............................................................................................##.....
............................................................................#.........#.............
`;
// Zero-length round-capped segments draw as dots, so the whole halftone is one path.
const DOTS = LAND.trim().split('\n').flatMap((row, j) => [...row].flatMap((c, i) => (c === '#' ? [`M${i * 10 + 5} ${j * 10 + 5}h0`] : []))).join('');

const SEOUL = xy(37.57, 126.98);
// Label side (right, left, below right) keeps labels off the arcs and off each other.
type City = { country: string; city: string; at: Pt; side: 'r' | 'l' | 'd' };
const CITIES: Record<string, City> = {
  vietnam: { country: 'Vietnam', city: 'Hanoi', at: xy(21.03, 105.85), side: 'l' },
  philippines: { country: 'Philippines', city: 'Manila', at: xy(14.6, 120.98), side: 'r' },
  nepal: { country: 'Nepal', city: 'Kathmandu', at: xy(27.72, 85.32), side: 'd' },
  cambodia: { country: 'Cambodia', city: 'Phnom Penh', at: xy(11.56, 104.92), side: 'd' },
  indonesia: { country: 'Indonesia', city: 'Jakarta', at: xy(-6.21, 106.85), side: 'r' },
  thailand: { country: 'Thailand', city: 'Bangkok', at: xy(13.76, 100.5), side: 'd' },
  myanmar: { country: 'Myanmar', city: 'Yangon', at: xy(16.84, 96.17), side: 'l' },
  bangladesh: { country: 'Bangladesh', city: 'Dhaka', at: xy(23.81, 90.41), side: 'l' },
  'sri lanka': { country: 'Sri Lanka', city: 'Colombo', at: xy(6.93, 79.86), side: 'r' },
  uzbekistan: { country: 'Uzbekistan', city: 'Tashkent', at: xy(41.3, 69.24), side: 'r' },
  mongolia: { country: 'Mongolia', city: 'Ulaanbaatar', at: xy(47.89, 106.91), side: 'r' },
};
// Offsets in cqw track the marker radius, which scales with the map; the label text does not.
const SIDE = { r: 'translate(calc(1cqw + 3px),-50%)', l: 'translate(calc(-100% - 1cqw - 3px),-50%)', d: 'translate(calc(0.6cqw + 2px),calc(0.6cqw + 2px))' };

const MOVING = new Set(['SIGNED', 'SUBMITTED', 'WAITING', 'INPROGRESS', 'CONFIRMING', 'UNKNOWN']);
const kindOf = (state: string): Kind => (state === 'SUCCEED' ? 'paid' : state === 'REFUSED' || state === 'FAILED' ? 'refused' : MOVING.has(state) ? 'moving' : 'ready');
// Each kind gets its own curvature, so arcs to one city in different states never overlap.
const BEND: Record<Kind, number> = { ready: 0.08, paid: 0.16, moving: 0.24, refused: 0.32 };
const DUR = 2.2;
const PULSE = '#f4fff0';

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
// Control point off the midpoint, left of the direction of travel: every city is west of Seoul, so arcs bow north.
const control = ([x, y]: Pt, bend: number): Pt => [(SEOUL[0] + x) / 2 - (y - SEOUL[1]) * bend, (SEOUL[1] + y) / 2 + (x - SEOUL[0]) * bend];
const bezier = (c: Pt, to: Pt, t: number) => lerp(lerp(SEOUL, c, t), lerp(c, to, t), t);
const d = (c: Pt, to: Pt) => `M${s(SEOUL)}Q${s(c)} ${s(to)}`;
const tip = (ps: FlowPayment[]) => ps.map((p) => `${p.label || 'Payment'} · ${usdt(p.amount)} USDT · ${p.state}`).join('\n');

const REDUCED = '(prefers-reduced-motion: reduce)';
const onMotionChange = (cb: () => void) => {
  const m = matchMedia(REDUCED);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};

export function FlowMap({ payments, title = 'LIVE PAYOUT MAP · TRON NILE' }: { payments: FlowPayment[]; title?: string }) {
  const still = useSyncExternalStore(onMotionChange, () => matchMedia(REDUCED).matches, () => false);
  const cities = Object.values(CITIES)
    .map((c) => {
      const ps = payments.filter((p) => CITIES[p.country?.trim().toLowerCase() ?? ''] === c);
      const by = (k: Kind) => ps.filter((p) => kindOf(p.state) === k);
      return { ...c, ps, ready: by('ready'), moving: by('moving'), paid: by('paid'), refused: by('refused') };
    })
    .filter((c) => c.ps.length);
  const total = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const summary = cities.length
    ? cities.map((c) => `${c.country}: ${c.paid.length} paid, ${c.moving.length} on its way, ${c.refused.length} refused${c.ready.length ? `, ${c.ready.length} not started` : ''}`).join('; ')
    : 'No payments on the map yet';
  const corner = 'pointer-events-none absolute font-mono text-[9px] tracking-[0.1em] text-[#8ca492] uppercase';
  const pct = ([x, y]: Pt) => ({ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` });

  return (
    <div className="@container relative w-full overflow-hidden rounded-lg border border-[#26382c] bg-sunken">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Payout map from Seoul. ${summary}.`} className="block h-auto w-full">
        <path d={DOTS} stroke="#2a3a31" strokeWidth={6.4} strokeLinecap="round" />
        {cities.map((c) => {
          const arc = (k: Kind) => control(c.at, BEND[k]);
          const [ready, moving, paid, refused] = [arc('ready'), arc('moving'), arc('paid'), arc('refused')];
          const cut = bezier(refused, c.at, 0.55);
          return (
            <g key={c.city} fill="none" strokeWidth={2.5} strokeLinecap="round">
              {c.ready.length > 0 && (
                <path d={d(ready, c.at)} stroke="var(--color-muted)" strokeOpacity={0.4} strokeDasharray="8 10">
                  <title>{tip(c.ready)}</title>
                </path>
              )}
              {c.paid.length > 0 && (
                <path d={d(paid, c.at)} stroke="var(--color-celadon)" strokeOpacity={0.85}>
                  <title>{tip(c.paid)}</title>
                </path>
              )}
              {c.refused.length > 0 && (
                <g stroke="var(--color-stop)">
                  {/* The first 55% of the same curve (de Casteljau split), so the mark sits exactly on its end. */}
                  <path d={`M${s(SEOUL)}Q${s(lerp(SEOUL, refused, 0.55))} ${s(cut)}`} strokeOpacity={0.8} />
                  <path d={`M${s([cut[0] - 9, cut[1] - 9])}l18 18m0 -18l-18 18`} strokeWidth={3.5} />
                  <title>{tip(c.refused)}</title>
                </g>
              )}
              {c.moving.length > 0 && <path d={d(moving, c.at)} stroke="var(--color-celadon)" strokeOpacity={0.3} />}
              {c.moving.map((p, i, all) => {
                const at = still ? bezier(moving, c.at, (i + 1) / (all.length + 1)) : [0, 0];
                return (
                  <g key={p.id} transform={`translate(${s(at)})`} fill={PULSE} stroke="none">
                    <title>{tip([p])}</title>
                    <circle r={15} opacity={0.2} />
                    <circle r={6} />
                    {!still && (
                      <>
                        {/* Evenly spaced phases, so several pulses on one arc never overlap. */}
                        <animateMotion dur={`${DUR}s`} begin={`${(-i * DUR) / all.length}s`} repeatCount="indefinite" path={d(moving, c.at)} />
                        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur={`${DUR}s`} begin={`${(-i * DUR) / all.length}s`} repeatCount="indefinite" />
                      </>
                    )}
                  </g>
                );
              })}
              <circle cx={c.at[0]} cy={c.at[1]} r={5} fill="var(--color-muted)" stroke="none" />
              {c.paid.length > 0 && (
                <g fill="var(--color-celadon)" stroke="none">
                  <circle cx={c.at[0]} cy={c.at[1]} r={17} opacity={0.2} />
                  <circle cx={c.at[0]} cy={c.at[1]} r={7} />
                </g>
              )}
            </g>
          );
        })}
        <g fill="none" stroke="var(--color-celadon)" strokeWidth={2}>
          {still ? (
            <circle cx={SEOUL[0]} cy={SEOUL[1]} r={17} opacity={0.35} />
          ) : (
            <circle cx={SEOUL[0]} cy={SEOUL[1]} r={9}>
              <animate attributeName="r" values="9;30" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0" dur="2.4s" repeatCount="indefinite" />
            </circle>
          )}
          <circle cx={SEOUL[0]} cy={SEOUL[1]} r={9} fill="var(--color-celadon)" stroke="none" />
        </g>
      </svg>

      {[{ city: 'Seoul', at: SEOUL, side: 'r' as const, text: 'Seoul', seoul: true }, ...cities.map((c) => ({ ...c, text: `${c.city} · ${c.paid.length}/${c.ps.length}`, seoul: false }))].map((c) => (
        <div
          key={c.city}
          style={{ ...pct(c.at), transform: SIDE[c.side] }}
          className={`pointer-events-none absolute font-mono text-[9px] tracking-[0.1em] whitespace-nowrap uppercase [text-shadow:0_0_4px_#111a15] ${c.seoul ? 'text-celadon' : 'text-[#8ca492]'}`}
        >
          {c.text}
        </div>
      ))}

      <div className={`${corner} top-2.5 left-3`}>{title}</div>
      <div className={`${corner} top-2.5 right-3`}>
        Seoul → {cities.length} {cities.length === 1 ? 'country' : 'countries'}
      </div>
      <div className={`${corner} bottom-2.5 left-3 flex flex-col gap-1 @md:flex-row @md:gap-3`}>
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-3 rounded-full bg-celadon" />Paid</span>
        <span className="flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-[#f4fff0] shadow-[0_0_5px_#f4fff0]" />On its way</span>
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-3 rounded-full bg-stop" />Refused</span>
      </div>
      <div className={`${corner} right-3 bottom-2.5 num`}>
        {payments.length} {payments.length === 1 ? 'payment' : 'payments'} · {usdt(total)} USDT
      </div>
      {payments.length === 0 && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted">No payments yet</div>}
    </div>
  );
}
