# Ansim × FuriosaAI × Bricksum

### Agent Finance track, Challenge B: the controls and records for an AI agent that spends

**Declared function:** Ansim is a wallet and approval tool: an AI payout agent that pays USDT batches on TRON through GasFree only inside a budget, payee list and deadline the owner signed, from an on-chain vault that releases money only for batches the owner approved, and records every payment and refusal so anyone can audit it.

The FuriosaAI × Bricksum Agent Finance track asks what keeps an agent's spending inside the line the user drew, and what settles the question afterwards. Ansim answers both:

- **Inside the line:** a signed policy, a signed approval per batch, and a vault contract that checks that approval on chain.
- **Afterwards:** a hash-chained log, a seal on chain, receipts, a dispute desk, and a verifier anyone can run.

[User & Workflow](#declared-function--user-need) • [Boundaries](#boundaries--stopping) • [Kiln](#kiln-api-integration--efficiency) • [Blockchain](#blockchain-integration) • [Approval & Evidence](#approval--evidence) • [Honest Notes](#honest-notes)

## Declared Function & User Need

**User:** the operations team and owner of a licensed remittance company in Korea, paying a daily USDT batch to workers' families in Vietnam, the Philippines and Nepal.

**Problem:** the rail they use, USDT on TRON, is also how voice-phishing money leaves Korea. From 1 October 2026 exchanges share the refund duty for those losses. An agent that pays cannot be allowed to pay a lookalike wallet, a money mule, a frozen wallet, or anyone outside what the owner allowed. Afterwards, anyone must be able to check what it did.

**Workflow, from input to outcome:**

```
Owner signs limits (TronLink)  ─▶  Operator: file or "pay everyone their usual monthly support"
        │                                   │ model drafts the batch (gpt-oss)
        │                                   ▼ code keeps only valid payments to real contacts
        │                          12 checks in code  ─▶  model explains the flagged rows
        ▼                                   │
Owner approves the exact rows (TronLink)  ◀─┘
        │
AnsimVault checks the approval on chain and releases the money
        │
Policy gate before every signature  ─▶  GasFree pays each family  ─▶  receipt, seal, verify
```

| The agent (model) | Plain code |
|---|---|
| Drafts a batch from the owner's instruction, with a reason per payment | Which proposed rows are valid payments to real contacts |
| Maps an unfamiliar spreadsheet layout to the payout fields | Every check, and which flags block or hold |
| Explains flagged rows in Korean and English and suggests fix, hold or pay | The policy gate: budget with fees, caps, payees, deadline, stop |
| Explains a new contact's wallet-risk flags | The wallet-history lookup and the risk flags themselves |
| Writes the owner's receipt for a finished batch | Signing, submitting, polling and recovery |
| Answers an auditor's questions, citing event numbers | The hash-chained log, the registry records, `verify.mjs` |
| Drafts the reply to a customer's "did it arrive?" | The vault, the approvals, the family receipts |

A wrong model answer cannot move money. The model never holds a key, never signs and never calls the chain.

## Boundaries & Stopping

**The boundary:** the agent must never pay any of the following.

- over the budget once fees are added,
- above the cap per payment,
- over a contact's 30-day cap,
- to a payee not on the signed list,
- after the deadline,
- after the owner presses Stop,
- a batch the owner has not approved,
- more than the vault released for that approval.

**Where it is enforced:**

| Layer | Enforced by | File |
|---|---|---|
| Before every signature | `refuseReason`: stop, active policy, deadline, payee, per-payment cap, 30-day cap, budget with fees and in-flight payments | [`backend/src/policy.ts`](../backend/src/policy.ts), [`payRow`](../backend/src/orchestrator.ts) |
| Before a batch starts | The owner's `BatchApproval` must match the exact rows and the active policy; every check runs again | [`payBatch`](../backend/src/desk.ts) |
| On chain, before money moves | `AnsimVault.release`: the owner's signature is recovered on chain, each approval works once, nothing is released while frozen | [`contracts/src/AnsimVault.sol`](../contracts/src/AnsimVault.sol) |
| Inside every permit | GasFree's controller enforces each permit's `maxFee` and `deadline` | [`signPermit`](../backend/src/gasfree.ts) |
| Rows that can never be paid | Invalid, reported, Tether-frozen, new contact still waiting, Travel Rule details missing | [`backend/src/screen.ts`](../backend/src/screen.ts) |

**Stopping is recorded, never silent:**

- **In the log:** every refusal is a `ROW_REFUSED` event with the policy, the amount, what was already committed, the contact's 30-day total and the reason.
- **At the vault:** a refused release is `VAULT_REFUSED`.
- **To the owner:** every refusal goes out as a Telegram alert.
- **Checked afterwards:** `verify.mjs` recomputes every refusal from the signed policy and fails if one wasn't required.

**Runs pushed outside the permitted scope:**

| Run | Pushed outside by | Result | Where it is recorded |
|---|---|---|---|
| Payee not on the signed list | A row to a wallet left off the policy (first real Nile test) | `PAYEE_NOT_ALLOWED`, refused | `ROW_REFUSED` in the log; `verify.mjs` confirms the refusal was required |
| Vault frozen by the owner | A batch approved after the owner froze the vault (Nile) | `VAULT_REFUSED`: the release was refused | [freeze transaction 29fea4c8…](https://nile.tronscan.org/#/transaction/29fea4c879f0a64959e8251367cf009ae11fdf34df5126dab7317e22e8ff35f8) and the `VAULT_REFUSED` event |
| Over the cap per payment | The agent prompt "Send 20 USDT to every contact" with a 15 USDT cap | `OVER_PER_PAYMENT_CAP` on every row | Run live in the demo |
| Over the budget with fees | A budget smaller than the batch plus 0.30 per payment | `OVER_BUDGET_WITH_FEES` on the rows that don't fit | Run live in the demo |
| Owner presses Stop mid-batch | **Stop all payments** during a run | `STOPPED_BY_OWNER` on the remaining rows | Run live in the demo |
| Over the 30-day cap per contact | A contact who already got their monthly cap | `OVER_MONTHLY_PAYEE_CAP` | Unit test in [`core.test.ts`](../backend/src/core.test.ts); `verify.mjs` rechecks it on every paid row |

## Kiln API Integration & Efficiency

### Integration

Every model call goes through one function, [`ask()` in `backend/src/agent.ts`](../backend/src/agent.ts). It calls Kiln's OpenAI-compatible chat API:

| Setting | Kiln | Also works with |
|---|---|---|
| `KILN_BASE_URL` | the Kiln endpoint from the FuriosaAI developer kit | any OpenAI-compatible API, such as `https://openrouter.ai/api/v1` |
| `KILN_API_KEY` | the Kiln key | that provider's key |
| `KILN_MODEL` | `gpt-oss-120b` | `openai/gpt-oss-120b`, `openai/gpt-oss-20b` |

- **Short, cheap answers:** each call asks for one JSON object only, with `reasoning_effort: low`. If a server rejects that setting, Ansim retries once without it and remembers.
- **Logged by flow:** every call writes its prompt, completion and total tokens, latency and effort to the `tokens` table under its flow. The console's **Tokens & energy** page shows those per flow, never as a single total, with the model and the provider.

### The flows, and how their answers change what the agent does

| Flow | When it runs | Token cap | What the answer does | What code checks |
|---|---|---|---|---|
| `plan` | The owner types an instruction | 1,500 | Becomes the draft batch: contact, amount, note, reason per row | Drops any row that isn't a valid positive payment to a real contact; the batch then goes through every check, the approval and the vault |
| `map_columns` | A spreadsheet layout Ansim hasn't seen | 600 | Maps the file's columns to sender, recipient, wallet, amount and note | Must name real headers, including wallet and amount; cached, so a layout costs tokens once |
| `review_flags` | The operator presses **Explain flagged rows** | 1,500 | A Korean and English explanation per flagged row, and a suggestion to fix, hold or pay | Never unblocks a blocking flag; the operator decides |
| `wallet_check` | A new contact is added | 400 | Explains the risk flags code derived from the wallet's mainnet history | The flags and the hold are set by code |
| `receipt` | A batch is closed | 900 | The owner's receipt in Korean and English | Uses only the numbers code passes in |
| `audit_qa` | An auditor asks a question on the batch page | 900 | An answer citing event numbers like [#41] | The events are the hash-chained log |
| `dispute` | The dispute desk drafts a reply | 900 | A Korean and English reply to the customer | Uses only the matched payments, their events and the chain's answer |

### How the design avoids inference

- **Clean rows never reach the model.** All 12 checks run in code first, and one call explains every flagged row in a batch.
- **Refusals cost nothing.** The policy gate, the vault and the approvals are code and contracts.
- **A spreadsheet layout is mapped once.** It's cached by its header signature, so the next import costs no tokens.
- **Answers are short.** Each flow has a JSON-only reply, a token cap and low reasoning effort.
- **Inputs are small.** A new contact's explanation gets only the derived facts, and a dispute gets only the matched payments.
- **The agent drafts once.** Planning is one call per instruction; the batch then runs without the model.

### Energy estimate

An upper bound from FuriosaAI's published figures for gpt-oss-120b on two RNGD cards: 5.8 ms per output token, with each card well under 180 W.

```
2 cards × 180 W × 0.0058 s ≈ 2.09 J per output token
```

Assumptions:
- Prompt tokens are processed in parallel, so they're left out.
- Real power draw is lower than 180 W.
- Batching shares the power across requests.
- The estimate describes Kiln's hardware only. With another provider, the Tokens & energy page says it does not apply.

### Measured so far on the live site

| Flow | Calls | Prompt tokens | Output tokens | Avg latency |
|---|---|---|---|---|
| `plan` | 2 | 1,674 | 701 | 14.9 s |
| `receipt` | 1 | 202 | 210 | 10.3 s |
| `audit_qa` | 1 | 404 | 201 | 1.6 s |

These calls were served by OpenRouter with `openai/gpt-oss-20b` (see [Honest notes](#honest-notes)). The live page always shows the current numbers.

## Blockchain Integration

All on TRON's Nile testnet (chain 3448148188).

**What the agent reads, writes and settles:**

| | On chain |
|---|---|
| **Reads** | The vault's balance, owner and frozen flag. The payer's GasFree account (balance, nonce, activation). Tether's freeze list and each contact's wallet history (mainnet, read only) |
| **Writes** | The policy's hash in AnsimRegistry when the owner signs. The batch's closing log hash in AnsimRegistry when it closes |
| **Settles** | The vault's release of the approved batch, then each family's USDT payment through GasFree |

**A complete end-to-end run, with the matching log entries** (live batch #1, 30 September 2026):

| Log event | On chain |
|---|---|
| Policy #7 signed in TronLink (`POLICY_ACTIVATED`, `POLICY_RECORDED`) | [172817d3…3accb4](https://nile.tronscan.org/#/transaction/172817d313c56a681fd4878ebfae1dd13649c55c754587d8e982c9946f3accb4) |
| #37 `AGENT_PLANNED`: "Pay everyone their usual monthly support." | none (a model call; tokens logged under `plan`) |
| #38 `BATCH_APPROVED`: the owner signed the exact row in TronLink | none (a signature checked on chain at #39) |
| #39 `VAULT_RELEASED`: 2.80 USDT | [7aa70e5c…64b25](https://nile.tronscan.org/#/transaction/7aa70e5c8316d50823f2e873f50aa0f925c00910afa7c1fcadfd103830464b25) |
| #41 `ROW_SIGNED` → #42 `ROW_SUBMITTED` → #43–#45 `ROW_STATE`: 2.50 USDT to Dummy 2 | [f2fbcd70…68f05](https://nile.tronscan.org/#/transaction/f2fbcd7018e913960b09a9de1e008150137a02a6d9fd62627a9f4b365c768f05) |
| #46 `BATCH_CLOSED` → #47 `BATCH_SEALED` | [d4ee79c3…335d1fc](https://nile.tronscan.org/#/transaction/d4ee79c39c67abafb5807c76b1551b8be76c47ed14ce4cceee308dfe7335d1fc) |

## Approval & Evidence

**The human side:**

| The owner… | How |
|---|---|
| **grants** a budget | Signs the payment limits in TronLink: budget with fees, caps, contacts, deadline |
| **approves** each batch | Signs the exact rows and total in TronLink; the vault checks that signature on chain |
| **follows** what is spent | Live row states, the payout map, the committed-budget meter, and Telegram alerts for approvals, releases, refusals, failures and finished batches |
| **stops** the agent | **Stop all payments** (the policy gate refuses everything), or **Freeze vault** from TronLink (the contract refuses every release) |
| **receives** a receipt | An AI-written receipt in Korean and English, the CSV and evidence exports, and each family's own receipt, which they can confirm |

**Another person, from the records alone:** an auditor gets the evidence file (`ansim-evidence-2`) and runs:

```bash
npm run verify -- ansim-evidence-1.json
```

[`verify.mjs`](../backend/scripts/verify.mjs) does not import any of Ansim's code. It re-implements the rules and uses only that file and public TRON data. It checks:

- **the log:** the hash chain is unbroken;
- **the policy:** the owner's signature and payee list, and its hash in the registry;
- **the approval:** the owner signed it before the first payment, and it covers exactly the paid rows;
- **the vault:** its release matches the contract, stayed within the approved total plus fees, and came first;
- **each payment:** it matches the chain and stayed inside the policy, including the 30-day cap, the fee cap, the waiting period and the Travel Rule;
- **each refusal:** it was required.

Live batch #1 passes **16 of 16**. **Verify a tampered copy** raises one paid amount by 1 USDT, and verify fails. The dispute desk and **Ask the auditor AI** answer from the same records, citing event numbers.

## Honest Notes

- **The Kiln key did not arrive during the event.** The FuriosaAI developer kit's Kiln endpoint and key were not available to us, so the live AI runs on OpenRouter with `openai/gpt-oss-20b`, chosen for low cost. It uses the same OpenAI-compatible client, flows, prompts, token caps and per-flow logging as Kiln. Switching to Kiln with `gpt-oss-120b` means setting `KILN_BASE_URL`, `KILN_API_KEY` and `KILN_MODEL`.
- **The energy estimate is for Kiln's RNGD hardware.** It does not describe the OpenRouter calls, and the Tokens & energy page says so.
- **The model is never trusted with money.** Every rule that decides whether money moves is code or a contract, and every model answer is checked by code before it's used.
