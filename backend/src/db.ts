import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Amounts are integers in USDT base units (6 decimals). Times are unix seconds unless named *_ms.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY,
  payer TEXT NOT NULL,
  owner TEXT,
  budget INTEGER NOT NULL,
  per_payment INTEGER NOT NULL,
  payees TEXT NOT NULL,
  payees_hash TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  policy_nonce INTEGER NOT NULL,
  signature TEXT,
  signed_by TEXT,
  policy_hash TEXT,
  anchor_tx TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY,
  policy_id INTEGER,
  source TEXT NOT NULL,
  columns TEXT NOT NULL,
  mapped_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REVIEW',
  receipt TEXT,
  close_hash TEXT,
  anchor_tx TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rows (
  id INTEGER PRIMARY KEY,
  batch_id INTEGER NOT NULL,
  line INTEGER NOT NULL,
  sender TEXT, name TEXT, receiver TEXT NOT NULL, amount INTEGER, amount_raw TEXT, note TEXT,
  flags TEXT NOT NULL DEFAULT '[]',
  agent TEXT,
  decision TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'READY',
  reason TEXT,
  permit TEXT, nonce INTEGER, deadline INTEGER, max_fee INTEGER,
  trace_id TEXT, txn_hash TEXT, fee INTEGER, error TEXT,
  signed_at_ms INTEGER,
  updated_at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  ts_ms INTEGER NOT NULL,
  type TEXT NOT NULL,
  batch_id INTEGER,
  row_id INTEGER,
  body TEXT NOT NULL,
  prev TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY,
  ts_ms INTEGER NOT NULL,
  flow TEXT NOT NULL,
  batch_id INTEGER,
  call_id TEXT,
  prompt INTEGER, completion INTEGER, total INTEGER,
  ms INTEGER,
  effort TEXT
);
CREATE TABLE IF NOT EXISTS column_maps (signature TEXT PRIMARY KEY, mapping TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS telegram_chats (chat_id INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', name TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (chat_id, kind, ref));
CREATE TABLE IF NOT EXISTS telegram_codes (code TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS joins (
  token TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  wallet TEXT NOT NULL,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  city TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_back TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payees (
  address TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT,
  usual REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

export type Policy = {
  id: number; payer: string; owner: string | null; budget: number; per_payment: number;
  payees: string; payees_hash: string; deadline: number; policy_nonce: number;
  signature: string | null; signed_by: string | null; policy_hash: string | null; anchor_tx: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'STOPPED' | 'REPLACED'; created_at: number;
  per_payee_monthly: number | null; // null on policies signed before the monthly cap existed
  record_key: number | null;
};

export type Batch = {
  id: number; policy_id: number | null; source: string; columns: string; mapped_by: string;
  status: 'REVIEW' | 'RUNNING' | 'PAUSED' | 'CLOSED'; receipt: string | null;
  close_hash: string | null; anchor_tx: string | null; created_at: number;
  approval: string | null;
  record_key: number | null;
};

export type Row = {
  id: number; batch_id: number; line: number;
  sender: string | null; name: string | null; receiver: string; amount: number | null; amount_raw: string | null; note: string | null;
  flags: string; agent: string | null; decision: 'pay' | 'hold' | 'remove';
  state: string; reason: string | null;
  permit: string | null; nonce: number | null; deadline: number | null; max_fee: number | null;
  trace_id: string | null; txn_hash: string | null; fee: number | null; error: string | null;
  signed_at_ms: number | null; updated_at_ms: number | null;
  receipt_token: string | null; travel: string | null; ack: string | null;
};

function open() {
  const file = process.env.ANSIM_DB ?? fileURLToPath(new URL('../data/ansim.db', import.meta.url));
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new Database(file);
  d.pragma('journal_mode = WAL');
  d.exec(SCHEMA);
  // Columns added after the first release. CREATE TABLE IF NOT EXISTS does not add them to an old file.
  const addColumn = (table: string, column: string, type: string) => {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  addColumn('policies', 'per_payee_monthly', 'INTEGER');
  addColumn('batches', 'approval', 'TEXT');
  addColumn('rows', 'receipt_token', 'TEXT');
  addColumn('rows', 'travel', 'TEXT');
  addColumn('policies', 'record_key', 'INTEGER');
  addColumn('batches', 'record_key', 'INTEGER');
  addColumn('payees', 'risk', 'TEXT');
  addColumn('payees', 'city', 'TEXT');
  addColumn('rows', 'ack', 'TEXT');
  return d;
}

// One connection per server process, kept across dev hot reloads.
const g = globalThis as unknown as { __ansimDb?: Database.Database };
export const db = (g.__ansimDb ??= open());

export const nowSec = () => Math.floor(Date.now() / 1000);

// The registry contract is shared, so each database writes its policies and batches under its own
// random range: id 3 here becomes namespace × 1,000,000 + 3 on chain. Records made before this have no key.
export function recordKey(id: number) {
  let row = db.prepare("SELECT value FROM meta WHERE key = 'record_namespace'").get() as { value: string } | undefined;
  if (!row) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('record_namespace', ?)").run(String(1 + Math.floor(Math.random() * 2 ** 31)));
    row = db.prepare("SELECT value FROM meta WHERE key = 'record_namespace'").get() as { value: string };
  }
  return Number(row.value) * 1_000_000 + id;
}

export const getPolicy = (id: number) => db.prepare('SELECT * FROM policies WHERE id = ?').get(id) as Policy | undefined;
export const activePolicy = () =>
  db.prepare("SELECT * FROM policies WHERE status IN ('ACTIVE','STOPPED') ORDER BY id DESC LIMIT 1").get() as Policy | undefined;
export const getBatch = (id: number) => db.prepare('SELECT * FROM batches WHERE id = ?').get(id) as Batch | undefined;
export const getRow = (id: number) => db.prepare('SELECT * FROM rows WHERE id = ?').get(id) as Row;
export const batchRows = (batchId: number) =>
  db.prepare('SELECT * FROM rows WHERE batch_id = ? ORDER BY line').all(batchId) as Row[];

export function updateRow(id: number, fields: Partial<Row>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE rows SET ${set}, updated_at_ms = @now WHERE id = @id`).run({ ...fields, id, now: Date.now() });
}
