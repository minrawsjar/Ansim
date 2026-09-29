import './env';
import fs from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { db, activePolicy, getBatch } from './db';
import { startRun, isRunning, recoverBatch, precheck, committed } from './orchestrator';
import {
  draftPolicy, activatePolicy, stopPolicy, importFile, editRow, reviewFlags, writeReceipt, askAuditor,
  batchView, evidence, exportCsv, metrics, status,
} from './desk';

const app = new Hono().basePath('/api');
app.onError((e, c) => c.json({ error: e.message }, 400));

// Optional lock for when the backend is reachable from the internet (for example through a tunnel).
// With BACKEND_KEY set, every request must carry it in x-ansim-key. The frontend proxy adds it.
const BACKEND_KEY = process.env.BACKEND_KEY;
const digest = (s: string) => createHash('sha256').update(s).digest();
app.get('/health', (c) => c.json({ ok: true })); // open, for the host's health check
if (BACKEND_KEY) {
  app.use('*', async (c, next) => {
    if (c.req.path === '/api/health') return next();
    if (!timingSafeEqual(digest(c.req.header('x-ansim-key') ?? ''), digest(BACKEND_KEY))) return c.json({ error: 'Missing or wrong backend key' }, 401);
    await next();
  });
}

const id = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Bad id');
  return n;
};

app.get('/status', (c) => c.json(status()));

app.get('/policy', (c) => {
  const p = activePolicy();
  return c.json({ policy: p ?? null, committed: p ? committed(p.id) : 0 });
});
app.post('/policy/draft', async (c) => c.json(draftPolicy(await c.req.json())));
app.post('/policy/activate', async (c) => c.json(await activatePolicy(await c.req.json())));
app.post('/policy/stop', async (c) => c.json(await stopPolicy()));

app.get('/batches', (c) =>
  c.json(db.prepare('SELECT b.*, (SELECT COUNT(*) FROM rows r WHERE r.batch_id = b.id) AS row_count FROM batches b ORDER BY id DESC').all()),
);

app.post('/batches', async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new Error('Attach a CSV or Excel file.');
  if (file.size > 2_000_000) throw new Error('The file is larger than 2 MB.');
  return c.json({ id: await importFile(Buffer.from(await file.arrayBuffer()), file.name) });
});

app.get('/batches/:id', (c) => {
  const batchId = id(c.req.param('id'));
  return c.json({ ...batchView(batchId), running: isRunning(batchId) });
});

app.patch('/rows/:id', async (c) => c.json(await editRow(id(c.req.param('id')), await c.req.json())));

const execFileP = promisify(execFile);
const VERIFY = fileURLToPath(new URL('../scripts/verify.mjs', import.meta.url));
const EXPORTS = new URL('../data/exports/', import.meta.url);

app.post('/batches/:id/:action', async (c) => {
  const batchId = id(c.req.param('id'));
  if (!getBatch(batchId)) throw new Error('Batch not found.');
  switch (c.req.param('action')) {
    case 'review':
      return c.json(await reviewFlags(batchId));
    case 'precheck':
      return c.json(await precheck(batchId));
    case 'run':
      startRun(batchId);
      return c.json({ started: true });
    case 'recover':
      await recoverBatch(batchId);
      return c.json({ ok: true });
    case 'receipt':
      return c.json(await writeReceipt(batchId));
    case 'ask': {
      const { question } = await c.req.json();
      return c.json(await askAuditor(batchId, String(question ?? '').slice(0, 500)));
    }
    case 'verify': {
      // Runs the independent auditor script on a fresh export. tamper=1 edits one paid amount first,
      // to show that verify catches it.
      const { tamper } = await c.req.json().catch(() => ({ tamper: false }));
      const ev = evidence(batchId);
      if (tamper) {
        const r = ev.rows.find((x) => x.state === 'SUCCEED');
        if (!r) throw new Error('No paid row to tamper with yet.');
        r.amount = (r.amount ?? 0) + 1_000_000;
      }
      fs.mkdirSync(EXPORTS, { recursive: true });
      const file = fileURLToPath(new URL(`batch-${batchId}${tamper ? '-tampered' : ''}.json`, EXPORTS));
      fs.writeFileSync(file, JSON.stringify(ev, null, 2));
      try {
        const { stdout } = await execFileP(process.execPath, [VERIFY, file], { timeout: 120_000 });
        return c.json({ ok: true, output: stdout, tampered: !!tamper });
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; message: string };
        return c.json({ ok: false, output: (err.stdout ?? '') + (err.stderr ?? ''), tampered: !!tamper });
      }
    }
    default:
      throw new Error('Unknown action.');
  }
});

app.get('/batches/:id/export', (c) => {
  const batchId = id(c.req.param('id'));
  if (c.req.query('format') === 'csv') {
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="ansim-batch-${batchId}.csv"`);
    return c.body(exportCsv(batchId));
  }
  c.header('Content-Disposition', `attachment; filename="ansim-evidence-${batchId}.json"`);
  return c.json(evidence(batchId));
});

app.get('/metrics', (c) => c.json(metrics()));

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: app.fetch, port }, () => console.log(`Ansim backend on http://localhost:${port}/api`));
