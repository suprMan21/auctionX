/**
 * S-2FA Ph3b — email-code account recovery and the backup email
 * (plan docs/plans/2026-10-27-s-2fa-ph3b.md; S-2FAb AC7, AC13).
 *
 * Rules (Boss, 2026-10-27):
 *   - Recovery starts from a password-only session (or Supabase's reset link)
 *     with a 6-digit code sent to the account email or the verified backup
 *     email, and waits 72 hours. Every channel is told at once; any session
 *     that passed an existing method can cancel it.
 *   - After the hold, a FRESH code (same channel, this session) finishes it:
 *     old backup codes void, a 7-day freeze starts, this session may add ONE
 *     passkey or authenticator app (mfaService, `recoveryEnrolment`) and may
 *     set a new password once.
 *   - Old methods are kept. During the freeze, a step-up with an OLD method
 *     (`recovery_undo`) undoes it: the methods it added go, every other session
 *     ends, the owner gets a new set of backup codes.
 *   - Never for staff accounts. Never for an account without a passkey or an
 *     authenticator app (nothing to recover: add one). Never from a session
 *     that already passed its second factor.
 *   - Codes go through SES only, are bound to the session and the browser's
 *     nonce, and are never logged.
 */

import { randomUUID } from 'crypto';
import { AppError } from '../errors';
import { log } from '../logger';
import { isSecurityMailConfigured } from '../notifications/securityMailSender';
import { sendCodeEmail } from './codeEmail';
import {
  ACCOUNT_CHANGE_PERMIT_TTL_MS,
  EMAIL_CODE_TTL_MS,
  RECOVERY_ENROL_MINUTES,
  RECOVERY_FREEZE_DAYS,
  RECOVERY_HOLD_HOURS,
} from './config';
import {
  generateEmailCode,
  hashEmailCode,
  hashNonce,
  maskEmail,
  normaliseEmailCode,
  NONCE_PATTERN,
  type EmailChannel,
  type EmailCodePurpose,
} from './emailCodes';
import { sendMfaEmail, type MfaEmail } from './mfaEmails';
import {
  assertVerifiedSession,
  emit,
  hasSecondFactor,
  refuse,
  refuseIfFrozen,
  requireSessionId,
  type Caller,
} from './mfaService';
import { generateRecoveryCodes, hashRecoveryCode } from './recoveryCodes';
import { activeFreeze } from './recoveryState';
import { getMfaStore, type RecoveryRow } from './store';

/** What the controller adds to the caller for these routes. */
export interface RecoveryContext {
  /** The account's confirmed auth email (lower case), or null. */
  primaryEmail: string | null;
  /** X-Recovery-Nonce as sent (validated here). */
  nonce: string | undefined;
  /** "Chrome on Mac", for the code email. */
  device: string;
}

const nonceHashOf = (ctx: RecoveryContext): string => {
  if (!ctx.nonce || !NONCE_PATTERN.test(ctx.nonce)) {
    refuse('invalid_argument', 'Refresh the page and try again.', 'nonce_required');
  }
  return hashNonce(ctx.nonce as string);
};

const isStaff = async (userId: string): Promise<boolean> => (await getMfaStore().staffRole(userId)) !== null;

const hasMethod = async (userId: string): Promise<boolean> => {
  const store = getMfaStore();
  const [passkeys, totp] = await Promise.all([store.listPasskeys(userId), store.getTotp(userId)]);
  return passkeys.length > 0 || Boolean(totp?.verified_at);
};

const holdOver = (r: RecoveryRow, now = Date.now()): boolean => Date.parse(r.hold_ends_at) <= now;

/** The account email, plus the verified backup email. Every recovery notice goes to both. */
const channelAddresses = async (userId: string, primaryEmail: string | null): Promise<Record<EmailChannel, string | null>> => {
  const backup = await getMfaStore().getBackupEmail(userId);
  return { primary: primaryEmail, backup: backup?.verified_at ? backup.email : null };
};

const notifyAll = async (userId: string, primaryEmail: string | null, email: MfaEmail): Promise<void> => {
  const to = await channelAddresses(userId, primaryEmail);
  sendMfaEmail(to.primary, email);
  if (to.backup && to.backup !== to.primary) sendMfaEmail(to.backup, email);
};

// ── Codes ───────────────────────────────────────────────────────────────────

const SEND_LIMIT_MESSAGE: Record<'cooldown' | 'hour_limit' | 'day_limit', string> = {
  cooldown: 'Wait a minute before asking for another code.',
  hour_limit: 'Too many codes asked for. Try again in an hour.',
  day_limit: 'Too many codes asked for today. Try again tomorrow.',
};

/** Stores the HMAC (limits checked in the database), then sends through SES. */
const issueAndSend = async (
  caller: Caller,
  ctx: RecoveryContext,
  purpose: EmailCodePurpose,
  channel: EmailChannel,
  to: string,
) => {
  const sessionId = requireSessionId(caller);
  const nonceHash = nonceHashOf(ctx);
  // Checked first: a code that cannot be sent must not use up the send limits.
  if (!isSecurityMailConfigured()) {
    emit(caller, 'email_code_send', 'email_code', 'unavailable', false);
    refuse('unavailable', "We can't send codes right now. Try again later.", 'mail_unavailable');
  }
  const id = randomUUID();
  const code = generateEmailCode();
  const issued = await getMfaStore().issueEmailCode({
    id,
    user_id: caller.userId,
    session_id: sessionId,
    nonce_hash: nonceHash,
    purpose,
    channel,
    code_hash: hashEmailCode({ purpose, id, userId: caller.userId, sessionId, code }),
    expires_at: new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString(),
  });
  if (issued.status !== 'ok') {
    emit(caller, 'email_code_send', 'email_code', 'rate_limited', false);
    throw new AppError('resource_exhausted', SEND_LIMIT_MESSAGE[issued.status], { reason: 'code_send_limit' });
  }
  if (!(await sendCodeEmail(to, purpose, code, ctx.device))) {
    emit(caller, 'email_code_send', 'email_code', 'unavailable', false);
    refuse('unavailable', "We couldn't send the code. Try again in a minute.", 'mail_unavailable');
  }
  emit(caller, 'email_code_send', 'email_code', 'ok', false);
  return {
    codeId: id,
    purpose,
    sentTo: maskEmail(to),
    expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString(),
    resendAfter: issued.retryAfter,
  };
};

/** Spends a code or throws. Returns the channel it was sent to. */
const checkEmailCode = async (
  caller: Caller,
  ctx: RecoveryContext,
  purpose: EmailCodePurpose,
  input: { codeId: string; code: string },
): Promise<EmailChannel> => {
  const sessionId = requireSessionId(caller);
  const nonceHash = nonceHashOf(ctx);
  const code = normaliseEmailCode(input.code);
  const result = await getMfaStore().useEmailCode({
    id: input.codeId,
    userId: caller.userId,
    sessionId,
    nonceHash,
    purpose,
    // Junk that can never be a code still costs an attempt: hash something.
    codeHash: hashEmailCode({ purpose, id: input.codeId, userId: caller.userId, sessionId, code: code ?? 'x' }),
  });
  if (result.result === 'ok' && result.channel) {
    emit(caller, 'email_code_check', 'email_code', 'ok', false);
    return result.channel;
  }
  if (result.result === 'wrong') {
    emit(caller, 'email_code_check', 'email_code', 'invalid_code', false);
    refuse('invalid_argument', 'That code did not work. Check it and try again.', 'invalid_code');
  }
  if (result.result === 'locked') {
    emit(caller, 'email_code_check', 'email_code', 'mfa_locked', false);
    refuse('resource_exhausted', 'Too many tries. Ask for a new code.', 'code_locked');
  }
  emit(caller, 'email_code_check', 'email_code', 'invalid_code', false);
  return refuse('invalid_argument', 'This code has expired. Ask for a new one.', 'code_expired');
};

// ── Recovery ────────────────────────────────────────────────────────────────

type Availability =
  | { ok: true }
  | { ok: false; why: 'staff' | 'no_method' | 'verified' | 'frozen' | 'no_email' };

const availability = async (caller: Caller, primaryEmail: string | null): Promise<Availability> => {
  if (await isStaff(caller.userId)) return { ok: false, why: 'staff' };
  if (!(await hasMethod(caller.userId))) return { ok: false, why: 'no_method' };
  if (await hasSecondFactor(caller.userId, caller.sessionId)) return { ok: false, why: 'verified' };
  if (await activeFreeze(caller.userId)) return { ok: false, why: 'frozen' };
  if (!primaryEmail) return { ok: false, why: 'no_email' };
  return { ok: true };
};

const NOT_AVAILABLE: Record<Exclude<Availability, { ok: true }>['why'], string> = {
  staff: 'Staff accounts cannot be recovered by email. Ask the super admin for help.',
  no_method: 'This account has no passkey or authenticator app yet. Add one instead.',
  verified: 'You are already signed in with your passkey or code.',
  frozen: 'This account was recovered recently. Try again when the pause ends.',
  no_email: 'Confirm your email address first.',
};

const assertAvailable = async (caller: Caller, primaryEmail: string | null): Promise<void> => {
  const a = await availability(caller, primaryEmail);
  if (!a.ok) refuse('failed_precondition', NOT_AVAILABLE[a.why], 'recovery_not_available');
};

/** The recovery screen's state. Addresses masked; nothing about other sessions. */
export const recoveryOverview = async (caller: Caller, ctx: RecoveryContext) => {
  const [a, recovery, to] = await Promise.all([
    availability(caller, ctx.primaryEmail),
    getMfaStore().latestRecovery(caller.userId),
    channelAddresses(caller.userId, ctx.primaryEmail),
  ]);
  const holding = recovery?.status === 'holding' ? recovery : null;
  return {
    available: a.ok || (holding !== null && !(await isStaff(caller.userId))),
    notAvailableReason: a.ok ? null : a.why,
    channels: (['primary', 'backup'] as const)
      .filter((c) => to[c])
      .map((c) => ({ channel: c, sentTo: maskEmail(to[c] as string) })),
    recovery: holding
      ? { status: 'holding' as const, holdEndsAt: holding.hold_ends_at, ready: holdOver(holding), channel: holding.channel }
      : null,
  };
};

/**
 * Sends a code. No waiting recovery: a `recovery_start` code to the chosen
 * channel. A recovery whose hold is over: a `recovery_finish` code to the
 * channel it started on (the body's channel is ignored).
 */
export const sendRecoveryCode = async (caller: Caller, ctx: RecoveryContext, input: { channel?: EmailChannel }) => {
  requireSessionId(caller);
  if (await isStaff(caller.userId)) {
    refuse('failed_precondition', NOT_AVAILABLE.staff, 'recovery_not_available');
  }
  const recovery = await getMfaStore().latestRecovery(caller.userId);
  if (recovery?.status === 'holding') {
    if (!holdOver(recovery)) {
      refuse('failed_precondition', 'Your recovery is waiting. You can finish it when the wait ends.', 'recovery_waiting');
    }
    if (await hasSecondFactor(caller.userId, caller.sessionId)) {
      refuse('failed_precondition', NOT_AVAILABLE.verified, 'recovery_not_available');
    }
    const to = (await channelAddresses(caller.userId, ctx.primaryEmail))[recovery.channel];
    if (!to) refuse('failed_precondition', 'The address this recovery started with is no longer on the account.', 'recovery_not_available');
    return issueAndSend(caller, ctx, 'recovery_finish', recovery.channel, to as string);
  }

  await assertAvailable(caller, ctx.primaryEmail);
  const channel = input.channel ?? 'primary';
  const to = (await channelAddresses(caller.userId, ctx.primaryEmail))[channel];
  if (!to) refuse('invalid_argument', 'There is no confirmed backup email on this account.', 'recovery_not_available');
  return issueAndSend(caller, ctx, 'recovery_start', channel, to as string);
};

/** A right `recovery_start` code starts the 72 h hold. */
export const startRecovery = async (caller: Caller, ctx: RecoveryContext, input: { codeId: string; code: string }) => {
  const sessionId = requireSessionId(caller);
  // Checked before the code is spent, and again (atomically) by the database.
  await assertAvailable(caller, ctx.primaryEmail);
  const channel = await checkEmailCode(caller, ctx, 'recovery_start', input);
  const started = await getMfaStore().startRecovery(caller.userId, sessionId, channel, RECOVERY_HOLD_HOURS);
  if (started.status === 'busy') {
    refuse('failed_precondition', 'A recovery is already waiting on this account.', 'recovery_waiting');
  }
  if (started.status === 'frozen') refuse('failed_precondition', NOT_AVAILABLE.frozen, 'recovery_not_available');
  emit(caller, 'recovery_start', 'email_code', 'ok', false);
  await notifyAll(caller.userId, ctx.primaryEmail, {
    kind: 'recovery_started', holdEndsAt: started.holdEndsAt as string, device: ctx.device,
  });
  return { status: 'holding' as const, holdEndsAt: started.holdEndsAt, channel };
};

/**
 * A right `recovery_finish` code after the hold finishes the recovery. With
 * `setPassword`, also issues one password permit (the Ph2b lock otherwise
 * refuses a password change, and the freeze refuses the usual route to one).
 */
export const finishRecovery = async (
  caller: Caller,
  ctx: RecoveryContext,
  input: { codeId: string; code: string; setPassword?: boolean },
) => {
  const sessionId = requireSessionId(caller);
  if (await isStaff(caller.userId)) refuse('failed_precondition', NOT_AVAILABLE.staff, 'recovery_not_available');
  const recovery = await getMfaStore().latestRecovery(caller.userId);
  if (recovery?.status !== 'holding') refuse('failed_precondition', 'There is no recovery to finish.', 'recovery_not_available');
  if (!holdOver(recovery as RecoveryRow)) {
    refuse('failed_precondition', 'Your recovery is waiting. You can finish it when the wait ends.', 'recovery_waiting');
  }
  await checkEmailCode(caller, ctx, 'recovery_finish', input);
  const store = getMfaStore();
  const done = await store.finishRecovery(caller.userId, sessionId, RECOVERY_FREEZE_DAYS, RECOVERY_ENROL_MINUTES);
  if (done.status === 'not_ready') {
    refuse('failed_precondition', 'Your recovery is waiting. You can finish it when the wait ends.', 'recovery_waiting');
  }
  if (done.status !== 'ok') refuse('failed_precondition', 'There is no recovery to finish.', 'recovery_not_available');

  let passwordPermitExpiresAt: string | null = null;
  if (input.setPassword) {
    passwordPermitExpiresAt = new Date(Date.now() + ACCOUNT_CHANGE_PERMIT_TTL_MS).toISOString();
    await store.createAuthChangePermit(caller.userId, 'password', passwordPermitExpiresAt);
    emit(caller, 'account_change_permit', null, 'ok', false, 'account_change');
  }
  emit(caller, 'recovery_finish', 'email_code', 'ok', false);
  await notifyAll(caller.userId, ctx.primaryEmail, { kind: 'recovery_finished', freezeEndsAt: done.freezeEndsAt as string });
  return {
    status: 'completed' as const,
    freezeEndsAt: done.freezeEndsAt,
    addMethodBefore: done.enrolUntil,
    passwordPermitExpiresAt,
  };
};

/** Any session that passed an existing method may cancel a waiting recovery. */
export const cancelRecovery = async (caller: Caller, ctx: RecoveryContext) => {
  await assertVerifiedSession(caller);
  const id = await getMfaStore().cancelRecovery(caller.userId);
  if (!id) throw new AppError('not_found', 'There is no recovery waiting');
  emit(caller, 'recovery_cancel', null, 'ok', false);
  await notifyAll(caller.userId, ctx.primaryEmail, { kind: 'recovery_cancelled' });
  return { cancelled: id };
};

/**
 * Undoes a finished recovery during its freeze. The `recovery_undo` step-up
 * (an OLD passkey or authenticator app, bound to this recovery id) is spent by
 * the route before this runs.
 */
export const undoRecovery = async (caller: Caller, ctx: RecoveryContext, recoveryId: string) => {
  const sessionId = requireSessionId(caller);
  await assertVerifiedSession(caller);
  const store = getMfaStore();
  // One transaction: the added methods go AND every other session ends, or nothing happens.
  const undone = await store.undoRecovery(caller.userId, recoveryId, sessionId);
  if (undone.status !== 'ok') throw new AppError('not_found', 'There is no recovery to undo');

  // The recovery voided the old codes: the owner gets a fresh set.
  const codes = generateRecoveryCodes();
  try {
    await store.replaceRecoveryCodes(caller.userId, codes.map((c) => hashRecoveryCode(caller.userId, c)));
  } catch (err) {
    // The undo already happened; the owner can make codes from Security settings.
    log.error('recovery_undo_codes_failed', {
      requestId: caller.log.requestId, error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
    emit(caller, 'recovery_undo', null, 'ok', false, 'recovery_undo');
    await notifyAll(caller.userId, ctx.primaryEmail, { kind: 'recovery_undone' });
    return { undone: recoveryId, backupCodes: null, otherSessionsEnded: true };
  }
  emit(caller, 'recovery_undo', null, 'ok', false, 'recovery_undo');
  await notifyAll(caller.userId, ctx.primaryEmail, { kind: 'recovery_undone' });
  return { undone: recoveryId, backupCodes: codes, otherSessionsEnded: true };
};

/**
 * Before the `recovery_undo` step-up is spent (review L2): verified session and
 * a recovery with this id that can still be undone.
 */
export const assertMayUndo = async (caller: Caller, recoveryId: string): Promise<void> => {
  await assertVerifiedSession(caller);
  const r = await getMfaStore().latestRecovery(caller.userId);
  if (!r || r.id !== recoveryId || r.status !== 'completed' || !r.freeze_ends_at || Date.parse(r.freeze_ends_at) <= Date.now()) {
    throw new AppError('not_found', 'There is no recovery to undo');
  }
};

// ── Backup email ────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Sets an unverified backup email and sends it a code. The `recovery_channel`
 * step-up is spent by the route first. Staff accounts have no email recovery,
 * so no backup email either.
 */
export const addBackupEmail = async (caller: Caller, ctx: RecoveryContext, rawEmail: string) => {
  const email = await assertMayAddBackupEmail(caller, ctx, rawEmail);
  // Code first (review L2): a send limit or SES failure leaves the stored
  // address untouched. A confirmed address keeps working until the new one is
  // confirmed (it is kept as the pending replacement meanwhile).
  const sent = await issueAndSend(caller, ctx, 'backup_email_verify', 'backup', email);
  await getMfaStore().setPendingBackupEmail(caller.userId, email);
  emit(caller, 'backup_email_add', null, 'ok', false, 'recovery_channel');
  return sent;
};

/**
 * Every refusal of a backup-email add, checked BEFORE the route spends the
 * `recovery_channel` step-up (so a refused request never burns it). Returns
 * the normalised address.
 */
export const assertMayAddBackupEmail = async (caller: Caller, ctx: RecoveryContext, rawEmail: string): Promise<string> => {
  await assertMayChangeBackupEmail(caller);
  const email = rawEmail.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new AppError('invalid_argument', 'Enter a valid email address');
  if (ctx.primaryEmail && email === ctx.primaryEmail) {
    refuse('invalid_argument', 'Use a different address from the one you sign in with.', 'same_as_account_email');
  }
  if (!isSecurityMailConfigured()) {
    refuse('unavailable', "We can't send codes right now. Try again later.", 'mail_unavailable');
  }
  nonceHashOf(ctx);
  return email;
};

/** Verified session, not frozen, not staff. */
export const assertMayChangeBackupEmail = async (caller: Caller): Promise<void> => {
  await assertVerifiedSession(caller);
  await refuseIfFrozen(caller, 'recovery_channel');
  if (await isStaff(caller.userId)) {
    refuse('failed_precondition', 'Staff accounts cannot be recovered by email.', 'recovery_not_available');
  }
};

export const verifyBackupEmail = async (caller: Caller, ctx: RecoveryContext, input: { codeId: string; code: string }) => {
  await assertVerifiedSession(caller);
  await refuseIfFrozen(caller, 'recovery_channel');
  const store = getMfaStore();
  const row = await store.getBackupEmail(caller.userId);
  // The address waiting for this code: the pending replacement, or an unconfirmed first address.
  const target = row?.pending_email ?? (row && !row.verified_at ? row.email : null);
  if (!row || !target) refuse('failed_precondition', 'Add the backup email again.', 'not_available');
  const previous = { email: row!.email, verified: Boolean(row!.verified_at) };
  await checkEmailCode(caller, ctx, 'backup_email_verify', input);
  // Conditional on the address: a replace in between makes this a no-op.
  if (!(await store.verifyBackupEmail(caller.userId, target as string))) {
    refuse('failed_precondition', 'Add the backup email again.', 'not_available');
  }
  emit(caller, 'backup_email_verify', 'email_code', 'ok', false);
  sendMfaEmail(ctx.primaryEmail, { kind: 'backup_email_added' });
  sendMfaEmail(target, { kind: 'backup_email_added' });
  // Replaced a confirmed address: it is told it no longer works.
  if (previous.verified && previous.email !== target) sendMfaEmail(previous.email, { kind: 'backup_email_removed' });
  return { backupEmail: { masked: maskEmail(target as string), verified: true } };
};

/** The `recovery_channel` step-up is spent by the route first. */
export const removeBackupEmail = async (caller: Caller, ctx: RecoveryContext) => {
  await assertVerifiedSession(caller);
  await refuseIfFrozen(caller, 'recovery_channel');
  const removed = await getMfaStore().deleteBackupEmail(caller.userId);
  if (!removed) throw new AppError('not_found', 'There is no backup email');
  emit(caller, 'backup_email_remove', null, 'ok', false, 'recovery_channel');
  sendMfaEmail(ctx.primaryEmail, { kind: 'backup_email_removed' });
  sendMfaEmail(removed, { kind: 'backup_email_removed' });
  return { removed: true };
};
