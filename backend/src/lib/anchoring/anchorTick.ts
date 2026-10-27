/**
 * The hourly anchor tick — S-ANCHOR1 Ph1. Not an NFT.
 *
 * Runs from pg_cron (POST /api/v1/internal/anchor-tick). Each step is
 * independent, so one failing (say, the RPC is down for the scan) does not
 * stop the others; failures come back as codes in the summary.
 *
 *   1. Writer check  the registry's writer must be our KMS key, or sends pause.
 *   2. Confirm       submitted batches with enough confirmations are stamped
 *                    on their proofs; reverted or dropped ones go back to pending.
 *   3. Batch         daily_batch: once yesterday (UTC) closes, every unbatched
 *                    proof created before 00:00 UTC goes into one root with a
 *                    random padding leaf, even when there are none.
 *                    per_event: each unbatched proof becomes a batch of one.
 *   4. Send          due pending batches, at most maxSendsPerTick. The tx hash
 *                    is stored before the tx is broadcast.
 *   5. Reconcile     every registry event since the last scan must match a
 *                    batch we made; anything else alerts (forged-write check).
 *   6. Balance       alert when the writer wallet is below the float.
 *
 * Anchoring is async and never blocks a claim or a transfer: nothing in the
 * ownership path waits for it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Hex } from 'viem';
import { log } from '../logger';
import type { AnchorConfig } from './config';
import { buildDailyTree } from './merkle';
import type { ChainPort, RegistryEvent } from './registry';
import { raiseAnchorAlert, type AnchorAlertKind, type AlertDetail } from './alerts';

const DROPPED_AFTER_MS = 10 * 60_000;
const STUCK_AFTER_MS = 60 * 60_000;
const FAILING_AFTER_ATTEMPTS = 5;
const MAX_BACKOFF_MINUTES = 360;
const MAX_PROOFS_PER_ROOT = 10_000;

export interface TickDeps {
  readonly supabase: SupabaseClient;
  readonly chain: ChainPort;
  readonly config: AnchorConfig;
  readonly writer: Hex;
  readonly now: () => Date;
  readonly randomLeaf: () => Hex;
  readonly alert?: (kind: AnchorAlertKind, key: string, detail: AlertDetail) => Promise<void>;
}

export interface TickSummary {
  mode: AnchorConfig['mode'];
  writer: string;
  writerOk: boolean | null;
  confirmed: number;
  returnedToPending: number;
  batchesCreated: number;
  sent: number;
  sendFailures: number;
  scannedTo: string | null;
  eventsScanned: number;
  unmatched: number;
  balanceWei: string | null;
  lowBalance: boolean;
  errors: string[];
}

interface BatchRow {
  id: string;
  mode: 'daily_batch' | 'per_event';
  merkle_root: string;
  status: 'pending' | 'submitted' | 'confirmed';
  tx_hash: string | null;
  attempts: number;
  submitted_at: string | null;
}

const BATCH_COLUMNS = 'id, mode, merkle_root, status, tx_hash, attempts, submitted_at';

export const backoffMinutes = (attempts: number): number =>
  Math.min(2 ** Math.max(0, attempts), MAX_BACKOFF_MINUTES);

/** 00:00 UTC of the given instant. */
export const utcMidnight = (at: Date): Date =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

const errCode = (err: unknown): string =>
  err instanceof Error ? err.message.replace(/[^\w:.-]/g, '_').slice(0, 60) : 'unknown';

export const runAnchorTick = async (deps: TickDeps): Promise<TickSummary> => {
  const { supabase, chain, config, writer, now } = deps;
  const registry = config.registryAddress.toLowerCase();
  const alert = deps.alert ?? ((kind, key, detail) => raiseAnchorAlert(supabase, kind, key, detail));

  const summary: TickSummary = {
    mode: config.mode,
    writer,
    writerOk: null,
    confirmed: 0,
    returnedToPending: 0,
    batchesCreated: 0,
    sent: 0,
    sendFailures: 0,
    scannedTo: null,
    eventsScanned: 0,
    unmatched: 0,
    balanceWei: null,
    lowBalance: false,
    errors: [],
  };

  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      summary.errors.push(`${name}:${errCode(err)}`);
      log.error('anchor_tick_step_failed', { step: name, error: errCode(err) });
    }
  };

  const batches = () =>
    supabase.from('anchor_batches').select(BATCH_COLUMNS)
      .eq('chain_id', config.chainId).eq('registry_address', registry);

  const backToPending = async (row: BatchRow, reason: string) => {
    const next = new Date(now().getTime() + backoffMinutes(row.attempts) * 60_000);
    const { data, error } = await supabase.from('anchor_batches')
      .update({ status: 'pending', last_error: reason, next_attempt_at: next.toISOString() })
      .eq('id', row.id).eq('status', 'submitted').eq('tx_hash', row.tx_hash as string)
      .select('id').maybeSingle();
    if (error) throw new Error('batch_requeue_failed');
    if (data) summary.returnedToPending++;
  };

  // 1. Writer check ──────────────────────────────────────────────────────────
  await step('writer', async () => {
    const onChain = await chain.readWriter();
    summary.writerOk = onChain.toLowerCase() === writer.toLowerCase();
    if (!summary.writerOk) {
      await alert('writer_mismatch', `writer_mismatch:${onChain.toLowerCase()}`, {
        registry, onChainWriter: onChain.toLowerCase(), kmsWriter: writer.toLowerCase(),
      });
    }
  });

  // 2. Confirm ───────────────────────────────────────────────────────────────
  await step('confirm', async () => {
    const { data, error } = await batches().eq('status', 'submitted').order('created_at');
    if (error) throw new Error('submitted_read_failed');
    const rows = (data ?? []) as BatchRow[];
    if (rows.length === 0) return;

    const latest = await chain.getBlockNumber();
    for (const row of rows) {
      const hash = row.tx_hash as Hex;
      const receipt = await chain.getReceipt(hash);

      if (receipt?.status === 'reverted') {
        await alert('anchor_reverted', `reverted:${hash}`, { batchId: row.id, txHash: hash, block: receipt.blockNumber.toString() });
        await backToPending(row, 'reverted');
        continue;
      }

      if (receipt) {
        if (latest - receipt.blockNumber + 1n < BigInt(config.confirmations)) continue;
        const ts = await chain.getBlockTimestamp(receipt.blockNumber);
        const { data: ok, error: rpcError } = await supabase.rpc('confirm_anchor_batch', {
          p_batch_id: row.id,
          p_tx_hash: hash,
          p_block_number: Number(receipt.blockNumber),
          p_anchored_at: new Date(Number(ts) * 1000).toISOString(),
        });
        if (rpcError) throw new Error('confirm_rpc_failed');
        if (ok === true) summary.confirmed++;
        continue;
      }

      const age = now().getTime() - Date.parse(row.submitted_at ?? '');
      if (!(await chain.isKnown(hash))) {
        if (age > DROPPED_AFTER_MS) await backToPending(row, 'dropped');
      } else if (age > STUCK_AFTER_MS) {
        await alert('anchor_stuck', `stuck:${hash}`, { batchId: row.id, txHash: hash });
      }
    }
  });

  // 3. Batch ─────────────────────────────────────────────────────────────────
  await step('batch', async () => {
    const leafFor = (p: { id: string; ownership_id: string }, merkleProof: readonly string[]) =>
      ({ proof_id: p.id, ownership_id: p.ownership_id, merkle_proof: merkleProof });

    if (config.mode === 'daily_batch') {
      const cutoff = utcMidnight(now());
      const day = isoDay(new Date(cutoff.getTime() - 86_400_000));

      const { data: existing, error: existingError } = await batches()
        .eq('mode', 'daily_batch').eq('batch_day', day).maybeSingle();
      if (existingError) throw new Error('daily_read_failed');
      if (existing) return;

      const { data: proofs, error: proofsError } = await supabase.from('ownership_proofs')
        .select('id, ownership_id')
        .is('anchor_batch_id', null)
        .lt('created_at', cutoff.toISOString())
        .order('created_at')
        .limit(MAX_PROOFS_PER_ROOT);
      if (proofsError) throw new Error('unbatched_read_failed');
      const rows = (proofs ?? []) as Array<{ id: string; ownership_id: string }>;
      if (rows.length === MAX_PROOFS_PER_ROOT) log.warn('anchor_root_capped', { day, cap: MAX_PROOFS_PER_ROOT });

      const padding = deps.randomLeaf();
      const tree = buildDailyTree(rows.map((r) => r.ownership_id), padding);
      const { data: created, error: rpcError } = await supabase.rpc('record_anchor_batch', {
        p_mode: 'daily_batch',
        p_batch_day: day,
        p_cutoff_at: cutoff.toISOString(),
        p_merkle_root: tree.root,
        p_padding_leaf: padding,
        p_chain_id: config.chainId,
        p_registry_address: registry,
        p_leaves: rows.map((r) => leafFor(r, tree.proofs.get(r.ownership_id) ?? [])),
      });
      if (rpcError) throw new Error(rpcError.message === 'anchor_batch_conflict' ? 'batch_conflict' : 'record_batch_failed');
      const first = (Array.isArray(created) ? created[0] : created) as { created?: boolean } | undefined;
      if (first?.created) summary.batchesCreated++;
      return;
    }

    const cutoff = now();
    const { data: proofs, error: proofsError } = await supabase.from('ownership_proofs')
      .select('id, ownership_id')
      .is('anchor_batch_id', null)
      .lt('created_at', cutoff.toISOString())
      .order('created_at')
      .limit(config.maxSendsPerTick);
    if (proofsError) throw new Error('unbatched_read_failed');

    for (const p of (proofs ?? []) as Array<{ id: string; ownership_id: string }>) {
      const { error: rpcError } = await supabase.rpc('record_anchor_batch', {
        p_mode: 'per_event',
        p_batch_day: null,
        p_cutoff_at: cutoff.toISOString(),
        p_merkle_root: p.ownership_id,
        p_padding_leaf: null,
        p_chain_id: config.chainId,
        p_registry_address: registry,
        p_leaves: [leafFor(p, [])],
      });
      if (rpcError) throw new Error('record_batch_failed');
      summary.batchesCreated++;
    }
  });

  // 4. Send ──────────────────────────────────────────────────────────────────
  await step('send', async () => {
    if (summary.writerOk !== true) return;

    const { data, error } = await batches()
      .eq('status', 'pending')
      .lte('next_attempt_at', now().toISOString())
      .order('created_at')
      .limit(config.maxSendsPerTick);
    if (error) throw new Error('pending_read_failed');

    for (const row of (data ?? []) as BatchRow[]) {
      const attempts = row.attempts + 1;
      const fail = async (reason: string) => {
        summary.sendFailures++;
        const next = new Date(now().getTime() + backoffMinutes(attempts) * 60_000);
        await supabase.from('anchor_batches')
          .update({ status: 'pending', attempts, last_error: reason, next_attempt_at: next.toISOString() })
          .eq('id', row.id);
        if (attempts >= FAILING_AFTER_ATTEMPTS) {
          await alert('anchor_failing', `failing:${row.id}`, { batchId: row.id, attempts, lastError: reason });
        }
      };

      let signed;
      try {
        signed = await chain.signAnchor(row.mode === 'daily_batch' ? 'anchorRoot' : 'anchor', row.merkle_root as Hex);
      } catch (err) {
        await fail(`sign:${errCode(err)}`);
        continue;
      }

      // Record before broadcast. If this conditional write does not land
      // (another tick took the batch), the signed tx is simply discarded.
      const { data: claimed, error: claimError } = await supabase.from('anchor_batches')
        .update({
          status: 'submitted', tx_hash: signed.hash, tx_nonce: signed.nonce,
          submitted_at: now().toISOString(), attempts, last_error: null,
        })
        .eq('id', row.id).eq('status', 'pending')
        .select('id').maybeSingle();
      if (claimError) throw new Error('batch_claim_failed');
      if (!claimed) continue;

      try {
        await chain.broadcast(signed.raw);
        summary.sent++;
      } catch (err) {
        await fail(`broadcast:${errCode(err)}`);
      }
    }
  });

  // 5. Reconcile ─────────────────────────────────────────────────────────────
  await step('reconcile', async () => {
    const { data: state, error } = await supabase.from('anchor_chain_state')
      .select('last_scanned_block')
      .eq('chain_id', config.chainId).eq('registry_address', registry)
      .maybeSingle();
    if (error) throw new Error('state_read_failed');

    let from = state ? BigInt((state as { last_scanned_block: number }).last_scanned_block) + 1n : config.deployBlock;
    const safeTo = (await chain.getBlockNumber()) - BigInt(config.confirmations);

    for (let chunk = 0; chunk < config.maxLogChunksPerTick && from <= safeTo; chunk++) {
      const to = from + config.logChunkBlocks - 1n < safeTo ? from + config.logChunkBlocks - 1n : safeTo;
      const events = await chain.getRegistryEvents(from, to);
      summary.eventsScanned += events.length;
      await checkEvents(events);

      const { error: saveError } = await supabase.from('anchor_chain_state').upsert({
        chain_id: config.chainId,
        registry_address: registry,
        last_scanned_block: Number(to),
        updated_at: now().toISOString(),
      }, { onConflict: 'chain_id,registry_address' });
      if (saveError) throw new Error('state_write_failed');
      summary.scannedTo = to.toString();
      from = to + 1n;
    }
  });

  async function checkEvents(events: RegistryEvent[]): Promise<void> {
    const writes = events.filter((e): e is Extract<RegistryEvent, { value: Hex }> => e.kind !== 'WriterChanged');
    const values = [...new Set(writes.map((e) => e.value.toLowerCase()))];
    const known = new Set<string>();

    if (values.length > 0) {
      const { data, error } = await batches().in('merkle_root', values);
      if (error) throw new Error('reconcile_read_failed');
      for (const b of (data ?? []) as BatchRow[]) known.add(`${b.mode}:${b.merkle_root}`);
    }

    for (const e of events) {
      const detail = { txHash: e.txHash, logIndex: e.logIndex, block: e.blockNumber.toString() };
      if (e.kind === 'WriterChanged') {
        if (e.newWriter.toLowerCase() !== writer.toLowerCase()) {
          await alert('writer_changed', `writer_changed:${e.txHash}:${e.logIndex}`, {
            ...detail, previousWriter: e.previousWriter.toLowerCase(), newWriter: e.newWriter.toLowerCase(),
          });
        }
        continue;
      }
      const mode = e.kind === 'RootAnchored' ? 'daily_batch' : 'per_event';
      if (!known.has(`${mode}:${e.value.toLowerCase()}`)) {
        summary.unmatched++;
        await alert('unmatched_event', `unmatched:${e.txHash}:${e.logIndex}`, { ...detail, event: e.kind, value: e.value.toLowerCase() });
      }
    }
  }

  // 6. Balance ───────────────────────────────────────────────────────────────
  await step('balance', async () => {
    const balance = await chain.getBalance(writer);
    summary.balanceWei = balance.toString();
    summary.lowBalance = balance < config.lowBalanceWei;
    if (summary.lowBalance) {
      await alert('low_balance', `low_balance:${isoDay(now())}`, {
        writer: writer.toLowerCase(), balanceWei: balance.toString(), floorWei: config.lowBalanceWei.toString(),
      });
    }
  });

  log.info('anchor_tick', { ...summary, errors: summary.errors.join(',') });
  return summary;
};
