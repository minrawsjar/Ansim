import { createHash } from 'node:crypto';
import { db } from './db';
import { alertFor } from './alerts';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const GENESIS = '0'.repeat(64);

// Append-only, hash-chained event log. Each hash covers the previous hash and this event's body,
// so editing any past event breaks every hash after it. scripts/verify.mjs recomputes the chain.
export function logEvent(type: string, data: Record<string, unknown>, batchId: number | null = null, rowId: number | null = null) {
  const last = db.prepare('SELECT hash FROM events ORDER BY id DESC LIMIT 1').get() as { hash: string } | undefined;
  const prev = last?.hash ?? GENESIS;
  const ts = Date.now();
  const body = JSON.stringify({ ts, type, batch: batchId, row: rowId, data });
  const hash = sha256(prev + body);
  const r = db
    .prepare('INSERT INTO events (ts_ms, type, batch_id, row_id, body, prev, hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(ts, type, batchId, rowId, body, prev, hash);
  alertFor(type, data, batchId);
  return { id: Number(r.lastInsertRowid), hash };
}

export type EventRow = { id: number; ts_ms: number; type: string; batch_id: number | null; row_id: number | null; body: string; prev: string; hash: string };
export const allEvents = () => db.prepare('SELECT * FROM events ORDER BY id').all() as EventRow[];
export const batchEvents = (batchId: number) =>
  db.prepare('SELECT * FROM events WHERE batch_id = ? ORDER BY id').all(batchId) as EventRow[];
