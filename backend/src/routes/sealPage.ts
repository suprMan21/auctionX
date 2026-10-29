/**
 * GET /s/:code — S-SEAL1 Ph2b, the public seal page (server HTML, no JavaScript).
 *
 * Reached through CloudFront behaviour `/s/*` (cache policy am-seal-page-60s, Origin Shield), so the
 * backend sees about one request per seal per minute whatever the traffic. Mounted before the API's
 * CORS, version gate and body parsers: it is a plain GET page.
 *
 *   - Accepts any case, spaces / hyphens, and Crockford look-alikes (I, L → 1; O → 0); a well-formed
 *     code not in XXXX-XXXX form gets a 301 to it.
 *   - Live seals (ENROLLED / ACTIVE): the still Sealed seal + public story. Never the Verified look.
 *   - Unknown, malformed, on hold, released, retired: one identical "can't show" page, 200 + noindex
 *     (the distribution rewrites 404s to the app, so this page never answers 404).
 *   - Rate limit: behind CloudFront req.ip is a shield address shared by every viewer, so a per-IP
 *     limit there would let one abuser 429 everyone. It is only a high backstop against direct calls
 *     to the origin; per-viewer limiting belongs in a CloudFront / WAF rule (follow-up).
 */
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { log } from '../lib/logger';
import { displaySealCode, SEAL_CODE_STORED } from '../lib/nfc/sealCode';
import { readStoredSealSpec } from '../lib/seal/ensureSealSpec';
import { outlinedSealSvg } from '../lib/seal/sealImages';
import { GENERIC_IMAGE_KEY, sealImageKeys } from '../lib/seal/sealImageStore';
import { isLiveSeal, sealBaseUrl, sealPageUrl } from '../lib/seal/sealImageSync';
import { buildSealSpec } from '../lib/seal/sealSpec';
import { renderSealPage, SEAL_PAGE_CSP, type SealPageModel, type SealPageStory } from '../lib/seal/sealPage';

/** What the page needs about one seal. Story fields come only from public_tag_provenance. */
export type SealLookup = {
  lifecycle: string | null;
  sealCode: string;
  sealSpec: unknown;
  imagesAt: string | null;
  story: SealPageStory;
};

export type SealPageDeps = {
  lookup?: (storedCode: string) => Promise<SealLookup | null>;
  perIpPerMinute?: number;
};

/** Upper-case, drop spaces and hyphens, map I/L → 1 and O → 0. Null unless 8 valid characters remain. */
export const normaliseSealCode = (raw: string): string | null => {
  if (raw.length > 32) return null;
  const s = raw.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return SEAL_CODE_STORED.test(s) ? s : null;
};

// stale-if-error 1 h: long enough to ride out a blip, short enough that a seal put on hold during
// an outage does not keep its live page for a day.
const PAGE_CACHE = 'public, max-age=60, stale-if-error=3600';

const serviceLookup = async (storedCode: string): Promise<SealLookup | null> => {
  const supabase: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: tag, error } = await supabase
    .from('nfc_tags')
    .select('id, lifecycle_status, seal_code, seal_spec, seal_images_at')
    .eq('seal_code', storedCode)
    .maybeSingle();
  if (error) throw new Error(`seal_page_lookup: ${error.message}`);
  if (!tag) return null;
  const row = tag as {
    id: string;
    lifecycle_status: string | null;
    seal_code: string;
    seal_spec: unknown;
    seal_images_at: string | null;
  };

  let story: SealPageStory = {
    creatorName: null,
    originLocation: null,
    originDate: null,
    claimDate: null,
    originVideoUrl: null,
  };
  if (isLiveSeal(row.lifecycle_status)) {
    const { data: prov, error: provError } = await supabase
      .from('public_tag_provenance')
      .select('creator_name, origin_location, origin_date, claim_date, origin_video_url')
      .eq('tag_id', row.id)
      .maybeSingle();
    if (provError) throw new Error(`seal_page_provenance: ${provError.message}`);
    const p = (prov ?? {}) as Record<string, string | null>;
    story = {
      creatorName: p.creator_name ?? null,
      originLocation: p.origin_location ?? null,
      originDate: p.origin_date ?? null,
      claimDate: p.claim_date ?? null,
      originVideoUrl: p.origin_video_url ?? null,
    };
  }
  return {
    lifecycle: row.lifecycle_status,
    sealCode: row.seal_code,
    sealSpec: row.seal_spec,
    imagesAt: row.seal_images_at,
    story,
  };
};

const noindexEverywhere = (): boolean => process.env.SEAL_PAGE_ALLOW_INDEX !== 'true';

const send = (res: Response, status: number, html: string, cache: string, noindex: boolean) => {
  res.status(status);
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': cache,
    'Content-Security-Policy': SEAL_PAGE_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  if (noindex) res.set('X-Robots-Tag', 'noindex');
  res.send(html);
};

const genericModel = (): SealPageModel => ({
  kind: 'generic',
  imageUrl: `${sealBaseUrl()}/${GENERIC_IMAGE_KEY}`,
  homeUrl: `${sealBaseUrl()}/`,
});

export const createSealPageRouter = (deps: SealPageDeps = {}): Router => {
  const router = Router();
  const lookup = deps.lookup ?? serviceLookup;

  router.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: deps.perIpPerMinute ?? 3000,
      // No RateLimit headers: CloudFront would cache them with the page.
      standardHeaders: false,
      legacyHeaders: false,
      handler: (_req, res) => {
        res
          .status(429)
          .set({
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          })
          .send('Too many requests');
      },
    }),
  );

  const generic = (res: Response) => send(res, 200, renderSealPage(genericModel()), PAGE_CACHE, true);

  router.get('/', (_req, res) => generic(res));

  router.get('/:code', async (req: Request, res: Response) => {
    const raw = String(req.params.code ?? '');
    const stored = normaliseSealCode(raw);
    if (!stored) return generic(res);

    const display = displaySealCode(stored)!;
    if (raw !== display) {
      res.set('Cache-Control', PAGE_CACHE);
      return res.redirect(301, `/s/${display}`);
    }

    let seal: SealLookup | null;
    try {
      seal = await lookup(stored);
    } catch (err) {
      log.error('seal_page_failed', {
        error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
      });
      // CloudFront serves the last good copy for a day on errors (stale-if-error).
      return send(res, 503, renderSealPage(genericModel()), 'no-store', true);
    }

    if (!seal || !isLiveSeal(seal.lifecycle) || seal.sealCode !== stored) return generic(res);

    let html: string;
    let noindex: boolean;
    try {
      const spec = readStoredSealSpec(seal.sealSpec, stored) ?? buildSealSpec(stored);
      const model: SealPageModel = {
        kind: 'seal',
        displayCode: display,
        lifecycle: seal.lifecycle as 'ENROLLED' | 'ACTIVE',
        sealSvg: outlinedSealSvg(spec, 120),
        story: seal.story,
        pageUrl: sealPageUrl(display),
        // Until the tick has drawn this seal's preview, the generic picture stands in.
        imageUrl: `${sealBaseUrl()}/${seal.imagesAt ? sealImageKeys(display).preview : GENERIC_IMAGE_KEY}`,
        noindex: noindexEverywhere(),
      };
      html = renderSealPage(model);
      noindex = model.noindex;
    } catch (err) {
      log.error('seal_page_render_failed', {
        error: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
      });
      return send(res, 503, renderSealPage(genericModel()), 'no-store', true);
    }
    return send(res, 200, html, PAGE_CACHE, noindex);
  });

  return router;
};
