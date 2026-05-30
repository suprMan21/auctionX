/**
 * Yoti webhook route — public, HMAC-verified, raw body.
 *
 * Mounted in `server.ts` BEFORE the global `express.json()` parser with
 * `express.raw({ type: 'application/json' })` so the signature can be verified
 * against the unparsed bytes (analogous to the Stripe Connect webhook pattern).
 */

import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { yotiWebhook } from '../controllers/yotiVerificationController';

const router = Router();

/** 60 req/min per IP for Yoti webhook deliveries (Yoti retries on 5xx). */
const webhookLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'resource_exhausted', message: 'Webhook rate limit exceeded' } },
});

router.post('/', webhookLimit as unknown as RequestHandler, yotiWebhook as unknown as RequestHandler);

export default router;
