/**
 * Anchoring alerts — S-ANCHOR1 Ph1.
 *
 * Each alert is one row in anchor_alerts, deduplicated by key; the first
 * sighting opens ONE GitHub Issue (label `anchoring`), repeats only count.
 * Every alert also logs at ERROR so CloudWatch shows it without GitHub.
 *
 * Details carry hashes, block numbers and public chain addresses only, never
 * an email, a tag UID, an account id or user text.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '../logger';
import { ANCHORING_LABEL, createIssue, isGithubIssuesConfigured } from '../github/issues';

export type AnchorAlertKind =
  | 'unmatched_event'
  | 'writer_changed'
  | 'writer_mismatch'
  | 'low_balance'
  | 'anchor_failing'
  | 'anchor_reverted'
  | 'anchor_stuck';

export type AlertDetail = Readonly<Record<string, string | number | boolean | null>>;

const TITLES: Record<AnchorAlertKind, string> = {
  unmatched_event: 'Registry write with no matching batch (possible forged write)',
  writer_changed: 'Registry writer changed to an address that is not our KMS writer',
  writer_mismatch: 'Registry writer is not our KMS key: anchoring sends are paused',
  low_balance: 'Anchoring writer wallet is low on Base ETH',
  anchor_failing: 'Anchor batch keeps failing to send',
  anchor_reverted: 'Anchor transaction reverted',
  anchor_stuck: 'Anchor transaction not mined after an hour',
};

const issueBody = (kind: AnchorAlertKind, dedupeKey: string, detail: AlertDetail): string =>
  [
    `Kind: \`${kind}\``,
    `Key: \`${dedupeKey}\``,
    '',
    ...Object.entries(detail).map(([k, v]) => `- ${k}: \`${String(v)}\``),
    '',
    'Raised by the hourly anchor tick (S-ANCHOR1). Runbook: docs/S_ANCHOR1_PH1_VERIFICATION.md.',
  ].join('\n');

export const raiseAnchorAlert = async (
  supabase: SupabaseClient,
  kind: AnchorAlertKind,
  dedupeKey: string,
  detail: AlertDetail,
): Promise<void> => {
  log.error('anchor_alert', { kind, dedupeKey, ...detail });

  const { data, error } = await supabase.rpc('record_anchor_alert', {
    p_kind: kind,
    p_dedupe_key: dedupeKey,
    p_detail: detail,
  });
  if (error) {
    log.error('anchor_alert_record_failed', { kind, code: error.code ?? null });
    return;
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { alert_id: string; is_new: boolean; github_issue_number: number | null }
    | undefined;
  if (!row?.is_new || row.github_issue_number !== null || !isGithubIssuesConfigured()) return;

  const issue = await createIssue(`[anchoring] ${TITLES[kind]}`, issueBody(kind, dedupeKey, detail), [ANCHORING_LABEL]);
  if (!issue) return;

  const { error: linkError } = await supabase
    .from('anchor_alerts')
    .update({ github_issue_number: issue.number, github_issue_url: issue.url })
    .eq('id', row.alert_id)
    .is('github_issue_number', null);
  if (linkError) log.error('anchor_alert_issue_link_failed', { code: linkError.code ?? null });
};
