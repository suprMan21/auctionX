/**
 * S-ANCHOR1 Ph1 — end to end on a real EVM. Opt-in: skipped unless
 * ANCHOR_E2E_RPC points at a local Hardhat node started with chain id 84532:
 *
 *   cd contracts && npx hardhat compile && HARDHAT_CHAIN_ID=84532 npx hardhat node
 *   cd backend && ANCHOR_E2E_RPC=http://127.0.0.1:8545 npx vitest run src/__tests__/anchoring.chain.test.ts
 *
 * Real pieces: the OwnershipRegistry bytecode, the viem chain client
 * (createViemChainPort), signatures in KMS's own formats (SPKI key + DER
 * signature, high-s forced so normalisation is exercised), and the tick.
 * Stand-ins: a local secp256k1 key instead of KMS, an in-memory database.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';
import { secp256k1 } from '@noble/curves/secp256k1';
import { createPublicClient, createTestClient, createWalletClient, http, parseAbi, parseEther, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { createKmsSigner, type KmsSigner } from '../lib/anchoring/kmsSigner';
import { createViemChainPort, registryAbi } from '../lib/anchoring/registry';
import { runAnchorTick } from '../lib/anchoring/anchorTick';
import { randomLeaf, verifyInRoot } from '../lib/anchoring/merkle';
import type { AnchorConfig } from '../lib/anchoring/config';
import type { AnchorAlertKind } from '../lib/anchoring/alerts';
import { createMockSupabase, type Tables } from './helpers/supabaseMock';
import { anchorRpc, proof } from './helpers/anchorDbFake';

const RPC = process.env.ANCHOR_E2E_RPC;

// Hardhat's published development key for account #0. Test-only; funded only on a local node.
const DEPLOYER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
// Stands in for Boss's hardware wallet; funded by the deployer below.
const OWNER = privateKeyToAccount(generatePrivateKey());

// The owner-only call. Not in the backend's registryAbi on purpose: the backend never rotates.
const ownerAbi = parseAbi(['function setWriter(address newWriter)']);

const SPKI_PREFIX = Buffer.from('3056301006072a8648ce3d020106052b8104000a034200', 'hex');
const ctx = { requestId: 'e2e', actorId: null, actorType: 'system' as const, ip: '127.0.0.1', route: 'e2e' };

const localKms = () => {
  const priv = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(priv, false);
  return {
    send: async (command: GetPublicKeyCommand | SignCommand) => {
      if (command instanceof GetPublicKeyCommand) {
        return { PublicKey: new Uint8Array(Buffer.concat([SPKI_PREFIX, Buffer.from(pub)])) };
      }
      const sig = secp256k1.sign(command.input.Message as Uint8Array, priv, { lowS: true });
      // KMS does not promise low-s: hand back the high-s twin to prove we fix it.
      return { Signature: new secp256k1.Signature(sig.r, secp256k1.CURVE.n - sig.s).toDERRawBytes() };
    },
  };
};

describe.skipIf(!RPC)('anchoring end to end (local EVM, chain id 84532)', () => {
  const transport = http(RPC);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const testClient = createTestClient({ chain: baseSepolia, mode: 'hardhat', transport });
  const deployer = createWalletClient({ account: DEPLOYER, chain: baseSepolia, transport });
  const owner = createWalletClient({ account: OWNER, chain: baseSepolia, transport });

  let signer: KmsSigner;
  let registry: Hex;
  let deployBlock: bigint;
  let tables: Tables;
  let alerts: Array<{ kind: AnchorAlertKind; key: string }>;
  let clock: Date;

  const config = (): AnchorConfig => ({
    mode: 'daily_batch', chainId: 84532, rpcUrl: RPC!, registryAddress: registry, deployBlock,
    kmsKeyId: 'local', lowBalanceWei: parseEther('0.002'), confirmations: 2,
    maxSendsPerTick: 10, logChunkBlocks: 5n, maxLogChunksPerTick: 100,
  });

  const tick = () => runAnchorTick({
    supabase: createMockSupabase(tables, { rpc: anchorRpc(tables) }) as never,
    chain: createViemChainPort(config(), signer),
    config: config(),
    writer: signer.address,
    now: () => clock,
    randomLeaf,
    alert: async (kind, key) => { alerts.push({ kind, key }); return true; },
  });

  beforeAll(async () => {
    expect(await publicClient.getChainId()).toBe(84532);
    signer = await createKmsSigner('local', ctx, localKms());

    const artifact = JSON.parse(readFileSync(
      join(__dirname, '../../../contracts/artifacts/contracts/OwnershipRegistry.sol/OwnershipRegistry.json'), 'utf8',
    )) as { abi: unknown[]; bytecode: Hex };
    const hash = await deployer.deployContract({
      abi: artifact.abi, bytecode: artifact.bytecode, args: [OWNER.address, signer.address],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    registry = receipt.contractAddress!;
    deployBlock = receipt.blockNumber;

    for (const to of [signer.address, OWNER.address]) {
      await publicClient.waitForTransactionReceipt({
        hash: await deployer.sendTransaction({ to, value: parseEther('0.01') }),
      });
    }

    tables = {
      anchor_batches: [], anchor_chain_state: [],
      ownership_proofs: [proof(1, '2026-10-27T03:00:00.000Z'), proof(2, '2026-10-27T20:00:00.000Z')],
    };
    alerts = [];
    clock = new Date('2026-10-28T01:07:00.000Z');
  });

  it('anchors yesterday\'s root with a KMS-format signature, confirms it, and reconciles clean', async () => {
    const first = await tick();
    expect(first.errors).toEqual([]);
    expect(first.writerOk).toBe(true);
    expect(first.sent).toBe(1);

    const [batch] = tables.anchor_batches;
    const tx = await publicClient.getTransaction({ hash: batch.tx_hash as Hex });
    expect(tx.from.toLowerCase()).toBe(signer.address.toLowerCase());

    await testClient.mine({ blocks: 3 });
    const second = await tick();
    expect(second.confirmed).toBe(1);
    expect(second.unmatched).toBe(0);
    expect(alerts).toEqual([]);

    const logs = await publicClient.getContractEvents({ address: registry, abi: registryAbi, eventName: 'RootAnchored', fromBlock: deployBlock });
    expect(logs.map((l) => l.args.merkleRoot)).toEqual([batch.merkle_root]);

    for (const p of tables.ownership_proofs) {
      expect(p.anchored_tx_hash).toBe(batch.tx_hash);
      expect(verifyInRoot(logs[0].args.merkleRoot!, p.ownership_id as string, p.merkle_proof as string[])).toBe(true);
    }
  });

  it('writer rotation drill: the old writer is refused, a forged write alerts, and sends pause', async () => {
    // The owner appoints a different writer (here, the deployer's key stands in
    // for an attacker who stole the owner key, or for the drill's temp writer).
    await publicClient.waitForTransactionReceipt({
      hash: await owner.writeContract({ address: registry, abi: ownerAbi, functionName: 'setWriter', args: [DEPLOYER.address] }),
    });

    // Our KMS writer is now refused on-chain.
    await expect(publicClient.simulateContract({
      account: signer.address, address: registry, abi: registryAbi, functionName: 'anchorRoot', args: [randomLeaf()],
    })).rejects.toThrow();

    // A write we never made.
    await publicClient.waitForTransactionReceipt({
      hash: await deployer.writeContract({ address: registry, abi: registryAbi, functionName: 'anchorRoot', args: [randomLeaf()] }),
    });
    await testClient.mine({ blocks: 3 });

    clock = new Date('2026-10-29T01:07:00.000Z');
    const s = await tick();
    expect(s.writerOk).toBe(false);
    expect(s.sent).toBe(0);
    expect(s.batchesCreated).toBe(1); // still built, waiting for the writer to be restored
    const kinds = alerts.map((a) => a.kind).sort();
    expect(kinds).toEqual(['unmatched_event', 'writer_changed', 'writer_mismatch']);

    // Restore: the owner puts our KMS writer back and the pending root goes out.
    await publicClient.waitForTransactionReceipt({
      hash: await owner.writeContract({ address: registry, abi: ownerAbi, functionName: 'setWriter', args: [signer.address] }),
    });
    const restored = await tick();
    expect(restored.writerOk).toBe(true);
    expect(restored.sent).toBe(1);
  });
});
