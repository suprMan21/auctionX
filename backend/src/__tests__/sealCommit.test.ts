import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'crypto';
import {
  buildPiccPlaintext,
  buildSunUrl,
  computeSdmMac,
  encryptPiccBlock,
  v2MacInput,
} from '../services/nfc/ntag424Codec';
import { createLocalTagKeyProvider } from '../services/nfc/keys/tagKeyProvider';
import { createMockSupabase, resetMockIds, type MockHooks, type Tables, type Row } from './helpers/supabaseMock';
import { spyOnSecurityEvents, type SecurityEventSpy } from './helpers/securityEvents';

/**
 * S-MOB2 Ph A — the seal commit (POST /nfc/seal).
 *
 * Taps are REAL v2 AN12196 SUN messages. The database function commit_seal
 * cannot run in memory: its counter / state rules are covered by
 * supabase/tests/s_mob2_seal_live.sql. Here we prove what the backend owns:
 * Creator only, same seal, both MACs, counters above the baseline, nothing
 * written before the checks pass, and every commit_seal outcome mapped to the
 * right client reason.
 */

const TEST_SDM_ROOT = '5A'.repeat(32);
const UID = '04A27E02936980';
const SERIAL = '5A1E7C0D93B2468F';
const OTHER_SERIAL = 'C3D24B19E0F7A651';
const SHA = 'ab'.repeat(32);

const CREATOR = '11111111-1111-4111-8111-111111111111';
const COLLECTOR = '22222222-2222-4222-8222-222222222222';
const STAFF = '44444444-4444-4444-8444-444444444444';
const TAG_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_TAG_ID = '77777777-7777-4777-8777-777777777777';
const SEAL_ID = '88888888-8888-4888-8888-888888888888';

const KEYS: Record<string, Buffer> = {};

beforeAll(async () => {
  const provider = createLocalTagKeyProvider({ sdmRootKeyHex: TEST_SDM_ROOT, allowLocalKeys: true });
  const audit = { ctx: { requestId: 'setup', actorId: null, actorType: 'system' as const, ip: 'test', route: 'setup' } };
  const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
  const uid = Buffer.from(UID, 'hex');
  KEYS.meta2 = await provider.deriveKey({ role: 'META', version: 2 }, audit);
  for (const s of [SERIAL, OTHER_SERIAL]) {
    KEYS[s] = await provider.deriveKey({ role: 'FILE', version: 2, uid, serial: Buffer.from(s, 'hex') }, audit);
  }
  quiet.mockRestore();
});

/** What the chip mirrors on a read. `forge` flips the MAC. */
const sunFor = (counter: number, serial: string = SERIAL, forge = false): string => {
  const uid = Buffer.from(UID, 'hex');
  const plain = buildPiccPlaintext(uid, counter, Buffer.from('0102030405', 'hex'));
  const enc = encryptPiccBlock(plain, KEYS.meta2).toString('hex').toUpperCase();
  const mac = computeSdmMac(KEYS[serial], uid, plain.subarray(8, 11), v2MacInput(serial, enc));
  if (forge) mac[0] ^= 0xff;
  return buildSunUrl('https://am.example', 'token_01', enc, mac.toString('hex').toUpperCase(), serial);
};

// ── Harness ─────────────────────────────────────────────────────────────────

let tables: Tables;
let hooks: MockHooks;
let logSpy: SecurityEventSpy;
let rpcCalls: Array<{ fn: string; args: Row }>;
let rpcStatus: Row;

const tagRow = (overrides: Row = {}): Row => ({
  id: TAG_ID,
  tag_uid: UID,
  chip_serial: SERIAL,
  sdm_key_version: 2,
  lifecycle_status: 'ENROLLED',
  current_owner_id: null,
  seller_id: STAFF,
  sun_counter: 9,
  seal_baseline_counter: 3,
  suspended_at: null,
  verification_id: null,
  status: 'registered',
  ...overrides,
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(tables, hooks),
}));

vi.mock('../lib/stripe', () => ({ getStripe: () => ({ paymentIntents: { create: vi.fn() } }) }));

const makeReq = (userId: string | null, body: Row = {}) => ({
  requestId: 'test-req',
  user: userId ? { id: userId, email: 'x@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' } : undefined,
  headers: {},
  socket: { remoteAddress: '203.0.113.5' },
  ip: '203.0.113.5',
  body,
  params: {},
  query: {},
});

const call = async (fn: (req: never, res: never) => Promise<unknown>, req: ReturnType<typeof makeReq>) => {
  const res: { status: number; body: Row } = { status: 0, body: {} };
  const handler = {
    status(code: number) { res.status = code; return this; },
    json(payload: Row) { res.body = payload; return this; },
    headersSent: false,
  };
  try {
    await fn(req as never, handler as never);
    return { ...res, threw: null as { code?: string; message: string; details?: { reason?: string } } | null };
  } catch (err) {
    return { ...res, threw: err as { code?: string; message: string; details?: { reason?: string } } };
  }
};

const commitBody = (overrides: Row = {}): Row => ({
  serial: SERIAL,
  // Older than the chip's latest public tap (9): the delayed-sync case.
  tap1: sunFor(6),
  tap2: sunFor(7),
  videoSha256: SHA,
  tap1DeviceAt: '2026-10-29T20:00:00.000Z',
  tap2DeviceAt: '2026-10-29T20:01:30.000Z',
  ...overrides,
});

const controller = async () => import('../controllers/sealController');

beforeEach(() => {
  resetMockIds();
  vi.resetModules();
  process.env.OWNERSHIP_SALT_KEY = randomBytes(32).toString('base64');
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  process.env.NFC_KEY_PROVIDER = 'local';
  process.env.NFC_ALLOW_LOCAL_KEYS = 'true';
  process.env.NFC_LOCAL_SDM_ROOT_KEY = TEST_SDM_ROOT;
  delete process.env.NFC_SDM_KEY_VERSION;

  logSpy = spyOnSecurityEvents();
  rpcCalls = [];
  rpcStatus = { status: 'ok', seal_id: SEAL_ID };
  hooks = {
    rpc: (fn, args) => {
      rpcCalls.push({ fn, args });
      return { data: rpcStatus, error: null };
    },
  };
  tables = {
    nfc_tags: [tagRow(), tagRow({ id: OTHER_TAG_ID, chip_serial: OTHER_SERIAL })],
    users: [
      { id: CREATOR, account_type: 'creator' },
      { id: COLLECTOR, account_type: 'collector' },
    ],
    ownership_proofs: [],
    seal_sessions: [],
  };
});

afterEach(() => {
  logSpy.restore();
});

describe('POST /nfc/seal (commit)', () => {
  it('commits two consecutive delayed taps and rotates the ownership proof', async () => {
    const { commitSeal } = await controller();
    const out = await call(commitSeal, makeReq(CREATOR, commitBody({ appliedBeforeRecording: true })));

    expect(out.threw).toBeNull();
    expect(out.status).toBe(201);
    expect(out.body.data).toMatchObject({ tagId: TAG_ID, sealId: SEAL_ID, lifecycleStatus: 'ACTIVE', videoStatus: 'pending_upload' });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('commit_seal');
    expect(rpcCalls[0].args).toMatchObject({
      p_tag_id: TAG_ID,
      p_creator_id: CREATOR,
      p_tap1_counter: 6,
      p_tap2_counter: 7,
      p_video_sha256: SHA,
      p_session_id: null,
      p_applied_before_recording: true,
    });
    const proofs = tables.ownership_proofs.filter((p) => p.tag_id === TAG_ID && p.status === 'current');
    expect(proofs).toHaveLength(1);
    expect(proofs[0].owner_id).toBe(CREATOR);
    // The backend never burns the counter itself: commit_seal owns that.
    expect(tables.nfc_tags.find((t) => t.id === TAG_ID)?.sun_counter).toBe(9);
    expect(logSpy.named('nfc.claim').at(-1)).toMatchObject({ result: 'ok', tag_id: TAG_ID, route: '/api/v1/nfc/seal' });
    expect(logSpy.named('nfc.sun_verify').every((e) => e.context === 'seal')).toBe(true);
  });

  it('refuses a collector account before reading any tap', async () => {
    const { commitSeal } = await controller();
    const out = await call(commitSeal, makeReq(COLLECTOR, commitBody()));

    expect(out.threw?.details?.reason).toBe('creator_only');
    expect(rpcCalls).toHaveLength(0);
    expect(logSpy.named('nfc.sun_verify')).toHaveLength(0);
  });

  it('refuses taps of a different seal than the one the step-up named', async () => {
    const { commitSeal } = await controller();
    const out = await call(commitSeal, makeReq(CREATOR, commitBody({ tap2: sunFor(7, OTHER_SERIAL) })));

    expect(out.threw?.code).toBe('invalid_argument');
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a serial-less (v1) tap URL', async () => {
    const { commitSeal } = await controller();
    const v1 = sunFor(6).replace(/sn=[0-9A-F]+&/, '');
    const out = await call(commitSeal, makeReq(CREATOR, commitBody({ tap1: v1 })));

    expect(out.threw?.code).toBe('invalid_argument');
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a forged MAC on either tap as invalid_signature', async () => {
    const { commitSeal } = await controller();
    const out = await call(commitSeal, makeReq(CREATOR, commitBody({ tap2: sunFor(7, SERIAL, true) })));

    expect(out.threw?.details?.reason).toBe('invalid_signature');
    expect(rpcCalls).toHaveLength(0);
    expect(tables.ownership_proofs).toHaveLength(0);
  });

  it('refuses a tap at or below the seal baseline as replay_detected', async () => {
    const { commitSeal } = await controller();
    const out = await call(commitSeal, makeReq(CREATOR, commitBody({ tap1: sunFor(3), tap2: sunFor(4) })));

    expect(out.threw?.details?.reason).toBe('replay_detected');
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses an unknown seal as not_found', async () => {
    tables.nfc_tags = [];
    const { commitSeal } = await controller();
    const out = await call(commitSeal, makeReq(CREATOR, commitBody()));

    expect(out.threw?.code).toBe('not_found');
    expect(rpcCalls).toHaveLength(0);
  });

  it.each([
    ['gap', 'seal_gap'],
    ['counter_spent', 'replay_detected'],
    ['below_baseline', 'replay_detected'],
    ['already_claimed', 'already_claimed'],
    ['not_sealable', 'not_sealable'],
    ['session_invalid', 'tap_session_invalid'],
  ])('maps commit_seal %s to the client reason %s and records no proof', async (status, reason) => {
    rpcStatus = { status };
    const { commitSeal } = await controller();
    const out = await call(commitSeal, makeReq(CREATOR, commitBody()));

    expect(out.threw?.details?.reason).toBe(reason);
    expect(tables.ownership_proofs).toHaveLength(0);
  });

  it('never sends a database error message to the client', async () => {
    hooks.rpc = () => ({ data: null, error: { message: 'relation "secret_internal" does not exist' } });
    const { commitSeal } = await controller();
    const out = await call(commitSeal, makeReq(CREATOR, commitBody()));

    expect(out.threw?.code).toBe('internal');
    expect(out.threw?.message).not.toContain('secret_internal');
  });

  it('rejects a malformed video hash and unknown fields', async () => {
    const { commitSeal } = await controller();
    const bad = await call(commitSeal, makeReq(CREATOR, commitBody({ videoSha256: 'AB'.repeat(32) })));
    const extra = await call(commitSeal, makeReq(CREATOR, commitBody({ ownerId: COLLECTOR })));

    expect(bad.threw?.code).toBe('invalid_argument');
    expect(extra.threw?.code).toBe('invalid_argument');
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('POST /nfc/seal/session', () => {
  it('starts a session for a creator without saying whether the serial exists', async () => {
    const { startSealSession } = await controller();
    const out = await call(startSealSession, makeReq(CREATOR, { serial: 'FFFFFFFFFFFFFFFF' }));

    expect(out.threw).toBeNull();
    expect(out.status).toBe(201);
    expect(tables.seal_sessions).toHaveLength(1);
    expect(tables.seal_sessions[0]).toMatchObject({ creator_id: CREATOR, chip_serial: 'FFFFFFFFFFFFFFFF' });
  });

  it('refuses a collector', async () => {
    const { startSealSession } = await controller();
    const out = await call(startSealSession, makeReq(COLLECTOR, { serial: SERIAL }));

    expect(out.threw?.details?.reason).toBe('creator_only');
    expect(tables.seal_sessions).toHaveLength(0);
  });
});

describe('seal step-up rules', () => {
  it('is a step-up action that an authenticator code may confirm, refused during a recovery freeze', async () => {
    const mfa = await import('../lib/mfa/mfaService');
    expect(mfa.STEP_UP_ACTIONS).toContain('seal');
    expect(mfa.TOTP_STEP_UP_ACTIONS).toContain('seal');
    expect(mfa.FROZEN_STEP_UP_ACTIONS).toContain('seal');
    // Never a backup code (CODE_STEP_UP_ACTIONS is the backup-code list).
    expect(mfa.CODE_STEP_UP_ACTIONS).not.toContain('seal');
  });
});
