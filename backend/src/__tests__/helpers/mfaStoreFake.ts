/**
 * In-memory MfaStore with the same "use once" semantics as the Supabase one:
 * every consume is check-and-set in one step, so a second call sees the first.
 * The real atomicity (two connections racing) is proven by
 * supabase/tests/s_2fa_live.sql.
 */

import { randomUUID } from 'crypto';
import type {
  ChallengeRow,
  MfaSessionRow,
  MfaStore,
  NewPasskey,
  PasskeyRow,
  StepUpAction,
  TotpRow,
} from '../../lib/mfa/store';

export interface MfaFakeState {
  passkeys: PasskeyRow[];
  totp: Map<string, TotpRow>;
  codes: Array<{ user_id: string; code_hash: string; used_at: string | null }>;
  challenges: Array<ChallengeRow & { used_at: string | null }>;
  sessions: Map<string, MfaSessionRow>;
  grants: Array<{ token_hash: string; user_id: string; session_id: string; action: StepUpAction; target_id: string; expires_at: string; used_at: string | null }>;
  failures: Map<string, { failed: number; locked_until: string | null }>;
  staff: Map<string, string>;
  /** Set to make the next call of that method throw like a database error. */
  failNext: Set<keyof MfaStore>;
}

export const createMfaFakeState = (): MfaFakeState => ({
  passkeys: [],
  totp: new Map(),
  codes: [],
  challenges: [],
  sessions: new Map(),
  grants: [],
  failures: new Map(),
  staff: new Map(),
  failNext: new Set(),
});

export const createMfaStoreFake = (st: MfaFakeState): MfaStore => {
  const guard = (name: keyof MfaStore) => {
    if (st.failNext.has(name)) {
      st.failNext.delete(name);
      throw new Error(`fake db failure: ${name}`);
    }
  };
  return {
    async listPasskeys(userId) {
      guard('listPasskeys');
      return st.passkeys.filter((p) => p.user_id === userId);
    },
    async getPasskeyByCredentialId(id) {
      guard('getPasskeyByCredentialId');
      return st.passkeys.find((p) => p.credential_id === id) ?? null;
    },
    async insertPasskey(row: NewPasskey) {
      guard('insertPasskey');
      if (st.passkeys.some((p) => p.credential_id === row.credential_id)) throw new Error('duplicate credential');
      const full: PasskeyRow = { ...row, id: randomUUID(), created_at: new Date().toISOString(), last_used_at: null };
      st.passkeys.push(full);
      return full;
    },
    async recordPasskeyUse(id, newCount) {
      guard('recordPasskeyUse');
      const p = st.passkeys.find((x) => x.id === id);
      if (p && p.sign_count <= newCount) {
        p.sign_count = newCount;
        p.last_used_at = new Date().toISOString();
      }
    },
    async renamePasskey(userId, id, nickname) {
      const p = st.passkeys.find((x) => x.id === id && x.user_id === userId);
      if (!p) return false;
      p.nickname = nickname;
      return true;
    },
    async deletePasskey(userId, id) {
      const before = st.passkeys.length;
      st.passkeys = st.passkeys.filter((x) => !(x.id === id && x.user_id === userId));
      return st.passkeys.length < before;
    },
    async getTotp(userId) {
      return st.totp.get(userId) ?? null;
    },
    async startTotp(userId, secretEnc) {
      const cur = st.totp.get(userId);
      if (cur?.verified_at) return false;
      st.totp.set(userId, { user_id: userId, secret_enc: secretEnc, verified_at: null, last_used_step: 0 });
      return true;
    },
    async useTotpStep(userId, step, confirm) {
      const cur = st.totp.get(userId);
      if (!cur || cur.last_used_step >= step) return false;
      if (confirm ? cur.verified_at !== null : cur.verified_at === null) return false;
      cur.last_used_step = step;
      if (confirm) cur.verified_at = new Date().toISOString();
      return true;
    },
    async deleteTotp(userId) {
      return st.totp.delete(userId);
    },
    async replaceRecoveryCodes(userId, hashes) {
      guard('replaceRecoveryCodes');
      if (hashes.length !== 10) throw new Error('invalid_recovery_codes');
      st.codes = st.codes.filter((c) => c.user_id !== userId);
      for (const h of hashes) st.codes.push({ user_id: userId, code_hash: h, used_at: null });
    },
    async useRecoveryCode(userId, hash) {
      const c = st.codes.find((x) => x.user_id === userId && x.code_hash === hash && x.used_at === null);
      if (!c) return null;
      c.used_at = new Date().toISOString();
      return st.codes.filter((x) => x.user_id === userId && x.used_at === null).length;
    },
    async countRecoveryCodes(userId) {
      return st.codes.filter((x) => x.user_id === userId && x.used_at === null).length;
    },
    async createChallenge(row) {
      guard('createChallenge');
      const id = randomUUID();
      st.challenges.push({ ...row, id, used_at: null });
      return id;
    },
    async consumeChallenge(id, userId, sessionId, purpose, nowIso) {
      const c = st.challenges.find(
        (x) => x.id === id && x.user_id === userId && x.session_id === sessionId && x.purpose === purpose
          && x.used_at === null && x.expires_at > nowIso,
      );
      if (!c) return null;
      c.used_at = nowIso;
      return c;
    },
    async markSession(row) {
      guard('markSession');
      st.sessions.set(row.session_id, { ...row });
    },
    async getSession(sessionId, userId, nowIso) {
      guard('getSession');
      const s = st.sessions.get(sessionId);
      return s && s.user_id === userId && s.expires_at > nowIso ? s : null;
    },
    async createGrant(row) {
      st.grants.push({ ...row, used_at: null });
    },
    async consumeGrant(tokenHash, userId, sessionId, action, targetId, nowIso) {
      guard('consumeGrant');
      const g = st.grants.find(
        (x) => x.token_hash === tokenHash && x.user_id === userId && x.session_id === sessionId
          && x.action === action && x.target_id === targetId && x.used_at === null && x.expires_at > nowIso,
      );
      if (!g) return false;
      g.used_at = nowIso;
      return true;
    },
    async lockedUntil(userId, nowIso) {
      const f = st.failures.get(userId);
      return f?.locked_until && f.locked_until > nowIso ? f.locked_until : null;
    },
    async recordFailure(userId) {
      const now = new Date();
      const f = st.failures.get(userId) ?? { failed: 0, locked_until: null };
      if (f.locked_until && f.locked_until <= now.toISOString()) {
        f.failed = 0;
        f.locked_until = null;
      }
      f.failed += 1;
      if (f.failed >= 5 && !f.locked_until) f.locked_until = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      st.failures.set(userId, f);
      return f.locked_until;
    },
    async clearFailures(userId) {
      st.failures.delete(userId);
    },
    async staffRole(userId) {
      guard('staffRole');
      return st.staff.get(userId) ?? null;
    },
  };
};

/** An unsigned JWT-shaped bearer token carrying the given claims (signature is never checked by the code under test). */
export const bearerWith = (claims: Record<string, unknown>): string =>
  `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
