# Ansim 안심

**Ansim is a wallet and approval tool: an AI payout agent that pays USDT batches on TRON through GasFree only inside a budget, payee list and deadline the owner signed, from an on-chain vault that releases money only for batches the owner approved, and records every payment and refusal so anyone can audit it.**

안심 means “peace of mind”. Korean banks use the word for their fraud-blocking services.

Built at GWDC 2026 Korea for **TRON Challenge C** (GasFree batch payments and reconciliation) and **FuriosaAI × Bricksum Challenge B** (controls and records for an AI agent that spends).

## The problem

About 1.1 million foreign workers in Korea send money home every month, and the Korea to Vietnam route averages 5.15% in fees. USDT on TRON is cheaper and is what many of their families already use. But a receiving wallet needs TRX to move USDT, and the same rail is how voice-phishing money leaves Korea: the National Police Agency counted ₩1.26 trillion in losses in 2025. From 1 October 2026, crypto exchanges share the refund duty for these losses.

**Who uses Ansim:** the operations team at a licensed remittance company that pays a daily batch of transfers to workers' families in Vietnam, the Philippines and Nepal.

## What it does

1. **The operator keeps a contact book** of the families' wallets. Ansim refuses to save a wallet that is invalid, looks like an existing contact's wallet (address poisoning), is on the reported list or is frozen by Tether. It also reads the wallet's public history on TRON mainnet: a smart contract, USDT from Tether-frozen wallets, or five or more senders in a week (a money-mule pattern) marks the contact risky and holds its payments. A new contact can be paid only after a waiting period, 3 hours by default, like the delayed transfers (지연이체) Korean banks use against voice phishing. Every added or removed contact is written to the log.
2. **The owner signs the payment limits** in TronLink: a budget that includes fees, a cap per payment, a cap per contact over 30 days, a deadline and the ticked contacts. It is TIP-712 typed data, and its hash is recorded in the AnsimRegistry contract on Nile.
3. **The operator imports the day's CSV or Excel file, or asks the payout agent.** Korean headers such as 수취인 지갑주소 and 비고 are mapped automatically. Or the owner writes an instruction like "pay everyone their usual monthly support, skip anyone new or risky", and the model drafts the batch from the contacts with a reason per payment; code keeps only valid payments to real contacts.
4. **Code screens every row** for invalid addresses and amounts, duplicates, payees not in the book, lookalike wallets (address poisoning), three or more senders paying one new wallet (a money-mule pattern), reported scam wallets, Tether's live freeze list, contacts still in their waiting period, and transfers at or above Korea's Travel Rule threshold (₩1,000,000) that lack the sender's details. The AI explains only the flagged rows, in Korean and English. The operator fixes, holds or confirms each one.
5. **A pre-check** shows the GasFree payer account, supported token, balance, and total fees including the one-time activation fee. The batch page also compares the cost with a bank at 5.15%.
6. **The owner approves the batch.** The operator prepares it; the owner who signed the limits signs the exact rows and total as TIP-712 typed data. Changing any row clears the approval, and every check runs again right before paying.
7. **The vault releases the money.** The operator's USDT sits in the AnsimVault contract, not in a hot wallet. When the batch starts, the contract recomputes the owner's approval, recovers the signer on chain, and sends exactly the approved total plus 0.30 USDT per payment to the payer's GasFree account. Each approval works once, and the owner can freeze the vault.
8. **The signer pays each approved row through GasFree**, but only if the policy allows it. Statuses update live on a map from Seoul to each family's country: waiting, processing, confirming, paid or failed. A refused row is logged with its reason.
9. **Reconcile and prove.** The export links every result to its source row and note. Each family gets a receipt link in their language (Vietnamese, Tagalog or Nepali, plus Korean). The batch's closing log hash is sealed on chain, and one command lets anyone check the batch against the signed policy and the owner's approval.
10. **Answer disputes.** The dispute desk finds a payment by name, note, wallet or transaction hash, shows its log events and what the chain says, and drafts a reply in Korean and English.

## What the AI does, and what stays in code

| Kiln with gpt-oss-120b | Plain code |
|---|---|
| Maps an unfamiliar spreadsheet layout to the payout fields | Every screening check |
| Explains flagged rows in Korean and English and suggests fix, hold or pay | The policy gate: budget, cap, payees, deadline, stop |
| Writes the owner's receipt for a finished batch | Signing, submitting, polling and recovery |
| Answers an auditor's questions from the records, citing event numbers | The hash-chained log, the registry records and the verify script |
| Drafts the reply to a customer's "did it arrive?" question from the log and the chain | Waiting periods, Travel Rule holds, owner approval and the family receipts |
| Drafts a batch from the owner's instruction, with a reason per payment | Which proposed rows are valid payments to real contacts |
| Explains a new contact's wallet risk flags | The wallet history lookup and the risk flags themselves |

A wrong model answer cannot move money. The model never holds a key.

## The boundary, and where it is enforced

The agent must never pay outside the signed policy: over the budget once fees are added, above the per-payment cap, over a contact's 30-day cap, to a payee not on the list, after the deadline, or after the owner presses Stop. It must also never pay a batch the owner has not approved.

- **In the signer.** [`refuseReason`](backend/src/policy.ts) runs before every signature, in [`payRow`](backend/src/orchestrator.ts). It counts everything already paid plus the value and fee cap of payments still in flight. A refusal is recorded in the log, never silent.
- **In the vault contract.** [`AnsimVault`](contracts/src/AnsimVault.sol) holds the money. It releases a batch only if the owner's TIP-712 approval recovers to the owner on chain, only once per approval, only to the payer's GasFree account, and never more than the approved total plus the fee per payment. A compromised backend or a leaked payer key can reach at most one batch the owner signed.
- **Inside every permit.** Each GasFree permit carries its own `maxFee` and `deadline`, capped at the policy deadline, and GasFree's controller contract enforces both on chain.
- **Rows that can never be paid.** Invalid, reported and Tether-frozen wallets stay blocked even if the operator tries to confirm them. So do contacts still in their waiting period and Travel Rule transfers without the sender's details, until that changes.
- **Before the batch starts.** The owner's signed approval must match the rows marked to pay under the active policy. [`verify.mjs`](backend/scripts/verify.mjs) checks that signature and that the paid rows are exactly the approved ones.

Payments cannot happen twice. Each row is bound to one nonce and one signed permit, saved before any network call. If a response is lost, Ansim resends the same signed permit, which can execute at most once. It signs a new permit only when GasFree has rejected the old one, or after the old one's deadline has passed with its nonce unused. GasFree allows one pending transfer per account, so rows are paid one after another.

Every submission carries Ansim's own request ID, which is stored next to GasFree's trace ID and the transaction hash in the log and the export.

## Repository

| Folder | What is in it |
|---|---|
| [`frontend/`](frontend) | Next.js operator console: policy signing, import, review, payment status, audit, metrics |
| [`backend/`](backend) | Hono API: GasFree client, policy gate, screening, orchestrator, Kiln agent, event log |
| [`backend/scripts/`](backend/scripts) | `setup.mjs` wallets and demo data, `verify.mjs` independent auditor, `fake-services.mjs` local GasFree and Kiln stand-ins for testing |
| [`contracts/`](contracts) | `AnsimVault.sol`: holds the USDT and releases owner-approved batches. `AnsimRegistry.sol`: policy grants, stops and batch seals; it never holds money |

## Run it

```bash
npm install
npm run setup              # Nile test wallets in backend/.env.local, demo data in backend/data
```

Then fill in `backend/.env.local`:

- `GASFREE_API_KEY` and `GASFREE_API_SECRET` from [developer.gasfree.io](https://developer.gasfree.io/)
- `KILN_BASE_URL` and `KILN_API_KEY` from the FuriosaAI developer kit
- Send Nile TRX from the [Nile faucet](https://nileex.io/join/getJoinPage) to the notary address that setup printed

```bash
npm run deploy:contracts   # deploys AnsimRegistry to Nile
npm run deploy:vault       # deploys AnsimVault; its owner is VAULT_OWNER if set, otherwise the demo owner key
npm run dev                # backend on :4000, console on http://localhost:3000
```

Open the console, press **Pre-check**, and send Nile test USDT to the GasFree address it shows. GasFree's Nile fees are 0.30 USDT per transfer plus 1.00 USDT once to activate the account, so about 50 test USDT covers all four demo runs. Import `backend/data/demo/ansim-demo-payouts.xlsx` to try the full flow.

```bash
npm run check                               # unit tests for the policy gate, screening, parsing and log
npm run verify -- path/to/ansim-evidence.json   # independent audit of an exported batch
npm run reset                               # clear the local database before a clean demo
```

## Public deployment

The console runs on Vercel and the backend runs on Railway. The backend holds the payer key and the event log, so two locks protect it:

- **Backend key.** With `BACKEND_KEY` set, the backend refuses every request without it except `/api/health`. The console's proxy adds the key.
- **Site password.** With `SITE_PASSWORD` set on Vercel, the browser asks for it before showing anything.

**Backend on Railway.** Project `ansim`, service `ansim-backend`, live at `https://ansim-backend-production.up.railway.app`.

- It builds from `backend/Dockerfile`, selected by the service variable `RAILWAY_DOCKERFILE_PATH=backend/Dockerfile`.
- The database lives on a volume mounted at `/data`, set by `ANSIM_DB=/data/ansim-live.db`.
- The service has the same variables as `backend/.env.local`, including `BACKEND_KEY`.
- The service is not connected to GitHub, so redeploy from the repository root after backend changes:

  ```bash
  railway up --detach -s ansim-backend
  ```

**Console on Vercel.** Set the root directory to `frontend`, add these variables, then redeploy:

| Variable | Value |
|---|---|
| `BACKEND_URL` | `https://ansim-backend-production.up.railway.app` |
| `BACKEND_KEY` | the same value as in `backend/.env.local` |
| `SITE_PASSWORD` | a password to give the judges |

**Custom domain.** Names under `qd.je` can't be verified on Vercel, because Vercel asks for a record in DigitalPlat's parent zone. Add a free `vercel.app` name under Domains instead.

## Live on Nile

| What | Link |
|---|---|
| AnsimRegistry contract | [TUcz2dryzQLTTyTFooLwoFxP5cWugCq8xq](https://nile.tronscan.org/#/contract/TUcz2dryzQLTTyTFooLwoFxP5cWugCq8xq) |
| First real test: policy recorded | [0565f2e9…1a177](https://nile.tronscan.org/#/transaction/0565f2e9302745773357709e132a5a75c466ccfa5f94dcf6308994e450c1a177) |
| First real test: GasFree payment, 0.50 USDT plus 1.30 fee | [e30fe082…ed258](https://nile.tronscan.org/#/transaction/e30fe0822003ab98bffacaf0dc7c3e71e382ee95bcbe85d15a054aecf0fed258) |
| First real test: batch sealed | [8a1e696f…9fc29](https://nile.tronscan.org/#/transaction/8a1e696fe0544cb008a2220a015d5b37532f605655a15c46592b4c5d9174fc29) |

In that test, a second row to a payee left off the policy was refused and recorded, and `verify.mjs` passed all 11 checks against the chain.

**Vault test, 30 September 2026.** The operator's idle USDT moved into the vault, the owner approved two payments, the vault checked the signature on chain and released exactly the approved total plus fees, both families were paid, and `verify.mjs` passed all 18 checks. With the vault frozen, the next batch was refused.

| What | Link |
|---|---|
| AnsimVault contract | [TWWL6N7DyNzbJ9zZLXncVtcDdu5hDdmL8k](https://nile.tronscan.org/#/contract/TWWL6N7DyNzbJ9zZLXncVtcDdu5hDdmL8k) |
| 997.90 USDT moved from the GasFree account into the vault | [e0e3cf0a…ece43](https://nile.tronscan.org/#/transaction/e0e3cf0acfa2d8d41530601dc837d0d0d48f54938ccd60a815e95f7f4d4ece43) |
| Vault release for an approved batch: 1.00 + 2 × 0.30 | [77883b21…acd10](https://nile.tronscan.org/#/transaction/77883b217d9f03d809fc4d8bf5e0864ef6b5701c55825d3d3b6e22ce407acd10) |
| Payment to Nguyen Thi Lan, 0.50 USDT | [86707aac…de3f9](https://nile.tronscan.org/#/transaction/86707aac066fb47e14fa1df5c3862ba1081dbba2b48cb2c249f279a2dcdde3f9) |
| Payment to Tran Van Minh, 0.50 USDT | [cab75dcc…c2a1](https://nile.tronscan.org/#/transaction/cab75dccb8e1e2963ee6a2935e784566bf5d67c7a62ab055bb1755a0fa8ac2a1) |
| Batch sealed in the registry | [1586d821…b7278](https://nile.tronscan.org/#/transaction/1586d821730cd872a490adafd2e6cbf8260ded48130b53849a16cab32d2b7278) |
| Owner froze the vault | [29fea4c8…ff35f8](https://nile.tronscan.org/#/transaction/29fea4c879f0a64959e8251367cf009ae11fdf34df5126dab7317e22e8ff35f8) |

## Demo runs

The demo file has 13 rows: 4 clean, 1 unusual amount explained by its note (추석 보너스), and 8 that must not be paid. Those are a duplicate, a lookalike of a known payee's wallet, an invalid address, three senders paying one new wallet, a Tether-frozen wallet and a reported wallet.

| Run | Condition | Expected outcome | Transaction | Log event |
|---|---|---|---|---|
| 1 | Budget 30 USDT, all payees | 5 paid, 8 held; a dropped response on line 3 recovers without a second payment | _fill in_ | _fill in_ |
| 2 | Budget cut to 8 USDT | Lines 4 and 14 refused, over budget once fees are added | _fill in_ | _fill in_ |
| 3 | Maria Santos removed from the payee list | Line 4 refused, payee not allowed | _fill in_ | _fill in_ |
| 4 | Owner presses Stop mid-batch | Remaining rows refused, stopped by the owner | _fill in_ | _fill in_ |

## Alerts

With `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` set, the owner gets a Telegram message for every refusal, failure, Stop, new contact, batch approval and finished batch. Create a bot with @BotFather, send it a message, and read the chat id from `https://api.telegram.org/bot<token>/getUpdates`. The console has a test button.

## Tokens and energy

Every Kiln call is logged under its flow, and the **Tokens & energy** page reports calls, prompt and output tokens, and latency per flow.

The energy estimate is an upper bound from FuriosaAI's published figures for gpt-oss-120b on two RNGD cards: 5.8 ms per output token, with each card well under 180 W.

```
2 cards × 180 W × 0.0058 s ≈ 2.1 J per output token
```

Prompt tokens are processed in parallel and left out of the estimate.

How the design avoids inference:

- Clean rows never reach the model. Code runs every check first.
- One call explains all flagged rows in a batch.
- A spreadsheet layout mapped once is cached, so the next import costs no tokens.
- Replies are short JSON with a token cap and low reasoning effort.
- Refusals cost nothing, because the policy gate is code.

## Challenge criteria

**TRON Challenge C**

| Criterion | Where to see it |
|---|---|
| Import & Validation | Batch page: CSV or Excel import, 9 row checks, inline fixes, totals |
| Balance & Fee Pre-Check | Pre-check panel: GasFree account, token, balance, transfer and activation fees |
| Authorization & Orchestration | Owner-signed policy and batch approval; AnsimVault releases only the approved batch; then one TIP-712 permit per row, submitted in order |
| Per-Transaction Status & Recovery | Live status per row with request ID and hash; the dropped-response demo on line 3 |
| Reconciliation & Export | CSV export linked to source rows and notes; paid, refused, failed and held counts |

**FuriosaAI × Bricksum Challenge B**

| Criterion | Where to see it |
|---|---|
| Declared Function & User Need | First line of this README; the table of AI tasks and code; the payout agent drafts a batch from the owner's words |
| Boundaries & Stopping | Runs 2, 3 and 4; the 30-day cap per contact; refusals recorded with reasons in the log |
| Kiln API Integration & Efficiency | Four Kiln flows on gpt-oss-120b; the Tokens & energy page |
| Blockchain Integration | GasFree USDT payments on Nile; AnsimVault checks the owner's signature on chain before releasing money; policy and batch records in AnsimRegistry |
| Approval & Evidence | Owner signs the limits and approves each batch, watches, stops, gets Telegram alerts and a receipt; `verify.mjs` rebuilds the answer from the export and the chain; the dispute desk answers customers from the same records |

## Honest notes

- All code in this repository was written during the hackathon, on 29 and 30 September 2026. The frontend started from `create-next-app`.
- The reported-wallet list is a stand-in for wallets reported to police and exchanges.
- The vault's owner is the demo owner key, so approvals signed with that key unlock it. To make a TronLink account the owner, deploy with `VAULT_OWNER=<address> npm run deploy:vault`, or have the current owner call `setOwner`. The vault test above ran from a scratch database, so its batches are not in the live console.
- The wallet history check reads TRON mainnet even in the Nile demo, because that is where real families' wallets have a history. The demo wallets have none, so they show as never used.
- `fake-services.mjs` exists only to test the payment and AI logic without keys. Its transaction hashes are made up, and `verify.mjs` correctly fails them against the chain. Its AI replies are marked [fake].
- The receipt translations were written without a native speaker's check. The KRW rate for the Travel Rule threshold is a setting (`KRW_PER_USDT`), not a live quote.
- The AI works with any OpenAI-compatible API. With a provider other than Kiln, the energy estimate does not apply, and the Tokens & energy page says so.
- Unlicensed crypto remittance is illegal in Korea. Ansim is built for licensed operators and adds the controls regulators ask for.

## Sources

- [Seoulz: voice-phishing losses by agency, 2025](https://www.seoulz.com/korea-voice-phishing-2026/)
- [Financial News: crypto voice-phishing refunds from 1 October 2026](https://www.fnnews.com/news/202607151657505105)
- [Spark: Korea to Vietnam remittance costs](https://www.spark.money/research/crypto-remittance-corridor-economics)
- [FuriosaAI: gpt-oss-120b on two RNGD cards](https://furiosa.ai/blog/serving-gpt-oss-120b-at-5-8-ms-tpot-with-two-rngd-cards-compiler-optimizations-in-practice)
- [GasFree developer documentation](https://docs.gasfree.io/)
- [TRON developer documentation](https://developers.tron.network/)
