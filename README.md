# Ansim 안심

### Payouts, inside the signed line

**Declared function:** Ansim is a wallet and approval tool: an AI payout agent that pays USDT batches on TRON through GasFree only inside a budget, payee list and deadline the owner signed, from an on-chain vault that releases money only for batches the owner approved, and records every payment and refusal so anyone can audit it.

안심 means "peace of mind". Korean banks use the word for their fraud-blocking services.

[Architecture](#architecture) • [How It Works](#how-it-works) • [Protection](#multi-layer-protection) • [Contracts](#contracts) • [Getting Started](#getting-started) • [Demo](#demo) • [Partners](#partners) • [License](#license)

| | |
|---|---|
| Live console | https://ansim-ecru.vercel.app |
| Backend API | https://ansim-backend-production.up.railway.app (requires the backend key) |
| Telegram alerts | [@ansimbot](https://t.me/ansimbot) |
| Contracts on Nile | [AnsimVault](https://nile.tronscan.org/#/contract/TWWL6N7DyNzbJ9zZLXncVtcDdu5hDdmL8k) · [AnsimRegistry](https://nile.tronscan.org/#/contract/TUcz2dryzQLTTyTFooLwoFxP5cWugCq8xq) |

Built at GWDC 2026 Korea for **TRON Challenge C** (a GasFree stablecoin batch payment and reconciliation assistant) and the **FuriosaAI × Bricksum Agent Finance track, Challenge B** (the controls and records for an AI agent that spends). The partner write-ups are in [docs/TRON.md](docs/TRON.md) and [docs/FURIOSAAI-BRICKSUM.md](docs/FURIOSAAI-BRICKSUM.md).

## The Problem

About 1.1 million foreign workers in Korea send money home every month. The Korea to Vietnam route averages **5.15%** in fees. USDT on TRON is cheaper and is what many of their families already use, but a wallet needs TRX before it can move USDT.

The same rail is how voice-phishing money leaves Korea. The National Police Agency counted **₩1.26 trillion** in voice-phishing losses in 2025. From **1 October 2026**, crypto exchanges share the duty to refund those losses. Scammers use three moves again and again:

- **Pressure:** "send it to this new account now".
- **Address poisoning:** a wallet that looks like the family's, with the same first and last characters.
- **Money mules:** many unrelated senders paying one fresh wallet.

Putting an AI agent in charge of payouts makes this worse unless something stops it. A payment on chain shows who paid whom. It does not show who authorised the payment, or under what conditions. An agent that stays inside a budget only does so because someone built it to.

**Who uses Ansim:** the operations team at a licensed remittance company that pays a daily batch of transfers to workers' families in Vietnam, the Philippines and Nepal.

## The Solution

Ansim puts the agent between two things it cannot change: the owner's signature and the chain.

- **The owner draws the line.** A budget that includes fees, a cap per payment, a cap per contact over 30 days, a deadline and the allowed contacts, signed as TIP-712 typed data in TronLink and recorded on chain.
- **Code checks every payment.** 12 checks run before anything is paid, and again right before paying. They cover address poisoning, money mules, Tether's live freeze list, reported wallets, new contacts in their waiting period (like the 지연이체 delayed transfers Korean banks use), the Travel Rule threshold and more.
- **The owner approves the exact batch.** One more TIP-712 signature over the exact rows and total. Changing any row clears it.
- **A vault releases only what was approved.** The operator's USDT sits in the AnsimVault contract. The contract recovers the owner's signature on chain and releases exactly the approved total plus GasFree's fee, once per approval. The owner can freeze it from TronLink.
- **GasFree pays without TRX.** Families receive the full amount and never need TRX. A lost response never causes a second payment.
- **Everything is on the record.** A hash-chained log, the batch sealed on chain, receipts for the families in their language, a dispute desk, and one command that lets anyone rebuild the answer from the records alone.

> The agent pays. The owner draws the line. Ansim does not make the agent trustworthy; it makes it answerable.

## Architecture

```
 BROWSER                           VERCEL                       RAILWAY
┌───────────────────────────┐    ┌────────────────────┐ key  ┌──────────────────────────────────┐
│ Operator console           │───▶│ Next.js console     │─────▶│ Hono API  (backend/)              │
│  contacts · limits · batch │    │ proxy.ts            │      │  12 checks · policy gate          │
│  vault · map · disputes    │    │  site password      │      │  orchestrator · recovery          │
│ TronLink: owner signs      │    │  adds backend key   │      │  hash-chained log (SQLite volume) │
│ Family receipt /r/<token>  │    │  lets receipts pass │      │  AI flows · Telegram · verify.mjs │
└───────────────────────────┘    └────────────────────┘      └───┬─────────┬─────────┬─────────┬─┘
                                                                  │         │         │         │
 TRON NILE (chain 3448148188)                                     │         │         │         │
┌──────────────────────────────────────────────────┐              │         │         │         │
│ AnsimVault      holds the USDT                    │◀─ release ──┘         │         │         │
│   checks the owner's TIP-712 approval on chain    │   (notary key)        │         │         │
│   sends approved total + fees ───┐                │                       │         │         │
│                                  ▼                │                       │         │         │
│ Payer's GasFree account ── GasFree controller ────│◀─ PermitTransfer ─────┘         │         │
│   USDT to each family, no TRX needed              │   (GasFree API)                 │         │
│ AnsimRegistry   policy hashes · batch seals       │◀─ records (notary key) ─────────┘         │
└──────────────────────────────────────────────────┘                                            │
 TRON MAINNET (read only): Tether freeze list · wallet history          ◀───────────────────────┤
 AI: FuriosaAI Kiln or any OpenAI-compatible API, gpt-oss               ◀───────────────────────┤
 Telegram @ansimbot: owner alerts · family arrival messages             ◀───────────────────────┘
```

### Chain Details

| Chain | Role | Chain ID | RPC | Explorer |
|---|---|---|---|---|
| TRON Nile testnet | Payments, vault, registry | 3448148188 (`0xcd8690dc`) | https://nile.trongrid.io | [nile.tronscan.org](https://nile.tronscan.org) |
| TRON mainnet | Read only: Tether's freeze list and wallet history | 728126428 (`0x2b6653dc`) | https://api.trongrid.io | [tronscan.org](https://tronscan.org) |

### Key Addresses

| Contract | Chain | Address |
|---|---|---|
| USDT (test token) | Nile | `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf` |
| GasFree controller | Nile | `THQGuFzL87ZqhxkgqYEryRAd7gqFqL5rdc` |
| GasFree service provider | Nile | `TKtWbdzEq5ss9vTS9kwRhBp5mXmBfBns3E` |
| Tether USDT (freeze list) | Mainnet | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` |

### Deployed Contracts (29 Sep 2026)

| Contract | Address | Deployment |
|---|---|---|
| AnsimRegistry | [`TUcz2dryzQLTTyTFooLwoFxP5cWugCq8xq`](https://nile.tronscan.org/#/contract/TUcz2dryzQLTTyTFooLwoFxP5cWugCq8xq) | [3a13f341…91f82](https://nile.tronscan.org/#/transaction/3a13f341aa5e788e419e207b5ef02dd5ea906fc6b82cdc1f4745a67734d91f82) |
| AnsimVault | [`TWWL6N7DyNzbJ9zZLXncVtcDdu5hDdmL8k`](https://nile.tronscan.org/#/contract/TWWL6N7DyNzbJ9zZLXncVtcDdu5hDdmL8k) | [9aa5af24…d6613](https://nile.tronscan.org/#/transaction/9aa5af2446a900f5cc491b2c23689a00fecf419b9aaadf61790a32ea82dd6613) |

### Accounts

| Role | Address | Holds |
|---|---|---|
| Vault owner (the team's TronLink) | `TULPNbKuhamDY1FuW3KfHiUzRVzcuFio83` | Signs limits and approvals; can freeze the vault |
| Payer | `TYXG72emQhVmcYYPXDbJfeSh5e53e5f8kn` | Signs GasFree permits; holds nothing |
| Payer's GasFree account | `TW6BntBhCJbEZAQy88wU3tJEwcPL6N8qwX` | Only what the vault released for the current batch |
| Notary and vault agent | `TVHXjWjM9MhMX9STBL16BprC1PSmoGXvNL` | Nile TRX for registry and vault calls |

### Funding the Vault

Send **Nile test USDT** (TRC-20 `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`) to the vault, `TWWL6N7DyNzbJ9zZLXncVtcDdu5hDdmL8k`, with a plain transfer from TronLink on Nile. There is no deposit function to call. The sending wallet needs a little Nile TRX for energy, from the [Nile faucet](https://nileex.io/join/getJoinPage). The console's vault card shows the new balance within seconds.

- **Only Nile USDT.** The vault can only release or withdraw that one token contract, so any other token sent there is stuck. It does not accept TRX.
- **Prefer the vault to the GasFree account.** Money in the vault leaves only for a batch the owner approved. The GasFree account is the payer key's hot wallet. USDT sent there can be moved into the vault with **Move it into the vault**.
- **Taking money out:** the owner calls `withdraw(to, amount)` from TronLink.

### On-Chain Evidence

A complete live batch from the public console on 30 September 2026. The owner signed the limits and the approval in TronLink; the agent drafted the batch.

| Step | Transaction |
|---|---|
| Payment limits (policy #7) recorded in AnsimRegistry | [172817d3…3accb4](https://nile.tronscan.org/#/transaction/172817d313c56a681fd4878ebfae1dd13649c55c754587d8e982c9946f3accb4) |
| AnsimVault checked the owner's approval and released 2.50 + 0.30 USDT | [7aa70e5c…64b25](https://nile.tronscan.org/#/transaction/7aa70e5c8316d50823f2e873f50aa0f925c00910afa7c1fcadfd103830464b25) |
| GasFree payment of 2.50 USDT to Dummy 2 in Hanoi | [f2fbcd70…68f05](https://nile.tronscan.org/#/transaction/f2fbcd7018e913960b09a9de1e008150137a02a6d9fd62627a9f4b365c768f05) |
| Batch closing hash sealed in AnsimRegistry | [d4ee79c3…335d1fc](https://nile.tronscan.org/#/transaction/d4ee79c39c67abafb5807c76b1551b8be76c47ed14ce4cceee308dfe7335d1fc) |

`verify.mjs` passes all 16 checks for that batch against the chain.

A six-payment live batch the same day, which a backend deploy interrupted after four payments had been sent. The server resumed it on restart, and each family was paid exactly once:

| Step | Transaction |
|---|---|
| AnsimVault released 14.50 + 6 × 0.30 USDT for policy #8 | [79a31f81…f02a05](https://nile.tronscan.org/#/transaction/79a31f8140a5c3953edbec1d9d6738826d37ad5835641c7aba311a2c5af02a05) |
| Payments 5 and 6, sent after the restart | [16495083…a0289f](https://nile.tronscan.org/#/transaction/164950830a5f696ef6117847088e68ff9370c7854e19bde5e537a84143a0289f), [7ca6507c…559b3a](https://nile.tronscan.org/#/transaction/7ca6507c894180700bcc2640f7ccc4f0278718576a8652ad6427fd4e2e559b3a) |
| Batch closing hash sealed in AnsimRegistry | [e00e2851…b6b1c2](https://nile.tronscan.org/#/transaction/e00e285194e5b53fffb745c61c683aaef43d1332235e151d919751ce11b6b1c2) |

`verify.mjs` passes all 36 checks for it. Earlier tests on Nile:

| Test | Transaction |
|---|---|
| 997.90 USDT moved from the GasFree account into the vault | [e0e3cf0a…ece43](https://nile.tronscan.org/#/transaction/e0e3cf0acfa2d8d41530601dc837d0d0d48f54938ccd60a815e95f7f4d4ece43) |
| Vault release for an approved two-payment batch | [77883b21…acd10](https://nile.tronscan.org/#/transaction/77883b217d9f03d809fc4d8bf5e0864ef6b5701c55825d3d3b6e22ce407acd10) |
| Owner froze the vault; the next batch was refused | [29fea4c8…ff35f8](https://nile.tronscan.org/#/transaction/29fea4c879f0a64959e8251367cf009ae11fdf34df5126dab7317e22e8ff35f8) |
| Vault handed to the owner's TronLink with `setOwner` | [6866a972…e28bdd](https://nile.tronscan.org/#/transaction/6866a9726a9e0b9033f897bfe68d6b0fa2bf7c4c2d43de253e3789839fe28bdd) |
| First real payment, 0.50 USDT plus 1.30 fee (activation) | [e30fe082…ed258](https://nile.tronscan.org/#/transaction/e30fe0822003ab98bffacaf0dc7c3e71e382ee95bcbe85d15a054aecf0fed258) |

## How It Works

### Phase 1: The operator keeps the contacts

Each family's wallet is a contact with a name, country, city and usual amount. Ansim refuses to save a wallet that is:

- invalid,
- already saved,
- a lookalike of an existing contact's wallet,
- on the reported list,
- or frozen by Tether.

Then it reads the wallet's public history on TRON mainnet and flags anything suspicious. A new contact can be paid only after a waiting period (3 hours by default; 3 minutes in the demo). Adding, removing or changing a contact is written to the log and sent to the owner on Telegram.

### Phase 2: The owner signs the payment limits

In TronLink, the owner signs a `SpendingPolicy`:

- payer,
- budget, fees included,
- cap per payment,
- cap per contact over 30 days,
- hash of the allowed contacts,
- deadline,
- nonce.

Ansim checks the signature, and the notary key records the policy's hash in AnsimRegistry. A new policy replaces the old one. **Stop all payments** stops it at once.

### Phase 3: A batch is drafted

There are two ways in:

- **A file.** The operator imports the day's CSV or Excel file. Korean headers such as 수취인 지갑주소 and 비고 are mapped automatically.
- **The payout agent.** The owner types an instruction, for example "pay everyone their usual monthly support, skip anyone new or risky". The model proposes payments to contacts only, with a reason for each. Code keeps only valid payments to real contacts.

### Phase 4: Code screens every row

The 12 checks below run on every row. Blocking flags can never be paid; holding flags wait for the operator. The AI explains the flagged rows in Korean and English, and never sees the clean ones.

### Phase 5: The owner approves the exact batch

The owner signs a `BatchApproval` in TronLink: batch, policy, a hash of the exact rows, the count and the total. Editing any row clears it. Pressing **Pay** runs every check again (the freeze list is live), then confirms the approval still matches the rows and the active policy.

### Phase 6: The vault releases the money

```
Ansim (notary key) → AnsimVault.release(batchId, policyId, rowsHash, count, total, ownerSignature)
  → recompute the TIP-712 digest, ecrecover the signer
  → signer must be the vault's owner; the approval must be unused; the vault must not be frozen
  → send total + count × 0.30 USDT to the payer's GasFree account, and nothing anywhere else
```

### Phase 7: GasFree pays each row

For each row, the payer signs one TIP-712 `PermitTransfer`, with its own fee cap and a deadline no later than the policy's. The policy gate runs before each signature. GasFree's controller moves the USDT and pays the network cost, so the family receives the full amount and never needs TRX. Each row goes waiting → processing → confirming → paid, live on the map. GasFree allows one pending transfer per account, so rows go one after another.

### Phase 8: Reconcile, prove, tell the family

When the last row settles, the batch's closing log hash is sealed in AnsimRegistry. Then:

- **The owner** gets a Telegram alert and an AI-written receipt.
- **The export** links every result to its source row, receipt, transaction and fee.
- **Each family** has a receipt page in Vietnamese, Tagalog or Nepali, with Korean and English. There they can confirm receipt, share their city if they want, and subscribe on Telegram.
- **Anyone** can run `verify.mjs` on the evidence file to rebuild the answer from the chain.

### Phase 9: Disputes

"My family didn't get the money." The dispute desk finds the payment by name, note, wallet or transaction hash. It shows the log events and what the chain says, and drafts a reply in Korean and English that cites the event numbers.

## The 12 Checks: Deep Dive

| Check | Flag | Effect | What it catches |
|---|---|---|---|
| Invalid address | `INVALID_ADDRESS` | Blocks | Typos and malformed wallets (checksum included) |
| Invalid amount | `INVALID_AMOUNT` | Blocks | Missing, zero or non-numeric amounts |
| Duplicate | `DUPLICATE` | Holds | Same sender, wallet, amount and note twice |
| New payee | `NEW_PAYEE` | Holds | A wallet that is not a contact |
| Lookalike wallet | `LOOKALIKE` | Holds | Same first and last four characters as a contact's wallet but different (address poisoning) |
| Unusual amount | `UNUSUAL_AMOUNT` | Holds | More than 3 times the contact's usual amount |
| Reported scam wallet | `REPORTED_WALLET` | Blocks | Wallets on the reported list |
| Frozen by Tether | `TETHER_FROZEN` | Blocks | Wallets on Tether's live mainnet freeze list |
| Many senders, one wallet | `MANY_SENDERS_ONE_WALLET` | Holds | Three or more senders paying one new wallet (a mule pattern) |
| New contact waiting | `NEW_CONTACT_WAIT` | Blocks | A contact still inside its waiting period |
| Travel Rule details needed | `TRAVEL_RULE_INFO` | Blocks | ₩1,000,000 or more without the sender's details |
| Risky wallet | `RISKY_WALLET` | Holds | A contact whose mainnet history shows a contract, frozen senders or 5+ senders in a week |

The address-poisoning demo is real. Setup runs a birthday search over consecutive keypairs until it finds two real wallets that share their first and last four characters.

## The Policy Gate: Deep Dive

[`refuseReason`](backend/src/policy.ts) runs before every signature. It checks, in this order:

| # | Check | Refusal |
|---|---|---|
| 1 | The owner has not pressed Stop | `STOPPED_BY_OWNER` |
| 2 | A signed policy is active | `NO_ACTIVE_POLICY` |
| 3 | The deadline has not passed | `DEADLINE_PASSED` |
| 4 | The payee is on the signed list | `PAYEE_NOT_ALLOWED` |
| 5 | The amount is within the cap per payment | `OVER_PER_PAYMENT_CAP` |
| 6 | The contact stays under its 30-day cap, counting all policies | `OVER_MONTHLY_PAYEE_CAP` |
| 7 | Paid, in flight and fees stay inside the budget | `OVER_BUDGET_WITH_FEES` |

The budget counts payments still in flight at their fee cap, so a slow confirmation can never let the agent overspend. Every refusal is written to the log with its reason, and costs no AI tokens.

## The Vault: Deep Dive

| Function | Who | What |
|---|---|---|
| `release(batchId, policyId, rowsHash, count, total, sig)` | Agent (notary key) | Recovers the approval's signer. The signer must be the owner, the approval unused and the vault not frozen. Sends the approved total plus the fee per payment to the payer's GasFree account |
| `setFrozen(bool)` | Owner | Emergency brake: no release while frozen |
| `withdraw(to, amount)` | Owner | The owner can always take the money out |
| `setOwner(address)` | Owner | Hands the vault to another owner |
| `approvalDigest(…)`, `approver(…)`, `released(digest)` | Anyone | Read the digest, the signer and what was released |

What a compromised Ansim backend could do:

| With the vault | Without it |
|---|---|
| At most one batch the owner signed, once, and only to the payer's GasFree account | Everything in the hot wallet |

## Payments Cannot Happen Twice

Each row is bound to one nonce and one signed permit, saved before any network call. If a response is lost:

1. **Ask first.** With a request ID, ask GasFree for the transfer's status.
2. **Resend the same permit** while it is inside its deadline. Its nonce works only once, so GasFree either returns the existing transfer or rejects the copy.
3. **Look on chain.** If the account's nonce moved past the permit's, the permit was used: find the transfer on chain.
4. **Sign again only when it's safe.** A new permit is signed only if the old one's deadline passed with its nonce unused.

The demo drops the response for one line on purpose (`SIMULATE_LOST_RESPONSE_LINE`) and shows the recovery.

**A restart mid-batch** (a deploy or a crash) leaves the batch marked RUNNING with nothing paying it. On startup the server resumes every such batch. It settles each in-flight row through the four steps above first, then pays the rest through the policy gate. The journal records `BATCH_RESUMED`.

## Evidence: Deep Dive

Every action is an event in an append-only log: `hash = sha256(previous hash + event)`. Editing any past event breaks every hash after it. The export (`ansim-evidence-2`) contains the policies with their signatures, the rows, the owner's approval, the rules and every event.

[`verify.mjs`](backend/scripts/verify.mjs) re-implements every rule instead of importing Ansim's code. It uses only that file and public TRON data, and checks:

- the hash chain;
- each policy's signature, payee hash, log entry and registry record;
- the batch seal in the registry;
- that the owner signed the approval before the first payment, and that the paid rows are exactly the approved ones;
- that the vault's on-chain release matches, stayed within the approved total plus fees, and happened first;
- for every paid row: the signed record, the chain transfer, the policy limits including the 30-day cap and the fee cap, the waiting period and the Travel Rule details;
- that every refusal was required.

**Verify a tampered copy** raises one paid amount by 1 USDT, and the check fails.

## Multi Layer Protection

| Layer | Where | When |
|---|---|---|
| 1. Contact checks | Backend | When a contact is added: invalid, duplicate, lookalike, reported, frozen, wallet history |
| 2. Row screening | Backend | At import, on every edit, and again right before paying |
| 3. Policy gate | Signer | Before every single signature |
| 4. Owner approval | TIP-712, TronLink | Before a batch can start |
| 5. AnsimVault | Contract on Nile | Before any money leaves the vault |
| 6. GasFree permit | GasFree controller on Nile | Each permit's own fee cap and deadline |
| 7. Independent verify | Anyone, afterwards | From the records and the chain alone |

### Defense Matrix

| Attack | Stopped by |
|---|---|
| Paying a reported or Tether-frozen wallet | Contact check · screening blocks (live freeze list, rechecked before paying) |
| Address poisoning (lookalike wallet) | Contact check refuses to save it · screening holds it |
| Money mule collecting from many senders | Screening holds it · wallet history marks the contact risky |
| Insider adds their own wallet and pays it the same day | Waiting period · owner's Telegram alert · owner approval |
| Agent pays more than the budget, fees included | Policy gate · vault releases only the approved total |
| Agent pays a wallet not on the signed list | Policy gate · verify |
| Payment after the deadline or after Stop | Policy gate · permit deadline capped at the policy's |
| Operator edits rows after approval | Approval cleared · vault checks the rows hash |
| Hacked backend drains the funds | Vault: needs the owner's signature, once per approval |
| Leaked payer key | The GasFree account holds only the current batch's release |
| Lost response causes a second payment | Nonce-bound permits and recovery |
| Records edited afterwards | Hash chain · registry seal · verify |

## What Ansim Does NOT Protect Against

| Scenario | Ansim's response |
|---|---|
| The owner is tricked into signing limits for a scammer | ⚠️ The wallet checks and waiting period still apply, but a signature is a signature |
| A brand-new scam wallet with a clean history | ⚠️ Waiting period and holds slow it down; nothing can know it is a scam yet |
| The owner's TronLink key is stolen | ❌ The thief is the owner. Keep the owner's wallet safe |
| Fraud while collecting the won in Korea | ❌ Out of scope: the operator's KYC and banking controls |
| GasFree or TRON outages | ⚠️ Payments pause and never double; press Recover later |

## What the AI Does, and What Stays in Code

| The model | Plain code |
|---|---|
| Maps an unfamiliar spreadsheet layout | Every check, and which flags block or hold |
| Explains flagged rows in Korean and English | The policy gate: budget, caps, payees, deadline, stop |
| Drafts a batch from the owner's instruction | Which proposed rows are valid payments to real contacts |
| Explains a new contact's wallet-risk flags | The wallet-history lookup and the risk flags |
| Writes the owner's receipt | Signing, submitting, polling and recovery |
| Answers auditor questions, citing event numbers | The hash-chained log, registry records and verify |
| Drafts replies to customer disputes | The vault, approvals and receipts |

A wrong model answer cannot move money. The model never holds a key. Every call is logged by flow on the **Tokens & energy** page. See [docs/FURIOSAAI-BRICKSUM.md](docs/FURIOSAAI-BRICKSUM.md) for the Kiln integration, token budgets and the energy estimate.

## Contracts

| Contract | Purpose |
|---|---|
| [`AnsimVault.sol`](contracts/src/AnsimVault.sol) | Holds the operator's USDT and releases only owner-approved batches |
| [`AnsimRegistry.sol`](contracts/src/AnsimRegistry.sol) | Records policy grants, stops and batch seals. It never holds money |

Details, functions, events and the TIP-712 digest are in [contracts/README.md](contracts/README.md).

## Project Structure

```
Ansim/
├── frontend/                     Next.js 16 console on Vercel          → frontend/README.md
│   ├── app/(console)/            payout desk, batch pages, disputes, tokens & energy
│   ├── app/r/[token]/            the family's receipt page
│   ├── app/flow-map.tsx          live payout map
│   ├── app/wallet.tsx            Connect TronLink
│   └── proxy.ts                  site password and backend key
├── backend/                      Hono API on Railway                   → backend/README.md
│   ├── src/                      checks, policy gate, orchestrator, vault, AI, Telegram, log
│   ├── scripts/                  setup, verify, fake services, vault deploy
│   ├── data/                     contacts, reported list, demo payout file
│   └── Dockerfile
├── contracts/                    Solidity for the TRON VM               → contracts/README.md
│   ├── src/                      AnsimVault.sol, AnsimRegistry.sol
│   └── deployments/              Nile addresses and ABIs
├── docs/
│   ├── TRON.md                   TRON Challenge C write-up
│   └── FURIOSAAI-BRICKSUM.md     Agent Finance Challenge B write-up
├── LICENSE
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 22 or newer
- [TronLink](https://www.tronlink.org/) on the Nile testnet, for the owner
- A GasFree API key and secret for Nile from [developer.gasfree.io](https://developer.gasfree.io/)
- Nile TRX from the [Nile faucet](https://nileex.io/join/getJoinPage) for the notary address
- Optional: a Kiln key from the FuriosaAI developer kit, or any OpenAI-compatible key such as OpenRouter
- Optional: a Telegram bot from @BotFather

### 1. Clone and install

```bash
git clone https://github.com/minrawsjar/Ansim.git
cd Ansim
npm install
```

### 2. Wallets and demo data

```bash
npm run setup
```

This creates the payer, owner and notary keys in `backend/.env.local`, and the demo contacts (Dummy 1 to Dummy 6, real Nile wallets whose keys go to the git-ignored `backend/data/demo-wallets.local.json`). It also writes the reported list and the demo payout file.

### 3. Environment

Fill in `backend/.env.local` (see [backend/.env.example](backend/.env.example) and [backend/README.md](backend/README.md)): `GASFREE_API_KEY`, `GASFREE_API_SECRET`, and optionally `KILN_BASE_URL`, `KILN_API_KEY`, `KILN_MODEL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

### 4. Contracts

```bash
npm run deploy:contracts                 # AnsimRegistry
VAULT_OWNER=<your TronLink address> npm run deploy:vault
```

Then send Nile test USDT to the vault ([Funding the Vault](#funding-the-vault)), or to the payer's GasFree account shown in the pre-check and press **Move it into the vault**.

### 5. Run

```bash
npm run dev          # backend on :4000, console on http://localhost:3000
```

### 6. Check

```bash
npm run check                                   # unit tests: policy gate, checks, approvals, CSV, wallet risk
npm run verify -- path/to/ansim-evidence.json   # independent audit of an exported batch
npm run reset                                   # clear the local database
```

## Demo

Open https://ansim-ecru.vercel.app, press **Connect TronLink** and switch to Nile.

1. **Contacts:** six real Nile wallets in Hanoi, Ho Chi Minh City, Cebu, Davao, Pokhara and Kathmandu. Each shows its mainnet wallet check.
2. **Payment limits:** tick contacts, press **Change limits** and sign in TronLink.
3. **Payout agent:** pick an example prompt, then **Draft a batch**. Or import [`backend/data/demo/ansim-demo-payouts.xlsx`](backend/data/demo/ansim-demo-payouts.xlsx), which has 13 rows: 4 clean, 1 unusual amount, and 8 that must not be paid (a duplicate, an address-poisoning lookalike, a typo, three rows from mule senders, a Tether-frozen wallet and a reported wallet).
4. **Approve in TronLink, then Pay:** the vault releases the batch on chain, and the map shows each payment.
5. **Prove it:** export the evidence, run verify, then verify a tampered copy.
6. **The family's side:** open a row's **Family receipt**, press **I received it**, and share a city.

### Live Demo: The Audience Becomes the Families

Open **Live demo** (`/stage`) on the big screen. People scan the QR code and join with **their own TRON wallet**: they paste an address or use TronLink. People without a wallet can let the phone make one; its key stays on the phone. They pick a name and a city in Vietnam, the Philippines or Nepal, and appear on the map.

Checks run the moment they join:
- **Turned away at once:** reported, Tether-frozen, lookalike or invalid wallets.
- **Checked in the background:** their own wallet's public record on mainnet, with the AI's plain-words note, shown to both them and the operator before **Accept**.

Ansim pays the **GasFree account** that GasFree derives from their wallet, and shows it to them. Only their wallet's key can move money out of it, and they never need TRX.

1. **Accept** them. Each wallet goes through the same checks as any new contact.
2. **Add them to the signed limits.** Same budget and caps, signed again in TronLink.
3. **Ask the agent** to send everyone who joined a few USDT.
4. **Approve and pay.** The owner signs the exact rows and the vault releases them.
5. **Watch the phones.** Each one chimes, buzzes and shows the amount in local currency, in its language, with the TronScan proof. Then press **Send it back**. The wallet signs a GasFree permit itself, in TronLink or on the phone, and a wallet that has never held TRX sends USDT back into the vault.

Payments go to each phone's GasFree account, so it can spend with GasFree. The first transfer out costs 1.00 USDT once to open the account, plus the 0.30 fee, taken from the USDT. So pay at least 2 USDT. GasFree takes one transfer at a time, about a minute each, so it suits 3 to 5 people.

Tested on Nile: a wallet made by the phone page, with 0 TRX, received 3.00 USDT in its GasFree account. It then sent 1.70 back to the vault with a phone-signed permit ([3a8a60d1…f47015](https://nile.tronscan.org/#/transaction/3a8a60d1b9593c07d050af78d6d6ecc867cc325177fb6ed7ef28229ae9f47015)); GasFree took 1.30 for the fee and the one-time activation.

### Boundary runs

| Run | Condition | Expected outcome |
|---|---|---|
| 1 | "Send 20 USDT to every contact" with a 15 USDT cap per payment | Every row refused: `OVER_PER_PAYMENT_CAP` |
| 2 | Budget smaller than the batch plus fees | Rows that do not fit refused: `OVER_BUDGET_WITH_FEES` |
| 3 | A contact unticked from the signed limits | Refused: `PAYEE_NOT_ALLOWED` (recorded in the first real test) |
| 4 | Owner presses Stop mid-batch | Remaining rows refused: `STOPPED_BY_OWNER` |
| 5 | Owner freezes the vault | Release refused on chain (recorded above) |

Every refusal appears in the batch's execution journal, in the evidence file and in Telegram.

## Partners

| Track | Write-up |
|---|---|
| TRON Challenge C: GasFree batch payments and reconciliation | [docs/TRON.md](docs/TRON.md) |
| FuriosaAI × Bricksum Agent Finance, Challenge B: controls and records for an AI agent that spends | [docs/FURIOSAAI-BRICKSUM.md](docs/FURIOSAAI-BRICKSUM.md) |

## Tech Stack

| Layer | Technology |
|---|---|
| Console | Next.js 16, React 19, Tailwind CSS 4, TronLink |
| Backend | Node.js 22, Hono, better-sqlite3, TronWeb 6, SheetJS, OpenAI SDK |
| Contracts | Solidity 0.8.26 for the TRON VM (EVM target istanbul) |
| Payments | GasFree on TRON Nile, TIP-712 permits |
| AI | FuriosaAI Kiln or any OpenAI-compatible API, gpt-oss |
| Alerts | Telegram Bot API with a webhook |
| Hosting | Vercel (console), Railway with a volume (backend) |

## Key Concepts

- **GasFree:** a TRON service that pays a USDT transfer's network cost and takes a flat USDT fee instead, so neither the sender's signing key nor the family needs TRX.
- **TIP-712:** TRON's version of EIP-712 typed-data signing. Ansim uses it three times: the owner's policy, the owner's batch approval, and each GasFree permit.
- **지연이체 (delayed transfer):** a service Korean banks offer against voice phishing that holds a transfer for at least 3 hours. Ansim's waiting period for new contacts works the same way.
- **Travel Rule:** Korea requires originator and beneficiary details for virtual-asset transfers of ₩1,000,000 or more. Ansim holds such rows until the details are added, keeping them off chain.
- **Address poisoning:** scammers send tiny amounts from a wallet that shares the first and last characters of a real contact's wallet, hoping it gets copied from the history.

## Honest Notes

- All code in this repository was written during the hackathon, on 29 and 30 September 2026. The console started from `create-next-app`.
- **AI provider.** The Kiln API key from the FuriosaAI developer kit did not arrive during the event, so the live AI runs on OpenRouter with `openai/gpt-oss-20b`. It uses the same OpenAI-compatible client, and switching to Kiln with `gpt-oss-120b` is three settings. The energy estimate describes Kiln's RNGD hardware, and the Tokens & energy page says when it does not apply.
- **Vault owner.** The live vault's owner is the team's TronLink account, handed over with `setOwner`. Approvals signed with the demo owner key no longer unlock it.
- **Demo data.** The reported-wallet list is a stand-in for wallets reported to police and exchanges. The demo contacts are real Nile wallets with no mainnet history.
- **Translations and rates.** The receipt and Telegram translations have not been checked by native speakers. The KRW rate for the Travel Rule threshold is a setting (`KRW_PER_USDT`), not a live quote.
- **Test-only services.** `fake-services.mjs` is only for testing without keys. Its transaction hashes are made up, and `verify.mjs` correctly fails them.
- **Downtime.** Railway stops the backend for a minute or two on each deploy, because its volume cannot be attached twice. The console retries by itself.
- **Legality.** Unlicensed crypto remittance is illegal in Korea. Ansim is built for licensed operators and adds the controls regulators ask for.

## Sources

- [Seoulz: voice-phishing losses by agency, 2025](https://www.seoulz.com/korea-voice-phishing-2026/)
- [Financial News: crypto voice-phishing refunds from 1 October 2026](https://www.fnnews.com/news/202607151657505105)
- [Spark: Korea to Vietnam remittance costs](https://www.spark.money/research/crypto-remittance-corridor-economics)
- [FuriosaAI: gpt-oss-120b on two RNGD cards](https://furiosa.ai/blog/serving-gpt-oss-120b-at-5-8-ms-tpot-with-two-rngd-cards-compiler-optimizations-in-practice)
- [GasFree developer documentation](https://docs.gasfree.io/)
- [TRON developer documentation](https://developers.tron.network/)
- [TronLink: switching networks from a dApp](https://docs.tronlink.org/plugin-wallet/active-requests/)

## License

MIT. See [LICENSE](LICENSE).

## Built with

TRON • GasFree • TronLink • FuriosaAI Kiln • gpt-oss • Next.js • Hono • Telegram
