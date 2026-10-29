/**
 * GET /api/v1/nfc/:tagId/share-image — S-SEAL1 Ph2b.
 *
 * The owner's share picture (1080 × 1920 PNG: Sealed seal, code, QR to /s/<code>, link, "picture only"
 * band). Current owner of a live seal only: an earlier owner loses it with the transfer. No step-up
 * (DR-22: sharing needs none). Never cached by browsers or CloudFront (`no-store`). The picture holds
 * nothing private: the same code is on the public seal page.
 *
 * Drawn once and kept in S3 (share/<code>/share-v1-<base url hash>.png, not public); drawn on the spot when S3 has
 * none or cannot be reached.
 */
import { Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import { displaySealCode } from '../lib/nfc/sealCode';
import { emitSecurityEvent } from '../lib/security/securityEvent';
import { securityContext } from '../lib/security/requestContext';
import { ensureSealSpec } from '../lib/seal/ensureSealSpec';
import { renderPng, SHARE_MAX_BYTES, shareSvg } from '../lib/seal/sealImages';
import { sealImageStore, type SealImageStore } from '../lib/seal/sealImageStore';
import { isLiveSeal, sealPageUrl, shareVariant } from '../lib/seal/sealImageSync';
import type { AuthRequest } from '../middleware/auth';
import type { RequestWithId } from '../middleware/requestId';

interface ShareRequest extends RequestWithId, AuthRequest {}

const ROUTE = '/api/v1/nfc/:tagId/share-image';

const tagIdSchema = z.string().uuid();

export type ShareImageDeps = {
  supabase?: () => SupabaseClient;
  store?: () => SealImageStore;
};

export const createGetShareImage = (deps: ShareImageDeps = {}) => async (req: ShareRequest, res: Response) => {
  if (!req.user?.id) throw new AppError('unauthenticated', 'Authentication required');
  const userId = req.user.id;
  const ctx = securityContext(req, ROUTE, 'user');
  const logger = withLogContext({ requestId: req.requestId, route: ROUTE });
  const raw = Array.isArray(req.params.tagId) ? req.params.tagId[0] : req.params.tagId;
  const parsed = tagIdSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('not_found', 'Not found');
  const tagId = parsed.data;

  const supabase = deps.supabase?.() ?? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await supabase
    .from('nfc_tags')
    .select('id, current_owner_id, lifecycle_status, seal_code, seal_spec')
    .eq('id', tagId)
    .maybeSingle();
  if (error) throw new AppError('internal', 'Could not load this seal');
  if (!data) throw new AppError('not_found', 'Not found');
  const tag = data as { id: string; current_owner_id: string | null; lifecycle_status: string | null; seal_code: string | null; seal_spec: unknown };

  if (tag.current_owner_id !== userId) {
    emitSecurityEvent({
      event: 'authz.denied', resource_type: 'tag', resource_id: tagId,
      reason: 'not_owner', result: 'forbidden',
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });
    throw new AppError('permission_denied', 'Forbidden');
  }

  const display = displaySealCode(tag.seal_code);
  if (!display || !isLiveSeal(tag.lifecycle_status)) {
    throw new AppError('conflict', 'This seal cannot be shared right now');
  }

  const store = deps.store?.() ?? sealImageStore();
  let png: Buffer | null = null;
  try {
    png = await store.getShare(display, shareVariant());
  } catch (err) {
    logger.warn('seal_share_image_read_failed', { tagId, error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' });
  }

  if (!png) {
    const spec = await ensureSealSpec(supabase, tag, { requestId: req.requestId, route: ROUTE });
    if (!spec) throw new AppError('conflict', 'This seal cannot be shared right now');
    png = renderPng(await shareSvg(spec, sealPageUrl(display)));
    if (png.length > SHARE_MAX_BYTES) logger.warn('seal_share_image_over_budget', { tagId, bytes: png.length });
    try {
      await store.putShare(display, shareVariant(), png);
    } catch (err) {
      logger.warn('seal_share_image_store_failed', { tagId, error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' });
    }
  }

  res.status(200).set({
    'Content-Type': 'image/png',
    'Cache-Control': 'no-store',
    'Content-Disposition': `inline; filename="seal-${display}.png"`,
    'X-Content-Type-Options': 'nosniff',
  });
  return res.send(png);
};

export const getShareImage = createGetShareImage();
