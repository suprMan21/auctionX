# S-ANCHOR1 Ph1 — Ownership Registry anchoring (Base Sepolia) — Verification

**Date:** 2026-10-27 (Toronto) · **Branch:** `feature/s-anchor1-ph1` → `dev`
**Brief:** Notion "S-ANCHOR1 — Ownership Registry + On-Chain Anchoring" v0.3 · **Decision:** Decisions DB 2026-10-27 (Locked)

> **This is not an NFT.** Nothing on-chain is ownable, tradeable or held in anyone's wallet. The registry is an
> append-only log of 32-byte fingerprints. `contracts/contracts/AuctionXNFT.sol` is the **superseded** ERC-721
> from before the token-first pivot; only the Hardhat tooling is reused.

## What shipped (code complete; chain setup is Boss's runbook below)

| Piece | Where |
|---|---|
| Registry contract: writer appends (`anchor`, `anchorRoot`), owner can only rotate the writer (`setWriter`, zero = stop writes), two-step ownership, renounce disabled, no per-item state | `contracts/contracts/OwnershipRegistry.sol` |
| Deploy script (throwaway deployer gets no role; Base Sepolia only; Basescan verify) | `contracts/scripts/deploy-registry.ts` |
| Migration: `anchor_batches`, `anchor_chain_state`, `anchor_alerts`; `ownership_proofs.anchor_batch_id` + `merkle_proof`; `record_anchor_batch`, `confirm_anchor_batch`, `record_anchor_alert` (service_role only); pg_cron `anchor-tick` hourly at :07 | `supabase/migrations/20261027000004_s_anchor1_registry.sql` + `…000005_s_anchor1_hardening.sql` (`sent_tx_hashes`, `owner_changed`) — **both applied to staging 2026-10-27** |
| KMS signer (secp256k1, DER → low-s → recovery bit; key never leaves KMS) | `backend/src/lib/anchoring/kmsSigner.ts` |
| Daily root: OpenZeppelin StandardMerkleTree (`bytes32` leaves) + one random padding leaf; published every day, even empty | `backend/src/lib/anchoring/merkle.ts` |
| Hourly tick: writer check → confirm → batch → send (tx hash stored before broadcast) → reconcile → balance | `backend/src/lib/anchoring/anchorTick.ts`, `registry.ts` |
| `POST /api/v1/internal/anchor-tick` (own secret `ANCHOR_TICK_SECRET`, header `x-anchor-secret`; 503 unset, 403 wrong) | `backend/src/routes/anchorTick.ts` |
| Alerts → `anchor_alerts` + one GitHub Issue each (label `anchoring`) + ERROR log | `backend/src/lib/anchoring/alerts.ts` |
| Mainnet refused in code (`ANCHOR_CHAIN_ID` must be 84532) | `backend/src/lib/anchoring/config.ts` |
| Receipt: `anchor` = `pending` or `anchored` (tx, block, root, Merkle path, leaf encoding, Basescan link) + plain "howToVerify" steps. Padding leaf never returned | `tokenReadController.getReceipt`, `frontend/.../lib/receipt.ts` |
| My Tokens / token page: "Recorded in the public registry on …" + **Verify independently**, or "can take up to 24 hours" | `listMyTokens` (`ownershipAnchor`), `OwnershipPanel.tsx` |
| KMS key script (Boss runs) | `scripts/anchor/create-writer-key.sh` |

Day boundary: a daily root covers every unbatched proof created before **00:00 UTC**; it is built on the first tick
after midnight UTC (≈ 20:07 Toronto). A proof created a moment before the cutoff but committed after it goes into
the next day's root, never lost.

## Tests

| Suite | Result |
|---|---|
| Contracts (Hardhat) | 12 passing |
| Backend vitest | 868 passed / 23 skipped (was 829; +36 `anchoring.test.ts`, +2 Receipt, +1 internal-route pin; the 2 new skips are the opt-in chain test) |
| Frontend vitest | 321 (was 318) |
| tsc | 0 errors, both sides |
| Live SQL `supabase/tests/s_anchor1_live.sql` | **22/22** (dry run BEGIN … ROLLBACK, then after both `db push`es) |
| Opt-in end to end `anchoring.chain.test.ts` (local Hardhat node on chain id 84532, real contract, real viem client, KMS-format high-s signatures) | **2/2** |

Mutation checks (rule removed → suite fails): low-s normalisation (2 fail), reconciliation match (4 fail),
record-before-broadcast claim (10 fail).

End-to-end run: `cd contracts && npx hardhat compile && HARDHAT_CHAIN_ID=84532 npx hardhat node`, then
`cd backend && ANCHOR_E2E_RPC=http://127.0.0.1:8545 npx vitest run src/__tests__/anchoring.chain.test.ts`.

## Security review (before merge)

Independent review of `7d0f6b8`: **no blockers**; no leak of salt, padding leaf, account ids or UIDs on-chain, in
responses, logs or issues; KMS signer correct. Should-fixes, all done in the follow-up commit:

1. A forged write whose alert could not be stored let the scan cursor move on → reconcile now throws unless the
   alert is recorded, so the block is scanned again.
2. A GitHub outage on an alert's first sighting meant no issue ever → an issue is opened whenever none exists.
3. A stolen writer could replay a known root without alerting → every signed tx hash is kept
   (`sent_tx_hashes`); a write matches only on value **and** tx.
4. Owner-key changes were not watched → `OwnershipTransferStarted` / `OwnershipTransferred` alert
   (`owner_changed`; the deploy's own transfer from zero is ignored).
5. A broadcast error could double-send → the row stays `submitted`; only a tx seen dropped for 10 min is re-signed.
6. A missed UTC day got no root → every missing day since the last root is built, oldest first (31 per tick).
7. **Residual risk (accepted for Ph1):** any IAM admin can rewrite the key policy (`PutKeyPolicy`) and remove the
   Deny, or change the instance role's trust policy. Detection is the follow-up: CloudTrail/EventBridge alarm on
   `PutKeyPolicy`, `CreateGrant`, `DisableKey`, `ScheduleKeyDeletion` for the writer key and
   `UpdateAssumeRolePolicy` on `am-backend-staging-instance`. Required before mainnet.

Nits fixed: `{ error }` checked on the failure write; one bad receipt lookup no longer stops other confirmations;
per_event counts only created batches; the contract refuses a pending owner as writer and the writer as owner.
Not fixed: a stuck (underpriced) tx only alerts, no fee bump (fine on Sepolia; revisit for mainnet). Noted for
Ph2/counsel: a Receipt's sibling hashes let its holder test whether another *publicly known* Ownership ID was
anchored the same day.

## Setup record

| Item | Value |
|---|---|
| Writer KMS key | `alias/am-anchor-writer-staging` → key id `0a451741-79d7-4064-91db-35db22b348da` (ECC_SECG_P256K1, us-east-2), created by Boss 2026-10-27 via CloudShell as `chris-admin` |
| Writer address | `0x704BD2499738c0dBc84C2F84ffD17b587a64A70b` (derived from the KMS public key) |
| No-human-sign check | `chris-admin`: AccessDenied (script). `claude-ro`: AccessDenied, "explicit deny in a resource-based policy", i.e. the key policy's own Deny |
| Owner (interim) | `0x6Cd01c0F55ce9E0Bf78f5E90f72b4345b16d515d`: Boss's software (hot) wallet, **not** a hardware wallet. Boss has no hardware wallet yet (2026-10-27). Deviation from the brief (owner = hardware wallet on testnet too), accepted for testnet only. Follow-up: buy a hardware wallet, then `transferOwnership(<hw>)` from this wallet and `acceptOwnership()` from the device. Required before mainnet |
| Registry (Base Sepolia) | `0xC74C99F15bE59781869D2BF7baB8C5EEC20C913d`, deploy block `50979710`, tx [`0x71dacb…04bc`](https://sepolia.basescan.org/tx/0x71dacbdbccfccdfe77fe828005c0f247630f1f16c7a262f0bbc5f030bd7904bc), 2026-10-27. On-chain read: owner and writer as above, no pending owner |
| Deploy cost | 398,868 gas at 0.0051 gwei = 0.000002 ETH. Throwaway deployer `0xdB82…9B9C` key deleted after deploy |
| Funding | Writer and deployer 0.0001 Sepolia ETH each (CDP faucet). A daily root is ~30k gas, so the writer lasts well over a year at current prices; set `ANCHOR_LOW_BALANCE_WEI=20000000000000` (0.00002 ETH) or the default 0.002 ETH alert fires at once |
| Source verification | Not yet (no Etherscan key): `npx hardhat verify --network baseSepolia 0xC74C99F15bE59781869D2BF7baB8C5EEC20C913d 0x6Cd01c0F55ce9E0Bf78f5E90f72b4345b16d515d 0x704BD2499738c0dBc84C2F84ffD17b587a64A70b` |

## Boss runbook (testnet setup)

1. **Hardware wallet address.** Any EVM address on it; Base Sepolia uses the same address. This is `REGISTRY_OWNER`.
2. **KMS writer key.** `AWS_PROFILE=<admin profile> scripts/anchor/create-writer-key.sh`. It must end with
   `OK: AccessDenied for <you>` (proves no human can sign) and print the **writer address** (`REGISTRY_WRITER`).
3. **Fund (faucet).** ~0.01 Base Sepolia ETH to the writer address, and a little to a **throwaway deployer**:
   `cd backend && node -e "const a=require('viem/accounts');const k=a.generatePrivateKey();console.log(k, a.privateKeyToAccount(k).address)"`.
   The deployer key is used once and gets no role; do not keep it.
4. **Deploy + verify.** From `contracts/` (leading space keeps it out of shell history):
   ` DEPLOYER_PRIVATE_KEY=0x… REGISTRY_OWNER=0x… REGISTRY_WRITER=0x… ETHERSCAN_API_KEY=… npx hardhat run scripts/deploy-registry.ts --network baseSepolia`
   → prints `ANCHOR_REGISTRY_ADDRESS` and `ANCHOR_REGISTRY_DEPLOY_BLOCK`.
5. **App Runner env** (literals): `ANCHOR_TICK_SECRET` (`openssl rand -base64 36`, save in 1Password),
   `ANCHOR_RPC_URL` (Alchemy Base Sepolia HTTPS URL), `ANCHOR_REGISTRY_ADDRESS`, `ANCHOR_REGISTRY_DEPLOY_BLOCK`,
   `ANCHOR_KMS_KEY_ID=alias/am-anchor-writer-staging`. Optional: `ANCHOR_MODE` (default `daily_batch`),
   `ANCHOR_LOW_BALANCE_WEI` (default 0.002 ETH), `ANCHOR_CONFIRMATIONS` (default 3).
6. **Vault** (SQL editor): `select vault.create_secret('<ANCHOR_TICK_SECRET>', 'anchor_tick_secret');`
   **No trailing newline** (a newline in the fee-sweep secret caused 403s on 2026-10-25).
7. **GitHub:** create the label `anchoring` on the app repo so alert issues are tagged.
8. **Push `dev`**, run `scripts/verify-backend-deploy.sh`. The first tick runs at :07 past the next hour; the
   first root goes out after the next 00:00 UTC. Claude checks the logs (`anchor_tick`) and the DB.
9. **Rotation drill** (acceptance criterion, needs the hardware wallet): on Basescan → contract → *Write Contract*
   → connect the hardware wallet → `setWriter(<any other address>)`. Next tick: `writer_mismatch` +
   `writer_changed` alerts, sends paused. Then `setWriter(<KMS writer address>)`; next tick sends again.
   Claude records the tx hashes here.

## Acceptance criteria (brief) — Ph1 status

| Criterion | Status |
|---|---|
| Contract deployed + source-verified on Base Sepolia | ✅ Deployed 2026-10-27 (`0xC74C…913d`); source verification waits on an Etherscan key |
| Only the anchoring address can write; others revert | ✅ Hardhat tests + chain e2e |
| Writer rotation by owner works; old writer reverts | ✅ Hardhat + chain e2e; **real drill with the hardware wallet pending (runbook 9)** |
| No human principal can `kms:Sign` | Key policy has an explicit Deny for every principal but the instance role; script proves it for the caller. Claude to repeat with `claude-ro` after creation |
| Reconciliation alerts on an injected unmatched event | ✅ unit + chain e2e; repeat on Sepolia during the drill |
| Every Ownership ID anchored in the window; failures retry and alert | ✅ code + tests (backoff to 6 h, alert at 5 attempts; dropped → resend; reverted → alert) |
| No on-chain data links two IDs or reveals tag/account identifiers | ✅ only a daily root (padding leaf) or an Ownership ID; no per-item contract state |
| Switching to daily_batch keeps issued Receipts valid | ✅ test "switching modes keeps earlier batches valid" |
| Every event has its own salt; no global secret in a Receipt | ✅ already held (S-NFC3); unchanged |
| Cost per anchor recorded | After the first Sepolia roots |
| Receipt signature, verifier package, public docs, crypto-shred drill | **Ph2** |
| Mainnet + counsel sign-off + privacy-policy disclosure | **Not Ph1** (code refuses chain 8453) |

## Not in Ph1 / follow-ups

- **Hand registry ownership to a hardware wallet** (interim owner is a hot wallet; see Setup record). Two-step on Basescan; the tick raises `owner_changed` alerts for both steps, which is expected.

- **CloudTrail tripwires** (review item 7 above). Required before mainnet; Ph2 or S-SEC1.
- The 7 existing staging proofs all go into the first daily root (they predate anchoring).
- Public lookup `GET /ownership/:id` does not show anchor status yet (Ph2 with the public docs).
- Incident runbook (rotate writer, publish notice, flag forged window): the drill in runbook 9 is its rehearsal;
  the written runbook lands with Ph2 docs.
