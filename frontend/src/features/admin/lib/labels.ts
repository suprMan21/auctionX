/**
 * Plain-English labels for the codes the admin API returns. Pages show these
 * instead of raw enum values. Anything not listed falls back to its words in
 * sentence case ("payment_refund" -> "Payment refund").
 */

/** "payment_refund", "PAYMENT_REFUND" or "session.completed" -> "Payment refund" / "Session completed". */
export const sentenceCase = (value: string): string => {
  const words = value.replace(/[._-]+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
};

const lookup = (map: Record<string, string>, value: string | null | undefined, fallback: string): string => {
  if (value === null || value === undefined || value === '') return fallback;
  return map[value] ?? map[value.toUpperCase()] ?? map[value.toLowerCase()] ?? sentenceCase(value);
};

// ─── Tokens ──────────────────────────────────────────────────────────────────

const LIFECYCLE: Record<string, string> = {
  ACTIVE: 'Active',
  ENROLLED: 'Ready to claim',
  CLAIMED: 'Claimed',
  ASSOCIATED: 'Linked to item',
  SUSPENDED: 'Suspended',
  RETIRED: 'Retired',
  RELEASED: 'Released by owner',
  TRANSFERRED: 'Transferred',
};

/** Token lifecycle status. */
export const lifecycleLabel = (status: string | null | undefined): string => lookup(LIFECYCLE, status, 'Unknown');

const DESTRUCTION: Record<string, string> = { PENDING: 'Pending', DESTROYED: 'Destroyed' };

/** Whether a retired chip has been physically destroyed. */
export const destructionLabel = (status: string | null | undefined): string => lookup(DESTRUCTION, status, 'Not recorded');

const TRANSFER_TYPE: Record<string, string> = {
  SALE: 'Sale',
  GIFT: 'Gift',
  RETURN: 'Return',
  RELEASE: 'Released by owner',
  REISSUE: 'Re-issue',
};

/** Ownership history: how the token changed hands. */
export const transferTypeLabel = (type: string | null | undefined): string => lookup(TRANSFER_TYPE, type, 'Unknown');

const TRANSFER_STATUS: Record<string, string> = {
  PENDING: 'Waiting',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** Ownership history: where the transfer got to. */
export const transferStatusLabel = (status: string | null | undefined): string => lookup(TRANSFER_STATUS, status, 'Unknown');

// ─── Re-issues ───────────────────────────────────────────────────────────────

const REISSUE_STATUS: Record<string, string> = {
  PENDING: 'Waiting for review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/** Re-issue request status. */
export const reissueStatusLabel = (status: string | null | undefined): string => lookup(REISSUE_STATUS, status, 'Unknown');

const REISSUE_PAYMENT: Record<string, string> = {
  AWAITING_PAYMENT: 'Waiting for payment',
  PAID: 'Paid',
  WAIVED: 'Fee waived',
};

/** Re-issue fee status. */
export const reissuePaymentLabel = (status: string | null | undefined): string => lookup(REISSUE_PAYMENT, status, 'No fee yet');

/** One line for a re-issue: the status, plus the fee state once approved. */
export const reissueStageLabel = (status: string, paymentStatus: string | null, done = false): string => {
  if (done) return 'Done';
  if (status === 'APPROVED' && paymentStatus === 'AWAITING_PAYMENT') return 'Waiting for payment';
  if (status === 'APPROVED' && paymentStatus === 'PAID') return 'Paid, ready for a new chip';
  if (status === 'APPROVED' && paymentStatus === 'WAIVED') return 'Fee waived, ready for a new chip';
  return reissueStatusLabel(status);
};

// ─── Two-admin approval (S-2FA Ph3a) ────────────────────────────────────────

const APPROVAL_ACTION: Record<string, string> = {
  tag_reset: 'Move token to a new chip',
  tag_suspend: 'Suspend token',
  account_suspend: 'Suspend account',
  account_retire: 'Retire account',
  reissue_fulfil: 'Move token to a new chip (re-issue)',
  tag_unsuspend: 'Lift token suspension',
  account_unsuspend: 'Lift account suspension',
  account_reactivate: 'Reactivate account',
};

/** What an approval request asks to do. */
export const approvalActionLabel = (action: string | null | undefined): string => lookup(APPROVAL_ACTION, action, 'Unknown');

const APPROVAL_STATUS: Record<string, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** Approval request status. */
export const approvalStatusLabel = (status: string | null | undefined): string => lookup(APPROVAL_STATUS, status, 'Unknown');

/** Shown on the buttons and in the helper text when an action waits for a second admin. */
export const APPROVAL_COPY = {
  button: 'Send for approval',
  busy: 'Sending…',
  helper: 'Another admin approves this before it happens. Nothing changes until then.',
  sentTitle: 'Sent for approval',
  sent: 'Another admin must approve this within 24 hours. Nothing has changed yet.',
  openRequest: 'Open the request',
  /** Re-issue fulfil always waits for a second admin (except super_admin). */
  fulfilHelper: 'Another admin approves this before the token moves. Nothing changes until then.',
  /** Lifting a hold waits only when someone else placed it; the dialog cannot tell in advance. */
  holdHelper: 'If another admin set this hold, a second admin approves lifting it.',
} as const;

/** One line for where a request got to, e.g. "Approved by admin2@… · Done". */
export const approvalOutcomeLabel = (a: {
  status: string;
  decidedBy: { email: string | null } | null;
  outcome: { ok: boolean; message: string | null } | null;
}): string => {
  const by = a.decidedBy?.email ? ` by ${a.decidedBy.email}` : '';
  switch (a.status) {
    case 'pending': return 'Waiting for another admin';
    case 'approved':
      if (a.outcome && !a.outcome.ok) return `Approved, but it did not run: ${a.outcome.message ?? 'no reason given'}`;
      return a.outcome?.ok ? `Approved${by} · Done` : `Approved${by}`;
    case 'rejected': return `Rejected${by}`;
    case 'cancelled': return 'Cancelled by the admin who asked';
    case 'expired': return 'Expired: nobody approved it within 24 hours';
    default: return approvalStatusLabel(a.status);
  }
};

// ─── Stuck payments ──────────────────────────────────────────────────────────

const STUCK_STATUS: Record<string, string> = { OPEN: 'Open', RESOLVED: 'Resolved', REFUNDED: 'Refunded' };

export const stuckStatusLabel = (status: string | null | undefined): string => lookup(STUCK_STATUS, status, 'Unknown');

// ─── Audit log ───────────────────────────────────────────────────────────────

const AUDIT_ACTION: Record<string, string> = {
  // Searches and look-ups (logged before they run)
  tag_search: 'Token search',
  user_search: 'Account search',
  voucher_search: 'Free transfers search',
  voucher_list: 'Free transfers looked up',
  user_tokens_view: "Viewed account's tokens",
  creator_id_view: "Viewed creator ID check",
  // Accounts
  account_suspend: 'Account suspended',
  account_unsuspend: 'Account suspension lifted',
  account_retire: 'Account retired',
  account_reactivate: 'Account reactivated',
  account_delete: 'Account deleted',
  delete_window_set: 'Delete waiting time changed',
  role_grant: 'Staff role granted',
  role_change: 'Staff role changed',
  account_type_change: 'Account type changed',
  // S-2FA: a staff account's own sign-in methods.
  mfa_factor_add: 'Sign-in method added',
  mfa_factor_remove: 'Sign-in method removed',
  mfa_recovery_regen: 'New backup codes made',
  mfa_lockout: 'Code entry locked',
  mfa_account_change_permit: 'Password or email change started',
  role_revoke: 'Staff role removed',
  role_set: 'Staff role changed',
  // Older account actions
  suspend_user: 'Account suspended',
  unsuspend_user: 'Account suspension lifted',
  ban_user: 'Account banned',
  unban_user: 'Account ban lifted',
  admin_deactivated: 'Staff access removed',
  session_revoked: 'Signed out',
  // Tokens
  tag_suspend: 'Token suspended',
  tag_unsuspend: 'Token suspension lifted',
  suspend: 'Token suspended',
  unsuspend: 'Token suspension lifted',
  tag_reset: 'Token moved to new chip',
  reset: 'Token moved to new chip',
  // Re-issues
  reissue_request: 'Re-issue requested',
  reissue_approve: 'Re-issue approved',
  reissue_approve_waived: 'Re-issue approved without fee',
  reissue_reject: 'Re-issue rejected',
  reissue_fulfil: 'Re-issue completed',
  // Stuck payments
  payment_reapply: 'Payment re-applied',
  payment_refund: 'Payment refunded',
  // Pricing and free transfers
  token_price_set: 'Price changed',
  token_price_cancel: 'Scheduled price change cancelled',
  voucher_grant: 'Free transfers granted',
  voucher_revoke: 'Free transfers revoked',
  // Creator ID checks
  override: 'Status changed by staff',
  // Two-admin approval
  approval_request: 'Sent for approval',
  approval_approve: 'Request approved',
  approval_reject: 'Request rejected',
  approval_cancel: 'Request cancelled',
};

/** An audit log action. */
export const auditActionLabel = (action: string | null | undefined): string => lookup(AUDIT_ACTION, action, 'Unknown');

const AUDIT_ENTITY: Record<string, string> = {
  user: 'Account',
  users: 'Account',
  admin_user: 'Staff member',
  admin_search: 'Search',
  tag: 'Token',
  nfc_tag: 'Token',
  reissue_request: 'Re-issue',
  payment_incident: 'Stuck payment',
  token_price: 'Price',
  transfer_voucher_grant: 'Free transfers',
  account_settings: 'Account settings',
  admin_approval: 'Approval request',
};

/** What an audit log entry is about. */
export const auditEntityLabel = (entity: string | null | undefined): string => lookup(AUDIT_ENTITY, entity, 'Unknown');

// ─── System health ───────────────────────────────────────────────────────────

const HEALTH_STATUS: Record<string, string> = { ok: 'Working', degraded: 'Slow', down: 'Down' };

export const healthStatusLabel = (status: string | null | undefined): string => lookup(HEALTH_STATUS, status, 'Unknown');

const HEALTH_COMPONENT: Record<string, string> = {
  database: 'Database',
  auth: 'Sign-in',
  storage: 'File storage',
};

export const healthComponentLabel = (name: string): string => lookup(HEALTH_COMPONENT, name, 'Unknown');

// ─── Creator ID checks (Yoti) ────────────────────────────────────────────────

const ID_CHECK_STATUS: Record<string, string> = {
  NONE: 'Not started',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  REVOKED: 'Revoked',
  FLAGGED: 'Flagged',
  VIDEO_UPLOADED: 'Video uploaded',
  NFC_PROGRAMMED: 'Chip set up',
};

export const idCheckStatusLabel = (status: string | null | undefined): string => lookup(ID_CHECK_STATUS, status, 'Unknown');

const ID_CHECK_PURPOSE: Record<string, string> = {
  seller_kyc: 'Creator ID check',
  age_gate: 'Age check',
  both: 'ID and age check',
};

export const idCheckPurposeLabel = (purpose: string | null | undefined): string => lookup(ID_CHECK_PURPOSE, purpose, 'Unknown');

const ID_SESSION_STATUS: Record<string, string> = {
  created: 'Started',
  in_progress: 'In progress',
  completed: 'Completed',
  failed: 'Failed',
  expired: 'Expired',
};

export const idSessionStatusLabel = (status: string | null | undefined): string => lookup(ID_SESSION_STATUS, status, 'Unknown');

/** Free-form codes (Yoti event types and the like): words in sentence case. */
export const codeLabel = (value: string | null | undefined, fallback: string): string =>
  value ? sentenceCase(value) : fallback;
