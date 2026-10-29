/**
 * S-SEAL1 Ph2b: keep the seal pictures in S3 in step with each seal's state.
 *
 *   - A live seal (ENROLLED / ACTIVE) has a preview picture; `nfc_tags.seal_images_at` says when it was stored.
 *   - A seal on hold, released or retired has none: its preview and share pictures are removed and the column cleared.
 *
 * Pictures are drawn at enroll (best effort) and by the 10-minute tick (POST /api/v1/internal/seal-images),
 * which also does the first fill of existing seals and every removal. Nothing here ever throws into the
 * caller's request: a failure is logged and the next tick tries again. The page never waits on it: until a
 * picture exists the page points at the generic one.
 */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { log, withLogContext } from '../logger';
import { displaySealCode } from '../nfc/sealCode';
import { ensureSealSpec } from './ensureSealSpec';
import { PREVIEW_MAX_BYTES, previewSvg, renderPng } from './sealImages';
import type { SealImageStore } from './sealImageStore';

/** Lifecycle states that show a seal (same rule as the website's showsSeal). */
export const LIVE_SEAL_STATES = ['ENROLLED', 'ACTIVE'] as const;

export const isLiveSeal = (lifecycle: string | null | undefined): boolean =>
  (LIVE_SEAL_STATES as readonly string[]).includes(lifecycle ?? '');

/** Base URL of the public seal page (no trailing slash). PUBLIC_SEAL_BASE_URL, else FRONTEND_URL. */
export const sealBaseUrl = (): string =>
  (process.env.PUBLIC_SEAL_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

export const sealPageUrl = (displayCode: string): string => `${sealBaseUrl()}/s/${displayCode}`;

/** Share-picture key variant: 8 hex of the base URL the picture prints. */
export const shareVariant = (): string => createHash('sha256').update(sealBaseUrl()).digest('hex').slice(0, 8);

type ImageTag = { id: string; seal_code: string | null; seal_spec?: unknown; lifecycle_status?: string | null };

/**
 * Draws and stores one seal's preview picture, then marks the tag. If the seal stopped being live
 * in the meantime (the mark matches no row), the picture is removed again at once.
 * Returns true when a picture was stored and the tag marked.
 */
export const drawSealImages = async (
  supabase: SupabaseClient,
  store: SealImageStore,
  tag: ImageTag,
  logCtx: { requestId?: string; route: string },
): Promise<boolean> => {
  const logger = withLogContext({ requestId: logCtx.requestId, route: logCtx.route });
  const code = displaySealCode(tag.seal_code);
  if (!store.configured || !code) return false;
  try {
    const spec = await ensureSealSpec(supabase, tag, logCtx);
    if (!spec) return false;
    const png = renderPng(previewSvg(spec, sealPageUrl(code)));
    if (png.length > PREVIEW_MAX_BYTES) logger.warn('seal_preview_over_budget', { tagId: tag.id, bytes: png.length });
    await store.putPreview(code, png);

    const { data, error } = await supabase
      .from('nfc_tags')
      .update({ seal_images_at: new Date().toISOString() })
      .eq('id', tag.id)
      .in('lifecycle_status', [...LIVE_SEAL_STATES])
      .select('id');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      await store.remove(code, shareVariant());
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('seal_images_draw_failed', { tagId: tag.id, error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' });
    return false;
  }
};

/** Generic picture: stored once per process (the backend role may write but not read seal-img/*). */
let genericStored = false;

/** Test hook. */
export const resetSealImageSyncState = (): void => {
  genericStored = false;
};

export type SealImagesTickSummary = {
  configured: boolean;
  generic: 'stored' | 'already' | 'failed' | 'skipped';
  drawn: number;
  drawFailed: number;
  removed: number;
  removeFailed: number;
};

/** Small batches: the tick runs every 10 minutes and a picture takes ~20 ms to draw. */
const DRAW_BATCH = 40;
const REMOVE_BATCH = 100;

export const runSealImagesTick = async (
  supabase: SupabaseClient,
  store: SealImageStore,
  requestId?: string,
): Promise<SealImagesTickSummary> => {
  const route = '/api/v1/internal/seal-images';
  const summary: SealImagesTickSummary = { configured: store.configured, generic: 'skipped', drawn: 0, drawFailed: 0, removed: 0, removeFailed: 0 };
  if (!store.configured) return summary;

  if (genericStored) summary.generic = 'already';
  else {
    try {
      await store.putGeneric(renderPng(previewSvg(null, null)));
      genericStored = true;
      summary.generic = 'stored';
    } catch (err) {
      summary.generic = 'failed';
      log.warn('seal_images_generic_failed', { error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' });
    }
  }

  // Removals first: a seal put on hold should lose its picture before anything else is drawn.
  const { data: stale, error: staleError } = await supabase
    .from('nfc_tags')
    .select('id, seal_code')
    .not('seal_images_at', 'is', null)
    .not('lifecycle_status', 'in', `(${LIVE_SEAL_STATES.join(',')})`)
    .limit(REMOVE_BATCH);
  if (staleError) throw new Error(`seal_images_stale_query: ${staleError.message}`);

  for (const row of (stale ?? []) as ImageTag[]) {
    const code = displaySealCode(row.seal_code);
    try {
      if (code) await store.remove(code, shareVariant());
      const { error } = await supabase.from('nfc_tags').update({ seal_images_at: null }).eq('id', row.id);
      if (error) throw new Error(error.message);
      summary.removed += 1;
    } catch (err) {
      summary.removeFailed += 1;
      log.warn('seal_images_remove_failed', { tagId: row.id, error: err instanceof Error ? err.message.slice(0, 120) : 'unknown' });
    }
  }

  const { data: missing, error: missingError } = await supabase
    .from('nfc_tags')
    .select('id, seal_code, seal_spec, lifecycle_status')
    .is('seal_images_at', null)
    .not('seal_code', 'is', null)
    .in('lifecycle_status', [...LIVE_SEAL_STATES])
    .limit(DRAW_BATCH * 5);
  if (missingError) throw new Error(`seal_images_missing_query: ${missingError.message}`);

  // Draw a random 40 of up to 200: seals that keep failing cannot hold the batch every tick.
  const pool = [...((missing ?? []) as ImageTag[])];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (const row of pool.slice(0, DRAW_BATCH)) {
    if (await drawSealImages(supabase, store, row, { requestId, route })) summary.drawn += 1;
    else summary.drawFailed += 1;
  }

  return summary;
};
