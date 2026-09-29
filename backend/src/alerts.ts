// Telegram alerts to the owner. Off unless TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.
// Sending never blocks or breaks a payment: failures are ignored.

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const usdt = (n: unknown) => (Number(n ?? 0) / 1e6).toFixed(2);
const short = (a: unknown) => (typeof a === 'string' && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : String(a ?? ''));

const MESSAGES: Record<string, (d: Data) => string> = {
  ROW_REFUSED: (d) => `Refused: line ${d.line}, ${usdt(d.value)} USDT to ${short(d.receiver)}. Reason: ${d.reason}.`,
  ROW_FAILED: (d) => `Failed: line ${d.line}. GasFree said ${d.reason}.`,
  POLICY_STOPPED: (d) => `Stop pressed. Policy #${d.policyId} can no longer pay anyone.`,
  BATCH_PAUSED: (d) => `Batch paused${d.line ? ` at line ${d.line}` : ''}: ${d.reason}`,
  BATCH_CLOSED: (d) => `Batch finished: ${d.paid} paid (${usdt(d.amountPaid)} USDT, fees ${usdt(d.fees)}), ${d.refused} refused, ${d.failed} failed, ${d.held} held.`,
  CONTACT_ADDED: (d) => `New contact added: ${d.name}, wallet ${short(d.address)}. It cannot be paid until the waiting period ends.`,
  BATCH_APPROVED: (d) => `Batch approved by ${short(d.owner)}: ${d.count} payments, ${usdt(d.total)} USDT.`,
};

export const telegramConfigured = () => !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

export async function sendTelegram(text: string) {
  if (!telegramConfigured()) throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first.');
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
    signal: AbortSignal.timeout(5000),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!j.ok) throw new Error(`Telegram refused the message: ${j.description ?? res.status}`);
}

export function alertFor(type: string, data: Data, batchId: number | null) {
  const make = MESSAGES[type];
  if (!make || !telegramConfigured()) return;
  sendTelegram(`Ansim${batchId ? ` · batch #${batchId}` : ''}\n${make(data)}`).catch(() => {});
}
