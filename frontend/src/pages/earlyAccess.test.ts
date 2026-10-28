import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { EARLY_ACCESS_URL, sha256Head, solvePow, submitEarlyAccess } from '@/components/home/earlyAccess';
import { CONSENT_TEXT, SignupProblem } from '@/components/home/EarlyAccessForm';

/** The browser side of the early-access signup: proof-of-work and the one request. */

const head = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0);

describe('sha256Head', () => {
  it('matches Node for short, block-edge and multi-block inputs', () => {
    for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'am-early-access:v1:fan@example.org:1:zz', 'é'.repeat(80)]) {
      expect(sha256Head(new TextEncoder().encode(s))).toBe(head(s));
    }
  });
});

describe('solvePow', () => {
  it('finds a nonce the server will accept (bound to the email and timestamp)', async () => {
    const pow = await solvePow('fan@example.org', 1761652800000, 12);
    expect(head(`am-early-access:v1:fan@example.org:1761652800000:${pow.nonce}`)).toBeLessThan(2 ** 20);
  });
});

describe('submitEarlyAccess', () => {
  afterEach(() => vi.unstubAllGlobals());

  const call = () => submitEarlyAccess({ email: ' Fan@Example.org ', consentText: CONSENT_TEXT, website: '', fillMs: 9000 });

  it('posts once to the signup URL, without cookies, with a valid proof-of-work', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"success":true}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await call();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(EARLY_ACCESS_URL);
    expect(init.credentials).toBe('omit');
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ email: 'fan@example.org', consentText: CONSENT_TEXT, website: '', fillMs: 9000 });
    expect(head(`am-early-access:v1:fan@example.org:${sent.pow.ts}:${sent.pow.nonce}`)).toBeLessThan(2 ** 16);
  }, 20000);

  it("passes the server's message on, and has its own for no connection", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, error: { code: 'EMAIL_NO_MAIL', message: 'No mail here.' } }), { status: 400 })));
    await expect(call()).rejects.toEqual(new SignupProblem('No mail here.'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(call()).rejects.toThrow(/No connection/);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gateway', { status: 502 })));
    await expect(call()).rejects.toThrow(/Something went wrong/);
  }, 30000);
});
