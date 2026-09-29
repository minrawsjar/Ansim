# Ansim frontend

The operator's console and the families' receipt pages. It uses Next.js 16 (App Router), React 19 and Tailwind 4. The owner signs in TronLink, and all data comes from the backend through `/api`.

Live at **https://ansim-ecru.vercel.app**.

[Routes](#routes) • [Components](#components) • [TronLink](#tronlink) • [Proxy](#proxy-and-locks) • [Environment](#environment) • [Scripts](#scripts) • [Design](#design)

## Routes

| Route | File | Who | What it shows |
|---|---|---|---|
| `/` | [`app/(console)/page.tsx`](app/%28console%29/page.tsx) | Operator and owner | Contacts, payment limits, the payout agent, import, the vault, the live payout map, the boundary runs and batches |
| `/batch/[id]` | [`app/(console)/batch/[id]/page.tsx`](app/%28console%29/batch/[id]/page.tsx) | Operator and owner | A batch's rows and flags, inline fixes, Travel Rule details, the pre-check, the owner's approval, pay and recover, the map, receipts, exports, verify and the auditor AI |
| `/payments` | [`app/(console)/payments/page.tsx`](app/%28console%29/payments/page.tsx) | Operator and owner | Every payment across batches, newest first, with totals, TronScan links, a CSV export and a receipt download per payment |
| `/disputes` | [`app/(console)/disputes/page.tsx`](app/%28console%29/disputes/page.tsx) | Support | Finds a payment, shows the chain's own proof, and drafts a reply |
| `/metrics` | [`app/(console)/metrics/page.tsx`](app/%28console%29/metrics/page.tsx) | Judges and the operator | Tokens, latency and energy by AI flow, with the model and provider |
| `/r/[token]` | [`app/r/[token]/page.tsx`](app/r/[token]/page.tsx) | The family | Their receipt in Vietnamese, Tagalog or Nepali with English (plus Korean), "I received it", and an optional city |

`(console)` is a route group. Its [`layout.tsx`](app/%28console%29/layout.tsx) adds the header, the navigation and **Connect TronLink**. The receipt page has neither, and a family never sees the console.

## Components

| File | What it has |
|---|---|
| [`app/(console)/page.tsx`](app/%28console%29/page.tsx) | `Hero`; `Modebar` with `ConnectTelegram` and `TestAlert`; `PolicyDesk` (`Contacts`, `Limits`, `RiskLine`); `AgentCard` with example prompts; `ImportCard`; `VaultCard` (Freeze only for the vault's owner); `RecentMap`; `Boundary`; `Batches`. Retries automatically while the backend restarts |
| [`app/(console)/batch/[id]/page.tsx`](app/%28console%29/batch/[id]/page.tsx) | `RowLine`, `OwnerApproval`, `Savings` (against bank fees), `PrecheckPanel` (hidden while payments are in flight) |
| [`app/(console)/disputes/page.tsx`](app/%28console%29/disputes/page.tsx) | `ChainProof`: the USDT transfer as the chain reports it |
| [`app/flow-map.tsx`](app/flow-map.tsx) | `FlowMap`: payments from Seoul to each family's city, grouped by city, with a ring when the family confirms |
| [`app/places.ts`](app/places.ts) | City coordinates for Vietnam, the Philippines and Nepal, with each capital as the fallback, and `nearestCity` for the family's opt-in location (worked out on their device) |
| [`app/wallet.tsx`](app/wallet.tsx) | `useTronLink` (account and network, kept current) and `ConnectWallet`, which shows OWNER for the vault's owner |
| [`app/lib.ts`](app/lib.ts) | Types, `api()`, the TronLink helpers, and the text for every flag and refusal reason |
| [`app/ui.tsx`](app/ui.tsx) | `Card`, `Callout`, `Button`, `StatePill`, `FlagChip`, `Addr`, `TxLink`, `Copy`, `ErrorLine`, `Stat`, `WaitingForTronLink` |

## TronLink

Everything the owner signs is signed in their own TronLink. The backend never sees the owner's key.

| Action | Helper in [`lib.ts`](app/lib.ts) | What TronLink does |
|---|---|---|
| Connect | `connectTronLink` | Asks for the account and switches to Nile with `wallet_switchEthereumChain` (`0xcd8690dc`) |
| Current state | `tronLinkState` | Reads the account, and the chain from the wallet's genesis block. Never opens a popup |
| Sign the payment limits | `signWithTronLink` | Signs the `SpendingPolicy` typed data |
| Approve a batch | `signWithTronLink` | Signs the `BatchApproval` typed data the vault checks |
| Freeze or unfreeze the vault | `sendWithTronLink` | Sends `setFrozen` to AnsimVault; the backend checks it was the owner's call before recording it |

`WaitingForTronLink` explains what to look for while a TronLink popup is open.

## Proxy and Locks

[`proxy.ts`](proxy.ts) forwards `/api/*` to the backend and applies two optional locks:

- **`SITE_PASSWORD`:** the browser asks for a password once (HTTP Basic auth). Family receipts (`/r/*` and `/api/receipts/*`) are exempt, because the unguessable token in the link is their key.
- **`BACKEND_KEY`:** added as `x-ansim-key` on every forwarded request. The site password is never forwarded.

## Environment

| Variable | Default | What it is |
|---|---|---|
| `BACKEND_URL` | `http://localhost:4000` | Where `/api` goes |
| `BACKEND_KEY` | unset | Must match the backend's |
| `SITE_PASSWORD` | unset | Locks the console; unset in local development |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build |
| `npm start` | Serves the build on port 3000 |
| `npm run lint` | ESLint |

Vercel deploys every push to `main`.

## Design

- **Palette:** a dark celadon palette, after Korean celadon pottery. It's defined as tokens in [`globals.css`](app/globals.css): `paper`, `surface`, `ink`, `muted`, `line`, `celadon`, `ok`, `warn`, `stop`.
- **Type:** Inter for Latin text, IBM Plex Sans KR for Korean, IBM Plex Mono for addresses and amounts.
- **Language:** every status a family sees is shown in their language with English underneath. Every flag and refusal has a plain explanation in `lib.ts`.
