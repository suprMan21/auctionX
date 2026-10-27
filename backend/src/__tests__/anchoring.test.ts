/**
 * S-ANCHOR1 Ph1 — ownership anchoring (Base Sepolia). Not an NFT.
 *
 *   - KMS signer: a local secp256k1 key stands in for KMS and answers in KMS's
 *     own formats (SPKI public key, DER signature), so the parsing, low-s and
 *     recovery-bit logic is exercised for real.
 *   - Merkle: roots and paths verify with OpenZeppelin's own verifier.
 *   - Tick: the whole hourly cycle against an in-memory DB and a fake chain.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';
import { secp256k1 } from '@noble/curves/secp256k1';
import {
  keccak256,
  parseTransaction,
  recoverMessageAddress,
  recoverTransactionAddress,
  serializeTransaction,
  stringToHex,
  type Hex,
  type TransactionSerializableEIP1559,
} from 'viem';
import { createKmsSigner, normaliseS, parseDerSignature, spkiToUncompressedPoint, type KmsSignClient } from '../lib/anchoring/kmsSigner';
import { buildDailyTree, verifyInRoot, randomLeaf } from '../lib/anchoring/merkle';
import { readAnchorConfig, type AnchorConfig } from '../lib/anchoring/config';
import { runAnchorTick, backoffMinutes, utcMidnight, type TickDeps } from '../lib/anchoring/anchorTick';
import type { ChainPort, RegistryEvent, AnchorFunction } from '../lib/anchoring/registry';
import type { AnchorAlertKind, AlertDetail } from '../lib/anchoring/alerts';
import { createMockSupabase, type Tables } from './helpers/supabaseMock';
import { anchorRpc, proof } from './helpers/anchorDbFake';
import { spyOnSecurityEvents } from './helpers/securityEvents';

const N = secp256k1.CURVE.n;
const SPKI_PREFIX = Buffer.from('3056301006072a8648ce3d020106052b8104000a034200', 'hex');
const ctx = { requestId: 'req-anchor', actorId: null, actorType: 'system' as const, ip: '127.0.0.1', route: '/api/v1/internal/anchor-tick' };

const id32 = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`;

// ── Fake KMS ────────────────────────────────────────────────────────────────

const fakeKms = (opts: { forceHighS?: boolean } = {}) => {
  const priv = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(priv, false);
  const calls: string[] = [];
  const client: KmsSignClient = {
    send: async (command) => {
      if (command instanceof GetPublicKeyCommand) {
        calls.push('GetPublicKey');
        return { PublicKey: new Uint8Array(Buffer.concat([SPKI_PREFIX, Buffer.from(pub)])) };
      }
      if (command instanceof SignCommand) {
        calls.push('Sign');
        expect(command.input.MessageType).toBe('DIGEST');
        expect(command.input.SigningAlgorithm).toBe('ECDSA_SHA_256');
        const sig = secp256k1.sign(command.input.Message as Uint8Array, priv, { lowS: true });
        const s = opts.forceHighS ? N - sig.s : sig.s;
        return { Signature: new secp256k1.Signature(sig.r, s).toDERRawBytes() };
      }
      throw new Error('unexpected command');
    },
  };
  return { client, calls };
};

describe('KMS signer', () => {
  it('derives the address from the SPKI key and signs a transaction that recovers to it', async () => {
    const { client, calls } = fakeKms();
    const signer = await createKmsSigner('alias/test', ctx, client);

    const tx: TransactionSerializableEIP1559 = {
      type: 'eip1559', chainId: 84532, nonce: 3, to: id32(1).slice(0, 42) as Hex,
      data: '0x1234', gas: 50_000n, maxFeePerGas: 2_000_000n, maxPriorityFeePerGas: 1_000n, value: 0n,
    };
    const raw = await signer.account.signTransaction!(tx);
    expect(await recoverTransactionAddress({ serializedTransaction: raw as never })).toBe(signer.address);
    expect(parseTransaction(raw).nonce).toBe(3);
    expect(calls).toEqual(['GetPublicKey', 'Sign']);
  });

  it('normalises a high-s KMS signature to low-s (EIP-2) and still recovers', async () => {
    const { client } = fakeKms({ forceHighS: true });
    const signer = await createKmsSigner('alias/test', ctx, client);
    const hash = keccak256(stringToHex('anchor'));
    const sig = await signer.signDigest(hash);
    expect(BigInt(sig.s) <= N / 2n).toBe(true);

    const message = await signer.account.signMessage({ message: 'hello' });
    expect(await recoverMessageAddress({ message: 'hello', signature: message })).toBe(signer.address);
  });

  it('emits kms.op events for the anchor writer, with no key material', async () => {
    const spy = spyOnSecurityEvents();
    const { client } = fakeKms();
    const signer = await createKmsSigner('alias/test', ctx, client);
    await signer.signDigest(keccak256('0x01'));
    const ops = spy.named('kms.op');
    expect(ops.map((e) => e.operation)).toEqual(['GetPublicKey', 'Sign']);
    expect(ops.every((e) => e.purpose === 'anchor_writer' && e.result === 'ok')).toBe(true);
    spy.restore();
  });

  it('refuses a digest that is not 32 bytes', async () => {
    const { client } = fakeKms();
    const signer = await createKmsSigner('alias/test', ctx, client);
    await expect(signer.signDigest('0x1234')).rejects.toThrow('digest_must_be_32_bytes');
  });

  it('parses DER strictly', () => {
    const sig = secp256k1.sign(new Uint8Array(32).fill(7), secp256k1.utils.randomPrivateKey());
    const der = sig.toDERRawBytes();
    expect(parseDerSignature(der)).toEqual({ r: sig.r, s: sig.s });
    expect(() => parseDerSignature(new Uint8Array([...der, 0]))).toThrow();
    expect(() => parseDerSignature(new Uint8Array([0x31, ...der.slice(1)]))).toThrow('der_not_sequence');
    expect(normaliseS(N - 5n)).toBe(5n);
    expect(normaliseS(5n)).toBe(5n);
  });

  it('rejects a public key that is not uncompressed secp256k1 SPKI', () => {
    expect(() => spkiToUncompressedPoint(new Uint8Array(91))).toThrow('kms_public_key_unexpected');
  });
});

// ── Merkle ──────────────────────────────────────────────────────────────────

describe('daily Merkle tree', () => {
  it('every Ownership ID verifies against the root with the OpenZeppelin verifier', () => {
    const ids = [1, 2, 3, 4, 5].map(id32);
    const tree = buildDailyTree(ids, randomLeaf());
    for (const id of ids) {
      expect(verifyInRoot(tree.root, id, tree.proofs.get(id)!)).toBe(true);
      expect(verifyInRoot(tree.root, id32(99), tree.proofs.get(id)!)).toBe(false);
    }
  });

  it('a single-event day does not publish anything derivable from that one ID', () => {
    const id = id32(7);
    const a = buildDailyTree([id], randomLeaf());
    const b = buildDailyTree([id], randomLeaf());
    expect(a.root).not.toBe(b.root);
    expect(a.root).not.toBe(id);
  });

  it('a quiet day still has a root (the padding leaf alone)', () => {
    const tree = buildDailyTree([], randomLeaf());
    expect(tree.root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(tree.proofs.size).toBe(0);
  });

  it('refuses duplicates and non-bytes32 values', () => {
    expect(() => buildDailyTree([id32(1), id32(1)], randomLeaf())).toThrow('merkle_duplicate_value');
    expect(() => buildDailyTree(['0x12'], randomLeaf())).toThrow('merkle_value_not_bytes32');
  });
});

// ── Config ──────────────────────────────────────────────────────────────────

describe('anchor config', () => {
  const base = {
    ANCHOR_RPC_URL: 'https://base-sepolia.example',
    ANCHOR_REGISTRY_ADDRESS: '0x' + '1'.repeat(40),
    ANCHOR_REGISTRY_DEPLOY_BLOCK: '100',
    ANCHOR_KMS_KEY_ID: 'alias/am-anchor-writer-staging',
  };
  const withEnv = (vars: Record<string, string | undefined>) => {
    const keys = ['ANCHOR_MODE', 'ANCHOR_CHAIN_ID', ...Object.keys(base)];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, Object.fromEntries(Object.entries(vars).filter(([, v]) => v !== undefined)));
    try { return readAnchorConfig(); } finally {
      for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  };

  it('defaults to daily_batch on Base Sepolia', () => {
    const r = withEnv(base);
    expect(r.ok && r.config.mode).toBe('daily_batch');
    expect(r.ok && r.config.chainId).toBe(84532);
  });

  it('refuses Base mainnet in Ph1', () => {
    const r = withEnv({ ...base, ANCHOR_CHAIN_ID: '8453' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.missing.join(' ')).toContain('mainnet');
  });

  it('lists what is missing instead of guessing', () => {
    const r = withEnv({ ANCHOR_MODE: 'sometimes' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.missing).toEqual(expect.arrayContaining([
      'ANCHOR_MODE', 'ANCHOR_RPC_URL', 'ANCHOR_REGISTRY_ADDRESS', 'ANCHOR_REGISTRY_DEPLOY_BLOCK', 'ANCHOR_KMS_KEY_ID',
    ]));
  });
});

// ── Tick ────────────────────────────────────────────────────────────────────

const REGISTRY = '0x' + 'ab'.repeat(20);
const WRITER = ('0x' + 'cd'.repeat(20)) as Hex;

const config = (over: Partial<AnchorConfig> = {}): AnchorConfig => ({
  mode: 'daily_batch',
  chainId: 84532,
  rpcUrl: 'https://rpc.example',
  registryAddress: REGISTRY as Hex,
  deployBlock: 1000n,
  kmsKeyId: 'alias/test',
  lowBalanceWei: 1_000n,
  confirmations: 3,
  maxSendsPerTick: 10,
  logChunkBlocks: 50n,
  maxLogChunksPerTick: 50,
  ...over,
});

class FakeChain implements ChainPort {
  block = 1000n;
  writer: Hex = WRITER;
  balance = 10n ** 18n;
  events: RegistryEvent[] = [];
  failBroadcast = false;
  failScan = false;
  revertNext = false;
  sent: Array<{ fn: AnchorFunction; value: Hex; hash: Hex }> = [];
  private nonce = 0;
  private signed = new Map<Hex, { fn: AnchorFunction; value: Hex }>();
  private txs = new Map<Hex, { fn: AnchorFunction; value: Hex; minedAt: bigint | null; status: 'success' | 'reverted' }>();

  getBlockNumber = async () => this.block;
  getBlockTimestamp = async (n: bigint) => 1_800_000_000n + n;
  getBalance = async () => this.balance;
  readWriter = async () => this.writer;
  getReceipt = async (hash: Hex) => {
    const tx = this.txs.get(hash);
    return tx?.minedAt != null ? { status: tx.status, blockNumber: tx.minedAt } : null;
  };
  isKnown = async (hash: Hex) => this.txs.has(hash);
  getRegistryEvents = async (from: bigint, to: bigint) => {
    if (this.failScan) throw new Error('rpc_down');
    return this.events.filter((e) => e.blockNumber >= from && e.blockNumber <= to);
  };
  signAnchor = async (fn: AnchorFunction, value: Hex) => {
    const raw = stringToHex(`${fn}:${value}:${this.nonce}`);
    const hash = keccak256(raw);
    this.signed.set(raw, { fn, value });
    return { hash, nonce: this.nonce++, raw };
  };
  broadcast = async (raw: Hex) => {
    if (this.failBroadcast) throw new Error('rpc_rejected');
    const s = this.signed.get(raw)!;
    const hash = keccak256(raw);
    this.txs.set(hash, { ...s, minedAt: null, status: this.revertNext ? 'reverted' : 'success' });
    this.revertNext = false;
    this.sent.push({ ...s, hash });
    return hash;
  };

  /** Mine every pending tx into the next block, then advance `extra` empty blocks. */
  mine(extra = 0n) {
    this.block += 1n;
    let logIndex = 0;
    for (const [hash, tx] of this.txs) {
      if (tx.minedAt !== null) continue;
      tx.minedAt = this.block;
      if (tx.status === 'success') {
        this.events.push({
          kind: tx.fn === 'anchorRoot' ? 'RootAnchored' : 'OwnershipAnchored',
          value: tx.value, txHash: hash, logIndex: logIndex++, blockNumber: this.block,
        });
      }
    }
    this.block += extra;
  }

  /** Lose every unmined tx, as a node does when it drops them. */
  dropPending() {
    for (const [hash, tx] of this.txs) if (tx.minedAt === null) this.txs.delete(hash);
  }
}

describe('anchor tick', () => {
  let tables: Tables;
  let chain: FakeChain;
  let clock: Date;
  let alerts: Array<{ kind: AnchorAlertKind; key: string; detail: AlertDetail }>;

  const tick = (over: Partial<AnchorConfig> = {}, deps: Partial<TickDeps> = {}) =>
    runAnchorTick({
      supabase: createMockSupabase(tables, { rpc: anchorRpc(tables) }) as never,
      chain,
      config: config(over),
      writer: WRITER,
      now: () => clock,
      randomLeaf,
      alert: async (kind, key, detail) => { alerts.push({ kind, key, detail }); },
      ...deps,
    });

  beforeEach(() => {
    tables = {
      anchor_batches: [],
      anchor_chain_state: [],
      ownership_proofs: [
        proof(1, '2026-10-27T03:00:00.000Z'),
        proof(2, '2026-10-27T22:00:00.000Z'),
        proof(3, '2026-10-28T00:30:00.000Z'), // after the cutoff: tomorrow's root
      ],
    };
    chain = new FakeChain();
    clock = new Date('2026-10-28T01:07:00.000Z');
    alerts = [];
  });

  it('closes yesterday (UTC) into one root, files each path, and stores the tx hash before broadcast', async () => {
    const s = await tick();
    expect(s.batchesCreated).toBe(1);
    expect(s.sent).toBe(1);
    expect(s.errors).toEqual([]);

    const [batch] = tables.anchor_batches;
    expect(batch).toMatchObject({ mode: 'daily_batch', batch_day: '2026-10-27', leaf_count: 2, status: 'submitted', attempts: 1 });
    expect(batch.tx_hash).toBe(chain.sent[0].hash);
    expect(chain.sent[0]).toMatchObject({ fn: 'anchorRoot', value: batch.merkle_root });

    for (const p of tables.ownership_proofs.slice(0, 2)) {
      expect(p.anchor_batch_id).toBe(batch.id);
      expect(verifyInRoot(batch.merkle_root as string, p.ownership_id as string, p.merkle_proof as string[])).toBe(true);
    }
    expect(tables.ownership_proofs[2].anchor_batch_id).toBeNull();
    // The padding leaf is random and is not one of the Ownership IDs.
    expect(tables.ownership_proofs.map((p) => p.ownership_id)).not.toContain(batch.padding_leaf);
  });

  it('a second tick the same day makes no second root', async () => {
    await tick();
    const s = await tick();
    expect(s.batchesCreated).toBe(0);
    expect(tables.anchor_batches).toHaveLength(1);
  });

  it('confirms only after enough blocks, then stamps proofs with the block time', async () => {
    await tick();
    chain.mine(0n);
    let s = await tick();
    expect(s.confirmed).toBe(0);

    chain.mine(2n);
    s = await tick();
    expect(s.confirmed).toBe(1);
    const [batch] = tables.anchor_batches;
    expect(batch.status).toBe('confirmed');
    const expectedAt = new Date(Number(1_800_000_000n + 1001n) * 1000).toISOString();
    expect(tables.ownership_proofs[0]).toMatchObject({ anchored_tx_hash: batch.tx_hash, anchored_at: expectedAt });
    expect(tables.ownership_proofs[2].anchored_tx_hash).toBeNull();
  });

  it('publishes a quiet day too', async () => {
    tables.ownership_proofs = [];
    const s = await tick();
    expect(s.sent).toBe(1);
    expect(tables.anchor_batches[0]).toMatchObject({ leaf_count: 0, batch_day: '2026-10-27' });
  });

  it('per_event mode anchors each Ownership ID itself, rate-limited per tick', async () => {
    const s = await tick({ mode: 'per_event', maxSendsPerTick: 2 });
    expect(s.batchesCreated).toBe(2);
    expect(s.sent).toBe(2);
    expect(chain.sent.map((x) => x.fn)).toEqual(['anchor', 'anchor']);
    expect(chain.sent.map((x) => x.value)).toEqual([id32(1), id32(2)]);
    expect(tables.ownership_proofs[0].merkle_proof).toEqual([]);
  });

  it('switching modes keeps earlier batches valid', async () => {
    await tick({ mode: 'per_event', maxSendsPerTick: 1 });
    await tick();
    const modes = tables.anchor_batches.map((b) => b.mode);
    expect(modes).toEqual(['per_event', 'daily_batch']);
    const daily = tables.anchor_batches[1];
    // Proof 1 stays in its per_event batch; proof 2 went into the daily root.
    expect(tables.ownership_proofs[0].anchor_batch_id).toBe('batch-1');
    expect(verifyInRoot(daily.merkle_root as string, id32(2), tables.ownership_proofs[1].merkle_proof as string[])).toBe(true);
  });

  it('pauses sends and alerts when the registry writer is not our key', async () => {
    chain.writer = ('0x' + 'ee'.repeat(20)) as Hex;
    const s = await tick();
    expect(s.writerOk).toBe(false);
    expect(s.sent).toBe(0);
    expect(s.batchesCreated).toBe(1);
    expect(alerts[0].kind).toBe('writer_mismatch');
  });

  it('a failed broadcast backs off, then alerts after repeated failures', async () => {
    chain.failBroadcast = true;
    let s = await tick();
    expect(s.sendFailures).toBe(1);
    const [batch] = tables.anchor_batches;
    expect(batch).toMatchObject({ status: 'pending', attempts: 1 });
    expect(batch.last_error).toContain('broadcast');

    // Not due yet: nothing is retried.
    s = await tick();
    expect(s.sendFailures).toBe(0);

    for (let i = 0; i < 4; i++) {
      clock = new Date(clock.getTime() + backoffMinutes(6) * 60_000);
      await tick();
    }
    expect(batch.attempts).toBe(5);
    expect(alerts.map((a) => a.kind)).toContain('anchor_failing');
  });

  it('a dropped tx goes back to pending and is resent', async () => {
    await tick();
    chain.dropPending();
    clock = new Date(clock.getTime() + 11 * 60_000);
    let s = await tick();
    expect(s.returnedToPending).toBe(1);

    clock = new Date(clock.getTime() + 5 * 60_000);
    s = await tick();
    expect(s.sent).toBe(1);
    expect(chain.sent).toHaveLength(2);
  });

  it('a reverted anchor alerts and is retried', async () => {
    chain.revertNext = true;
    await tick();
    chain.mine(3n);
    const s = await tick();
    expect(s.returnedToPending).toBe(1);
    expect(alerts.map((a) => a.kind)).toContain('anchor_reverted');
  });

  it('reconciliation alerts on a write we did not make, and not on our own', async () => {
    await tick();
    chain.mine(0n);
    chain.events.push({ kind: 'RootAnchored', value: id32(666), txHash: id32(1), logIndex: 0, blockNumber: chain.block });
    chain.events.push({ kind: 'WriterChanged', previousWriter: WRITER, newWriter: ('0x' + '99'.repeat(20)) as Hex, txHash: id32(2), logIndex: 0, blockNumber: chain.block });
    chain.mine(5n);

    const s = await tick();
    expect(s.unmatched).toBe(1);
    const kinds = alerts.map((a) => a.kind);
    expect(kinds).toContain('unmatched_event');
    expect(kinds).toContain('writer_changed');
    expect(alerts.find((a) => a.kind === 'unmatched_event')!.detail.value).toBe(id32(666));
    expect(tables.anchor_chain_state[0].last_scanned_block).toBe(Number(chain.block - 3n));

    // The cursor moved: the same events are not reported again.
    alerts = [];
    await tick();
    expect(alerts.filter((a) => a.kind === 'unmatched_event')).toHaveLength(0);
  });

  it('a root anchored by per_event does not satisfy a RootAnchored event (event kind must match)', async () => {
    await tick({ mode: 'per_event', maxSendsPerTick: 1 });
    chain.mine(0n);
    chain.events.push({ kind: 'RootAnchored', value: id32(1), txHash: id32(3), logIndex: 0, blockNumber: chain.block });
    chain.mine(5n);
    const s = await tick({ mode: 'per_event', maxSendsPerTick: 1 });
    expect(s.unmatched).toBe(1);
  });

  it('alerts once a day on a low writer balance', async () => {
    chain.balance = 10n;
    const s = await tick();
    expect(s.lowBalance).toBe(true);
    expect(alerts.find((a) => a.kind === 'low_balance')!.key).toBe('low_balance:2026-10-28');
  });

  it('one failing step does not stop the others, and the scan cursor does not move', async () => {
    chain.failScan = true;
    chain.block = 1100n;
    const s = await tick();
    expect(s.errors).toEqual(['reconcile:rpc_down']);
    expect(s.sent).toBe(1);
    expect(s.balanceWei).not.toBeNull();
    expect(tables.anchor_chain_state).toHaveLength(0);
  });

  it('cuts the day at 00:00 UTC', () => {
    expect(utcMidnight(new Date('2026-10-28T23:59:59.999Z')).toISOString()).toBe('2026-10-28T00:00:00.000Z');
  });
});

// ── Route ───────────────────────────────────────────────────────────────────

describe('POST /api/v1/internal/anchor-tick', () => {
  const SECRET = 'anchor-secret-'.padEnd(40, 'x');

  const buildApp = async () => {
    vi.resetModules();
    const { default: router } = await import('../routes/anchorTick');
    const app = express();
    app.use(express.json());
    app.use('/api/v1/internal/anchor-tick', router);
    return app;
  };

  beforeEach(() => {
    delete process.env.ANCHOR_TICK_SECRET;
    delete process.env.ANCHOR_REGISTRY_ADDRESS;
  });

  it('fails closed with 503 when the secret is unset or short', async () => {
    let res = await request(await buildApp()).post('/api/v1/internal/anchor-tick').set('x-anchor-secret', 'anything');
    expect(res.status).toBe(503);
    process.env.ANCHOR_TICK_SECRET = 'short';
    res = await request(await buildApp()).post('/api/v1/internal/anchor-tick').set('x-anchor-secret', 'short');
    expect(res.status).toBe(503);
  });

  it('403s a wrong or missing secret, and does not accept the fee-sweep header', async () => {
    process.env.ANCHOR_TICK_SECRET = SECRET;
    const app = await buildApp();
    expect((await request(app).post('/api/v1/internal/anchor-tick')).status).toBe(403);
    expect((await request(app).post('/api/v1/internal/anchor-tick').set('x-anchor-secret', SECRET + 'y')).status).toBe(403);
    expect((await request(app).post('/api/v1/internal/anchor-tick').set('x-sweep-secret', SECRET)).status).toBe(403);
  });

  it('with the right secret but no registry configured, reports what is missing and touches nothing', async () => {
    process.env.ANCHOR_TICK_SECRET = SECRET;
    const res = await request(await buildApp()).post('/api/v1/internal/anchor-tick').set('x-anchor-secret', SECRET);
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(false);
    expect(res.body.data.missing).toContain('ANCHOR_REGISTRY_ADDRESS');
  });
});
