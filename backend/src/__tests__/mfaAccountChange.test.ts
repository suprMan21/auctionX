import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { randomBytes } from 'crypto';
import { bearerWith, createMfaFakeState, createMfaStoreFake, type MfaFakeState } from './helpers/mfaStoreFake';
import { SoftPasskey } from './helpers/softAuthenticator';
import { spyOnSecurityEvents, type SecurityEventSpy } from './helpers/securityEvents';
import { hotp, totpStep } from '../lib/mfa/totp';

/**
 * S-2FA Ph2b (Boss, Option A, 2026-10-27): a password change or an email-change
 * request needs a permit from POST /auth/mfa/account-change, which needs this
 * session's second-factor marker AND a fresh `account_change` step-up whose
 * target is the kind. The auth.users trigger guard_auth_change spends the
 * permit (proven by supabase/tests/s_2fa_account_change_live.sql).
 *
 * Step-up rules for account_change are the release rules: passkey, or an
 * authenticator code for non-staff; never a backup code; staff passkey only;
 * a method in its 24 h new-method wait cannot confirm it.
 *
 * Same harness as mfa.test.ts / mfaPh2.test.ts (real P-256 passkeys, in-memory store).
 */
const RP_ID = 'am.test';
const ORIGIN = 'https://am.test';
const USER = '11111111-1111-4111-8111-111111111111';
const ROOT = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EMAILS: Record<string, string> = {
  [USER]: 'user@example.com',
  [ROOT]: 'root@example.com',
  [ADMIN]: 'staff@example.com',
};
const PERMIT_MS = 2 * 60 * 1000;

let mfaState: MfaFakeState;
let events: SecurityEventSpy;
const sent: Array<{ to: string; subject: string; text?: string }> = [];

const claimsOf = (auth: string | undefined): Record<string, unknown> => {
  try {
    return JSON.parse(Buffer.from(String(auth).split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const sub = claimsOf(`Bearer ${token}`).sub as string | undefined;
        return sub ? { data: { user: { id: sub, email: EMAILS[sub] } }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
      },
    },
    rpc: async (fn: string) => (fn === 'account_status_of' ? { data: 'active', error: null } : { data: null, error: { message: `unexpected ${fn}` } }),
    from: () => {
      throw new Error('no table access expected in these tests');
    },
  }),
}));

vi.mock('../lib/notifications/emailSender', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string; text?: string }) => {
    sent.push(p);
    return true;
  }),
}));

const auth = (user: string, session: string) => bearerWith({ sub: user, session_id: session });

const loadApp = async () => {
  const { __setMfaStore } = await import('../lib/mfa/store');
  __setMfaStore(createMfaStoreFake(mfaState));
  const { default: mfaRoutes } = await import('../routes/mfa');
  const app = express();
  app.use(express.json());
  app.use('/auth/mfa', mfaRoutes);
  return app;
};

type App = Awaited<ReturnType<typeof loadApp>>;

const flush = () => new Promise((r) => setTimeout(r, 0));

const codeFor = (secretB32: string, offsetSteps = 0) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of secretB32) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return hotp(Buffer.from(out), totpStep(Date.now()) + offsetSteps);
};

const enrolFirst = async (app: App, user = USER, session = S1) => {
  const key = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN });
  const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(user, session));
  expect(o.status).toBe(200);
  const v = await request(app)
    .post('/auth/mfa/passkeys/register/verify')
    .set('Authorization', auth(user, session))
    .send({ challengeId: o.body.data.challengeId, nickname: 'My phone', response: key.register(o.body.data.options.challenge) });
  expect(v.status).toBe(201);
  return { key, backupCodes: v.body.data.backupCodes as string[] };
};

const stepUp = async (app: App, key: SoftPasskey, action: string, targetId: string, user = USER, session = S1) => {
  const o = await request(app).post('/auth/mfa/step-up/options').set('Authorization', auth(user, session)).send({ action, targetId });
  expect(o.status).toBe(200);
  const v = await request(app)
    .post('/auth/mfa/step-up/verify')
    .set('Authorization', auth(user, session))
    .send({ challengeId: o.body.data.challengeId, response: key.assert(o.body.data.options.challenge) });
  expect(v.status).toBe(200);
  return v.body.data.stepUpToken as string;
};

const codeStepUp = (app: App, user: string, targetId: string, body: Record<string, unknown>, session = S1, action = 'account_change') =>
  request(app).post('/auth/mfa/step-up/verify').set('Authorization', auth(user, session)).send({ action, targetId, ...body });

/** Passkey first, then an authenticator app added with a passkey step-up (no wait). */
const enrolPasskeyAndApp = async (app: App, user = USER) => {
  const first = await enrolFirst(app, user);
  const token = await stepUp(app, first.key, 'factor_add', 'totp', user);
  const setup = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(user, S1)).set('X-Step-Up', token);
  expect(setup.status).toBe(200);
  const confirm = await request(app).post('/auth/mfa/totp/confirm').set('Authorization', auth(user, S1))
    .send({ code: codeFor(setup.body.data.secret, -1) });
  expect(confirm.status).toBe(200);
  return { ...first, secret: setup.body.data.secret as string };
};

const accountChange = (app: App, body: unknown, token?: string, user = USER, session = S1) => {
  const r = request(app).post('/auth/mfa/account-change').set('Authorization', auth(user, session));
  if (token) r.set('X-Step-Up', token);
  return r.send(body as object);
};

beforeEach(() => {
  vi.resetModules();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  process.env.WEBAUTHN_RP_ID = RP_ID;
  process.env.WEBAUTHN_ORIGINS = ORIGIN;
  process.env.MFA_SECRET_KEY = randomBytes(32).toString('base64');
  process.env.MFA_RECOVERY_PEPPER = 'pepper-for-tests';
  process.env.BREAK_GLASS_ALERT_EMAIL = 'boss@example.com';
  mfaState = createMfaFakeState();
  mfaState.staff.set(ROOT, 'super_admin');
  sent.length = 0;
  events = spyOnSecurityEvents();
});

afterEach(() => {
  events.restore();
  for (const k of ['FEATURE_REQUIRE_2FA', 'FEATURE_REQUIRE_STEP_UP']) delete process.env[k];
});

// ── Happy path ──────────────────────────────────────────────────────────────

describe('POST /auth/mfa/account-change', () => {
  it('a verified session + matching passkey step-up gets one 2-minute permit, in the house envelope', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const token = await stepUp(app, key, 'account_change', 'password');
    sent.length = 0;
    const before = Date.now();
    const r = await accountChange(app, { kind: 'password' }, token);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { kind: 'password', expiresAt: expect.any(String) }, error: null });
    const ttl = Date.parse(r.body.data.expiresAt) - before;
    expect(ttl).toBeGreaterThan(PERMIT_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(PERMIT_MS + 1_000);

    expect(mfaState.permits).toEqual([{ user_id: USER, kind: 'password', expires_at: r.body.data.expiresAt, used_at: null }]);
    // The step-up was spent: replaying it gets nothing.
    expect(mfaState.grants.every((g) => g.used_at !== null)).toBe(true);
    expect((await accountChange(app, { kind: 'password' }, token)).body.reason).toBe('step_up_required');
    expect(mfaState.permits).toHaveLength(1);

    // Security event: permit issued, kind never logged beyond the action.
    const ev = events.named('auth.mfa').filter((e) => e.action === 'account_change_permit');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ result: 'ok', step_up_action: 'account_change', method: null, break_glass: false });
    // Non-staff: no audit row.
    expect(mfaState.audits).toHaveLength(0);
  });

  it('emails the owner (password and email variants); a send failure never blocks', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    sent.length = 0;
    expect((await accountChange(app, { kind: 'password' }, await stepUp(app, key, 'account_change', 'password'))).status).toBe(200);
    expect((await accountChange(app, { kind: 'email' }, await stepUp(app, key, 'account_change', 'email'))).status).toBe(200);
    await flush();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([
      ['user@example.com', 'A password change was started on your account'],
      ['user@example.com', 'An email change was started on your account'],
    ]);
    expect(sent[1].text).toContain('link sent to the new address');
    for (const m of sent) expect(m.text).not.toMatch(/—/);

    const { sendEmail } = await import('../lib/notifications/emailSender');
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('postmark down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await accountChange(app, { kind: 'password' }, await stepUp(app, key, 'account_change', 'password'))).status).toBe(200);
    await flush();
    warn.mockRestore();
    expect(mfaState.permits).toHaveLength(3);
  });

  it('the break-glass account also alerts Boss and writes an audit row', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app, ROOT);
    sent.length = 0;
    const token = await stepUp(app, key, 'account_change', 'email', ROOT);
    expect((await accountChange(app, { kind: 'email' }, token, ROOT)).status).toBe(200);
    await flush();
    expect(sent.filter((m) => m.subject === 'An email change was started on your account').map((m) => m.to).sort())
      .toEqual(['boss@example.com', 'root@example.com']);
    expect(mfaState.audits.at(-1)).toMatchObject({ action: 'mfa_account_change_permit', kind: 'email', adminId: ROOT });
  });
});

// ── Refusals ────────────────────────────────────────────────────────────────

describe('refusals (reasons reach HTTP)', () => {
  it('no step-up token: 403 step_up_required, no permit (always on, flags off)', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    const r = await accountChange(app, { kind: 'password' });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ success: false, data: null, reason: 'step_up_required' });
    expect(mfaState.permits).toHaveLength(0);
  });

  it('a grant for the other kind is refused and stays unspent', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const emailToken = await stepUp(app, key, 'account_change', 'email');
    const r = await accountChange(app, { kind: 'password' }, emailToken);
    expect(r.status).toBe(403);
    expect(r.body.reason).toBe('step_up_required');
    expect(mfaState.permits).toHaveLength(0);
    expect(mfaState.grants.find((g) => g.target_id === 'email')!.used_at).toBeNull();
    // It still works for what it was issued for.
    expect((await accountChange(app, { kind: 'email' }, emailToken)).status).toBe(200);
    expect(mfaState.permits.map((p) => p.kind)).toEqual(['email']);
  });

  it('a grant for another action cannot be used', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const releaseToken = await stepUp(app, key, 'release', 'password');
    const r = await accountChange(app, { kind: 'password' }, releaseToken);
    expect(r.status).toBe(403);
    expect(r.body.reason).toBe('step_up_required');
    expect(mfaState.permits).toHaveLength(0);
  });

  it('a session without its second factor is refused before the step-up is spent', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const token = await stepUp(app, key, 'account_change', 'password');
    // The marker ends (expiry, sign-out elsewhere) between the step-up and the request.
    mfaState.sessions.delete(S1);
    const r = await accountChange(app, { kind: 'password' }, token);
    expect(r.status).toBe(403);
    expect(r.body.reason).toBe('second_factor_required');
    expect(mfaState.grants.find((g) => g.action === 'account_change')!.used_at).toBeNull();
    expect(mfaState.permits).toHaveLength(0);
    // A password-only session (never verified) is refused the same way.
    const other = await accountChange(app, { kind: 'password' }, token, USER, S2);
    expect(other.body.reason).toBe('second_factor_required');
  });

  it('bad bodies are refused before anything is spent', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const token = await stepUp(app, key, 'account_change', 'password');
    for (const body of [{}, { kind: 'phone' }, { kind: 'password', extra: 1 }, { kind: ['password'] }]) {
      const r = await accountChange(app, body, token);
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ success: false, data: null, code: 'invalid_argument' });
    }
    expect(mfaState.grants.find((g) => g.action === 'account_change')!.used_at).toBeNull();
    expect(mfaState.permits).toHaveLength(0);
  });

  it('signed-out callers are refused', async () => {
    const app = await loadApp();
    const r = await request(app).post('/auth/mfa/account-change').send({ kind: 'password' });
    expect(r.status).toBe(401);
    expect(mfaState.permits).toHaveLength(0);
  });
});

// ── Step-up method rules for account_change ─────────────────────────────────

describe('what may confirm an account_change step-up', () => {
  it('a non-staff authenticator code may; the permit follows', async () => {
    const app = await loadApp();
    const { secret } = await enrolPasskeyAndApp(app);
    const grant = await codeStepUp(app, USER, 'password', { totp: { code: codeFor(secret) } });
    expect(grant.status).toBe(200);
    const r = await accountChange(app, { kind: 'password' }, grant.body.data.stepUpToken);
    expect(r.status).toBe(200);
    expect(mfaState.permits).toHaveLength(1);
  });

  it('a backup code never may, and is not spent', async () => {
    const app = await loadApp();
    const { backupCodes } = await enrolFirst(app);
    const r = await codeStepUp(app, USER, 'password', { recoveryCode: { code: backupCodes[0] } });
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('backup_code_not_allowed');
    expect(mfaState.codes.filter((c) => c.used_at)).toHaveLength(0);
    expect(mfaState.grants.filter((g) => g.action === 'account_change')).toHaveLength(0);
  });

  it('staff: an authenticator code is refused before it is checked; a passkey works and is audited', async () => {
    mfaState.staff.set(ADMIN, 'admin');
    const app = await loadApp();
    const { key, secret } = await enrolPasskeyAndApp(app, ADMIN);
    const stepBefore = mfaState.totp.get(ADMIN)!.last_used_step;
    const r = await codeStepUp(app, ADMIN, 'password', { totp: { code: codeFor(secret) } });
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('passkey_required');
    expect(mfaState.totp.get(ADMIN)!.last_used_step).toBe(stepBefore);
    expect(mfaState.failures.has(ADMIN)).toBe(false);

    const token = await stepUp(app, key, 'account_change', 'password', ADMIN);
    expect((await accountChange(app, { kind: 'password' }, token, ADMIN)).status).toBe(200);
    const row = mfaState.audits.at(-1)!;
    expect(row).toMatchObject({ action: 'mfa_account_change_permit', kind: 'password', method: null, adminId: ADMIN, adminEmail: 'staff@example.com' });
    expect(Object.keys(row).sort()).toEqual(['action', 'adminEmail', 'adminId', 'ip', 'kind', 'method']);
  });

  it('an authenticator app in its 24 h wait cannot confirm it (code not spent)', async () => {
    const app = await loadApp();
    const { backupCodes } = await enrolFirst(app);
    // App added with a backup-code-confirmed step-up: it waits.
    const add = await codeStepUp(app, USER, 'totp', { recoveryCode: { code: backupCodes[0] } }, S1, 'factor_add');
    expect(add.status).toBe(200);
    const setup = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(USER, S1)).set('X-Step-Up', add.body.data.stepUpToken);
    expect(setup.status).toBe(200);
    expect((await request(app).post('/auth/mfa/totp/confirm').set('Authorization', auth(USER, S1))
      .send({ code: codeFor(setup.body.data.secret, -1) })).status).toBe(200);
    expect(mfaState.totp.get(USER)!.usable_from).not.toBeNull();

    const stepBefore = mfaState.totp.get(USER)!.last_used_step;
    const r = await codeStepUp(app, USER, 'password', { totp: { code: codeFor(setup.body.data.secret) } });
    expect(r.status).toBe(403);
    expect(r.body.reason).toBe('new_method_waiting');
    expect(mfaState.totp.get(USER)!.last_used_step).toBe(stepBefore);
    expect(mfaState.grants.filter((g) => g.action === 'account_change')).toHaveLength(0);
  });

  it('a passkey in its 24 h wait cannot confirm it', async () => {
    const app = await loadApp();
    const { secret } = await enrolPasskeyAndApp(app);
    // A passkey added with an authenticator-confirmed step-up: it waits.
    const grant = await codeStepUp(app, USER, 'passkey', { totp: { code: codeFor(secret) } }, S1, 'factor_add');
    expect(grant.status).toBe(200);
    const fresh = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN });
    const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S1)).set('X-Step-Up', grant.body.data.stepUpToken);
    const v = await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(USER, S1))
      .send({ challengeId: o.body.data.challengeId, nickname: 'Attacker', response: fresh.register(o.body.data.options.challenge) });
    expect(v.status).toBe(201);

    const so = await request(app).post('/auth/mfa/step-up/options').set('Authorization', auth(USER, S1)).send({ action: 'account_change', targetId: 'password' });
    expect(so.status).toBe(200);
    const sv = await request(app).post('/auth/mfa/step-up/verify').set('Authorization', auth(USER, S1))
      .send({ challengeId: so.body.data.challengeId, response: fresh.assert(so.body.data.options.challenge) });
    expect(sv.status).toBe(403);
    expect(sv.body.reason).toBe('new_method_waiting');
    expect(mfaState.grants.filter((g) => g.action === 'account_change')).toHaveLength(0);
  });

  it('account_change is in the step-up action lists', async () => {
    const { STEP_UP_ACTIONS, TOTP_STEP_UP_ACTIONS, CODE_STEP_UP_ACTIONS } = await import('../lib/mfa/mfaService');
    expect(STEP_UP_ACTIONS).toContain('account_change');
    expect(TOTP_STEP_UP_ACTIONS).toContain('account_change');
    expect(CODE_STEP_UP_ACTIONS).not.toContain('account_change');
  });
});
