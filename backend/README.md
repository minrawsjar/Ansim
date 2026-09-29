# Ansim backend

The payout agent and its controls. It's a Node server that holds the payer key and does the following:

- **Screening:** checks every row.
- **Policy:** enforces the owner's signed limits and asks the vault for the approved money.
- **Payment:** pays through GasFree and recovers lost responses without paying twice.
- **Records:** keeps a hash-chained log and seals it on chain.
- **Explanations:** calls the model only to draft and explain.

[Modules](#modules) • [API](#api) • [Environment](#environment) • [Database](#database) • [Events](#events) • [Scripts](#scripts) • [Deploy](#deploy)

```
Hono (/api) ── desk.ts ──┬── screen.ts ── the 12 checks, wallet risk (TronGrid mainnet)
                         ├── policy.ts ── TIP-712 types, refuseReason, rowsHash
                         ├── orchestrator.ts ── payRow: gate → permit → GasFree → poll → recover
                         ├── tron.ts ── vault, registry, confirm, USDT proofs
                         ├── agent.ts ── 7 model flows, token log
                         └── log.ts ── hash-chained events → db.ts (SQLite)
```

## Modules

| File | What it does |
|---|---|
| [`server.ts`](src/server.ts) | HTTP routes under `/api`, the `x-ansim-key` check, evidence export, Telegram webhook registration at startup |
| [`desk.ts`](src/desk.ts) | Everything a route calls: contacts, limits, import, checks, approval, the vault, running a batch, receipts, disputes, the agent's plan, CSV export, status |
| [`orchestrator.ts`](src/orchestrator.ts) | Pays a batch row by row. The policy gate before every signature, GasFree submit and polling, named GasFree rejections, lost-response recovery, the balance and fee pre-check |
| [`policy.ts`](src/policy.ts) | `SpendingPolicy` (v1 and v2) and `BatchApproval` typed data, `rowsHash`, `payeesHash`, and `refuseReason`, the gate's single decision function |
| [`screen.ts`](src/screen.ts) | The 12 row checks, the new-contact checks (`contactProblem`) and wallet risk from mainnet history (`walletRisk`) |
| [`gasfree.ts`](src/gasfree.ts) | The GasFree client (HMAC-signed), its config, and `signPermit` for the `PermitTransfer` |
| [`tron.ts`](src/tron.ts) | TronWeb on Nile. Vault state, `vaultRelease`, registry records, `confirm()` on the full node, Tether's freeze list and `walletFacts` from mainnet, USDT transfer proofs for disputes |
| [`agent.ts`](src/agent.ts) | `ask()`: one JSON-only model call per flow through the OpenAI SDK, with `reasoning_effort: low`, a token cap, and a row in `tokens` |
| [`importer.ts`](src/importer.ts) | CSV and Excel parsing, Korean and English header rules, header signatures for the column-map cache, amount parsing |
| [`log.ts`](src/log.ts) | Appends events whose hash covers the previous one, and checks the chain |
| [`alerts.ts`](src/alerts.ts) | Telegram messages to the owner chats, and family notices when their payment lands |
| [`telegram.ts`](src/telegram.ts) | Webhook updates: `o_<code>` links an owner chat, `r_<token>` links a family's receipt, `/stop` unsubscribes |
| [`db.ts`](src/db.ts) | SQLite schema and column migrations |
| [`env.ts`](src/env.ts) | Loads `.env.local` |
| [`core.test.ts`](src/core.test.ts) | 11 tests: the policy gate, the 30-day cap, payee and row hashes, screening, new contacts, wallet risk, Korean headers, the hash chain, CSV formula cells |

## API

Everything is under `/api`. With `BACKEND_KEY` set, every request except `/health` needs it in `x-ansim-key`, and the frontend's proxy adds it.

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Liveness, open |
| GET | `/status` | Payer, GasFree account, vault, policy, owner, AI provider, Telegram |
| GET | `/policy` | The active policy and what it has committed |
| POST | `/policy/draft` | Typed data for the owner to sign in TronLink |
| POST | `/policy/activate` | Checks the owner's signature and activates it; the registry record follows in the background |
| POST | `/policy/stop` | Stops all payments; recorded on chain |
| POST | `/payees` | Adds a contact after the checks and the wallet-risk lookup |
| PATCH | `/payees/:address` | Sets a contact's city, for the map |
| DELETE | `/payees/:address` | Removes a contact |
| POST | `/payees/:address/check` | Runs the wallet-risk check again |
| GET | `/batches` | All batches |
| POST | `/batches` | Imports a CSV or Excel file |
| GET | `/batches/:id` | A batch with its rows, events and approval |
| PATCH | `/rows/:id` | Fixes a row inline, or adds its Travel Rule details; clears an approval it no longer matches |
| POST | `/batches/:id/review` | The model explains flagged rows |
| POST | `/batches/:id/precheck` | Balance and fee pre-check |
| POST | `/batches/:id/recheck` | Runs every check again |
| POST | `/batches/:id/approval-draft` | `BatchApproval` typed data for the owner |
| POST | `/batches/:id/approve` | Stores the owner's approval after checking the signer |
| POST | `/batches/:id/run` | Vault release, then pays the batch |
| POST | `/batches/:id/recover` | Resolves `UNKNOWN` rows |
| POST | `/batches/:id/receipt` | The owner's receipt |
| POST | `/batches/:id/ask` | Auditor question, answered from the batch's events |
| POST | `/batches/:id/verify` | Exports evidence (optionally tampered) and runs `verify.mjs` on it |
| GET | `/batches/:id/export` | CSV (`?format=csv`) or evidence JSON |
| GET | `/receipts/:token` | A family's receipt |
| POST | `/receipts/:token/confirm` | The family's "I received it", with an optional city |
| GET | `/disputes?q=` | Finds payments by wallet, name, transaction or amount |
| POST | `/disputes/ask` | Checks the chain and drafts a reply |
| GET | `/chain/:txid` | The USDT transfer a transaction made, from the chain |
| GET | `/vault` | Balance, owner, frozen flag, whether the owner is the demo key |
| POST | `/vault/freeze` | Records the owner's `setFrozen` transaction after checking it |
| POST | `/vault/return` | Moves idle USDT from the GasFree account into the vault |
| GET | `/payments/recent` | Recent payments for the map |
| POST | `/agent/plan` | Drafts a batch from an instruction |
| GET | `/metrics` | Tokens, latency and energy by flow |
| POST | `/telegram/webhook` | Telegram updates (secret header checked) |
| POST | `/telegram/link` | A one-time code for linking an owner chat |
| GET | `/telegram` | Bot name and number of owner chats |
| POST | `/alerts/test` | Sends a test alert |

## Environment

Copy [`.env.example`](.env.example) to `.env.local`, or run `npm run setup`, which creates fresh Nile wallets.

| Variable | Required | What it is |
|---|---|---|
| `PAYER_PRIVATE_KEY` | yes | Signs GasFree permits; its GasFree account holds the batch being paid |
| `NOTARY_PRIVATE_KEY` | yes | Deploys the contracts, writes registry records, and is the vault's agent; needs Nile TRX |
| `OWNER_PRIVATE_KEY` | no | Signs as the owner when TronLink isn't used |
| `GASFREE_BASE`, `GASFREE_API_KEY`, `GASFREE_API_SECRET` | yes | GasFree Nile API |
| `TRON_FULLHOST` | no | Default `https://nile.trongrid.io` |
| `TRONGRID_API_KEY` | no | Avoids rate limits on mainnet reads |
| `KILN_BASE_URL`, `KILN_API_KEY`, `KILN_MODEL` | no | Any OpenAI-compatible API. Without them, the AI features say they're off and everything else works |
| `CONTACT_WAIT_HOURS` | no | New-contact waiting period, default 3 (the live demo uses 0.05) |
| `TRAVEL_RULE_KRW`, `KRW_PER_USDT` | no | Travel Rule threshold and rate, default ₩1,000,000 at 1,400 |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | no | Alerts |
| `PUBLIC_API_URL` | no | Registers the Telegram webhook at startup |
| `PUBLIC_SITE_URL` | no | Makes receipt links absolute in Telegram and the CSV |
| `SIMULATE_LOST_RESPONSE_LINE` | no | Drops GasFree's response once for that line, to show recovery |
| `BACKEND_KEY` | public deploys | Required header on every request |
| `ANSIM_DB` | no | SQLite path, default `data/ansim.db` |

## Database

SQLite through better-sqlite3, in WAL mode.

| Table | Holds |
|---|---|
| `policies` | Signed limits: payer, owner, budget, caps, payees, deadline, signature, stop, registry record |
| `batches` | Imported or planned batches, the owner's approval, the vault release, the seal |
| `rows` | Payout rows: flags, decision, status, request and trace IDs, permit, tx hash, fee, Travel Rule details, receipt token, family confirmation |
| `events` | The hash-chained log |
| `tokens` | One row per model call: flow, tokens, latency, effort |
| `column_maps` | Cached column mappings by header signature |
| `payees` | Contacts with their usual amount, wallet risk and city |
| `telegram_chats`, `telegram_codes` | Linked owner chats and one-time link codes |
| `meta` | This database's registry namespace and other settings |

## Events

Every event's hash covers the previous event's hash, so editing or removing one breaks every hash after it.

| Group | Types |
|---|---|
| Limits | `POLICY_ACTIVATED`, `POLICY_RECORDED`, `POLICY_RECORD_FAILED`, `POLICY_STOPPED`, `POLICY_STOP_RECORDED` |
| Contacts | `CONTACT_ADDED`, `CONTACT_CHECKED`, `CONTACT_UPDATED`, `CONTACT_REMOVED` |
| Batch | `BATCH_IMPORTED`, `AGENT_PLANNED`, `AGENT_REVIEW`, `AGENT_ERROR`, `ROW_EDITED`, `BATCH_RECHECKED`, `BATCH_APPROVED`, `APPROVAL_CLEARED`, `BATCH_STARTED`, `BATCH_PAUSED`, `BATCH_RESUMED`, `BATCH_CLOSED`, `BATCH_SEALED`, `SEAL_FAILED`, `SEAL_SKIPPED` |
| Vault | `VAULT_RELEASED`, `VAULT_REFUSED`, `VAULT_FUNDED`, `VAULT_FROZEN`, `VAULT_UNFROZEN` |
| Rows | `ROW_REFUSED`, `ROW_SIGNED`, `ROW_SUBMITTED`, `ROW_STATE`, `ROW_FAILED`, `REJECTED_BY_GASFREE`, `ROW_ERROR`, `ROW_TIMEOUT` |
| Recovery | `ROW_SUBMIT_LOST`, `ROW_SUBMIT_UNKNOWN`, `ROW_RESENT`, `ROW_RESEND_REJECTED`, `ROW_RECOVERED`, `ROW_PERMIT_EXPIRED`, `ROW_PERMIT_DROPPED` |
| Family | `RECEIPT_CONFIRMED` |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server with reload on port 4000 |
| `npm start` | Server |
| `npm run setup` | Creates `.env.local` with Nile wallets, the Dummy demo wallets and their cities |
| `npm run check` | The 11 tests |
| `npm run verify -- <evidence.json>` | [`verify.mjs`](scripts/verify.mjs), the independent verifier (no imports from `src/`) |
| `npm run deploy:vault` | [`deploy-vault.ts`](scripts/deploy-vault.ts): deploys AnsimVault; `VAULT_OWNER` sets its owner |
| `npm run reset` | Deletes the local database |

[`scripts/fake-services.mjs`](scripts/fake-services.mjs) stands in for GasFree and the model API, for running the whole flow offline.

## Data

| Path | What it is |
|---|---|
| [`data/payees.json`](data/payees.json) | Dummy 1–6: the demo contacts, with cities |
| [`data/reported.json`](data/reported.json) | Wallets reported to the operator |
| [`data/demo/`](data/demo) | The 13-row demo payout file, as CSV and Excel |
| `data/*.local.json`, `data/*.db` | Demo wallet keys and databases; gitignored |

## Deploy

Railway builds [`Dockerfile`](Dockerfile) from the repository root. The database lives on a volume mounted at `data/`, and a deploy restarts the server for about a minute. Set secrets with `railway variables --stdin`. After a backend change:

```bash
railway up --detach -s ansim-backend
```
