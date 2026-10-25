/**
 * Applying a paid token fee — S-ADMIN1 Ph3a.
 *
 * THE ONLY CODE THAT MAY MOVE A TRANSFER TO `COMPLETED` OR A RE-ISSUE REQUEST
 * TO `PAID`. Three callers, one set of rules:
 *
 *   webhook   a signed `payment_intent.succeeded` event
 *   sweep     the 10-minute reconciliation, for a webhook that never arrived
 *   reapply   an admin pressing Re-apply on a stuck payment
 *
 * Every caller must already hold proof that Stripe took the money: a verified
 * event, or a PaymentIntent it fetched from Stripe with status `succeeded`.
 * Nothing a client sends reaches this file.
 *
 * The writes happen inside one database function (`apply_transfer_fee`,
 * `apply_reissue_fee`), so an apply either lands whole or not at all.
 */

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emitSecurityEvent } from '../security/securityEvent';
import { mintOwnershipProof, type SecurityLogContext } from '../ownership/ownershipProof';

export type FeeSource = 'webhook' | 'sweep' | 'reapply';
export type FeeKind = 'transfer_fee' | 'reissue_fee';

export const TRANSFER_FEE_INTENT_KIND = 'token_transfer_fee';
export const REISSUE_FEE_INTENT_KIND = 'token_reissue_fee';

/** What a token-fee PaymentIntent says it pays for. Read from its metadata. */
export interface FeeIntent {
  readonly intentId: string;
  readonly kind: FeeKind;
  readonly transferId: string | null;
  readonly reissueRequestId: string | null;
  readonly amount: number | null;
  readonly currency: string | null;
}

export type ApplyOutcome =
  | 'applied'
  | 'already_completed'
  | 'already_paid'
  | 'not_found'
  | 'intent_mismatch'
  | 'not_payable'
  | 'no_recipient'
  /** Unexpected: a thrown error (missing salt key, database fault). Retry may fix it. */
  | 'failed';

export interface ApplyResult {
  readonly outcome: ApplyOutcome;
  readonly tagId?: string | null;
  /** Re-issue only: who to email, and what they paid. */
  readonly requesterId?: string | null;
  readonly chargedAmount?: number | null;
  /** A short machine code for `failed`. Never a raw error message. */
  readonly errorCode?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (raw: unknown): string | null =>
  typeof raw === 'string' && UUID_RE.test(raw) ? raw : null;

/**
 * Null for a PaymentIntent that is not a token fee (the Stripe account also
 * holds the parked marketplace's intents) or that names no row.
 */
export const readFeeIntent = (intent: Stripe.PaymentIntent): FeeIntent | null => {
  const kind = intent.metadata?.kind;
  const base = { intentId: intent.id, amount: intent.amount ?? null, currency: intent.currency ?? null };

  if (kind === TRANSFER_FEE_INTENT_KIND) {
    const transferId = asUuid(intent.metadata?.transfer_id);
    return transferId ? { ...base, kind: 'transfer_fee', transferId, reissueRequestId: null } : null;
  }
  if (kind === REISSUE_FEE_INTENT_KIND) {
    const reissueRequestId = asUuid(intent.metadata?.reissue_request_id);
    return reissueRequestId ? { ...base, kind: 'reissue_fee', transferId: null, reissueRequestId } : null;
  }
  return null;
};

/** True when applying changed nothing because it had already been applied. */
export const isSettled = (outcome: ApplyOutcome): boolean =>
  outcome === 'applied' || outcome === 'already_completed' || outcome === 'already_paid';

const TRANSFER_APPLY_COLUMNS = 'id, tag_id, to_user_id, status, stripe_payment_intent_id';

const rpcOutcome = (data: unknown): ApplyOutcome => {
  const outcome = (data as { outcome?: unknown } | null)?.outcome;
  switch (outcome) {
    case 'applied':
    case 'already_completed':
    case 'already_paid':
    case 'not_found':
    case 'intent_mismatch':
    case 'not_payable':
    case 'no_recipient':
      return outcome;
    default:
      throw new Error('apply_unknown_outcome');
  }
};

/**
 * Applies a paid transfer fee. Never throws: an unexpected fault is the
 * `failed` outcome, so every caller handles "could not apply" the same way.
 */
export const applyTransferFee = async (
  supabase: SupabaseClient,
  fee: FeeIntent,
  source: FeeSource,
  ctx: SecurityLogContext,
): Promise<ApplyResult> => {
  if (!fee.transferId) return { outcome: 'not_found' };

  try {
    const { data: transfer, error: loadError } = await supabase
      .from('ownership_transfers')
      .select(TRANSFER_APPLY_COLUMNS)
      .eq('id', fee.transferId)
      .maybeSingle();

    if (loadError) return { outcome: 'failed', errorCode: 'transfer_load_failed' };
    if (!transfer) return { outcome: 'not_found' };

    const tagId = (transfer.tag_id as string | null) ?? null;

    // The same checks the database function makes, made first so that a replay
    // or a transfer with nowhere to go never mints a proof it will not use.
    if (transfer.stripe_payment_intent_id && transfer.stripe_payment_intent_id !== fee.intentId) {
      return { outcome: 'intent_mismatch', tagId };
    }
    if (transfer.status === 'COMPLETED') return { outcome: 'already_completed', tagId };
    if (transfer.status !== 'PENDING' || !tagId) return { outcome: 'not_payable', tagId };
    if (!transfer.to_user_id) return { outcome: 'no_recipient', tagId };

    // Mint BEFORE any write. If the salt key is missing this throws while the
    // transfer is still PENDING, so a retry can apply it later.
    let minted;
    try {
      minted = mintOwnershipProof(
        { tagId, ownershipEventId: fee.transferId, ownershipEventType: 'transfer' },
        ctx,
      );
    } catch {
      return { outcome: 'failed', tagId, errorCode: 'proof_mint_failed' };
    }

    const { data, error } = await supabase.rpc('apply_transfer_fee', {
      p_transfer: fee.transferId,
      p_intent: fee.intentId,
      p_ownership_id: minted.ownershipId,
      p_tag_ref: minted.tagRef,
      p_salt_enc: minted.saltEnc,
      p_source: source,
    });
    if (error) return { outcome: 'failed', tagId, errorCode: 'apply_rpc_failed' };

    const outcome = rpcOutcome(data);
    if (outcome === 'applied') {
      emitSecurityEvent({
        event: 'transfer.state_change',
        transfer_id: fee.transferId,
        from: 'PENDING',
        to: 'COMPLETED',
        trigger: source,
        result: 'ok',
        request_id: ctx.requestId,
        actor_id: ctx.actorId,
        actor_type: ctx.actorType,
        ip: ctx.ip,
        route: ctx.route,
      });
    }
    return { outcome, tagId };
  } catch (err) {
    return {
      outcome: 'failed',
      errorCode: err instanceof Error && err.message === 'apply_unknown_outcome' ? 'apply_unknown_outcome' : 'apply_threw',
    };
  }
};

/**
 * Applies a paid re-issue fee: AWAITING_PAYMENT -> PAID and nothing else. The
 * chip swap stays a separate admin step. Never throws.
 */
export const applyReissueFee = async (
  supabase: SupabaseClient,
  fee: FeeIntent,
  source: FeeSource,
): Promise<ApplyResult> => {
  if (!fee.reissueRequestId) return { outcome: 'not_found' };

  try {
    const { data, error } = await supabase.rpc('apply_reissue_fee', {
      p_request: fee.reissueRequestId,
      p_intent: fee.intentId,
      p_source: source,
    });
    if (error) return { outcome: 'failed', errorCode: 'apply_rpc_failed' };

    const row = data as { requester_id?: string | null; charged_amount?: number | null } | null;
    return {
      outcome: rpcOutcome(data),
      requesterId: row?.requester_id ?? null,
      chargedAmount: row?.charged_amount ?? null,
    };
  } catch (err) {
    return {
      outcome: 'failed',
      errorCode: err instanceof Error && err.message === 'apply_unknown_outcome' ? 'apply_unknown_outcome' : 'apply_threw',
    };
  }
};

export type VoucherOutcome =
  | 'applied'
  /** The fee payer has no usable voucher. Nothing changed: take a card payment. */
  | 'no_voucher'
  | 'not_found'
  | 'not_payable'
  | 'no_recipient'
  /** A card payment was already started for this transfer. */
  | 'intent_mismatch'
  | 'failed';

export interface VoucherResult {
  readonly outcome: VoucherOutcome;
  readonly grantId?: string | null;
  readonly payerId?: string | null;
  readonly errorCode?: string;
}

/**
 * S-ADMIN1 Ph3b: uses one of the fee payer's free-transfer vouchers and
 * completes the transfer, in one database transaction
 * (`redeem_transfer_voucher`, which calls `apply_transfer_fee` with the
 * 'voucher' source). The voucher use rolls back with any failure. The payer is
 * decided by the database from the row, not by this caller. Never throws.
 */
export const redeemTransferVoucher = async (
  supabase: SupabaseClient,
  transferId: string,
  tagId: string,
  ctx: SecurityLogContext,
): Promise<VoucherResult> => {
  let minted;
  try {
    minted = mintOwnershipProof({ tagId, ownershipEventId: transferId, ownershipEventType: 'transfer' }, ctx);
  } catch {
    return { outcome: 'failed', errorCode: 'proof_mint_failed' };
  }

  try {
    const { data, error } = await supabase.rpc('redeem_transfer_voucher', {
      p_transfer: transferId,
      p_ownership_id: minted.ownershipId,
      p_tag_ref: minted.tagRef,
      p_salt_enc: minted.saltEnc,
    });
    if (error) {
      const key = (error.message ?? '').split(':')[0].trim();
      return { outcome: 'failed', errorCode: key.startsWith('voucher_apply_') ? key : 'redeem_rpc_failed' };
    }

    const row = data as { outcome?: unknown; grant_id?: string | null; payer_id?: string | null } | null;
    switch (row?.outcome) {
      case 'applied':
        emitSecurityEvent({
          event: 'transfer.state_change',
          transfer_id: transferId,
          from: 'PENDING',
          to: 'COMPLETED',
          trigger: 'voucher',
          result: 'ok',
          request_id: ctx.requestId,
          actor_id: ctx.actorId,
          actor_type: ctx.actorType,
          ip: ctx.ip,
          route: ctx.route,
        });
        return { outcome: 'applied', grantId: row.grant_id ?? null, payerId: row.payer_id ?? null };
      case 'no_voucher':
      case 'not_found':
      case 'not_payable':
      case 'no_recipient':
      case 'intent_mismatch':
        return { outcome: row.outcome };
      default:
        return { outcome: 'failed', errorCode: 'redeem_unknown_outcome' };
    }
  } catch {
    return { outcome: 'failed', errorCode: 'redeem_threw' };
  }
};

export const applyFee = (
  supabase: SupabaseClient,
  fee: FeeIntent,
  source: FeeSource,
  ctx: SecurityLogContext,
): Promise<ApplyResult> =>
  fee.kind === 'transfer_fee' ? applyTransferFee(supabase, fee, source, ctx) : applyReissueFee(supabase, fee, source);
