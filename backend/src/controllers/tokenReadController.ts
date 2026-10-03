/**
 * S-NFC3-FE Ph1 — the read side of the token lifecycle.
 *
 * S-NFC3 shipped every write (claim, transfer, release, …) but no way for a UI
 * to see anything: no "my tokens", no incoming transfers, no transfer status,
 * no Receipt, and a public verify path that burned the very tap a claim needs.
 * This module adds those reads plus `POST /nfc/tap`, the verify-page entry
 * point that also mints a tap session (services/nfc/tapSession.ts).
 *
 * Privacy contract (unchanged from S-NFC3):
 *   - Public output comes ONLY from `public_tag_provenance`; never prior owners,
 *     the current owner's identity, the chip UID or undisclosed origin fields.
 *   - A recipient sees the token's public provenance, never the sender.
 *   - The Receipt (salt) is returned only to the current owner, `no-store`.
 *   - Every query runs on the service client, so every ownership/recipient
 *     check below is explicit; RLS is not doing it.
 */

import { Response } from 'express';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { z } from 'zod';
import { RequestWithId } from '../middleware/requestId';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { emitSecurityEvent } from '../lib/security/securityEvent';
import { securityContext } from '../lib/security/requestContext';
import { openReceipt } from '../lib/ownership/ownershipProof';
import { TRANSFER_FEE_CENTS } from '../lib/tokenFees';
import { parseSunMessage } from '../services/nfc/ntag424';
import { sunFailureCode } from '../services/nfc/sunVerification';
import { resolveAndBurnSun } from '../services/nfc/tapResolver';
import { issueTapSession } from '../services/nfc/tapSession';
import { tapSchema } from '../services/nfc/tagManagementSchemas';

interface ReadRequest extends RequestWithId, AuthRequest {}

const getServiceClient = (): SupabaseClient =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const ok = <T>(res: Response, data: T, status = 200) =>
  res.status(status).json({ success: true, data, error: null });

const uuid = z.string().uuid();

const pathUuid = (value: string | string[] | undefined): string => {
  const raw = Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) throw new AppError('not_found', 'Not found');
  return parsed.data;
};

const requireUser = (req: ReadRequest): User => {
  if (!req.user?.id) throw new AppError('unauthenticated', 'Authentication required');
  return req.user;
};

/** Lowercased email, only when Supabase Auth has confirmed it. */
const confirmedEmail = (user: User): string | null =>
  user.email && user.email_confirmed_at ? user.email.trim().toLowerCase() : null;

/** `public_tag_provenance` row — the ONLY public shape of a token. */
export type Provenance = {
  tag_id: string;
  lifecycle_status: string | null;
  is_valid: boolean | null;
  claim_date: string | null;
  creator_name: string | null;
  origin_video_url: string | null;
  origin_location: string | null;
  origin_date: string | null;
  current_ownership_id: string | null;
  enrolled_at: string | null;
};

const PROVENANCE_COLUMNS =
  'tag_id, lifecycle_status, is_valid, claim_date, creator_name, origin_video_url, origin_location, origin_date, current_ownership_id, enrolled_at';

const loadProvenance = async (
  supabase: SupabaseClient,
  tagIds: readonly string[],
): Promise<Map<string, Provenance>> => {
  const byTag = new Map<string, Provenance>();
  if (tagIds.length === 0) return byTag;

  const { data } = await supabase
    .from('public_tag_provenance')
    .select(PROVENANCE_COLUMNS)
    .in('tag_id', [...tagIds]);

  for (const row of (data ?? []) as Provenance[]) byTag.set(row.tag_id, row);
  return byTag;
};

type TransferRow = {
  id: string;
  tag_id: string;
  from_user_id: string | null;
  to_user_id: string | null;
  to_email: string | null;
  status: string;
  transfer_type: string | null;
  fee_payer: string | null;
  list_amount_usd_cents: number | null;
  charged_amount: number | null;
  charged_currency: string | null;
  initiated_at: string | null;
  completed_at: string | null;
};

const TRANSFER_COLUMNS =
  'id, tag_id, from_user_id, to_user_id, to_email, status, transfer_type, fee_payer, list_amount_usd_cents, charged_amount, charged_currency, initiated_at, completed_at';

/**
 * Mirrors the recipient rule in `completeTransfer`: the named account, or — for
 * an email-targeted transfer not yet resolved to an account — the account that
 * owns that (confirmed) address.
 */
const isRecipient = (transfer: TransferRow, user: User): boolean => {
  if (transfer.to_user_id !== null) return transfer.to_user_id === user.id;
  const email = confirmedEmail(user);
  return email !== null && transfer.to_email !== null && transfer.to_email === email;
};

const transferTypeOut = (value: string | null): 'sale' | 'gift' =>
  value === 'GIFT' ? 'gift' : 'sale';

// ── POST /api/v1/nfc/tap ────────────────────────────────────────────────────

/**
 * The verify page's single call. Verifies the tap, burns its counter, and —
 * when the token can still be acted on — mints a tap session so the visitor
 * can claim or accept a transfer without tapping twice.
 *
 * Public (optional auth). Signing in only adds `viewer`.
 */
export const tapTag = async (req: ReadRequest, res: Response) => {
  const ctx = securityContext(req, '/api/v1/nfc/tap', req.user?.id ? 'user' : 'anon');
  const supabase = getServiceClient();

  const parsed = tapSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
  }
  const parts = parseSunMessage(parsed.data.sunMessage);
  if (!parts) throw new AppError('invalid_argument', 'Invalid SUN message URL');

  const { tag, result, sunResult } = await resolveAndBurnSun(supabase, { parts }, ctx);

  // Scan proof for the internal custody record (same row /nfc/scan writes).
  await supabase.from('verification_events').insert({
    tag_id: tag.id,
    scan_type: 'verification',
    scanned_by: req.user?.id ?? null,
    sun_message: parsed.data.sunMessage,
    sun_counter_value: result.counterValue,
    cmac_valid: result.valid,
    ip_address: req.ip ?? null,
    user_agent: req.headers['user-agent'] ?? null,
  });

  if (!result.valid || result.counterValue === null) {
    // Nothing about the token for a tap that did not verify.
    return ok(res, { valid: false, reason: sunFailureCode(sunResult) });
  }

  const provenance = (await loadProvenance(supabase, [tag.id])).get(tag.id) ?? null;
  const lifecycle = tag.lifecycle_status;
  const actionable = lifecycle === 'ENROLLED' || lifecycle === 'ACTIVE';

  const tapSession = actionable
    ? await issueTapSession(supabase, { tagId: tag.id, counterValue: result.counterValue }, ctx)
    : null;

  let viewer: { youOwnThis: boolean; canClaim: boolean; pendingTransferId: string | null } | null = null;
  if (req.user?.id) {
    const user = req.user;
    const { data: pending } = await supabase
      .from('ownership_transfers')
      .select(TRANSFER_COLUMNS)
      .eq('tag_id', tag.id)
      .eq('status', 'PENDING')
      .maybeSingle();
    const pendingRow = pending as TransferRow | null;

    viewer = {
      youOwnThis: tag.current_owner_id === user.id,
      canClaim: lifecycle === 'ENROLLED',
      pendingTransferId: pendingRow && isRecipient(pendingRow, user) ? pendingRow.id : null,
    };
  }

  return ok(res, {
    valid: true,
    tagId: tag.id,
    lifecycleStatus: lifecycle,
    provenance,
    tapSession,
    viewer,
  });
};

// ── GET /api/v1/nfc/mine ────────────────────────────────────────────────────

type OwnedTagRow = {
  id: string;
  lifecycle_status: string | null;
  activated_at: string | null;
  disclosure: Record<string, boolean> | null;
  linked_item_id: string | null;
};

/** Every token the caller currently owns, newest claim first. */
export const listMyTokens = async (req: ReadRequest, res: Response) => {
  const user = requireUser(req);
  const supabase = getServiceClient();

  const { data: tagRows, error } = await supabase
    .from('nfc_tags')
    .select('id, lifecycle_status, activated_at, disclosure, linked_item_id')
    .eq('current_owner_id', user.id);
  if (error) throw new AppError('internal', 'Could not load your tokens');

  const tags = (tagRows ?? []) as OwnedTagRow[];
  const tagIds = tags.map((t) => t.id);
  if (tagIds.length === 0) return ok(res, { tokens: [] });

  const [provenance, proofs, outgoing, items] = await Promise.all([
    loadProvenance(supabase, tagIds),
    supabase
      .from('ownership_proofs')
      .select('tag_id, ownership_id')
      .eq('owner_id', user.id)
      .eq('status', 'current')
      .in('tag_id', tagIds),
    supabase
      .from('ownership_transfers')
      .select(TRANSFER_COLUMNS)
      .eq('from_user_id', user.id)
      .eq('status', 'PENDING')
      .in('tag_id', tagIds),
    supabase
      .from('items')
      .select('id, title')
      .in('id', tags.map((t) => t.linked_item_id).filter((id): id is string => id !== null)),
  ]);

  const proofByTag = new Map(
    ((proofs.data ?? []) as { tag_id: string; ownership_id: string }[]).map((p) => [p.tag_id, p.ownership_id]),
  );
  const pendingByTag = new Map(((outgoing.data ?? []) as TransferRow[]).map((t) => [t.tag_id, t]));
  const titleByItem = new Map(
    ((items.data ?? []) as { id: string; title: string | null }[]).map((i) => [i.id, i.title]),
  );

  const tokens = tags
    .map((t) => {
      const pending = pendingByTag.get(t.id);
      return {
        tagId: t.id,
        lifecycleStatus: t.lifecycle_status,
        claimedAt: t.activated_at,
        title: t.linked_item_id ? (titleByItem.get(t.linked_item_id) ?? null) : null,
        disclosure: t.disclosure ?? {},
        ownershipId: proofByTag.get(t.id) ?? null,
        provenance: provenance.get(t.id) ?? null,
        pendingTransfer: pending
          ? {
              transferId: pending.id,
              transferType: transferTypeOut(pending.transfer_type),
              feePayer: pending.fee_payer,
              // The sender typed this address; echoing it back reveals nothing new.
              toEmail: pending.to_email,
              initiatedAt: pending.initiated_at,
            }
          : null,
      };
    })
    .sort((a, b) => (b.claimedAt ?? '').localeCompare(a.claimedAt ?? ''));

  return ok(res, { tokens });
};

// ── GET /api/v1/nfc/transfers/incoming ──────────────────────────────────────

/**
 * PENDING transfers addressed to the caller: by account, or by confirmed email
 * for a transfer started before they had one (Rule 3). No sender identity.
 */
export const listIncomingTransfers = async (req: ReadRequest, res: Response) => {
  const user = requireUser(req);
  const supabase = getServiceClient();

  const byAccount = await supabase
    .from('ownership_transfers')
    .select(TRANSFER_COLUMNS)
    .eq('status', 'PENDING')
    .eq('to_user_id', user.id);
  if (byAccount.error) throw new AppError('internal', 'Could not load incoming transfers');

  const rows = [...((byAccount.data ?? []) as TransferRow[])];

  const email = confirmedEmail(user);
  if (email) {
    const byEmail = await supabase
      .from('ownership_transfers')
      .select(TRANSFER_COLUMNS)
      .eq('status', 'PENDING')
      .is('to_user_id', null)
      .eq('to_email', email);
    if (byEmail.error) throw new AppError('internal', 'Could not load incoming transfers');
    rows.push(...((byEmail.data ?? []) as TransferRow[]));
  }

  // The sender cannot be their own recipient, but never list it if they are.
  const incoming = rows.filter((r) => r.from_user_id !== user.id);
  const provenance = await loadProvenance(supabase, incoming.map((r) => r.tag_id));

  return ok(res, {
    transfers: incoming.map((r) => ({
      transferId: r.id,
      tagId: r.tag_id,
      transferType: transferTypeOut(r.transfer_type),
      feePayer: r.fee_payer,
      listAmountUsdCents: r.list_amount_usd_cents ?? TRANSFER_FEE_CENTS,
      initiatedAt: r.initiated_at,
      provenance: provenance.get(r.tag_id) ?? null,
    })),
  });
};

// ── GET /api/v1/nfc/transfer/:id ────────────────────────────────────────────

/**
 * Transfer status for its two parties only — the frontend polls this after
 * payment, because only the Stripe webhook moves a transfer to COMPLETED.
 */
export const getTransfer = async (req: ReadRequest, res: Response) => {
  const user = requireUser(req);
  const ctx = securityContext(req, '/api/v1/nfc/transfer/:id', 'user');
  const supabase = getServiceClient();
  const transferId = pathUuid(req.params.id);

  const { data } = await supabase
    .from('ownership_transfers')
    .select(TRANSFER_COLUMNS)
    .eq('id', transferId)
    .maybeSingle();
  if (!data) throw new AppError('not_found', 'Not found');
  const transfer = data as TransferRow;

  const role = transfer.from_user_id === user.id ? 'sender' : isRecipient(transfer, user) ? 'recipient' : null;
  if (!role) {
    emitSecurityEvent({
      event: 'authz.denied', resource_type: 'transfer', resource_id: transfer.id,
      reason: 'not_recipient', result: 'forbidden',
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });
    throw new AppError('permission_denied', 'Forbidden');
  }

  return ok(res, {
    transferId: transfer.id,
    tagId: transfer.tag_id,
    status: transfer.status,
    role,
    transferType: transferTypeOut(transfer.transfer_type),
    feePayer: transfer.fee_payer,
    listAmountUsdCents: transfer.list_amount_usd_cents ?? TRANSFER_FEE_CENTS,
    chargedAmount: transfer.charged_amount,
    chargedCurrency: transfer.charged_currency,
    initiatedAt: transfer.initiated_at,
    completedAt: transfer.completed_at,
  });
};

// ── GET /api/v1/nfc/:tagId/receipt ──────────────────────────────────────────

/**
 * The private half of the Ownership ID, for the CURRENT owner only.
 *
 * Revealing these fields is what proves the holder held that ownership, so the
 * response is never cached and the opening is a security event. The Receipt
 * still authorizes nothing (no endpoint accepts it).
 */
export const getReceipt = async (req: ReadRequest, res: Response) => {
  const user = requireUser(req);
  const ctx = securityContext(req, '/api/v1/nfc/:tagId/receipt', 'user');
  const supabase = getServiceClient();
  const tagId = pathUuid(req.params.tagId);

  const emitReceipt = (result: 'ok' | 'forbidden' | 'not_found') =>
    emitSecurityEvent({
      event: 'ownership.receipt', tag_id: tagId, result,
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });

  const { data: tag } = await supabase
    .from('nfc_tags')
    .select('id, current_owner_id')
    .eq('id', tagId)
    .maybeSingle();
  if (!tag) {
    emitReceipt('not_found');
    throw new AppError('not_found', 'Not found');
  }

  if (tag.current_owner_id !== user.id) {
    emitSecurityEvent({
      event: 'authz.denied', resource_type: 'tag', resource_id: tagId,
      reason: 'not_owner', result: 'forbidden',
      request_id: ctx.requestId, actor_id: ctx.actorId, actor_type: 'user',
      ip: ctx.ip, route: ctx.route,
    });
    emitReceipt('forbidden');
    throw new AppError('permission_denied', 'Forbidden');
  }

  const { data: proof } = await supabase
    .from('ownership_proofs')
    .select('ownership_id, ownership_event_id, ownership_event_type, salt_enc, created_at')
    .eq('tag_id', tagId)
    .eq('owner_id', user.id)
    .eq('status', 'current')
    .maybeSingle();
  if (!proof) {
    emitReceipt('not_found');
    throw new AppError('not_found', 'Not found');
  }

  const receipt = openReceipt({ tagId, saltEnc: proof.salt_enc as string }, ctx);
  emitReceipt('ok');

  res.setHeader('Cache-Control', 'no-store');
  return ok(res, {
    ownershipId: proof.ownership_id,
    ownershipEventId: proof.ownership_event_id,
    ownershipEventType: proof.ownership_event_type,
    tagRef: receipt.tagRef,
    saltHex: receipt.saltHex,
    issuedAt: proof.created_at,
    // So an independent verifier can recompute the ID without asking AM.
    algorithm: {
      hash: 'keccak256',
      preimage: 'utf8(tagRef) || 16 raw bytes of ownershipEventId (UUID) || 32-byte salt',
    },
  });
};
