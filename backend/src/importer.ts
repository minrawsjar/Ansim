import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';

export const FIELDS = ['sender', 'name', 'receiver', 'amount', 'note'] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Partial<Record<Field, string | null>>;

// Checked in this order so "수취인 지갑주소" maps to the wallet column before the name column.
const RULES: [Field, RegExp][] = [
  ['receiver', /(wallet|address|addr|지갑|주소)/i],
  ['amount', /(amount|usdt|금액|송금액)/i],
  ['sender', /(sender|worker|from|송금인|보내는|근로자|의뢰인)/i],
  ['name', /(recipient|beneficiary|name|수취인|받는|이름)/i],
  ['note', /(note|memo|remark|purpose|비고|메모|용도)/i],
];

export function parseSheet(buf: Buffer, filename: string) {
  const wb = /\.csv$/i.test(filename)
    ? XLSX.read(new TextDecoder('utf-8').decode(buf).replace(/^﻿/, ''), { type: 'string' })
    : XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const table = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });
  const nonEmpty = table.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (nonEmpty.length < 2) throw new Error('The file needs a header row and at least one payout row');
  const [header, ...body] = nonEmpty;
  return { header: header.map((h) => String(h).trim()), body: body.map((r) => r.map((c) => String(c).trim())) };
}

export const headerSignature = (header: string[]) =>
  createHash('sha256').update(header.map((h) => h.toLowerCase()).join('|')).digest('hex');

export function ruleMapping(header: string[]): Mapping {
  const m: Mapping = {};
  const used = new Set<string>();
  for (const [field, re] of RULES) {
    const h = header.find((x) => !used.has(x) && re.test(x));
    if (h) {
      m[field] = h;
      used.add(h);
    }
  }
  return m;
}

export const validMapping = (m: Mapping | null | undefined, header: string[]): m is Mapping =>
  !!m && !!m.receiver && !!m.amount && Object.values(m).every((h) => h == null || header.includes(h));

// "1,234.50 USDT" → 1234500000 base units. Returns null for anything that is not a positive number.
export function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(/[,\s]|usdt/gi, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1e6) : null;
}

export function toRows(header: string[], body: string[][], m: Mapping) {
  const col = (f: Field) => (m[f] ? header.indexOf(m[f]!) : -1);
  const get = (r: string[], f: Field) => (col(f) >= 0 ? r[col(f)] ?? '' : '');
  return body.map((r, i) => ({
    line: i + 2, // spreadsheet line number, header is line 1
    sender: get(r, 'sender'),
    name: get(r, 'name'),
    receiver: get(r, 'receiver'),
    amount_raw: get(r, 'amount'),
    amount: parseAmount(get(r, 'amount')),
    note: get(r, 'note'),
  }));
}
