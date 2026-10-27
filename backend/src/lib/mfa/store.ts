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

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../errors';

export type ChallengePurpose = 'register' | 'sign_in' | 'step_up';
export type MfaMethod = 'passkey' | 'totp' | 'recovery_code';
export type StepUpAction =
  | 'release'
  | 'transfer_complete'
  | 'price_change'
  | 'factor_remove'
  | 'admin_action'
  | 'admin_approve';

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
}

export interface TotpRow {
  user_id: string;
  secret_enc: string;
  verified_at: string | null;
  last_used_step: number;
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
}

export interface MfaSessionRow {
  session_id: string;
  user_id: string;
  method: MfaMethod;
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
}

export interface MfaStore {
  listPasskeys(userId: string): Promise<PasskeyRow[]>;
  getPasskeyByCredentialId(credentialId: string): Promise<PasskeyRow | null>;
  insertPasskey(row: NewPasskey): Promise<PasskeyRow>;
  /** Conditional on the stored counter so a racing older assertion cannot roll it back. */
  recordPasskeyUse(id: string, newCount: number): Promise<void>;
  renamePasskey(userId: string, id: string, nickname: string): Promise<boolean>;
  deletePasskey(userId: string, id: string): Promise<boolean>;

  getTotp(userId: string): Promise<TotpRow | null>;
  /** Replaces any unconfirmed setup; refuses (returns false) when a confirmed one exists. */
  startTotp(userId: string, secretEnc: string): Promise<boolean>;
  /** Spends `step` only if it is newer than the last one used; optionally confirms setup. */
  useTotpStep(userId: string, step: number, confirm: boolean): Promise<boolean>;
  deleteTotp(userId: string): Promise<boolean>;

  replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void>;
  /** Spends one code; returns how many are left, or null when it was not a live code. */
  useRecoveryCode(userId: string, hash: string): Promise<number | null>;
  countRecoveryCodes(userId: string): Promise<number>;

  createChallenge(row: Omit<ChallengeRow, 'id'>): Promise<string>;
  consumeChallenge(id: string, userId: string, sessionId: string, purpose: ChallengePurpose, nowIso: string): Promise<ChallengeRow | null>;

  markSession(row: MfaSessionRow): Promise<void>;
  getSession(sessionId: string, userId: string, nowIso: string): Promise<MfaSessionRow | null>;

  createGrant(row: { token_hash: string; user_id: string; session_id: string; action: StepUpAction; target_id: string; expires_at: string }): Promise<void>;
  consumeGrant(tokenHash: string, userId: string, sessionId: string, action: StepUpAction, targetId: string, nowIso: string): Promise<boolean>;

  /** null = not locked, otherwise the lock end. */
  lockedUntil(userId: string, nowIso: string): Promise<string | null>;
  recordFailure(userId: string): Promise<string | null>;
  clearFailures(userId: string): Promise<void>;

  /** Active staff role name, or null for a non-staff account. */
  staffRole(userId: string): Promise<string | null>;
}

// ── Supabase implementation ─────────────────────────────────────────────────

const fail = (op: string, error: { message?: string } | null): never => {
  throw new AppError('unavailable', 'Two-step sign-in is not available right now', { op, db: error?.message ?? 'no row' });
};

const PASSKEY_COLS =
  'id, user_id, credential_id, public_key, sign_count, transports, aaguid, backed_up, nickname, created_at, last_used_at';

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

  async deletePasskey(userId, id) {
    const { data, error } = await db.from('user_passkeys').delete().eq('id', id).eq('user_id', userId).select('id').maybeSingle();
    if (error) fail('deletePasskey', error);
    return Boolean(data);
  },

  async getTotp(userId) {
    const { data, error } = await db.from('user_totp_factors').select('user_id, secret_enc, verified_at, last_used_step').eq('user_id', userId).maybeSingle();
    if (error) fail('getTotp', error);
    return (data as TotpRow | null) ?? null;
  },

  async startTotp(userId, secretEnc) {
    // Only an unconfirmed setup may be replaced.
    const { error: delError } = await db.from('user_totp_factors').delete().eq('user_id', userId).is('verified_at', null);
    if (delError) fail('startTotp.delete', delError);
    const { error } = await db.from('user_totp_factors').insert({ user_id: userId, secret_enc: secretEnc });
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

  async deleteTotp(userId) {
    const { data, error } = await db.from('user_totp_factors').delete().eq('user_id', userId).select('user_id').maybeSingle();
    if (error) fail('deleteTotp', error);
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
      .select('id, user_id, session_id, purpose, challenge, action, target_id, expires_at')
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
      .select('id')
      .maybeSingle();
    if (error) fail('consumeGrant', error);
    return Boolean(data);
  },

  async lockedUntil(userId, nowIso) {
    const { data, error } = await db.from('user_mfa_state').select('locked_until').eq('user_id', userId).maybeSingle();
    if (error) fail('lockedUntil', error);
    const until = (data as { locked_until: string | null } | null)?.locked_until ?? null;
    return until && until > nowIso ? until : null;
  },

  async recordFailure(userId) {
    const { data, error } = await db.rpc('record_mfa_failure', { p_user: userId });
    if (error) fail('recordFailure', error);
    return (data as string | null) ?? null;
  },

  async clearFailures(userId) {
    const { error } = await db.from('user_mfa_state').update({ failed_attempts: 0, locked_until: null }).eq('user_id', userId);
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
