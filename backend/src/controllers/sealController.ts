/**
 * S-MOB2 — recorded sealing (Creator app).
 *
 * Locked protocol (2026-10-26): two taps of the same seal bracket a video of at most 2 minutes. The app captures
 * both taps offline and commits them here later, together with the video's SHA-256 (the file uploads after, Ph C).
 *
 *   POST /api/v1/nfc/seal/session   optional, online at tap 1: a server time for the record
 *   POST /api/v1/nfc/seal           the commit: needs the `seal` step-up bound to the chip serial
 *
 * Counter rule (Boss 2026-10-29, docs/plans/2026-10-29-s-mob2.md): seal taps may be older than the chip's latest
 * public tap. They must be MAC-valid, above the chip's seal baseline, consecutive (c2 = c1 + 1: nothing read the
 * chip during the video) and never accepted before. commit_seal enforces the counter and state rules under a row
 * lock; this file checks the MACs (keys never reach the database). Public taps, claims and transfers are unchanged.
 *
 * Who may seal (D3): any Creator account, on an ENROLLED chip with no owner. A seal is the chip's origin claim.
 */

import { Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth';
import type { RequestWithId } from '../middleware/requestId';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import { emitSecurityEvent, type SecurityResult } from '../lib/security/securityEvent';
import { securityContext } from '../lib/security/requestContext';
import { parseSunMessage } from '../services/nfc/ntag424';
import { resolveSealTap } from '../services/nfc/tapResolver';
import { sunFailureCode } from '../services/nfc/sunVerification';
import { errorFor, getServiceClient, mintProof, rotateOwnershipProof } from './tagManagementController';

type SealRequest = AuthRequest & RequestWithId;

const SESSION_ROUTE = '/api/v1/nfc/seal/session';
const COMMIT_ROUTE = '/api/v1/nfc/seal';

const serial = z.string().regex(/^[0-9A-F]{16}$/);
const sunUrl = z.string().min(1).max(512);
const deviceTime = z.string().datetime({ offset: true });

export const sealSessionSchema = z.object({ serial }).strict();

export const sealCommitSchema = z
  .object({
    serial,
    tap1: sunUrl,
    tap2: sunUrl,
    videoSha256: z.string().regex(/^[0-9a-f]{64}$/),
    tap1DeviceAt: deviceTime,
    tap2DeviceAt: deviceTime,
    sessionId: z.string().uuid().optional(),
    appliedBeforeRecording: z.boolean().optional(),
  })
  .strict();

const creatorOnly = (): AppError =>
  new AppError('permission_denied', 'Only creator accounts can seal', { reason: 'creator_only' });

const assertCreator = async (userId: string): Promise<void> => {
  const { data, error } = await getServiceClient()
    .from('users')
    .select('account_type')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new AppError('internal', 'Could not check the account');
  if ((data as { account_type?: string } | null)?.account_type !== 'creator') throw creatorOnly();
};

// ── POST /nfc/seal/session ──────────────────────────────────────────────────

export const startSealSession = async (req: SealRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');
  const parsed = sealSessionSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  await assertCreator(userId);

  // Never says whether the serial belongs to a chip: the commit checks that.
  const { data, error } = await getServiceClient()
    .from('seal_sessions')
    .insert({ creator_id: userId, chip_serial: parsed.data.serial })
    .select('id, started_at')
    .maybeSingle();
  if (error || !data) throw new AppError('internal', 'Could not start the seal');
  const row = data as { id: string; started_at: string };
  res.status(201).json({ success: true, data: { sessionId: row.id, startedAt: row.started_at }, error: null });
};

// ── POST /nfc/seal ──────────────────────────────────────────────────────────

const COMMIT_ERRORS: Record<string, SecurityResult> = {
  not_found: 'not_found',
  already_claimed: 'already_claimed',
  not_sealable: 'not_sealable',
  below_baseline: 'replay_detected',
  counter_spent: 'replay_detected',
  gap: 'seal_gap',
  session_invalid: 'tap_session_invalid',
};

export const commitSeal = async (req: SealRequest, res: Response) => {
  const ctx = securityContext(req, COMMIT_ROUTE, 'user');
  const logger = withLogContext({ requestId: ctx.requestId, route: ctx.route });
  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const parsed = sealCommitSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  const body = parsed.data;

  const emitSeal = (tagId: string | null, priorStatus: string | null, result: SecurityResult) =>
    emitSecurityEvent({
      event: 'nfc.claim', tag_id: tagId, prior_status: priorStatus, result,
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user', ip: ctx.ip, route: ctx.route,
    });

  try {
    await assertCreator(userId);
  } catch (err) {
    emitSeal(null, null, 'forbidden');
    throw err;
  }

  // Same seal: both URLs must carry the serial the step-up was bound to.
  const parts1 = parseSunMessage(body.tap1);
  const parts2 = parseSunMessage(body.tap2);
  if (!parts1 || !parts2 || parts1.serial !== body.serial || parts2.serial !== body.serial) {
    emitSeal(null, null, 'invalid_argument');
    throw new AppError('invalid_argument', 'Both taps must be of the same seal');
  }

  const supabase = getServiceClient();
  const tap1 = await resolveSealTap(supabase, parts1, ctx);
  const tap2 = tap1 ? await resolveSealTap(supabase, parts2, ctx) : null;
  if (!tap1 || !tap2 || tap1.tag.id !== tap2.tag.id) {
    emitSeal(tap1?.tag.id ?? null, tap1?.tag.lifecycle_status ?? null, 'not_found');
    throw errorFor('not_found');
  }
  const tag = tap1.tag;
  for (const tap of [tap1, tap2]) {
    if (!tap.result.valid || tap.result.counterValue === null) {
      const code = sunFailureCode(tap.sunResult);
      emitSeal(tag.id, tag.lifecycle_status, code);
      throw errorFor(code);
    }
  }

  // Mint first: a missing salt key must fail before anything changes.
  const minted = mintProof({ tagId: tag.id, ownershipEventId: tag.id, ownershipEventType: 'claim' }, ctx);

  const { data, error } = await supabase.rpc('commit_seal', {
    p_tag_id: tag.id,
    p_creator_id: userId,
    p_tap1_counter: tap1.result.counterValue,
    p_tap2_counter: tap2.result.counterValue,
    p_tap1_device_at: body.tap1DeviceAt,
    p_tap2_device_at: body.tap2DeviceAt,
    p_video_sha256: body.videoSha256,
    p_session_id: body.sessionId ?? null,
    p_applied_before_recording: body.appliedBeforeRecording ?? false,
  });
  if (error) {
    logger.error('nfc_seal_commit_failed', { tagId: tag.id, error: error.message.slice(0, 200) });
    emitSeal(tag.id, tag.lifecycle_status, 'internal');
    throw new AppError('internal', 'Could not record the seal');
  }
  const out = (data ?? {}) as { status?: string; seal_id?: string };
  if (out.status !== 'ok' || !out.seal_id) {
    const code = COMMIT_ERRORS[out.status ?? ''] ?? 'internal';
    emitSeal(tag.id, tag.lifecycle_status, code);
    throw code === 'internal' ? new AppError('internal', 'Could not record the seal') : errorFor(code);
  }

  const ownershipId = await rotateOwnershipProof(supabase, minted, { tagId: tag.id, ownerId: userId });
  emitSeal(tag.id, 'ENROLLED', 'ok');

  res.status(201).json({
    success: true,
    data: {
      tagId: tag.id,
      sealId: out.seal_id,
      lifecycleStatus: 'ACTIVE',
      ownershipId,
      videoStatus: 'pending_upload',
    },
    error: null,
  });
};
