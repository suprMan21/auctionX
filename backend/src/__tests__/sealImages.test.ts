import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { createMockSupabase, type Tables } from './helpers/supabaseMock';
import { drawSealImages, resetSealImageSyncState, runSealImagesTick } from '../lib/seal/sealImageSync';
import type { SealImageStore } from '../lib/seal/sealImageStore';
import { createGetShareImage } from '../controllers/sealShareController';
import { errorHandler } from '../middleware/errorHandler';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * S-SEAL1 Ph2b — seal pictures in S3: the tick that draws and removes them, its shared-secret route,
 * and the owner-only share picture.
 */

const OWNER = '11111111-1111-4111-8111-111111111111';
const EARLIER_OWNER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const TAG_ID = '55555555-5555-4555-8555-555555555555';

type FakeStore = SealImageStore & {
  previews: Map<string, Buffer>;
  shares: Map<string, Buffer>;
  generic: number;
  removed: string[];
  failPut?: boolean;
};

const fakeStore = (configured = true): FakeStore => {
  const s: FakeStore = {
    configured,
    previews: new Map(),
    shares: new Map(),
    generic: 0,
    removed: [],
    putPreview: async (code, png) => {
      if (s.failPut) throw new Error('s3 down');
      s.previews.set(code, png);
    },
    putGeneric: async () => {
      s.generic += 1;
    },
    getShare: async (code) => s.shares.get(code) ?? null,
    putShare: async (code, _variant, png) => {
      s.shares.set(code, png);
    },
    remove: async (code) => {
      s.removed.push(code);
      s.previews.delete(code);
      s.shares.delete(code);
    },
  };
  return s;
};

const tag = (over: Record<string, unknown>) => ({
  id: TAG_ID,
  seal_code: 'WAV4F6TT',
  seal_spec: null,
  seal_images_at: null,
  lifecycle_status: 'ACTIVE',
  current_owner_id: OWNER,
  ...over,
});

let tables: Tables;
const db = () => createMockSupabase(tables) as unknown as SupabaseClient;

beforeEach(() => {
  resetSealImageSyncState();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('PUBLIC_SEAL_BASE_URL', 'https://staging.example');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('runSealImagesTick', () => {
  it('does nothing when no bucket is configured', async () => {
    tables = { nfc_tags: [tag({})] };
    const summary = await runSealImagesTick(db(), fakeStore(false));
    expect(summary).toMatchObject({ configured: false, drawn: 0, removed: 0 });
    expect(tables.nfc_tags[0].seal_images_at).toBeNull();
  });

  it('draws a preview for every live seal without one, stores its spec, and marks it', async () => {
    tables = {
      nfc_tags: [
        tag({ id: 'a', seal_code: 'WAV4F6TT', lifecycle_status: 'ACTIVE' }),
        tag({ id: 'b', seal_code: 'GPKD67QP', lifecycle_status: 'ENROLLED' }),
        tag({ id: 'c', seal_code: null, lifecycle_status: 'ACTIVE' }),
      ],
    };
    const store = fakeStore();
    const summary = await runSealImagesTick(db(), store);
    expect(summary).toMatchObject({ drawn: 2, removed: 0, generic: 'stored' });
    expect([...store.previews.keys()].sort()).toEqual(['GPKD-67QP', 'WAV4-F6TT']);
    expect(tables.nfc_tags[0].seal_images_at).toEqual(expect.any(String));
    expect(tables.nfc_tags[0].seal_spec).toMatchObject({ v: 1, code: 'WAV4F6TT' });
    expect(tables.nfc_tags[2].seal_images_at).toBeNull();
  });

  it('removes the pictures of seals on hold, released or retired and clears the mark', async () => {
    tables = {
      nfc_tags: [
        tag({ id: 'h', seal_code: 'WAV4F6TT', lifecycle_status: 'SUSPENDED', seal_images_at: '2026-10-29T00:00:00Z' }),
        tag({ id: 'r', seal_code: 'GPKD67QP', lifecycle_status: 'RELEASED', seal_images_at: '2026-10-29T00:00:00Z' }),
        tag({ id: 't', seal_code: 'ABCD2345', lifecycle_status: 'RETIRED', seal_images_at: '2026-10-29T00:00:00Z' }),
        tag({ id: 'ok', seal_code: 'QRST6789', lifecycle_status: 'ACTIVE', seal_images_at: '2026-10-29T00:00:00Z' }),
      ],
    };
    const store = fakeStore();
    const summary = await runSealImagesTick(db(), store);
    expect(summary).toMatchObject({ removed: 3, drawn: 0 });
    expect(store.removed.sort()).toEqual(['ABCD-2345', 'GPKD-67QP', 'WAV4-F6TT']);
    expect(tables.nfc_tags.slice(0, 3).map((t) => t.seal_images_at)).toEqual([null, null, null]);
    expect(tables.nfc_tags[3].seal_images_at).toBe('2026-10-29T00:00:00Z');
  });

  it('stores the generic picture once per process', async () => {
    tables = { nfc_tags: [] };
    const store = fakeStore();
    expect((await runSealImagesTick(db(), store)).generic).toBe('stored');
    expect((await runSealImagesTick(db(), store)).generic).toBe('already');
    expect(store.generic).toBe(1);
  });

  it('a failed upload leaves the seal unmarked for the next tick', async () => {
    tables = { nfc_tags: [tag({})] };
    const store = fakeStore();
    store.failPut = true;
    const summary = await runSealImagesTick(db(), store);
    expect(summary).toMatchObject({ drawn: 0, drawFailed: 1 });
    expect(tables.nfc_tags[0].seal_images_at).toBeNull();
  });
});

describe('drawSealImages', () => {
  it('removes the picture again when the seal stopped being live while it was drawn', async () => {
    // The row is already on hold: the guarded mark matches nothing.
    tables = { nfc_tags: [tag({ lifecycle_status: 'SUSPENDED' })] };
    const store = fakeStore();
    const ok = await drawSealImages(db(), store, { id: TAG_ID, seal_code: 'WAV4F6TT', seal_spec: null }, { route: 'test' });
    expect(ok).toBe(false);
    expect(store.removed).toEqual(['WAV4-F6TT']);
    expect(store.previews.size).toBe(0);
    expect(tables.nfc_tags[0].seal_images_at).toBeNull();
  });

  it('never throws into the caller (enroll)', async () => {
    tables = { nfc_tags: [tag({})] };
    const store = fakeStore();
    store.failPut = true;
    await expect(drawSealImages(db(), store, { id: TAG_ID, seal_code: 'WAV4F6TT' }, { route: 'test' })).resolves.toBe(false);
  });
});

describe('POST /api/v1/internal/seal-images', () => {
  const SECRET = 's'.repeat(32);

  const tickApp = async () => {
    vi.resetModules();
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => createMockSupabase(tables) }));
    const router = (await import('../routes/sealImagesTick')).default;
    const app = express();
    app.use(express.json());
    app.use('/tick', router);
    return app;
  };

  afterEach(() => vi.doUnmock('@supabase/supabase-js'));

  it('answers 503 when the secret is not configured', async () => {
    tables = { nfc_tags: [] };
    vi.stubEnv('SEAL_IMAGES_TICK_SECRET', 'short');
    const res = await request(await tickApp()).post('/tick').set('x-tick-secret', 'short');
    expect(res.status).toBe(503);
  });

  it('answers 403 to a wrong or missing secret', async () => {
    tables = { nfc_tags: [] };
    vi.stubEnv('SEAL_IMAGES_TICK_SECRET', SECRET);
    const app = await tickApp();
    expect((await request(app).post('/tick')).status).toBe(403);
    expect((await request(app).post('/tick').set('x-tick-secret', 'x'.repeat(32))).status).toBe(403);
  });

  it('runs with the right secret (no bucket: reports not configured)', async () => {
    tables = { nfc_tags: [] };
    vi.stubEnv('SEAL_IMAGES_TICK_SECRET', SECRET);
    vi.stubEnv('SEAL_IMAGES_BUCKET', '');
    const res = await request(await tickApp()).post('/tick').set('x-tick-secret', SECRET);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ configured: false });
  });
});

describe('GET /api/v1/nfc/:tagId/share-image', () => {
  const shareApp = (userId: string | null, store: FakeStore) => {
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if (userId) (req as unknown as { user: { id: string } }).user = { id: userId };
      next();
    });
    const handler = createGetShareImage({ supabase: db, store: () => store });
    app.get('/nfc/:tagId/share-image', (req, res, next) => {
      handler(req as never, res).catch(next);
    });
    app.use(errorHandler);
    return app;
  };

  it('gives the current owner a 1080 x 1920 PNG, never cached, and keeps it in S3', async () => {
    tables = { nfc_tags: [tag({})] };
    const store = fakeStore();
    const res = await request(shareApp(OWNER, store)).get(`/nfc/${TAG_ID}/share-image`).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('no-store');
    const png = res.body as Buffer;
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1920);
    expect(store.shares.has('WAV4-F6TT')).toBe(true);
  });

  it('serves the stored picture when S3 has one', async () => {
    tables = { nfc_tags: [tag({})] };
    const store = fakeStore();
    store.shares.set('WAV4-F6TT', Buffer.from('cached-png'));
    const res = await request(shareApp(OWNER, store)).get(`/nfc/${TAG_ID}/share-image`).buffer(true);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).toString()).toBe('cached-png');
  });

  it('refuses an earlier owner after a transfer (403)', async () => {
    tables = { nfc_tags: [tag({ current_owner_id: OWNER })] };
    const res = await request(shareApp(EARLIER_OWNER, fakeStore())).get(`/nfc/${TAG_ID}/share-image`);
    expect(res.status).toBe(403);
  });

  it('refuses a stranger (403) and a signed-out caller (401)', async () => {
    tables = { nfc_tags: [tag({})] };
    expect((await request(shareApp(STRANGER, fakeStore())).get(`/nfc/${TAG_ID}/share-image`)).status).toBe(403);
    expect((await request(shareApp(null, fakeStore())).get(`/nfc/${TAG_ID}/share-image`)).status).toBe(401);
  });

  it('refuses a released seal (no owner left: 403) and an owned seal on hold (409)', async () => {
    tables = { nfc_tags: [tag({ lifecycle_status: 'RELEASED', current_owner_id: null })] };
    expect((await request(shareApp(OWNER, fakeStore())).get(`/nfc/${TAG_ID}/share-image`)).status).toBe(403);
    tables = { nfc_tags: [tag({ lifecycle_status: 'SUSPENDED' })] };
    expect((await request(shareApp(OWNER, fakeStore())).get(`/nfc/${TAG_ID}/share-image`)).status).toBe(409);
  });

  it('404 for a malformed or unknown tag id', async () => {
    tables = { nfc_tags: [tag({})] };
    expect((await request(shareApp(OWNER, fakeStore())).get('/nfc/nope/share-image')).status).toBe(404);
    expect((await request(shareApp(OWNER, fakeStore())).get('/nfc/99999999-9999-4999-8999-999999999999/share-image')).status).toBe(404);
  });

  it('still answers when S3 is unreachable (draws on the spot)', async () => {
    tables = { nfc_tags: [tag({})] };
    const store = fakeStore();
    store.getShare = async () => { throw new Error('s3 down'); };
    store.putShare = async () => { throw new Error('s3 down'); };
    const res = await request(shareApp(OWNER, store)).get(`/nfc/${TAG_ID}/share-image`);
    expect(res.status).toBe(200);
  });
});
