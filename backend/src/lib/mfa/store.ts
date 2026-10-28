/**
 * S-2FA persistence. One interface, a Supabase (service role) implementation,
 * and an in-memory fake for tests (src/__tests__/helpers/mfaStoreFake.ts).
 *
 * Every "use once" operation is a single conditional UPDATE ... WHERE used_at IS
 * NULL AND expires_at > now(), returning the row. Postgres applies it to one row
 * atomically, so two concurrent requests can never both spend the same
 * challenge, grant, recovery code or TOTP step. Every write checks `error`
 * (Every-Session lesson): a failed write fails the request, it never passes.
 */

import { isIP } from 'net';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../errors';

export type ChallengePurpose = 'register' | 'sign_in' | 'step_up';
export type MfaMethod = 'passkey' | 'totp' | 'recovery_code';
/** How a session's marker was earned: a method, or (Ph3b) finishing an email-code recovery. */
export type SessionMethod = MfaMethod | 'email_recovery';
export type StepUpAction =
  /** Ph3b: undo a finished recovery during its freeze (target = recovery id). Old method only. */
  | 'recovery_undo'
  /** Ph3b: add / replace / remove the backup email (target 'backup_email'). */
  | 'recovery_channel'
  | 'release'
  | 'transfer_complete'
  | 'price_change'
  | 'factor_remove'
  | 'factor_add'
  | 'recovery_regen'
  | 'admin_action'
  | 'admin_approve'
  /** Ph2b: a password change or email-change request (target = the kind). */
  | 'account_change';

/** What an auth_change_permits row allows (guard_auth_change on auth.users). */
export type AccountChangeKind = 'password' | 'email';

export interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  sign_count: number;
  transports: string[];
  aaguid: string | null;
  backed_up: boolean;
  nickname: string;
  created_at: string;
  last_used_at: string | null;
  /** NULL = usable now; otherwise it may sign in but not confirm a step-up before this time. */
  usable_from: string | null;
  /** Ph3b: the recovery that added it (undo removes it). Optional so older fakes still type-check. */
  added_by_recovery?: string | null;
}

export interface TotpRow {
  user_id: string;
  secret_enc: string;
  verified_at: string | null;
  last_used_step: number;
  /** NULL = usable now; otherwise it may sign in but not confirm a step-up before this time. */
  usable_from: string | null;
  /** Ph3b: the recovery that added it (undo removes it). */
  added_by_recovery?: string | null;
}

export interface ChallengeRow {
  id: string;
  user_id: string;
  session_id: string;
  purpose: ChallengePurpose;
  challenge: string;
  action: string | null;
  target_id: string | null;
  expires_at: string;
  /** register only: the factor_add step-up was confirmed by a code, so the new passkey waits. */
  code_confirmed?: boolean;
}

export interface MfaSessionRow {
  session_id: string;
  user_id: string;
  method: SessionMethod;
  expires_at: string;
}

export interface NewPasskey {
  user_id: string;
  credential_id: string;
  public_key: string;
  sign_count: number;
  transports: string[];
  aaguid: string | null;
  backed_up: boolean;
  nickname: string;
  /** Set when the passkey was added with a code-confirmed step-up (24 h wait). */
  usable_from?: string | null;
  /** Ph3b: set when the finishing session of a recovery adds it. */
  added_by_recovery?: string | null;
}

// ── Ph3b types ──────────────────────────────────────────────────────────────

export interface BackupEmailRow {
  email: string;
  verified_at: string | null;
  /** A replacement waiting for its code; the confirmed `email` keeps working meanwhile. */
  pending_email?: string | null;
}

export type RecoveryStatus = 'holding' | 'cancelled' | 'completed' | 'undone';

export interface RecoveryRow {
  id: string;
  channel: 'primary' | 'backup';
  status: RecoveryStatus;
  started_session_id: string;
  hold_ends_at: string;
  finished_at: string | null;
  finished_session_id: string | null;
  freeze_ends_at: string | null;
  enrol_until: string | null;
  enrolled_at: string | null;
  created_at: string;
}

export interface NewEmailCode {
  id: string;
  user_id: string;
  session_id: string;
  nonce_hash: string;
  purpose: 'recovery_start' | 'recovery_finish' | 'backup_email_verify';
  channel: 'primary' | 'backup';
  code_hash: string;
  expires_at: string;
}

export type IssueCodeStatus = 'ok' | 'cooldown' | 'hour_limit' | 'day_limit';
export type UseCodeResult = 'ok' | 'wrong' | 'locked' | 'expired' | 'invalid';

/** A spent grant. `method` is NULL only for grants issued before migration 20261027000009. */
export interface ConsumedGrant {
  method: MfaMethod | null;
}

export interface MfaStore {
  listPasskeys(userId: string): Promise<PasskeyRow[]>;
  getPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | null>;
  /** null when that credential is already registered (to any account). */
  insertPasskey(row: NewPasskey): Promise<PasskeyRow | null>;
  /** Conditional on the stored counter so a racing older assertion cannot roll it back. */
  recordPasskeyUse(id: string, newCount: number): Promise<void>;
  renamePasskey(userId: string, id: string, nickname: string): Promise<boolean>;
  /** Removes a factor under one row lock; never the last one (remove_mfa_factor). */
  removeFactor(userId: string, kind: 'passkey' | 'totp', id: string | null, breakGlass: boolean): Promise<'removed' | 'not_found' | 'last_factor'>;

  getTotp(userId: string): Promise<TotpRow | null>;
  /**
   * Replaces any unconfirmed setup; refuses (returns false) when a confirmed one exists.
   * `usableFrom` (or null) is stored as the app's step-up wait.
   */
  startTotp(userId: string, secretEnc: string, usableFrom: string | null, addedByRecovery?: string | null): Promise<boolean>;
  /** Spends `step` only if it is newer than the last one used; optionally confirms setup. */
  useTotpStep(userId: string, step: number, confirm: boolean): Promise<boolean>;

  replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void>;
  /** Spends one code; returns how many are left, or null when it was not a live code. */
  useRecoveryCode(userId: string, hash: string): Promise<number | null>;
  countRecoveryCodes(userId: string): Promise<number>;

  createChallenge(row: Omit<ChallengeRow, 'id'>): Promise<string>;
  consumeChallenge(id: string, userId: string, sessionId: string, purpose: ChallengePurpose, nowIso: string): Promise<ChallengeRow | null>;

  markSession(row: MfaSessionRow): Promise<void>;
  getSession(sessionId: string, userId: string, nowIso: string): Promise<MfaSessionRow | null>;

  createGrant(row: {
    token_hash: string; user_id: string; session_id: string; action: StepUpAction; target_id: string; expires_at: string;
    method: MfaMethod;
  }): Promise<void>;
  /** Spends a grant; null when there was no live grant to spend. */
  consumeGrant(tokenHash: string, userId: string, sessionId: string, action: StepUpAction, targetId: string, nowIso: string): Promise<ConsumedGrant | null>;

  /** null = not locked, otherwise the lock end. */
  lockedUntil(userId: string, nowIso: string): Promise<string | null>;
  /**
   * Counts an attempt BEFORE the code is checked (one locked statement), or
   * refuses it while locked. A right code then calls clearFailures.
   */
  beginCodeAttempt(userId: string): Promise<{ lockedUntil: string | null; newlyLocked: boolean }>;
  clearFailures(userId: string): Promise<void>;

  /** Active staff role name, or null for a non-staff account. */
  staffRole(userId: string): Promise<string | null>;

  /** `users.account_type` ('collector' | 'creator'), or null when the row is missing. */
  accountType(userId: string): Promise<string | null>;

  /**
   * Ends every other Supabase session of the account (and its refresh tokens,
   * markers, unused grants and challenges), keeping `keepSessionId`
   * (mfa_end_other_sessions). Returns how many sessions were ended.
   */
  endOtherSessions(userId: string, keepSessionId: string): Promise<number>;

  /**
   * One audit_logs row for a staff account's own sign-in method change.
   * `changes` carries the method only: never a credential id, public key,
   * secret, code or nickname.
   */
  writeStaffAudit(row: StaffMfaAudit): Promise<void>;

  /**
   * One single-use permit for a password change or email-change request.
   * The auth.users trigger guard_auth_change spends it (20261027000010).
   */
  createAuthChangePermit(userId: string, kind: AccountChangeKind, expiresAt: string): Promise<void>;

  // ── Ph3b ──
  getBackupEmail(userId: string): Promise<BackupEmailRow | null>;
  /**
   * No confirmed backup email: stores this one unconfirmed. A confirmed one:
   * keeps it and stores this as the pending replacement.
   */
  setPendingBackupEmail(userId: string, email: string): Promise<void>;
  /** Confirms this address if it is the pending replacement or the unconfirmed one. */
  verifyBackupEmail(userId: string, email: string): Promise<boolean>;
  /** Returns the removed address (for the notice), or null when there was none. */
  deleteBackupEmail(userId: string): Promise<string | null>;

  /** issue_email_code: limits, voids older codes of the purpose, stores the HMAC. */
  issueEmailCode(row: NewEmailCode): Promise<{ status: IssueCodeStatus; retryAfter: string | null }>;
  /** use_email_code: one locked check; the attempt is counted before the compare. */
  useEmailCode(p: {
    id: string; userId: string; sessionId: string; nonceHash: string; purpose: NewEmailCode['purpose']; codeHash: string;
  }): Promise<{ result: UseCodeResult; channel: 'primary' | 'backup' | null }>;

  /** Deletes every emailed code of the account (send counters back to 0, live codes void). */
  clearEmailCodes(userId: string): Promise<void>;

  latestRecovery(userId: string): Promise<RecoveryRow | null>;
  startRecovery(userId: string, sessionId: string, channel: 'primary' | 'backup', holdHours: number):
    Promise<{ status: 'ok' | 'busy' | 'frozen'; id: string | null; holdEndsAt: string | null }>;
  finishRecovery(userId: string, sessionId: string, freezeDays: number, enrolMinutes: number):
    Promise<{ status: 'ok' | 'not_ready' | 'none'; id: string | null; freezeEndsAt: string | null; enrolUntil: string | null; holdEndsAt: string | null }>;
  cancelRecovery(userId: string): Promise<string | null>;
  claimRecoveryEnrolment(userId: string, sessionId: string): Promise<string | null>;
  releaseRecoveryEnrolment(userId: string, recoveryId: string): Promise<void>;
  /** Also ends every other session except `keepSessionId`, in the same transaction. */
  undoRecovery(userId: string, recoveryId: string, keepSessionId: string): Promise<{ status: 'ok' | 'none'; passkeysRemoved: number; totpRemoved: number }>;
}

export type StaffMfaAuditAction =
  | 'mfa_factor_add'
  | 'mfa_factor_remove'
  | 'mfa_recovery_regen'
  | 'mfa_lockout'
  | 'mfa_account_change_permit';

export interface StaffMfaAudit {
  adminId: string;
  adminEmail: string;
  action: StaffMfaAuditAction;
  method: MfaMethod | null;
  ip: string | null;
  /** true when the added method waits 24 h before it can confirm a step-up. Omitted otherwise. */
  coolOff?: boolean;
  /** mfa_account_change_permit only: which change was permitted. Then `changes` is `{ kind }`. */
  kind?: AccountChangeKind;
}

// ── Supabase implementation ─────────────────────────────────────────────────

const fail = (op: string, error: { message?: string } | null): never => {
  throw new AppError('unavailable', 'Two-step sign-in is not available right now', { op, db: error?.message ?? 'no row' });
};

const PASSKEY_COLS =
  'id, user_id, credential_id, public_key, sign_count, transports, aaguid, backed_up, nickname, created_at, last_used_at, usable_from, added_by_recovery';

const RECOVERY_COLS =
  'id, channel, status, started_session_id, hold_ends_at, finished_at, finished_session_id, freeze_ends_at, enrol_until, enrolled_at, created_at';

const rpcJson = (op: string, data: unknown, error: { message?: string } | null): Record<string, unknown> => {
  if (error || !data || typeof data !== 'object') fail(op, error);
  return data as Record<string, unknown>;
};

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export const createSupabaseMfaStore = (db: SupabaseClient): MfaStore => ({
  async listPasskeys(userId) {
    const { data, error } = await db.from('user_passkeys').select(PASSKEY_COLS).eq('user_id', userId).order('created_at', { ascending: true });
    if (error) fail('listPasskeys', error);
    return (data ?? []) as PasskeyRow[];
  },

  async getPasskeyByCredentialId(credentialId) {
    const { data, error } = await db.from('user_passkeys').select(PASSKEY_COLS).eq('credential_id', credentialId).maybeSingle();
    if (error) fail('getPasskeyByCredentialId', error);
    return (data as PasskeyRow | null) ?? null;
  },

  async insertPasskey(row) {
    const { data, error } = await db.from('user_passkeys').insert(row).select(PASSKEY_COLS).single();
    if ((error as { code?: string } | null)?.code === '23505') return null;
    if (error || !data) fail('insertPasskey', error);
    return data as PasskeyRow;
  },

  async recordPasskeyUse(id, newCount) {
    const { error } = await db
      .from('user_passkeys')
      .update({ sign_count: newCount, last_used_at: new Date().toISOString() })
      .eq('id', id)
      .lte('sign_count', newCount);
    if (error) fail('recordPasskeyUse', error);
  },

  async renamePasskey(userId, id, nickname) {
    const { data, error } = await db.from('user_passkeys').update({ nickname }).eq('id', id).eq('user_id', userId).select('id').maybeSingle();
    if (error) fail('renamePasskey', error);
    return Boolean(data);
  },

  async removeFactor(userId, kind, id, breakGlass) {
    const { data, error } = await db.rpc('remove_mfa_factor', {
      p_user: userId, p_kind: kind, p_id: id, p_break_glass: breakGlass,
    });
    if (error) fail('removeFactor', error);
    if (data !== 'removed' && data !== 'not_found' && data !== 'last_factor') fail('removeFactor', null);
    return data as 'removed' | 'not_found' | 'last_factor';
  },

  async getTotp(userId) {
    const { data, error } = await db.from('user_totp_factors').select('user_id, secret_enc, verified_at, last_used_step, usable_from, added_by_recovery').eq('user_id', userId).maybeSingle();
    if (error) fail('getTotp', error);
    return (data as TotpRow | null) ?? null;
  },

  async startTotp(userId, secretEnc, usableFrom, addedByRecovery = null) {
    // Only an unconfirmed setup may be replaced.
    const { error: delError } = await db.from('user_totp_factors').delete().eq('user_id', userId).is('verified_at', null);
    if (delError) fail('startTotp.delete', delError);
    const { error } = await db.from('user_totp_factors').insert({
      user_id: userId, secret_enc: secretEnc, usable_from: usableFrom, added_by_recovery: addedByRecovery,
    });
    if (error) {
      // 23505: a confirmed authenticator app already exists.
      if ((error as { code?: string }).code === '23505') return false;
      fail('startTotp.insert', error);
    }
    return true;
  },

  async useTotpStep(userId, step, confirm) {
    const patch: Record<string, unknown> = { last_used_step: step };
    if (confirm) patch.verified_at = new Date().toISOString();
    let q = db.from('user_totp_factors').update(patch).eq('user_id', userId).lt('last_used_step', step);
    q = confirm ? q.is('verified_at', null) : q.not('verified_at', 'is', null);
    const { data, error } = await q.select('user_id').maybeSingle();
    if (error) fail('useTotpStep', error);
    return Boolean(data);
  },

  async replaceRecoveryCodes(userId, hashes) {
    const { error } = await db.rpc('replace_recovery_codes', { p_user: userId, p_hashes: hashes });
    if (error) fail('replaceRecoveryCodes', error);
  },

  async useRecoveryCode(userId, hash) {
    const { data, error } = await db
      .from('user_recovery_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('code_hash', hash)
      .is('used_at', null)
      .select('id')
      .maybeSingle();
    if (error) fail('useRecoveryCode', error);
    if (!data) return null;
    return this.countRecoveryCodes(userId);
  },

  async countRecoveryCodes(userId) {
    const { count, error } = await db
      .from('user_recovery_codes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('used_at', null);
    if (error) fail('countRecoveryCodes', error);
    return count ?? 0;
  },

  async createChallenge(row) {
    const { data, error } = await db.from('mfa_challenges').insert(row).select('id').single();
    if (error || !data) fail('createChallenge', error);
    return (data as { id: string }).id;
  },

  async consumeChallenge(id, userId, sessionId, purpose, nowIso) {
    const { data, error } = await db
      .from('mfa_challenges')
      .update({ used_at: nowIso })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .eq('purpose', purpose)
      .is('used_at', null)
      .gt('expires_at', nowIso)
      .select('id, user_id, session_id, purpose, challenge, action, target_id, expires_at, code_confirmed')
      .maybeSingle();
    if (error) fail('consumeChallenge', error);
    return (data as ChallengeRow | null) ?? null;
  },

  async markSession(row) {
    const { error } = await db.from('mfa_sessions').upsert({ ...row, verified_at: new Date().toISOString() }, { onConflict: 'session_id' });
    if (error) fail('markSession', error);
  },

  async getSession(sessionId, userId, nowIso) {
    const { data, error } = await db
      .from('mfa_sessions')
      .select('session_id, user_id, method, expires_at')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .gt('expires_at', nowIso)
      .maybeSingle();
    if (error) fail('getSession', error);
    return (data as MfaSessionRow | null) ?? null;
  },

  async createGrant(row) {
    const { error } = await db.from('step_up_grants').insert(row);
    if (error) fail('createGrant', error);
  },

  async consumeGrant(tokenHash, userId, sessionId, action, targetId, nowIso) {
    const { data, error } = await db
      .from('step_up_grants')
      .update({ used_at: nowIso })
      .eq('token_hash', tokenHash)
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .eq('action', action)
      .eq('target_id', targetId)
      .is('used_at', null)
      .gt('expires_at', nowIso)
      .select('id, method')
      .maybeSingle();
    if (error) fail('consumeGrant', error);
    if (!data) return null;
    const method = (data as { method: string | null }).method;
    return { method: method === 'passkey' || method === 'totp' || method === 'recovery_code' ? method : null };
  },

  async lockedUntil(userId, nowIso) {
    const { data, error } = await db.from('user_mfa_state').select('locked_until').eq('user_id', userId).maybeSingle();
    if (error) fail('lockedUntil', error);
    const until = (data as { locked_until: string | null } | null)?.locked_until ?? null;
    return until && until > nowIso ? until : null;
  },

  async beginCodeAttempt(userId) {
    const { data, error } = await db.rpc('begin_mfa_code_attempt', { p_user: userId });
    if (error || !data) fail('beginCodeAttempt', error);
    const out = data as { locked_until: string | null; newly_locked: boolean };
    return { lockedUntil: out.locked_until ?? null, newlyLocked: Boolean(out.newly_locked) };
  },

  async clearFailures(userId) {
    const { error } = await db
      .from('user_mfa_state')
      .update({ failed_attempts: 0, locked_until: null, lock_count: 0 })
      .eq('user_id', userId);
    if (error) fail('clearFailures', error);
  },

  async staffRole(userId) {
    const { data: staff, error } = await db
      .from('admin_users')
      .select('role_id')
      .eq('admin_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    if (error) fail('staffRole', error);
    const roleId = (staff as { role_id?: string } | null)?.role_id;
    if (!roleId) return null;
    const { data: role, error: roleError } = await db.from('admin_roles').select('role_name').eq('role_id', roleId).maybeSingle();
    if (roleError) fail('staffRole.role', roleError);
    return (role as { role_name?: string } | null)?.role_name ?? null;
  },

  async accountType(userId) {
    const { data, error } = await db.from('users').select('account_type').eq('id', userId).maybeSingle();
    if (error) fail('accountType', error);
    return (data as { account_type?: string } | null)?.account_type ?? null;
  },

  async endOtherSessions(userId, keepSessionId) {
    const { data, error } = await db.rpc('mfa_end_other_sessions', { p_user: userId, p_keep_session: keepSessionId });
    if (error) fail('endOtherSessions', error);
    return typeof data === 'number' ? data : 0;
  },

  async writeStaffAudit(row) {
    const { data: staff, error: staffError } = await db
      .from('admin_users')
      .select('brand')
      .eq('admin_id', row.adminId)
      .maybeSingle();
    if (staffError || !staff) fail('writeStaffAudit.staff', staffError);
    const brand = (staff as { brand?: string }).brand === 'unmentionables' ? 'unmentionables' : 'auctionx';
    const { error } = await db.from('audit_logs').insert({
      admin_id: row.adminId,
      admin_email: row.adminEmail,
      action: row.action,
      // 'user' matches the existing account actions (account_suspend …) so the
      // console links the row to the account page.
      entity_type: 'user',
      entity_id: row.adminId,
      changes: row.kind
        ? { kind: row.kind }
        : row.coolOff ? { method: row.method, coolOff: true } : { method: row.method },
      reason: null,
      ip_address: row.ip && isIP(row.ip) ? row.ip : null,
      brand,
    });
    if (error) fail('writeStaffAudit', error);
  },

  async createAuthChangePermit(userId, kind, expiresAt) {
    const { error } = await db.from('auth_change_permits').insert({ user_id: userId, kind, expires_at: expiresAt });
    if (error) fail('createAuthChangePermit', error);
  },

  // ── Ph3b ──

  async getBackupEmail(userId) {
    const { data, error } = await db.from('user_backup_emails').select('email, verified_at, pending_email').eq('user_id', userId).maybeSingle();
    if (error) fail('getBackupEmail', error);
    return (data as BackupEmailRow | null) ?? null;
  },

  async setPendingBackupEmail(userId, email) {
    // A confirmed address stays until its replacement is confirmed.
    const { data: kept, error: keepError } = await db
      .from('user_backup_emails')
      .update({ pending_email: email })
      .eq('user_id', userId)
      .not('verified_at', 'is', null)
      .neq('email', email)
      .select('user_id')
      .maybeSingle();
    if (keepError) fail('setPendingBackupEmail.keep', keepError);
    if (kept) return;
    const { error } = await db.from('user_backup_emails').upsert(
      { user_id: userId, email, verified_at: null, pending_email: null, created_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
    if (error) fail('setPendingBackupEmail', error);
  },

  async verifyBackupEmail(userId, email) {
    const now = new Date().toISOString();
    const { data: swapped, error: swapError } = await db
      .from('user_backup_emails')
      .update({ email, verified_at: now, pending_email: null })
      .eq('user_id', userId)
      .eq('pending_email', email)
      .select('user_id')
      .maybeSingle();
    if (swapError) fail('verifyBackupEmail.swap', swapError);
    if (swapped) return true;
    const { data, error } = await db
      .from('user_backup_emails')
      .update({ verified_at: now })
      .eq('user_id', userId)
      .eq('email', email)
      .is('verified_at', null)
      .select('user_id')
      .maybeSingle();
    if (error) fail('verifyBackupEmail', error);
    return Boolean(data);
  },

  async deleteBackupEmail(userId) {
    const { data, error } = await db.from('user_backup_emails').delete().eq('user_id', userId).select('email').maybeSingle();
    if (error) fail('deleteBackupEmail', error);
    return (data as { email: string } | null)?.email ?? null;
  },

  async issueEmailCode(row) {
    const { data, error } = await db.rpc('issue_email_code', {
      p_id: row.id, p_user: row.user_id, p_session: row.session_id, p_nonce_hash: row.nonce_hash,
      p_purpose: row.purpose, p_channel: row.channel, p_code_hash: row.code_hash, p_expires_at: row.expires_at,
    });
    const out = rpcJson('issueEmailCode', data, error);
    const status = out.status;
    if (status !== 'ok' && status !== 'cooldown' && status !== 'hour_limit' && status !== 'day_limit') fail('issueEmailCode', null);
    return { status: status as IssueCodeStatus, retryAfter: str(out.retry_after) };
  },

  async useEmailCode(p) {
    const { data, error } = await db.rpc('use_email_code', {
      p_id: p.id, p_user: p.userId, p_session: p.sessionId, p_nonce_hash: p.nonceHash, p_purpose: p.purpose, p_code_hash: p.codeHash,
    });
    const out = rpcJson('useEmailCode', data, error);
    const result = out.result;
    if (!['ok', 'wrong', 'locked', 'expired', 'invalid'].includes(result as string)) fail('useEmailCode', null);
    const channel = out.channel === 'primary' || out.channel === 'backup' ? out.channel : null;
    return { result: result as UseCodeResult, channel };
  },

  async clearEmailCodes(userId) {
    const { error } = await db.from('email_codes').delete().eq('user_id', userId);
    if (error) fail('clearEmailCodes', error);
  },

  async latestRecovery(userId) {
    const { data, error } = await db
      .from('account_recoveries')
      .select(RECOVERY_COLS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail('latestRecovery', error);
    return (data as RecoveryRow | null) ?? null;
  },

  async startRecovery(userId, sessionId, channel, holdHours) {
    const { data, error } = await db.rpc('start_account_recovery', {
      p_user: userId, p_session: sessionId, p_channel: channel, p_hold_hours: holdHours,
    });
    const out = rpcJson('startRecovery', data, error);
    if (out.status !== 'ok' && out.status !== 'busy' && out.status !== 'frozen') fail('startRecovery', null);
    return { status: out.status as 'ok' | 'busy' | 'frozen', id: str(out.id), holdEndsAt: str(out.hold_ends_at) };
  },

  async finishRecovery(userId, sessionId, freezeDays, enrolMinutes) {
    const { data, error } = await db.rpc('finish_account_recovery', {
      p_user: userId, p_session: sessionId, p_freeze_days: freezeDays, p_enrol_minutes: enrolMinutes,
    });
    const out = rpcJson('finishRecovery', data, error);
    if (out.status !== 'ok' && out.status !== 'not_ready' && out.status !== 'none') fail('finishRecovery', null);
    return {
      status: out.status as 'ok' | 'not_ready' | 'none',
      id: str(out.id),
      freezeEndsAt: str(out.freeze_ends_at),
      enrolUntil: str(out.enrol_until),
      holdEndsAt: str(out.hold_ends_at),
    };
  },

  async cancelRecovery(userId) {
    const { data, error } = await db.rpc('cancel_account_recovery', { p_user: userId });
    if (error) fail('cancelRecovery', error);
    return str(data);
  },

  async claimRecoveryEnrolment(userId, sessionId) {
    const { data, error } = await db.rpc('claim_recovery_enrolment', { p_user: userId, p_session: sessionId });
    if (error) fail('claimRecoveryEnrolment', error);
    return str(data);
  },

  async releaseRecoveryEnrolment(userId, recoveryId) {
    const { error } = await db.rpc('release_recovery_enrolment', { p_user: userId, p_id: recoveryId });
    if (error) fail('releaseRecoveryEnrolment', error);
  },

  async undoRecovery(userId, recoveryId, keepSessionId) {
    const { data, error } = await db.rpc('undo_account_recovery', { p_user: userId, p_id: recoveryId, p_keep_session: keepSessionId });
    const out = rpcJson('undoRecovery', data, error);
    if (out.status !== 'ok' && out.status !== 'none') fail('undoRecovery', null);
    return {
      status: out.status as 'ok' | 'none',
      passkeysRemoved: Number(out.passkeys_removed ?? 0),
      totpRemoved: Number(out.totp_removed ?? 0),
    };
  },
});

let store: MfaStore | null = null;

export const getMfaStore = (): MfaStore => {
  store ??= createSupabaseMfaStore(createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!));
  return store;
};

/** Test seam. */
export const __setMfaStore = (s: MfaStore | null): void => {
  store = s;
};
