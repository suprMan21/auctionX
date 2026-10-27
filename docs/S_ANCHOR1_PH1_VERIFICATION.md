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
| Migration: `anchor_batches`, `anchor_chain_state`, `anchor_alerts`; `ownership_proofs.anchor_batch_id` + `merkle_proof`; `record_anchor_batch`, `confirm_anchor_batch`, `record_anchor_alert` (service_role only); pg_cron `anchor-tick` hourly at :07 | `supabase/migrations/20261027000004_s_anchor1_registry.sql` — **applied to staging 2026-10-27** |
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
| Contracts (Hardhat) | 11 passing |
| Backend vitest | 863 passed / 23 skipped (was 829; +31 `anchoring.test.ts`, +2 Receipt, +1 internal-route pin; the 2 new skips are the opt-in chain test) |
| Frontend vitest | 321 (was 318) |
| tsc | 0 errors, both sides |
| Live SQL `supabase/tests/s_anchor1_live.sql` | **20/20** on the dry run (BEGIN … ROLLBACK) and again after `db push` |
| Opt-in end to end `anchoring.chain.test.ts` (local Hardhat node on chain id 84532, real contract, real viem client, KMS-format high-s signatures) | **2/2** |

Mutation checks (rule removed → suite fails): low-s normalisation (2 fail), reconciliation match (4 fail),
record-before-broadcast claim (10 fail).

End-to-end run: `cd contracts && npx hardhat compile && HARDHAT_CHAIN_ID=84532 npx hardhat node`, then
`cd backend && ANCHOR_E2E_RPC=http://127.0.0.1:8545 npx vitest run src/__tests__/anchoring.chain.test.ts`.

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
| Contract deployed + source-verified on Base Sepolia | Waiting on runbook 4 |
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

- **CloudTrail tripwires** (alert on key-policy change, disable, deletion of the writer key). The explicit Deny
  already blocks any other signer; the tripwire is detection on top. Ph2 or S-SEC1.
- The 7 existing staging proofs all go into the first daily root (they predate anchoring).
- Public lookup `GET /ownership/:id` does not show anchor status yet (Ph2 with the public docs).
- Incident runbook (rotate writer, publish notice, flag forged window): the drill in runbook 9 is its rehearsal;
  the written runbook lands with Ph2 docs.
