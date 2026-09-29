# Ansim contracts

Two TRON contracts on Nile:

- **AnsimVault** holds the operator's USDT and releases a batch only for the owner's signed approval.
- **AnsimRegistry** records which limits the owner granted, when they were stopped, and a hash of each finished batch's log.

Both are Solidity 0.8.26, compiled for the `istanbul` EVM version that the TRON VM runs.

[AnsimVault](#ansimvault) • [AnsimRegistry](#ansimregistry) • [The approval digest](#the-approval-digest) • [Build and deploy](#build-and-deploy) • [Deployed](#deployed-on-nile) • [How verify uses them](#how-verifymjs-uses-them)

## AnsimVault

[`src/AnsimVault.sol`](src/AnsimVault.sol). The money leaves only when all of these hold:

- it goes to the payer's GasFree account,
- the owner signed a TIP-712 approval for the batch,
- that approval hasn't been used before,
- the amount is exactly the approved total plus GasFree's fee per payment.

Even a compromised Ansim backend can move at most one approved batch, because it can't forge the owner's signature.

| Function | Who | What it does |
|---|---|---|
| `release(batchId, policyId, rowsHash, count, total, sig)` | agent only | Recovers the signer of the `BatchApproval`, requires the owner, requires not frozen and not already released, then sends `total + count × feePerPayment` to `payout` |
| `approvalDigest(...)` | anyone | The TIP-712 digest the owner signs |
| `approver(...)` | anyone | Who signed an approval; rejects malformed and malleable (high-s) signatures |
| `released(digest)` | anyone | Amount released for an approval, or 0 |
| `setFrozen(bool)` | owner | Freezes or unfreezes every release |
| `setOwner(address)` | owner | Hands the vault to a new owner, such as a TronLink wallet |
| `withdraw(to, amount)` | owner | Takes money out |

| Immutable | Value on Nile |
|---|---|
| `token` | Nile USDT `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf` |
| `agent` | Ansim's notary key `TVHXjWjM9MhMX9STBL16BprC1PSmoGXvNL`, the only caller of `release` |
| `payout` | The payer's GasFree account `TW6BntBhCJbEZAQy88wU3tJEwcPL6N8qwX`, the only place a release can go |
| `feePerPayment` | 300000 (0.30 USDT) |

**Events:** `Released(batchId, digest, policyId, rowsHash, count, total, amount)`, `Frozen(frozen)`, `OwnerChanged(owner)`, `Withdrawn(to, amount)`.

**Errors:** `NotAgent`, `NotOwner`, `VaultFrozen`, `AlreadyReleased`, `BadSignature`, `TransferFailed`.

**Why transfers check balances:** TRON's USDT doesn't reliably return `true` from `transfer`. So `_send` reads the receiver's balance before and after, and reverts unless it grew by exactly the amount.

## AnsimRegistry

[`src/AnsimRegistry.sol`](src/AnsimRegistry.sol). A public record, written only by the notary key:

| Function | Records | Event |
|---|---|---|
| `grantPolicy(policyId, policyHash, payer, owner, budget, perPayment, deadline)` | The hash of the owner's signed limits | `PolicyGranted` |
| `stopPolicy(policyId)` | When the owner stopped them | `PolicyStopped` |
| `sealBatch(batchId, policyId, logHash, paid, refused, amountPaid, fees)` | The hash of the batch's `BATCH_CLOSED` event, and its totals | `BatchSealed` |

- **One record per ID:** each ID can be recorded once (`AlreadyRecorded`), and stopping an unknown policy reverts (`UnknownPolicy`). Only the notary can write (`NotNotary`).
- **IDs are namespaced:** each backend database has its own number, and a record's ID is `namespace × 1,000,000 + local ID`. So two databases sharing the registry never collide.

## The Approval Digest

The owner signs this in TronLink. The vault recomputes it on chain.

```
domain   EIP712Domain(string name,string version,uint256 chainId)
         name "Ansim", version "1", chainId 3448148188 (Nile)

message  BatchApproval(uint256 batchId,uint256 policyId,bytes32 rowsHash,uint256 count,uint256 total)

digest   keccak256("\x19\x01" ‖ domainSeparator ‖ keccak256(abi.encode(TYPEHASH, batchId, policyId, rowsHash, count, total)))
```

`rowsHash` is the SHA-256 of every row to be paid, as `line:receiver:amount`, sorted by line and joined with commas. So an approval covers exactly those rows, in any order. The backend builds it in [`backend/src/policy.ts`](../backend/src/policy.ts).

## Build and Deploy

From the repository root:

```bash
npm run compile -w contracts
```

```bash
npm run deploy:contracts
```

```bash
VAULT_OWNER=<your TronLink address> npm run deploy:vault
```

- [`scripts/compile.mjs`](scripts/compile.mjs) compiles both contracts with solc into `build/`.
- [`scripts/deploy.mjs`](scripts/deploy.mjs) deploys AnsimRegistry with the notary key and writes `deployments/nile.json`.
- [`backend/scripts/deploy-vault.ts`](../backend/scripts/deploy-vault.ts) deploys AnsimVault and writes `deployments/nile-vault.json`. It reads GasFree's fee and the payer's GasFree address from GasFree.

The notary address needs Nile TRX, from the [Nile faucet](https://nileex.io/join/getJoinPage). The backend and `verify.mjs` read the addresses and ABIs from `deployments/`.

## Deployed on Nile

| Contract | Address | Deploy transaction |
|---|---|---|
| AnsimVault | [`TWWL6N7DyNzbJ9zZLXncVtcDdu5hDdmL8k`](https://nile.tronscan.org/#/contract/TWWL6N7DyNzbJ9zZLXncVtcDdu5hDdmL8k) | [9aa5af24…d6613](https://nile.tronscan.org/#/transaction/9aa5af2446a900f5cc491b2c23689a00fecf419b9aaadf61790a32ea82dd6613) |
| AnsimRegistry | [`TUcz2dryzQLTTyTFooLwoFxP5cWugCq8xq`](https://nile.tronscan.org/#/contract/TUcz2dryzQLTTyTFooLwoFxP5cWugCq8xq) | [3a13f341…d91f82](https://nile.tronscan.org/#/transaction/3a13f341aa5e788e419e207b5ef02dd5ea906fc6b82cdc1f4745a67734d91f82) |

The vault's owner is the operator's TronLink wallet `TULPNbKuhamDY1FuW3KfHiUzRVzcuFio83`, moved there with `setOwner` in [6866a972…e28bdd](https://nile.tronscan.org/#/transaction/6866a9726a9e0b9033f897bfe68d6b0fa2bf7c4c2d43de253e3789839fe28bdd).

**Funding:** send Nile USDT (`TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`) to the vault address with a plain TRC-20 transfer. Any other token sent there is stuck, and the vault does not accept TRX. See [Funding the Vault](../README.md#funding-the-vault).

## How verify.mjs Uses Them

[`backend/scripts/verify.mjs`](../backend/scripts/verify.mjs) checks an evidence file against both contracts:

- **Registry:** `policies(id)` must hold the hash of the signed limits in the file, and `batches(id)` must hold the hash of the file's `BATCH_CLOSED` event.
- **Vault:** `released(digest)` must equal the release in the file. It must be no more than the approved total plus fees, and it must come before the first payment.
