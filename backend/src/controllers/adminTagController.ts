/**
 * S-ADMIN1 — token admin console (/api/v1/admin/tags).
 *
 * Mounted behind verifyAdminAuth + adminRateLimit + requirePermission('manage_nfc'),
 * so every handler can rely on `req.admin`.
 *
 * Rules this file is responsible for:
 *   1. Every state change runs inside ONE database function (admin_set_tag_suspension,
 *      admin_reset_token). The function writes the audit row in the same
 *      transaction, so an action and its audit record cannot diverge.
 *   2. Every action needs a typed reason (Zod here, and again in the function).
 *   3. Admin views never return chip keys, salts, Ownership IDs or Receipts.
 *      Owner and creator are shown by account email (Boss 2026-10-19, replacing
 *      the account-id-only rule AC8); emails never go into logs.
 *   4. Every action emits an `admin.tag_action` security event.
 */

import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import { emitSecurityEvent, type SecurityResult } from '../lib/security/securityEvent';
import { securityContext } from '../lib/security/requestContext';
import { mintOwnershipProof, type SecurityLogContext } from '../lib/ownership/ownershipProof';
import {
  listTagsQuerySchema,
  tagIdParamSchema,
  suspensionBodySchema,
  resetBodySchema,
  uidSuffix,
  confirmationSuffix,
  UID_SUFFIX_LENGTH,
  escapeLike,
} from '../services/nfc/adminTagSchemas';

type AdminRequest = Request & { requestId?: string };

const getServiceClient = (): SupabaseClient =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const ok = <T>(res: Response, data: T, status = 200) =>
  res.status(status).json({ success: true, data, error: null });

const pathParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

/**
 * Columns an admin may see. Never `aes_key_enc` (retired, but still a column),
 * never the full UID in a list.
 */
// One literal on purpose: schemaColumnDrift.test.ts reads `*COLUMNS` constants.
const ADMIN_TAG_COLUMNS =
  'id, tag_uid, chip_serial, chip_name, lifecycle_status, current_owner_id, seller_id, linked_item_id, sdm_key_version, sun_counter, registered_at, activated_at, suspended_at, suspended_reason, retired_at, retired_reason, replaced_by_tag_id, destruction_status';

type AdminTagRow = {
  id: string;
  tag_uid: string;
  chip_serial: string | null;
  chip_name: string | null;
  lifecycle_status: string | null;
  current_owner_id: string | null;
  seller_id: string | null;
  linked_item_id: string | null;
  sdm_key_version: number | null;
  sun_counter: number;
  registered_at: string | null;
  activated_at: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  replaced_by_tag_id: string | null;
  destruction_status: string | null;
};

/**
 * The admin-facing shape. The UID is reduced to its suffix; so is the serial
 * (S-NFC-ID), which is what tells apart two chips that share a UID.
 */
type EmailMap = Map<string, string>;

const toAdminTag = (row: AdminTagRow, emails: EmailMap = new Map()) => ({
  id: row.id,
  /** The name in the chip's URL (chip_NNN). Null on rows enrolled before names were recorded. */
  chipName: row.chip_name,
  uidSuffix: uidSuffix(row.tag_uid),
  // Same length as the typed confirmation (confirmationSuffix), so the admin
  // reads exactly what they will type.
  serialSuffix: row.chip_serial ? row.chip_serial.slice(-UID_SUFFIX_LENGTH).toUpperCase() : null,
  lifecycleStatus: row.lifecycle_status,
  ownerAccountId: row.current_owner_id,
  ownerEmail: row.current_owner_id ? (emails.get(row.current_owner_id) ?? null) : null,
  creatorAccountId: row.seller_id,
  creatorEmail: row.seller_id ? (emails.get(row.seller_id) ?? null) : null,
  itemId: row.linked_item_id,
  sdmKeyVersion: row.sdm_key_version,
  sunCounter: row.sun_counter,
  registeredAt: row.registered_at,
  activatedAt: row.activated_at,
  suspendedAt: row.suspended_at,
  suspendedReason: row.suspended_reason,
  retiredAt: row.retired_at,
  retiredReason: row.retired_reason,
  replacedByTagId: row.replaced_by_tag_id,
  destructionStatus: row.destruction_status,
});

/**
 * Account emails for the owners and creators on screen. One query; never logged.
 */
export const loadEmailsByIds = async (supabase: SupabaseClient, rawIds: Array<unknown>): Promise<EmailMap> => {
  const ids = [...new Set(rawIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from('users').select('id, email').in('id', ids);
  if (error) throw new AppError('unavailable', 'Account emails could not be loaded. Try again.');
  return new Map(((data ?? []) as { id: string; email: string }[]).map((u) => [u.id, u.email]));
};

const loadEmails = (supabase: SupabaseClient, rows: AdminTagRow[]): Promise<EmailMap> =>
  loadEmailsByIds(supabase, rows.flatMap((r) => [r.current_owner_id, r.seller_id]));

/** Most accounts an email search may match before the admin is asked to narrow it. */
export const EMAIL_MATCH_LIMIT = 50;

/**
 * Writes the audit row for a search BEFORE it runs: an email search that cannot
 * be recorded does not happen. The term lives only in this append-only row.
 */
const auditSearch = async (supabase: SupabaseClient, req: AdminRequest, term: string): Promise<void> => {
  const admin = req.admin;
  if (!admin) throw new AppError('unauthenticated', 'Your session has ended. Sign in again.');
  const { error } = await supabase.from('audit_logs').insert({
    admin_id: admin.admin_id,
    admin_email: admin.email,
    action: 'tag_search',
    entity_type: 'admin_search',
    // No single subject: keyed on the admin, so "who searched what" is one lookup.
    entity_id: admin.admin_id,
    changes: { query: term, scope: 'nfc_tags' },
    reason: null,
    ip_address: req.ip ?? null,
    user_agent: (req.headers?.['user-agent'] as string | undefined) ?? null,
    brand: admin.brand === 'unmentionables' ? 'unmentionables' : 'auctionx',
  });
  if (error) throw new AppError('unavailable', 'The search could not be recorded, so it was not run. Try again.');
};

/**
 * Turns the search term into PostgREST `or` terms over nfc_tags. Returns null
 * when nothing can match (no account email matched and the term cannot be a
 * chip name, serial or UID suffix).
 */
const searchTerms = async (
  supabase: SupabaseClient,
  term: string,
): Promise<{ orTerms: string[] | null; emailMatchesTruncated: boolean }> => {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .ilike('email', `%${escapeLike(term)}%`)
    .limit(EMAIL_MATCH_LIMIT + 1);
  if (error) throw new AppError('unavailable', 'The search could not be run. Try again.');
  const ids = ((data ?? []) as { id: string }[]).map((u) => u.id);
  const emailMatchesTruncated = ids.length > EMAIL_MATCH_LIMIT;

  const orTerms: string[] = [];
  if (ids.length > 0) orTerms.push(`current_owner_id.in.(${ids.slice(0, EMAIL_MATCH_LIMIT).join(',')})`);
  // Chip names are chip_NNN or a manual name; only this charset goes into the
  // `or` string (searchTermSchema already excludes PostgREST syntax).
  if (/^[A-Za-z0-9_-]+$/.test(term)) orTerms.push(`chip_name.ilike.%${escapeLike(term)}%`);
  // Serial and UID are stored uppercase hex; match the end, as admins read them.
  if (/^[0-9a-fA-F]{2,14}$/.test(term)) {
    const hex = term.toUpperCase();
    orTerms.push(`chip_serial.ilike.%${hex}`, `tag_uid.ilike.%${hex}`);
  }
  return { orTerms: orTerms.length > 0 ? orTerms : null, emailMatchesTruncated };
};

/** Security context with the admin as actor (verifyAdminAuth sets req.admin, not req.user). */
const adminContext = (req: AdminRequest, route: string): SecurityLogContext => ({
  ...securityContext(req, route, 'admin'),
  actorId: req.admin?.admin_id ?? null,
});

const requireAdminId = (req: AdminRequest): string => {
  const adminId = req.admin?.admin_id;
  if (!adminId) throw new AppError('unauthenticated', 'Your session has ended. Sign in again.');
  return adminId;
};

const emitAdminAction = (
  ctx: SecurityLogContext,
  action: 'suspend' | 'unsuspend' | 'reset',
  tagId: string | null,
  result: SecurityResult,
  newTagId: string | null = null,
): void => {
  emitSecurityEvent({
    event: 'admin.tag_action',
    action,
    tag_id: tagId,
    new_tag_id: newTagId,
    result,
    request_id: ctx.requestId,
    actor_id: ctx.actorId,
    actor_type: 'admin',
    ip: ctx.ip,
    route: ctx.route,
  });
};

/**
 * Maps a database-function error onto an API error. The functions raise with a
 * machine-readable prefix (`old_tag_no_owner: ...`); only known prefixes reach
 * the client, with a human message chosen here (never the raw DB text).
 */
const rpcError = (error: { message?: string } | null): { appError: AppError; result: SecurityResult } => {
  const key = (error?.message ?? '').split(':')[0].trim();
  switch (key) {
    case 'admin_forbidden':
      return { appError: new AppError('permission_denied', 'Your staff role cannot do this.'), result: 'forbidden' };
    case 'reason_required':
      return { appError: new AppError('invalid_argument', 'Give a reason of at least 10 characters.'), result: 'invalid_argument' };
    case 'tag_not_found':
    case 'old_tag_not_found':
      return { appError: new AppError('not_found', 'Token not found.'), result: 'not_found' };
    case 'new_tag_not_found':
      return { appError: new AppError('not_found', 'Replacement chip not found.'), result: 'not_found' };
    case 'invalid_state':
      return { appError: new AppError('conflict', 'This token cannot be changed in its current state. Reload the page.'), result: 'conflict' };
    case 'old_tag_invalid_state':
      return { appError: new AppError('conflict', 'Only an active or suspended token can be moved to a new chip.'), result: 'conflict' };
    case 'old_tag_no_owner':
      return { appError: new AppError('conflict', 'This token has no owner, so it cannot be moved to a new chip.'), result: 'conflict' };
    case 'new_tag_not_enrolled':
      return { appError: new AppError('conflict', 'The new chip must be set up and not yet claimed.'), result: 'conflict' };
    case 'same_tag':
      return { appError: new AppError('invalid_argument', 'Pick a different chip. The new chip cannot be the old one.'), result: 'invalid_argument' };
    case 'transfer_pending':
      return { appError: new AppError('conflict', 'A transfer is in progress for this token. It must finish or be cancelled first.'), result: 'transfer_pending' };
    case 'tag_retired':
      return { appError: new AppError('conflict', 'A retired chip cannot be changed or used again.'), result: 'token_retired' };
    default:
      return { appError: new AppError('internal', 'That did not work. Nothing was changed. Try again.'), result: 'internal' };
  }
};

const parseTagId = (req: AdminRequest): string => {
  const parsed = tagIdParamSchema.safeParse(pathParam(req.params.tagId));
  if (!parsed.success) throw new AppError('invalid_argument', 'Some details are missing or not valid. Check the form and try again.', parsed.error.issues);
  return parsed.data;
};

// ── GET /api/v1/admin/tags ──────────────────────────────────────────────────

export const listTags = async (req: AdminRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: '/api/v1/admin/tags' });
  const parsed = listTagsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError('invalid_argument', 'Some details are missing or not valid. Check the form and try again.', parsed.error.issues);
  const q = parsed.data;

  const supabase = getServiceClient();
  let query = supabase.from('nfc_tags').select(ADMIN_TAG_COLUMNS, { count: 'exact' });

  let emailMatchesTruncated = false;
  if (q.q) {
    await auditSearch(supabase, req, q.q);
    const search = await searchTerms(supabase, q.q);
    emailMatchesTruncated = search.emailMatchesTruncated;
    if (!search.orTerms) {
      return ok(res, { tags: [], pagination: { page: q.page, limit: q.limit, total: 0 }, emailMatchesTruncated });
    }
    query = query.or(search.orTerms.join(','));
  }

  if (q.status) query = query.eq('lifecycle_status', q.status);
  // UIDs are stored uppercase (enroll uppercases them); the suffix is hex-only, so no LIKE metacharacters.
  if (q.uidSuffix) query = query.ilike('tag_uid', `%${q.uidSuffix.toUpperCase()}`);
  if (q.itemId) query = query.eq('linked_item_id', q.itemId);
  if (q.creatorId) query = query.eq('seller_id', q.creatorId);
  if (q.keyVersion) query = query.eq('sdm_key_version', q.keyVersion);
  if (q.from) query = query.gte('registered_at', q.from);
  if (q.to) query = query.lte('registered_at', q.to);

  const offset = (q.page - 1) * q.limit;
  const { data, error, count } = await query
    .order('registered_at', { ascending: false })
    .range(offset, offset + q.limit - 1);

  if (error) {
    logger.error('admin_tags_list_failed', { error: error.message });
    throw new AppError('unavailable', 'Tokens could not be loaded. Try again.');
  }

  const rows = (data ?? []) as unknown as AdminTagRow[];
  const emails = await loadEmails(supabase, rows);

  return ok(res, {
    tags: rows.map((row) => toAdminTag(row, emails)),
    pagination: { page: q.page, limit: q.limit, total: count ?? 0 },
    emailMatchesTruncated,
  });
};

// ── GET /api/v1/admin/tags/:tagId ───────────────────────────────────────────

export const getTag = async (req: AdminRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: '/api/v1/admin/tags/:tagId' });
  const tagId = parseTagId(req);
  const supabase = getServiceClient();

  const { data: tag, error: tagError } = await supabase
    .from('nfc_tags')
    .select(ADMIN_TAG_COLUMNS)
    .eq('id', tagId)
    .maybeSingle();

  if (tagError) {
    logger.error('admin_tag_load_failed', { error: tagError.message });
    throw new AppError('unavailable', 'This token could not be loaded. Try again.');
  }
  if (!tag) throw new AppError('not_found', 'Token not found.');

  // Custody chain. Not `to_email` (what a sender typed): accounts by id, shown
  // with the account's own email (one batched lookup below, never logged).
  const custody = await supabase
    .from('ownership_transfers')
    .select('id, transfer_type, status, from_user_id, to_user_id, initiated_at, completed_at, charged_amount, charged_currency, reissued_token')
    .eq('tag_id', tagId)
    .order('initiated_at', { ascending: false })
    .limit(50);

  // Taps. Not ip_address / user_agent / sun_message.
  const taps = await supabase
    .from('verification_events')
    .select('id, created_at, scan_type, cmac_valid, sun_counter_value, scanned_by')
    .eq('tag_id', tagId)
    .order('created_at', { ascending: false })
    .limit(50);

  // Ownership ID status only — never the ID itself or its salt.
  const proofs = await supabase
    .from('ownership_proofs')
    .select('status, created_at, anchored_at')
    .eq('tag_id', tagId)
    .eq('status', 'current')
    .limit(1);

  const audit = await supabase
    .from('audit_logs')
    .select('log_id, action, admin_email, reason, changes, created_at')
    .eq('entity_type', 'nfc_tag')
    .eq('entity_id', tagId)
    .order('created_at', { ascending: false })
    .limit(50);

  // The chip this one replaced, if any (the reset audit row is keyed on the OLD tag).
  const replaced = await supabase
    .from('nfc_tags')
    .select('id')
    .eq('replaced_by_tag_id', tagId)
    .limit(5);

  for (const [name, part] of Object.entries({ custody, taps, proofs, audit, replaced })) {
    if (part.error) {
      logger.error('admin_tag_detail_part_failed', { part: name, error: part.error.message });
      throw new AppError('unavailable', 'Token details could not be loaded. Try again.');
    }
  }

  const proof = (proofs.data ?? [])[0] as { created_at: string; anchored_at: string | null } | undefined;
  const tagRow = tag as unknown as AdminTagRow;
  const custodyRows = (custody.data ?? []) as Array<Record<string, unknown>>;
  const tapRows = (taps.data ?? []) as Array<Record<string, unknown>>;
  const emails = await loadEmailsByIds(supabase, [
    tagRow.current_owner_id, tagRow.seller_id,
    ...custodyRows.flatMap((t) => [t.from_user_id, t.to_user_id]),
    ...tapRows.map((t) => t.scanned_by),
  ]);
  const emailOf = (id: unknown) => (typeof id === 'string' ? (emails.get(id) ?? null) : null);

  return ok(res, {
    tag: toAdminTag(tagRow, emails),
    replacesTagIds: ((replaced.data ?? []) as { id: string }[]).map((r) => r.id),
    ownershipId: proof
      ? { status: 'current' as const, issuedAt: proof.created_at, anchoredAt: proof.anchored_at }
      : { status: 'none' as const, issuedAt: null, anchoredAt: null },
    custody: custodyRows.map((t) => ({
      id: t.id,
      type: t.transfer_type,
      status: t.status,
      fromAccountId: t.from_user_id,
      toAccountId: t.to_user_id,
      fromEmail: emailOf(t.from_user_id),
      toEmail: emailOf(t.to_user_id),
      initiatedAt: t.initiated_at,
      completedAt: t.completed_at,
      chargedAmount: t.charged_amount,
      chargedCurrency: t.charged_currency,
      reissue: t.reissued_token,
    })),
    taps: tapRows.map((t) => ({
      id: t.id,
      at: t.created_at,
      type: t.scan_type,
      valid: t.cmac_valid,
      counter: t.sun_counter_value,
      accountId: t.scanned_by,
      accountEmail: emailOf(t.scanned_by),
    })),
    audit: ((audit.data ?? []) as Array<Record<string, unknown>>).map((a) => ({
      id: a.log_id,
      action: a.action,
      adminEmail: a.admin_email,
      reason: a.reason,
      changes: a.changes,
      at: a.created_at,
    })),
  });
};

// ── POST /api/v1/admin/tags/:tagId/suspend | /unsuspend ─────────────────────

const setSuspension = (suspend: boolean) => async (req: AdminRequest, res: Response) => {
  const route = `/api/v1/admin/tags/:tagId/${suspend ? 'suspend' : 'unsuspend'}`;
  const action = suspend ? 'suspend' : 'unsuspend';
  const ctx = adminContext(req, route);
  const logger = withLogContext({ requestId: req.requestId, route });
  const adminId = requireAdminId(req);
  const tagId = parseTagId(req);

  const parsed = suspensionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    emitAdminAction(ctx, action, tagId, 'invalid_argument');
    throw new AppError('invalid_argument', 'Some details are missing or not valid. Check the form and try again.', parsed.error.issues);
  }

  const { data, error } = await getServiceClient().rpc('admin_set_tag_suspension', {
    p_tag: tagId,
    p_suspend: suspend,
    p_admin: adminId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    const mapped = rpcError(error);
    if (mapped.result === 'internal') logger.error('admin_tag_suspension_failed', { error: error.message });
    emitAdminAction(ctx, action, tagId, mapped.result);
    throw mapped.appError;
  }

  emitAdminAction(ctx, action, tagId, 'ok');
  return ok(res, { tagId, lifecycleStatus: data as string });
};

export const suspendTag = setSuspension(true);
export const unsuspendTag = setSuspension(false);

// ── POST /api/v1/admin/tags/:tagId/reset ────────────────────────────────────

/**
 * The token reset (master replace). The old chip is retired forever and marked
 * for destruction; ownership, item link, disclosure and history move to the new
 * ENROLLED chip; the Ownership ID rotates. One transaction (admin_reset_token).
 *
 * The proof is minted here BEFORE the database is touched: minting needs the
 * salt envelope key, and a missing key must fail while nothing has changed.
 */
export const resetTag = async (req: AdminRequest, res: Response) => {
  const route = '/api/v1/admin/tags/:tagId/reset';
  const ctx = adminContext(req, route);
  const logger = withLogContext({ requestId: req.requestId, route });
  const adminId = requireAdminId(req);
  const oldTagId = parseTagId(req);

  const parsed = resetBodySchema.safeParse(req.body);
  if (!parsed.success) {
    emitAdminAction(ctx, 'reset', oldTagId, 'invalid_argument');
    throw new AppError('invalid_argument', 'Some details are missing or not valid. Check the form and try again.', parsed.error.issues);
  }
  const { newTagId, reason, confirmSuffix } = parsed.data;

  const supabase = getServiceClient();
  const { data: oldTag, error: loadError } = await supabase
    .from('nfc_tags')
    .select('id, tag_uid, chip_serial')
    .eq('id', oldTagId)
    .maybeSingle();

  if (loadError) {
    logger.error('admin_reset_load_failed', { error: loadError.message });
    throw new AppError('unavailable', 'This token could not be loaded. Try again.');
  }
  if (!oldTag) {
    emitAdminAction(ctx, 'reset', oldTagId, 'not_found', newTagId);
    throw new AppError('not_found', 'Token not found.');
  }

  // Typed confirmation: the admin must read the suffix off the chip being retired
  // (serial for v2 chips, UID for v1).
  if (confirmationSuffix(oldTag as { tag_uid: string; chip_serial: string | null }) !== confirmSuffix.toUpperCase()) {
    emitAdminAction(ctx, 'reset', oldTagId, 'invalid_argument', newTagId);
    throw new AppError('invalid_argument', 'That does not match. Type the characters shown in the dialog.');
  }

  const custodyRecordId = randomUUID();
  const minted = mintOwnershipProof(
    { tagId: newTagId, ownershipEventId: custodyRecordId, ownershipEventType: 'transfer' },
    ctx,
  );

  const { error } = await supabase.rpc('admin_reset_token', {
    p_old_tag: oldTagId,
    p_new_tag: newTagId,
    p_admin: adminId,
    p_reason: reason,
    p_custody_id: custodyRecordId,
    p_ownership_id: minted.ownershipId,
    p_tag_ref: minted.tagRef,
    p_salt_enc: minted.saltEnc,
  });

  if (error) {
    const mapped = rpcError(error);
    if (mapped.result === 'internal') logger.error('admin_reset_failed', { error: error.message });
    emitAdminAction(ctx, 'reset', oldTagId, mapped.result, newTagId);
    throw mapped.appError;
  }

  emitAdminAction(ctx, 'reset', oldTagId, 'ok', newTagId);
  return ok(res, {
    oldTagId,
    newTagId,
    oldLifecycleStatus: 'RETIRED',
    newLifecycleStatus: 'ACTIVE',
    destructionStatus: 'PENDING',
  });
};
