/**
 * POST /api/v1/internal/anchor-tick — S-ANCHOR1 Ph1.
 *
 * The hourly anchoring tick. Called by pg_cron through pg_net (see
 * 20261027000004_s_anchor1_registry.sql), never by a browser.
 *
 * Auth is one shared secret in `x-anchor-secret`, compared in constant time
 * against ANCHOR_TICK_SECRET (its own secret, not the fee sweep's). With the
 * secret unset the route answers 503 to everyone. The caller can only make the
 * tick run: what gets anchored comes from the database, and every value written
 * is checked by the reconciliation scan.
 */

import { createHash, timingSafeEqual } from 'crypto';
import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { log } from '../lib/logger';
import { securityContext } from '../lib/security/requestContext';
import { readAnchorConfig } from '../lib/anchoring/config';
import { createKmsSigner, type KmsSigner } from '../lib/anchoring/kmsSigner';
import { createViemChainPort } from '../lib/anchoring/registry';
import { randomLeaf } from '../lib/anchoring/merkle';
import { runAnchorTick } from '../lib/anchoring/anchorTick';

const router = Router();
const ROUTE = '/api/v1/internal/anchor-tick';
const MIN_SECRET_LENGTH = 24;

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

const secretMatches = (presented: string | undefined, expected: string): boolean =>
  typeof presented === 'string' && timingSafeEqual(digest(presented), digest(expected));

// One GetPublicKey per process, not per tick.
let cachedSigner: { keyId: string; signer: KmsSigner } | null = null;

router.post('/', async (req: Request, res: Response) => {
  const expected = process.env.ANCHOR_TICK_SECRET?.trim() ?? '';
  if (expected.length < MIN_SECRET_LENGTH) {
    log.error('anchor_tick_not_configured', {});
    return res.status(503).json({ success: false, data: null, error: 'Anchoring is not configured' });
  }

  const presented = req.headers['x-anchor-secret'];
  if (!secretMatches(Array.isArray(presented) ? presented[0] : presented, expected)) {
    log.warn('anchor_tick_forbidden', {});
    return res.status(403).json({ success: false, data: null, error: 'Forbidden' });
  }

  const configResult = readAnchorConfig();
  if (!configResult.ok) {
    log.warn('anchor_tick_config_incomplete', { missing: configResult.missing.join(',') });
    return res.status(200).json({ success: true, data: { configured: false, missing: configResult.missing }, error: null });
  }
  const config = configResult.config;

  try {
    const ctx = securityContext(req, ROUTE, 'system');
    if (cachedSigner?.keyId !== config.kmsKeyId) {
      cachedSigner = { keyId: config.kmsKeyId, signer: await createKmsSigner(config.kmsKeyId, ctx) };
    }
    const signer = cachedSigner.signer;

    const summary = await runAnchorTick({
      supabase: createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!),
      chain: createViemChainPort(config, signer),
      config,
      writer: signer.address,
      now: () => new Date(),
      randomLeaf,
    });
    return res.status(200).json({ success: true, data: { configured: true, ...summary }, error: null });
  } catch (err) {
    cachedSigner = null;
    log.error('anchor_tick_failed', { error: err instanceof Error ? err.message.slice(0, 60) : 'unknown' });
    return res.status(500).json({ success: false, data: null, error: 'Anchor tick failed' });
  }
});

export default router;
