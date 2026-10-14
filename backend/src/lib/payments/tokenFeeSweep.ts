/**
 * Token-fee reconciliation sweep — S-ADMIN1 Ph3a.
 *
 * Asks Stripe which token-fee PaymentIntents succeeded recently and checks each
 * against the row it pays for. A paid fee whose row has not moved is applied
 * here (the webhook never arrived) or, if it cannot be applied, recorded as a
 * stuck-payment incident with a GitHub Issue.
 *
 * Stripe is the starting point on purpose. Starting from our own rows would
 * miss exactly the cases that matter: an intent whose id was never stored, or
 * one that names a row that is gone.
 *
 * Runs every 10 minutes from pg_cron (POST /api/v1/internal/token-fee-sweep)
 * and on demand from the admin queue. Safe to run concurrently and repeatedly:
 * applying is one conditional database transaction.
 */

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '../logger';
import { emitSecurityEvent } from '../security/securityEvent';
import type { SecurityLogContext } from '../ownership/ownershipProof';
import { notifyReissueOwner } from '../notifications/reissueEmails';
import { applyFee, readFeeIntent, type FeeIntent } from './tokenFeeApply';
import { noteIncidentClosed, reasonForOutcome, reportStuckPayment } from './paymentIncidents';

const DEFAULT_LOOKBACK_HOURS = 72; // Stripe retries a webhook for up to 3 days.
const DEFAULT_STUCK_AFTER_MINUTES = 5; // Leave an in-flight webhook alone.
const MAX_INTENTS = 1000;

export interface SweepSummary {
  /** PaymentIntents Stripe returned for the window. */
  scanned: number;
  /** Of those, succeeded token fees old enough to judge. */
  checked: number;
  /** Already applied: nothing to do. */
  settled: number;
  /** Applied by this sweep (a webhook that never arrived). */
  applied: number;
  /** Could not be applied: now in the stuck-payment queue. */
  stuck: number;
  skippedRecent: number;
  skippedRefunded: number;
  /** True when the window held more than MAX_INTENTS and was cut short. */
  truncated: boolean;
}

const readPositiveInt = (name: string, fallback: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Seconds since epoch at which the money was taken (the charge, not the intent). */
const paidAtSeconds = (intent: Stripe.PaymentIntent): number => {
  const charge = intent.latest_charge;
  return charge && typeof charge === 'object' && typeof charge.created === 'number'
    ? charge.created
    : intent.created;
};

export const isRefunded = (intent: Stripe.PaymentIntent): boolean => {
  const charge = intent.latest_charge;
  if (!charge || typeof charge !== 'object') return false;
  return charge.refunded === true || (charge.amount_refunded ?? 0) > 0;
};

/** Ids whose row is already where a paid fee should have put it. */
const settledIds = async (supabase: SupabaseClient, fees: FeeIntent[]): Promise<Set<string>> => {
  const settled = new Set<string>();
  const transferIds = fees.flatMap((f) => (f.transferId ? [f.transferId] : []));
  const reissueIds = fees.flatMap((f) => (f.reissueRequestId ? [f.reissueRequestId] : []));

  if (transferIds.length > 0) {
    const { data, error } = await supabase
      .from('ownership_transfers')
      .select('id, status, stripe_payment_intent_id')
      .in('id', transferIds);
    if (error) throw new Error('sweep_transfer_read_failed');
    for (const row of (data ?? []) as Array<{ id: string; status: string | null; stripe_payment_intent_id: string | null }>) {
      // Settled only for the intent the row is bound to. A second paid intent
      // naming a completed transfer is stranded money, not a replay.
      if (row.status === 'COMPLETED' && row.stripe_payment_intent_id) settled.add(`${row.id}:${row.stripe_payment_intent_id}`);
    }
  }

  if (reissueIds.length > 0) {
    const { data, error } = await supabase
      .from('reissue_requests')
      .select('id, payment_status, stripe_payment_intent_id')
      .in('id', reissueIds);
    if (error) throw new Error('sweep_reissue_read_failed');
    for (const row of (data ?? []) as Array<{ id: string; payment_status: string | null; stripe_payment_intent_id: string | null }>) {
      if (row.payment_status === 'PAID' && row.stripe_payment_intent_id) settled.add(`${row.id}:${row.stripe_payment_intent_id}`);
    }
  }

  return settled;
};

const targetKey = (fee: FeeIntent): string => `${fee.transferId ?? fee.reissueRequestId}:${fee.intentId}`;

export const runTokenFeeSweep = async (
  supabase: SupabaseClient,
  stripe: Stripe,
  ctx: SecurityLogContext,
  now: Date = new Date(),
): Promise<SweepSummary> => {
  const lookbackHours = readPositiveInt('TOKEN_FEE_SWEEP_LOOKBACK_HOURS', DEFAULT_LOOKBACK_HOURS);
  const stuckAfterMinutes = readPositiveInt('TOKEN_FEE_STUCK_AFTER_MINUTES', DEFAULT_STUCK_AFTER_MINUTES);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const since = nowSeconds - lookbackHours * 3600;
  const judgeBefore = nowSeconds - stuckAfterMinutes * 60;

  const summary: SweepSummary = {
    scanned: 0, checked: 0, settled: 0, applied: 0, stuck: 0,
    skippedRecent: 0, skippedRefunded: 0, truncated: false,
  };

  const fees: FeeIntent[] = [];
  for await (const intent of stripe.paymentIntents.list({
    created: { gte: since },
    limit: 100,
    expand: ['data.latest_charge'],
  })) {
    if (summary.scanned >= MAX_INTENTS) {
      summary.truncated = true;
      break;
    }
    summary.scanned += 1;

    if (intent.status !== 'succeeded') continue;
    const fee = readFeeIntent(intent);
    if (!fee) continue;
    if (isRefunded(intent)) {
      summary.skippedRefunded += 1;
      continue;
    }
    if (paidAtSeconds(intent) > judgeBefore) {
      summary.skippedRecent += 1;
      continue;
    }
    fees.push(fee);
  }

  summary.checked = fees.length;
  if (fees.length === 0) return summary;

  const settled = await settledIds(supabase, fees);

  for (const fee of fees) {
    if (settled.has(targetKey(fee))) {
      summary.settled += 1;
      continue;
    }

    const result = await applyFee(supabase, fee, 'sweep', ctx);

    emitSecurityEvent({
      event: 'payment.reconcile',
      source: 'sweep',
      fee_kind: fee.kind,
      transfer_id: fee.transferId,
      reissue_request_id: fee.reissueRequestId,
      outcome: result.outcome,
      result: result.outcome === 'failed' ? 'internal' : 'ok',
      request_id: ctx.requestId,
      actor_id: ctx.actorId,
      actor_type: ctx.actorType,
      ip: ctx.ip,
      route: ctx.route,
    });

    if (result.outcome === 'applied') {
      summary.applied += 1;
      // Applied, so nothing is owed. But a webhook that never arrived is a
      // fault someone should look at: record it closed and open the ticket.
      const incident = await reportStuckPayment(supabase, fee, 'webhook_missed', {
        requestId: ctx.requestId,
        resolvedAs: 'sweep',
      });
      // An incident the webhook had already opened was closed by this apply.
      if (incident && !incident.is_new) await noteIncidentClosed(supabase, incident.id, 'sweep');

      if (fee.kind === 'reissue_fee' && fee.reissueRequestId && result.requesterId) {
        await notifyReissueOwner(supabase, 'paid', {
          id: fee.reissueRequestId,
          requesterId: result.requesterId,
          chargedAmount: result.chargedAmount ?? null,
        });
      }
      continue;
    }

    const reason = reasonForOutcome(result.outcome);
    if (!reason) {
      // already_completed / already_paid: someone else applied it just now.
      summary.settled += 1;
      continue;
    }

    summary.stuck += 1;
    await reportStuckPayment(supabase, fee, reason, { requestId: ctx.requestId, errorCode: result.errorCode });
  }

  log.info('token_fee_sweep_done', { ...summary });
  return summary;
};
