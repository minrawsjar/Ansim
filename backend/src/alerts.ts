// Telegram alerts. The owner's chats (TELEGRAM_CHAT_ID plus anyone who connected from the console) get
// every alert; a family's chat, connected from their receipt page, hears only when their money arrives.
// Sending never blocks or breaks a payment: failures are ignored.
import { db } from './db';

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const usdt = (n: unknown) => (Number(n ?? 0) / 1e6).toFixed(2);
const short = (a: unknown) => (typeof a === 'string' && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : String(a ?? ''));

const MESSAGES: Record<string, (d: Data) => string> = {
  ROW_REFUSED: (d) => `Refused: line ${d.line}, ${usdt(d.value)} USDT to ${short(d.receiver)}. Reason: ${d.reason}.`,
  ROW_FAILED: (d) => `Failed: line ${d.line}. GasFree said ${d.reason}.`,
  POLICY_STOPPED: (d) => `Stop pressed. Policy #${d.policyId} can no longer pay anyone.`,
  BATCH_PAUSED: (d) => `Batch paused${d.line ? ` at line ${d.line}` : ''}: ${d.reason}`,
  BATCH_CLOSED: (d) => `Batch finished: ${d.paid} paid (${usdt(d.amountPaid)} USDT, fees ${usdt(d.fees)}), ${d.refused} refused, ${d.failed} failed, ${d.held} held.`,
  CONTACT_ADDED: (d) => `New contact added: ${d.name}, wallet ${short(d.address)}${d.riskLevel === 'high' ? `, with risk signals: ${(d.riskFlags ?? []).join(', ')}` : ''}. It cannot be paid until the waiting period ends.`,
  VAULT_RELEASED: (d) => `Vault released ${usdt(d.amount)} USDT for ${d.count} approved payments.`,
  VAULT_REFUSED: (d) => `Vault refused to release money: ${d.reason}`,
  VAULT_FROZEN: () => 'The vault was frozen. No batch can take money from it.',
  RECEIPT_CONFIRMED: (d) => `The family confirmed they received line ${d.line}${d.city ? `, from ${d.city}` : ''}.`,
  BATCH_APPROVED: (d) => `Batch approved by ${short(d.owner)}: ${d.count} payments, ${usdt(d.total)} USDT.`,
};

// Short and plain, so they survive translation. A native speaker should still check them.
const ARRIVED: Record<string, (amount: string, sender: string, link: string) => string> = {
  vi: (a, s, l) => `✓ ${a} USDT từ ${s} đã vào ví của bạn.${l ? ` Biên nhận: ${l}` : ''}`,
  tl: (a, s, l) => `✓ Dumating na ang ${a} USDT mula kay ${s}.${l ? ` Resibo: ${l}` : ''}`,
  ne: (a, s, l) => `✓ ${s} बाट ${a} USDT तपाईंको वालेटमा आइपुग्यो।${l ? ` रसिद: ${l}` : ''}`,
  en: (a, s, l) => `✓ ${a} USDT from ${s} arrived in your wallet.${l ? ` Receipt: ${l}` : ''}`,
};
const LANG_BY_COUNTRY: Record<string, string> = { vietnam: 'vi', philippines: 'tl', nepal: 'ne' };
export const langFor = (country: string | null | undefined) => LANG_BY_COUNTRY[country?.trim().toLowerCase() ?? ''] ?? 'en';

export const telegramConfigured = () => !!process.env.TELEGRAM_BOT_TOKEN;

// Owner chats: the one in TELEGRAM_CHAT_ID plus the ones connected from the console.
export function ownerChats(): string[] {
  const linked = (db.prepare("SELECT chat_id FROM telegram_chats WHERE kind = 'owner'").all() as { chat_id: number }[]).map((r) => String(r.chat_id));
  return [...new Set([process.env.TELEGRAM_CHAT_ID, ...linked].filter((c): c is string => !!c))];
}

export async function sendTo(chatId: string | number, text: string) {
  if (!telegramConfigured()) throw new Error('Set TELEGRAM_BOT_TOKEN first.');
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(5000),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!j.ok) throw new Error(`Telegram refused the message: ${j.description ?? res.status}`);
}

export async function sendTelegram(text: string) {
  const chats = ownerChats();
  if (!telegramConfigured() || !chats.length) throw new Error('Connect a Telegram chat first.');
  await Promise.all(chats.map((c) => sendTo(c, text)));
}

// A payment reached a wallet: tell the family chats that follow that wallet, in their language.
function familyNotice(rowId: number) {
  const r = db.prepare('SELECT receiver, sender, amount, receipt_token FROM rows WHERE id = ?').get(rowId) as
    | { receiver: string; sender: string | null; amount: number; receipt_token: string | null }
    | undefined;
  if (!r) return;
  const chats = db.prepare("SELECT chat_id FROM telegram_chats WHERE kind = 'family' AND ref = ?").all(r.receiver) as { chat_id: number }[];
  if (!chats.length) return;
  const country = (db.prepare('SELECT country FROM payees WHERE address = ?').get(r.receiver) as { country: string | null } | undefined)?.country;
  const site = process.env.PUBLIC_SITE_URL?.replace(/\/$/, '');
  const link = site && r.receipt_token ? `${site}/r/${r.receipt_token}` : '';
  const text = ARRIVED[langFor(country)](usdt(r.amount), r.sender || 'the sender', link);
  for (const c of chats) sendTo(c.chat_id, text).catch(() => {});
}

export function alertFor(type: string, data: Data, batchId: number | null, rowId: number | null) {
  if (!telegramConfigured()) return;
  const arrived = (type === 'ROW_STATE' && data.state === 'SUCCEED') || type === 'ROW_RECOVERED';
  if (arrived && rowId) familyNotice(rowId);
  const make = MESSAGES[type];
  if (!make) return;
  const text = `Ansim${batchId ? ` · batch #${batchId}` : ''}\n${make(data)}`;
  for (const c of ownerChats()) sendTo(c, text).catch(() => {});
}
