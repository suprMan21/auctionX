/**
 * In-memory MfaStore with the same "use once" semantics as the Supabase one:
 * every consume is check-and-set in one step, so a second call sees the first.
 * The real atomicity (two connections racing) is proven by
 * supabase/tests/s_2fa_live.sql.
 */

import { randomUUID } from 'crypto';
import type {
  ChallengeRow,
  MfaMethod,
  MfaSessionRow,
  MfaStore,
  NewPasskey,
  PasskeyRow,
  StaffMfaAudit,
  StepUpAction,
  TotpRow,
} from '../../lib/mfa/store';

export interface MfaFakeState {
  passkeys: PasskeyRow[];
  totp: Map<string, TotpRow>;
  codes: Array<{ user_id: string; code_hash: string; used_at: string | null }>;
  challenges: Array<ChallengeRow & { used_at: string | null }>;
  sessions: Map<string, MfaSessionRow>;
  grants: Array<{ token_hash: string; user_id: string; session_id: string; action: StepUpAction; target_id: string; expires_at: string; method: MfaMethod | null; used_at: string | null }>;
  failures: Map<string, { failed: number; locked_until: string | null; lock_count: number }>;
  staff: Map<string, string>;
  /** Every endOtherSessions call, in order. */
  endedSessions: Array<{ userId: string; keep: string }>;
  /** Every staff audit row written. */
  audits: StaffMfaAudit[];
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
  endedSessions: [],
  audits: [],
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
      if (st.passkeys.some((p) => p.credential_id === row.credential_id)) return null;
      const full: PasskeyRow = { ...row, usable_from: row.usable_from ?? null, id: randomUUID(), created_at: new Date().toISOString(), last_used_at: null };
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
    // Same rules as remove_mfa_factor (the row lock is proven by the live SQL test).
    async removeFactor(userId, kind, id, breakGlass) {
      guard('removeFactor');
      const mine = st.passkeys.filter((p) => p.user_id === userId);
      const totp = st.totp.get(userId);
      const total = mine.filter((p) => !breakGlass || !p.backed_up).length + (!breakGlass && totp?.verified_at ? 1 : 0);
      if (kind === 'passkey') {
        const target = mine.find((p) => p.id === id);
        if (!target) return 'not_found';
        if ((!breakGlass || !target.backed_up) && total <= 1) return 'last_factor';
        st.passkeys = st.passkeys.filter((p) => p.id !== id);
        return 'removed';
      }
      if (!totp?.verified_at) return 'not_found';
      if (!breakGlass && total <= 1) return 'last_factor';
      st.totp.delete(userId);
      return 'removed';
    },
    async getTotp(userId) {
      return st.totp.get(userId) ?? null;
    },
    async startTotp(userId, secretEnc, usableFrom) {
      const cur = st.totp.get(userId);
      if (cur?.verified_at) return false;
      st.totp.set(userId, { user_id: userId, secret_enc: secretEnc, verified_at: null, last_used_step: 0, usable_from: usableFrom });
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
      st.challenges.push({ ...row, code_confirmed: row.code_confirmed ?? false, id, used_at: null });
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
      if (!g) return null;
      g.used_at = nowIso;
      return { method: g.method };
    },
    async lockedUntil(userId, nowIso) {
      const f = st.failures.get(userId);
      return f?.locked_until && f.locked_until > nowIso ? f.locked_until : null;
    },
    // Same rules as begin_mfa_code_attempt.
    async beginCodeAttempt(userId) {
      guard('beginCodeAttempt');
      const now = Date.now();
      const f = st.failures.get(userId) ?? { failed: 0, locked_until: null, lock_count: 0 };
      st.failures.set(userId, f);
      if (f.locked_until && f.locked_until > new Date(now).toISOString()) return { lockedUntil: f.locked_until, newlyLocked: false };
      if (f.failed >= 5) {
        const mins = Math.min(15 * 4 ** Math.min(f.lock_count, 4), 24 * 60);
        f.locked_until = new Date(now + mins * 60 * 1000).toISOString();
        f.failed = 0;
        f.lock_count += 1;
        return { lockedUntil: f.locked_until, newlyLocked: true };
      }
      f.failed += 1;
      f.locked_until = null;
      return { lockedUntil: null, newlyLocked: false };
    },
    async clearFailures(userId) {
      st.failures.delete(userId);
    },
    async staffRole(userId) {
      guard('staffRole');
      return st.staff.get(userId) ?? null;
    },
    // Same rules as mfa_end_other_sessions (auth.sessions deletes are proven by s_2fa_ph2_live.sql).
    async endOtherSessions(userId, keep) {
      guard('endOtherSessions');
      st.endedSessions.push({ userId, keep });
      let n = 0;
      for (const [id, s] of st.sessions) {
        if (s.user_id === userId && id !== keep) {
          st.sessions.delete(id);
          n += 1;
        }
      }
      st.grants = st.grants.filter((g) => g.user_id !== userId || g.session_id === keep || g.used_at !== null);
      return n;
    },
    async writeStaffAudit(row) {
      guard('writeStaffAudit');
      st.audits.push({ ...row });
    },
  };
};

/** An unsigned JWT-shaped bearer token carrying the given claims (signature is never checked by the code under test). */
export const bearerWith = (claims: Record<string, unknown>): string =>
  `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
