import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';
import { TRUSTED_PROXIES, createApp } from '../app';
import { securityContext } from '../lib/security/requestContext';

/**
 * `trust proxy` (unset 2026-10-05 → 2026-10-24). Behind App Runner every
 * request arrives from an internal link-local hop with the client in
 * X-Forwarded-For. These tests run real Express + express-rate-limit; supertest
 * connects over loopback, which stands in for that internal hop.
 */

/** An app with the production setting, echoing what Express and our logs think the client is. */
const probeApp = (limiter?: express.RequestHandler) => {
  const app = express();
  app.set('trust proxy', [...TRUSTED_PROXIES]);
  if (limiter) app.use(limiter);
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip, logged: securityContext(req, '/ip', 'anonymous').ip });
  });
  return app;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('trust proxy', () => {
  it('is set on the real app, and never to `true`', () => {
    const app = createApp();
    expect(app.get('trust proxy')).toEqual(['loopback', 'linklocal', 'uniquelocal']);
    expect(app.get('trust proxy')).not.toBe(true);
  });

  it('takes the client App Runner appended, whatever the number of internal hops', async () => {
    const app = probeApp();

    const one = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.7');
    const many = await request(app).get('/ip').set('X-Forwarded-For', '203.0.113.7, 10.0.4.12, 169.254.172.3');

    expect(one.body).toEqual({ ip: '203.0.113.7', logged: '203.0.113.7' });
    expect(many.body).toEqual({ ip: '203.0.113.7', logged: '203.0.113.7' });
  });

  it('ignores an X-Forwarded-For entry the client wrote itself (no IP spoofing)', async () => {
    const app = probeApp();

    // The client sent "X-Forwarded-For: 6.6.6.6"; App Runner appended the real address.
    const res = await request(app).get('/ip').set('X-Forwarded-For', '6.6.6.6, 203.0.113.7');

    expect(res.body).toEqual({ ip: '203.0.113.7', logged: '203.0.113.7' });
  });

  it('falls back to the socket address when there is no header', async () => {
    const res = await request(probeApp()).get('/ip');

    expect(res.body.ip).toMatch(/127\.0\.0\.1|::1/);
    expect(res.body.logged).toBe(res.body.ip);
  });

  it('gives each client its own rate-limit budget, with no express-rate-limit warnings', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = probeApp(rateLimit({ windowMs: 60_000, limit: 1, standardHeaders: true, legacyHeaders: false }));
    const from = (ip: string) => request(app).get('/ip').set('X-Forwarded-For', `${ip}, 169.254.172.3`);

    const a1 = await from('203.0.113.7');
    const a2 = await from('203.0.113.7');
    const b1 = await from('198.51.100.20');

    expect([a1.status, a2.status, b1.status]).toEqual([200, 429, 200]);
    const output = JSON.stringify([errors.mock.calls, warns.mock.calls]);
    expect(output).not.toContain('ERR_ERL');
  });
});
