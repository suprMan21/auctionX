/**
 * S-SEAL1 Ph2a: store each seal's spec once, and hand out the public part.
 *
 * The spec is built from the seal code (buildSealSpec is pure), so a missing or unreadable
 * stored spec never blocks a read: we draw from a freshly built one and store it if the
 * column is still empty. The column is write-once in the database.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { withLogContext } from '../logger';
import { SEAL_CODE_STORED } from '../nfc/sealCode';
import { buildSealSpec, PATTERN_VERSION, SEAL_SPEC_VERSION, type SealSpec } from './sealSpec';

/** What the website and app receive. The code itself is already sent as `sealCode`. */
export type PublicSealSpec = Pick<SealSpec, 'v' | 'colors' | 'pattern'>;

const storedSpecSchema = z.object({
  v: z.literal(SEAL_SPEC_VERSION),
  code: z.string().regex(SEAL_CODE_STORED),
  colors: z.literal('am-default'),
  pattern: z.object({
    kind: z.literal('hypotrochoid'),
    version: z.literal(PATTERN_VERSION),
    // Relative path commands only (M, l, Z, numbers): nothing else is ever drawn.
    paths: z.array(z.string().max(8000).regex(/^M[-\d. l]+Z$/)).min(1).max(4),
  }),
});

/** A stored spec, if it is well formed and belongs to this seal code; otherwise null. */
export const readStoredSealSpec = (raw: unknown, code: string): SealSpec | null => {
  const parsed = storedSpecSchema.safeParse(raw);
  return parsed.success && parsed.data.code === code ? (parsed.data as SealSpec) : null;
};

export const publicSealSpec = (spec: SealSpec | null): PublicSealSpec | null =>
  spec ? { v: spec.v, colors: spec.colors, pattern: spec.pattern } : null;

type SpecTag = { id: string; seal_code?: string | null; seal_spec?: unknown };

/**
 * The tag's seal spec. Stores it when the column is empty (guarded by `seal_spec IS NULL`,
 * so a racing reader or the backfill never makes this fail). Never throws: a failed store
 * is logged and the built spec is still returned, since it is the same either way.
 */
export const ensureSealSpec = async (
  supabase: SupabaseClient,
  tag: SpecTag,
  logCtx: { requestId?: string; route: string },
): Promise<SealSpec | null> => {
  const code = tag.seal_code;
  if (typeof code !== 'string' || !SEAL_CODE_STORED.test(code)) return null;

  const stored = readStoredSealSpec(tag.seal_spec, code);
  if (stored) return stored;

  const built = buildSealSpec(code);
  // A stored value we cannot read (a later version, say) is never overwritten: write-once.
  if (tag.seal_spec !== null && tag.seal_spec !== undefined) return built;

  try {
    const { error } = await supabase
      .from('nfc_tags')
      .update({ seal_spec: built })
      .eq('id', tag.id)
      .is('seal_spec', null);
    if (error) throw new Error(error.message);
  } catch (err) {
    withLogContext({ requestId: logCtx.requestId, route: logCtx.route }).warn('seal_spec_store_failed', {
      tagId: tag.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return built;
};
