/**
 * POST /api/v1/webhooks/stripe-token-fees — S-NFC3.
 *
 * The normal way a transfer reaches `COMPLETED`. The apply itself lives in
 * lib/payments/tokenFeeApply.ts, shared with the reconciliation sweep and the
 * admin Re-apply (S-ADMIN1 Ph3a), so all three follow one set of rules.
 *
 * Mounted with `express.raw({ type: 'application/json' })` BEFORE the global
 * `express.json()` parser (see the `raw: true` mount in app.ts): signature
 * verification needs the unparsed bytes, and a parsed-then-restringified body
 * will not verify.
 *
 * Its signing secret is `STRIPE_TOKEN_FEE_WEBHOOK_SECRET`, deliberately
 * SEPARATE from both `STRIPE_WEBHOOK_SECRET` (parked marketplace payments) and
 * `STRIPE_CONNECT_WEBHOOK_SECRET` (parked Connect). Sharing a secret across
 * endpoints means a leak of one is a forged event on all of them, and it would
 * let a parked-marketplace event be replayed at the token platform.
 *
 * Completion happens ONLY on `payment_intent.succeeded`. Nothing a client sends
 * can advance a transfer — that is the point of the two-sided design, and
 * `transfer.state_change` with `to = COMPLETED` and a trigger other than
 * `webhook | sweep | reapply` is a Critical detection in S-SEC0 precisely so a
 * regression here is visible.
 *
 * A paid event that cannot be applied is never dropped silently: it becomes a
 * `payment_incidents` row (the admin stuck-payment queue) and a GitHub Issue.
 * Where a retry could help (no recipient yet, a fault while applying) the
 * answer is 500 so Stripe redelivers; where it cannot (cancelled underneath,
 * wrong intent, no such row) it is 200 and the queue is the only way out.
 */

import { Router, Request, Response } from 'express';
import type Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '../lib/stripe';
import { log } from '../lib/logger';
import { emitSecurityEvent } from '../lib/security/securityEvent';
import { securityContext } from '../lib/security/requestContext';
import type { SecurityLogContext } from '../lib/ownership/ownershipProof';
import { notifyReissueOwner } from '../lib/notifications/reissueEmails';
import { applyReissueFee, applyTransferFee, readFeeIntent, type FeeIntent } from '../lib/payments/tokenFeeApply';
import { reasonForOutcome, reportStuckPayment } from '../lib/payments/paymentIncidents';

const router = Router();
const ROUTE = '/api/v1/webhooks/stripe-token-fees';

const getServiceClient = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

router.post('/', async (req: Request, res: Response) => {
  const ctx: SecurityLogContext = securityContext(req, ROUTE, 'system');

  const signature = req.headers['stripe-signature'] as string | undefined;
  const webhookSecret = process.env.STRIPE_TOKEN_FEE_WEBHOOK_SECRET;

  const emitWebhook = (params: {
    eventType: string;
    signatureValid: boolean;
    transferId: string | null;
    reissueRequestId?: string | null;
    idempotentReplay: boolean;
    result: 'ok' | 'forbidden' | 'not_found' | 'conflict' | 'internal';
  }) =>
    emitSecurityEvent({
      event: 'payment.webhook',
      stripe_event_type: params.eventType.slice(0, 64),
      signature_valid: params.signatureValid,
      transfer_id: params.transferId,
      ...(params.reissueRequestId !== undefined ? { reissue_request_id: params.reissueRequestId } : {}),
      idempotent_replay: params.idempotentReplay,
      result: params.result,
      request_id: ctx.requestId,
      actor_id: null,
      actor_type: 'system',
      ip: ctx.ip,
      route: ROUTE,
    });

  if (!signature || !webhookSecret) {
    emitWebhook({
      eventType: 'unknown', signatureValid: false, transferId: null,
      idempotentReplay: false, result: 'forbidden',
    });
    log.error('token_fee_webhook_missing_secret_or_signature', {
      hasSignature: !!signature,
      hasSecret: !!webhookSecret,
    });
    return res.status(400).json({ received: false, error: 'Missing signature or secret' });
  }

  const stripe = getStripe();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(req.body, signature, webhookSecret);
  } catch (err) {
    emitWebhook({
      eventType: 'unknown', signatureValid: false, transferId: null,
      idempotentReplay: false, result: 'forbidden',
    });
    log.error('token_fee_webhook_signature_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(400).json({ received: false, error: 'Invalid signature' });
  }

  // Only `succeeded` completes. Every other event type is acknowledged and
  // ignored, so Stripe stops retrying without anything advancing.
  if (event.type !== 'payment_intent.succeeded') {
    emitWebhook({
      eventType: event.type, signatureValid: true, transferId: null,
      idempotentReplay: false, result: 'ok',
    });
    return res.status(200).json({ received: true, applied: false });
  }

  const intent = event.data.object as Stripe.PaymentIntent;
  const fee = readFeeIntent(intent);

  // A PaymentIntent from any other flow (or one naming no row) touches nothing.
  if (!fee) {
    emitWebhook({
      eventType: event.type, signatureValid: true, transferId: null,
      idempotentReplay: false, result: 'not_found',
    });
    return res.status(200).json({ received: true, applied: false });
  }

  const supabase = getServiceClient();

  // S-ADMIN1 Ph2: a re-issue fee only ever marks its request PAID. It never
  // touches a transfer, and a transfer intent never reaches this branch.
  if (fee.kind === 'reissue_fee') {
    return handleReissueFee(event.type, fee, supabase, ctx, emitWebhook, res);
  }

  const transferId = fee.transferId;
  const emit = (result: 'ok' | 'forbidden' | 'not_found' | 'conflict' | 'internal', idempotentReplay = false) =>
    emitWebhook({ eventType: event.type, signatureValid: true, transferId, idempotentReplay, result });

  const applied = await applyTransferFee(supabase, fee, 'webhook', ctx);

  // Paid, and nothing moved: put it in front of a person.
  const reason = reasonForOutcome(applied.outcome);
  if (reason) {
    await reportStuckPayment(supabase, fee, reason, { requestId: ctx.requestId, errorCode: applied.errorCode });
  }

  switch (applied.outcome) {
    case 'applied':
      emit('ok');
      return res.status(200).json({ received: true, applied: true });

    // Stripe delivers at-least-once. A redelivery of an already-applied event
    // is normal, not an error — recorded as a replay and acknowledged.
    case 'already_completed':
      emit('ok', true);
      return res.status(200).json({ received: true, applied: false, reason: 'already_completed' });

    case 'not_found':
      emit('not_found');
      return res.status(200).json({ received: true, applied: false });

    // A succeeded intent from elsewhere cannot complete someone else's transfer.
    case 'intent_mismatch':
      emit('forbidden');
      log.error('token_fee_webhook_intent_mismatch', { transferId });
      return res.status(200).json({ received: true, applied: false });

    // Cancelled (or its chip retired) while the payment was in flight. A retry
    // cannot change that; the queue offers the refund.
    case 'not_payable':
      emit('conflict');
      log.error('token_fee_paid_but_not_payable', { transferId });
      return res.status(200).json({ received: true, applied: false });

    // The fee is PAID but ownership has nowhere to go. Acknowledging with 200
    // would drop the event for good and strand the payment (2026-10-03). 500
    // makes Stripe retry with backoff for up to 3 days, so the transfer
    // applies by itself once the recipient is resolved.
    case 'no_recipient':
      emit('internal');
      log.error('token_fee_webhook_no_recipient', { transferId });
      return res.status(500).json({ received: true, applied: false });

    // 500 so Stripe retries (with backoff, for up to 3 days). Safe: the apply
    // is one transaction, so a retry either applies it whole or finds it
    // already completed. The common failure is a config fault (e.g. a missing
    // salt key) raised BEFORE any write; acknowledging it with a 200 would
    // strand a paid transfer at PENDING with no retry.
    default:
      emit('internal');
      log.error('token_fee_webhook_apply_failed', { transferId, errorCode: applied.errorCode ?? 'unknown' });
      return res.status(500).json({ received: true, applied: false });
  }
});

type WebhookResult = 'ok' | 'forbidden' | 'not_found' | 'conflict' | 'internal';

type EmitWebhook = (params: {
  eventType: string;
  signatureValid: boolean;
  transferId: string | null;
  reissueRequestId?: string | null;
  idempotentReplay: boolean;
  result: WebhookResult;
}) => void;

/**
 * `payment_intent.succeeded` for `kind=token_reissue_fee`: AWAITING_PAYMENT ->
 * PAID. Nothing else. The chip swap is a separate admin step (Fulfil), so this
 * never mints a proof or moves a token.
 *
 * Same rules as the transfer branch: bound to the PaymentIntent the request
 * stored, conditional on the prior state (replays are 200), and 500 on an
 * unexpected failure so Stripe retries a PAID event we could not apply.
 */
async function handleReissueFee(
  eventType: string,
  fee: FeeIntent,
  supabase: ReturnType<typeof getServiceClient>,
  ctx: SecurityLogContext,
  emitWebhook: EmitWebhook,
  res: Response,
) {
  const reissueRequestId = fee.reissueRequestId;
  const emit = (result: WebhookResult, idempotentReplay = false) =>
    emitWebhook({
      eventType, signatureValid: true, transferId: null, reissueRequestId, idempotentReplay, result,
    });

  const applied = await applyReissueFee(supabase, fee, 'webhook');

  const reason = reasonForOutcome(applied.outcome);
  if (reason) {
    await reportStuckPayment(supabase, fee, reason, { requestId: ctx.requestId, errorCode: applied.errorCode });
  }

  switch (applied.outcome) {
    case 'applied':
      emit('ok');
      // Never blocks the acknowledgement.
      if (reissueRequestId && applied.requesterId) {
        await notifyReissueOwner(supabase, 'paid', {
          id: reissueRequestId,
          requesterId: applied.requesterId,
          chargedAmount: applied.chargedAmount ?? null,
        });
      }
      return res.status(200).json({ received: true, applied: true });

    case 'already_paid':
      emit('ok', true);
      return res.status(200).json({ received: true, applied: false, reason: 'already_paid' });

    case 'not_found':
      emit('not_found');
      return res.status(200).json({ received: true, applied: false });

    // The request must have stored THIS intent before handing out its secret
    // (payReissue). Anything else is a foreign or forged binding.
    case 'intent_mismatch':
      emit('forbidden');
      log.error('reissue_fee_webhook_intent_mismatch', { reissueRequestId });
      return res.status(200).json({ received: true, applied: false });

    // Paid, but the request was cancelled or changed underneath. Money is held
    // against a request we will not fulfil. Retrying would not change the
    // outcome; the stuck-payment queue offers the refund.
    case 'not_payable':
      emit('internal');
      log.error('reissue_fee_paid_but_not_payable', { reissueRequestId });
      return res.status(200).json({ received: true, applied: false });

    default:
      emit('internal');
      log.error('reissue_fee_webhook_apply_failed', { reissueRequestId, errorCode: applied.errorCode ?? 'unknown' });
      return res.status(500).json({ received: true, applied: false });
  }
}

export default router;
