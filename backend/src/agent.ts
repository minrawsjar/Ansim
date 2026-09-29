import OpenAI from 'openai';
import { db } from './db';

export type Flow = 'map_columns' | 'review_flags' | 'receipt' | 'audit_qa' | 'dispute' | 'wallet_check' | 'plan';
export const MODEL = process.env.KILN_MODEL ?? 'gpt-oss-120b';
export const kilnConfigured = () => !!(process.env.KILN_BASE_URL && process.env.KILN_API_KEY);

let client: OpenAI | undefined;
let effortSupported = true;

// Every Kiln call goes through here so token usage is logged under its flow.
// Returns null when Kiln is not configured; callers show that instead of inventing output.
export async function ask<T>(flow: Flow, system: string, input: unknown, opts: { maxTokens?: number; batchId?: number } = {}): Promise<T | null> {
  if (!kilnConfigured()) return null;
  client ??= new OpenAI({ baseURL: process.env.KILN_BASE_URL, apiKey: process.env.KILN_API_KEY });
  const messages = [
    { role: 'system' as const, content: `${system}\nReply with one JSON object only. No markdown.` },
    { role: 'user' as const, content: JSON.stringify(input) },
  ];
  const t0 = performance.now();
  let r: OpenAI.Chat.Completions.ChatCompletion;
  try {
    r = await client.chat.completions.create({
      model: MODEL, messages, max_tokens: opts.maxTokens ?? 800,
      ...(effortSupported ? { reasoning_effort: 'low' as const } : {}),
    });
  } catch (e) {
    // Some OpenAI-compatible servers reject reasoning_effort. Retry once without it and remember.
    if (!effortSupported || !(e instanceof OpenAI.APIError) || e.status !== 400) throw e;
    effortSupported = false;
    r = await client.chat.completions.create({ model: MODEL, messages, max_tokens: opts.maxTokens ?? 800 });
  }
  const ms = Math.round(performance.now() - t0);
  db.prepare('INSERT INTO tokens (ts_ms, flow, batch_id, call_id, prompt, completion, total, ms, effort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    Date.now(), flow, opts.batchId ?? null, r.id ?? null,
    r.usage?.prompt_tokens ?? null, r.usage?.completion_tokens ?? null, r.usage?.total_tokens ?? null,
    ms, effortSupported ? 'low' : 'default',
  );
  const content = r.choices[0]?.message?.content ?? '';
  // Empty content usually means reasoning used up max_tokens: raise the cap or lower the effort.
  const json = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error(`Kiln returned no usable JSON for ${flow}: ${content.slice(0, 200) || '(empty reply)'}`);
  }
}

export const PROMPTS = {
  map_columns: `You map the columns of a payout spreadsheet for a Korean remittance company.
Fields: sender (the worker in Korea who is sending), name (the recipient's name), receiver (the recipient's TRON wallet address), amount (the USDT amount), note (memo or purpose).
You get the header row and up to three sample rows. Return {"sender": header or null, "name": header or null, "receiver": header, "amount": header, "note": header or null}, using the exact header strings.`,

  review_flags: `You help the operations team of a licensed Korean remittance company check a USDT payout batch before it is paid.
Each row you get was flagged by automatic checks. Flag meanings:
INVALID_ADDRESS: not a valid TRON address. INVALID_AMOUNT: bad amount. DUPLICATE: same wallet, amount and note as an earlier row.
NEW_PAYEE: wallet not in the payee book. LOOKALIKE: resembles a known payee's wallet but differs (address poisoning scam).
UNUSUAL_AMOUNT: over 3x the payee's usual amount. REPORTED_WALLET: on the reported scam list. TETHER_FROZEN: frozen by Tether.
MANY_SENDERS_ONE_WALLET: three or more different senders pay one new wallet, a common money-mule pattern in voice-phishing cases.
RISKY_WALLET: the contact's wallet history on mainnet shows risk signals such as money-mule inflows or links to frozen wallets.
NEW_CONTACT_WAIT: the contact was added only hours ago and is still in its waiting period (delayed transfer). TRAVEL_RULE_INFO: the amount is at or above the Travel Rule threshold and the sender's details are missing.
For each row, write one short plain sentence in Korean ("ko") and one in English ("en") explaining the risk, using the note and payee history when they explain it.
Suggest "action": "fix" when it is a data error the operator can correct, "hold" when it must not be paid until someone checks, or "pay" only when the context clearly explains the flag.
Never suggest "pay" for INVALID_ADDRESS, TETHER_FROZEN, REPORTED_WALLET, LOOKALIKE, MANY_SENDERS_ONE_WALLET, NEW_CONTACT_WAIT or TRAVEL_RULE_INFO.
Return {"rows": [{"line": number, "ko": string, "en": string, "action": "fix" | "hold" | "pay"}]}.`,

  receipt: `Write a short receipt for the business owner about a finished USDT payout batch. Use only the numbers you are given.
State how much was paid to how many people, the total fees, and which rows were refused or held and why. Mention that transaction hashes are listed in the export.
Return {"ko": "3 to 5 sentences in Korean", "en": "the same in English"}.`,

  audit_qa: `You answer an auditor's question about a USDT payout batch using only the records provided: the signed policy, the rows and the hash-chained event log.
Cite event ids like [#12] for every fact. If the records do not answer the question, say so.
Return {"answer": string}.`,

  wallet_check: `You help a licensed Korean remittance operator judge a recipient wallet before it is saved as a contact.
You get public facts about the wallet on TRON mainnet and the risk flags that code derived from them:
WALLET_IS_CONTRACT: the address is a smart contract, not a personal wallet. WALLET_FROZEN_SENDERS: it received USDT from wallets Tether has frozen.
WALLET_MANY_SENDERS: five or more different wallets sent it USDT in the last 7 days, a common money-mule pattern. WALLET_NEW: created less than 30 days ago.
Write one or two short plain sentences in Korean ("ko") and in English ("en") saying what the facts mean for paying this wallet.
Never say a wallet is safe or trustworthy. With no flags, say that no risk signals were found in the public record and that the operator should still confirm the address with the recipient. A wallet never used on mainnet is normal for a new family wallet; say so.
Return {"ko": string, "en": string}.`,

  plan: `You are the payout agent of a licensed Korean remittance operator. The owner gives you an instruction for today's payouts.
You get the contacts (name, country, wallet address, usual amount, what they received in the last 30 days, whether they are new, their wallet risk level, whether the signed limits allow them, and joinedLive: true for people who joined from the audience today) and the owner's signed limits.
Propose payments that follow the instruction. Use only the wallet addresses listed, exactly as given. Amounts are in USDT.
Propose the amounts the instruction asks for, even when they break the limits. Do not shrink or drop payments to fit: Ansim checks every payment against the signed limits in code, refuses what does not fit, and shows the owner why. If the draft breaks a limit, say which one in the summary. Leave out contacts the limits do not allow, unless the instruction insists; then include them and say they will be refused.
For each payment, write one short reason in Korean ("why_ko") and English ("why_en"), and a short note for the recipient ("note").
If the instruction is unclear or nothing should be paid, return no rows and explain in the summary.
The summary describes this draft: nothing has been paid yet, and the owner still has to approve it.
Return {"rows": [{"address": string, "amount": number, "note": string, "why_ko": string, "why_en": string}], "summary": {"ko": string, "en": string}}.`,

  dispute: `You help a licensed Korean remittance operator answer a customer who asks about a payment, for example "my family did not get the money".
Use only the records given: the matching payments, their hash-chained log events, and what the TRON chain shows for each transaction hash.
Say plainly whether the money arrived, when, to which wallet (first and last four characters) and with which transaction hash.
If a payment was held, refused or failed, say why in plain words. If the chain shows the transfer went to a different wallet than the family's, say so.
Cite log events like [#12]. If the records do not show the payment, say so and suggest checking the sender's name or the wallet.
Return {"ko": "the answer in Korean", "en": "the same in English"}.`,
};
