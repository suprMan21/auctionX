/**
 * In-memory MfaStore with the same "use once" semantics as the Supabase one:
 * every consume is check-and-set in one step, so a second call sees the first.
 * The real atomicity (two connections racing) is proven by
 * supabase/tests/s_2fa_live.sql.
 */

import { randomUUID } from 'crypto';
import type {
  AccountChangeKind,
  BackupEmailRow,
  NewEmailCode,
  RecoveryRow,
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
  /** users.account_type; missing = 'collector'. */
  accountTypes: Map<string, string>;
  /** Every endOtherSessions call, in order. */
  endedSessions: Array<{ userId: string; keep: string }>;
  /** Every staff audit row written. */
  audits: StaffMfaAudit[];
  /** Every auth_change_permits row written. */
  permits: Array<{ user_id: string; kind: AccountChangeKind; expires_at: string; used_at: string | null }>;
  /** Set to make the next call of that method throw like a database error. */
  failNext: Set<keyof MfaStore>;
  // ── Ph3b ──
  backupEmails: Map<string, BackupEmailRow>;
  emailCodes: Array<NewEmailCode & { attempts: number; used_at: string | null; voided_at: string | null; created_at: string }>;
  recoveries: Array<RecoveryRow & { user_id: string; cancelled_at: string | null; undone_at: string | null }>;
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
  accountTypes: new Map(),
  endedSessions: [],
  audits: [],
  permits: [],
  failNext: new Set(),
  backupEmails: new Map(),
  emailCodes: [],
  recoveries: [],
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
      const full: PasskeyRow = {
        ...row, usable_from: row.usable_from ?? null, added_by_recovery: row.added_by_recovery ?? null,
        id: randomUUID(), created_at: new Date().toISOString(), last_used_at: null,
      };
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
    async startTotp(userId, secretEnc, usableFrom, addedByRecovery = null) {
      const cur = st.totp.get(userId);
      if (cur?.verified_at) return false;
      st.totp.set(userId, {
        user_id: userId, secret_enc: secretEnc, verified_at: null, last_used_step: 0, usable_from: usableFrom,
        added_by_recovery: addedByRecovery,
      });
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
    async accountType(userId) {
      guard('accountType');
      return st.accountTypes.get(userId) ?? 'collector';
    },
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
    async createAuthChangePermit(userId, kind, expiresAt) {
      guard('createAuthChangePermit');
      st.permits.push({ user_id: userId, kind, expires_at: expiresAt, used_at: null });
    },

    // ── Ph3b: same rules as the SQL functions (proven by s_2fa_ph3b_live.sql) ──
    async getBackupEmail(userId) {
      guard('getBackupEmail');
      return st.backupEmails.get(userId) ?? null;
    },
    async setPendingBackupEmail(userId, email) {
      guard('setPendingBackupEmail');
      const cur = st.backupEmails.get(userId);
      if (cur?.verified_at && cur.email !== email) {
        cur.pending_email = email;
        return;
      }
      st.backupEmails.set(userId, { email, verified_at: null, pending_email: null });
    },
    async verifyBackupEmail(userId, email) {
      const row = st.backupEmails.get(userId);
      if (!row) return false;
      if (row.pending_email === email) {
        row.email = email;
        row.verified_at = new Date().toISOString();
        row.pending_email = null;
        return true;
      }
      if (row.email !== email || row.verified_at) return false;
      row.verified_at = new Date().toISOString();
      return true;
    },
    async deleteBackupEmail(userId) {
      const row = st.backupEmails.get(userId);
      st.backupEmails.delete(userId);
      return row?.email ?? null;
    },
    async issueEmailCode(row) {
      guard('issueEmailCode');
      const now = Date.now();
      const mine = st.emailCodes.filter((c) => c.user_id === row.user_id);
      const last = mine.reduce((m, c) => Math.max(m, Date.parse(c.created_at)), 0);
      if (last && last > now - 60_000) return { status: 'cooldown', retryAfter: new Date(last + 60_000).toISOString() };
      const hour = mine.filter((c) => Date.parse(c.created_at) > now - 3_600_000);
      if (hour.length >= 3) return { status: 'hour_limit', retryAfter: new Date(Math.min(...hour.map((c) => Date.parse(c.created_at))) + 3_600_000).toISOString() };
      const day = mine.filter((c) => Date.parse(c.created_at) > now - 86_400_000);
      if (day.length >= 10) return { status: 'day_limit', retryAfter: new Date(Math.min(...day.map((c) => Date.parse(c.created_at))) + 86_400_000).toISOString() };
      for (const c of mine) if (c.purpose === row.purpose && !c.used_at && !c.voided_at) c.voided_at = new Date(now).toISOString();
      st.emailCodes.push({ ...row, attempts: 0, used_at: null, voided_at: null, created_at: new Date(now).toISOString() });
      return { status: 'ok', retryAfter: new Date(now + 60_000).toISOString() };
    },
    async useEmailCode(p) {
      guard('useEmailCode');
      const c = st.emailCodes.find((x) => x.id === p.id && x.user_id === p.userId && x.purpose === p.purpose);
      if (!c || c.session_id !== p.sessionId || c.nonce_hash !== p.nonceHash) return { result: 'invalid', channel: null };
      if (c.used_at || c.voided_at || c.expires_at <= new Date().toISOString()) return { result: 'expired', channel: null };
      if (c.attempts >= 5) return { result: 'locked', channel: null };
      c.attempts += 1;
      if (c.code_hash === p.codeHash) {
        c.used_at = new Date().toISOString();
        return { result: 'ok', channel: c.channel };
      }
      return { result: c.attempts >= 5 ? 'locked' : 'wrong', channel: null };
    },
    async clearEmailCodes(userId) {
      guard('clearEmailCodes');
      st.emailCodes = st.emailCodes.filter((c) => c.user_id !== userId);
    },
    async latestRecovery(userId) {
      guard('latestRecovery');
      const mine = st.recoveries.filter((r) => r.user_id === userId);
      return mine.length ? mine[mine.length - 1] : null;
    },
    async startRecovery(userId, sessionId, channel, holdHours) {
      guard('startRecovery');
      const now = new Date().toISOString();
      const mine = st.recoveries.filter((r) => r.user_id === userId);
      if (mine.some((r) => r.status === 'holding')) return { status: 'busy', id: null, holdEndsAt: null };
      if (mine.some((r) => r.status === 'completed' && (r.freeze_ends_at ?? '') > now)) return { status: 'frozen', id: null, holdEndsAt: null };
      const row = {
        id: randomUUID(), user_id: userId, channel, status: 'holding' as const, started_session_id: sessionId,
        hold_ends_at: new Date(Date.now() + holdHours * 3_600_000).toISOString(),
        finished_at: null, finished_session_id: null, freeze_ends_at: null, enrol_until: null, enrolled_at: null,
        created_at: now, cancelled_at: null, undone_at: null,
      };
      st.recoveries.push(row);
      return { status: 'ok', id: row.id, holdEndsAt: row.hold_ends_at };
    },
    async finishRecovery(userId, sessionId, freezeDays, enrolMinutes) {
      guard('finishRecovery');
      const r = st.recoveries.find((x) => x.user_id === userId && x.status === 'holding');
      if (!r) return { status: 'none', id: null, freezeEndsAt: null, enrolUntil: null, holdEndsAt: null };
      if (r.hold_ends_at > new Date().toISOString()) return { status: 'not_ready', id: null, freezeEndsAt: null, enrolUntil: null, holdEndsAt: r.hold_ends_at };
      r.status = 'completed';
      r.finished_at = new Date().toISOString();
      r.finished_session_id = sessionId;
      r.freeze_ends_at = new Date(Date.now() + freezeDays * 86_400_000).toISOString();
      r.enrol_until = new Date(Date.now() + enrolMinutes * 60_000).toISOString();
      st.codes = st.codes.filter((c) => c.user_id !== userId);
      const existing = st.sessions.get(sessionId);
      if (!existing || existing.user_id === userId) {
        st.sessions.set(sessionId, { session_id: sessionId, user_id: userId, method: 'email_recovery', expires_at: r.enrol_until });
      }
      return { status: 'ok', id: r.id, freezeEndsAt: r.freeze_ends_at, enrolUntil: r.enrol_until, holdEndsAt: r.hold_ends_at };
    },
    async cancelRecovery(userId) {
      guard('cancelRecovery');
      const r = st.recoveries.find((x) => x.user_id === userId && x.status === 'holding');
      if (!r) return null;
      r.status = 'cancelled';
      r.cancelled_at = new Date().toISOString();
      return r.id;
    },
    async claimRecoveryEnrolment(userId, sessionId) {
      guard('claimRecoveryEnrolment');
      const now = new Date().toISOString();
      const r = st.recoveries.find(
        (x) => x.user_id === userId && x.status === 'completed' && x.finished_session_id === sessionId
          && !x.enrolled_at && (x.enrol_until ?? '') > now,
      );
      if (!r) return null;
      r.enrolled_at = now;
      return r.id;
    },
    async releaseRecoveryEnrolment(userId, recoveryId) {
      const r = st.recoveries.find((x) => x.id === recoveryId && x.user_id === userId && x.status === 'completed');
      const used = st.passkeys.some((p) => p.added_by_recovery === recoveryId)
        || [...st.totp.values()].some((t) => t.added_by_recovery === recoveryId && t.verified_at);
      if (r && !used) r.enrolled_at = null;
    },
    async undoRecovery(userId, recoveryId, keepSessionId) {
      guard('undoRecovery');
      const r = st.recoveries.find(
        (x) => x.id === recoveryId && x.user_id === userId && x.status === 'completed' && (x.freeze_ends_at ?? '') > new Date().toISOString(),
      );
      if (!r) return { status: 'none', passkeysRemoved: 0, totpRemoved: 0 };
      r.status = 'undone';
      r.undone_at = new Date().toISOString();
      const before = st.passkeys.length;
      st.passkeys = st.passkeys.filter((p) => !(p.user_id === userId && p.added_by_recovery === recoveryId));
      const t = st.totp.get(userId);
      const totpRemoved = t?.added_by_recovery === recoveryId ? 1 : 0;
      if (totpRemoved) st.totp.delete(userId);
      // Same transaction as mfa_end_other_sessions.
      st.endedSessions.push({ userId, keep: keepSessionId });
      for (const [id, sess] of st.sessions) if (sess.user_id === userId && id !== keepSessionId) st.sessions.delete(id);
      st.grants = st.grants.filter((g) => g.user_id !== userId || g.session_id === keepSessionId || g.used_at !== null);
      return { status: 'ok', passkeysRemoved: before - st.passkeys.length, totpRemoved };
    },
  };
};

/** An unsigned JWT-shaped bearer token carrying the given claims (signature is never checked by the code under test). */
export const bearerWith = (claims: Record<string, unknown>): string =>
  `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
