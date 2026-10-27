/**
 * S-2FA — second factors, the per-session marker, and step-up grants.
 *
 * Rules (plan docs/plans/2026-10-27-s-2fa.md, Boss decisions 2026-10-27):
 *   - Factors: passkeys (any number), one authenticator app, 10 backup codes.
 *     The first factor also makes the backup codes (shown once).
 *   - Adding a factor needs a session that already passed its second factor,
 *     except the very first one (nothing to check against yet).
 *   - Removing a factor needs a step-up, and the last factor can never go.
 *   - Step-up is single use, for one action on one target. What may confirm it:
 *       factor_add / factor_remove / recovery_regen: passkey, authenticator code
 *         or backup code (a user who lost their phone must be able to fix this);
 *       release / transfer_complete: passkey or authenticator code, never a
 *         backup code; staff accounts passkey only (Boss, 2026-10-27; this
 *         replaces the passkey-only release decision of 2026-10-03 for
 *         non-staff accounts);
 *       price_change / admin_action / admin_approve: passkey only.
 *   - Adding or removing a sign-in method, or making new backup codes, ends
 *     every other session of the account (Ph2). The change is committed first;
 *     if ending the other sessions fails, it is logged loudly and the response
 *     says `otherSessionsEnded: false` rather than failing a change that
 *     already happened.
 *   - Staff accounts' own sign-in method changes and code lockouts also go to
 *     audit_logs (method only, written after the change, never blocking).
 *   - super_admin is the break-glass account: device-bound passkeys only (a
 *     hardware key; synced passkeys refused), no authenticator app, a 1-hour
 *     marker, and an alert email on every sign-in.
 *   - 5 wrong codes (authenticator or backup) lock code entry for 15 minutes.
 *     Passkeys cannot be guessed, so they never count and are never locked.
 */

import { createHash, randomBytes } from 'crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { AppError } from '../errors';
import { emitSecurityEvent } from '../security/securityEvent';
import type { SecurityLogContext } from '../ownership/ownershipProof';
import {
  CHALLENGE_TTL_MS,
  STEP_UP_TTL_MS,
  SUPER_ADMIN_SESSION_TTL_MS,
  mfaSessionTtlMs,
  webAuthnConfig,
} from './config';
import { generateRecoveryCodes, hashRecoveryCode, normaliseRecoveryCode } from './recoveryCodes';
import { openSecret, sealSecret } from './secretBox';
import { generateTotpSecret, matchTotp, otpauthUri, base32Encode } from './totp';
import { sendMfaEmail } from './mfaEmails';
import { log } from '../logger';
import { getMfaStore, type MfaMethod, type PasskeyRow, type StaffMfaAuditAction, type StepUpAction } from './store';

export const STEP_UP_ACTIONS: readonly StepUpAction[] = [
  'release', 'transfer_complete', 'price_change', 'factor_remove', 'factor_add', 'recovery_regen',
  'admin_action', 'admin_approve',
];

/**
 * Changing the sign-in methods themselves may be confirmed with an
 * authenticator or backup code as well as a passkey: someone who lost their
 * phone must still be able to add a new passkey and remove the lost one.
 */
export const CODE_STEP_UP_ACTIONS: readonly StepUpAction[] = ['factor_add', 'factor_remove', 'recovery_regen'];

/**
 * Token actions a non-staff account may confirm with its authenticator app
 * (Boss, 2026-10-27). Never with a backup code, and never for staff: staff
 * confirm these with a passkey. Every other action is passkey only.
 */
export const TOTP_STEP_UP_ACTIONS: readonly StepUpAction[] = ['release', 'transfer_complete'];

export interface Caller {
  userId: string;
  /** Supabase session_id claim. Null means this token cannot carry a second factor. */
  sessionId: string | null;
  email: string | null;
  log: SecurityLogContext;
}

// ── Errors (closed set of client reasons) ───────────────────────────────────

export type MfaReason =
  | 'second_factor_required'
  | 'step_up_required'
  | 'mfa_locked'
  | 'invalid_code'
  | 'passkey_invalid'
  | 'synced_passkey_not_allowed'
  | 'last_factor'
  | 'already_set_up'
  | 'no_passkey'
  | 'not_available'
  /** Staff confirm token actions with a passkey only. */
  | 'passkey_required'
  /** A backup code cannot confirm a token action (passkey or authenticator app). */
  | 'backup_code_not_allowed';

const refuse = (code: 'permission_denied' | 'invalid_argument' | 'conflict' | 'resource_exhausted' | 'failed_precondition',
  message: string, reason: MfaReason): never => {
  throw new AppError(code, message, { reason });
};

const requireSessionId = (caller: Caller): string => {
  if (!caller.sessionId) {
    refuse('permission_denied', 'Sign in again to continue', 'second_factor_required');
  }
  return caller.sessionId as string;
};

const isSuperAdmin = async (userId: string): Promise<boolean> =>
  (await getMfaStore().staffRole(userId)) === 'super_admin';

const emit = (
  caller: Caller,
  action: 'enrol' | 'remove' | 'sign_in' | 'step_up_issue' | 'step_up_use' | 'recovery_regen' | 'lockout',
  method: MfaMethod | null,
  result: 'ok' | 'invalid_code' | 'mfa_locked' | 'step_up_required' | 'forbidden',
  breakGlass: boolean,
  stepUpAction: StepUpAction | null = null,
): void => {
  emitSecurityEvent({
    event: 'auth.mfa',
    action,
    method,
    step_up_action: stepUpAction,
    break_glass: breakGlass,
    result,
    request_id: caller.log.requestId,
    actor_id: caller.log.actorId,
    actor_type: caller.log.actorType,
    ip: caller.log.ip,
    route: caller.log.route,
  });
};

const nowIso = (): string => new Date().toISOString();

const errText = (err: unknown): string => (err instanceof Error ? err.message.slice(0, 200) : 'unknown');

/**
 * Staff accounts' own sign-in method changes go to audit_logs as well. Runs
 * AFTER the change is committed, so a failed write is logged, never thrown:
 * the change already happened and the security event still records it.
 */
const auditIfStaff = async (caller: Caller, action: StaffMfaAuditAction, method: MfaMethod | null): Promise<void> => {
  try {
    if (!(await getMfaStore().staffRole(caller.userId))) return;
    if (!caller.email) {
      log.error('mfa_staff_audit_skipped', { requestId: caller.log.requestId, action, cause: 'no_email' });
      return;
    }
    await getMfaStore().writeStaffAudit({
      adminId: caller.userId,
      adminEmail: caller.email,
      action,
      method,
      ip: caller.log.ip === 'unknown' ? null : caller.log.ip,
    });
  } catch (err) {
    log.error('mfa_staff_audit_failed', { requestId: caller.log.requestId, action, error: errText(err) });
  }
};

/**
 * Ends every other session of the account after a sign-in method changed,
 * keeping the caller's. Never throws: the change is already committed, so a
 * failure is logged loudly and reported as `otherSessionsEnded: false`.
 */
const endOtherSessions = async (caller: Caller): Promise<boolean> => {
  if (!caller.sessionId) return false;
  try {
    await getMfaStore().endOtherSessions(caller.userId, caller.sessionId);
    return true;
  } catch (err) {
    log.error('mfa_end_other_sessions_failed', { requestId: caller.log.requestId, actorId: caller.userId, error: errText(err) });
    return false;
  }
};

/** Everything that follows a committed sign-in method change. */
const afterFactorChange = async (caller: Caller, action: StaffMfaAuditAction, method: MfaMethod): Promise<boolean> => {
  const [ended] = await Promise.all([endOtherSessions(caller), auditIfStaff(caller, action, method)]);
  return ended;
};
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

// ── Status ──────────────────────────────────────────────────────────────────

interface FactorSummary {
  passkeys: PasskeyRow[];
  totpConfirmed: boolean;
  total: number;
}

const factorSummary = async (userId: string): Promise<FactorSummary> => {
  const store = getMfaStore();
  const [passkeys, totp] = await Promise.all([store.listPasskeys(userId), store.getTotp(userId)]);
  const totpConfirmed = Boolean(totp?.verified_at);
  return { passkeys, totpConfirmed, total: passkeys.length + (totpConfirmed ? 1 : 0) };
};

export const hasSecondFactor = async (userId: string, sessionId: string | null): Promise<boolean> => {
  if (!sessionId) return false;
  return Boolean(await getMfaStore().getSession(sessionId, userId, nowIso()));
};

/**
 * Public-safe status: never a public key, credential id, secret or hash.
 * `secondFactorRequired` (the caller's input) = the server refuses this
 * account's token / admin actions without a verified second factor.
 * `isStaff` tells the frontend to offer only a passkey for token step-ups.
 */
export const getStatus = async (caller: Caller, secondFactorRequired: boolean) => {
  const store = getMfaStore();
  const [summary, codesLeft, verified, role, lockedUntil] = await Promise.all([
    factorSummary(caller.userId),
    store.countRecoveryCodes(caller.userId),
    hasSecondFactor(caller.userId, caller.sessionId),
    store.staffRole(caller.userId),
    store.lockedUntil(caller.userId, nowIso()),
  ]);
  return {
    passkeys: summary.passkeys.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      synced: p.backed_up,
      createdAt: p.created_at,
      lastUsedAt: p.last_used_at,
    })),
    authenticatorApp: summary.totpConfirmed,
    backupCodesLeft: codesLeft,
    hasFactor: summary.total > 0,
    sessionVerified: verified,
    enrolmentRequired: secondFactorRequired && summary.total === 0,
    secondFactorRequired,
    breakGlass: role === 'super_admin',
    isStaff: role !== null,
    codeEntryLockedUntil: lockedUntil,
  };
};

/** First factor, or a session that already passed its second factor. */
const assertMayEnrol = async (caller: Caller): Promise<{ first: boolean }> => {
  const summary = await factorSummary(caller.userId);
  if (summary.total === 0) return { first: true };
  if (!(await hasSecondFactor(caller.userId, caller.sessionId))) {
    refuse('permission_denied', 'Confirm it is you with your passkey or code first', 'second_factor_required');
  }
  return { first: false };
};

const assertVerifiedSession = async (caller: Caller): Promise<void> => {
  if (!(await hasSecondFactor(caller.userId, caller.sessionId))) {
    refuse('permission_denied', 'Confirm it is you with your passkey or code first', 'second_factor_required');
  }
};

/** Marks this session and, for a first factor, makes the backup codes. */
const finishFirstFactor = async (caller: Caller, method: MfaMethod, superAdmin: boolean): Promise<string[]> => {
  const codes = generateRecoveryCodes();
  await getMfaStore().replaceRecoveryCodes(caller.userId, codes.map((c) => hashRecoveryCode(caller.userId, c)));
  await markVerified(caller, method, superAdmin);
  return codes;
};

const markVerified = async (caller: Caller, method: MfaMethod, superAdmin: boolean): Promise<void> => {
  const ttl = superAdmin ? SUPER_ADMIN_SESSION_TTL_MS : mfaSessionTtlMs();
  await getMfaStore().markSession({
    session_id: requireSessionId(caller),
    user_id: caller.userId,
    method,
    expires_at: new Date(Date.now() + ttl).toISOString(),
  });
};

// ── Passkey registration ────────────────────────────────────────────────────

const toBytes = (buf: Buffer): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(buf.length));
  out.set(buf);
  return out;
};

const userIdBytes = (userId: string): Uint8Array<ArrayBuffer> => toBytes(Buffer.from(userId.replace(/-/g, ''), 'hex'));

export const passkeyRegisterOptions = async (caller: Caller, stepUpToken?: string) => {
  const sessionId = requireSessionId(caller);
  const { first } = await assertMayEnrol(caller);
  // A stolen session must not be able to plant its own passkey.
  if (!first) await requireFreshCheck(caller, stepUpToken, 'factor_add', 'passkey');
  const cfg = webAuthnConfig();
  const store = getMfaStore();
  const [existing, superAdmin] = await Promise.all([store.listPasskeys(caller.userId), isSuperAdmin(caller.userId)]);

  const options = await generateRegistrationOptions({
    rpName: cfg.rpName,
    rpID: cfg.rpId,
    userName: caller.email ?? caller.userId,
    userID: userIdBytes(caller.userId),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credential_id, transports: p.transports })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
      // Break-glass keys live on a hardware key, not in a phone's keychain.
      ...(superAdmin ? { authenticatorAttachment: 'cross-platform' as const } : {}),
    },
    ...(superAdmin ? { preferredAuthenticatorType: 'securityKey' as const } : {}),
  });

  const challengeId = await store.createChallenge({
    user_id: caller.userId,
    session_id: sessionId,
    purpose: 'register',
    challenge: options.challenge,
    action: null,
    target_id: null,
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });
  return { challengeId, options };
};

export const passkeyRegisterVerify = async (
  caller: Caller,
  input: { challengeId: string; nickname: string; response: RegistrationResponseJSON },
) => {
  const sessionId = requireSessionId(caller);
  const { first } = await assertMayEnrol(caller);
  const store = getMfaStore();
  const superAdmin = await isSuperAdmin(caller.userId);

  // Spent before it is checked: a failed attempt cannot be retried with the same challenge.
  const challenge = await store.consumeChallenge(input.challengeId, caller.userId, sessionId, 'register', nowIso());
  if (!challenge) refuse('invalid_argument', 'That took too long. Try again.', 'passkey_invalid');

  const cfg = webAuthnConfig();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge!.challenge,
      expectedOrigin: cfg.origins,
      expectedRPID: cfg.rpId,
      requireUserVerification: true,
    });
  } catch {
    verification = { verified: false as const };
  }
  if (!verification.verified) {
    emit(caller, 'enrol', 'passkey', 'invalid_code', superAdmin);
    refuse('invalid_argument', 'That passkey could not be added. Try again.', 'passkey_invalid');
  }

  const info = verification.registrationInfo!;
  if (superAdmin && info.credentialBackedUp) {
    emit(caller, 'enrol', 'passkey', 'forbidden', true);
    refuse('invalid_argument', 'This account needs a hardware security key, not a synced passkey.', 'synced_passkey_not_allowed');
  }

  const inserted = await store.insertPasskey({
    user_id: caller.userId,
    credential_id: info.credential.id,
    public_key: Buffer.from(info.credential.publicKey).toString('base64url'),
    sign_count: info.credential.counter,
    transports: info.credential.transports ?? [],
    aaguid: info.aaguid ?? null,
    backed_up: info.credentialBackedUp,
    nickname: input.nickname.trim(),
  });
  if (!inserted) refuse('conflict', 'That passkey is already added', 'already_set_up');
  const row = inserted!;

  const backupCodes = first ? await finishFirstFactor(caller, 'passkey', superAdmin) : null;
  emit(caller, 'enrol', 'passkey', 'ok', superAdmin);
  notify(caller, superAdmin, { kind: 'factor_added', method: 'passkey', nickname: row.nickname });
  // A first factor ends the other sessions too: harmless, and it signs out
  // anyone else who was already in with just the password.
  const otherSessionsEnded = await afterFactorChange(caller, 'mfa_factor_add', 'passkey');

  return {
    passkey: { id: row.id, nickname: row.nickname, synced: row.backed_up, createdAt: row.created_at },
    backupCodes,
    otherSessionsEnded,
  };
};

// ── Passkey assertion (sign-in second step and step-up) ─────────────────────

const usablePasskeys = (passkeys: PasskeyRow[], superAdmin: boolean): PasskeyRow[] =>
  superAdmin ? passkeys.filter((p) => !p.backed_up) : passkeys;

const assertionOptions = async (
  caller: Caller,
  purpose: 'sign_in' | 'step_up',
  stepUp: { action: StepUpAction; targetId: string } | null,
) => {
  const sessionId = requireSessionId(caller);
  const store = getMfaStore();
  const [passkeys, superAdmin] = await Promise.all([store.listPasskeys(caller.userId), isSuperAdmin(caller.userId)]);
  const usable = usablePasskeys(passkeys, superAdmin);
  if (usable.length === 0) {
    refuse('failed_precondition', 'Add a passkey first', 'no_passkey');
  }
  const cfg = webAuthnConfig();
  const options = await generateAuthenticationOptions({
    rpID: cfg.rpId,
    userVerification: 'required',
    allowCredentials: usable.map((p) => ({ id: p.credential_id, transports: p.transports })),
  });
  const challengeId = await store.createChallenge({
    user_id: caller.userId,
    session_id: sessionId,
    purpose,
    challenge: options.challenge,
    action: stepUp?.action ?? null,
    target_id: stepUp?.targetId ?? null,
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });
  return { challengeId, options };
};

/** Spends the challenge, then checks the assertion against one of the caller's usable passkeys. */
const verifyAssertion = async (
  caller: Caller,
  purpose: 'sign_in' | 'step_up',
  challengeId: string,
  response: AuthenticationResponseJSON,
  superAdmin: boolean,
) => {
  const sessionId = requireSessionId(caller);
  const store = getMfaStore();
  const challenge = await store.consumeChallenge(challengeId, caller.userId, sessionId, purpose, nowIso());
  if (!challenge) return null;

  const passkey = await store.getPasskeyByCredentialId(response.id);
  // Another account's passkey, or a synced one on the break-glass account: no.
  if (!passkey || passkey.user_id !== caller.userId || (superAdmin && passkey.backed_up)) return null;

  const cfg = webAuthnConfig();
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: cfg.origins,
      expectedRPID: cfg.rpId,
      requireUserVerification: true,
      credential: {
        id: passkey.credential_id,
        publicKey: toBytes(Buffer.from(passkey.public_key, 'base64url')),
        counter: Number(passkey.sign_count),
        transports: passkey.transports,
      },
    });
    if (!result.verified) return null;
    await store.recordPasskeyUse(passkey.id, result.authenticationInfo.newCounter);
    return { challenge, passkey };
  } catch {
    return null;
  }
};

export const signInOptions = (caller: Caller) => assertionOptions(caller, 'sign_in', null);

export type SignInInput =
  | { passkey: { challengeId: string; response: AuthenticationResponseJSON } }
  | { totp: { code: string } }
  | { recoveryCode: { code: string } };

type CodeInput = { totp: { code: string } } | { recoveryCode: { code: string } };
type CodeAction = 'sign_in' | 'step_up_issue' | 'enrol';

const LOCKED_MESSAGE = 'Too many wrong codes. Try again later, or use your passkey.';

/**
 * Counts the attempt before the code is checked (one locked database call), so
 * a burst of parallel requests cannot get more than 5 tries per lock window.
 */
const startCodeAttempt = async (caller: Caller, method: MfaMethod, superAdmin: boolean, action: CodeAction): Promise<void> => {
  const { lockedUntil, newlyLocked } = await getMfaStore().beginCodeAttempt(caller.userId);
  if (!lockedUntil) return;
  if (newlyLocked) {
    emit(caller, 'lockout', method, 'mfa_locked', superAdmin);
    notify(caller, superAdmin, { kind: 'code_entry_locked' });
    await auditIfStaff(caller, 'mfa_lockout', method);
  }
  emit(caller, action, method, 'mfa_locked', superAdmin);
  throw new AppError('resource_exhausted', LOCKED_MESSAGE, { reason: 'mfa_locked' });
};

const wrongCode = (caller: Caller, method: MfaMethod, superAdmin: boolean, action: CodeAction): never => {
  emit(caller, action, method, 'invalid_code', superAdmin);
  return refuse('invalid_argument', 'That code did not work. Check it and try again.', 'invalid_code');
};

/**
 * Checks an authenticator or backup code (spending it). Returns the method and,
 * for a backup code, how many are left. Wrong codes throw `invalid_code`.
 */
const checkCode = async (
  caller: Caller,
  input: CodeInput,
  superAdmin: boolean,
  action: CodeAction,
): Promise<{ method: 'totp' | 'recovery_code'; left: number | null }> => {
  const store = getMfaStore();

  if ('totp' in input) {
    if (superAdmin) refuse('permission_denied', 'This account signs in with its security key.', 'not_available');
    await startCodeAttempt(caller, 'totp', superAdmin, action);
    const totp = await store.getTotp(caller.userId);
    if (!totp?.verified_at) return wrongCode(caller, 'totp', superAdmin, action);
    const step = matchTotp(openSecret(totp.secret_enc, caller.userId), input.totp.code.trim(), Date.now());
    // A matched step at or below the last one used is a replay, and fails the same way.
    if (step === null || !(await store.useTotpStep(caller.userId, step, false))) {
      return wrongCode(caller, 'totp', superAdmin, action);
    }
    await store.clearFailures(caller.userId);
    return { method: 'totp', left: null };
  }

  await startCodeAttempt(caller, 'recovery_code', superAdmin, action);
  const normalised = normaliseRecoveryCode(input.recoveryCode.code);
  // Junk that can never be a code still costs an attempt.
  if (!normalised) return wrongCode(caller, 'recovery_code', superAdmin, action);
  const left = await store.useRecoveryCode(caller.userId, hashRecoveryCode(caller.userId, normalised));
  if (left === null) return wrongCode(caller, 'recovery_code', superAdmin, action);
  await store.clearFailures(caller.userId);
  notify(caller, superAdmin, { kind: 'recovery_code_used', left });
  return { method: 'recovery_code', left };
};

export const signInVerify = async (caller: Caller, input: SignInInput) => {
  requireSessionId(caller);
  const superAdmin = await isSuperAdmin(caller.userId);

  if ('passkey' in input) {
    const ok = await verifyAssertion(caller, 'sign_in', input.passkey.challengeId, input.passkey.response, superAdmin);
    if (!ok) {
      emit(caller, 'sign_in', 'passkey', 'invalid_code', superAdmin);
      refuse('invalid_argument', 'That passkey check did not work. Try again.', 'passkey_invalid');
    }
    await markVerified(caller, 'passkey', superAdmin);
    emit(caller, 'sign_in', 'passkey', 'ok', superAdmin);
    if (superAdmin) sendMfaEmail(breakGlassAlertTo(caller), { kind: 'break_glass_sign_in', method: 'passkey' });
    return { method: 'passkey' as const, backupCodesLeft: null };
  }

  const { method, left } = await checkCode(caller, input, superAdmin, 'sign_in');
  await markVerified(caller, method, superAdmin);
  emit(caller, 'sign_in', method, 'ok', superAdmin);
  if (superAdmin) sendMfaEmail(breakGlassAlertTo(caller), { kind: 'break_glass_sign_in', method: 'recovery_code' });
  return { method, backupCodesLeft: left };
};

/** Boss's daily inbox when set; otherwise the account's own address. */
const breakGlassAlertTo = (caller: Caller): string | null =>
  process.env.BREAK_GLASS_ALERT_EMAIL?.trim() || caller.email;

/** The account's own address, plus the alert inbox for the break-glass account. */
const notify = (caller: Caller, superAdmin: boolean, email: Parameters<typeof sendMfaEmail>[1]): void => {
  sendMfaEmail(caller.email, email);
  const alert = superAdmin ? breakGlassAlertTo(caller) : null;
  if (alert && alert.toLowerCase() !== (caller.email ?? '').toLowerCase()) sendMfaEmail(alert, email);
};

/** Spends a step-up grant for this action, or refuses with `step_up_required`. */
const requireFreshCheck = async (caller: Caller, token: string | undefined, action: StepUpAction, targetId: string) => {
  if (!(await consumeStepUp(caller, token, action, targetId))) {
    refuse('permission_denied', 'Confirm it is you to continue', 'step_up_required');
  }
};

// ── Step-up ─────────────────────────────────────────────────────────────────

export const stepUpOptions = async (caller: Caller, input: { action: StepUpAction; targetId: string }) => {
  await assertVerifiedSession(caller);
  return assertionOptions(caller, 'step_up', input);
};

export type StepUpVerifyInput =
  | { challengeId: string; response: AuthenticationResponseJSON }
  | ({ action: StepUpAction; targetId: string } & CodeInput);

const issueGrant = async (caller: Caller, sessionId: string, action: StepUpAction, targetId: string) => {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + STEP_UP_TTL_MS).toISOString();
  await getMfaStore().createGrant({
    token_hash: sha256Hex(token),
    user_id: caller.userId,
    session_id: sessionId,
    action,
    target_id: targetId,
    expires_at: expiresAt,
  });
  return { stepUpToken: token, expiresAt, action, targetId };
};

export const stepUpVerify = async (caller: Caller, input: StepUpVerifyInput) => {
  const sessionId = requireSessionId(caller);
  await assertVerifiedSession(caller);
  const role = await getMfaStore().staffRole(caller.userId);
  const superAdmin = role === 'super_admin';

  if ('challengeId' in input) {
    const ok = await verifyAssertion(caller, 'step_up', input.challengeId, input.response, superAdmin);
    if (!ok) {
      emit(caller, 'step_up_issue', 'passkey', 'invalid_code', superAdmin);
      refuse('invalid_argument', 'That passkey check did not work. Try again.', 'passkey_invalid');
    }
    const action = ok!.challenge.action as StepUpAction;
    const grant = await issueGrant(caller, sessionId, action, ok!.challenge.target_id as string);
    emit(caller, 'step_up_issue', 'passkey', 'ok', superAdmin, action);
    return grant;
  }

  // Refused before the code is checked, so a refused code is never spent.
  if (TOTP_STEP_UP_ACTIONS.includes(input.action)) {
    if (role !== null) refuse('invalid_argument', 'Staff accounts confirm this with a passkey', 'passkey_required');
    if (!('totp' in input)) {
      refuse('invalid_argument', 'Use your passkey or authenticator app to confirm this', 'backup_code_not_allowed');
    }
  } else if (!CODE_STEP_UP_ACTIONS.includes(input.action)) {
    refuse('invalid_argument', 'Use your passkey to confirm this', 'no_passkey');
  }
  const { method } = await checkCode(caller, input, superAdmin, 'step_up_issue');
  const grant = await issueGrant(caller, sessionId, input.action, input.targetId);
  emit(caller, 'step_up_issue', method, 'ok', superAdmin, input.action);
  return grant;
};

/** Spends a grant. True only for this user, this session, this action and this target, once. */
export const consumeStepUp = async (
  caller: Caller,
  token: string | undefined,
  action: StepUpAction,
  targetId: string,
): Promise<boolean> => {
  const superAdmin = await isSuperAdmin(caller.userId);
  const ok = Boolean(
    token &&
      caller.sessionId &&
      /^[A-Za-z0-9_-]{43}$/.test(token) &&
      (await getMfaStore().consumeGrant(sha256Hex(token), caller.userId, caller.sessionId, action, targetId, nowIso())),
  );
  // The grant does not record how it was issued (step_up_issue carries the method).
  emit(caller, 'step_up_use', null, ok ? 'ok' : 'step_up_required', superAdmin, action);
  return ok;
};

// ── Authenticator app ───────────────────────────────────────────────────────

export const totpSetup = async (caller: Caller, stepUpToken?: string) => {
  requireSessionId(caller);
  if (await isSuperAdmin(caller.userId)) {
    refuse('permission_denied', 'This account signs in with its security key only.', 'not_available');
  }
  const { first } = await assertMayEnrol(caller);
  if (!first) await requireFreshCheck(caller, stepUpToken, 'factor_add', 'totp');
  const secret = generateTotpSecret();
  const started = await getMfaStore().startTotp(caller.userId, sealSecret(secret, caller.userId));
  if (!started) refuse('conflict', 'An authenticator app is already set up', 'already_set_up');
  return {
    secret: base32Encode(secret),
    otpauthUri: otpauthUri(secret, caller.email ?? 'account', 'Authentic Materials'),
  };
};

export const totpConfirm = async (caller: Caller, input: { code: string }) => {
  requireSessionId(caller);
  const { first } = await assertMayEnrol(caller);
  const store = getMfaStore();
  const totp = await store.getTotp(caller.userId);
  if (!totp || totp.verified_at) refuse('failed_precondition', 'Start the authenticator app setup again', 'not_available');
  await startCodeAttempt(caller, 'totp', false, 'enrol');
  const step = matchTotp(openSecret(totp!.secret_enc, caller.userId), input.code.trim(), Date.now());
  if (step === null || !(await store.useTotpStep(caller.userId, step, true))) {
    return wrongCode(caller, 'totp', false, 'enrol');
  }
  await store.clearFailures(caller.userId);
  const backupCodes = first ? await finishFirstFactor(caller, 'totp', false) : null;
  emit(caller, 'enrol', 'totp', 'ok', false);
  sendMfaEmail(caller.email, { kind: 'factor_added', method: 'totp' });
  const otherSessionsEnded = await afterFactorChange(caller, 'mfa_factor_add', 'totp');
  return { authenticatorApp: true, backupCodes, otherSessionsEnded };
};

// ── Backup codes ────────────────────────────────────────────────────────────

export const regenerateRecoveryCodes = async (caller: Caller, stepUpToken?: string) => {
  await assertVerifiedSession(caller);
  const summary = await factorSummary(caller.userId);
  if (summary.total === 0) refuse('failed_precondition', 'Add a passkey first', 'no_passkey');
  // A stolen session must not be able to void the owner's codes and take a set.
  await requireFreshCheck(caller, stepUpToken, 'recovery_regen', 'recovery_codes');
  const codes = generateRecoveryCodes();
  await getMfaStore().replaceRecoveryCodes(caller.userId, codes.map((c) => hashRecoveryCode(caller.userId, c)));
  const superAdmin = await isSuperAdmin(caller.userId);
  emit(caller, 'recovery_regen', 'recovery_code', 'ok', superAdmin);
  notify(caller, superAdmin, { kind: 'recovery_codes_new' });
  const otherSessionsEnded = await afterFactorChange(caller, 'mfa_recovery_regen', 'recovery_code');
  return { backupCodes: codes, otherSessionsEnded };
};

// ── Manage factors ──────────────────────────────────────────────────────────

export const renamePasskey = async (caller: Caller, id: string, nickname: string) => {
  await assertVerifiedSession(caller);
  const ok = await getMfaStore().renamePasskey(caller.userId, id, nickname.trim());
  if (!ok) throw new AppError('not_found', 'Passkey not found');
  return { id, nickname: nickname.trim() };
};

/**
 * The step-up for `factor_remove` is spent by the route before this runs.
 * The last factor can never be removed: the account would have no second
 * factor and no way to prove it is the owner. A super_admin must keep at least
 * one hardware key.
 */
export const removePasskey = async (caller: Caller, id: string) => {
  const store = getMfaStore();
  const [passkeys, superAdmin] = await Promise.all([store.listPasskeys(caller.userId), isSuperAdmin(caller.userId)]);
  const target = passkeys.find((p) => p.id === id);
  if (!target) throw new AppError('not_found', 'Passkey not found');
  const result = await store.removeFactor(caller.userId, 'passkey', id, superAdmin);
  if (result === 'not_found') throw new AppError('not_found', 'Passkey not found');
  if (result === 'last_factor') {
    refuse('failed_precondition', 'Add another passkey before removing this one', 'last_factor');
  }
  emit(caller, 'remove', 'passkey', 'ok', superAdmin);
  notify(caller, superAdmin, { kind: 'factor_removed', method: 'passkey', nickname: target.nickname });
  const otherSessionsEnded = await afterFactorChange(caller, 'mfa_factor_remove', 'passkey');
  return { removed: id, otherSessionsEnded };
};

export const removeTotp = async (caller: Caller) => {
  const superAdmin = await isSuperAdmin(caller.userId);
  const result = await getMfaStore().removeFactor(caller.userId, 'totp', null, superAdmin);
  if (result === 'not_found') throw new AppError('not_found', 'No authenticator app is set up');
  if (result === 'last_factor') {
    refuse('failed_precondition', 'Add a passkey before removing your authenticator app', 'last_factor');
  }
  emit(caller, 'remove', 'totp', 'ok', superAdmin);
  notify(caller, superAdmin, { kind: 'factor_removed', method: 'totp' });
  const otherSessionsEnded = await afterFactorChange(caller, 'mfa_factor_remove', 'totp');
  return { removed: 'totp', otherSessionsEnded };
};
