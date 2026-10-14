/**
 * POST /api/v1/internal/token-fee-sweep — S-ADMIN1 Ph3a.
 *
 * The 10-minute reconciliation tick. Called by pg_cron through pg_net (see
 * 20261011000001_s_admin1_stuck_payments.sql), never by a browser.
 *
 * Auth is one shared secret in `x-sweep-secret`, compared in constant time
 * against TOKEN_FEE_SWEEP_SECRET. With the secret unset the route answers 503
 * to everyone: it fails closed rather than running for an anonymous caller.
 * The caller can only make the sweep run; it cannot choose what the sweep
 * applies, because that comes from Stripe.
 */

import { createHash, timingSafeEqual } from 'crypto';
import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '../lib/stripe';
import { log } from '../lib/logger';
import { securityContext } from '../lib/security/requestContext';
import { runTokenFeeSweep } from '../lib/payments/tokenFeeSweep';

const router = Router();
const ROUTE = '/api/v1/internal/token-fee-sweep';
const MIN_SECRET_LENGTH = 24;

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

const secretMatches = (presented: string | undefined, expected: string): boolean =>
  typeof presented === 'string' && timingSafeEqual(digest(presented), digest(expected));

router.post('/', async (req: Request, res: Response) => {
  const expected = process.env.TOKEN_FEE_SWEEP_SECRET?.trim() ?? '';
  if (expected.length < MIN_SECRET_LENGTH) {
    log.error('token_fee_sweep_not_configured', {});
    return res.status(503).json({ success: false, data: null, error: 'Sweep is not configured' });
  }

  const presented = req.headers['x-sweep-secret'];
  if (!secretMatches(Array.isArray(presented) ? presented[0] : presented, expected)) {
    log.warn('token_fee_sweep_forbidden', {});
    return res.status(403).json({ success: false, data: null, error: 'Forbidden' });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const summary = await runTokenFeeSweep(supabase, getStripe(), securityContext(req, ROUTE, 'system'));
    return res.status(200).json({ success: true, data: summary, error: null });
  } catch (err) {
    log.error('token_fee_sweep_failed', { error: err instanceof Error ? err.message.slice(0, 60) : 'unknown' });
    return res.status(500).json({ success: false, data: null, error: 'Sweep failed' });
  }
});

export default router;
