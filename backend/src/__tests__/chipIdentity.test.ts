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
 * S-NFC-ID — chip identity is our per-chip serial (KDF v2), not the UID.
 *
 * The fixture is the real 2026-10-05 situation: three physical chips report
 * one UID. `chip_001` is a v1 row (UID identity); TWIN_A and TWIN_B are v2 rows
 * with their own serials. Every tap below is a real AN12196 SUN message.
 */

const TEST_SDM_ROOT = '5A'.repeat(32);
const DUP_UID = '04A27E02936980';
const SERIAL_A = '5A1E7C0D93B2468F';
const SERIAL_B = 'C3D24B19E0F7A651';
const SIG_A = 'a'.repeat(64);
const SIG_B = 'b'.repeat(64);

const OWNER = '11111111-1111-4111-8111-111111111111';
const STAFF = '44444444-4444-4444-8444-444444444444';
const V1_ID = '55555555-5555-4555-8555-555555555555';
const A_ID = '66666666-6666-4666-8666-666666666666';
const B_ID = '77777777-7777-4777-8777-777777777777';
const ROLE_NFC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const KEYS: Record<string, Buffer> = {};

beforeAll(async () => {
  const provider = createLocalTagKeyProvider({ sdmRootKeyHex: TEST_SDM_ROOT, allowLocalKeys: true });
  const audit = {
    ctx: { requestId: 'setup', actorId: null, actorType: 'system' as const, ip: 'test', route: 'setup' },
  };
  const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
  const uid = Buffer.from(DUP_UID, 'hex');
  KEYS.meta1 = await provider.deriveKey({ role: 'META', version: 1 }, audit);
  KEYS.meta2 = await provider.deriveKey({ role: 'META', version: 2 }, audit);
  KEYS.v1 = await provider.deriveKey({ role: 'FILE', version: 1, uid }, audit);
  KEYS[SERIAL_A] = await provider.deriveKey({ role: 'FILE', version: 2, uid, serial: Buffer.from(SERIAL_A, 'hex') }, audit);
  KEYS[SERIAL_B] = await provider.deriveKey({ role: 'FILE', version: 2, uid, serial: Buffer.from(SERIAL_B, 'hex') }, audit);
  quiet.mockRestore();
});

/** What a chip mirrors on a tap. `serial` given = a v2 chip (MAC covers sn..cmac=). */
const sunFor = (counter: number, serial?: string): string => {
  const uid = Buffer.from(DUP_UID, 'hex');
  const plain = buildPiccPlaintext(uid, counter, Buffer.from('0102030405', 'hex'));
  const meta = serial === undefined ? KEYS.meta1 : KEYS.meta2;
  const enc = encryptPiccBlock(plain, meta).toString('hex').toUpperCase();
  const macInput = serial === undefined ? Buffer.alloc(0) : v2MacInput(serial, enc);
  const fileKey = serial === undefined ? KEYS.v1 : KEYS[serial];
  const mac = computeSdmMac(fileKey, uid, plain.subarray(8, 11), macInput).toString('hex').toUpperCase();
  return buildSunUrl('https://am.example', 'token_01', enc, mac, serial);
};

// ── Harness ─────────────────────────────────────────────────────────────────

let tables: Tables;
let hooks: MockHooks;
let logSpy: SecurityEventSpy;

const tagRow = (overrides: Row): Row => ({
  tag_uid: DUP_UID,
  chip_serial: null,
  originality_sig_sha256: null,
  sdm_key_version: 1,
  lifecycle_status: 'ENROLLED',
  current_owner_id: null,
  seller_id: STAFF,
  sun_counter: 0,
  disclosure: { origin_video: false, creator_name: false, claim_date: false, location: false },
  linked_item_id: null,
  verification_id: null,
  status: 'registered',
  ...overrides,
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(tables, hooks),
}));

vi.mock('../lib/stripe', () => ({
  getStripe: () => ({ paymentIntents: { create: vi.fn() } }),
}));

const makeReq = (userId: string | null, body: Row = {}, params: Row = {}, query: Row = {}) => ({
  requestId: 'test-req',
  user: userId ? { id: userId, email: 'x@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' } : undefined,
  headers: { authorization: userId ? 'Bearer header.eyJhYWwiOiJhYWwxIn0.sig' : undefined },
  socket: { remoteAddress: '203.0.113.5' },
  ip: '203.0.113.5',
  body,
  params,
  query,
});

const call = async (fn: (req: never, res: never) => Promise<unknown>, req: ReturnType<typeof makeReq>) => {
  const res: { status: number; body: Row } = { status: 0, body: {} };
  const handler = {
    status(code: number) { res.status = code; return this; },
    json(payload: Row) { res.body = payload; return this; },
    setHeader() {},
    headersSent: false,
  };
  try {
    await fn(req as never, handler as never);
    return { ...res, threw: null as { code?: string; message: string } | null };
  } catch (err) {
    return { ...res, threw: err as { code?: string; message: string } };
  }
};

const data = (out: { body: Row }) => out.body.data as Row;
const row = (id: string): Row => tables.nfc_tags.find((r) => r.id === id) as Row;

beforeEach(() => {
  resetMockIds();
  vi.resetModules();
  process.env.OWNERSHIP_SALT_KEY = randomBytes(32).toString('base64');
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  delete process.env.FEATURE_REQUIRE_2FA;
  process.env.NFC_KEY_PROVIDER = 'local';
  process.env.NFC_ALLOW_LOCAL_KEYS = 'true';
  process.env.NFC_LOCAL_SDM_ROOT_KEY = TEST_SDM_ROOT;
  delete process.env.NFC_SDM_KEY_VERSION;

  logSpy = spyOnSecurityEvents();
  hooks = {};
  tables = {
    nfc_tags: [
      tagRow({ id: V1_ID }),
      tagRow({ id: A_ID, chip_serial: SERIAL_A, originality_sig_sha256: SIG_A, sdm_key_version: 2 }),
      tagRow({ id: B_ID, chip_serial: SERIAL_B, originality_sig_sha256: SIG_B, sdm_key_version: 2 }),
    ],
    nfc_tap_sessions: [],
    verification_events: [],
    ownership_transfers: [],
    ownership_proofs: [],
    public_tag_provenance: [],
    items: [],
    users: [{ id: OWNER, role: 'user', email: 'owner@example.com', billing_country: 'US' }],
    admin_roles: [{ role_id: ROLE_NFC, role_name: 'admin', permissions: ['manage_nfc'] }],
    admin_users: [{ admin_id: STAFF, role_id: ROLE_NFC, is_active: true }],
  };
});

afterEach(() => logSpy.restore());

const reads = async () => import('../controllers/tokenReadController');
const writes = async () => import('../controllers/tagManagementController');

// ── Public tap ──────────────────────────────────────────────────────────────

describe('POST /nfc/tap with three chips on one UID', () => {
  it.each([
    ['twin A', SERIAL_A, A_ID],
    ['twin B', SERIAL_B, B_ID],
    ['chip_001 (v1)', undefined, V1_ID],
  ])('resolves %s to its own row and burns only that counter', async (_n, serial, id) => {
    const { tapTag } = await reads();
    const out = await call(tapTag, makeReq(null, { sunMessage: sunFor(4, serial) }));

    expect(out.threw).toBeNull();
    expect(data(out)).toMatchObject({ valid: true, tagId: id });
    for (const other of [V1_ID, A_ID, B_ID]) {
      expect(row(other).sun_counter).toBe(other === id ? 4 : 0);
    }
  });

  it("twin A's tap under twin B's serial is not twin B", async () => {
    const swapped = sunFor(4, SERIAL_A).replace(`sn=${SERIAL_A}`, `sn=${SERIAL_B}`);
    const { tapTag } = await reads();
    const out = await call(tapTag, makeReq(null, { sunMessage: swapped }));

    expect(data(out)).toEqual({ valid: false, reason: 'invalid_signature' });
    expect([row(A_ID).sun_counter, row(B_ID).sun_counter]).toEqual([0, 0]);
  });

  it('a v2 tap with the serial stripped never verifies (and never lands on chip_001)', async () => {
    const stripped = sunFor(4, SERIAL_A).replace(`sn=${SERIAL_A}&`, '');
    const { tapTag } = await reads();
    const out = await call(tapTag, makeReq(null, { sunMessage: stripped }));

    expect(out.threw?.code === 'not_found' || data(out)?.valid === false).toBe(true);
    expect([row(V1_ID).sun_counter, row(A_ID).sun_counter]).toEqual([0, 0]);
  });

  it('an unknown serial is a 404, not a fall-back to the UID', async () => {
    const unknown = sunFor(4, SERIAL_A).replace(`sn=${SERIAL_A}`, 'sn=0000000000000000');
    const { tapTag } = await reads();
    const out = await call(tapTag, makeReq(null, { sunMessage: unknown }));

    expect(out.threw?.code).toBe('not_found');
  });

  it('a lowercase or short serial is malformed', async () => {
    const { tapTag } = await reads();
    for (const sn of [SERIAL_A.toLowerCase(), SERIAL_A.slice(2)]) {
      const out = await call(tapTag, makeReq(null, { sunMessage: sunFor(4, SERIAL_A).replace(`sn=${SERIAL_A}`, `sn=${sn}`) }));
      expect(out.threw?.code).toBe('invalid_argument');
    }
  });

  it('a v2 row never accepts a v1-shaped tap, even from the right UID', async () => {
    tables.nfc_tags = tables.nfc_tags.filter((r) => r.id !== V1_ID);
    const { tapTag } = await reads();
    const out = await call(tapTag, makeReq(null, { sunMessage: sunFor(4) }));

    expect(out.threw?.code).toBe('not_found');
    expect([row(A_ID).sun_counter, row(B_ID).sun_counter]).toEqual([0, 0]);
  });
});

// ── Claim with a raw scan (names the tag by UID) ────────────────────────────

describe('claim with a raw scan', () => {
  it('claims the chip whose serial is in the URL, not another chip on the UID', async () => {
    const { claimTag } = await writes();
    const out = await call(claimTag, makeReq(OWNER, { tagUid: DUP_UID, sunMessage: sunFor(2, SERIAL_B) }));

    expect(out.threw).toBeNull();
    expect(row(B_ID)).toMatchObject({ lifecycle_status: 'ACTIVE', current_owner_id: OWNER });
    expect(row(A_ID).current_owner_id).toBeNull();
    expect(row(V1_ID).current_owner_id).toBeNull();
  });

  it('a v1 URL claims chip_001 even though v2 chips share its UID', async () => {
    const { claimTag } = await writes();
    const out = await call(claimTag, makeReq(OWNER, { tagUid: DUP_UID, sunMessage: sunFor(2) }));

    expect(out.threw).toBeNull();
    expect(row(V1_ID).current_owner_id).toBe(OWNER);
  });

  it('a swapped serial claims nothing', async () => {
    const swapped = sunFor(2, SERIAL_A).replace(`sn=${SERIAL_A}`, `sn=${SERIAL_B}`);
    const { claimTag } = await writes();
    const out = await call(claimTag, makeReq(OWNER, { tagUid: DUP_UID, sunMessage: swapped }));

    expect(out.threw).not.toBeNull();
    expect([row(A_ID).current_owner_id, row(B_ID).current_owner_id]).toEqual([null, null]);
  });
});

// ── Encoder registry ────────────────────────────────────────────────────────

describe('enroll precheck (v2)', () => {
  const precheck = async (query: Row) => {
    const { enrollPrecheck } = await writes();
    return call(enrollPrecheck, makeReq(STAFF, {}, { tagUid: DUP_UID }, query));
  };

  it('a new physical chip on a shared UID is free, and the shared UID is reported', async () => {
    const out = await precheck({ serial: 'ABCDEF0123456789', sigSha256: 'c'.repeat(64) });
    expect(data(out)).toEqual({ exists: false, lifecycleStatus: null, uidMatches: 3 });
  });

  it('the same physical chip (fingerprint) is taken, whatever serial it is offered', async () => {
    const out = await precheck({ serial: 'ABCDEF0123456789', sigSha256: SIG_A });
    expect(data(out)).toMatchObject({ exists: true, lifecycleStatus: 'ENROLLED' });
  });

  it('a RETIRED hit wins over a live one', async () => {
    row(B_ID).lifecycle_status = 'RETIRED';
    const out = await precheck({ serial: SERIAL_A, sigSha256: SIG_B });
    expect(data(out)).toMatchObject({ exists: true, lifecycleStatus: 'RETIRED' });
  });

  it('rejects a malformed serial or fingerprint', async () => {
    for (const q of [{ serial: SERIAL_A.toLowerCase() }, { sigSha256: 'A'.repeat(64) }, { other: '1' }]) {
      expect((await precheck(q)).threw?.code).toBe('invalid_argument');
    }
  });

  it('the v1 query (no serial) only ever sees v1 rows', async () => {
    const out = await precheck({});
    expect(data(out)).toEqual({ exists: true, lifecycleStatus: 'ENROLLED', uidMatches: 1 });
  });
});

describe('enroll (v2)', () => {
  const enroll = async (body: Row) => {
    const { enrollTag } = await writes();
    return call(enrollTag, makeReq(STAFF, body));
  };

  it('records the serial, fingerprint and the encoder key version', async () => {
    const out = await enroll({ tagUid: DUP_UID, chipSerial: 'ABCDEF0123456789', sigSha256: 'c'.repeat(64), sdmKeyVersion: 2 });

    expect(out.status).toBe(201);
    const created = tables.nfc_tags.find((r) => r.chip_serial === 'ABCDEF0123456789') as Row;
    expect(created).toMatchObject({
      tag_uid: DUP_UID, originality_sig_sha256: 'c'.repeat(64), sdm_key_version: 2, lifecycle_status: 'ENROLLED',
    });
  });

  it('refuses the same physical chip twice', async () => {
    const out = await enroll({ tagUid: DUP_UID, chipSerial: 'ABCDEF0123456789', sigSha256: SIG_A, sdmKeyVersion: 2 });
    expect(out.threw?.code).toBe('conflict');
  });

  it.each([
    ['a serial without a key version', { chipSerial: 'ABCDEF0123456789', sigSha256: 'c'.repeat(64) }],
    ['a serial at version 1', { chipSerial: 'ABCDEF0123456789', sigSha256: 'c'.repeat(64), sdmKeyVersion: 1 }],
    ['a serial without a fingerprint', { chipSerial: 'ABCDEF0123456789', sdmKeyVersion: 2 }],
    ['version 2 without a serial', { sdmKeyVersion: 2 }],
  ])('rejects %s', async (_n, extra) => {
    const out = await enroll({ tagUid: '04DE5F1EACC040', ...extra });
    expect(out.threw?.code).toBe('invalid_argument');
  });

  it('a v1 enroll stamped v2 by the environment is refused rather than stored without a serial', async () => {
    process.env.NFC_SDM_KEY_VERSION = '2';
    const out = await enroll({ tagUid: '04DE5F1EACC040' });
    expect(out.threw?.code).toBe('invalid_argument');
  });
});

// ── Encoder auto-naming ─────────────────────────────────────────────────────

describe('reserve chip name', () => {
  const NEW_SIG = 'c'.repeat(64);
  let rpcCalls: { fn: string; args: Row }[];

  const reserve = async (body: Row, user: string | null = STAFF) => {
    const { reserveChipName } = await writes();
    return call(reserveChipName, makeReq(user, body));
  };
  const answer = (result: { data: unknown; error: { message: string } | null }) => {
    rpcCalls = [];
    hooks.rpc = (fn, args) => { rpcCalls.push({ fn, args }); return result; };
  };

  it('with no name asks the database for the next chip_NNN', async () => {
    answer({ data: 'chip_005', error: null });
    const out = await reserve({ sigSha256: NEW_SIG });

    expect(data(out)).toEqual({ name: 'chip_005', auto: true });
    expect(rpcCalls).toEqual([
      { fn: 'reserve_chip_name', args: { p_sig_sha256: NEW_SIG, p_name: undefined, p_actor: STAFF } },
    ]);
  });

  it('passes a manual name through the same check', async () => {
    answer({ data: 'gold_run_01', error: null });
    const out = await reserve({ sigSha256: NEW_SIG, name: 'gold_run_01' });

    expect(data(out)).toEqual({ name: 'gold_run_01', auto: false });
    expect(rpcCalls[0].args.p_name).toBe('gold_run_01');
  });

  it.each([
    ['chip_name_taken: chip_004 is already in use'],
    ['chip_already_named: this chip is enrolled as chip_004'],
  ])('a clash is a conflict (%s)', async (message) => {
    answer({ data: null, error: { message } });
    expect((await reserve({ sigSha256: NEW_SIG, name: 'chip_004' })).threw?.code).toBe('conflict');
  });

  it('fails closed when the database gives no definite name', async () => {
    for (const result of [{ data: null, error: { message: 'connection reset' } }, { data: null, error: null }, { data: '', error: null }]) {
      answer(result);
      expect((await reserve({ sigSha256: NEW_SIG })).threw?.code).toBe('unavailable');
    }
  });

  it('rejects a bad fingerprint or name before touching the database', async () => {
    answer({ data: 'chip_005', error: null });
    for (const body of [
      {}, { sigSha256: 'C'.repeat(64) }, { sigSha256: NEW_SIG, name: '' }, { sigSha256: NEW_SIG, name: 'has space' },
      { sigSha256: NEW_SIG, name: '../x' }, { sigSha256: NEW_SIG, name: 'a'.repeat(65) }, { sigSha256: NEW_SIG, other: 1 },
    ]) {
      expect((await reserve(body)).threw?.code).toBe('invalid_argument');
    }
    expect(rpcCalls).toEqual([]);
  });

  it('is refused without manage_nfc', async () => {
    answer({ data: 'chip_005', error: null });
    expect((await reserve({ sigSha256: NEW_SIG }, OWNER)).threw?.code).toBe('permission_denied');
    expect((await reserve({ sigSha256: NEW_SIG }, null)).threw?.code).toBe('unauthenticated');
    expect(rpcCalls).toEqual([]);
  });
});

describe('enroll with a chip name', () => {
  const enroll = async (body: Row) => {
    const { enrollTag } = await writes();
    return call(enrollTag, makeReq(STAFF, body));
  };
  const v2 = { tagUid: DUP_UID, chipSerial: 'ABCDEF0123456789', sigSha256: 'c'.repeat(64), sdmKeyVersion: 2 };

  it('stores the name on the tag row', async () => {
    const out = await enroll({ ...v2, chipName: 'chip_005' });

    expect(out.status).toBe(201);
    expect(tables.nfc_tags.find((r) => r.chip_serial === 'ABCDEF0123456789')).toMatchObject({ chip_name: 'chip_005' });
  });

  it('a name needs the chip fingerprint, and must be well formed', async () => {
    expect((await enroll({ tagUid: '04DE5F1EACC040', chipName: 'chip_005' })).threw?.code).toBe('invalid_argument');
    expect((await enroll({ ...v2, chipName: 'no/slash' })).threw?.code).toBe('invalid_argument');
  });
});
