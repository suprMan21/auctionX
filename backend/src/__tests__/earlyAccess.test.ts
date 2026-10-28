import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createHash } from 'crypto';

const issues = vi.hoisted(() => ({ created: [] as Array<{ title: string; body: string }> }));
vi.mock('../lib/github/issues', () => ({
  createIssue: async (title: string, body: string) => {
    issues.created.push({ title, body });
    return { number: 1, url: 'https://example.invalid/1' };
  },
}));

import { CONSENT_TEXTS, POW_PREFIX } from '../lib/earlyAccess/constants';
import { leadingZeroBits, verifyPow } from '../lib/earlyAccess/pow';
import { checkEmailDomain, isDisposable } from '../lib/earlyAccess/emailDomain';
import { makeUnsubscribeToken, readUnsubscribeToken } from '../lib/earlyAccess/unsubscribeToken';
import { renderWelcomeEmail } from '../lib/earlyAccess/welcomeEmail';
import type { EarlyAccessStore } from '../lib/earlyAccess/signup';
import { StoreError } from '../lib/earlyAccess/supabaseStore';
import { resetAlertsForTest } from '../lib/earlyAccess/alerts';
import { createEarlyAccessRouter, unsubscribeUrl } from '../routes/earlyAccess';
import type { EmailPayload } from '../lib/notifications/emailSender';

/**
 * S-SITE2 G3 — early-access signup. Proves the bot defences, the identical reply for
 * new / repeat / dropped requests, consent storage, the welcome email (CASL: sender,
 * address, working unsubscribe, one-click header), unsubscribe without link-scanner
 * accidents, and the alerts. The database grants are proven by
 * supabase/tests/early_access_live.sql.
 */

const CONSENT = CONSENT_TEXTS[0];
const SECRET = 'x'.repeat(40);
const NOW = new Date('2026-10-28T12:00:00Z');
const BITS_FOR_TEST = 16;

/** Solve the proof-of-work the way the browser does. */
const solve = (email: string, ts = NOW.getTime(), bits = BITS_FOR_TEST) => {
  for (let i = 0; ; i++) {
    const nonce = i.toString(36);
    const d = createHash('sha256').update(`${POW_PREFIX}:${email}:${ts}:${nonce}`).digest();
    if (leadingZeroBits(d) >= bits) return { ts, nonce };
  }
};

type StoredRow = { id: string; email: string; source: string; consent_text: string; consent_at: string; unsubscribed_at: string | null; welcome_sent_at: string | null; created_at: string };

const memoryStore = (failWith?: string) => {
  const rows: StoredRow[] = [];
  let n = 0;
  const guard = () => {
    if (failWith) throw new StoreError(failWith);
  };
  const store: EarlyAccessStore = {
    async findByEmail(email) {
      guard();
      const r = rows.find((x) => x.email === email);
      return r ? { id: r.id, unsubscribed_at: r.unsubscribed_at } : null;
    },
    async insert(row) {
      guard();
      if (rows.some((x) => x.email === row.email)) return 'duplicate';
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
      rows.push({ id, ...row, unsubscribed_at: null, welcome_sent_at: null, created_at: NOW.toISOString() });
      return { id };
    },
    async resubscribe(id, consent) {
      Object.assign(rows.find((x) => x.id === id)!, consent, { unsubscribed_at: null });
    },
    async markWelcomeSent(id, at) {
      rows.find((x) => x.id === id)!.welcome_sent_at = at;
    },
    async unsubscribe(id, at) {
      const r = rows.find((x) => x.id === id);
      if (!r || r.unsubscribed_at) return false;
      r.unsubscribed_at = at;
      return true;
    },
    async countSince() {
      return rows.length;
    },
  };
  return { store, rows };
};

const setup = (opts: { failWith?: string; perIp?: number; domain?: 'ok' | 'disposable' | 'no_mail' } = {}) => {
  const { store, rows } = memoryStore(opts.failWith);
  const sent: EmailPayload[] = [];
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/early-access',
    createEarlyAccessRouter({
      store,
      send: async (p) => {
        sent.push(p);
        return true;
      },
      domainCheck: async () => opts.domain ?? 'ok',
      now: () => NOW,
      perIpPer10Min: opts.perIp ?? 100,
      globalPerHour: 1000,
    }),
  );
  return { app, rows, sent };
};

const body = (email: string, over: Record<string, unknown> = {}) => ({
  email,
  consentText: CONSENT,
  website: '',
  fillMs: 8000,
  pow: solve(email.trim().toLowerCase()),
  ...over,
});

/** The welcome email is sent after the reply; let it finish. */
const settle = () => new Promise((r) => setTimeout(r, 20));

const ACCEPTED = { success: true, data: { status: 'accepted' } };

describe('early-access: proof-of-work', () => {
  it('counts leading zero bits', () => {
    expect(leadingZeroBits(Uint8Array.from([0, 0, 0x0f]))).toBe(20);
    expect(leadingZeroBits(Uint8Array.from([0x80]))).toBe(0);
  });

  it('accepts a real solution and refuses it for another email or an old timestamp', () => {
    const pow = solve('fan@example.org');
    expect(verifyPow('fan@example.org', pow, NOW.getTime())).toBe(true);
    expect(verifyPow('other@example.org', pow, NOW.getTime())).toBe(false);
    expect(verifyPow('fan@example.org', pow, NOW.getTime() + 2 * 60 * 60 * 1000)).toBe(false);
    expect(verifyPow('fan@example.org', { ...pow, nonce: 'NOT VALID' }, NOW.getTime())).toBe(false);
  });
});

describe('early-access: mail domain', () => {
  const resolver = (records: Partial<Record<'mx' | 'a' | 'aaaa', 'yes' | 'none' | 'error'>>) => {
    const make = (k: 'mx' | 'a' | 'aaaa') => async () => {
      const v = records[k] ?? 'none';
      if (v === 'yes') return [{}];
      throw Object.assign(new Error(k), { code: v === 'none' ? 'ENOTFOUND' : 'ESERVFAIL' });
    };
    return { resolveMx: make('mx'), resolve4: make('a'), resolve6: make('aaaa') };
  };

  it('rejects throwaway domains and their subdomains', async () => {
    expect(isDisposable('mailinator.com')).toBe(true);
    expect(isDisposable('x.mailinator.com')).toBe(true);
    expect(isDisposable('gmail.com')).toBe(false);
    expect(await checkEmailDomain('a@yopmail.com', resolver({ mx: 'yes' }))).toBe('disposable');
  });

  it('needs MX, or an address record as the RFC 5321 fallback', async () => {
    expect(await checkEmailDomain('a@real.test', resolver({ mx: 'yes' }))).toBe('ok');
    expect(await checkEmailDomain('a@real.test', resolver({ a: 'yes' }))).toBe('ok');
    expect(await checkEmailDomain('a@nowhere.test', resolver({}))).toBe('no_mail');
  });

  it('fails open when DNS itself is broken', async () => {
    expect(await checkEmailDomain('a@real.test', resolver({ mx: 'error' }))).toBe('ok');
  });
});

describe('early-access: unsubscribe token', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  afterEach(() => {
    delete process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET;
  });

  it('round-trips, and refuses forgeries and swapped ids', () => {
    process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET = SECRET;
    const t = makeUnsubscribeToken(id)!;
    expect(readUnsubscribeToken(t)).toBe(id);
    expect(readUnsubscribeToken(`00000000-0000-4000-8000-000000000002.${t.split('.')[1]}`)).toBeNull();
    expect(readUnsubscribeToken(`${id}.AAAA`)).toBeNull();
    expect(readUnsubscribeToken(id)).toBeNull();
  });

  it('makes no token without a long enough secret', () => {
    expect(makeUnsubscribeToken(id)).toBeNull();
    process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET = 'short';
    expect(makeUnsubscribeToken(id)).toBeNull();
  });
});

describe('early-access: welcome email', () => {
  const mail = renderWelcomeEmail('https://api.example.invalid/api/v1/early-access/unsubscribe?t=abc');

  it('identifies the sender, gives the mailing address and a working unsubscribe (CASL)', () => {
    for (const part of [mail.html, mail.text]) {
      expect(part).toContain('The Craving Company Inc.');
      expect(part).toContain('1460 The Queensway, Etobicoke, ON M8Z 1S7');
      expect(part).toContain('https://api.example.invalid/api/v1/early-access/unsubscribe?t=abc');
    }
    expect(mail.headers).toEqual([
      { Name: 'List-Unsubscribe', Value: '<https://api.example.invalid/api/v1/early-access/unsubscribe?t=abc>' },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ]);
  });

  it('keeps to the brand rules and the claims matrix', () => {
    const words = `${mail.subject} ${mail.html} ${mail.text}`;
    expect(words).not.toContain('—');
    for (const p of [/\btokens?\b/i, /\bNFTs?\b/i, /blockchain/i, /crypto/i, /\bNFC\b/, /marketplace/i, /auction/i, /can'?t be (copied|cloned)/i, /guaranteed/i]) {
      expect(words).not.toMatch(p);
    }
    expect(mail.subject).toBe("You're on the list");
  });

  it('loads art only over https, with alt text', () => {
    const imgs = [...mail.html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThanOrEqual(5);
    for (const img of imgs) {
      expect(img).toMatch(/src="https:\/\/authentic-materials\.com\/email\/[a-z-]+\.png"/);
      expect(img).toMatch(/alt="/);
    }
  });
});

describe('early-access: POST /api/v1/early-access', () => {
  beforeEach(() => {
    process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET = SECRET;
    issues.created.length = 0;
    resetAlertsForTest();
  });
  afterEach(() => {
    delete process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET;
  });

  it('saves the signup with its consent and sends one welcome with the unsubscribe headers', async () => {
    const { app, rows, sent } = setup();
    const res = await request(app).post('/api/v1/early-access').send(body('  Fan@Example.org '));
    expect(res.status).toBe(202);
    expect(res.body).toEqual(ACCEPTED);
    await settle();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'fan@example.org', source: 'home', consent_text: CONSENT, consent_at: NOW.toISOString() });
    expect(rows[0].welcome_sent_at).toBe(NOW.toISOString());
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('fan@example.org');
    expect(sent[0].headers?.[0].Value).toContain('/api/v1/early-access/unsubscribe?t=');
  });

  it('answers a repeat exactly like a new signup and sends nothing', async () => {
    const { app, sent } = setup();
    await request(app).post('/api/v1/early-access').send(body('fan@example.org'));
    await settle();
    const again = await request(app).post('/api/v1/early-access').send(body('fan@example.org'));
    await settle();
    expect(again.status).toBe(202);
    expect(again.body).toEqual(ACCEPTED);
    expect(sent).toHaveLength(1);
  });

  it('drops honeypot and too-fast submissions silently', async () => {
    const { app, rows, sent } = setup();
    const a = await request(app).post('/api/v1/early-access').send(body('bot1@example.org', { website: 'http://spam' }));
    const b = await request(app).post('/api/v1/early-access').send(body('bot2@example.org', { fillMs: 300 }));
    await settle();
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(a.body).toEqual(ACCEPTED);
    expect(rows).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('refuses a missing or wrong proof-of-work', async () => {
    const { app, rows } = setup();
    const wrongEmail = await request(app).post('/api/v1/early-access').send(body('fan@example.org', { pow: solve('other@example.org') }));
    expect(wrongEmail.status).toBe(400);
    expect(wrongEmail.body.error.code).toBe('BAD_POW');
    const missing = await request(app).post('/api/v1/early-access').send({ ...body('fan@example.org'), pow: undefined });
    expect(missing.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it('refuses consent wording the page never showed', async () => {
    const { app, rows } = setup();
    const res = await request(app).post('/api/v1/early-access').send(body('fan@example.org', { consentText: 'I agree to anything' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CONSENT');
    expect(rows).toHaveLength(0);
  });

  it('tells the person when the domain cannot take mail or is a throwaway', async () => {
    const noMail = await request(setup({ domain: 'no_mail' }).app).post('/api/v1/early-access').send(body('fan@nowhere.test'));
    expect(noMail.status).toBe(400);
    expect(noMail.body.error).toEqual({ code: 'EMAIL_NO_MAIL', message: "That email can't receive mail. Check it and try again." });
    const throwaway = await request(setup({ domain: 'disposable' }).app).post('/api/v1/early-access').send(body('fan@yopmail.com'));
    expect(throwaway.body.error.code).toBe('EMAIL_DISPOSABLE');
  });

  it('rejects unknown fields and malformed email', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/v1/early-access').send({ ...body('fan@example.org'), source: 'admin' })).status).toBe(400);
    expect((await request(app).post('/api/v1/early-access').send(body('not-an-email'))).status).toBe(400);
  });

  it('limits each IP', async () => {
    const { app } = setup({ perIp: 2 });
    for (let i = 0; i < 2; i++) await request(app).post('/api/v1/early-access').send(body(`p${i}@example.org`));
    const third = await request(app).post('/api/v1/early-access').send(body('p3@example.org'));
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });

  it('says so when the database is down, and opens one alert with no address in it', async () => {
    const { app } = setup({ failWith: 'PGRST301' });
    const res = await request(app).post('/api/v1/early-access').send(body('fan@example.org'));
    await request(app).post('/api/v1/early-access').send(body('fan2@example.org'));
    await settle();
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('UNAVAILABLE');
    expect(issues.created).toHaveLength(1);
    expect(JSON.stringify(issues.created)).not.toMatch(/@/);
  });

  it('saves the signup but sends no email when unsubscribe is not configured', async () => {
    delete process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET;
    const { app, rows, sent } = setup();
    const res = await request(app).post('/api/v1/early-access').send(body('fan@example.org'));
    await settle();
    expect(res.status).toBe(202);
    expect(rows).toHaveLength(1);
    expect(rows[0].welcome_sent_at).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('opens a spike alert once the hourly count reaches the threshold', async () => {
    process.env.EARLY_ACCESS_SPIKE_PER_HOUR = '3';
    const { app } = setup();
    for (let i = 0; i < 4; i++) await request(app).post('/api/v1/early-access').send(body(`s${i}@example.org`));
    await settle();
    delete process.env.EARLY_ACCESS_SPIKE_PER_HOUR;
    expect(issues.created.map((i) => i.title)).toEqual(['Early-access signup spike: 3 in the last hour']);
  });
});

describe('early-access: unsubscribe', () => {
  beforeEach(() => {
    process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.EARLY_ACCESS_UNSUBSCRIBE_SECRET;
  });

  const signedUp = async () => {
    const ctx = setup();
    await request(ctx.app).post('/api/v1/early-access').send(body('fan@example.org'));
    await settle();
    const link = new URL(ctx.sent[0].headers![0].Value.slice(1, -1));
    return { ...ctx, path: `${link.pathname}${link.search}` };
  };

  it('GET shows a confirm button and changes nothing (link scanners are safe)', async () => {
    const { app, rows, path } = await signedUp();
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<form method="post"');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(rows[0].unsubscribed_at).toBeNull();
  });

  it('the button unsubscribes; a later signup re-subscribes with fresh consent and one new welcome', async () => {
    const { app, rows, sent, path } = await signedUp();
    const res = await request(app).post(path).type('form').send({});
    expect(res.status).toBe(200);
    expect(res.text).toContain("You're unsubscribed");
    expect(rows[0].unsubscribed_at).toBe(NOW.toISOString());

    await request(app).post('/api/v1/early-access').send(body('fan@example.org'));
    await settle();
    expect(rows[0].unsubscribed_at).toBeNull();
    expect(sent).toHaveLength(2);
  });

  it('honours RFC 8058 one-click from a mail app', async () => {
    const { app, rows, path } = await signedUp();
    const res = await request(app).post(path).type('form').send('List-Unsubscribe=One-Click');
    expect(res.status).toBe(200);
    expect(rows[0].unsubscribed_at).not.toBeNull();
  });

  it('refuses a forged or cut-short link', async () => {
    const { app, rows } = await signedUp();
    expect((await request(app).get('/api/v1/early-access/unsubscribe?t=nope')).status).toBe(400);
    const forged = `00000000-0000-4000-8000-000000000001.${'A'.repeat(43)}`;
    expect((await request(app).post(`/api/v1/early-access/unsubscribe?t=${forged}`).type('form').send({})).status).toBe(400);
    expect(rows[0].unsubscribed_at).toBeNull();
  });

  it('builds links on the public API base', () => {
    expect(unsubscribeUrl('a.b')).toMatch(/^https:\/\/.+\/api\/v1\/early-access\/unsubscribe\?t=a\.b$/);
  });
});

describe('early-access: CORS', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('lets the public site call the signup, without credentials, and nothing else', async () => {
    process.env.FRONTEND_URL = 'https://staging.example.invalid';
    vi.resetModules();
    const { createApp } = await import('../app');
    const app = createApp();
    const pre = await request(app)
      .options('/api/v1/early-access')
      .set('Origin', 'https://authentic-materials.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(pre.headers['access-control-allow-origin']).toBe('https://authentic-materials.com');
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();

    const other = await request(app)
      .options('/api/v1/nfc/tap')
      .set('Origin', 'https://authentic-materials.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(other.headers['access-control-allow-origin']).not.toBe('https://authentic-materials.com');

    const evil = await request(app)
      .options('/api/v1/early-access')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});
