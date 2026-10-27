import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response } from 'express';
import { randomBytes } from 'crypto';
import { bearerWith, createMfaFakeState, createMfaStoreFake, type MfaFakeState } from './helpers/mfaStoreFake';
import { SoftPasskey } from './helpers/softAuthenticator';
import { spyOnSecurityEvents, type SecurityEventSpy } from './helpers/securityEvents';
import { hotp, totpStep } from '../lib/mfa/totp';

/**
 * S-2FA Ph2 (backend) — Boss decisions 2026-10-27:
 *   - token step-ups (release, transfer_complete) also take an authenticator
 *     code for non-staff accounts; never a backup code; staff passkey only
 *   - a sign-in method change ends the account's other sessions
 *   - one per-IP budget on the code-check routes
 *   - staff accounts' own factor changes and lockouts go to audit_logs
 *
 * Same harness as mfa.test.ts (real P-256 passkeys, in-memory store).
 */
const RP_ID = 'am.test';
const ORIGIN = 'https://am.test';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ROOT = '33333333-3333-4333-8333-333333333333';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EMAILS: Record<string, string> = {
  [USER]: 'user@example.com',
  [OTHER]: 'other@example.com',
  [ROOT]: 'root@example.com',
};

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

const auth = (user: string, session: string, extra: Record<string, unknown> = {}) =>
  bearerWith({ sub: user, session_id: session, ...extra });

const loadApp = async () => {
  const { __setMfaStore } = await import('../lib/mfa/store');
  __setMfaStore(createMfaStoreFake(mfaState));
  const { default: mfaRoutes } = await import('../routes/mfa');
  const { requireAuth } = await import('../middleware/auth');
  const { requireSecondFactor, requireStepUp } = await import('../middleware/mfaGates');
  const app = express();
  app.use(express.json());
  app.use('/auth/mfa', mfaRoutes);
  // A stand-in for a gated token action.
  app.post(
    '/act/:id',
    requireAuth as never,
    requireSecondFactor(),
    requireStepUp('release', (req: Request) => req.params.id),
    (_req: Request, res: Response) => res.json({ success: true }),
  );
  return app;
};

type App = Awaited<ReturnType<typeof loadApp>>;

const flush = () => new Promise((r) => setTimeout(r, 0));

/** First passkey on an account with no factors; returns the codes shown once. */
const enrolFirst = async (app: App, user = USER, session = S1, opts: { synced?: boolean } = {}) => {
  const key = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN, synced: opts.synced });
  const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(user, session));
  expect(o.status).toBe(200);
  const v = await request(app)
    .post('/auth/mfa/passkeys/register/verify')
    .set('Authorization', auth(user, session))
    .send({ challengeId: o.body.data.challengeId, nickname: 'My phone', response: key.register(o.body.data.options.challenge) });
  return { key, res: v };
};

const signInWithPasskey = async (app: App, key: SoftPasskey, user = USER, session = S2) => {
  const o = await request(app).post('/auth/mfa/sign-in/options').set('Authorization', auth(user, session));
  return request(app)
    .post('/auth/mfa/sign-in/verify')
    .set('Authorization', auth(user, session))
    .send({ passkey: { challengeId: o.body.data.challengeId, response: key.assert(o.body.data.options.challenge) } });
};

/** Adds another passkey on an already-verified session (needs a factor_add step-up). */
const addPasskey = async (app: App, key: SoftPasskey, nickname: string, user = USER, session = S1) => {
  const token = await stepUp(app, key, 'factor_add', 'passkey', user, session);
  const extra = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN });
  const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(user, session)).set('X-Step-Up', token);
  expect(o.status).toBe(200);
  const v = await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(user, session))
    .send({ challengeId: o.body.data.challengeId, nickname, response: extra.register(o.body.data.options.challenge) });
  expect(v.status).toBe(201);
  return extra;
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
  for (const k of ['FEATURE_REQUIRE_2FA', 'FEATURE_REQUIRE_STEP_UP', 'FEATURE_REQUIRE_ADMIN_2FA']) delete process.env[k];
});

const ADMIN = '44444444-4444-4444-8444-444444444444';
EMAILS[ADMIN] = 'staff@example.com';
const S3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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

/** Passkey first, then an authenticator app (confirmed with step -1). Returns the app secret. */
const enrolPasskeyAndApp = async (app: App, user = USER, session = S1) => {
  const { key, res } = await enrolFirst(app, user, session);
  expect(res.status).toBe(201);
  const token = await stepUp(app, key, 'factor_add', 'totp', user, session);
  const setup = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(user, session)).set('X-Step-Up', token);
  expect(setup.status).toBe(200);
  const confirm = await request(app).post('/auth/mfa/totp/confirm').set('Authorization', auth(user, session))
    .send({ code: codeFor(setup.body.data.secret, -1) });
  expect(confirm.status).toBe(200);
  return { key, secret: setup.body.data.secret as string, backupCodes: res.body.data.backupCodes as string[], confirm };
};

const codeStepUp = (app: App, user: string, action: string, body: Record<string, unknown>, session = S1) =>
  request(app).post('/auth/mfa/step-up/verify').set('Authorization', auth(user, session)).send({ action, targetId: 'tag-a', ...body });

// ── Step-up method rules ────────────────────────────────────────────────────

describe('token step-up with an authenticator code', () => {
  beforeEach(() => {
    process.env.FEATURE_REQUIRE_2FA = 'true';
    process.env.FEATURE_REQUIRE_STEP_UP = 'true';
  });

  it('a non-staff account may confirm a release or a transfer with its authenticator app', async () => {
    const app = await loadApp();
    const { secret } = await enrolPasskeyAndApp(app);
    const grant = await codeStepUp(app, USER, 'release', { totp: { code: codeFor(secret) } });
    expect(grant.status).toBe(200);
    expect(grant.body.data).toMatchObject({ action: 'release', targetId: 'tag-a' });
    expect(events.named('auth.mfa').at(-1)).toMatchObject({ action: 'step_up_issue', method: 'totp', step_up_action: 'release' });

    const ok = await request(app).post('/act/tag-a').set('Authorization', auth(USER, S1)).set('X-Step-Up', grant.body.data.stepUpToken);
    expect(ok.status).toBe(200);
    // The grant records how it was issued (migration 20261027000009), so the use event carries it.
    expect(events.named('auth.mfa').at(-1)).toMatchObject({ action: 'step_up_use', method: 'totp', result: 'ok' });

    const transfer = await codeStepUp(app, USER, 'transfer_complete', { totp: { code: codeFor(secret, 1) } });
    expect(transfer.status).toBe(200);
  });

  it('a backup code never confirms a token action, and is not spent', async () => {
    const app = await loadApp();
    const { backupCodes } = await enrolPasskeyAndApp(app);
    for (const action of ['release', 'transfer_complete']) {
      const r = await codeStepUp(app, USER, action, { recoveryCode: { code: backupCodes[0] } });
      expect(r.status).toBe(400);
      expect(r.body.reason).toBe('backup_code_not_allowed');
    }
    expect(mfaState.codes.filter((c) => c.used_at)).toHaveLength(0);
    expect(mfaState.failures.has(USER)).toBe(false);
  });

  it('staff confirm token actions with a passkey only: the code is refused before it is checked', async () => {
    mfaState.staff.set(ADMIN, 'admin');
    const app = await loadApp();
    const { key, secret, backupCodes } = await enrolPasskeyAndApp(app, ADMIN);
    for (const action of ['release', 'transfer_complete']) {
      const totp = await codeStepUp(app, ADMIN, action, { totp: { code: codeFor(secret) } });
      expect(totp.status).toBe(400);
      expect(totp.body.reason).toBe('passkey_required');
      const backup = await codeStepUp(app, ADMIN, action, { recoveryCode: { code: backupCodes[0] } });
      expect(backup.body.reason).toBe('passkey_required');
    }
    // No attempt counted, no code spent.
    expect(mfaState.failures.has(ADMIN)).toBe(false);
    expect(mfaState.codes.filter((c) => c.used_at)).toHaveLength(0);
    // A passkey still works.
    const token = await stepUp(app, key, 'release', 'tag-a', ADMIN);
    expect((await request(app).post('/act/tag-a').set('Authorization', auth(ADMIN, S1)).set('X-Step-Up', token)).status).toBe(200);
    // Staff may still fix their own sign-in methods with a code.
    expect((await codeStepUp(app, ADMIN, 'factor_add', { totp: { code: codeFor(secret) } })).status).toBe(200);
  });

  it('price changes and admin actions stay passkey only, even for a non-staff authenticator code', async () => {
    const app = await loadApp();
    const { secret } = await enrolPasskeyAndApp(app);
    for (const action of ['price_change', 'admin_action', 'admin_approve']) {
      const r = await codeStepUp(app, USER, action, { totp: { code: codeFor(secret) } });
      expect(r.status).toBe(400);
      expect(r.body.reason).toBe('no_passkey');
    }
  });
});

// ── Status ──────────────────────────────────────────────────────────────────

describe('status', () => {
  it('says whether the account is staff and whether a second factor is required', async () => {
    mfaState.staff.set(ADMIN, 'support');
    const app = await loadApp();
    const user = await request(app).get('/auth/mfa/status').set('Authorization', auth(USER, S1));
    expect(user.body.data).toMatchObject({ isStaff: false, breakGlass: false, secondFactorRequired: false, enrolmentRequired: false });
    const staff = await request(app).get('/auth/mfa/status').set('Authorization', auth(ADMIN, S1));
    expect(staff.body.data).toMatchObject({ isStaff: true, breakGlass: false });
    const root = await request(app).get('/auth/mfa/status').set('Authorization', auth(ROOT, S1));
    expect(root.body.data).toMatchObject({ isStaff: true, breakGlass: true });

    process.env.FEATURE_REQUIRE_2FA = 'true';
    const required = await request(app).get('/auth/mfa/status').set('Authorization', auth(USER, S1));
    expect(required.body.data).toMatchObject({ secondFactorRequired: true, enrolmentRequired: true });
    await enrolFirst(app);
    const enrolled = await request(app).get('/auth/mfa/status').set('Authorization', auth(USER, S1));
    // Still required for actions; no longer asked to enrol.
    expect(enrolled.body.data).toMatchObject({ secondFactorRequired: true, enrolmentRequired: false });
    expect(Object.keys(enrolled.body.data).sort()).toEqual([
      'authenticatorApp', 'authenticatorAppUsableFrom', 'backupCodesLeft', 'breakGlass', 'codeEntryLockedUntil', 'enrolmentRequired', 'hasFactor',
      'isStaff', 'passkeys', 'secondFactorRequired', 'sessionVerified',
    ]);
  });
});

// ── Ending other sessions ───────────────────────────────────────────────────

describe('a sign-in method change ends the other sessions', () => {
  const marker = (session: string, user = USER) =>
    mfaState.sessions.set(session, { session_id: session, user_id: user, method: 'passkey', expires_at: new Date(Date.now() + 60_000).toISOString() });

  it('adding a passkey keeps this session and ends the others (and their markers)', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    expect((await signInWithPasskey(app, key, USER, S2)).status).toBe(200);
    marker(S3, OTHER);
    await addPasskey(app, key, 'Laptop');
    expect(mfaState.endedSessions.at(-1)).toEqual({ userId: USER, keep: S1 });
    expect(mfaState.sessions.has(S1)).toBe(true);
    expect(mfaState.sessions.has(S2)).toBe(false);
    // Another account is never touched.
    expect(mfaState.sessions.has(S3)).toBe(true);
  });

  it('the first factor ends the others too, and says so', async () => {
    const app = await loadApp();
    const { res } = await enrolFirst(app);
    expect(res.body.data.otherSessionsEnded).toBe(true);
    expect(mfaState.endedSessions).toEqual([{ userId: USER, keep: S1 }]);
  });

  it('adding an authenticator app, removing a method and new backup codes all end them', async () => {
    const app = await loadApp();
    const { key, confirm } = await enrolPasskeyAndApp(app);
    expect(confirm.body.data.otherSessionsEnded).toBe(true);

    marker(S2);
    const regenToken = await stepUp(app, key, 'recovery_regen', 'recovery_codes');
    const regen = await request(app).post('/auth/mfa/recovery-codes/regenerate').set('Authorization', auth(USER, S1)).set('X-Step-Up', regenToken);
    expect(regen.status).toBe(200);
    expect(regen.body.data.otherSessionsEnded).toBe(true);
    expect(mfaState.sessions.has(S2)).toBe(false);

    marker(S2);
    const rmToken = await stepUp(app, key, 'factor_remove', 'totp');
    const rm = await request(app).delete('/auth/mfa/totp').set('Authorization', auth(USER, S1)).set('X-Step-Up', rmToken);
    expect(rm.status).toBe(200);
    expect(rm.body.data.otherSessionsEnded).toBe(true);
    expect(mfaState.sessions.has(S2)).toBe(false);

    // A fresh app: the per-account rate limit (10/min, in memory) would otherwise answer 429 first.
    vi.resetModules();
    const app2 = await loadApp();
    await addPasskey(app2, key, 'Laptop');
    marker(S2);
    const laptop = mfaState.passkeys.find((p) => p.nickname === 'Laptop')!;
    const pkToken = await stepUp(app2, key, 'factor_remove', `passkey:${laptop.id}`);
    const pk = await request(app2).delete(`/auth/mfa/passkeys/${laptop.id}`).set('Authorization', auth(USER, S1)).set('X-Step-Up', pkToken);
    expect(pk.status).toBe(200);
    expect(pk.body.data.otherSessionsEnded).toBe(true);
    expect(mfaState.sessions.has(S2)).toBe(false);
    expect(mfaState.sessions.has(S1)).toBe(true);
    expect(mfaState.endedSessions.every((e) => e.userId === USER && e.keep === S1)).toBe(true);
    expect(mfaState.endedSessions).toHaveLength(6); // first, app, regen, app removed, laptop added, laptop removed
  });

  it('signing in or a step-up does not end other sessions', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    mfaState.endedSessions.length = 0;
    await signInWithPasskey(app, key, USER, S2);
    await stepUp(app, key, 'release', 'tag-a');
    expect(mfaState.endedSessions).toHaveLength(0);
    expect(mfaState.sessions.has(S2)).toBe(true);
  });

  it('a failure to end them is logged and reported, but does not undo or fail the change', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mfaState.failNext.add('endOtherSessions');
    const token = await stepUp(app, key, 'recovery_regen', 'recovery_codes');
    const regen = await request(app).post('/auth/mfa/recovery-codes/regenerate').set('Authorization', auth(USER, S1)).set('X-Step-Up', token);
    expect(regen.status).toBe(200);
    expect(regen.body.data.backupCodes).toHaveLength(10);
    expect(regen.body.data.otherSessionsEnded).toBe(false);
    expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).toContain('mfa_end_other_sessions_failed');
    errors.mockRestore();
  });
});

// ── Per-IP limit ────────────────────────────────────────────────────────────

describe('per-IP limit on the code-check routes', () => {
  it('one budget of 30 a minute per IP, shared by every code-check route, counted before sign-in', async () => {
    const app = await loadApp();
    const { MFA_IP_LIMIT_PER_MIN } = await import('../routes/mfa');
    expect(MFA_IP_LIMIT_PER_MIN).toBe(30);
    const hits = [
      () => request(app).post('/auth/mfa/sign-in/verify'),
      () => request(app).post('/auth/mfa/step-up/verify'),
      () => request(app).post('/auth/mfa/totp/confirm'),
      () => request(app).post('/auth/mfa/passkeys/register/verify'),
      () => request(app).post('/auth/mfa/recovery-codes/regenerate'),
      () => request(app).delete('/auth/mfa/totp'),
      () => request(app).delete('/auth/mfa/passkeys/11111111-1111-4111-8111-111111111111'),
    ];
    for (let i = 0; i < 30; i++) expect((await hits[i % hits.length]()).status).toBe(401);
    for (const hit of hits) expect((await hit()).status).toBe(429);
    // Routes that check no code are not on this budget.
    expect((await request(app).get('/auth/mfa/status')).status).toBe(401);
  });

  it('spreading guesses across accounts does not get past it', async () => {
    const app = await loadApp();
    const users = Array.from({ length: 7 }, (_, i) => `5555555${i}-5555-4555-8555-555555555555`);
    const statuses: number[] = [];
    // 5 per account stays under the per-account limit (10) and the code lockout.
    for (const u of users) {
      for (let i = 0; i < 5; i++) {
        statuses.push((await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(u, S1))
          .send({ recoveryCode: { code: 'ZZZZZ-ZZZZZ' } })).status);
      }
    }
    expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(30).every((s) => s === 429)).toBe(true);
  });
});

// ── Staff audit ─────────────────────────────────────────────────────────────

describe('staff sign-in method changes go to audit_logs', () => {
  it('add, remove and new backup codes: one row each, method only', async () => {
    mfaState.staff.set(ADMIN, 'admin');
    const app = await loadApp();
    const { key, secret, backupCodes } = await enrolPasskeyAndApp(app, ADMIN);
    const regenToken = await stepUp(app, key, 'recovery_regen', 'recovery_codes', ADMIN);
    const regen = await request(app).post('/auth/mfa/recovery-codes/regenerate').set('Authorization', auth(ADMIN, S1)).set('X-Step-Up', regenToken);
    const rmToken = await stepUp(app, key, 'factor_remove', 'totp', ADMIN);
    expect((await request(app).delete('/auth/mfa/totp').set('Authorization', auth(ADMIN, S1)).set('X-Step-Up', rmToken)).status).toBe(200);

    expect(mfaState.audits.map((a) => [a.action, a.method])).toEqual([
      ['mfa_factor_add', 'passkey'],
      ['mfa_factor_add', 'totp'],
      ['mfa_recovery_regen', 'recovery_code'],
      ['mfa_factor_remove', 'totp'],
    ]);
    expect(mfaState.audits.every((a) => a.adminId === ADMIN && a.adminEmail === 'staff@example.com')).toBe(true);
    expect(Object.keys(mfaState.audits[0]).sort()).toEqual(['action', 'adminEmail', 'adminId', 'ip', 'method']);
    const blob = JSON.stringify(mfaState.audits);
    for (const secretish of [key.id, mfaState.passkeys[0].public_key, 'My phone', secret, ...backupCodes, ...regen.body.data.backupCodes]) {
      expect(blob).not.toContain(secretish);
    }
  });

  it('a staff code-entry lockout is audited', async () => {
    mfaState.staff.set(ADMIN, 'admin');
    const app = await loadApp();
    await enrolFirst(app, ADMIN);
    const guess = () => request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(ADMIN, S2)).send({ recoveryCode: { code: 'ZZZZZ-ZZZZZ' } });
    for (let i = 0; i < 5; i++) await guess();
    expect((await guess()).status).toBe(429);
    expect(mfaState.audits.at(-1)).toMatchObject({ action: 'mfa_lockout', method: 'recovery_code', adminId: ADMIN });
  });

  it('non-staff accounts write no audit rows', async () => {
    const app = await loadApp();
    const { key } = await enrolPasskeyAndApp(app);
    await addPasskey(app, key, 'Laptop');
    expect(mfaState.audits).toHaveLength(0);
  });

  it('a failed audit write is logged and does not fail the change', async () => {
    mfaState.staff.set(ADMIN, 'admin');
    const app = await loadApp();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mfaState.failNext.add('writeStaffAudit');
    const { res } = await enrolFirst(app, ADMIN);
    expect(res.status).toBe(201);
    expect(mfaState.passkeys).toHaveLength(1);
    expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).toContain('mfa_staff_audit_failed');
    errors.mockRestore();
  });
});
