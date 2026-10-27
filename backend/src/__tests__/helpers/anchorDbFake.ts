/**
 * S-ANCHOR1: in-memory versions of record_anchor_batch and confirm_anchor_batch
 * (20261027000004), same rules, for the mock Supabase `rpc` hook. The real
 * functions are covered by supabase/tests/s_anchor1_live.sql.
 */

import type { Hex } from 'viem';
import type { Row, Tables } from './supabaseMock';

export const id32 = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`;

/** In-memory versions of the migration's functions, same rules. */
export const anchorRpc = (tables: Tables) => (fn: string, args: Row) => {
  if (fn === 'record_anchor_batch') {
    const leaves = args.p_leaves as Array<{ proof_id: string; ownership_id: string; merkle_proof: string[] }>;
    if (args.p_mode === 'daily_batch') {
      const existing = tables.anchor_batches.find((b) => b.mode === 'daily_batch' && b.batch_day === args.p_batch_day
        && b.chain_id === args.p_chain_id && b.registry_address === args.p_registry_address);
      if (existing) return { data: [{ batch_id: existing.id, created: false }], error: null };
    }
    const ok = leaves.every((l) => tables.ownership_proofs.some((p) => p.id === l.proof_id && p.ownership_id === l.ownership_id
      && p.anchor_batch_id == null && (p.created_at as string) < (args.p_cutoff_at as string)));
    if (!ok) return { data: null, error: { message: 'anchor_batch_conflict' } };
    const id = `batch-${tables.anchor_batches.length + 1}`;
    tables.anchor_batches.push({
      id, mode: args.p_mode, batch_day: args.p_batch_day, cutoff_at: args.p_cutoff_at, merkle_root: args.p_merkle_root,
      padding_leaf: args.p_padding_leaf, leaf_count: leaves.length, chain_id: args.p_chain_id,
      registry_address: args.p_registry_address, status: 'pending', tx_hash: null, tx_nonce: null, attempts: 0,
      next_attempt_at: '1970-01-01T00:00:00.000Z', last_error: null, submitted_at: null, block_number: null,
      anchored_at: null, created_at: new Date(tables.anchor_batches.length).toISOString(),
    });
    for (const l of leaves) {
      Object.assign(tables.ownership_proofs.find((p) => p.id === l.proof_id)!, { anchor_batch_id: id, merkle_proof: l.merkle_proof });
    }
    return { data: [{ batch_id: id, created: true }], error: null };
  }
  if (fn === 'confirm_anchor_batch') {
    const b = tables.anchor_batches.find((r) => r.id === args.p_batch_id && r.status === 'submitted' && r.tx_hash === args.p_tx_hash);
    if (!b) return { data: false, error: null };
    Object.assign(b, { status: 'confirmed', block_number: args.p_block_number, anchored_at: args.p_anchored_at });
    for (const p of tables.ownership_proofs.filter((r) => r.anchor_batch_id === b.id)) {
      Object.assign(p, { anchored_tx_hash: args.p_tx_hash, anchored_at: args.p_anchored_at });
    }
    return { data: true, error: null };
  }
  throw new Error(`unexpected rpc ${fn}`);
};

export const proof = (n: number, createdAt: string): Row => ({
  id: `proof-${n}`, ownership_id: id32(n), created_at: createdAt,
  anchor_batch_id: null, merkle_proof: null, anchored_tx_hash: null, anchored_at: null,
});

