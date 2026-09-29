# Ansim 안심

**Ansim is a wallet and approval tool: an AI payout agent that pays USDT batches on TRON through GasFree only inside a budget, payee list and deadline the owner signed, and records every payment and refusal so anyone can audit it.**

안심 means “peace of mind”. Korean banks use the word for their fraud-blocking services.

Built at GWDC 2026 Korea for **TRON Challenge C** (GasFree batch payments and reconciliation) and **FuriosaAI × Bricksum Challenge B** (controls and records for an AI agent that spends).

## The problem

About 1.1 million foreign workers in Korea send money home every month, and the Korea to Vietnam route averages 5.15% in fees. USDT on TRON is cheaper and is what many of their families already use. But a receiving wallet needs TRX to move USDT, and the same rail is how voice-phishing money leaves Korea: the National Police Agency counted ₩1.26 trillion in losses in 2025. From 1 October 2026, crypto exchanges share the refund duty for these losses.

**Who uses Ansim:** the operations team at a licensed remittance company that pays a daily batch of transfers to workers' families in Vietnam, the Philippines and Nepal.

## What it does

1. **The owner signs a spending policy** in TronLink: a budget that includes fees, a cap per payment, a deadline and the allowed payees. It is TIP-712 typed data, and its hash is recorded in the AnsimRegistry contract on Nile.
2. **The operator imports the day's CSV or Excel file.** Korean headers such as 수취인 지갑주소 and 비고 are mapped automatically.
3. **Code screens every row** for invalid addresses and amounts, duplicates, payees not in the book, lookalike wallets (address poisoning), three or more senders paying one new wallet (a money-mule pattern), reported scam wallets and Tether's live freeze list. The AI explains only the flagged rows, in Korean and English. The operator fixes, holds or confirms each one.
4. **A pre-check** shows the GasFree payer account, supported token, balance, and total fees including the one-time activation fee.
5. **The signer pays each approved row through GasFree**, but only if the policy allows it. Statuses update live: waiting, processing, confirming, paid or failed. A refused row is logged with its reason.
6. **Reconcile and prove.** The export links every result to its source row and note. The batch's closing log hash is sealed on chain, and one command lets anyone check the batch against the signed policy.

## What the AI does, and what stays in code

| Kiln with gpt-oss-120b | Plain code |
|---|---|
| Maps an unfamiliar spreadsheet layout to the payout fields | Every screening check |
| Explains flagged rows in Korean and English and suggests fix, hold or pay | The policy gate: budget, cap, payees, deadline, stop |
| Writes the owner's receipt for a finished batch | Signing, submitting, polling and recovery |
| Answers an auditor's questions from the records, citing event numbers | The hash-chained log, the registry records and the verify script |

A wrong model answer cannot move money. The model never holds a key.

## The boundary, and where it is enforced

The agent must never pay outside the signed policy: over the budget once fees are added, above the per-payment cap, to a payee not on the list, after the deadline, or after the owner presses Stop.

- **In the signer.** [`refuseReason`](backend/src/policy.ts) runs before every signature, in [`payRow`](backend/src/orchestrator.ts). It counts everything already paid plus the value and fee cap of payments still in flight. A refusal is recorded in the log, never silent.
- **Inside every permit.** Each GasFree permit carries its own `maxFee` and `deadline`, capped at the policy deadline, and GasFree's controller contract enforces both on chain.
- **Rows that can never be paid.** Invalid, reported and Tether-frozen wallets stay blocked even if the operator tries to confirm them.

Payments cannot happen twice. Each row is bound to one nonce and one signed permit, saved before any network call. If a response is lost, Ansim resends the same signed permit, which can execute at most once. It signs a new permit only after the old one's deadline has passed with its nonce unused.

## Repository

| Folder | What is in it |
|---|---|
| [`frontend/`](frontend) | Next.js operator console: policy signing, import, review, payment status, audit, metrics |
| [`backend/`](backend) | Hono API: GasFree client, policy gate, screening, orchestrator, Kiln agent, event log |
| [`backend/scripts/`](backend/scripts) | `setup.mjs` wallets and demo data, `verify.mjs` independent auditor, `fake-services.mjs` local GasFree and Kiln stand-ins for testing |
| [`contracts/`](contracts) | `AnsimRegistry.sol`: policy grants, stops and batch seals on Nile. It never holds money |

## Run it

```bash
npm install
npm run setup              # Nile test wallets in backend/.env.local, demo data in backend/data
```

Then fill in `backend/.env.local`:

- `GASFREE_API_KEY` and `GASFREE_API_SECRET` from the GasFree Developers Center
- `KILN_BASE_URL` and `KILN_API_KEY` from the FuriosaAI developer kit
- Send Nile TRX from the [Nile faucet](https://nileex.io/join/getJoinPage) to the notary address that setup printed

```bash
npm run deploy:contracts   # deploys AnsimRegistry to Nile
npm run dev                # backend on :4000, console on http://localhost:3000
```

Open the console, press **Pre-check**, and send Nile test USDT to the GasFree address it shows. Import `backend/data/demo/ansim-demo-payouts.xlsx` to try the full flow.

```bash
npm run check                               # unit tests for the policy gate, screening, parsing and log
npm run verify -- path/to/ansim-evidence.json   # independent audit of an exported batch
```

## Demo runs

The demo file has 13 rows: 4 clean, 1 unusual amount explained by its note (추석 보너스), and 8 that must not be paid. Those are a duplicate, a lookalike of a known payee's wallet, an invalid address, three senders paying one new wallet, a Tether-frozen wallet and a reported wallet.

| Run | Condition | Expected outcome | Transaction | Log event |
|---|---|---|---|---|
| 1 | Budget 30 USDT, all payees | 5 paid, 8 held; a dropped response on line 3 recovers without a second payment | _fill in_ | _fill in_ |
| 2 | Budget cut to 8 USDT | Lines 4 and 14 refused, over budget once fees are added | _fill in_ | _fill in_ |
| 3 | Maria Santos removed from the payee list | Line 4 refused, payee not allowed | _fill in_ | _fill in_ |
| 4 | Owner presses Stop mid-batch | Remaining rows refused, stopped by the owner | _fill in_ | _fill in_ |

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
| Authorization & Orchestration | Owner-signed policy, then one TIP-712 permit per row, submitted in order |
| Per-Transaction Status & Recovery | Live status per row with request ID and hash; the dropped-response demo on line 3 |
| Reconciliation & Export | CSV export linked to source rows and notes; paid, refused, failed and held counts |

**FuriosaAI × Bricksum Challenge B**

| Criterion | Where to see it |
|---|---|
| Declared Function & User Need | First line of this README; the table of AI tasks and code |
| Boundaries & Stopping | Runs 2, 3 and 4; refusals recorded with reasons in the log |
| Kiln API Integration & Efficiency | Four Kiln flows on gpt-oss-120b; the Tokens & energy page |
| Blockchain Integration | GasFree USDT payments on Nile; policy and batch records in AnsimRegistry |
| Approval & Evidence | Owner grants, watches, stops and gets a receipt; `verify.mjs` rebuilds the answer from the export and the chain |

## Honest notes

- All code in this repository was written during the hackathon, on 29 and 30 September 2026. The frontend started from `create-next-app`.
- The reported-wallet list is a stand-in for wallets reported to police and exchanges.
- `fake-services.mjs` exists only to test the payment and AI logic without keys. Its transaction hashes are made up, and `verify.mjs` correctly fails them against the chain. Its AI replies are marked [fake].
- Unlicensed crypto remittance is illegal in Korea. Ansim is built for licensed operators and adds the controls regulators ask for.

## Sources

- [Seoulz: voice-phishing losses by agency, 2025](https://www.seoulz.com/korea-voice-phishing-2026/)
- [Financial News: crypto voice-phishing refunds from 1 October 2026](https://www.fnnews.com/news/202607151657505105)
- [Spark: Korea to Vietnam remittance costs](https://www.spark.money/research/crypto-remittance-corridor-economics)
- [FuriosaAI: gpt-oss-120b on two RNGD cards](https://furiosa.ai/blog/serving-gpt-oss-120b-at-5-8-ms-tpot-with-two-rngd-cards-compiler-optimizations-in-practice)
- [GasFree SDK reference](https://github.com/madmatvey/gasfree_sdk)
