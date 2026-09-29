// Connecting Telegram chats to Ansim. A bot can only message someone who pressed Start, so the console
// and the receipt page hand out t.me links with a code; Telegram's webhook delivers the Start press here.
// Owner codes are one-time and expire, so finding the bot alone never subscribes anyone to payment alerts.
// A family's code is their receipt token, which follows only their own wallet.
import { createHash, randomBytes } from 'node:crypto';
import { db, nowSec } from './db';
import { logEvent } from './log';
import { sendTo, telegramConfigured, langFor } from './alerts';

const token = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
// Telegram sends this back in a header on every webhook call; it is derived from the bot token.
export const webhookSecret = () => createHash('sha256').update(`ansim-webhook:${token()}`).digest('hex').slice(0, 48);

let username: string | null = null;
export async function botUsername() {
  if (username || !telegramConfigured()) return username;
  const r = (await fetch(`https://api.telegram.org/bot${token()}/getMe`, { signal: AbortSignal.timeout(5000) }).then((x) => x.json()).catch(() => null)) as { result?: { username?: string } } | null;
  username = r?.result?.username ?? null;
  return username;
}

// Registers the webhook with Telegram. Needs PUBLIC_API_URL, the backend's public address.
export async function registerWebhook() {
  const base = process.env.PUBLIC_API_URL?.replace(/\/$/, '');
  if (!telegramConfigured() || !base) return;
  const r = await fetch(`https://api.telegram.org/bot${token()}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${base}/api/telegram/webhook`, secret_token: webhookSecret(), allowed_updates: ['message'] }),
    signal: AbortSignal.timeout(10_000),
  }).then((x) => x.json()).catch((e) => ({ ok: false, description: String(e) }));
  console.log(`Telegram webhook ${r.ok ? 'registered' : `not registered: ${r.description}`}`);
}

export async function ownerLink() {
  const bot = await botUsername();
  if (!bot) throw new Error('Set TELEGRAM_BOT_TOKEN first.');
  const code = randomBytes(12).toString('base64url');
  db.prepare('DELETE FROM telegram_codes WHERE expires_at < ?').run(nowSec());
  db.prepare("INSERT INTO telegram_codes (code, kind, ref, expires_at) VALUES (?, 'owner', '', ?)").run(code, nowSec() + 600);
  return { url: `https://t.me/${bot}?start=o_${code}`, expiresInSec: 600 };
}

export function ownerChatCount() {
  const linked = (db.prepare("SELECT COUNT(*) AS n FROM telegram_chats WHERE kind = 'owner'").get() as { n: number }).n;
  return linked + (process.env.TELEGRAM_CHAT_ID ? 1 : 0);
}

const FAMILY_JOINED: Record<string, (name: string) => string> = {
  vi: (n) => `Bạn sẽ nhận được tin nhắn ở đây khi tiền cho ${n} đến. Gửi /stop để dừng.`,
  tl: (n) => `Makakatanggap ka ng mensahe dito kapag dumating ang pera para kay ${n}. I-send ang /stop para huminto.`,
  ne: (n) => `${n} का लागि रकम आइपुगेपछि तपाईंलाई यहाँ सन्देश आउनेछ। रोक्न /stop पठाउनुहोस्।`,
  en: (n) => `You will get a message here when money for ${n} arrives. Send /stop to stop.`,
};

type Update = { message?: { text?: string; chat?: { id: number; first_name?: string; last_name?: string; title?: string } } };

export async function handleUpdate(u: Update) {
  const chat = u.message?.chat;
  const text = u.message?.text?.trim();
  if (!chat?.id || !text) return;
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.title || null;
  const [cmd, arg = ''] = text.split(/\s+/, 2);
  const reply = (t: string) => sendTo(chat.id, t).catch(() => {});

  if (cmd === '/start' && arg.startsWith('o_')) {
    const code = db.prepare("SELECT code FROM telegram_codes WHERE code = ? AND kind = 'owner' AND expires_at >= ?").get(arg.slice(2), nowSec());
    if (!code) return reply('This link has expired or was already used. Make a new one from the Ansim console.');
    db.prepare('DELETE FROM telegram_codes WHERE code = ?').run(arg.slice(2));
    db.prepare("INSERT OR IGNORE INTO telegram_chats (chat_id, kind, ref, name, created_at) VALUES (?, 'owner', '', ?, ?)").run(chat.id, name, nowSec());
    logEvent('TELEGRAM_CONNECTED', { kind: 'owner', name });
    return reply('Connected to Ansim. You will get the owner’s alerts here: refusals, failures, Stop, new contacts, approvals, vault releases, family confirmations and finished batches. Send /stop to stop.');
  }
  if (cmd === '/start' && arg.startsWith('r_')) {
    const row = db.prepare("SELECT receiver, name FROM rows WHERE receipt_token = ? AND decision = 'pay'").get(arg.slice(2)) as { receiver: string; name: string | null } | undefined;
    if (!row) return reply('This receipt link is not valid.');
    db.prepare("INSERT OR IGNORE INTO telegram_chats (chat_id, kind, ref, name, created_at) VALUES (?, 'family', ?, ?, ?)").run(chat.id, row.receiver, name, nowSec());
    logEvent('TELEGRAM_CONNECTED', { kind: 'family', wallet: row.receiver });
    const country = (db.prepare('SELECT country FROM payees WHERE address = ?').get(row.receiver) as { country: string | null } | undefined)?.country;
    return reply(FAMILY_JOINED[langFor(country)](row.name ?? 'you'));
  }
  if (cmd === '/stop') {
    const n = db.prepare('DELETE FROM telegram_chats WHERE chat_id = ?').run(chat.id).changes;
    if (n) logEvent('TELEGRAM_DISCONNECTED', { chats: n });
    return reply('Stopped. You will not get messages from Ansim here any more.');
  }
  return reply('This is the Ansim alert bot. Owners connect from the Ansim console; families connect from their receipt page.');
}
