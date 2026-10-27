import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response } from 'express';
import { randomBytes } from 'crypto';
import { bearerWith, createMfaFakeState, createMfaStoreFake, type MfaFakeState } from './helpers/mfaStoreFake';
import { SoftPasskey } from './helpers/softAuthenticator';
import { spyOnSecurityEvents, type SecurityEventSpy } from './helpers/securityEvents';
import { hotp, totpStep } from '../lib/mfa/totp';

/**
 * S-2FA Ph1 — passkeys, authenticator app, backup codes, the per-session
 * marker, step-up grants and the route gates.
 *
 * Passkeys here are real P-256 keys (helpers/softAuthenticator.ts), so every
 * accept/refuse goes through @simplewebauthn's own verification. The store is
 * the in-memory fake; the database's single-use guarantees under concurrency
 * are proven by supabase/tests/s_2fa_live.sql.
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

// ── Enrolment ───────────────────────────────────────────────────────────────

describe('first passkey', () => {
  it('saves the public key, shows 10 backup codes once, marks the session, emails the owner', async () => {
    const app = await loadApp();
    const { key, res } = await enrolFirst(app);
    await flush();

    expect(res.status).toBe(201);
    expect(res.body.data.backupCodes).toHaveLength(10);
    expect(res.body.data.backupCodes[0]).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
    expect(mfaState.passkeys).toHaveLength(1);
    expect(mfaState.passkeys[0]).toMatchObject({ user_id: USER, credential_id: key.id, backed_up: false, nickname: 'My phone' });
    expect(mfaState.codes.filter((c) => c.user_id === USER)).toHaveLength(10);
    // Codes are stored hashed, never as typed.
    expect(JSON.stringify(mfaState.codes)).not.toContain(res.body.data.backupCodes[0]);
    expect(mfaState.sessions.get(S1)).toMatchObject({ user_id: USER, method: 'passkey' });
    expect(sent.map((m) => m.subject)).toContain('A new sign-in method was added to your account');
    expect(events.named('auth.mfa').at(-1)).toMatchObject({ action: 'enrol', method: 'passkey', result: 'ok', break_glass: false });
  });

  it('status never exposes a public key, credential id, secret or hash', async () => {
    const app = await loadApp();
    const { key, res } = await enrolFirst(app);
    const s = await request(app).get('/auth/mfa/status').set('Authorization', auth(USER, S1));
    expect(s.status).toBe(200);
    expect(s.body.data).toMatchObject({ hasFactor: true, sessionVerified: true, backupCodesLeft: 10, authenticatorApp: false, breakGlass: false });
    const body = JSON.stringify(s.body);
    expect(body).not.toContain(key.id);
    expect(body).not.toContain(mfaState.passkeys[0].public_key);
    expect(body).not.toContain(mfaState.codes[0].code_hash);
    expect(body).not.toContain(res.body.data.backupCodes[0]);
    expect(Object.keys(s.body.data.passkeys[0]).sort()).toEqual(['createdAt', 'id', 'lastUsedAt', 'nickname', 'synced', 'usableFrom']);
  });

  it('a second passkey needs a session that already passed its second factor', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S2));
    expect(o.status).toBe(403);
    expect(o.body.reason).toBe('second_factor_required');
  });

  it('refuses a passkey made for another site (origin), and the challenge cannot be retried', async () => {
    const app = await loadApp();
    const key = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN });
    const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S1));
    const { challengeId, options } = o.body.data;
    const bad = await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(USER, S1))
      .send({ challengeId, nickname: 'x', response: key.register(options.challenge, { origin: 'https://evil.test' }) });
    expect(bad.status).toBe(400);
    expect(bad.body.reason).toBe('passkey_invalid');

    const retry = await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(USER, S1))
      .send({ challengeId, nickname: 'x', response: key.register(options.challenge) });
    expect(retry.status).toBe(400);
    expect(mfaState.passkeys).toHaveLength(0);
  });

  it('refuses a passkey bound to another RP ID', async () => {
    const app = await loadApp();
    const key = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN });
    const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S1));
    const res = await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(USER, S1))
      .send({ challengeId: o.body.data.challengeId, nickname: 'x', response: key.register(o.body.data.options.challenge, { rpId: 'evil.test' }) });
    expect(res.status).toBe(400);
  });

  it('refuses a challenge issued to another session, or one that expired', async () => {
    const app = await loadApp();
    const key = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN });
    const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S1));
    const other = await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(USER, S2))
      .send({ challengeId: o.body.data.challengeId, nickname: 'x', response: key.register(o.body.data.options.challenge) });
    expect(other.status).toBe(400);

    const o2 = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S1));
    mfaState.challenges.at(-1)!.expires_at = new Date(Date.now() - 1000).toISOString();
    const expired = await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(USER, S1))
      .send({ challengeId: o2.body.data.challengeId, nickname: 'x', response: key.register(o2.body.data.options.challenge) });
    expect(expired.status).toBe(400);
    expect(mfaState.passkeys).toHaveLength(0);
  });

  it('refuses a passkey that skipped user verification (Face ID / PIN)', async () => {
    const app = await loadApp();
    const key = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN });
    key.userVerified = false;
    const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S1));
    const res = await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(USER, S1))
      .send({ challengeId: o.body.data.challengeId, nickname: 'x', response: key.register(o.body.data.options.challenge) });
    expect(res.status).toBe(400);
  });

  it('refuses a token without a session id (it could never carry a second factor)', async () => {
    const app = await loadApp();
    const res = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', bearerWith({ sub: USER }));
    expect(res.status).toBe(403);
  });

  it('refuses unknown fields in the body', async () => {
    const app = await loadApp();
    const res = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S1))
      .send({ totp: { code: '123456' }, extra: true });
    expect(res.status).toBe(400);
  });
});

describe('super_admin (break-glass)', () => {
  it('refuses a synced passkey and accepts a hardware key', async () => {
    const app = await loadApp();
    const synced = await enrolFirst(app, ROOT, S1, { synced: true });
    expect(synced.res.status).toBe(400);
    expect(synced.res.body.reason).toBe('synced_passkey_not_allowed');

    const hardware = await enrolFirst(app, ROOT, S1);
    expect(hardware.res.status).toBe(201);
    expect(mfaState.passkeys).toHaveLength(1);
  });

  it('gets a 1-hour marker and an alert email on every sign-in', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app, ROOT, S1);
    sent.length = 0;
    const res = await signInWithPasskey(app, key, ROOT, S2);
    await flush();
    expect(res.status).toBe(200);
    const ttl = new Date(mfaState.sessions.get(S2)!.expires_at).getTime() - Date.now();
    expect(ttl).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(ttl).toBeGreaterThan(55 * 60 * 1000);
    expect(sent.find((m) => m.to === 'boss@example.com')?.subject).toBe('The super admin account was just used');
    expect(events.named('auth.mfa').at(-1)).toMatchObject({ action: 'sign_in', break_glass: true, result: 'ok' });
  });

  it('cannot set up an authenticator app', async () => {
    const app = await loadApp();
    await enrolFirst(app, ROOT, S1);
    const res = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(ROOT, S1));
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('not_available');
  });
});

// ── Second sign-in step ─────────────────────────────────────────────────────

describe('sign-in with a passkey', () => {
  it('marks a new session for 12 hours', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const res = await signInWithPasskey(app, key);
    expect(res.status).toBe(200);
    const ttl = new Date(mfaState.sessions.get(S2)!.expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(11 * 60 * 60 * 1000);
    expect(mfaState.passkeys[0].last_used_at).not.toBeNull();
  });

  it('refuses a replayed assertion (same challenge twice)', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const o = await request(app).post('/auth/mfa/sign-in/options').set('Authorization', auth(USER, S2));
    const response = key.assert(o.body.data.options.challenge);
    const first = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2))
      .send({ passkey: { challengeId: o.body.data.challengeId, response } });
    expect(first.status).toBe(200);
    const again = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2))
      .send({ passkey: { challengeId: o.body.data.challengeId, response } });
    expect(again.status).toBe(400);
  });

  it("refuses another account's passkey", async () => {
    const app = await loadApp();
    await enrolFirst(app, USER, S1);
    const { key: otherKey } = await enrolFirst(app, OTHER, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const o = await request(app).post('/auth/mfa/sign-in/options').set('Authorization', auth(USER, S2));
    const res = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2))
      .send({ passkey: { challengeId: o.body.data.challengeId, response: otherKey.assert(o.body.data.options.challenge) } });
    expect(res.status).toBe(400);
    expect(mfaState.sessions.has(S2)).toBe(false);
  });

  it('refuses a cloned key whose counter went backwards', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    expect((await signInWithPasskey(app, key)).status).toBe(200); // counter 1
    expect((await signInWithPasskey(app, key)).status).toBe(200); // counter 2
    const o = await request(app).post('/auth/mfa/sign-in/options').set('Authorization', auth(USER, S2));
    const res = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2))
      .send({ passkey: { challengeId: o.body.data.challengeId, response: key.assert(o.body.data.options.challenge, { counter: 1 }) } });
    expect(res.status).toBe(400);
  });
});

describe('backup codes', () => {
  it('each code works once, in any case or spacing; the owner is emailed the count left', async () => {
    const app = await loadApp();
    const { res } = await enrolFirst(app);
    const code: string = res.body.data.backupCodes[3];
    sent.length = 0;
    const typed = ` ${code.toLowerCase().replace('-', ' ')} `;
    const ok = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2)).send({ recoveryCode: { code: typed } });
    await flush();
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ method: 'recovery_code', backupCodesLeft: 9 });
    expect(mfaState.sessions.get(S2)?.method).toBe('recovery_code');
    expect(sent[0].subject).toBe('A backup code was used to sign in');
    expect(sent[0].text).toContain('You have 9 left');

    const again = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'))
      .send({ recoveryCode: { code } });
    expect(again.status).toBe(400);
    expect(again.body.reason).toBe('invalid_code');
  });

  it("another account's code does not work", async () => {
    const app = await loadApp();
    const { res } = await enrolFirst(app, OTHER, S1);
    await enrolFirst(app, USER, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const r = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2))
      .send({ recoveryCode: { code: res.body.data.backupCodes[0] } });
    expect(r.status).toBe(400);
  });

  it('a new set voids the old one and needs a verified session plus a fresh check', async () => {
    const app = await loadApp();
    const { key, res } = await enrolFirst(app);
    const mfaKey = () => key;
    const denied = await request(app).post('/auth/mfa/recovery-codes/regenerate').set('Authorization', auth(USER, S2));
    expect(denied.status).toBe(403);

    // A verified session alone is not enough (a stolen session must not take a new set).
    const noStepUp = await request(app).post('/auth/mfa/recovery-codes/regenerate').set('Authorization', auth(USER, S1));
    expect(noStepUp.status).toBe(403);
    expect(noStepUp.body.reason).toBe('step_up_required');

    const token = await stepUp(app, mfaKey(), 'recovery_regen', 'recovery_codes');
    const fresh = await request(app).post('/auth/mfa/recovery-codes/regenerate').set('Authorization', auth(USER, S1)).set('X-Step-Up', token);
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.backupCodes).toHaveLength(10);
    const old = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2))
      .send({ recoveryCode: { code: res.body.data.backupCodes[0] } });
    expect(old.status).toBe(400);
  });

  it('5 wrong codes lock code entry for 15 minutes, even for a right code; a passkey still works', async () => {
    const app = await loadApp();
    const { key, res } = await enrolFirst(app);
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2))
        .send({ recoveryCode: { code: 'ZZZZZ-ZZZZZ' } });
      expect(r.status).toBe(400);
    }
    const locked = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2))
      .send({ recoveryCode: { code: res.body.data.backupCodes[0] } });
    expect(locked.status).toBe(429);
    expect(locked.body.reason).toBe('mfa_locked');
    expect(mfaState.codes.filter((c) => c.used_at)).toHaveLength(0);
    expect(events.named('auth.mfa').some((e) => e.action === 'lockout')).toBe(true);

    expect((await signInWithPasskey(app, key)).status).toBe(200);
  });
});

describe('authenticator app', () => {
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

  it('set up as the first factor, then sign in; a code cannot be used twice', async () => {
    const app = await loadApp();
    const setup = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(USER, S1));
    expect(setup.status).toBe(200);
    expect(setup.body.data.otpauthUri).toMatch(/^otpauth:\/\/totp\/Authentic%20Materials%3Auser%40example\.com\?secret=/);
    // Stored encrypted, never as issued.
    expect(mfaState.totp.get(USER)!.secret_enc).not.toContain(setup.body.data.secret);

    const confirm = await request(app).post('/auth/mfa/totp/confirm').set('Authorization', auth(USER, S1))
      .send({ code: codeFor(setup.body.data.secret, -1) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.backupCodes).toHaveLength(10);

    const code = codeFor(setup.body.data.secret);
    const signIn = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2)).send({ totp: { code } });
    expect(signIn.status).toBe(200);
    const replay = await request(app).post('/auth/mfa/sign-in/verify')
      .set('Authorization', auth(USER, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')).send({ totp: { code } });
    expect(replay.status).toBe(400);
  });

  it('a wrong confirmation code does not switch it on', async () => {
    const app = await loadApp();
    const setup = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(USER, S1));
    const wrong = String((Number(codeFor(setup.body.data.secret)) + 1) % 1_000_000).padStart(6, '0');
    const res = await request(app).post('/auth/mfa/totp/confirm').set('Authorization', auth(USER, S1)).send({ code: wrong });
    expect(res.status).toBe(400);
    expect(mfaState.totp.get(USER)!.verified_at).toBeNull();
    const signIn = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2))
      .send({ totp: { code: codeFor(setup.body.data.secret) } });
    expect(signIn.status).toBe(400);
  });

  it('a second app cannot replace a confirmed one', async () => {
    const app = await loadApp();
    const setup = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(USER, S1));
    await request(app).post('/auth/mfa/totp/confirm').set('Authorization', auth(USER, S1)).send({ code: codeFor(setup.body.data.secret) });
    const noStepUp = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(USER, S1));
    expect(noStepUp.status).toBe(403);
    expect(noStepUp.body.reason).toBe('step_up_required');
    // Confirm with the app itself (a code step-up is allowed for changing sign-in methods).
    const grant = await request(app).post('/auth/mfa/step-up/verify').set('Authorization', auth(USER, S1))
      .send({ action: 'factor_add', targetId: 'totp', totp: { code: codeFor(setup.body.data.secret, 1) } });
    expect(grant.status).toBe(200);
    const again = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(USER, S1)).set('X-Step-Up', grant.body.data.stepUpToken);
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('already_set_up');
  });
});

// ── Step-up ─────────────────────────────────────────────────────────────────

describe('step-up', () => {
  beforeEach(() => {
    process.env.FEATURE_REQUIRE_2FA = 'true';
    process.env.FEATURE_REQUIRE_STEP_UP = 'true';
  });

  it('a grant works once, for that action on that target only', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const token = await stepUp(app, key, 'release', 'tag-a');

    const wrongTarget = await request(app).post('/act/tag-b').set('Authorization', auth(USER, S1)).set('X-Step-Up', token);
    expect(wrongTarget.status).toBe(403);
    expect(wrongTarget.body.reason).toBe('step_up_required');

    const ok = await request(app).post('/act/tag-a').set('Authorization', auth(USER, S1)).set('X-Step-Up', token);
    expect(ok.status).toBe(200);

    const reused = await request(app).post('/act/tag-a').set('Authorization', auth(USER, S1)).set('X-Step-Up', token);
    expect(reused.status).toBe(403);
    // The token itself never reaches a log line.
    expect(events.blob()).not.toContain(token);
  });

  it('refuses a grant for another action, another session, or after 2 minutes', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const wrongAction = await stepUp(app, key, 'transfer_complete', 'tag-a');
    expect((await request(app).post('/act/tag-a').set('Authorization', auth(USER, S1)).set('X-Step-Up', wrongAction)).status).toBe(403);

    expect((await signInWithPasskey(app, key, USER, S2)).status).toBe(200);
    const fromS1 = await stepUp(app, key, 'release', 'tag-a');
    expect((await request(app).post('/act/tag-a').set('Authorization', auth(USER, S2)).set('X-Step-Up', fromS1)).status).toBe(403);

    const late = await stepUp(app, key, 'release', 'tag-a');
    mfaState.grants.at(-1)!.expires_at = new Date(Date.now() - 1).toISOString();
    expect((await request(app).post('/act/tag-a').set('Authorization', auth(USER, S1)).set('X-Step-Up', late)).status).toBe(403);
  });

  it('cannot be started from a session that has not passed its second factor', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    const res = await request(app).post('/auth/mfa/step-up/options').set('Authorization', auth(USER, S2)).send({ action: 'release', targetId: 'tag-a' });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('second_factor_required');
  });

  it('accepts only a passkey: an account with only an authenticator app is told to add one', async () => {
    const app = await loadApp();
    const setup = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(USER, S1));
    const secret = Buffer.from(setup.body.data.secret, 'utf8'); // not used: confirm via the store
    void secret;
    mfaState.totp.get(USER)!.verified_at = new Date().toISOString();
    mfaState.sessions.set(S1, { session_id: S1, user_id: USER, method: 'totp', expires_at: new Date(Date.now() + 60_000).toISOString() });
    const res = await request(app).post('/auth/mfa/step-up/options').set('Authorization', auth(USER, S1)).send({ action: 'release', targetId: 'tag-a' });
    expect(res.status).toBe(412);
    expect(res.body.reason).toBe('no_passkey');
  });

  it('the gate refuses a session without a second factor before looking at the step-up', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    const res = await request(app).post('/act/tag-a').set('Authorization', auth(USER, S2));
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('2fa_required');
  });

  it('fails closed on a database error', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const token = await stepUp(app, key, 'release', 'tag-a');
    mfaState.failNext.add('consumeGrant');
    const res = await request(app).post('/act/tag-a').set('Authorization', auth(USER, S1)).set('X-Step-Up', token);
    expect(res.status).toBe(503);
  });

  it('with both flags off the gates let requests through (dormant until Ph4)', async () => {
    delete process.env.FEATURE_REQUIRE_2FA;
    delete process.env.FEATURE_REQUIRE_STEP_UP;
    const app = await loadApp();
    const res = await request(app).post('/act/tag-a').set('Authorization', auth(USER, S2));
    expect(res.status).toBe(200);
  });
});

// ── Removing a factor ───────────────────────────────────────────────────────

describe('removing a sign-in method', () => {
  it('always needs a step-up, even with the flags off', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    await addPasskey(app, key, 'Laptop');
    const target = mfaState.passkeys.find((p) => p.nickname === 'Laptop')!;

    const noStepUp = await request(app).delete(`/auth/mfa/passkeys/${target.id}`).set('Authorization', auth(USER, S1));
    expect(noStepUp.status).toBe(403);

    sent.length = 0;
    const token = await stepUp(app, key, 'factor_remove', `passkey:${target.id}`);
    const ok = await request(app).delete(`/auth/mfa/passkeys/${target.id}`).set('Authorization', auth(USER, S1)).set('X-Step-Up', token);
    await flush();
    expect(ok.status).toBe(200);
    expect(mfaState.passkeys).toHaveLength(1);
    expect(sent[0].subject).toBe('A sign-in method was removed from your account');
  });

  it('never removes the last one', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const only = mfaState.passkeys[0];
    const token = await stepUp(app, key, 'factor_remove', `passkey:${only.id}`);
    const res = await request(app).delete(`/auth/mfa/passkeys/${only.id}`).set('Authorization', auth(USER, S1)).set('X-Step-Up', token);
    expect(res.status).toBe(412);
    expect(res.body.reason).toBe('last_factor');
    expect(mfaState.passkeys).toHaveLength(1);
  });

  it("cannot remove another account's passkey", async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    await enrolFirst(app, OTHER, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const theirs = mfaState.passkeys.find((p) => p.user_id === OTHER)!;
    const token = await stepUp(app, key, 'factor_remove', `passkey:${theirs.id}`);
    const res = await request(app).delete(`/auth/mfa/passkeys/${theirs.id}`).set('Authorization', auth(USER, S1)).set('X-Step-Up', token);
    expect(res.status).toBe(404);
    expect(mfaState.passkeys.filter((p) => p.user_id === OTHER)).toHaveLength(1);
  });
});

// ── Security review fixes (2026-10-27) ──────────────────────────────────────

describe('a stolen verified session cannot change the sign-in methods', () => {
  it('adding a passkey or an authenticator app needs a fresh check', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    const passkey = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S1));
    expect(passkey.status).toBe(403);
    expect(passkey.body.reason).toBe('step_up_required');
    const totp = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(USER, S1));
    expect(totp.status).toBe(403);
    expect(mfaState.totp.size).toBe(0);
  });

  it('a grant for adding a passkey cannot be used to make new backup codes', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const token = await stepUp(app, key, 'factor_add', 'passkey');
    const res = await request(app).post('/auth/mfa/recovery-codes/regenerate').set('Authorization', auth(USER, S1)).set('X-Step-Up', token);
    expect(res.status).toBe(403);
  });
});

describe('lost phone: recover with a backup code', () => {
  it('signs in with a code, adds a new passkey and removes the lost one, each confirmed with a code', async () => {
    const app = await loadApp();
    const { res } = await enrolFirst(app);
    const codes: string[] = res.body.data.backupCodes;
    const lost = mfaState.passkeys[0];

    expect((await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2)).send({ recoveryCode: { code: codes[0] } })).status).toBe(200);

    const add = await request(app).post('/auth/mfa/step-up/verify').set('Authorization', auth(USER, S2))
      .send({ action: 'factor_add', targetId: 'passkey', recoveryCode: { code: codes[1] } });
    expect(add.status).toBe(200);
    const newKey = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN });
    const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S2)).set('X-Step-Up', add.body.data.stepUpToken);
    const v = await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(USER, S2))
      .send({ challengeId: o.body.data.challengeId, nickname: 'New phone', response: newKey.register(o.body.data.options.challenge) });
    expect(v.status).toBe(201);

    const rm = await request(app).post('/auth/mfa/step-up/verify').set('Authorization', auth(USER, S2))
      .send({ action: 'factor_remove', targetId: `passkey:${lost.id}`, recoveryCode: { code: codes[2] } });
    const del = await request(app).delete(`/auth/mfa/passkeys/${lost.id}`).set('Authorization', auth(USER, S2)).set('X-Step-Up', rm.body.data.stepUpToken);
    expect(del.status).toBe(200);
    expect(mfaState.passkeys.map((p) => p.nickname)).toEqual(['New phone']);
  });

  it('a backup code can never confirm a release, a transfer or a price change', async () => {
    const app = await loadApp();
    const { res } = await enrolFirst(app);
    const expected: Record<string, string> = {
      release: 'backup_code_not_allowed',
      transfer_complete: 'backup_code_not_allowed',
      price_change: 'no_passkey',
      admin_approve: 'no_passkey',
    };
    for (const [action, reason] of Object.entries(expected)) {
      const r = await request(app).post('/auth/mfa/step-up/verify').set('Authorization', auth(USER, S1))
        .send({ action, targetId: 'x', recoveryCode: { code: res.body.data.backupCodes[0] } });
      expect(r.status).toBe(400);
      expect(r.body.reason).toBe(reason);
    }
    // ...and refusing did not spend the code.
    expect(mfaState.codes.filter((c) => c.used_at)).toHaveLength(0);
  });
});

describe('lockout', () => {
  it('repeat locks grow and the owner is emailed', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    sent.length = 0;
    const guess = () => request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2)).send({ recoveryCode: { code: 'ZZZZZ-ZZZZZ' } });
    for (let i = 0; i < 5; i++) expect((await guess()).status).toBe(400);
    expect((await guess()).status).toBe(429);
    await flush();
    const first = new Date(mfaState.failures.get(USER)!.locked_until!).getTime() - Date.now();
    expect(first).toBeGreaterThan(14 * 60 * 1000);
    expect(first).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(sent.map((m) => m.subject)).toContain('Code entry on your account is paused');

    mfaState.failures.get(USER)!.locked_until = new Date(Date.now() - 1).toISOString();
    // A fresh app: the per-account rate limit (10/min, in memory) would otherwise answer 429 first.
    vi.resetModules();
    const app2 = await loadApp();
    const guess2 = () => request(app2).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2)).send({ recoveryCode: { code: 'ZZZZZ-ZZZZZ' } });
    for (let i = 0; i < 5; i++) expect((await guess2()).status).toBe(400);
    const locked = await guess2();
    expect(locked.status).toBe(429);
    expect(locked.body.reason).toBe('mfa_locked');
    const second = new Date(mfaState.failures.get(USER)!.locked_until!).getTime() - Date.now();
    expect(second).toBeGreaterThan(59 * 60 * 1000);
  });

  it('a right code resets the count and the escalation', async () => {
    const app = await loadApp();
    const { res } = await enrolFirst(app);
    const guess = () => request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2)).send({ recoveryCode: { code: 'ZZZZZ-ZZZZZ' } });
    for (let i = 0; i < 4; i++) await guess();
    expect((await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2)).send({ recoveryCode: { code: res.body.data.backupCodes[0] } })).status).toBe(200);
    expect(mfaState.failures.has(USER)).toBe(false);
  });
});

describe('browser quirks and errors', () => {
  it('accepts null authenticatorAttachment and userHandle, and extra response fields', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const o = await request(app).post('/auth/mfa/sign-in/options').set('Authorization', auth(USER, S2));
    const response = key.assert(o.body.data.options.challenge) as Record<string, unknown> & { response: Record<string, unknown> };
    response.authenticatorAttachment = null;
    response.response.userHandle = null;
    response.response.someExtensionField = 'x';
    const res = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2))
      .send({ passkey: { challengeId: o.body.data.challengeId, response } });
    expect(res.status).toBe(200);
  });

  it('adding a passkey that is already registered says so (409, not 503)', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const token = await stepUp(app, key, 'factor_add', 'passkey');
    const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S1)).set('X-Step-Up', token);
    // Re-register the same credential (excludeCredentials normally stops the browser doing this).
    const res = await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(USER, S1))
      .send({ challengeId: o.body.data.challengeId, nickname: 'Again', response: key.register(o.body.data.options.challenge) });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('already_set_up');
  });

  it('super_admin factor changes also alert the break-glass inbox', async () => {
    const app = await loadApp();
    await enrolFirst(app, ROOT, S1);
    await flush();
    expect(sent.some((m) => m.to === 'boss@example.com' && m.subject === 'A new sign-in method was added to your account')).toBe(true);
  });
});

// ── Redaction ───────────────────────────────────────────────────────────────

describe('security events', () => {
  it('never carry codes, credential ids, public keys or nicknames', async () => {
    const app = await loadApp();
    const { key, res } = await enrolFirst(app);
    await signInWithPasskey(app, key);
    await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2))
      .send({ recoveryCode: { code: res.body.data.backupCodes[0] } });
    const blob = events.blob();
    expect(blob).not.toContain(res.body.data.backupCodes[0]);
    expect(blob).not.toContain(key.id);
    expect(blob).not.toContain(mfaState.passkeys[0].public_key);
    expect(blob).not.toContain('My phone');
    expect(events.named('security.event_invalid')).toHaveLength(0);
  });
});
