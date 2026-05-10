import { Router, Request, Response } from 'express';
import type Stripe from 'stripe';
import { getStripe } from '../lib/stripe';
import { applyAccountUpdate } from '../controllers/stripeConnectController';
import { log } from '../lib/logger';

const router = Router();

/**
 * POST /api/v1/webhooks/stripe-account
 * Receives Stripe Connect "Connected accounts" events. Currently only
 * `account.updated` is handled — flips charges_enabled / payouts_enabled
 * on the matching user row.
 *
 * Mounted with express.raw({ type: 'application/json' }) BEFORE the global
 * express.json() parser so the raw body is available for signature
 * verification (constructEventAsync, per the Stripe-in-Deno lesson which
 * also applies in Node).
 */
router.post('/', async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'] as string | undefined;
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    log.error('stripe_account_webhook_missing_secret_or_signature', {
      hasSignature: !!signature,
      hasSecret: !!webhookSecret,
    });
    return res.status(400).json({ received: false, error: 'Missing signature or secret' });
  }

  const stripe = getStripe();
  let event: Stripe.Event;

  try {
    // req.body is a Buffer here because of express.raw()
    event = await stripe.webhooks.constructEventAsync(req.body, signature, webhookSecret);
  } catch (err) {
    log.error('stripe_account_webhook_signature_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(400).json({ received: false, error: 'Invalid signature' });
  }

  log.info('stripe_account_webhook_received', { type: event.type, eventId: event.id });

  try {
    if (event.type === 'account.updated') {
      const account = event.data.object as Stripe.Account;
      const result = await applyAccountUpdate(account);
      log.info('stripe_account_webhook_applied', {
        eventId: event.id,
        accountId: account.id,
        userMatched: result.updated,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
      });
    } else {
      log.info('stripe_account_webhook_unhandled_event', { type: event.type, eventId: event.id });
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    log.error('stripe_account_webhook_apply_failed', {
      eventId: event.id,
      error: err instanceof Error ? err.message : String(err),
    });
    // Return 200 so Stripe doesn't retry endlessly on internal DB errors.
    return res.status(200).json({ received: true, applied: false });
  }
});

export default router;
