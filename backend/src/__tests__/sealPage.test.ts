import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildSealSpec } from '../lib/seal/sealSpec';
import { createSealPageRouter, normaliseSealCode, type SealLookup } from '../routes/sealPage';
import { SEAL_PAGE_COPY } from '../lib/seal/sealPage';

/**
 * S-SEAL1 Ph2b — the public seal page /s/<code>.
 * Link previewers run no JavaScript; the page must carry its Open Graph tags, show only public
 * provenance, and give unknown and inactive codes the very same answer.
 */

const STORED = 'WAV4F6TT';
const DISPLAY = 'WAV4-F6TT';

/** Private values that must never reach the page (pinned list). */
const PRIVATE = {
  tagId: '55555555-5555-4555-8555-555555555555',
  ownerId: '11111111-1111-4111-8111-111111111111',
  chipSerial: 'A1B2C3D4E5F6',
  tagUid: '04A27E02936980',
  chipName: 'chip_004',
  ownershipId: 'own_9f8e7d6c5b4a',
  tapSession: 'tapsess_secret',
};

const story = {
  creatorName: 'Kai Example',
  originLocation: 'EDC Las Vegas 2026',
  originDate: '2026-05-17T00:00:00Z',
  claimDate: '2026-10-03T12:00:00Z',
  originVideoUrl: 'https://video.example/clip',
};

const live = (over: Partial<SealLookup> = {}): SealLookup => ({
  lifecycle: 'ACTIVE',
  sealCode: STORED,
  sealSpec: buildSealSpec(STORED),
  imagesAt: '2026-10-29T04:00:00Z',
  story,
  ...over,
});

const appWith = (lookup: (code: string) => Promise<SealLookup | null>, perIpPerMinute?: number) => {
  const app = express();
  app.use('/s', createSealPageRouter({ lookup, perIpPerMinute }));
  return app;
};

beforeEach(() => {
  vi.stubEnv('PUBLIC_SEAL_BASE_URL', 'https://staging.example');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('normaliseSealCode', () => {
  it.each([
    ['WAV4-F6TT', 'WAV4F6TT'],
    ['wav4f6tt', 'WAV4F6TT'],
    [' wav4 - f6tt ', 'WAV4F6TT'],
    ['0IL0-0000', '0110' + '0000'],
    ['o000-0000', '0000' + '0000'],
  ])('%s → %s', (raw, out) => expect(normaliseSealCode(raw)).toBe(out));

  it.each(['WAV4-F6T', 'WAV4-F6TTX', 'UUUU-UUUU', '', 'x'.repeat(40)])('rejects %j', (raw) =>
    expect(normaliseSealCode(raw)).toBeNull(),
  );
});

describe('GET /s/:code', () => {
  it('shows a live seal: code, still seal, reliance sentence, Open Graph tags', async () => {
    const res = await request(appWith(async () => live())).get(`/s/${DISPLAY}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain(`Seal <span class="code">${DISPLAY}</span>`);
    expect(res.text).toContain('role="img" aria-label="Sealed, seal code WAV4-F6TT"');
    expect(res.text).toContain('This code names a seal. It doesn&#39;t prove the item in front of you. Tap the seal.');
    expect(res.text).toContain('<meta property="og:image" content="https://staging.example/seal-img/WAV4-F6TT/preview-v1.png">');
    expect(res.text).toContain('<meta property="og:url" content="https://staging.example/s/WAV4-F6TT">');
    expect(res.text).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(res.text).toContain('<link rel="canonical" href="https://staging.example/s/WAV4-F6TT">');
    expect(res.text.match(/<h1/g)).toHaveLength(1);
  });

  it('runs no script and loads nothing (strict CSP)', async () => {
    const res = await request(appWith(async () => live())).get(`/s/${DISPLAY}`);
    expect(res.text).not.toMatch(/<script|<img|<iframe|<link rel="stylesheet"|style="/);
    expect(res.headers['content-security-policy']).toMatch(/^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; /);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('caches 60 s at CloudFront with a day of stale-if-error, and is noindex on staging', async () => {
    const res = await request(appWith(async () => live())).get(`/s/${DISPLAY}`);
    expect(res.headers['cache-control']).toBe('public, max-age=60, stale-if-error=3600');
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.text).toContain('<meta name="robots" content="noindex">');
  });

  it('shows the public story the owner chose to share', async () => {
    const res = await request(appWith(async () => live())).get(`/s/${DISPLAY}`);
    expect(res.text).toContain('Kai Example');
    expect(res.text).toContain('EDC Las Vegas 2026');
    expect(res.text).toContain('May 17, 2026');
    expect(res.text).toContain('October 3, 2026');
    expect(res.text).toContain('href="https://video.example/clip"');
  });

  it('shows nothing the owner did not share, and never a non-https video link', async () => {
    const empty = { creatorName: null, originLocation: null, originDate: null, claimDate: null, originVideoUrl: 'javascript:alert(1)' };
    const res = await request(appWith(async () => live({ story: empty }))).get(`/s/${DISPLAY}`);
    expect(res.text).toContain(SEAL_PAGE_COPY.noStory);
    expect(res.text).not.toContain('javascript:');
  });

  it('escapes story text', async () => {
    const res = await request(appWith(async () => live({ story: { ...story, creatorName: '<script>x</script>' } }))).get(`/s/${DISPLAY}`);
    expect(res.text).not.toContain('<script>x');
    expect(res.text).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('never shows a private field, whatever the lookup carries', async () => {
    const leaky = { ...live(), ...PRIVATE } as SealLookup;
    const res = await request(appWith(async () => leaky)).get(`/s/${DISPLAY}`);
    for (const value of Object.values(PRIVATE)) expect(res.text).not.toContain(value);
    expect(res.text).not.toMatch(/Ownership ID|owner@|serial|UID/i);
  });

  it('points at the generic picture until this seal has its own', async () => {
    const res = await request(appWith(async () => live({ imagesAt: null }))).get(`/s/${DISPLAY}`);
    expect(res.text).toContain('content="https://staging.example/seal-img/generic-v1.png"');
  });

  it('unclaimed seals say so', async () => {
    const res = await request(appWith(async () => live({ lifecycle: 'ENROLLED' }))).get(`/s/${DISPLAY}`);
    expect(res.text).toContain(SEAL_PAGE_COPY.statusUnclaimed);
  });

  it.each(['wav4f6tt', 'WAV4F6TT', 'wav4-f6tt', 'WAV4%20F6TT'])('redirects %s to the canonical form', async (raw) => {
    const lookup = vi.fn(async () => live());
    const res = await request(appWith(lookup)).get(`/s/${raw}`);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`/s/${DISPLAY}`);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('unknown, malformed, on hold, released and retired all get the identical "can\'t show" page (200, noindex)', async () => {
    const bodies: string[] = [];
    const cases: Array<[string, SealLookup | null]> = [
      [DISPLAY, null],
      [DISPLAY, live({ lifecycle: 'SUSPENDED' })],
      [DISPLAY, live({ lifecycle: 'RELEASED' })],
      [DISPLAY, live({ lifecycle: 'RETIRED' })],
      ['nope', null],
    ];
    for (const [code, row] of cases) {
      const res = await request(appWith(async () => row)).get(`/s/${code}`);
      expect(res.status).toBe(200);
      expect(res.headers['x-robots-tag']).toBe('noindex');
      expect(res.headers['cache-control']).toBe('public, max-age=60, stale-if-error=3600');
      bodies.push(res.text);
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain(SEAL_PAGE_COPY.genericHeading);
    expect(bodies[0]).toContain('content="https://staging.example/seal-img/generic-v1.png"');
    expect(bodies[0]).not.toContain(DISPLAY);
    expect(bodies[0]).not.toContain('og:url');
  });

  it('a stored code that does not match the row is treated as unknown', async () => {
    const res = await request(appWith(async () => live({ sealCode: 'GPKD67QP' }))).get(`/s/${DISPLAY}`);
    expect(res.text).toContain(SEAL_PAGE_COPY.genericHeading);
  });

  it('/s and /s/ give the generic page', async () => {
    for (const path of ['/s', '/s/']) {
      const res = await request(appWith(async () => live())).get(path);
      expect(res.status).toBe(200);
      expect(res.text).toContain(SEAL_PAGE_COPY.genericHeading);
    }
  });

  it('a database failure answers 503, not cached (CloudFront serves the last good copy)', async () => {
    const res = await request(appWith(async () => { throw new Error('db down'); })).get(`/s/${DISPLAY}`);
    expect(res.status).toBe(503);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).not.toContain('db down');
  });

  it('draws the seal from a fresh spec when the stored one is missing', async () => {
    const res = await request(appWith(async () => live({ sealSpec: null }))).get(`/s/${DISPLAY}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<svg');
  });

  it('rate limits per IP', async () => {
    const app = appWith(async () => live(), 2);
    await request(app).get(`/s/${DISPLAY}`);
    await request(app).get(`/s/${DISPLAY}`);
    const res = await request(app).get(`/s/${DISPLAY}`);
    expect(res.status).toBe(429);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('page copy says seal, never token / chip / NFT, and has no em dashes', () => {
    const all = Object.values(SEAL_PAGE_COPY).join(' ');
    expect(all).not.toMatch(/token|chip|nft|mint|wallet/i);
    expect(all).not.toContain('—');
  });
});

describe('createApp mounts /s outside the API', () => {
  it('serves /s/ with no CORS header and no x-powered-by', async () => {
    vi.resetModules();
    vi.doMock('../routes/sealPage', async (orig) => {
      const mod = await orig<typeof import('../routes/sealPage')>();
      return { ...mod, createSealPageRouter: () => mod.createSealPageRouter({ lookup: async () => null }) };
    });
    const { createApp } = await import('../app');
    const res = await request(createApp()).get('/s/WAV4-F6TT').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    vi.doUnmock('../routes/sealPage');
  });
});
