/**
 * S-NFC3 — Tag Management API (rev 2).
 *
 * The complete token lifecycle with no marketplace dependency:
 *   enroll -> origin claim -> two-sided transfer -> release / re-issue request
 *   (the token reset itself is admin-only: controllers/adminTagController.ts)
 *
 * Lifecycle (nfc_tags.lifecycle_status):
 *   ENROLLED --claim--> ACTIVE --transfer--> ACTIVE (new owner)
 *   ACTIVE --release--> RELEASED (terminal)
 *   ACTIVE|SUSPENDED --admin reset--> RETIRED (terminal)
 *   ACTIVE <--admin--> SUSPENDED
 *
 * Invariants this file is responsible for:
 *   1. Claim only on ENROLLED. There is no re-bind and no re-claim.
 *   2. Claim and transfer completion both require a FRESH SUN scan.
 *   3. A transfer reaches COMPLETED only from the Stripe webhook, never from a
 *      client response. This file creates PaymentIntents; it never completes.
 *   4. A pending transfer locks release.
 *   5. After completion the previous owner loses every right.
 *   6. No NFT, IPFS or chain call anywhere in this module.
 */

import { Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RequestWithId } from '../middleware/requestId';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import {
  emitSecurityEvent,
  hashEmailForLog,
  type SecurityResult,
} from '../lib/security/securityEvent';
import { securityContext } from '../lib/security/requestContext';
import { passesTwoFactor } from '../lib/security/twoFactorGate';
import {
  mintOwnershipProof,
  type SecurityLogContext,
} from '../lib/ownership/ownershipProof';
import {
  verifyFreshSun,
  emitUnknownTagSun,
  emitRaceReplay,
  emitSunVerify,
  sunFailureCode,
} from '../services/nfc/sunVerification';
import { currentSdmKeyVersion } from '../services/nfc/keys/config';
import { parseSunMessage } from '../services/nfc/ntag424';
import { consumeTapSession } from '../services/nfc/tapSession';
import {
  enrollPrecheckQuerySchema,
  enrollSchema,
  enrollTagUidSchema,
  reserveChipNameSchema,
  claimSchema,
  transferInitiateSchema,
  transferCompleteSchema,
  releaseSchema,
  reissueRequestSchema,
  reissuePhotoUrlSchema,
  reissueRequestIdSchema,
  disclosureSchema,
  DISCLOSURE_FIELDS,
} from '../services/nfc/tagManagementSchemas';
import { evidenceUploadUrl, evidenceObjectIsValid, isOwnEvidenceKey } from '../lib/reissueEvidence';
import { getStripe } from '../lib/stripe';
import {
  TRANSFER_FEE_CENTS,
  REISSUE_FEE_CENTS,
  resolveCharge,
} from '../lib/tokenFees';
import { notifyTransferRecipient } from '../lib/notifications/transferEmails';
import { hasManageNfc } from '../lib/admin/tokenAdmin';

interface TagRequest extends RequestWithId, AuthRequest {}

const getServiceClient = (): SupabaseClient =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/**
 * Columns safe to read internally. `aes_key_enc` is NEVER read (S-NFC3.5:
 * chip keys are derived from the KMS root, not stored). `sdm_key_version` is
 * added only where the SUN check needs it.
 */
const TAG_COLUMNS =
  'id, tag_uid, lifecycle_status, current_owner_id, seller_id, sun_counter, disclosure, linked_item_id';

type TagRow = {
  id: string;
  tag_uid: string;
  lifecycle_status: string | null;
  current_owner_id: string | null;
  seller_id: string | null;
  sun_counter: number;
  disclosure: Record<string, boolean> | null;
  linked_item_id: string | null;
};

/** A tag row with what the SUN check needs (S-NFC-ID adds the serial). */
type SunTagRow = TagRow & { sdm_key_version: number | null; chip_serial: string | null };

// ── Shared helpers ──────────────────────────────────────────────────────────

const ok = <T>(res: Response, data: T, status = 200) =>
  res.status(status).json({ success: true, data, error: null });

/**
 * Express 5 types a path parameter as `string | string[]` (a repeated segment
 * yields an array). Every route here declares single-segment params, so an
 * array can only come from a malformed path — collapse to the first value and
 * let Zod/uuid validation downstream reject anything unexpected.
 */
const pathParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

/**
 * Maps a terminal or non-claimable lifecycle state onto the brief's error code.
 * Returns null when the tag is in a state the caller may act on.
 */
const terminalStateError = (status: string | null): SecurityResult | null => {
  switch (status) {
    case 'RELEASED':
      return 'token_released';
    case 'RETIRED':
      return 'token_retired';
    case 'SUSPENDED':
      return 'token_suspended';
    default:
      return null;
  }
};

const errorFor = (code: SecurityResult): AppError => {
  // `reason` is the closed-set, machine-readable code the client branches on
  // (CLIENT_REASONS in routes/tagManagement.ts); the message is for humans.
  const withReason = (status: ConstructorParameters<typeof AppError>[0], message: string) =>
    new AppError(status, message, { reason: code });
  switch (code) {
    case 'already_claimed':
      return withReason('conflict', 'This token has already been claimed');
    case 'token_released':
      return withReason('failed_precondition', 'This token has been released and is no longer valid');
    case 'token_retired':
      return withReason('failed_precondition', 'This token has been retired');
    case 'token_suspended':
      return withReason('failed_precondition', 'This token is suspended');
    case 'transfer_pending':
      return withReason('conflict', 'A transfer is already pending for this token');
    case '2fa_required':
      return withReason('permission_denied', 'Two-factor authentication is required');
    case 'forbidden':
      return new AppError('permission_denied', 'Forbidden');
    case 'sun_invalid':
      return new AppError('invalid_argument', 'Tag scan could not be verified. Please tap the tag again');
    case 'invalid_signature':
      return withReason('invalid_argument', 'Tag scan could not be verified. Please tap the tag again');
    case 'replay_detected':
      return withReason('invalid_argument', 'This tap has already been used. Please tap the tag again');
    case 'tap_session_invalid':
      return withReason('invalid_argument', 'Your tap has expired or was already used. Please tap the tag again');
    case 'not_found':
      return new AppError('not_found', 'Not found');
    default:
      return new AppError('invalid_argument', 'Request could not be processed');
  }
};

const emitAuthzDenied = (
  resourceType: 'tag' | 'transfer' | 'reissue',
  resourceId: string | null,
  reason: 'not_owner' | 'previous_owner' | 'not_recipient' | 'role',
  ctx: SecurityLogContext,
): void => {
  emitSecurityEvent({
    event: 'authz.denied',
    resource_type: resourceType,
    resource_id: resourceId,
    reason,
    result: 'forbidden',
    request_id: ctx.requestId,
    actor_id: ctx.actorId,
    actor_type: ctx.actorType,
    ip: ctx.ip,
    route: ctx.route,
  });
};

/**
 * Ownership check for a tag.
 *
 * Distinguishes `previous_owner` from `not_owner` because they are different
 * signals: a previous owner still poking at a tag is a UI or expectation
 * problem, while a stranger doing so is IDOR probing (Rule 5).
 */
const assertTagOwner = async (
  supabase: SupabaseClient,
  tag: TagRow,
  userId: string,
  ctx: SecurityLogContext,
): Promise<void> => {
  if (tag.current_owner_id === userId) return;

  const { data: priorRows } = await supabase
    .from('ownership_transfers')
    .select('id')
    .eq('tag_id', tag.id)
    .eq('from_user_id', userId)
    .limit(1);

  const reason = priorRows && priorRows.length > 0 ? 'previous_owner' : 'not_owner';
  emitAuthzDenied('tag', tag.id, reason, ctx);
  throw errorFor('forbidden');
};

const loadTag = async (
  supabase: SupabaseClient,
  tagId: string,
): Promise<TagRow> => {
  const { data, error } = await supabase
    .from('nfc_tags')
    .select(TAG_COLUMNS)
    .eq('id', tagId)
    .maybeSingle();

  if (error || !data) throw errorFor('not_found');
  return data as unknown as TagRow;
};

type MintedProof = ReturnType<typeof mintOwnershipProof>;

/**
 * Mints an ownership proof WITHOUT touching the database.
 *
 * Every ownership-moving path calls this BEFORE its first write: minting needs
 * the salt envelope key, and a missing key must fail the request while nothing
 * has changed. (2026-10-03: a claim on staging marked chip_001 ACTIVE, then
 * threw on a missing OWNERSHIP_SALT_KEY, leaving an owned token with no
 * Ownership ID.)
 */
const mintProof = (
  params: { tagId: string; ownershipEventId: string; ownershipEventType: 'claim' | 'transfer' },
  ctx: SecurityLogContext,
): MintedProof => mintOwnershipProof(params, ctx);

/**
 * Stores a pre-minted proof as the tag's `current` one and flips the previous
 * one to `stale`, so exactly one current proof exists per tag (enforced by a
 * partial unique index as well).
 *
 * Old and new IDs are never linked in any public output.
 */
const rotateOwnershipProof = async (
  supabase: SupabaseClient,
  minted: MintedProof,
  params: { tagId: string; ownerId: string },
): Promise<string> => {
  await supabase
    .from('ownership_proofs')
    .update({ status: 'stale' })
    .eq('tag_id', params.tagId)
    .eq('status', 'current');

  const { error } = await supabase.from('ownership_proofs').insert({
    tag_id: params.tagId,
    ownership_event_id: minted.ownershipEventId,
    ownership_event_type: minted.ownershipEventType,
    ownership_id: minted.ownershipId,
    tag_ref: minted.tagRef,
    salt_enc: minted.saltEnc,
    owner_id: params.ownerId,
    status: 'current',
  });

  if (error) throw new AppError('internal', 'Could not record ownership proof');
  return minted.ownershipId;
};

const billingCountryFor = async (
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> => {
  // `users.billing_country` (added in 20260919000002). NOT `users.country` —
  // no such column exists. A missing value means charge the USD list price.
  const { data } = await supabase
    .from('users')
    .select('billing_country')
    .eq('id', userId)
    .maybeSingle();

  return (data?.billing_country as string | undefined) ?? null;
};

// ── POST /api/v1/nfc/enroll ─────────────────────────────────────────────────

/**
 * Staff-only. Registers a chip that the encoder has already read back and
 * verified. Lands in ENROLLED with no owner — claiming binds the owner.
 */
export const enrollTag = async (req: TagRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/enroll', 'staff');
  const logger = withLogContext({ requestId: req.requestId, route: '/api/v1/nfc/enroll' });
  const supabase = getServiceClient();

  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  // S-ADMIN1: token admins are admin_users rows with manage_nfc.
  if (!(await hasManageNfc(supabase, userId))) {
    emitAuthzDenied('tag', null, 'role', ctx);
    throw errorFor('forbidden');
  }

  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }
  const { tagUid, tenantId, itemId, chipSerial, sigSha256, chipName } = parsed.data;
  const sdmKeyVersion = parsed.data.sdmKeyVersion ?? currentSdmKeyVersion();
  if ((sdmKeyVersion >= 2) !== (chipSerial !== undefined)) {
    throw new AppError('invalid_argument', 'Key version 2 and later chips must be enrolled with their chipSerial');
  }

  // No key material crosses this API: the chip's SDM keys are derived from
  // the KMS root at encode time and again at verify time. Only the KDF
  // version (and, from v2, the chip's serial) is recorded, so a rotated META
  // key still serves this chip.
  const { data, error } = await supabase
    .from('nfc_tags')
    .insert({
      tag_uid: tagUid.toUpperCase(),
      chip_serial: chipSerial ?? null,
      originality_sig_sha256: sigSha256 ?? null,
      chip_name: chipName ?? null,
      sdm_key_version: sdmKeyVersion,
      seller_id: userId,
      tenant_id: tenantId ?? 'auctionx',
      linked_item_id: itemId ?? null,
      lifecycle_status: 'ENROLLED',
      status: 'registered',
    })
    .select('id')
    .single();

  if (error || !data) {
    emitSecurityEvent({
      event: 'nfc.enroll', tag_id: null, result: 'conflict',
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'staff',
      ip: ctx.ip, route: ctx.route,
    });
    logger.error('nfc_enroll_failed', { error: error?.message });
    throw new AppError('conflict', 'Tag could not be enrolled — this chip, serial or v1 UID may already exist, or its name is not reserved for it');
  }

  emitSecurityEvent({
    event: 'nfc.enroll', tag_id: data.id, result: 'ok',
    request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'staff',
    ip: ctx.ip, route: ctx.route,
  });

  return ok(res, { tagId: data.id, lifecycleStatus: 'ENROLLED' }, 201);
};

// ── POST /api/v1/nfc/enroll/reserve-name ────────────────────────────────────

/**
 * POST /nfc/enroll/reserve-name — the encoder's name check, before any write
 * to the chip (Locked 2026-10-09). No `name` = the next chip_NNN in sequence.
 * The reservation is atomic in the database (reserve_chip_name) and held
 * against the chip's fingerprint, so a re-run of the same chip gets the same
 * name and two encoders can never be handed one name.
 */
export const reserveChipName = async (req: TagRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/enroll/reserve-name', 'staff');
  const logger = withLogContext({ requestId: req.requestId, route: '/api/v1/nfc/enroll/reserve-name' });
  const supabase = getServiceClient();

  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  if (!(await hasManageNfc(supabase, userId))) {
    emitAuthzDenied('tag', null, 'role', ctx);
    throw errorFor('forbidden');
  }

  const parsed = reserveChipNameSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }
  const { sigSha256, name } = parsed.data;

  const { data, error } = await supabase.rpc('reserve_chip_name', {
    p_sig_sha256: sigSha256,
    p_name: name,
    p_actor: userId,
  });

  if (error || typeof data !== 'string' || data.length === 0) {
    const message = error?.message ?? 'no name returned';
    if (message.includes('chip_name_taken')) {
      throw new AppError('conflict', 'That chip name is already in use');
    }
    if (message.includes('chip_already_named')) {
      throw new AppError('conflict', 'This chip is already enrolled under a name');
    }
    // Fail closed: the encoder must not write to a chip without a definite name.
    logger.error('nfc_chip_name_reserve_failed', { error: message });
    throw new AppError('unavailable', 'Chip name could not be reserved');
  }

  logger.info('nfc_chip_name_reserved', { chip_name: data, auto: name === undefined, actor_id: userId });
  return ok(res, { name: data, auto: name === undefined });
};

// ── GET /api/v1/nfc/enroll/precheck/:tagUid ─────────────────────────────────

const tagUidParam = enrollTagUidSchema;

/**
 * S-NFC2 Ph2 encoder guard: may this physical chip be personalised?
 *
 * Called by the encoding station BEFORE any write to the chip. A chip that
 * already exists is never re-personalised, and a RETIRED one never comes back
 * (Locked 2026-10-02: retired chips are never reused). Unlike the public
 * GET /by-uid, a lookup failure is an error, never "not found", so an outage
 * cannot read as "this UID is free". Staff only.
 *
 * S-NFC-ID: with `?serial=&sigSha256=` (v2 encoder) "this chip" means the same
 * physical fingerprint or the same serial. A UID shared with other chips is
 * reported in `uidMatches` but is not a refusal. Without them, the v1 rule
 * (the UID is the chip) applies against v1 rows.
 */
export const enrollPrecheck = async (req: TagRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/enroll/precheck', 'staff');
  const logger = withLogContext({ requestId: req.requestId, route: '/api/v1/nfc/enroll/precheck' });
  const supabase = getServiceClient();

  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  // S-ADMIN1: token admins are admin_users rows with manage_nfc.
  if (!(await hasManageNfc(supabase, userId))) {
    emitAuthzDenied('tag', null, 'role', ctx);
    throw errorFor('forbidden');
  }

  const parsed = tagUidParam.safeParse(req.params.tagUid);
  if (!parsed.success) {
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }
  const query = enrollPrecheckQuerySchema.safeParse(req.query ?? {});
  if (!query.success) {
    throw new AppError('invalid_argument', 'Validation failed', query.error.issues);
  }
  const tagUid = parsed.data.toUpperCase();
  const { serial, sigSha256 } = query.data;

  const registryDown = (message: string): never => {
    logger.error('nfc_enroll_precheck_failed', { error: message });
    throw new AppError('unavailable', 'Tag registry lookup failed');
  };

  if (serial === undefined && sigSha256 === undefined) {
    const { data, error } = await supabase
      .from('nfc_tags')
      .select('id, lifecycle_status')
      .eq('tag_uid', tagUid)
      .is('chip_serial', null)
      .maybeSingle();
    if (error) registryDown(error.message);
    return ok(res, {
      exists: Boolean(data),
      lifecycleStatus: (data?.lifecycle_status as string | null | undefined) ?? null,
      uidMatches: data ? 1 : 0,
    });
  }

  // Both values are regex-validated hex, so they are safe inside the filter.
  const identity = [
    serial !== undefined ? `chip_serial.eq.${serial}` : null,
    sigSha256 !== undefined ? `originality_sig_sha256.eq.${sigSha256}` : null,
  ].filter(Boolean).join(',');
  const [{ data: hits, error: hitError }, { count, error: countError }] = await Promise.all([
    supabase.from('nfc_tags').select('id, lifecycle_status').or(identity),
    supabase.from('nfc_tags').select('id', { count: 'exact', head: true }).eq('tag_uid', tagUid),
  ]);
  if (hitError) registryDown(hitError.message);
  if (countError) registryDown(countError.message);

  const rows = (hits ?? []) as { id: string; lifecycle_status: string | null }[];
  // RETIRED wins: it is the stronger refusal (never reused, Locked 2026-10-02).
  const hit = rows.find((r) => r.lifecycle_status === 'RETIRED') ?? rows[0];
  return ok(res, {
    exists: rows.length > 0,
    lifecycleStatus: hit?.lifecycle_status ?? null,
    uidMatches: count ?? 0,
  });
};

// ── POST /api/v1/nfc/claim ──────────────────────────────────────────────────

/**
 * Origin claim. ENROLLED -> ACTIVE, binding the tag to the caller's account.
 *
 * Only ENROLLED is claimable (Rule 1). There is no re-claim: a holder who
 * skipped a transfer uses the re-issue path instead.
 */
export const claimTag = async (req: TagRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/claim', 'user');
  const supabase = getServiceClient();

  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }
  const body = parsed.data;

  if (!passesTwoFactor(req, 'claim', ctx)) {
    emitSecurityEvent({
      event: 'nfc.claim', tag_id: null, prior_status: null, result: '2fa_required',
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });
    throw errorFor('2fa_required');
  }

  const emitClaim = (tagId: string | null, priorStatus: string | null, result: SecurityResult) =>
    emitSecurityEvent({
      event: 'nfc.claim', tag_id: tagId, prior_status: priorStatus, result,
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });

  let tag: TagRow;
  let tappedCounter: number;
  // A tap session's counter was already burned by POST /nfc/tap; the claim
  // then requires that it is STILL the chip's latest tap rather than burning
  // a new one.
  let viaSession = false;

  if ('tapSession' in body) {
    const session = await consumeTapSession(
      supabase,
      { token: body.tapSession, userId, purpose: 'claim' },
      ctx,
    );
    const sessionTag = session ? await loadTag(supabase, session.tagId).catch(() => null) : null;
    if (!session || !sessionTag || sessionTag.sun_counter !== session.counterValue) {
      emitClaim(sessionTag?.id ?? null, sessionTag?.lifecycle_status ?? null, 'tap_session_invalid');
      throw errorFor('tap_session_invalid');
    }
    tag = sessionTag;
    tappedCounter = session.counterValue;
    viaSession = true;
  } else {
    const { tagUid, sunMessage } = body;
    // S-NFC-ID: chips can share a UID, so a v2 URL's serial picks the row; a
    // serial-less (v1) URL can only ever name a v1 row. A forged serial lands
    // on a row whose keys the tap cannot satisfy.
    const urlSerial = parseSunMessage(sunMessage)?.serial;
    const byUid = supabase
      .from('nfc_tags')
      .select(`${TAG_COLUMNS}, sdm_key_version, chip_serial`)
      .eq('tag_uid', tagUid.toUpperCase());
    const { data: tagRow } = await (urlSerial === undefined
      ? byUid.is('chip_serial', null)
      : byUid.eq('chip_serial', urlSerial)
    ).maybeSingle();

    if (!tagRow) {
      emitUnknownTagSun('claim', ctx);
      throw errorFor('not_found');
    }

    const sunTag = tagRow as unknown as SunTagRow;

    // Possession first: a claim on a tag the caller cannot actually tap is
    // rejected before the lifecycle state is even considered.
    const sun = await verifyFreshSun(
      {
        tagId: sunTag.id,
        tagUid: sunTag.tag_uid,
        chipSerial: sunTag.chip_serial,
        sunMessage,
        keyVersion: sunTag.sdm_key_version,
        lastCounter: sunTag.sun_counter,
      },
      'claim',
      'ok',
      ctx,
    );

    if (!sun.ok || sun.counter === null) {
      const failure = sunFailureCode(sun.sunResult);
      emitClaim(sunTag.id, sunTag.lifecycle_status, failure);
      throw errorFor(failure);
    }
    tag = sunTag;
    tappedCounter = sun.counter;
  }

  const terminal = terminalStateError(tag.lifecycle_status);
  const code: SecurityResult | null =
    terminal ?? (tag.lifecycle_status === 'ENROLLED' ? null : 'already_claimed');

  if (code) {
    emitSecurityEvent({
      event: 'nfc.claim', tag_id: tag.id, prior_status: tag.lifecycle_status, result: code,
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });
    throw errorFor(code);
  }

  // Mint first: a missing salt key must fail before the tag changes state.
  const minted = mintProof(
    { tagId: tag.id, ownershipEventId: tag.id, ownershipEventType: 'claim' },
    ctx,
  );

  // Conditional update. `eq('lifecycle_status', 'ENROLLED')` makes two
  // simultaneous claims safe. Raw SUN: `lt('sun_counter', n)` burns the counter
  // atomically, so the same tap can never be accepted twice even under a race.
  // Tap session: `eq('sun_counter', n)` — the session's tap must still be the
  // latest, so a newer tap by anyone in between supersedes it.
  const claimUpdate = supabase
    .from('nfc_tags')
    .update({
      lifecycle_status: 'ACTIVE',
      current_owner_id: userId,
      sun_counter: tappedCounter,
      activated_at: new Date().toISOString(),
      status: 'active',
    })
    .eq('id', tag.id)
    .eq('lifecycle_status', 'ENROLLED');
  const { data: updated, error: updateError } = await (viaSession
    ? claimUpdate.eq('sun_counter', tappedCounter)
    : claimUpdate.lt('sun_counter', tappedCounter)
  )
    .select('id')
    .maybeSingle();

  if (!updateError && !updated) {
    // Zero rows: find out which guard lost.
    const { data: current } = await supabase
      .from('nfc_tags')
      .select('sun_counter, lifecycle_status')
      .eq('id', tag.id)
      .maybeSingle();
    const stillEnrolled = current?.lifecycle_status === 'ENROLLED';
    if (viaSession && stillEnrolled) {
      // A newer tap landed between redeeming the session and claiming.
      emitClaim(tag.id, tag.lifecycle_status, 'tap_session_invalid');
      throw errorFor('tap_session_invalid');
    }
    // A counter already at/after ours means another request consumed this
    // tap first -> replay.
    const burned = (current?.sun_counter as number | undefined) ?? tappedCounter;
    if (!viaSession && burned >= tappedCounter) {
      emitRaceReplay(tag.id, 'claim', tappedCounter, tag.sun_counter, ctx);
      emitClaim(tag.id, tag.lifecycle_status, 'replay_detected');
      throw errorFor('replay_detected');
    }
  }

  if (updateError || !updated) {
    emitSecurityEvent({
      event: 'nfc.claim', tag_id: tag.id, prior_status: tag.lifecycle_status,
      result: 'already_claimed',
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });
    throw errorFor('already_claimed');
  }

  const ownershipId = await rotateOwnershipProof(supabase, minted, { tagId: tag.id, ownerId: userId });

  emitSecurityEvent({
    event: 'nfc.claim', tag_id: tag.id, prior_status: 'ENROLLED', result: 'ok',
    request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
    ip: ctx.ip, route: ctx.route,
  });

  return ok(res, { tagId: tag.id, lifecycleStatus: 'ACTIVE', ownershipId });
};

// ── POST /api/v1/nfc/transfer/initiate ──────────────────────────────────────

/**
 * Owner initiates. Creates a PENDING transfer and locks release.
 *
 * The recipient may be an existing account or a bare email with no account
 * (Rule 3) — they register, then complete.
 */
export const initiateTransfer = async (req: TagRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/transfer/initiate', 'user');
  const supabase = getServiceClient();

  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const parsed = transferInitiateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }
  const { tagId, transferType, toUserId, toEmail, feePayer } = parsed.data;

  const tag = await loadTag(supabase, tagId);
  await assertTagOwner(supabase, tag, userId, ctx);

  const emitTransfer = (result: SecurityResult, transferId: string | null) =>
    emitSecurityEvent({
      event: 'nfc.transfer',
      tag_id: tag.id,
      transfer_id: transferId,
      action: 'initiate',
      transfer_type: transferType,
      fee_payer: feePayer,
      payment_method: 'card',
      to_email_hash: hashEmailForLog(toEmail),
      result,
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });

  const terminal = terminalStateError(tag.lifecycle_status);
  if (terminal || tag.lifecycle_status !== 'ACTIVE') {
    const code = terminal ?? 'invalid_argument';
    emitTransfer(code, null);
    throw errorFor(code);
  }

  const { data: pending } = await supabase
    .from('ownership_transfers')
    .select('id')
    .eq('tag_id', tag.id)
    .eq('status', 'PENDING')
    .limit(1);

  if (pending && pending.length > 0) {
    emitTransfer('transfer_pending', pending[0].id);
    throw errorFor('transfer_pending');
  }

  const { data: created, error } = await supabase
    .from('ownership_transfers')
    .insert({
      tag_id: tag.id,
      from_user_id: userId,
      to_user_id: toUserId ?? null,
      to_email: toEmail?.trim().toLowerCase() ?? null,
      transfer_type: transferType === 'gift' ? 'GIFT' : 'SALE',
      status: 'PENDING',
      fee_payer: feePayer,
      payment_method: 'card',
      list_amount_usd_cents: TRANSFER_FEE_CENTS,
      transfer_fee_cents: TRANSFER_FEE_CENTS,
      initiated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !created) {
    // The partial unique index on (tag_id) WHERE status='PENDING' is the
    // backstop against a race that slipped past the SELECT above.
    emitTransfer('transfer_pending', null);
    throw errorFor('transfer_pending');
  }

  emitSecurityEvent({
    event: 'transfer.state_change',
    transfer_id: created.id, from: null, to: 'PENDING', trigger: 'client', result: 'ok',
    request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
    ip: ctx.ip, route: ctx.route,
  });
  emitTransfer('ok', created.id);

  // After the row exists, never before: an email for a transfer that failed
  // to persist would point the recipient at nothing. Delivery never blocks.
  await notifyTransferRecipient(supabase, 'initiated', {
    transferId: created.id,
    transferType: transferType === 'gift' ? 'GIFT' : 'SALE',
    toUserId: toUserId ?? null,
    toEmail: toEmail?.trim().toLowerCase() ?? null,
    feeCents: TRANSFER_FEE_CENTS,
  });

  return ok(res, {
    transferId: created.id,
    status: 'PENDING',
    listAmountUsdCents: TRANSFER_FEE_CENTS,
  }, 201);
};

// ── POST /api/v1/nfc/transfer/:id/complete ──────────────────────────────────

/**
 * Recipient taps the tag and pays. Creates the PaymentIntent and returns its
 * client secret.
 *
 * THIS ENDPOINT NEVER COMPLETES THE TRANSFER. The row moves to COMPLETED only
 * when the Stripe webhook confirms `payment_intent.succeeded` — the client
 * response is not evidence of payment, and treating it as such would be a free
 * path around the fee.
 */
export const completeTransfer = async (req: TagRequest, res: Response) => {
  const route = '/api/v1/nfc/transfer/:id/complete';
  const ctx = securityContext(req, route, 'user');
  const supabase = getServiceClient();

  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const transferId = pathParam(req.params.id);
  const parsed = transferCompleteSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }
  const body = parsed.data;

  const { data: transfer } = await supabase
    .from('ownership_transfers')
    .select('id, tag_id, from_user_id, to_user_id, to_email, status, transfer_type, fee_payer, stripe_payment_intent_id')
    .eq('id', transferId)
    .maybeSingle();

  if (!transfer) throw errorFor('not_found');

  const transferType = transfer.transfer_type === 'GIFT' ? 'gift' : 'sale';
  const emitTransfer = (result: SecurityResult) =>
    emitSecurityEvent({
      event: 'nfc.transfer',
      tag_id: transfer.tag_id,
      transfer_id: transfer.id,
      action: 'complete_attempt',
      transfer_type: transferType,
      fee_payer: transfer.fee_payer === 'SELLER' ? 'SELLER' : 'BUYER',
      payment_method: 'card',
      to_email_hash: hashEmailForLog(transfer.to_email),
      result,
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });

  if (transfer.status !== 'PENDING') {
    emitTransfer('conflict');
    throw new AppError('conflict', 'This transfer is no longer pending');
  }

  // Recipient check. An email-targeted transfer resolves on first completion
  // attempt by the account that owns that address.
  const { data: actor } = await supabase.from('users').select('email').eq('id', userId).maybeSingle();
  const actorEmail = (actor?.email as string | undefined)?.trim().toLowerCase() ?? null;

  const isRecipient =
    (transfer.to_user_id !== null && transfer.to_user_id === userId) ||
    (transfer.to_user_id === null &&
      transfer.to_email !== null &&
      actorEmail !== null &&
      transfer.to_email === actorEmail);

  if (!isRecipient) {
    emitAuthzDenied('transfer', transfer.id, 'not_recipient', ctx);
    emitTransfer('forbidden');
    throw errorFor('forbidden');
  }

  if (!passesTwoFactor(req, 'transfer_complete', ctx)) {
    emitTransfer('2fa_required');
    throw errorFor('2fa_required');
  }

  const { data: tagRow } = await supabase
    .from('nfc_tags')
    .select(`${TAG_COLUMNS}, sdm_key_version, chip_serial`)
    .eq('id', transfer.tag_id)
    .maybeSingle();

  if (!tagRow) {
    emitUnknownTagSun('transfer_complete', ctx);
    throw errorFor('not_found');
  }
  const tag = tagRow as unknown as SunTagRow;

  // Rule 2: a fresh tap by the RECIPIENT. This is what stops a remote buyer
  // from completing a transfer for goods they never received.
  if ('tapSession' in body) {
    // The session's counter was burned by POST /nfc/tap. It must be for THIS
    // transfer's chip and still be that chip's latest tap.
    const session = await consumeTapSession(
      supabase,
      { token: body.tapSession, userId, purpose: 'transfer_complete' },
      ctx,
    );
    if (!session || session.tagId !== tag.id || session.counterValue !== tag.sun_counter) {
      emitTransfer('tap_session_invalid');
      throw errorFor('tap_session_invalid');
    }
  } else {
    const { tagUid, sunMessage } = body;
    // The UID the recipient names must be this transfer's chip; a URL from any
    // other chip fails as uid_mismatch inside verifyFreshSun.
    if (tagUid.toUpperCase() !== tag.tag_uid.toUpperCase()) {
      emitSunVerify(tag.id, 'transfer_complete', 'uid_mismatch', null, tag.sun_counter, 'invalid_signature', ctx);
      emitTransfer('invalid_signature');
      throw errorFor('invalid_signature');
    }

    const sun = await verifyFreshSun(
      {
        tagId: tag.id,
        tagUid: tag.tag_uid,
        chipSerial: tag.chip_serial,
        sunMessage,
        keyVersion: tag.sdm_key_version,
        lastCounter: tag.sun_counter,
      },
      'transfer_complete',
      'ok',
      ctx,
    );

    if (!sun.ok || sun.counter === null) {
      const failure = sunFailureCode(sun.sunResult);
      emitTransfer(failure);
      throw errorFor(failure);
    }
    const tappedCounter = sun.counter;

    // Burn the counter now, so a captured tap cannot be replayed against a second
    // attempt even though the transfer is still PENDING. Conditional: if another
    // request already burned this (or a later) counter, zero rows -> replay.
    const { data: burned, error: burnError } = await supabase
      .from('nfc_tags')
      .update({ sun_counter: tappedCounter })
      .eq('id', tag.id)
      .lt('sun_counter', tappedCounter)
      .select('id');

    if (burnError) {
      // A database failure is not evidence of a replay — don't report it as one.
      withLogContext({ requestId: ctx.requestId, route: ctx.route }).error('transfer_counter_burn_failed', {
        tagId: tag.id,
        error: burnError.message,
      });
      throw new AppError('internal', 'Failed to record transfer tap');
    }
    if (!burned || burned.length === 0) {
      emitRaceReplay(tag.id, 'transfer_complete', tappedCounter, tag.sun_counter, ctx);
      emitTransfer('replay_detected');
      throw errorFor('replay_detected');
    }
  }

  // Resolve the recipient onto the row now that they have been identified.
  // This MUST land before any PaymentIntent exists: the webhook can only move
  // ownership to `to_user_id`, so a payment taken without it strands the money
  // (2026-10-03 staging: a CHECK violation here failed silently, the buyer paid,
  // and the transfer stayed PENDING).
  if (transfer.to_user_id === null) {
    const { data: resolved, error: resolveError } = await supabase
      .from('ownership_transfers')
      .update({ to_user_id: userId })
      .eq('id', transfer.id)
      .eq('status', 'PENDING')
      .select('id')
      .maybeSingle();

    if (resolveError || !resolved) {
      withLogContext({ requestId: ctx.requestId, route: ctx.route }).error('transfer_recipient_resolve_failed', {
        transferId: transfer.id,
        error: resolveError?.message ?? 'no row updated',
      });
      emitTransfer('internal');
      throw new AppError('internal', 'We could not start this payment. You have not been charged. Please try again.');
    }
  }

  const payerId = transfer.fee_payer === 'SELLER' ? transfer.from_user_id : userId;
  const charge = resolveCharge(TRANSFER_FEE_CENTS, payerId ? await billingCountryFor(supabase, payerId) : null);

  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create(
    {
      amount: charge.chargedAmount,
      currency: charge.chargedCurrency,
      metadata: {
        // Everything the webhook needs to resolve the row, and nothing else.
        transfer_id: transfer.id,
        tag_id: tag.id,
        kind: 'token_transfer_fee',
      },
      automatic_payment_methods: { enabled: true },
    },
    // Keyed by transfer id: a retried request reuses the same PaymentIntent
    // instead of charging twice.
    { idempotencyKey: `token-transfer-fee-${transfer.id}` },
  );

  await supabase
    .from('ownership_transfers')
    .update({
      stripe_payment_intent_id: intent.id,
      list_amount_usd_cents: charge.listAmountUsdCents,
      charged_amount: charge.chargedAmount,
      charged_currency: charge.chargedCurrency,
      fx_rate: charge.fxRate,
    })
    .eq('id', transfer.id);

  emitTransfer('ok');

  return ok(res, {
    transferId: transfer.id,
    // Still PENDING. The webhook is what advances it.
    status: 'PENDING',
    clientSecret: intent.client_secret,
    listAmountUsdCents: charge.listAmountUsdCents,
    chargedAmount: charge.chargedAmount,
    chargedCurrency: charge.chargedCurrency,
    fxRate: charge.fxRate,
  });
};

// ── POST /api/v1/nfc/transfer/:id/cancel ────────────────────────────────────

export const cancelTransfer = async (req: TagRequest, res: Response) => {
  const route = '/api/v1/nfc/transfer/:id/cancel';
  const ctx = securityContext(req, route, 'user');
  const supabase = getServiceClient();

  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const { data: transfer } = await supabase
    .from('ownership_transfers')
    .select('id, tag_id, from_user_id, to_user_id, to_email, status, transfer_type, fee_payer, transfer_fee_cents')
    .eq('id', pathParam(req.params.id))
    .maybeSingle();

  if (!transfer) throw errorFor('not_found');

  const emitTransfer = (result: SecurityResult) =>
    emitSecurityEvent({
      event: 'nfc.transfer',
      tag_id: transfer.tag_id, transfer_id: transfer.id, action: 'cancel',
      transfer_type: transfer.transfer_type === 'GIFT' ? 'gift' : 'sale',
      fee_payer: transfer.fee_payer === 'SELLER' ? 'SELLER' : 'BUYER',
      payment_method: 'card',
      to_email_hash: hashEmailForLog(transfer.to_email),
      result,
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });

  if (transfer.from_user_id !== userId) {
    emitAuthzDenied('transfer', transfer.id, 'not_owner', ctx);
    emitTransfer('forbidden');
    throw errorFor('forbidden');
  }

  if (transfer.status !== 'PENDING') {
    emitTransfer('conflict');
    throw new AppError('conflict', 'This transfer is no longer pending');
  }

  // Zero rows means a webhook or another cancel won the race. Check before
  // telling the recipient anything.
  const { data: cancelled, error: cancelError } = await supabase
    .from('ownership_transfers')
    .update({ status: 'CANCELLED' })
    .eq('id', transfer.id)
    .eq('status', 'PENDING')
    .select('id')
    .maybeSingle();

  if (cancelError || !cancelled) {
    emitTransfer('conflict');
    throw new AppError('conflict', 'This transfer is no longer pending');
  }

  emitSecurityEvent({
    event: 'transfer.state_change',
    transfer_id: transfer.id, from: 'PENDING', to: 'CANCELLED', trigger: 'client', result: 'ok',
    request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
    ip: ctx.ip, route: ctx.route,
  });
  emitTransfer('ok');

  await notifyTransferRecipient(supabase, 'cancelled', {
    transferId: transfer.id,
    transferType: transfer.transfer_type === 'GIFT' ? 'GIFT' : 'SALE',
    toUserId: transfer.to_user_id,
    toEmail: transfer.to_email,
    feeCents: transfer.transfer_fee_cents ?? TRANSFER_FEE_CENTS,
  });

  return ok(res, { transferId: transfer.id, status: 'CANCELLED' });
};

// ── POST /api/v1/nfc/release ────────────────────────────────────────────────

/**
 * Permanently kills the token. Free, owner-only, terminal, irreversible.
 *
 * Release is NEVER a gift mechanism (Rule 6) — a released tag cannot be claimed
 * by anyone, which is exactly why it is safe to make it free.
 */
export const releaseTag = async (req: TagRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/release', 'user');
  const supabase = getServiceClient();

  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const parsed = releaseSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }

  const tag = await loadTag(supabase, parsed.data.tagId);
  await assertTagOwner(supabase, tag, userId, ctx);

  const emitRelease = (result: SecurityResult) =>
    emitSecurityEvent({
      event: 'nfc.release', tag_id: tag.id, result,
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });

  const terminal = terminalStateError(tag.lifecycle_status);
  if (terminal) {
    emitRelease(terminal);
    throw errorFor(terminal);
  }

  // Rule 5: a sender cannot release out from under a pending transfer.
  const { data: pending } = await supabase
    .from('ownership_transfers')
    .select('id')
    .eq('tag_id', tag.id)
    .eq('status', 'PENDING')
    .limit(1);

  if (pending && pending.length > 0) {
    emitRelease('transfer_pending');
    throw errorFor('transfer_pending');
  }

  const { data: updated } = await supabase
    .from('nfc_tags')
    .update({ lifecycle_status: 'RELEASED', current_owner_id: null, status: 'released' })
    .eq('id', tag.id)
    .eq('lifecycle_status', 'ACTIVE')
    .select('id')
    .maybeSingle();

  if (!updated) {
    emitRelease('conflict');
    throw new AppError('conflict', 'Token could not be released');
  }

  // The proof goes stale with the token: there is no current owner any more.
  await supabase
    .from('ownership_proofs')
    .update({ status: 'stale' })
    .eq('tag_id', tag.id)
    .eq('status', 'current');

  emitRelease('ok');

  return ok(res, { tagId: tag.id, lifecycleStatus: 'RELEASED', irreversible: true });
};

// ── POST /api/v1/nfc/replace — REMOVED (S-ADMIN1) ──────────────────────────
// The non-atomic replace is gone. The token reset is admin-only and runs as one
// database transaction: POST /api/v1/admin/tags/:tagId/reset
// (controllers/adminTagController.ts). The route now answers 410.

// ── Re-issue (owner side) — S-ADMIN1 Ph2 ────────────────────────────────────
//
// A re-issue replaces a chip that is coming loose, BEFORE it falls off, for the
// registered owner. A chip that has already come off is not replaced (Boss,
// 2026-10-09: otherwise anyone could peel a chip and claim it "fell off").
//
//   request (tap + photos) -> admin approves -> owner pays on the WEBSITE
//   -> webhook marks PAID -> admin fulfils onto a new chip
//
// Not advertised in the UI. Payment is web only (no app store fees).

const REISSUE_OWNER_COLUMNS =
  'id, tag_id, requester_id, status, payment_status, stripe_payment_intent_id, list_amount_usd_cents, charged_amount, charged_currency, fx_rate, created_at, reviewed_at, paid_at, fulfilled_at, new_tag_id';

type ReissueOwnerRow = {
  id: string;
  tag_id: string;
  requester_id: string;
  status: string;
  payment_status: string | null;
  stripe_payment_intent_id: string | null;
  list_amount_usd_cents: number | null;
  charged_amount: number | null;
  charged_currency: string | null;
  fx_rate: number | null;
  created_at: string;
  reviewed_at: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  new_tag_id: string | null;
};

const emitReissueStep = (
  ctx: SecurityLogContext,
  action: 'request' | 'photo_url' | 'pay' | 'cancel',
  tagId: string | null,
  reissueRequestId: string | null,
  result: SecurityResult,
): void => {
  emitSecurityEvent({
    event: 'nfc.reissue_request', action, tag_id: tagId, reissue_request_id: reissueRequestId, result,
    request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
    ip: ctx.ip, route: ctx.route,
  });
};

/** What the owner sees. No reviewer identity or admin reason (internal). */
const toOwnerReissue = (row: ReissueOwnerRow) => ({
  id: row.id,
  tagId: row.tag_id,
  status: row.status,
  paymentStatus: row.payment_status,
  listAmountUsdCents: row.list_amount_usd_cents,
  chargedAmount: row.charged_amount,
  chargedCurrency: row.charged_currency,
  createdAt: row.created_at,
  reviewedAt: row.reviewed_at,
  paidAt: row.paid_at,
  fulfilledAt: row.fulfilled_at,
  newTagId: row.new_tag_id,
});

/**
 * Loads a request the caller filed. Anyone else's request is reported as not
 * found (no existence oracle), with an authz.denied event for the probe.
 */
const loadOwnReissue = async (
  supabase: SupabaseClient,
  rawId: string | string[] | undefined,
  userId: string,
  ctx: SecurityLogContext,
): Promise<ReissueOwnerRow> => {
  const parsed = reissueRequestIdSchema.safeParse(pathParam(rawId));
  if (!parsed.success) throw errorFor('not_found');

  const { data, error } = await supabase
    .from('reissue_requests')
    .select(REISSUE_OWNER_COLUMNS)
    .eq('id', parsed.data)
    .maybeSingle();

  if (error) throw new AppError('unavailable', 'Request could not be loaded');
  const row = data as unknown as ReissueOwnerRow | null;
  if (!row) throw errorFor('not_found');
  if (row.requester_id !== userId) {
    emitAuthzDenied('reissue', row.id, 'not_owner', ctx);
    throw errorFor('not_found');
  }
  return row;
};

// ── POST /api/v1/nfc/reissue-request/photo-url ──────────────────────────────

/** One presigned PUT for one evidence photo, under the caller's own prefix. */
export const reissuePhotoUrl = async (req: TagRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/reissue-request/photo-url', 'user');
  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const parsed = reissuePhotoUrlSchema.safeParse(req.body);
  if (!parsed.success) {
    emitReissueStep(ctx, 'photo_url', null, null, 'invalid_argument');
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }

  const { uploadUrl, key } = await evidenceUploadUrl(userId, parsed.data.sizeBytes);
  emitReissueStep(ctx, 'photo_url', null, null, 'ok');
  return ok(res, { uploadUrl, key, contentType: parsed.data.contentType });
};

// ── POST /api/v1/nfc/reissue-request ────────────────────────────────────────

/**
 * Files a re-issue request. Requires, in this order (cheap checks first, the
 * single-use tap is spent last so a rejected request does not waste it):
 *   1. the caller is the registered owner of an ACTIVE token;
 *   2. no request is already open for the token;
 *   3. 1–3 photos under the caller's own prefix, really uploaded, JPEG, size-capped;
 *   4. a live tap session for THIS chip that is still its latest tap.
 *
 * Prices the request (snapshot) and creates NO PaymentIntent: the fee is
 * charged only after an admin approves (Locked 2026-09-19).
 */
export const requestReissue = async (req: TagRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/reissue-request', 'user');
  const supabase = getServiceClient();

  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const parsed = reissueRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    emitReissueStep(ctx, 'request', null, null, 'invalid_argument');
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }
  const { tagId, tapSession, photoKeys } = parsed.data;

  const tag = await loadTag(supabase, tagId);

  const terminal = terminalStateError(tag.lifecycle_status);
  if (terminal) {
    emitReissueStep(ctx, 'request', tag.id, null, terminal);
    throw errorFor(terminal);
  }

  // Owner only. A holder whose transfer was skipped is NOT served here: AM
  // cannot tell bought from stolen without a real transfer.
  await assertTagOwner(supabase, tag, userId, ctx);

  // Same rule as the one-open-per-tag index: PENDING, or APPROVED and not yet
  // fulfilled. Checked here so a duplicate does not spend the owner's tap.
  const { data: existing, error: openError } = await supabase
    .from('reissue_requests')
    .select('id, status, fulfilled_at')
    .eq('tag_id', tag.id)
    .in('status', ['PENDING', 'APPROVED']);
  if (openError) throw new AppError('unavailable', 'Request could not be checked');
  const open = ((existing ?? []) as Array<{ status: string; fulfilled_at: string | null }>)
    .filter((r) => r.status === 'PENDING' || !r.fulfilled_at);
  if (open.length > 0) {
    emitReissueStep(ctx, 'request', tag.id, null, 'conflict');
    throw new AppError('conflict', 'A replacement request is already open for this token');
  }

  if (!photoKeys.every((key) => isOwnEvidenceKey(key, userId))) {
    emitReissueStep(ctx, 'request', tag.id, null, 'invalid_argument');
    throw new AppError('invalid_argument', 'A photo could not be found. Please take it again.');
  }
  const photosValid = await Promise.all(photoKeys.map(evidenceObjectIsValid));
  if (!photosValid.every(Boolean)) {
    emitReissueStep(ctx, 'request', tag.id, null, 'invalid_argument');
    throw new AppError('invalid_argument', 'A photo could not be found. Please take it again.');
  }

  const session = await consumeTapSession(
    supabase,
    { token: tapSession, userId, purpose: 'reissue_request' },
    ctx,
  );
  if (!session || session.tagId !== tag.id || session.counterValue !== tag.sun_counter) {
    emitReissueStep(ctx, 'request', tag.id, null, 'tap_session_invalid');
    throw errorFor('tap_session_invalid');
  }

  const charge = resolveCharge(REISSUE_FEE_CENTS, await billingCountryFor(supabase, userId));

  const { data: created, error } = await supabase
    .from('reissue_requests')
    .insert({
      tag_id: tag.id,
      requester_id: userId,
      status: 'PENDING',
      tap_session_id: session.id,
      photo_keys: photoKeys,
      list_amount_usd_cents: charge.listAmountUsdCents,
      charged_amount: charge.chargedAmount,
      charged_currency: charge.chargedCurrency,
      fx_rate: charge.fxRate,
    })
    .select('id')
    .single();

  if (error || !created) {
    // 23505: the one-open-request index (a concurrent request won the race).
    const conflict = error?.code === '23505';
    emitReissueStep(ctx, 'request', tag.id, null, conflict ? 'conflict' : 'internal');
    if (!conflict) {
      withLogContext({ requestId: ctx.requestId, route: ctx.route }).error('reissue_request_insert_failed', {
        tagId: tag.id,
        error: error?.message ?? 'no row returned',
      });
    }
    throw conflict
      ? new AppError('conflict', 'A replacement request is already open for this token')
      : new AppError('internal', 'Your request could not be saved. Please try again.');
  }

  emitReissueStep(ctx, 'request', tag.id, created.id, 'ok');

  return ok(res, {
    reissueRequestId: created.id,
    status: 'PENDING',
    listAmountUsdCents: charge.listAmountUsdCents,
    chargedAmount: charge.chargedAmount,
    chargedCurrency: charge.chargedCurrency,
  }, 201);
};

// ── GET /api/v1/nfc/reissue-requests/mine ───────────────────────────────────

export const listMyReissueRequests = async (req: TagRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const { data, error } = await getServiceClient()
    .from('reissue_requests')
    .select(REISSUE_OWNER_COLUMNS)
    .eq('requester_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw new AppError('unavailable', 'Requests could not be loaded');
  return ok(res, { requests: ((data ?? []) as unknown as ReissueOwnerRow[]).map(toOwnerReissue) });
};

// ── POST /api/v1/nfc/reissue-requests/:id/pay ───────────────────────────────

/**
 * Creates (or returns) the PaymentIntent for an APPROVED request awaiting
 * payment. Nothing here marks it paid: only the token-fee webhook does.
 *
 * The PaymentIntent id is stored BEFORE the client secret is returned, so a
 * payment can never exist that the webhook cannot bind to its request
 * (lesson 2026-10-03: a payment taken without its row strands the money).
 */
export const payReissue = async (req: TagRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/reissue-requests/:id/pay', 'user');
  const logger = withLogContext({ requestId: ctx.requestId, route: ctx.route });
  const supabase = getServiceClient();
  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const row = await loadOwnReissue(supabase, req.params.id, userId, ctx);

  if (row.status !== 'APPROVED' || row.payment_status !== 'AWAITING_PAYMENT' || row.fulfilled_at) {
    emitReissueStep(ctx, 'pay', row.tag_id, row.id, 'conflict');
    throw new AppError('failed_precondition', 'This request is not waiting for payment');
  }
  if (!row.charged_amount || !row.charged_currency) {
    logger.error('reissue_pay_unpriced', { reissueRequestId: row.id });
    throw new AppError('internal', 'We could not start this payment. You have not been charged.');
  }

  // The token may have changed hands since approval.
  const tag = await loadTag(supabase, row.tag_id);
  if (tag.current_owner_id !== userId) {
    emitAuthzDenied('reissue', row.id, 'not_owner', ctx);
    emitReissueStep(ctx, 'pay', row.tag_id, row.id, 'forbidden');
    throw errorFor('forbidden');
  }

  const stripe = getStripe();

  if (row.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id);
    emitReissueStep(ctx, 'pay', row.tag_id, row.id, 'ok');
    return ok(res, {
      reissueRequestId: row.id,
      clientSecret: existing.client_secret,
      chargedAmount: row.charged_amount,
      chargedCurrency: row.charged_currency,
      listAmountUsdCents: row.list_amount_usd_cents,
    });
  }

  const intent = await stripe.paymentIntents.create(
    {
      amount: row.charged_amount,
      currency: row.charged_currency,
      metadata: {
        // Everything the webhook needs, and nothing else.
        reissue_request_id: row.id,
        tag_id: row.tag_id,
        kind: 'token_reissue_fee',
      },
      automatic_payment_methods: { enabled: true },
    },
    // Keyed by request id: a retried call reuses the same PaymentIntent.
    { idempotencyKey: `token-reissue-fee-${row.id}` },
  );

  const { data: stored, error: storeError } = await supabase
    .from('reissue_requests')
    .update({ stripe_payment_intent_id: intent.id })
    .eq('id', row.id)
    .eq('payment_status', 'AWAITING_PAYMENT')
    .is('stripe_payment_intent_id', null)
    .select('id')
    .maybeSingle();

  if (storeError || !stored) {
    // A concurrent call may have stored the SAME intent (same idempotency key).
    const { data: again } = await supabase
      .from('reissue_requests')
      .select('stripe_payment_intent_id')
      .eq('id', row.id)
      .maybeSingle();
    if (again?.stripe_payment_intent_id !== intent.id) {
      logger.error('reissue_pay_store_failed', {
        reissueRequestId: row.id,
        error: storeError?.message ?? 'no row updated',
      });
      emitReissueStep(ctx, 'pay', row.tag_id, row.id, 'internal');
      throw new AppError('internal', 'We could not start this payment. You have not been charged. Please try again.');
    }
  }

  emitReissueStep(ctx, 'pay', row.tag_id, row.id, 'ok');
  return ok(res, {
    reissueRequestId: row.id,
    clientSecret: intent.client_secret,
    chargedAmount: row.charged_amount,
    chargedCurrency: row.charged_currency,
    listAmountUsdCents: row.list_amount_usd_cents,
  });
};

// ── POST /api/v1/nfc/reissue-requests/:id/cancel ────────────────────────────

/**
 * The owner withdraws a request that is still PENDING or awaiting payment.
 * An open PaymentIntent is cancelled in Stripe FIRST: if it already succeeded,
 * the request is paid and can no longer be cancelled here.
 */
export const cancelReissue = async (req: TagRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/reissue-requests/:id/cancel', 'user');
  const logger = withLogContext({ requestId: ctx.requestId, route: ctx.route });
  const supabase = getServiceClient();
  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const row = await loadOwnReissue(supabase, req.params.id, userId, ctx);

  const cancellable =
    row.status === 'PENDING' ||
    (row.status === 'APPROVED' && row.payment_status === 'AWAITING_PAYMENT' && !row.fulfilled_at);
  if (!cancellable) {
    emitReissueStep(ctx, 'cancel', row.tag_id, row.id, 'conflict');
    throw new AppError('failed_precondition', 'This request can no longer be cancelled');
  }

  if (row.stripe_payment_intent_id) {
    const stripe = getStripe();
    try {
      await stripe.paymentIntents.cancel(row.stripe_payment_intent_id);
    } catch {
      const intent = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id);
      if (intent.status !== 'canceled') {
        emitReissueStep(ctx, 'cancel', row.tag_id, row.id, 'conflict');
        throw new AppError('failed_precondition', 'This request has already been paid and can no longer be cancelled');
      }
    }
  }

  let update = supabase
    .from('reissue_requests')
    .update({ status: 'CANCELLED' })
    .eq('id', row.id)
    .eq('status', row.status);
  update = row.payment_status === null
    ? update.is('payment_status', null)
    : update.eq('payment_status', row.payment_status);
  const { data: cancelled, error } = await update.select('id').maybeSingle();

  if (error || !cancelled) {
    if (error) logger.error('reissue_cancel_failed', { reissueRequestId: row.id, error: error.message });
    emitReissueStep(ctx, 'cancel', row.tag_id, row.id, error ? 'internal' : 'conflict');
    throw error
      ? new AppError('internal', 'The request could not be cancelled. Please try again.')
      : new AppError('failed_precondition', 'This request changed while you were cancelling it. Please refresh.');
  }

  emitReissueStep(ctx, 'cancel', row.tag_id, row.id, 'ok');
  return ok(res, { reissueRequestId: row.id, status: 'CANCELLED' });
};

// ── PATCH /api/v1/nfc/:tagId/disclosure ─────────────────────────────────────

/**
 * Sets which origin fields the public verify page shows. Owner-only.
 *
 * This is only the owner's half of the gate: `public_tag_provenance` also
 * requires the item creator's own release flags, so turning a field on here
 * cannot publish something the creator kept private.
 */
export const updateDisclosure = async (req: TagRequest, res: Response) => {
  const route = '/api/v1/nfc/:tagId/disclosure';
  const ctx = securityContext(req, route, 'user');
  const supabase = getServiceClient();

  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const parsed = disclosureSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }

  const tag = await loadTag(supabase, pathParam(req.params.tagId));
  await assertTagOwner(supabase, tag, userId, ctx);

  const terminal = terminalStateError(tag.lifecycle_status);
  if (terminal) {
    emitSecurityEvent({
      event: 'nfc.disclosure_change', tag_id: tag.id, fields_changed: [], result: terminal,
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });
    throw errorFor(terminal);
  }

  const current = tag.disclosure ?? {};
  const next = { ...current, ...parsed.data };

  // Field NAMES only — never the values, and never a name outside the enum.
  const changed = DISCLOSURE_FIELDS.filter(
    (f) => parsed.data[f] !== undefined && parsed.data[f] !== current[f],
  );

  await supabase.from('nfc_tags').update({ disclosure: next }).eq('id', tag.id);

  emitSecurityEvent({
    event: 'nfc.disclosure_change', tag_id: tag.id, fields_changed: changed, result: 'ok',
    request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
    ip: ctx.ip, route: ctx.route,
  });

  return ok(res, { tagId: tag.id, disclosure: next });
};
