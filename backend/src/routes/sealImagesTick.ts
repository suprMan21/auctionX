/**
 * POST /api/v1/internal/seal-images — S-SEAL1 Ph2b.
 *
 * The 10-minute tick that keeps seal pictures in S3 in step with seal states (draws missing previews,
 * removes them for seals on hold, released or retired). Called by pg_cron through pg_net
 * (20261029000001_seal_images.sql), never by a browser.
 *
 * Auth: one shared secret in `x-tick-secret`, compared in constant time against SEAL_IMAGES_TICK_SECRET.
 * Unset (or too short): 503 to everyone. The caller can only make the tick run; what it draws or
 * removes comes from the database.
 */
import { createHash, timingSafeEqual } from 'crypto';
import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { log } from '../lib/logger';
import { runSealImagesTick } from '../lib/seal/sealImageSync';
import { sealImageStore } from '../lib/seal/sealImageStore';
import type { RequestWithId } from '../middleware/requestId';

const router = Router();
const MIN_SECRET_LENGTH = 24;

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

const secretMatches = (presented: string | undefined, expected: string): boolean =>
  typeof presented === 'string' && timingSafeEqual(digest(presented), digest(expected));

router.post('/', async (req: Request, res: Response) => {
  const expected = process.env.SEAL_IMAGES_TICK_SECRET?.trim() ?? '';
  if (expected.length < MIN_SECRET_LENGTH) {
    log.error('seal_images_tick_not_configured', {});
    return res.status(503).json({ success: false, data: null, error: 'Seal images tick is not configured' });
  }

  const presented = req.headers['x-tick-secret'];
  if (!secretMatches(Array.isArray(presented) ? presented[0] : presented, expected)) {
    log.warn('seal_images_tick_forbidden', {});
    return res.status(403).json({ success: false, data: null, error: 'Forbidden' });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const summary = await runSealImagesTick(supabase, sealImageStore(), (req as RequestWithId).requestId);
    log.info('seal_images_tick', summary);
    return res.status(200).json({ success: true, data: summary, error: null });
  } catch (err) {
    log.error('seal_images_tick_failed', { error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' });
    return res.status(500).json({ success: false, data: null, error: 'Seal images tick failed' });
  }
});

export default router;
