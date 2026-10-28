import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { randomBytes } from 'crypto';
import { bearerWith, createMfaFakeState, createMfaStoreFake, type MfaFakeState } from './helpers/mfaStoreFake';
import { SoftPasskey } from './helpers/softAuthenticator';
import { testVendor, TEST_ROOT_PEM } from './helpers/attestationFixtures';
import { spyOnSecurityEvents, type SecurityEventSpy } from './helpers/securityEvents';
import { hotp, totpStep } from '../lib/mfa/totp';

/**
 * S-2FA Ph3b — email-code recovery + backup email (Boss decisions 2026-10-27):
 * 72 h hold, fresh code to finish, 7-day freeze, one method added by the
 * finishing session, old methods kept with Undo, no staff, SES only, codes
 * bound to session + browser nonce, 10 min, single use, 5 attempts.
 * Same harness as mfaAccountChange.test.ts (real P-256 passkeys, in-memory store).
 */
const RP_ID = 'am.test';
const ORIGIN = 'https://am.test';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ROOT = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EMAILS: Record<string, string> = {
  [USER]: 'user@example.com',
  [OTHER]: 'other@example.com',
  [ROOT]: 'root@example.com',
  [ADMIN]: 'staff@example.com',
};
const NONCE = 'n'.repeat(43);
const NONCE2 = 'm'.repeat(43);

let mfaState: MfaFakeState;
let events: SecurityEventSpy;
const postmark: Array<{ to: string; subject: string; text?: string }> = [];
const ses: Array<{ to: string; subject: string; text: string; html: string }> = [];
const logged: string[] = [];

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
        return sub
          ? { data: { user: { id: sub, email: EMAILS[sub], email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid' } };
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
    postmark.push(p);
    return true;
  }),
}));

const auth = (user: string, session: string) => bearerWith({ sub: user, session_id: session });

const loadApp = async () => {
  const { __setMfaStore } = await import('../lib/mfa/store');
  __setMfaStore(createMfaStoreFake(mfaState));
  (await import('../lib/mfa/hardwareKeyAttestation')).__setHardwareKeyRoots([TEST_ROOT_PEM]);
  const { __setSesSend } = await import('../lib/notifications/securityMailSender');
  __setSesSend(async (m) => {
    ses.push(m);
  });
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

const enrolFirst = async (app: App, user = USER, session = S1, opts: { fresh?: boolean } = {}) => {
  const key = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN, attestation: user === ROOT ? testVendor() : undefined });
  const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(user, session));
  expect(o.status).toBe(200);
  const v = await request(app)
    .post('/auth/mfa/passkeys/register/verify')
    .set('Authorization', auth(user, session))
    .send({ challengeId: o.body.data.challengeId, nickname: 'My phone', response: key.register(o.body.data.options.challenge) });
  expect(v.status).toBe(201);
  // The account's existing method: added well before any recovery (Ph4 7-day rule).
  if (opts.fresh !== true) mfaState.passkeys[mfaState.passkeys.length - 1].created_at = new Date(Date.now() - 30 * 86_400_000).toISOString();
  return { key, backupCodes: v.body.data.backupCodes as string[] };
};

const stepUp = async (app: App, key: SoftPasskey, action: string, targetId: string, user = USER, session = S1) => {
  const o = await request(app).post('/auth/mfa/step-up/options').set('Authorization', auth(user, session)).send({ action, targetId });
  if (o.status !== 200) return { status: o.status, body: o.body, token: null as string | null };
  const v = await request(app)
    .post('/auth/mfa/step-up/verify')
    .set('Authorization', auth(user, session))
    .send({ challengeId: o.body.data.challengeId, response: key.assert(o.body.data.options.challenge) });
  return { status: v.status, body: v.body, token: (v.body.data?.stepUpToken ?? null) as string | null };
};

const signInWithPasskey = async (app: App, key: SoftPasskey, user = USER, session = S3) => {
  const o = await request(app).post('/auth/mfa/sign-in/options').set('Authorization', auth(user, session));
  const v = await request(app).post('/auth/mfa/sign-in/verify').set('Authorization', auth(user, session))
    .send({ passkey: { challengeId: o.body.data.challengeId, response: key.assert(o.body.data.options.challenge) } });
  expect(v.status).toBe(200);
};

const post = (app: App, path: string, body: object = {}, opts: { user?: string; session?: string; nonce?: string | null } = {}) => {
  const r = request(app).post(`/auth/mfa${path}`).set('Authorization', auth(opts.user ?? USER, opts.session ?? S2));
  if (opts.nonce !== null) r.set('X-Recovery-Nonce', opts.nonce ?? NONCE);
  return r.send(body);
};

/** Only the emails that carry a code (notices go through SES too once it is configured). */
const codeMails = () => ses.filter((m) => /Your code: \d{6}/.test(m.text));

const lastCode = (): string => {
  const mails = codeMails();
  const m = /Your code: (\d{6})/.exec(mails[mails.length - 1]?.text ?? '');
  if (!m) throw new Error('no code email');
  return m[1];
};

/** Lets the next send through the 60 s cooldown. */
const ageCodes = (ms = 61_000) => {
  for (const c of mfaState.emailCodes) c.created_at = new Date(Date.parse(c.created_at) - ms).toISOString();
};

const endHold = () => {
  for (const r of mfaState.recoveries) if (r.status === 'holding') r.hold_ends_at = new Date(Date.now() - 1000).toISOString();
};

/** Passkey on S1, then a holding recovery started from password-only session S2. */
const startRecovery = async (app: App, opts: { fresh?: boolean } = {}) => {
  const first = await enrolFirst(app, USER, S1, opts);
  const send = await post(app, '/recovery/code', { channel: 'primary' });
  expect(send.status).toBe(200);
  const start = await post(app, '/recovery/start', { codeId: send.body.data.codeId, code: lastCode() });
  expect(start.status).toBe(200);
  return first;
};

/** ... then the hold ends and S2 finishes. */
const finishRecovery = async (app: App, body: object = {}, opts: { fresh?: boolean } = {}) => {
  const first = await startRecovery(app, opts);
  endHold();
  ageCodes();
  const send = await post(app, '/recovery/code', {});
  expect(send.status).toBe(200);
  expect(send.body.data.purpose).toBe('recovery_finish');
  const fin = await post(app, '/recovery/finish', { codeId: send.body.data.codeId, code: lastCode(), ...body });
  expect(fin.status).toBe(200);
  return { ...first, fin };
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
  process.env.SECURITY_MAIL_FROM = 'Authentic Materials <security@authentic-materials.com>';
  mfaState = createMfaFakeState();
  mfaState.staff.set(ROOT, 'super_admin');
  mfaState.staff.set(ADMIN, 'admin');
  postmark.length = 0;
  ses.length = 0;
  logged.length = 0;
  events = spyOnSecurityEvents();
  const capture = (...args: unknown[]) => {
    logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(console, 'info').mockImplementation(capture);
});

afterEach(() => {
  events.restore();
  vi.restoreAllMocks();
  delete process.env.SECURITY_MAIL_FROM;
});

// ── Codes ───────────────────────────────────────────────────────────────────

describe('recovery codes', () => {
  it('sends a 6-digit code through SES only, never in the subject, stored only as an HMAC', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    postmark.length = 0;
    const r = await post(app, '/recovery/code', { channel: 'primary' }, { nonce: NONCE });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ purpose: 'recovery_start', sentTo: 'u•••@e•••.com', codeId: expect.any(String) });
    expect(codeMails()).toHaveLength(1);
    const mail = codeMails()[0];
    expect(mail.to).toBe('user@example.com');
    const code = lastCode();
    expect(mail.subject).not.toContain(code);
    expect(mail.html).toContain(code);
    expect(postmark).toHaveLength(0);
    const row = mfaState.emailCodes[0];
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(mfaState.emailCodes)).not.toContain(code);
    expect(JSON.stringify(mfaState.emailCodes)).not.toContain(NONCE);
    // Never logged, not even in security events.
    expect(JSON.stringify(events.all())).not.toContain(code);
    expect(JSON.stringify(events.all())).not.toContain('user@example.com');
  });

  it('SES not configured: 503-style refusal, nothing stored, never falls back to Postmark', async () => {
    delete process.env.SECURITY_MAIL_FROM;
    const app = await loadApp();
    await enrolFirst(app);
    postmark.length = 0;
    const r = await post(app, '/recovery/code', { channel: 'primary' });
    expect(r.status).toBe(503);
    expect(r.body.reason).toBe('mail_unavailable');
    expect(mfaState.emailCodes).toHaveLength(0);
    expect(codeMails()).toHaveLength(0);
    expect(postmark).toHaveLength(0);
  });

  it('needs the browser nonce', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    for (const nonce of [null, 'short', 'x'.repeat(200), 'bad nonce with spaces!!!!!!!!!!!!!!!!!!!']) {
      const r = await post(app, '/recovery/code', { channel: 'primary' }, { nonce });
      expect(r.body.reason).toBe('nonce_required');
    }
    expect(mfaState.emailCodes).toHaveLength(0);
  });

  it('a code is bound to its session and its browser nonce (refused without counting an attempt)', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    const send = await post(app, '/recovery/code', { channel: 'primary' });
    const code = lastCode();
    const otherSession = await post(app, '/recovery/start', { codeId: send.body.data.codeId, code }, { session: S3 });
    expect(otherSession.body.reason).toBe('code_expired');
    const otherNonce = await post(app, '/recovery/start', { codeId: send.body.data.codeId, code }, { nonce: NONCE2 });
    expect(otherNonce.body.reason).toBe('code_expired');
    expect(mfaState.emailCodes[0].attempts).toBe(0);
    const ok = await post(app, '/recovery/start', { codeId: send.body.data.codeId, code });
    expect(ok.status).toBe(200);
  });

  it('single use, 5 attempts, 10-minute expiry, a new send voids the old code', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    const s1 = await post(app, '/recovery/code', { channel: 'primary' });
    const c1 = lastCode();
    const wrong = c1 === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) expect((await post(app, '/recovery/start', { codeId: s1.body.data.codeId, code: wrong })).body.reason).toBe('invalid_code');
    expect((await post(app, '/recovery/start', { codeId: s1.body.data.codeId, code: wrong })).body.reason).toBe('code_locked');
    expect((await post(app, '/recovery/start', { codeId: s1.body.data.codeId, code: c1 })).body.reason).toBe('code_locked');

    ageCodes();
    const s2 = await post(app, '/recovery/code', { channel: 'primary' });
    const c2 = lastCode();
    ageCodes();
    const s3 = await post(app, '/recovery/code', { channel: 'primary' });
    // s2 voided by s3.
    expect((await post(app, '/recovery/start', { codeId: s2.body.data.codeId, code: c2 })).body.reason).toBe('code_expired');
    // Expired.
    mfaState.emailCodes.find((c) => c.id === s3.body.data.codeId)!.expires_at = new Date(Date.now() - 1).toISOString();
    expect((await post(app, '/recovery/start', { codeId: s3.body.data.codeId, code: lastCode() })).body.reason).toBe('code_expired');
  });

  it('send limits: 60 s cooldown, 3 an hour', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    expect((await post(app, '/recovery/code', { channel: 'primary' })).status).toBe(200);
    const again = await post(app, '/recovery/code', { channel: 'primary' });
    expect(again.status).toBe(429);
    expect(again.body.reason).toBe('code_send_limit');
    ageCodes();
    expect((await post(app, '/recovery/code', { channel: 'primary' })).status).toBe(200);
    ageCodes();
    expect((await post(app, '/recovery/code', { channel: 'primary' })).status).toBe(200);
    ageCodes();
    const fourth = await post(app, '/recovery/code', { channel: 'primary' });
    expect(fourth.body.reason).toBe('code_send_limit');
    expect(fourth.body.error).toMatch(/hour/);
    expect(codeMails()).toHaveLength(3);
  });
});

// ── Who may recover ─────────────────────────────────────────────────────────

describe('who may start a recovery', () => {
  it('never a staff account (super_admin or admin)', async () => {
    const app = await loadApp();
    for (const staff of [ROOT, ADMIN]) {
      await enrolFirst(app, staff);
      const r = await post(app, '/recovery/code', { channel: 'primary' }, { user: staff });
      expect(r.body.reason).toBe('recovery_not_available');
      const ov = await request(app).get('/auth/mfa/recovery').set('Authorization', auth(staff, S2));
      expect(ov.body.data).toMatchObject({ available: false, notAvailableReason: 'staff' });
    }
    expect(codeMails()).toHaveLength(0);
  });

  it('not without a passkey or authenticator app, and not from a session that already passed', async () => {
    const app = await loadApp();
    expect((await post(app, '/recovery/code', { channel: 'primary' })).body.reason).toBe('recovery_not_available');
    await enrolFirst(app);
    // S1 enrolled, so it is verified.
    expect((await post(app, '/recovery/code', { channel: 'primary' }, { session: S1 })).body.reason).toBe('recovery_not_available');
  });

  it('the backup channel needs a confirmed backup email', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    mfaState.backupEmails.set(USER, { email: 'backup@example.org', verified_at: null });
    expect((await post(app, '/recovery/code', { channel: 'backup' })).body.reason).toBe('recovery_not_available');
    mfaState.backupEmails.set(USER, { email: 'backup@example.org', verified_at: new Date().toISOString() });
    const r = await post(app, '/recovery/code', { channel: 'backup' });
    expect(r.status).toBe(200);
    expect(codeMails()[0].to).toBe('backup@example.org');
  });
});

// ── Hold, cancel, finish ────────────────────────────────────────────────────

describe('hold → finish', () => {
  it('starting holds 72 h and tells every channel (no code in the notice)', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    mfaState.backupEmails.set(USER, { email: 'backup@example.org', verified_at: new Date().toISOString() });
    const send = await post(app, '/recovery/code', { channel: 'primary' });
    const code = lastCode();
    const before = Date.now();
    const r = await post(app, '/recovery/start', { codeId: send.body.data.codeId, code }, );
    expect(r.status).toBe(200);
    const hold = Date.parse(r.body.data.holdEndsAt) - before;
    expect(hold).toBeGreaterThan(72 * 3600_000 - 5000);
    expect(hold).toBeLessThan(72 * 3600_000 + 5000);
    await flush();
    const notices = ses.filter((m) => /started recovering/.test(m.subject));
    expect(notices.map((m) => m.to).sort()).toEqual(['backup@example.org', 'user@example.com']);
    for (const n of notices) expect(n.text).not.toContain(code);
    // Still not signed in: the session got nothing.
    const status = await request(app).get('/auth/mfa/status').set('Authorization', auth(USER, S2));
    expect(status.body.data.sessionVerified).toBe(false);
    expect(status.body.data.recovery).toMatchObject({ status: 'holding', freezeEndsAt: null });
  });

  it('cannot finish before the hold ends; a second recovery cannot start while one waits', async () => {
    const app = await loadApp();
    await startRecovery(app);
    ageCodes();
    const r = await post(app, '/recovery/code', {});
    expect(r.body.reason).toBe('recovery_waiting');
    const fin = await post(app, '/recovery/finish', { codeId: '00000000-0000-4000-8000-000000000000', code: '123456' });
    expect(fin.body.reason).toBe('recovery_waiting');
  });

  it('any session that passed an existing method can cancel; the starter cannot', async () => {
    const app = await loadApp();
    await startRecovery(app);
    const starter = await post(app, '/recovery/cancel', {}, { nonce: null });
    expect(starter.body.reason).toBe('second_factor_required');
    const owner = await post(app, '/recovery/cancel', {}, { session: S1, nonce: null });
    expect(owner.status).toBe(200);
    expect(mfaState.recoveries[0].status).toBe('cancelled');
    endHold();
    ageCodes();
    // Nothing left to finish: the next send starts a new recovery instead.
    const send = await post(app, '/recovery/code', { channel: 'primary' });
    expect(send.body.data.purpose).toBe('recovery_start');
  });

  it('Ph4: a method added less than 7 days before the recovery cannot cancel it (password thief adds the first method)', async () => {
    const app = await loadApp();
    await startRecovery(app, { fresh: true });
    const thief = await post(app, '/recovery/cancel', {}, { session: S1, nonce: null });
    expect(thief.status).toBe(403);
    expect(thief.body.reason).toBe('recovery_method_not_allowed');
    expect(mfaState.recoveries[0].status).toBe('holding');
  });

  it('Ph4: a method added exactly 7 days before still cancels; 6 days does not', async () => {
    const app = await loadApp();
    await startRecovery(app, { fresh: true });
    const started = Date.parse(mfaState.recoveries[0].created_at);
    mfaState.passkeys[0].created_at = new Date(started - 6 * 86_400_000).toISOString();
    expect((await post(app, '/recovery/cancel', {}, { session: S1, nonce: null })).status).toBe(403);
    mfaState.passkeys[0].created_at = new Date(started - 7 * 86_400_000).toISOString();
    expect((await post(app, '/recovery/cancel', {}, { session: S1, nonce: null })).status).toBe(200);
  });

  it('finish: fresh code, old backup codes void, session verified briefly, 7-day freeze, notice', async () => {
    const app = await loadApp();
    const { fin, backupCodes } = await finishRecovery(app);
    expect(backupCodes).toHaveLength(10);
    expect(mfaState.codes.filter((c) => c.user_id === USER)).toHaveLength(0);
    const freeze = Date.parse(fin.body.data.freezeEndsAt) - Date.now();
    expect(freeze).toBeGreaterThan(7 * 86_400_000 - 10_000);
    expect(mfaState.sessions.get(S2)).toMatchObject({ method: 'email_recovery' });
    expect(fin.body.data.passwordPermitExpiresAt).toBeNull();
    expect(mfaState.permits).toHaveLength(0);
    await flush();
    expect(ses.some((m) => /was recovered/.test(m.subject))).toBe(true);
    const status = await request(app).get('/auth/mfa/status').set('Authorization', auth(USER, S2));
    expect(status.body.data.recovery).toMatchObject({ status: 'completed', mustAddMethod: true, canUndo: false });
  });

  it('finish may issue one password permit (the Ph2b lock would refuse the change otherwise)', async () => {
    const app = await loadApp();
    const { fin } = await finishRecovery(app, { setPassword: true });
    expect(fin.body.data.passwordPermitExpiresAt).toEqual(expect.any(String));
    expect(mfaState.permits).toEqual([expect.objectContaining({ user_id: USER, kind: 'password' })]);
  });

  it('the finish code must come from the finishing session (a code read from the inbox is not enough)', async () => {
    const app = await loadApp();
    await startRecovery(app);
    endHold();
    ageCodes();
    const send = await post(app, '/recovery/code', {});
    const r = await post(app, '/recovery/finish', { codeId: send.body.data.codeId, code: lastCode() }, { session: S3 });
    expect(r.body.reason).toBe('code_expired');
    expect(mfaState.recoveries[0].status).toBe('holding');
  });
});

// ── The one method after a recovery ─────────────────────────────────────────

describe('adding a method after recovery', () => {
  it('the finishing session adds ONE passkey without a step-up and gets new backup codes', async () => {
    const app = await loadApp();
    await finishRecovery(app);
    const key = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN });
    const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S2));
    expect(o.status).toBe(200);
    const v = await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(USER, S2))
      .send({ challengeId: o.body.data.challengeId, nickname: 'New phone', response: key.register(o.body.data.options.challenge) });
    expect(v.status).toBe(201);
    expect(v.body.data.backupCodes).toHaveLength(10);
    const recId = mfaState.recoveries[0].id;
    expect(mfaState.passkeys.find((p) => p.nickname === 'New phone')?.added_by_recovery).toBe(recId);
    expect(mfaState.sessions.get(S2)?.method).toBe('passkey');
    // A second add is a normal add: frozen.
    const again = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S2));
    expect(again.body.reason).toBe('recovery_freeze');
  });

  it('another session cannot use the recovery add', async () => {
    const app = await loadApp();
    await finishRecovery(app);
    // S1 (owner, verified) tries a plain add: frozen.
    const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S1));
    expect(o.body.reason).toBe('recovery_freeze');
  });

  it('an authenticator app works when the account has none; the 30-minute window closes', async () => {
    const app = await loadApp();
    await finishRecovery(app);
    const setup = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(USER, S2));
    expect(setup.status).toBe(200);
    const bad = await request(app).post('/auth/mfa/totp/confirm').set('Authorization', auth(USER, S2)).send({ code: '000000' });
    expect(bad.body.reason).toBe('invalid_code');
    // A wrong code gives the enrolment back.
    expect(mfaState.recoveries[0].enrolled_at).toBeNull();
    const ok = await request(app).post('/auth/mfa/totp/confirm').set('Authorization', auth(USER, S2))
      .send({ code: codeFor(setup.body.data.secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.data.backupCodes).toHaveLength(10);
    expect(mfaState.totp.get(USER)?.added_by_recovery).toBe(mfaState.recoveries[0].id);
  });

  it('after the window, no add', async () => {
    const app = await loadApp();
    await finishRecovery(app);
    mfaState.recoveries[0].enrol_until = new Date(Date.now() - 1000).toISOString();
    const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S2));
    expect(o.status).not.toBe(200);
  });
});

// ── Freeze + undo ───────────────────────────────────────────────────────────

describe('freeze and undo', () => {
  it('the freeze refuses step-ups for frozen actions before any code is checked, and the code routes', async () => {
    const app = await loadApp();
    const { key } = await finishRecovery(app);
    await signInWithPasskey(app, key);
    for (const action of ['release', 'transfer_complete', 'factor_add', 'factor_remove', 'recovery_regen', 'account_change', 'recovery_channel']) {
      const o = await request(app).post('/auth/mfa/step-up/options').set('Authorization', auth(USER, S3)).send({ action, targetId: 'x' });
      expect(o.body.reason, action).toBe('recovery_freeze');
    }
    const regen = await request(app).post('/auth/mfa/recovery-codes/regenerate').set('Authorization', auth(USER, S3));
    expect(regen.body.reason).toBe('recovery_freeze');
    const change = await request(app).post('/auth/mfa/account-change').set('Authorization', auth(USER, S3)).send({ kind: 'password' });
    expect(change.body.reason).toBe('recovery_freeze');
    // A new recovery cannot start during the freeze.
    expect(events.named('auth.mfa').some((e) => e.action === 'recovery_freeze_block')).toBe(true);
  });

  it('Ph4: a method added less than 7 days before the recovery cannot undo it', async () => {
    const app = await loadApp();
    const { key } = await finishRecovery(app, {}, { fresh: true });
    const recId = mfaState.recoveries[0].id;
    await signInWithPasskey(app, key);
    const su = await stepUp(app, key, 'recovery_undo', recId, USER, S3);
    expect(su.status).toBe(403);
    expect(su.body.reason).toBe('recovery_method_not_allowed');
    expect(mfaState.recoveries[0].status).toBe('completed');
  });

  it('undo with an OLD passkey removes the added method, ends other sessions, gives the owner new codes', async () => {
    const app = await loadApp();
    const { key } = await finishRecovery(app);
    // Attacker (S2) adds a passkey.
    const evil = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN });
    const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S2));
    await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(USER, S2))
      .send({ challengeId: o.body.data.challengeId, nickname: 'Evil', response: evil.register(o.body.data.options.challenge) });
    const recId = mfaState.recoveries[0].id;

    // The recovery-added passkey cannot confirm the undo.
    const s2Undo = await stepUp(app, evil, 'recovery_undo', recId, USER, S2);
    expect(s2Undo.body.reason).toBe('recovery_method_not_allowed');

    // Owner signs in with the old passkey and undoes.
    await signInWithPasskey(app, key);
    const status = await request(app).get('/auth/mfa/status').set('Authorization', auth(USER, S3));
    expect(status.body.data.recovery).toMatchObject({ canUndo: true, id: recId });
    const su = await stepUp(app, key, 'recovery_undo', recId, USER, S3);
    expect(su.status).toBe(200);
    const u = await request(app).post('/auth/mfa/recovery/undo').set('Authorization', auth(USER, S3))
      .set('X-Step-Up', su.token as string).send({ recoveryId: recId });
    expect(u.status).toBe(200);
    expect(u.body.data.backupCodes).toHaveLength(10);
    expect(mfaState.passkeys.some((p) => p.nickname === 'Evil')).toBe(false);
    expect(mfaState.passkeys.some((p) => p.nickname === 'My phone')).toBe(true);
    expect(mfaState.recoveries[0].status).toBe('undone');
    expect(mfaState.endedSessions.at(-1)).toEqual({ userId: USER, keep: S3 });
    expect(mfaState.sessions.has(S2)).toBe(false);
    // Freeze over with it.
    const after = await request(app).get('/auth/mfa/status').set('Authorization', auth(USER, S3));
    expect(after.body.data.recovery).toBeNull();
  });

  it('undo refuses a backup code and a recovery-added authenticator app', async () => {
    const app = await loadApp();
    await finishRecovery(app);
    const setup = await request(app).post('/auth/mfa/totp/setup').set('Authorization', auth(USER, S2));
    await request(app).post('/auth/mfa/totp/confirm').set('Authorization', auth(USER, S2)).send({ code: codeFor(setup.body.data.secret) });
    const recId = mfaState.recoveries[0].id;
    const viaTotp = await request(app).post('/auth/mfa/step-up/verify').set('Authorization', auth(USER, S2))
      .send({ action: 'recovery_undo', targetId: recId, totp: { code: codeFor(setup.body.data.secret, 1) } });
    expect(viaTotp.body.reason).toBe('recovery_method_not_allowed');
    const viaCode = await request(app).post('/auth/mfa/step-up/verify').set('Authorization', auth(USER, S2))
      .send({ action: 'recovery_undo', targetId: recId, recoveryCode: { code: 'AAAAA-BBBBB' } });
    expect(viaCode.body.reason).toBe('backup_code_not_allowed');
  });

  it('undo without a step-up is refused', async () => {
    const app = await loadApp();
    const { key } = await finishRecovery(app);
    await signInWithPasskey(app, key);
    const u = await request(app).post('/auth/mfa/recovery/undo').set('Authorization', auth(USER, S3))
      .send({ recoveryId: mfaState.recoveries[0].id });
    expect(u.body.reason).toBe('step_up_required');
    expect(mfaState.recoveries[0].status).toBe('completed');
  });
});

// ── Security review fixes (2026-10-27) ──────────────────────────────────────

describe('review fixes', () => {
  it('L1: the add after a recovery does not sign out the owner', async () => {
    const app = await loadApp();
    const { key } = await finishRecovery(app);
    await signInWithPasskey(app, key);
    const ended = mfaState.endedSessions.length;
    const k = new SoftPasskey({ rpId: RP_ID, origin: ORIGIN });
    const o = await request(app).post('/auth/mfa/passkeys/register/options').set('Authorization', auth(USER, S2));
    const v = await request(app).post('/auth/mfa/passkeys/register/verify').set('Authorization', auth(USER, S2))
      .send({ challengeId: o.body.data.challengeId, nickname: 'New', response: k.register(o.body.data.options.challenge) });
    expect(v.body.data.otherSessionsEnded).toBe(false);
    expect(mfaState.endedSessions).toHaveLength(ended);
    expect(mfaState.sessions.has(S3)).toBe(true);
  });

  it('M1: undo ends every other session in the same step (incl. sessions marked by a recovery-added method)', async () => {
    const app = await loadApp();
    const { key } = await finishRecovery(app);
    mfaState.sessions.set(S1, { session_id: S1, user_id: USER, method: 'recovery_code', expires_at: new Date(Date.now() + 60_000).toISOString() });
    await signInWithPasskey(app, key);
    const recId = mfaState.recoveries[0].id;
    const su = await stepUp(app, key, 'recovery_undo', recId, USER, S3);
    const u = await request(app).post('/auth/mfa/recovery/undo').set('Authorization', auth(USER, S3))
      .set('X-Step-Up', su.token as string).send({ recoveryId: recId });
    expect(u.status).toBe(200);
    expect([...mfaState.sessions.keys()]).toEqual([S3]);
  });

  it('L2: a stale recovery id is refused before the undo step-up is spent', async () => {
    const app = await loadApp();
    const { key } = await finishRecovery(app);
    await signInWithPasskey(app, key);
    const recId = mfaState.recoveries[0].id;
    const su = await stepUp(app, key, 'recovery_undo', recId, USER, S3);
    const r = await request(app).post('/auth/mfa/recovery/undo').set('Authorization', auth(USER, S3))
      .set('X-Step-Up', su.token as string).send({ recoveryId: '00000000-0000-4000-8000-000000000000' });
    expect(r.status).toBe(404);
    expect(mfaState.grants.find((g) => g.action === 'recovery_undo')?.used_at).toBeNull();
  });

  it('a sign-in with a method resets the code counters and voids live codes; the waiting recovery stays', async () => {
    const app = await loadApp();
    const { key } = await startRecovery(app);
    ageCodes();
    await post(app, '/recovery/code', {}, { session: S3 }).catch(() => undefined);
    expect(mfaState.emailCodes.length).toBeGreaterThan(0);
    await signInWithPasskey(app, key);
    expect(mfaState.emailCodes).toHaveLength(0);
    expect(mfaState.recoveries[0].status).toBe('holding');
  });

  it('L4: an email-recovery marker never passes the staff second-factor check', async () => {
    const { __setMfaStore } = await import('../lib/mfa/store');
    __setMfaStore(createMfaStoreFake(mfaState));
    const { hasStaffSecondFactor, hasSecondFactor } = await import('../lib/mfa/mfaService');
    mfaState.sessions.set(S2, { session_id: S2, user_id: USER, method: 'email_recovery', expires_at: new Date(Date.now() + 60_000).toISOString() });
    expect(await hasSecondFactor(USER, S2)).toBe(true);
    expect(await hasStaffSecondFactor(USER, S2)).toBe(false);
    mfaState.sessions.set(S3, { session_id: S3, user_id: USER, method: 'passkey', expires_at: new Date(Date.now() + 60_000).toISOString() });
    expect(await hasStaffSecondFactor(USER, S3)).toBe(true);
  });
});

// ── Backup email ────────────────────────────────────────────────────────────

describe('backup email', () => {
  const addWithStepUp = async (app: App, key: SoftPasskey, email: string) => {
    const su = await stepUp(app, key, 'recovery_channel', 'backup_email');
    expect(su.status).toBe(200);
    return request(app).post('/auth/mfa/backup-email').set('Authorization', auth(USER, S1))
      .set('X-Recovery-Nonce', NONCE).set('X-Step-Up', su.token as string).send({ email });
  };

  it('add needs a step-up, sends a code to the new address, verify confirms it, both addresses told', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const noStep = await request(app).post('/auth/mfa/backup-email').set('Authorization', auth(USER, S1))
      .set('X-Recovery-Nonce', NONCE).send({ email: 'Backup@Example.org' });
    expect(noStep.body.reason).toBe('step_up_required');

    const r = await addWithStepUp(app, key, 'Backup@Example.org');
    expect(r.status).toBe(200);
    expect(codeMails().at(-1)?.to).toBe('backup@example.org');
    expect(mfaState.backupEmails.get(USER)).toMatchObject({ email: 'backup@example.org', verified_at: null });
    const v = await request(app).post('/auth/mfa/backup-email/verify').set('Authorization', auth(USER, S1))
      .set('X-Recovery-Nonce', NONCE).send({ codeId: r.body.data.codeId, code: lastCode() });
    expect(v.status).toBe(200);
    expect(v.body.data.backupEmail).toEqual({ masked: 'b•••@e•••.org', verified: true });
    await flush();
    expect(ses.filter((m) => /backup email was added/.test(m.subject)).map((m) => m.to).sort())
      .toEqual(['backup@example.org', 'user@example.com']);
  });

  it('refused (without spending the step-up) for the account email itself and for staff', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    const su = await stepUp(app, key, 'recovery_channel', 'backup_email');
    const same = await request(app).post('/auth/mfa/backup-email').set('Authorization', auth(USER, S1))
      .set('X-Recovery-Nonce', NONCE).set('X-Step-Up', su.token as string).send({ email: 'USER@example.com' });
    expect(same.body.reason).toBe('same_as_account_email');
    expect(mfaState.grants.find((g) => g.action === 'recovery_channel')?.used_at).toBeNull();

    const staff = await enrolFirst(app, ADMIN);
    const suA = await stepUp(app, staff.key, 'recovery_channel', 'backup_email', ADMIN);
    const r = await request(app).post('/auth/mfa/backup-email').set('Authorization', auth(ADMIN, S1))
      .set('X-Recovery-Nonce', NONCE).set('X-Step-Up', suA.token as string).send({ email: 'x@example.org' });
    expect(r.body.reason).toBe('recovery_not_available');
  });

  it('L2: replacing keeps the confirmed address until the new one is confirmed; a send limit changes nothing', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    mfaState.backupEmails.set(USER, { email: 'old@example.org', verified_at: new Date().toISOString(), pending_email: null });
    const r = await addWithStepUp(app, key, 'new@example.org');
    expect(r.status).toBe(200);
    expect(mfaState.backupEmails.get(USER)).toMatchObject({ email: 'old@example.org', pending_email: 'new@example.org' });
    expect(ses.some((m) => m.to === 'old@example.org' && /removed/.test(m.subject))).toBe(false);
    // Cooldown: refused after the step-up, but the stored address is untouched.
    const again = await addWithStepUp(app, key, 'other@example.org');
    expect(again.body.reason).toBe('code_send_limit');
    expect(mfaState.backupEmails.get(USER)).toMatchObject({ email: 'old@example.org', pending_email: 'new@example.org' });
    const v = await request(app).post('/auth/mfa/backup-email/verify').set('Authorization', auth(USER, S1))
      .set('X-Recovery-Nonce', NONCE).send({ codeId: r.body.data.codeId, code: lastCode() });
    expect(v.status).toBe(200);
    expect(mfaState.backupEmails.get(USER)).toMatchObject({ email: 'new@example.org', pending_email: null });
    await flush();
    await flush();
    expect(ses.map((m) => `${m.to} ${m.subject}`)).toContain('old@example.org A backup email was removed from your account');
  });

  it('remove needs a step-up and tells both addresses', async () => {
    const app = await loadApp();
    const { key } = await enrolFirst(app);
    mfaState.backupEmails.set(USER, { email: 'backup@example.org', verified_at: new Date().toISOString() });
    const su = await stepUp(app, key, 'recovery_channel', 'backup_email');
    const r = await request(app).delete('/auth/mfa/backup-email').set('Authorization', auth(USER, S1)).set('X-Step-Up', su.token as string);
    expect(r.status).toBe(200);
    expect(mfaState.backupEmails.has(USER)).toBe(false);
    await flush();
    expect(ses.filter((m) => /backup email was removed/.test(m.subject)).map((m) => m.to).sort())
      .toEqual(['backup@example.org', 'user@example.com']);
  });

  it('status shows it masked only', async () => {
    const app = await loadApp();
    await enrolFirst(app);
    mfaState.backupEmails.set(USER, { email: 'backup@example.org', verified_at: null });
    const s = await request(app).get('/auth/mfa/status').set('Authorization', auth(USER, S1));
    expect(s.body.data.backupEmail).toEqual({ masked: 'b•••@e•••.org', verified: false });
    expect(JSON.stringify(s.body)).not.toContain('backup@example.org');
  });
});

// ── Token routes during the freeze ──────────────────────────────────────────

describe('refuseWhileFrozen', () => {
  it('refuses during the freeze, passes otherwise, fails closed', async () => {
    const { __setMfaStore } = await import('../lib/mfa/store');
    __setMfaStore(createMfaStoreFake(mfaState));
    const { refuseWhileFrozen } = await import('../middleware/mfaGates');
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { user: { id: string } }).user = { id: USER };
      next();
    });
    app.post('/x', refuseWhileFrozen, (_req, res) => res.json({ ok: true }));
    const call = () => request(app).post('/x').set('Authorization', auth(USER, S1));

    expect((await call()).status).toBe(200);
    mfaState.recoveries.push({
      id: '99999999-9999-4999-8999-999999999999', user_id: USER, channel: 'primary', status: 'completed', started_session_id: S2,
      hold_ends_at: new Date(Date.now() - 1).toISOString(), finished_at: new Date().toISOString(), finished_session_id: S2,
      freeze_ends_at: new Date(Date.now() + 86_400_000).toISOString(), enrol_until: null, enrolled_at: null,
      created_at: new Date().toISOString(), cancelled_at: null, undone_at: null,
    });
    const frozen = await call();
    expect(frozen.status).toBe(403);
    expect(frozen.body).toMatchObject({ success: false, reason: 'recovery_freeze', freezeEndsAt: expect.any(String) });
    mfaState.failNext.add('latestRecovery');
    expect((await call()).status).toBe(503);
  });
});
