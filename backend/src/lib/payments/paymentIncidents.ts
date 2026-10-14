/**
 * Stuck-payment incidents — S-ADMIN1 Ph3a.
 *
 * One `payment_incidents` row per PaymentIntent that succeeded in Stripe but
 * did not apply. The row is the admin queue entry and the dedup key for its
 * GitHub Issue: the first sighting opens the issue, a repeat comments on it at
 * most once every six hours, and a resolution comments once.
 *
 * Nothing here throws. Recording an incident is a side effect of a payment
 * path that has already gone wrong; it must not make it worse.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '../logger';
import { commentOnIssue, createIssue, isGithubIssuesConfigured } from '../github/issues';
import type { ApplyOutcome, FeeIntent } from './tokenFeeApply';

export type IncidentReason =
  | 'webhook_missed'
  | 'apply_failed'
  | 'no_recipient'
  | 'not_payable'
  | 'intent_mismatch'
  | 'row_missing';

export type IncidentStatus = 'OPEN' | 'RESOLVED' | 'REFUNDED';

// One literal on purpose: schemaColumnDrift.test.ts reads `*COLUMNS` constants.
export const PAYMENT_INCIDENT_COLUMNS =
  'id, kind, transfer_id, reissue_request_id, stripe_payment_intent_id, reason, status, resolution, amount, currency, first_seen_at, last_seen_at, seen_count, last_error, github_issue_number, github_issue_url, github_last_comment_at, resolved_at, resolved_by, stripe_refund_id';

export interface IncidentRow {
  id: string;
  kind: 'transfer_fee' | 'reissue_fee';
  transfer_id: string | null;
  reissue_request_id: string | null;
  stripe_payment_intent_id: string;
  reason: IncidentReason;
  status: IncidentStatus;
  resolution: string | null;
  amount: number | null;
  currency: string | null;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
  last_error: string | null;
  github_issue_number: number | null;
  github_issue_url: string | null;
  github_last_comment_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  stripe_refund_id: string | null;
}

/** An apply outcome that leaves money taken and nothing delivered. */
export const reasonForOutcome = (outcome: ApplyOutcome): IncidentReason | null => {
  switch (outcome) {
    case 'not_found':
      return 'row_missing';
    case 'intent_mismatch':
      return 'intent_mismatch';
    case 'not_payable':
      return 'not_payable';
    case 'no_recipient':
      return 'no_recipient';
    case 'failed':
      return 'apply_failed';
    default:
      return null;
  }
};

const REPEAT_COMMENT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ISSUE_CLAIM_TTL_MS = 5 * 60 * 1000;

const REASON_TEXT: Record<IncidentReason, string> = {
  webhook_missed: 'Stripe reports the payment succeeded, but no webhook applied it.',
  apply_failed: 'The payment succeeded, but applying it failed.',
  no_recipient: 'The payment succeeded, but the transfer has no resolved recipient.',
  not_payable: 'The payment succeeded, but the row it pays for was cancelled or changed.',
  intent_mismatch: 'The payment succeeded, but its row is bound to a different PaymentIntent.',
  row_missing: 'The payment succeeded, but the row named in its metadata does not exist.',
};

/** Fixed fields only. Every value is an id, a code or a number we generated. */
const issueBody = (row: IncidentRow, requestId: string): string =>
  [
    REASON_TEXT[row.reason],
    row.status === 'RESOLVED'
      ? `Already applied (${row.resolution ?? 'unknown'}); nothing is owed. This ticket is for finding out why it was not applied the normal way.`
      : 'Still open: the payer has been charged and nothing has been delivered.',
    '',
    '| Field | Value |',
    '|---|---|',
    `| Incident | \`${row.id}\` |`,
    `| Kind | \`${row.kind}\` |`,
    `| Reason | \`${row.reason}\` |`,
    `| Transfer | \`${row.transfer_id ?? 'none'}\` |`,
    `| Re-issue request | \`${row.reissue_request_id ?? 'none'}\` |`,
    `| PaymentIntent | \`${row.stripe_payment_intent_id}\` |`,
    `| Amount | \`${row.amount ?? 'unknown'} ${row.currency ?? ''}\` (minor units) |`,
    `| Error code | \`${row.last_error ?? 'none'}\` |`,
    `| Request id | \`${requestId}\` |`,
    `| First seen | \`${row.first_seen_at}\` |`,
    '',
    'Open incidents are resolved from the admin console: Stuck payments. Re-apply re-runs the webhook apply; never edit ownership by hand.',
    'This issue carries ids only. Do not paste customer details into it.',
  ].join('\n');

const issueTitle = (row: IncidentRow): string =>
  `[stuck-payment] ${row.kind} ${row.reason} (${row.id.slice(0, 8)})`;

/**
 * Opens the issue for a new incident, or comments on a repeat. A claim column
 * stops two concurrent sightings (webhook retry + sweep) opening two issues.
 */
const notifyGithub = async (
  supabase: SupabaseClient,
  row: IncidentRow,
  requestId: string,
  isNew: boolean,
): Promise<void> => {
  if (!isGithubIssuesConfigured()) return;
  // A closed incident gets its issue only when it was born closed (the sweep
  // applied a payment whose webhook never came); it never gets repeat comments.
  if (row.status !== 'OPEN' && !(isNew && row.github_issue_number === null)) return;

  if (row.github_issue_number === null) {
    // Unclaimed first; otherwise take over a claim whose owner never finished.
    const claim = () =>
      supabase
        .from('payment_incidents')
        .update({ github_claimed_at: new Date().toISOString() })
        .eq('id', row.id)
        .is('github_issue_number', null);
    const staleBefore = new Date(Date.now() - ISSUE_CLAIM_TTL_MS).toISOString();

    const fresh = await claim().is('github_claimed_at', null).select('id').maybeSingle();
    if (fresh.error) return;
    if (!fresh.data) {
      const stale = await claim().lt('github_claimed_at', staleBefore).select('id').maybeSingle();
      if (stale.error || !stale.data) return;
    }

    const issue = await createIssue(issueTitle(row), issueBody(row, requestId));
    if (!issue) return;

    const { error } = await supabase
      .from('payment_incidents')
      .update({
        github_issue_number: issue.number,
        github_issue_url: issue.url,
        github_last_comment_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (error) log.error('payment_incident_issue_link_failed', { incidentId: row.id, issue: issue.number });
    return;
  }

  const last = row.github_last_comment_at ? Date.parse(row.github_last_comment_at) : 0;
  if (Date.now() - last < REPEAT_COMMENT_INTERVAL_MS) return;

  const sent = await commentOnIssue(
    row.github_issue_number,
    `Seen again: \`${row.reason}\`, error code \`${row.last_error ?? 'none'}\`, ${row.seen_count} sightings, request id \`${requestId}\`.`,
  );
  if (sent) {
    await supabase
      .from('payment_incidents')
      .update({ github_last_comment_at: new Date().toISOString() })
      .eq('id', row.id);
  }
};

/**
 * Records a sighting of a stuck payment and tells the debug team. Returns the
 * incident row, or null if even recording it failed (logged loudly: that is
 * the one case where a stuck payment could go unseen until the next sweep).
 */
export const reportStuckPayment = async (
  supabase: SupabaseClient,
  fee: FeeIntent,
  reason: IncidentReason,
  opts: {
    readonly requestId: string;
    readonly errorCode?: string;
    /** The sweep has already applied this payment: record it closed. */
    readonly resolvedAs?: 'sweep';
  },
): Promise<(IncidentRow & { is_new: boolean }) | null> => {
  try {
    const { data, error } = await supabase.rpc('record_payment_incident', {
      p_kind: fee.kind,
      p_intent: fee.intentId,
      p_transfer: fee.transferId,
      p_reissue: fee.reissueRequestId,
      p_reason: reason,
      p_amount: fee.amount,
      p_currency: fee.currency,
      p_error: opts.errorCode ?? null,
      p_resolved_as: opts.resolvedAs ?? null,
    });
    if (error || !data) {
      log.error('payment_incident_record_failed', {
        kind: fee.kind,
        transferId: fee.transferId,
        reissueRequestId: fee.reissueRequestId,
        reason,
      });
      return null;
    }

    const raw = data as IncidentRow & { is_new?: boolean };
    const row = { ...raw, is_new: raw.is_new === true };
    log.error('token_fee_stuck', {
      incidentId: row.id,
      kind: row.kind,
      reason: row.reason,
      transferId: row.transfer_id,
      reissueRequestId: row.reissue_request_id,
      seenCount: row.seen_count,
      isNew: row.is_new,
      status: row.status,
    });

    await notifyGithub(supabase, row, opts.requestId, row.is_new).catch(() => undefined);
    return row;
  } catch {
    log.error('payment_incident_record_failed', { kind: fee.kind, reason });
    return null;
  }
};

/** One comment when an incident closes. The issue itself is closed by a person. */
export const noteIncidentClosed = async (
  supabase: SupabaseClient,
  incidentId: string,
  how: 'reapply' | 'refund' | 'sweep',
): Promise<void> => {
  try {
    if (!isGithubIssuesConfigured()) return;
    const { data } = await supabase
      .from('payment_incidents')
      .select('id, github_issue_number, status, resolution')
      .eq('id', incidentId)
      .maybeSingle();
    const issue = (data as { github_issue_number: number | null } | null)?.github_issue_number;
    if (!issue) return;
    await commentOnIssue(
      issue,
      how === 'refund'
        ? 'Closed in the admin console: the payment was refunded.'
        : `Closed: the payment was applied (${how}).`,
    );
  } catch {
    // Never let a comment fail an admin action.
  }
};
