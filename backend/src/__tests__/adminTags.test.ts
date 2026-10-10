import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'crypto';
import express from 'express';
import request from 'supertest';
import { createMockSupabase, resetMockIds, type MockHooks, type Tables, type Row } from './helpers/supabaseMock';
import { spyOnSecurityEvents, type SecurityEventSpy } from './helpers/securityEvents';

/**
 * S-ADMIN1 Ph1 — token admin console (/api/v1/admin/tags).
 *
 * The state changes themselves run inside database functions
 * (admin_set_tag_suspension, admin_reset_token), which cannot execute in
 * memory: the mock's `rpc` hook stands in for them here, and their behaviour
 * (atomicity, retired-chip freeze, append-only audit, grants) is verified live
 * on staging (docs/S_ADMIN1_VERIFICATION.md). What this suite pins down is the
 * API side: the manage_nfc gate, validation, the typed confirmation, minting
 * before any database call, the error mapping, what admin views must never
 * return, and the security events.
 */

const ADMIN = '44444444-4444-4444-8444-444444444444';
const OWNER = '11111111-1111-4111-8111-111111111111';
const OLD_TAG = '55555555-5555-4555-8555-555555555555';
const NEW_TAG = '66666666-6666-4666-8666-666666666666';
const OLD_UID = '04A27E02936980';
const NEW_UID = '04DE5F1EACC040';
const REASON = 'Chip damaged in shipping, owner verified by phone';

let tables: Tables;
let hooks: MockHooks = {};
let logSpy: SecurityEventSpy;
let rpcCalls: Array<{ fn: string; args: Row }>;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(tables, hooks),
}));

const tagRow = (overrides: Row = {}): Row => ({
  id: OLD_TAG,
  tag_uid: OLD_UID,
  lifecycle_status: 'ACTIVE',
  current_owner_id: OWNER,
  seller_id: ADMIN,
  linked_item_id: null,
  sdm_key_version: 1,
  sun_counter: 4,
  registered_at: '2026-10-03T17:47:00.000Z',
  activated_at: '2026-10-03T18:00:00.000Z',
  suspended_at: null,
  suspended_reason: null,
  retired_at: null,
  retired_reason: null,
  replaced_by_tag_id: null,
  destruction_status: null,
  // Columns that must NEVER reach an admin response:
  aes_key_enc: 'LEGACY-KEY-MATERIAL',
  ...overrides,
});

/** Records rpc calls and answers with `answer` (default: success). */
const rpcAnswer = (answer: (fn: string, args: Row) => { data: unknown; error: { message: string } | null }) => {
  hooks.rpc = (fn, args) => {
    rpcCalls.push({ fn, args });
    return answer(fn, args);
  };
};

beforeEach(() => {
  resetMockIds();
  vi.resetModules();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  process.env.SUPABASE_ANON_KEY = 'sb_publishable_test';
  process.env.OWNERSHIP_SALT_KEY = randomBytes(32).toString('base64');
  hooks = {};
  rpcCalls = [];
  logSpy = spyOnSecurityEvents();

  tables = {
    nfc_tags: [
      tagRow(),
      tagRow({ id: NEW_TAG, tag_uid: NEW_UID, lifecycle_status: 'ENROLLED', current_owner_id: null, sun_counter: 1 }),
    ],
    ownership_transfers: [{
      id: '77777777-7777-4777-8777-777777777777', tag_id: OLD_TAG, transfer_type: 'SALE', status: 'COMPLETED',
      from_user_id: ADMIN, to_user_id: OWNER, to_email: 'owner@example.com',
      initiated_at: '2026-10-03T18:10:00.000Z', completed_at: '2026-10-03T18:12:00.000Z',
      charged_amount: 250, charged_currency: 'usd', reissued_token: false,
    }],
    verification_events: [{
      id: 'v1', tag_id: OLD_TAG, created_at: '2026-10-03T18:20:00.000Z', scan_type: 'verification',
      cmac_valid: true, sun_counter_value: 4, scanned_by: null,
      ip_address: '203.0.113.5', user_agent: 'Mozilla/5.0', sun_message: 'https://am.example/t?picc=SECRET',
    }],
    ownership_proofs: [{
      tag_id: OLD_TAG, status: 'current', created_at: '2026-10-03T18:12:00.000Z', anchored_at: null,
      ownership_id: `0x${'a'.repeat(64)}`, salt_enc: 'SALT-ENVELOPE',
    }],
    audit_logs: [],
  };
});

afterEach(() => {
  logSpy.restore();
});

const controllers = async () => import('../controllers/adminTagController');

const makeReq = (body: Row = {}, params: Row = {}, query: Row = {}, adminId: string | null = ADMIN) => ({
  requestId: 'test-req',
  admin: adminId
    ? { admin_id: adminId, email: 'admin@example.com', role: 'admin', permissions: ['manage_nfc'], brand: 'both', session_version: 1 }
    : undefined,
  headers: {},
  socket: { remoteAddress: '203.0.113.9' },
  body,
  params,
  query,
});

const call = async (fn: (req: never, res: never) => Promise<unknown>, req: ReturnType<typeof makeReq>) => {
  const res: { status: number; body: Row } = { status: 0, body: {} };
  const handler = {
    status(code: number) { res.status = code; return this; },
    json(payload: Row) { res.body = payload; return this; },
  };
  try {
    await fn(req as never, handler as never);
    return { ...res, threw: null as { code?: string; message: string } | null };
  } catch (err) {
    return { ...res, threw: err as { code?: string; message: string } };
  }
};

const adminEvents = () => logSpy.named('admin.tag_action');

// ── manage_nfc gate (router) ────────────────────────────────────────────────

describe('router gate', () => {
  /** Mounts the tags router behind a stand-in for verifyAdminAuth. */
  const appWith = async (permissions: string[]) => {
    const { default: tagsRouter } = await import('../routes/admin/tags');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { admin: unknown }).admin = {
        admin_id: ADMIN, email: 'a@example.com', role: 'x', permissions, brand: 'both', session_version: 1,
      };
      next();
    });
    app.use('/admin/tags', tagsRouter);
    return app;
  };

  it('refuses an admin without manage_nfc on reads and on the reset (AC2)', async () => {
    rpcAnswer(() => ({ data: null, error: null }));
    const app = await appWith(['view_users', 'manage_users']);

    const list = await request(app).get('/admin/tags');
    const reset = await request(app)
      .post(`/admin/tags/${OLD_TAG}/reset`)
      .send({ newTagId: NEW_TAG, reason: REASON, confirmSuffix: '936980' });

    expect(list.status).toBe(403);
    expect(reset.status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
    expect(tables.nfc_tags[0].lifecycle_status).toBe('ACTIVE');
  });

  it('lets a manage_nfc admin list tags, in the standard envelope', async () => {
    const app = await appWith(['manage_nfc']);

    const res = await request(app).get('/admin/tags');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, error: null });
    expect(res.body.data.tags).toHaveLength(2);
  });
});

// ── Inventory ───────────────────────────────────────────────────────────────

describe('list', () => {
  it('filters by lifecycle status and by UID suffix, and shows only the suffix', async () => {
    const { listTags } = await controllers();

    const byStatus = await call(listTags, makeReq({}, {}, { status: 'ENROLLED' }));
    const bySuffix = await call(listTags, makeReq({}, {}, { uidSuffix: '936980' }));

    const enrolled = (byStatus.body.data as { tags: Row[] }).tags;
    expect(enrolled).toHaveLength(1);
    expect(enrolled[0]).toMatchObject({ id: NEW_TAG, uidSuffix: 'ACC040', lifecycleStatus: 'ENROLLED' });

    const matched = (bySuffix.body.data as { tags: Row[]; pagination: Row });
    expect(matched.tags.map((t) => t.id)).toEqual([OLD_TAG]);
    expect(matched.pagination).toMatchObject({ page: 1, total: 1 });

    const raw = JSON.stringify([byStatus.body, bySuffix.body]);
    expect(raw).not.toContain(OLD_UID);
    expect(raw).not.toContain(NEW_UID);
    expect(raw).not.toContain('LEGACY-KEY-MATERIAL');
  });

  it('rejects an unknown filter and a non-hex suffix', async () => {
    const { listTags } = await controllers();

    expect((await call(listTags, makeReq({}, {}, { owner: OWNER }))).threw?.code).toBe('invalid_argument');
    expect((await call(listTags, makeReq({}, {}, { uidSuffix: "%' or 1=1" }))).threw?.code).toBe('invalid_argument');
  });

  it('reports a registry failure as unavailable, not as an empty list', async () => {
    hooks.failRead = (t) => t === 'nfc_tags';
    const { listTags } = await controllers();

    const out = await call(listTags, makeReq());

    expect(out.threw?.code).toBe('unavailable');
  });
});

// ── Detail ──────────────────────────────────────────────────────────────────

describe('chip name', () => {
  it('is returned for a named chip and null for one enrolled before names were recorded', async () => {
    const { listTags } = await controllers();
    (tables.nfc_tags.find((r) => r.id === NEW_TAG) as Row).chip_name = 'chip_005';

    const out = await call(listTags, makeReq({}, {}, {}));
    const tags = (out.body.data as { tags: Row[] }).tags;

    expect(tags.find((t) => t.id === NEW_TAG)).toMatchObject({ chipName: 'chip_005' });
    expect(tags.find((t) => t.id === OLD_TAG)?.chipName ?? null).toBeNull();
  });
});

describe('detail', () => {
  it('returns timeline, custody, taps and Ownership ID status — and nothing secret (AC8)', async () => {
    const { getTag } = await controllers();

    const out = await call(getTag, makeReq({}, { tagId: OLD_TAG }));

    expect(out.threw).toBeNull();
    const data = out.body.data as Row;
    expect(data.tag).toMatchObject({ id: OLD_TAG, uidSuffix: '936980', ownerAccountId: OWNER });
    expect(data.ownershipId).toMatchObject({ status: 'current' });
    expect((data.custody as Row[])[0]).toMatchObject({ type: 'SALE', toAccountId: OWNER });
    expect((data.taps as Row[])[0]).toMatchObject({ valid: true, counter: 4 });

    const raw = JSON.stringify(out.body);
    for (const secret of [
      OLD_UID, 'LEGACY-KEY-MATERIAL', 'SALT-ENVELOPE', 'a'.repeat(64),
      'owner@example.com', '203.0.113.5', 'Mozilla/5.0', 'picc=SECRET',
    ]) {
      expect(raw).not.toContain(secret);
    }
  });

  it('404s an unknown tag and 400s a malformed id', async () => {
    const { getTag } = await controllers();

    expect((await call(getTag, makeReq({}, { tagId: '99999999-9999-4999-8999-999999999999' }))).threw?.code).toBe('not_found');
    expect((await call(getTag, makeReq({}, { tagId: 'not-a-uuid' }))).threw?.code).toBe('invalid_argument');
  });

  it('fails the whole view when any part fails to load (checks every { error })', async () => {
    hooks.failRead = (t) => t === 'audit_logs';
    const { getTag } = await controllers();

    const out = await call(getTag, makeReq({}, { tagId: OLD_TAG }));

    expect(out.threw?.code).toBe('unavailable');
  });
});

// ── Suspend / unsuspend ─────────────────────────────────────────────────────

describe('suspend', () => {
  it('requires a typed reason and never calls the database without one', async () => {
    rpcAnswer(() => ({ data: 'SUSPENDED', error: null }));
    const { suspendTag } = await controllers();

    const out = await call(suspendTag, makeReq({ reason: 'short' }, { tagId: OLD_TAG }));

    expect(out.threw?.code).toBe('invalid_argument');
    expect(rpcCalls).toHaveLength(0);
    expect(adminEvents()[0]).toMatchObject({ action: 'suspend', result: 'invalid_argument' });
  });

  it('suspends through the database function with the acting admin and reason', async () => {
    rpcAnswer(() => ({ data: 'SUSPENDED', error: null }));
    const { suspendTag } = await controllers();

    const out = await call(suspendTag, makeReq({ reason: REASON }, { tagId: OLD_TAG }));

    expect(out.threw).toBeNull();
    expect(out.body).toMatchObject({ success: true, data: { tagId: OLD_TAG, lifecycleStatus: 'SUSPENDED' } });
    expect(rpcCalls).toEqual([{
      fn: 'admin_set_tag_suspension',
      args: { p_tag: OLD_TAG, p_suspend: true, p_admin: ADMIN, p_reason: REASON },
    }]);
    expect(adminEvents()[0]).toMatchObject({
      action: 'suspend', result: 'ok', tag_id: OLD_TAG, actor_id: ADMIN, actor_type: 'admin',
    });
    // The free-text reason stays in the audit row, never in the log line.
    expect(JSON.stringify(adminEvents())).not.toContain(REASON);
  });

  it('unsuspends with p_suspend=false', async () => {
    rpcAnswer(() => ({ data: 'ACTIVE', error: null }));
    const { unsuspendTag } = await controllers();

    const out = await call(unsuspendTag, makeReq({ reason: REASON }, { tagId: OLD_TAG }));

    expect(out.body).toMatchObject({ data: { lifecycleStatus: 'ACTIVE' } });
    expect(rpcCalls[0].args).toMatchObject({ p_suspend: false });
    expect(adminEvents()[0]).toMatchObject({ action: 'unsuspend', result: 'ok' });
  });

  it.each([
    ['invalid_state: only an ACTIVE tag can be suspended (is RETIRED)', 'conflict', 'conflict'],
    ['admin_forbidden: actor lacks manage_nfc', 'permission_denied', 'forbidden'],
    ['tag_not_found', 'not_found', 'not_found'],
  ])('maps "%s" to %s', async (dbMessage, code, result) => {
    rpcAnswer(() => ({ data: null, error: { message: dbMessage } }));
    const { suspendTag } = await controllers();

    const out = await call(suspendTag, makeReq({ reason: REASON }, { tagId: OLD_TAG }));

    expect(out.threw?.code).toBe(code);
    expect(out.threw?.message).not.toContain(dbMessage);
    expect(adminEvents()[0]).toMatchObject({ result });
  });
});

// ── Token reset ─────────────────────────────────────────────────────────────

describe('reset', () => {
  const body = (overrides: Row = {}) => ({ newTagId: NEW_TAG, reason: REASON, confirmSuffix: '936980', ...overrides });

  it('calls admin_reset_token once with a freshly minted proof for the NEW chip', async () => {
    rpcAnswer(() => ({ data: { old_tag_id: OLD_TAG, new_tag_id: NEW_TAG, owner_id: OWNER }, error: null }));
    const { resetTag } = await controllers();

    const out = await call(resetTag, makeReq(body(), { tagId: OLD_TAG }));

    expect(out.threw).toBeNull();
    expect(out.body).toMatchObject({
      success: true,
      data: { oldTagId: OLD_TAG, newTagId: NEW_TAG, oldLifecycleStatus: 'RETIRED', newLifecycleStatus: 'ACTIVE', destructionStatus: 'PENDING' },
    });
    expect(rpcCalls).toHaveLength(1);
    const { fn, args } = rpcCalls[0];
    expect(fn).toBe('admin_reset_token');
    expect(args).toMatchObject({ p_old_tag: OLD_TAG, p_new_tag: NEW_TAG, p_admin: ADMIN, p_reason: REASON });
    expect(args.p_custody_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(args.p_ownership_id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(typeof args.p_salt_enc).toBe('string');
    // The response never carries the new Ownership ID or its salt.
    expect(JSON.stringify(out.body)).not.toContain(args.p_ownership_id as string);
    expect(adminEvents()[0]).toMatchObject({ action: 'reset', result: 'ok', tag_id: OLD_TAG, new_tag_id: NEW_TAG });
  });

  it('accepts the confirmation in lower case', async () => {
    rpcAnswer(() => ({ data: {}, error: null }));
    const { resetTag } = await controllers();

    const out = await call(resetTag, makeReq(body({ confirmSuffix: '936980'.toLowerCase() }), { tagId: OLD_TAG }));

    expect(out.threw).toBeNull();
  });

  it('refuses when the typed UID suffix does not match the chip being retired', async () => {
    rpcAnswer(() => ({ data: {}, error: null }));
    const { resetTag } = await controllers();

    // The NEW chip's suffix — the classic slip.
    const out = await call(resetTag, makeReq(body({ confirmSuffix: 'ACC040' }), { tagId: OLD_TAG }));

    expect(out.threw?.code).toBe('invalid_argument');
    expect(rpcCalls).toHaveLength(0);
    expect(adminEvents()[0]).toMatchObject({ action: 'reset', result: 'invalid_argument' });
  });

  // S-ADMIN1 Ph2: every chip in the current lot ends in …936980, so a v2 chip
  // is confirmed on the last 6 of its SERIAL, never the shared UID suffix.
  it('confirms a v2 chip on its serial suffix and refuses the shared UID suffix', async () => {
    tables.nfc_tags[0] = { ...tables.nfc_tags[0], chip_serial: '7F6509CC4DAE6CA9', sdm_key_version: 2 };
    rpcAnswer(() => ({ data: {}, error: null }));
    const { resetTag } = await controllers();

    const byUid = await call(resetTag, makeReq(body({ confirmSuffix: '936980' }), { tagId: OLD_TAG }));
    expect(byUid.threw?.code).toBe('invalid_argument');
    expect(rpcCalls).toHaveLength(0);

    const bySerial = await call(resetTag, makeReq(body({ confirmSuffix: 'ae6ca9' }), { tagId: OLD_TAG }));
    expect(bySerial.threw).toBeNull();
    expect(rpcCalls).toHaveLength(1);
  });

  it('touches nothing when the salt key is missing (mints before any database call)', async () => {
    rpcAnswer(() => ({ data: {}, error: null }));
    delete process.env.OWNERSHIP_SALT_KEY;
    const { resetTag } = await controllers();

    const out = await call(resetTag, makeReq(body(), { tagId: OLD_TAG }));

    expect(out.threw).not.toBeNull();
    expect(rpcCalls).toHaveLength(0);
  });

  it('requires a reason and rejects unknown fields', async () => {
    rpcAnswer(() => ({ data: {}, error: null }));
    const { resetTag } = await controllers();

    expect((await call(resetTag, makeReq(body({ reason: '' }), { tagId: OLD_TAG }))).threw?.code).toBe('invalid_argument');
    expect((await call(resetTag, makeReq(body({ ownerId: OWNER }), { tagId: OLD_TAG }))).threw?.code).toBe('invalid_argument');
    expect(rpcCalls).toHaveLength(0);
  });

  it('404s an unknown old tag without calling the database function', async () => {
    rpcAnswer(() => ({ data: {}, error: null }));
    const { resetTag } = await controllers();

    const out = await call(resetTag, makeReq(body(), { tagId: '99999999-9999-4999-8999-999999999999' }));

    expect(out.threw?.code).toBe('not_found');
    expect(rpcCalls).toHaveLength(0);
  });

  it.each([
    ['new_tag_not_enrolled: ACTIVE', 'conflict', 'conflict'],
    ['old_tag_no_owner', 'conflict', 'conflict'],
    ['old_tag_invalid_state: RETIRED', 'conflict', 'conflict'],
    ['transfer_pending', 'conflict', 'transfer_pending'],
    ['same_tag', 'invalid_argument', 'invalid_argument'],
    ['new_tag_not_found', 'not_found', 'not_found'],
    ['admin_forbidden: actor lacks manage_nfc', 'permission_denied', 'forbidden'],
  ])('maps "%s" to %s', async (dbMessage, code, result) => {
    rpcAnswer(() => ({ data: null, error: { message: dbMessage } }));
    const { resetTag } = await controllers();

    const out = await call(resetTag, makeReq(body(), { tagId: OLD_TAG }));

    expect(out.threw?.code).toBe(code);
    expect(adminEvents()[0]).toMatchObject({ action: 'reset', result });
  });

  it('turns an unexpected database error into a generic internal error', async () => {
    rpcAnswer(() => ({ data: null, error: { message: 'duplicate key value violates unique constraint "ownership_proofs_ownership_id_key"' } }));
    const { resetTag } = await controllers();

    const out = await call(resetTag, makeReq(body(), { tagId: OLD_TAG }));

    expect(out.threw?.code).toBe('internal');
    expect(out.threw?.message).not.toMatch(/duplicate|constraint/);
    expect(adminEvents()[0]).toMatchObject({ result: 'internal' });
  });
});
