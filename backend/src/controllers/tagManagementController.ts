/**
 * S-NFC3 — Tag Management API (rev 2).
 *
 * The complete token lifecycle with no marketplace dependency:
 *   enroll -> origin claim -> two-sided transfer -> release / replace / re-issue
 *
 * Lifecycle (nfc_tags.lifecycle_status):
 *   ENROLLED --claim--> ACTIVE --transfer--> ACTIVE (new owner)
 *   ACTIVE --release--> RELEASED (terminal)
 *   ACTIVE --replace/reissue--> RETIRED (terminal)
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

import { randomUUID } from 'crypto';
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
import { consumeTapSession } from '../services/nfc/tapSession';
import {
  enrollSchema,
  claimSchema,
  transferInitiateSchema,
  transferCompleteSchema,
  releaseSchema,
  replaceSchema,
  reissueRequestSchema,
  disclosureSchema,
  DISCLOSURE_FIELDS,
} from '../services/nfc/tagManagementSchemas';
import { getStripe } from '../lib/stripe';
import {
  TRANSFER_FEE_CENTS,
  REISSUE_FEE_CENTS,
  resolveCharge,
} from '../lib/tokenFees';

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

const isStaff = async (supabase: SupabaseClient, userId: string): Promise<boolean> => {
  const { data } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
  // user_role enum is lowercase (Every-Session lesson).
  return data?.role === 'admin' || data?.role === 'super_admin';
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

  if (!(await isStaff(supabase, userId))) {
    emitAuthzDenied('tag', null, 'role', ctx);
    throw errorFor('forbidden');
  }

  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }
  const { tagUid, tenantId, itemId } = parsed.data;

  // No key material crosses this API: the chip's SDM keys are derived from
  // the KMS root at encode time and again at verify time. Only the KDF
  // version is recorded, so a rotated META key still serves this chip.
  const { data, error } = await supabase
    .from('nfc_tags')
    .insert({
      tag_uid: tagUid.toUpperCase(),
      sdm_key_version: currentSdmKeyVersion(),
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
    throw new AppError('conflict', 'Tag could not be enrolled — the UID may already exist');
  }

  emitSecurityEvent({
    event: 'nfc.enroll', tag_id: data.id, result: 'ok',
    request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'staff',
    ip: ctx.ip, route: ctx.route,
  });

  return ok(res, { tagId: data.id, lifecycleStatus: 'ENROLLED' }, 201);
};

// ── GET /api/v1/nfc/enroll/precheck/:tagUid ─────────────────────────────────

const tagUidParam = enrollSchema.shape.tagUid;

/**
 * S-NFC2 Ph2 encoder guard: may this physical chip be personalised?
 *
 * Called by the encoding station BEFORE any write to the chip. A UID that
 * already exists is never re-personalised, and a RETIRED one never comes back
 * (Locked 2026-10-02: retired chips are never reused). Unlike the public
 * GET /by-uid, a lookup failure is an error, never "not found", so an outage
 * cannot read as "this UID is free". Staff only.
 */
export const enrollPrecheck = async (req: TagRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/enroll/precheck', 'staff');
  const logger = withLogContext({ requestId: req.requestId, route: '/api/v1/nfc/enroll/precheck' });
  const supabase = getServiceClient();

  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  if (!(await isStaff(supabase, userId))) {
    emitAuthzDenied('tag', null, 'role', ctx);
    throw errorFor('forbidden');
  }

  const parsed = tagUidParam.safeParse(req.params.tagUid);
  if (!parsed.success) {
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }

  const { data, error } = await supabase
    .from('nfc_tags')
    .select('id, lifecycle_status')
    .eq('tag_uid', parsed.data.toUpperCase())
    .maybeSingle();

  if (error) {
    logger.error('nfc_enroll_precheck_failed', { error: error.message });
    throw new AppError('unavailable', 'Tag registry lookup failed');
  }

  return ok(res, {
    exists: Boolean(data),
    lifecycleStatus: (data?.lifecycle_status as string | null | undefined) ?? null,
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
    const { data: tagRow } = await supabase
      .from('nfc_tags')
      .select(`${TAG_COLUMNS}, sdm_key_version`)
      .eq('tag_uid', tagUid.toUpperCase())
      .maybeSingle();

    if (!tagRow) {
      emitUnknownTagSun('claim', ctx);
      throw errorFor('not_found');
    }

    const sunTag = tagRow as unknown as TagRow & { sdm_key_version: number | null };

    // Possession first: a claim on a tag the caller cannot actually tap is
    // rejected before the lifecycle state is even considered.
    const sun = await verifyFreshSun(
      {
        tagId: sunTag.id,
        tagUid: sunTag.tag_uid,
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
    .select(`${TAG_COLUMNS}, sdm_key_version`)
    .eq('id', transfer.tag_id)
    .maybeSingle();

  if (!tagRow) {
    emitUnknownTagSun('transfer_complete', ctx);
    throw errorFor('not_found');
  }
  const tag = tagRow as unknown as TagRow & { sdm_key_version: number | null };

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
    .select('id, tag_id, from_user_id, to_email, status, transfer_type, fee_payer')
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

  await supabase
    .from('ownership_transfers')
    .update({ status: 'CANCELLED' })
    .eq('id', transfer.id)
    .eq('status', 'PENDING');

  emitSecurityEvent({
    event: 'transfer.state_change',
    transfer_id: transfer.id, from: 'PENDING', to: 'CANCELLED', trigger: 'client', result: 'ok',
    request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
    ip: ctx.ip, route: ctx.route,
  });
  emitTransfer('ok');

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

// ── POST /api/v1/nfc/replace ────────────────────────────────────────────────

/**
 * Moves the custody chain to a new ENROLLED chip; the old one is RETIRED.
 * Owner or admin — the physical chip failed, the ownership did not.
 */
export const replaceTag = async (req: TagRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/replace', 'user');
  const supabase = getServiceClient();

  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const parsed = replaceSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }
  const { oldTagId, newTagId } = parsed.data;

  const oldTag = await loadTag(supabase, oldTagId);
  const newTag = await loadTag(supabase, newTagId);

  const emitReplace = (result: SecurityResult) =>
    emitSecurityEvent({
      event: 'nfc.replace', old_tag_id: oldTag.id, new_tag_id: newTag.id, result,
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });

  // Staff only (Decisions DB 2026-10-02: token reset is admin-only). Owners
  // used to be able to call this directly, which let them move their token onto
  // any enrolled chip with no review, no $10 re-issue fee and no tap of the new
  // chip. Owners file /reissue-request instead; S-ADMIN1 replaces this endpoint
  // with a single-transaction admin reset.
  const staff = await isStaff(supabase, userId);
  if (!staff) {
    emitAuthzDenied('tag', oldTag.id, 'role', ctx);
    emitReplace('forbidden');
    throw errorFor('forbidden');
  }

  const terminal = terminalStateError(oldTag.lifecycle_status);
  if (terminal) {
    emitReplace(terminal);
    throw errorFor(terminal);
  }

  if (newTag.lifecycle_status !== 'ENROLLED') {
    emitReplace('conflict');
    throw new AppError('conflict', 'The replacement tag must be enrolled and unclaimed');
  }

  const owner = oldTag.current_owner_id;
  if (!owner) {
    emitReplace('conflict');
    throw new AppError('conflict', 'The tag being replaced has no current owner');
  }

  // The custody record's id is the ownership event, so it is generated here
  // and the proof minted BEFORE any write (a missing salt key fails cleanly).
  const custodyRecordId = randomUUID();
  const minted = mintProof(
    { tagId: newTag.id, ownershipEventId: custodyRecordId, ownershipEventType: 'transfer' },
    ctx,
  );

  // Carry the full history: the new chip inherits the item link and the owner,
  // so the verify page still shows the original origin record.
  await supabase
    .from('nfc_tags')
    .update({
      lifecycle_status: 'ACTIVE',
      current_owner_id: owner,
      linked_item_id: oldTag.linked_item_id,
      disclosure: oldTag.disclosure ?? undefined,
      activated_at: new Date().toISOString(),
      status: 'active',
    })
    .eq('id', newTag.id);

  await supabase
    .from('nfc_tags')
    .update({ lifecycle_status: 'RETIRED', current_owner_id: null, status: 'retired' })
    .eq('id', oldTag.id);

  // Custody record, so the chain is auditable internally.
  await supabase
    .from('ownership_transfers')
    .insert({
      id: custodyRecordId,
      tag_id: newTag.id,
      from_user_id: owner,
      to_user_id: owner,
      transfer_type: 'REISSUE',
      status: 'COMPLETED',
      reissued_token: true,
      requires_reverification: false,
      completed_at: new Date().toISOString(),
      initiated_at: new Date().toISOString(),
      list_amount_usd_cents: 0,
      charged_amount: 0,
      charged_currency: 'usd',
      fx_rate: 1,
    });

  await supabase
    .from('ownership_proofs')
    .update({ status: 'stale' })
    .eq('tag_id', oldTag.id)
    .eq('status', 'current');

  const ownershipId = await rotateOwnershipProof(supabase, minted, { tagId: newTag.id, ownerId: owner });

  emitReplace('ok');

  return ok(res, {
    oldTagId: oldTag.id,
    newTagId: newTag.id,
    oldLifecycleStatus: 'RETIRED',
    newLifecycleStatus: 'ACTIVE',
    ownershipId,
  });
};

// ── POST /api/v1/nfc/reissue-request ────────────────────────────────────────

/**
 * The only path for a holder who skipped a transfer. Admin review of the
 * internal custody record, $10. Not advertised in the UI.
 *
 * Creates the request only; approval and the RETIRE of the old tag happen in
 * admin review.
 */
export const requestReissue = async (req: TagRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/reissue-request', 'user');
  const supabase = getServiceClient();

  const userId = req.user?.id;
  if (!userId) throw new AppError('unauthenticated', 'Authentication required');

  const parsed = reissueRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }

  const tag = await loadTag(supabase, parsed.data.tagId);

  const emitReissue = (result: SecurityResult) =>
    emitSecurityEvent({
      event: 'nfc.reissue_request', tag_id: tag.id, result,
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });

  const terminal = terminalStateError(tag.lifecycle_status);
  if (terminal) {
    emitReissue(terminal);
    throw errorFor(terminal);
  }

  const charge = resolveCharge(REISSUE_FEE_CENTS, await billingCountryFor(supabase, userId));

  const { data: created, error } = await supabase
    .from('reissue_requests')
    .insert({
      tag_id: tag.id,
      requester_id: userId,
      status: 'PENDING',
      list_amount_usd_cents: charge.listAmountUsdCents,
      charged_amount: charge.chargedAmount,
      charged_currency: charge.chargedCurrency,
      fx_rate: charge.fxRate,
    })
    .select('id')
    .single();

  if (error || !created) {
    emitReissue('conflict');
    throw new AppError('conflict', 'A re-issue request is already open for this token');
  }

  emitReissue('ok');

  return ok(res, {
    reissueRequestId: created.id,
    status: 'PENDING',
    listAmountUsdCents: charge.listAmountUsdCents,
    chargedAmount: charge.chargedAmount,
    chargedCurrency: charge.chargedCurrency,
  }, 201);
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
