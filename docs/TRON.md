# Ansim × TRON

### TRON Challenge C: a GasFree stablecoin batch payment and reconciliation assistant

Ansim pays a licensed remittance operator's daily USDT batch on TRON through GasFree. Families receive the full amount and never need TRX. Every row is checked before it is paid, and every result is reconciled against the chain afterwards. The money itself sits in an on-chain vault that releases one owner-approved batch at a time.

[Why TRON](#why-tron) • [TRON Pieces Used](#tron-pieces-used) • [Money Flow](#money-flow) • [Payment Lifecycle](#payment-lifecycle) • [Challenge Criteria](#challenge-c-criteria) • [On Nile](#on-nile) • [Lessons](#lessons-from-building-on-tron) • [Mainnet](#going-to-mainnet)

## Why TRON

- **Families already use it.** USDT on TRON is what many families in Vietnam, the Philippines and Nepal already hold and cash out.
- **It's cheap.** A transfer costs cents, against 5.15% on the Korea to Vietnam banking route.
- **GasFree removes TRX.** Normally the sender's wallet needs TRX before it can move USDT. With GasFree it doesn't, so the operator's signing key and the families' wallets never need to hold TRX.

## TRON Pieces Used

| Piece | How Ansim uses it | Code |
|---|---|---|
| **GasFree API** | Token and provider config, the payer's GasFree account (address, nonce, activation, `allowSubmit`), submitting permits and polling their status | [`backend/src/gasfree.ts`](../backend/src/gasfree.ts) |
| **GasFree `PermitTransfer`** | One TIP-712 permit per row, with its own `maxFee` and a `deadline` capped at the policy's; GasFree's controller enforces both on chain | [`signPermit`](../backend/src/gasfree.ts), [`payRow`](../backend/src/orchestrator.ts) |
| **TIP-712** | Three typed-data signatures: the owner's `SpendingPolicy`, the owner's `BatchApproval`, and the payer's `PermitTransfer` | [`backend/src/policy.ts`](../backend/src/policy.ts) |
| **TRON VM** | `AnsimVault` checks the owner's approval with `ecrecover` and releases the batch; `AnsimRegistry` records policies and batch seals | [`contracts/`](../contracts) |
| **TronLink** | Connect, switch to Nile (`wallet_switchEthereumChain` with `0xcd8690dc`), sign the limits and approvals, and send the owner's `setFrozen` | [`frontend/app/lib.ts`](../frontend/app/lib.ts), [`frontend/app/wallet.tsx`](../frontend/app/wallet.tsx) |
| **TronGrid, Nile** | Balances, contract calls, fast confirmation from the full node, and TRC-20 history for payment recovery | [`backend/src/tron.ts`](../backend/src/tron.ts) |
| **TronGrid, mainnet (read only)** | Tether's `isBlackListed` freeze list, and wallet history for the contact risk check | [`isTetherFrozen`, `walletFacts`](../backend/src/tron.ts) |

### GasFree endpoints

| Endpoint | Used for |
|---|---|
| `GET /api/v1/config/token/all` | USDT address, transfer fee (0.30), activation fee (1.00) |
| `GET /api/v1/config/provider/all` | Service provider address and deadline limits |
| `GET /api/v1/address/{payer}` | The payer's GasFree account, nonce, activation and whether it accepts a transfer now |
| `POST /api/v1/gasfree/submit` | Submit a signed `PermitTransfer` |
| `GET /api/v1/gasfree/{traceId}` | WAITING → INPROGRESS → CONFIRMING → SUCCEED, or FAILED |

Requests are signed with HMAC-SHA256 over `method + "/nile" + path + timestamp`. GasFree's named rejections are handled one by one. `NonceNotMatchException`, `DeadlineExceededException` and `TooManyPendingTransferException` mean "sign a fresh permit". `InsufficientBalanceException` pauses the batch. Anything else fails the row with its reason.

### The permit

```
domain:  GasFreeController · V1.0.0 · chainId 3448148188 · verifyingContract THQGuFzL87ZqhxkgqYEryRAd7gqFqL5rdc
message: token, serviceProvider, user, receiver, value, maxFee, deadline, version, nonce
```

## Money Flow

```
 AnsimVault (holds the operator's USDT)
      │  release: owner's TIP-712 approval checked on chain,
      │  exactly approved total + 0.30 per payment
      ▼
 Payer's GasFree account  TW6Bnt…8qwX
      │  one PermitTransfer per row, signed by the payer key, submitted to GasFree
      ├───────────▶ family wallet       full amount, no TRX needed
      └───────────▶ GasFree provider    0.30 USDT fee (plus 1.00 once to activate)
```

Idle USDT in the GasFree account can be moved back into the vault with one GasFree transfer, and its destination is fixed to the vault. So the hot account normally holds only the batch being paid.

## Payment Lifecycle

```
READY ──sign──▶ SIGNED ──submit──▶ WAITING ─▶ INPROGRESS ─▶ CONFIRMING ─▶ SUCCEED
  │                │                                                       (paid)
  │ policy gate    └── lost response ─▶ UNKNOWN ─▶ recovery ─▶ SUCCEED | READY (safe to re-sign)
  └──▶ REFUSED (reason logged)            GasFree rejection ─▶ FAILED (reason logged)
```

Recovery never pays twice:

1. **Ask GasFree** for the transfer's status.
2. **Resend the same signed permit** while it's inside its deadline. Its nonce can only be used once.
3. **Search the chain** if the account's nonce moved.
4. **Sign a new permit** only once the old one's deadline has passed with its nonce unused.

If the server restarts mid-batch, it resumes the batch on startup. It runs those steps for every in-flight row, then pays the rest.

## Challenge C Criteria

| Criterion | What Ansim does | Where to see it |
|---|---|---|
| **Import & Validation** | CSV or Excel import with Korean or English headers (mapped by rules, a cache, or the AI). 12 checks per row with inline fixes. Blocking flags can never be paid, and every check runs again right before paying | Batch page: rows table, flags, **Run checks again** |
| **Balance & Fee Pre-Check** | The GasFree account's address, balance and nonce, whether it's activated and accepting transfers, the token, the fee per transfer, the activation fee, the batch total with fees, the remaining budget and the vault balance | Batch page: **Pre-check balance and fees** |
| **Authorization & Orchestration** | The owner's signed limits, then the owner's signed approval of the exact rows. The vault checks that approval on chain and releases the money; then one permit per row, submitted in order under GasFree's one-pending-transfer limit | Payment limits, the owner-approval card, the vault card, the execution journal |
| **Per-Transaction Status & Recovery** | Live state per row, with Ansim's request ID, GasFree's trace ID, the transaction hash and fee. Lost responses are recovered without a second payment | Batch page: status column, the live map, **Recover unknown payments** |
| **Reconciliation & Export** | A CSV with each row's source line, note, decision, status, reason, payment time, fee, transaction hash, TronScan link, request and trace IDs, flags, family receipt link and family confirmation. Plus an evidence JSON that `verify.mjs` checks against the chain | **Export CSV**, **Export evidence**, **Run verify** |

### Export columns

`line, sender, recipient, wallet, amount_usdt, note, decision, status, reason, paid_at_utc, fee_usdt, txn_hash, tronscan_url, request_id, trace_id, flags, receipt_link, family_confirmed_utc, family_city`

Text from uploaded files that starts with `=`, `+`, `-` or `@` gets a leading apostrophe, so it can't run as a spreadsheet formula.

## On Nile

| What | Address or transaction |
|---|---|
| AnsimVault | [`TWWL6N7DyNzbJ9zZLXncVtcDdu5hDdmL8k`](https://nile.tronscan.org/#/contract/TWWL6N7DyNzbJ9zZLXncVtcDdu5hDdmL8k) |
| AnsimRegistry | [`TUcz2dryzQLTTyTFooLwoFxP5cWugCq8xq`](https://nile.tronscan.org/#/contract/TUcz2dryzQLTTyTFooLwoFxP5cWugCq8xq) |
| Payer's GasFree account | [`TW6BntBhCJbEZAQy88wU3tJEwcPL6N8qwX`](https://nile.tronscan.org/#/address/TW6BntBhCJbEZAQy88wU3tJEwcPL6N8qwX) |
| Live batch: vault release | [7aa70e5c…64b25](https://nile.tronscan.org/#/transaction/7aa70e5c8316d50823f2e873f50aa0f925c00910afa7c1fcadfd103830464b25) |
| Live batch: GasFree payment to Dummy 2 in Hanoi | [f2fbcd70…68f05](https://nile.tronscan.org/#/transaction/f2fbcd7018e913960b09a9de1e008150137a02a6d9fd62627a9f4b365c768f05) |
| Live batch: batch seal | [d4ee79c3…335d1fc](https://nile.tronscan.org/#/transaction/d4ee79c39c67abafb5807c76b1551b8be76c47ed14ce4cceee308dfe7335d1fc) |
| Six-payment batch resumed after a restart: vault release | [79a31f81…f02a05](https://nile.tronscan.org/#/transaction/79a31f8140a5c3953edbec1d9d6738826d37ad5835641c7aba311a2c5af02a05) |
| Six-payment batch: seal | [e00e2851…b6b1c2](https://nile.tronscan.org/#/transaction/e00e285194e5b53fffb745c61c683aaef43d1332235e151d919751ce11b6b1c2) |
| Idle USDT moved into the vault through GasFree | [e0e3cf0a…ece43](https://nile.tronscan.org/#/transaction/e0e3cf0acfa2d8d41530601dc837d0d0d48f54938ccd60a815e95f7f4d4ece43) |

The full list is in the [main README](../README.md#on-chain-evidence).

## Lessons From Building on TRON

- **TronLink signs typed data only for its current chain.** A wallet on mainnet refuses Nile typed data with a chain ID error. Ansim reads the chain from the wallet's own genesis block (its last four bytes are the chain ID), asks TronLink to switch with `wallet_switchEthereumChain`, and explains the error if it can't.
- **The solidified node is about a minute behind.** `getTransactionInfo` answers only after solidification, about 19 blocks. Ansim confirms its own transactions on the full node, which answers within a block.
- **Don't trust USDT's `transfer` return value.** TRON's USDT doesn't return `true` reliably, so AnsimVault checks the receiver's balance change instead.
- **GasFree allows one pending transfer per account.** Rows are paid one after another, and while one is in flight the account reports that it isn't accepting a transfer. The pre-check reads that as a wait, not a problem.
- **CONFIRMING comes before SUCCEED.** The transfer succeeds on chain within seconds, but GasFree reports SUCCEED only after solidification. Ansim keeps polling instead of guessing.
- **Nile USDT is not Tether's USDT.** The freeze list and wallet history are read from mainnet, where real families' wallets have their history.
- **Public TronGrid rate-limits shared servers.** Mainnet reads back off and retry on HTTP 429, and a `TRONGRID_API_KEY` avoids the limit.

## Going to Mainnet

| Change | How |
|---|---|
| GasFree | `GASFREE_BASE` to GasFree's mainnet endpoint, with production keys |
| Token | `USDT_TOKEN=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` |
| Chain | `TRON_FULLHOST=https://api.trongrid.io`; the TIP-712 domains use chain ID 728126428 |
| Contracts | Deploy AnsimRegistry and AnsimVault on mainnet, with the operator's owner wallet |
| Operator | A licensed remittance operator. Unlicensed crypto remittance is illegal in Korea |
