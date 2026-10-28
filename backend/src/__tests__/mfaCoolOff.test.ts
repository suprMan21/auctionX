import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response } from 'express';
import { randomBytes } from 'crypto';
import { bearerWith, createMfaFakeState, createMfaStoreFake, type MfaFakeState } from './helpers/mfaStoreFake';
import { SoftPasskey } from './helpers/softAuthenticator';
import { spyOnSecurityEvents, type SecurityEventSpy } from './helpers/securityEvents';
import { hotp, totpStep } from '../lib/mfa/totp';

/**
 * S-2FA review M1 (Boss, 2026-10-27): a sign-in method added with a step-up
 * that a CODE confirmed (authenticator or backup code) waits 24 hours before it
 * can confirm any step-up. It may still sign in. The owner is emailed at once.
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
const DAY = 24 * 60 * 60 * 1000;

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
  const { requireAuth } = await import('../middleware/auth');
  const { requireSecondFactor, requireStepUp } = await import('../middleware/mfaGates');
  const app = express();
  app.use(express.json());
  app.use('/auth/mfa', mfaRoutes);
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
  return { key, backupCodes: v.body.data.backupCodes as string[], res: v };
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

const codeStepUp = (app: App, user: string, action: string, targetId: string, body: Record<string, unknown>, session = S1) =>
  request(app).post('/auth/mfa/step-up/verify').set('Authorization', auth(user, session)).send({ action, targetId, ...body });

/** Registers a new passkey with an already-spent-able factor_add token. */
const registerWith = async (app: App, token: string, nickname: string, user = USER, session = S1) => {
  const key = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN });
  const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(user, session)).set('X-Step-Up', token);
  expect(o.status).toBe(200);
  const v = await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(user, session))
    .send({ challengeId: o.body.data.challengeId, nickname, response: key.register(o.body.data.options.challenge) });
  expect(v.status).toBe(201);
  return { key, res: v };
};

/** First passkey, then an authenticator app added with a passkey step-up (no wait). */
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

/** Adds a passkey with a factor_add step-up confirmed by the authenticator app (so it waits). */
const addPasskeyWithTotp = async (app: App, secret: string, nickname = 'Attacker', user = USER) => {
  const grant = await codeStepUp(app, user, 'factor_add', 'passkey', { totp: { code: codeFor(secret) } });
  expect(grant.status).toBe(200);
  return registerWith(app, grant.body.data.stepUpToken, nickname, user);
};

const expectNear = (iso: string | null | undefined, target: number, slackMs = 60_000) => {
  expect(iso).toBeTruthy();
  expect(Math.abs(Date.parse(iso as string) - target)).toBeLessThan(slackMs);
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
  vi.useRealTimers();
  for (const k of ['FEATURE_REQUIRE_2FA', 'FEATURE_REQUIRE_STEP_UP']) delete process.env[k];
});

// ── Adding ──────────────────────────────────────────────────────────────────

describe('a method added with a code waits 24 hours', () => {
  it('passkey added with an authenticator-confirmed step-up: usable_from ≈ now + 24 h, shown in status and the email', async () => {
    const app = await loadApp();
    const { secret } = await enrolPasskeyAndApp(app);
    sent.length = 0;
    const before = Date.now();
    const { res } = await addPasskeyWithTotp(app, secret);
    const added = mfaState.passkeys.find((p) => p.nickname === 'Attacker')!;
    expectNear(added.usable_from, before + DAY);
    expectNear(res.body.data.passkey.usableFrom, before + DAY);
    expect(mfaState.challenges.find((c) => c.purpose === 'register' && c.code_confirmed)).toBeTruthy();

    const s = await request(app).get('/auth/mfa/status').set('Authorization', auth(USER, S1));
    const byName = Object.fromEntries(s.body.data.passkeys.map((p: { nickname: string; usableFrom: string | null }) => [p.nickname, p.usableFrom]));
    expect(byName['My phone']).toBeNull();
    expectNear(byName.Attacker, before + DAY);
    expect(s.body.data.authenticatorAppUsableFrom).toBeNull();

    await flush();
    const mail = sent.find((m) => m.subject === 'A new sign-in method was added to your account');
    expect(mail?.text).toContain("Because it was confirmed with a code rather than a passkey, it can't approve releases, transfers or account changes until");
    expect(mail?.text).toContain('UTC');
    expect(mail?.text).toContain("If this wasn't you, sign in and remove it now");
  });

  it('passkey added with a backup-code-confirmed step-up also waits', async () => {
    const app = await loadApp();
    const { backupCodes } = await enrolFirst(app);
    const grant = await codeStepUp(app, USER, 'factor_add', 'passkey', { recoveryCode: { code: backupCodes[0] } });
    expect(grant.status).toBe(200);
    await registerWith(app, grant.body.data.stepUpToken, 'New phone');
    expectNear(mfaState.passkeys.find((p) => p.nickname === 'New phone')!.usable_from, Date.now() + DAY);
  });

  it('passkey added with a passkey-confirmed step-up does not wait, and the email has no wait line', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    sent.length = 0;
    const token = await stepUp(app, key, 'factor_add', 'passkey');
    const { res } = await registerWith(app, token, 'Laptop');
    expect(mfaState.passkeys.find((p) => p.nickname === 'Laptop')!.usable_from).toBeNull();
    expect(res.body.data.passkey.usableFrom).toBeNull();
    await flush();
    const mail = sent.find((m) => m.subject === 'A new sign-in method was added to your account');
    expect(mail?.text).not.toContain('Because it was confirmed with a code');
  });

  it('the first factor never waits', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    expect(mfaState.passkeys[0].usable_from).toBeNull();
    expect(mfaState.challenges.every((c) => !c.code_confirmed)).toBe(true);
  });

  it('a grant with no recorded method (issued before the migration) counts as a code', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const token = await stepUp(app, key, 'factor_add', 'passkey');
    mfaState.grants.at(-1)!.method = null;
    await registerWith(app, token, 'Legacy');
    expect(mfaState.passkeys.find((p) => p.nickname === 'Legacy')!.usable_from).not.toBeNull();
  });

  it('every grant records how it was confirmed', async () => {
    const app = await loadApp();
    const { key, secret, backupCodes } = await enrolPasskeyAndApp(app);
    await stepUp(app, key, 'factor_remove', 'totp');
    expect((await codeStepUp(app, USER, 'factor_add', 'passkey', { totp: { code: codeFor(secret, 1) } })).status).toBe(200);
    expect((await codeStepUp(app, USER, 'recovery_regen', 'recovery_codes', { recoveryCode: { code: backupCodes[0] } })).status).toBe(200);
    expect(mfaState.grants.slice(-3).map((g) => g.method)).toEqual(['passkey', 'totp', 'recovery_code']);
  });

  it('a staff add that waits is audited with coolOff, still no ids or secrets', async () => {
    mfaState.staff.set(ADMIN, 'admin');
    const app = await loadApp();
    const { secret } = await enrolPasskeyAndApp(app, ADMIN);
    const { key } = await addPasskeyWithTotp(app, secret, 'Attacker', ADMIN);
    const row = mfaState.audits.at(-1)!;
    expect(row).toMatchObject({ action: 'mfa_factor_add', method: 'passkey', coolOff: true });
    expect(mfaState.audits[0].coolOff).toBeUndefined();
    expect(JSON.stringify(mfaState.audits)).not.toContain(key.id);
  });

  it('super_admin: a hardware key added with a backup code waits; the alert inbox gets the wait line too', async () => {
    const app = await loadApp();
    const { backupCodes } = await enrolFirst(app, ROOT);
    sent.length = 0;
    const grant = await codeStepUp(app, ROOT, 'factor_add', 'passkey', { recoveryCode: { code: backupCodes[0] } });
    expect(grant.status).toBe(200);
    await registerWith(app, grant.body.data.stepUpToken, 'Key B', ROOT);
    expect(mfaState.passkeys.find((p) => p.nickname === 'Key B')!.usable_from).not.toBeNull();
    await flush();
    const added = sent.filter((m) => m.subject === 'A new sign-in method was added to your account');
    expect(added.map((m) => m.to).sort()).toEqual(['boss@example.com', 'root@example.com']);
    expect(added.every((m) => m.text?.includes('Because it was confirmed with a code'))).toBe(true);
  });
});

// ── Enforcement: passkeys ───────────────────────────────────────────────────

describe('a waiting passkey may sign in but not confirm a step-up', () => {
  it('signs in; step-up options leave it out; with no other passkey they refuse new_method_waiting', async () => {
    const app = await loadApp();
    const { key: original, secret, backupCodes } = await enrolPasskeyAndApp(app);
    const { key: fresh } = await addPasskeyWithTotp(app, secret);

    // Sign-in on another session works with the waiting passkey.
    const so = await request(app).post('/auth/mfa/sign-in/options').set('Authorization', auth(USER, S2));
    expect(so.body.data.options.allowCredentials.map((c: { id: string }) => c.id)).toContain(fresh.id);
    const si = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2))
      .send({ passkey: { challengeId: so.body.data.challengeId, response: fresh.assert(so.body.data.options.challenge) } });
    expect(si.status).toBe(200);

    // Step-up options offer only the original.
    const o = await request(app).post('/auth/mfa/step-up/options').set('Authorization', auth(USER, S2)).send({ action: 'release', targetId: 'tag-a' });
    expect(o.status).toBe(200);
    expect(o.body.data.options.allowCredentials.map((c: { id: string }) => c.id)).toEqual([original.id]);

    // Remove the original (backup codes may confirm a removal), then nothing usable is left.
    const originalRow = mfaState.passkeys.find((p) => p.nickname === 'My phone')!;
    const rm = await codeStepUp(app, USER, 'factor_remove', `passkey:${originalRow.id}`, { recoveryCode: { code: backupCodes[0] } }, S2);
    expect(rm.status).toBe(200);
    expect((await request(app).delete(`/auth/mfa/passkeys/${originalRow.id}`).set('Authorization', auth(USER, S2)).set('X-Step-Up', rm.body.data.stepUpToken)).status).toBe(200);

    const none = await request(app).post('/auth/mfa/step-up/options').set('Authorization', auth(USER, S2)).send({ action: 'release', targetId: 'tag-a' });
    expect(none.status).toBe(403);
    expect(none.body.reason).toBe('new_method_waiting');
  });

  it('a waiting passkey asserting against a step-up challenge is refused, no grant issued, its counter still recorded', async () => {
    const app = await loadApp();
    const { secret } = await enrolPasskeyAndApp(app);
    const { key: fresh } = await addPasskeyWithTotp(app, secret);
    const grantsBefore = mfaState.grants.length;
    const freshRow = mfaState.passkeys.find((p) => p.nickname === 'Attacker')!;

    const o = await request(app).post('/auth/mfa/step-up/options').set('Authorization', auth(USER, S1)).send({ action: 'price_change', targetId: 'p1' });
    const v = await request(app).post('/auth/mfa/step-up/verify').set('Authorization', auth(USER, S1))
      .send({ challengeId: o.body.data.challengeId, response: fresh.assert(o.body.data.options.challenge) });
    expect(v.status).toBe(403);
    expect(v.body.reason).toBe('new_method_waiting');
    expect(mfaState.grants.length).toBe(grantsBefore);
    expect(freshRow.last_used_at).not.toBeNull();
    // The challenge is spent: it cannot be retried.
    expect(mfaState.challenges.find((c) => c.id === o.body.data.challengeId)!.used_at).not.toBeNull();
  });

  it('after 24 hours it confirms step-ups like any other passkey', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
    const app = await loadApp();
    const { secret } = await enrolPasskeyAndApp(app);
    const { key: fresh } = await addPasskeyWithTotp(app, secret);

    vi.setSystemTime(new Date('2026-10-28T12:01:00Z'));
    // The 12-hour marker has run out too: sign in again with the new passkey.
    const so = await request(app).post('/auth/mfa/sign-in/options').set('Authorization', auth(USER, S1));
    const si = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S1))
      .send({ passkey: { challengeId: so.body.data.challengeId, response: fresh.assert(so.body.data.options.challenge) } });
    expect(si.status).toBe(200);

    const o = await request(app).post('/auth/mfa/step-up/options').set('Authorization', auth(USER, S1)).send({ action: 'release', targetId: 'tag-a' });
    expect(o.body.data.options.allowCredentials.map((c: { id: string }) => c.id)).toContain(fresh.id);
    const token = await stepUp(app, fresh, 'release', 'tag-a');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const s = await request(app).get('/auth/mfa/status').set('Authorization', auth(USER, S1));
    expect(s.body.data.passkeys.every((p: { usableFrom: string | null }) => p.usableFrom === null)).toBe(true);
  });
});

// ── Enforcement: authenticator app ──────────────────────────────────────────

describe('a waiting authenticator app may sign in but not confirm a step-up', () => {
  it('set up with a backup-code grant: waits; release step-up refused before the code is checked', async () => {
    process.env.FEATURE_REQUIRE_2FA = 'true';
    process.env.FEATURE_REQUIRE_STEP_UP = 'true';
    const app = await loadApp();
    const { backupCodes } = await enrolFirst(app);
    const grant = await codeStepUp(app, USER, 'factor_add', 'totp', { recoveryCode: { code: backupCodes[0] } });
    expect(grant.status).toBe(200);
    sent.length = 0;
    const before = Date.now();
    const setup = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(USER, S1)).set('X-Step-Up', grant.body.data.stepUpToken);
    expect(setup.status).toBe(200);
    const confirm = await request(app).post('/auth/mfa/totp/confirm').set('Authorization', auth(USER, S1))
      .send({ code: codeFor(setup.body.data.secret, -1) });
    expect(confirm.status).toBe(200);
    expectNear(mfaState.totp.get(USER)!.usable_from, before + DAY);
    expectNear(confirm.body.data.authenticatorAppUsableFrom, before + DAY);

    const s = await request(app).get('/auth/mfa/status').set('Authorization', auth(USER, S1));
    expectNear(s.body.data.authenticatorAppUsableFrom, before + DAY);

    await flush();
    const mail = sent.find((m) => m.subject === 'A new sign-in method was added to your account');
    expect(mail?.text).toContain('An authenticator app can now be used to sign in');
    expect(mail?.text).toContain('Because it was confirmed with a code rather than a passkey');

    // Signs in fine on another session.
    const si = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S2))
      .send({ totp: { code: codeFor(setup.body.data.secret) } });
    expect(si.status).toBe(200);

    // A release step-up with it is refused, and neither the code nor the attempt counter is touched.
    const stepBefore = mfaState.totp.get(USER)!.last_used_step;
    const failuresBefore = JSON.stringify(mfaState.failures.get(USER) ?? null);
    const r = await codeStepUp(app, USER, 'release', 'tag-a', { totp: { code: codeFor(setup.body.data.secret, 1) } });
    expect(r.status).toBe(403);
    expect(r.body.reason).toBe('new_method_waiting');
    expect(mfaState.totp.get(USER)!.last_used_step).toBe(stepBefore);
    expect(JSON.stringify(mfaState.failures.get(USER) ?? null)).toBe(failuresBefore);

    // Nor may it confirm removing another method.
    const rm = await codeStepUp(app, USER, 'factor_remove', `passkey:${mfaState.passkeys[0].id}`, { totp: { code: codeFor(setup.body.data.secret, 1) } });
    expect(rm.status).toBe(403);
    expect(rm.body.reason).toBe('new_method_waiting');

    // Backup codes are not "added" methods: still fine for a method change.
    expect((await codeStepUp(app, USER, 'factor_remove', 'totp', { recoveryCode: { code: backupCodes[1] } })).status).toBe(200);
  });

  it('set up with a passkey grant: no wait', async () => {
    const app = await loadApp();
    await enrolPasskeyAndApp(app);
    expect(mfaState.totp.get(USER)!.usable_from).toBeNull();
  });

  it('after 24 hours the app confirms a release', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
    const app = await loadApp();
    const { backupCodes } = await enrolFirst(app);
    const grant = await codeStepUp(app, USER, 'factor_add', 'totp', { recoveryCode: { code: backupCodes[0] } });
    const setup = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(USER, S1)).set('X-Step-Up', grant.body.data.stepUpToken);
    await request(app).post('/auth/mfa/totp/confirm').set('Authorization', auth(USER, S1)).send({ code: codeFor(setup.body.data.secret, -1) });

    vi.setSystemTime(new Date('2026-10-28T12:01:00Z'));
    expect((await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(USER, S1))
      .send({ totp: { code: codeFor(setup.body.data.secret) } })).status).toBe(200);
    vi.setSystemTime(new Date('2026-10-28T12:01:31Z'));
    const r = await codeStepUp(app, USER, 'release', 'tag-a', { totp: { code: codeFor(setup.body.data.secret) } });
    expect(r.status).toBe(200);
  });
});

// ── Email copy ──────────────────────────────────────────────────────────────

describe('factor_added email', () => {
  it('adds the wait line with the time in UTC, escaped like the rest', async () => {
    const { mfaEmailContent, formatUtc } = await import('../lib/mfa/mfaEmails');
    expect(formatUtc('2026-10-28T14:05:09.000Z')).toBe('28 October 2026, 14:05 UTC');
    expect(formatUtc('nonsense')).toBeNull();
    const withWait = mfaEmailContent({ kind: 'factor_added', method: 'passkey', nickname: 'Key', waitUntil: '2026-10-28T14:05:09.000Z' });
    expect(withWait.lines[1]).toBe(
      "Because it was confirmed with a code rather than a passkey, it can't approve releases, transfers or account changes until 28 October 2026, 14:05 UTC.",
    );
    expect(withWait.lines[2]).toBe("If this wasn't you, sign in and remove it now, then change your password.");
    const plain = mfaEmailContent({ kind: 'factor_added', method: 'passkey' });
    expect(plain.lines).toHaveLength(2);
    // Unreadable time: no wait line rather than "until null".
    expect(mfaEmailContent({ kind: 'factor_added', method: 'totp', waitUntil: 'x' }).lines).toHaveLength(2);
  });

  it('the HTML body escapes the wait line', async () => {
    const app = await loadApp();
    const { secret } = await enrolPasskeyAndApp(app);
    sent.length = 0;
    await addPasskeyWithTotp(app, secret, "Bob's key");
    await flush();
    const mail = sent.find((m) => m.subject === 'A new sign-in method was added to your account') as { html?: string } | undefined;
    expect(mail?.html).toContain('can&#39;t approve releases');
    expect(mail?.html).toContain('Bob&#39;s key');
    expect(mail?.html).not.toContain("can't approve");
  });
});
