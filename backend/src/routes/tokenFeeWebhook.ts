/**
 * POST /api/v1/webhooks/stripe-token-fees — S-NFC3.
 *
 * THE ONLY PLACE A TRANSFER MAY REACH `COMPLETED`.
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
 * `transfer.state_change` with `trigger != 'webhook'` and `to = COMPLETED` is a
 * Critical detection in S-SEC0 precisely so a regression here is visible.
 */

import { Router, Request, Response } from 'express';
import type Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '../lib/stripe';
import { log } from '../lib/logger';
import { emitSecurityEvent } from '../lib/security/securityEvent';
import { securityContext } from '../lib/security/requestContext';
import { mintOwnershipProof, type SecurityLogContext } from '../lib/ownership/ownershipProof';

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
    idempotentReplay: boolean;
    result: 'ok' | 'forbidden' | 'not_found' | 'internal';
  }) =>
    emitSecurityEvent({
      event: 'payment.webhook',
      stripe_event_type: params.eventType.slice(0, 64),
      signature_valid: params.signatureValid,
      transfer_id: params.transferId,
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
  const transferId = (intent.metadata?.transfer_id as string | undefined) ?? null;
  const kind = intent.metadata?.kind as string | undefined;

  // A PaymentIntent from any other flow must not touch a transfer row.
  if (kind !== 'token_transfer_fee' || !transferId) {
    emitWebhook({
      eventType: event.type, signatureValid: true, transferId,
      idempotentReplay: false, result: 'not_found',
    });
    return res.status(200).json({ received: true, applied: false });
  }

  const supabase = getServiceClient();

  try {
    const { data: transfer } = await supabase
      .from('ownership_transfers')
      .select('id, tag_id, from_user_id, to_user_id, status, stripe_payment_intent_id')
      .eq('id', transferId)
      .maybeSingle();

    if (!transfer) {
      emitWebhook({
        eventType: event.type, signatureValid: true, transferId,
        idempotentReplay: false, result: 'not_found',
      });
      return res.status(200).json({ received: true, applied: false });
    }

    // Stripe delivers at-least-once. A redelivery of an already-applied event
    // is normal, not an error — recorded as a replay and acknowledged.
    if (transfer.status === 'COMPLETED') {
      emitWebhook({
        eventType: event.type, signatureValid: true, transferId,
        idempotentReplay: true, result: 'ok',
      });
      return res.status(200).json({ received: true, applied: false, reason: 'already_completed' });
    }

    // Bind the event to the intent this transfer actually created, so a
    // succeeded intent from elsewhere cannot complete someone else's transfer.
    if (transfer.stripe_payment_intent_id && transfer.stripe_payment_intent_id !== intent.id) {
      emitWebhook({
        eventType: event.type, signatureValid: true, transferId,
        idempotentReplay: false, result: 'forbidden',
      });
      log.error('token_fee_webhook_intent_mismatch', { transferId });
      return res.status(200).json({ received: true, applied: false });
    }

    if (!transfer.to_user_id) {
      emitWebhook({
        eventType: event.type, signatureValid: true, transferId,
        idempotentReplay: false, result: 'internal',
      });
      log.error('token_fee_webhook_no_recipient', { transferId });
      return res.status(200).json({ received: true, applied: false });
    }

    // Mint BEFORE any write. If the salt key is missing this throws while the
    // transfer is still PENDING, so Stripe's retry can apply it later. Minting
    // after completion would leave a COMPLETED transfer with no Ownership ID,
    // and every retry would then stop at "already completed".
    const minted = mintOwnershipProof(
      {
        tagId: transfer.tag_id,
        ownershipEventId: transfer.id,
        ownershipEventType: 'transfer',
      },
      ctx,
    );

    // Conditional on PENDING: concurrent deliveries cannot both apply.
    const { data: completed } = await supabase
      .from('ownership_transfers')
      .update({
        status: 'COMPLETED',
        transfer_fee_paid: true,
        completed_at: new Date().toISOString(),
        transferred_at: new Date().toISOString(),
      })
      .eq('id', transfer.id)
      .eq('status', 'PENDING')
      .select('id')
      .maybeSingle();

    if (!completed) {
      emitWebhook({
        eventType: event.type, signatureValid: true, transferId,
        idempotentReplay: true, result: 'ok',
      });
      return res.status(200).json({ received: true, applied: false, reason: 'race_lost' });
    }

    // Ownership actually moves here, and only here.
    await supabase
      .from('nfc_tags')
      .update({ current_owner_id: transfer.to_user_id, lifecycle_status: 'ACTIVE' })
      .eq('id', transfer.tag_id);

    await supabase
      .from('ownership_proofs')
      .update({ status: 'stale' })
      .eq('tag_id', transfer.tag_id)
      .eq('status', 'current');

    await supabase.from('ownership_proofs').insert({
      tag_id: transfer.tag_id,
      ownership_event_id: minted.ownershipEventId,
      ownership_event_type: 'transfer',
      ownership_id: minted.ownershipId,
      tag_ref: minted.tagRef,
      salt_enc: minted.saltEnc,
      owner_id: transfer.to_user_id,
      status: 'current',
    });

    emitSecurityEvent({
      event: 'transfer.state_change',
      transfer_id: transfer.id,
      from: 'PENDING',
      to: 'COMPLETED',
      // The ONLY legitimate value here for to=COMPLETED.
      trigger: 'webhook',
      result: 'ok',
      request_id: ctx.requestId,
      actor_id: null,
      actor_type: 'system',
      ip: ctx.ip,
      route: ROUTE,
    });

    emitWebhook({
      eventType: event.type, signatureValid: true, transferId,
      idempotentReplay: false, result: 'ok',
    });

    return res.status(200).json({ received: true, applied: true });
  } catch (err) {
    emitWebhook({
      eventType: event.type, signatureValid: true, transferId,
      idempotentReplay: false, result: 'internal',
    });
    log.error('token_fee_webhook_apply_failed', {
      transferId,
      error: err instanceof Error ? err.message : String(err),
    });
    // 500 so Stripe retries (with backoff, for up to 3 days). Safe: applying
    // is conditional on PENDING, so a retry after a partial apply stops at
    // "already completed". The common failure is now a config fault (e.g. a
    // missing salt key) thrown BEFORE any write; acknowledging it with a 200
    // would strand a paid transfer at PENDING with no retry.
    return res.status(500).json({ received: true, applied: false });
  }
});

export default router;
