import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'crypto';
import {
  buildPiccPlaintext,
  buildSunUrl,
  computeSdmMac,
  deriveSessionMacKey,
  encryptPiccBlock,
} from '../services/nfc/ntag424Codec';
import { createLocalTagKeyProvider } from '../services/nfc/keys/tagKeyProvider';
import { createMockSupabase, resetMockIds, type MockHooks, type Tables, type Row } from './helpers/supabaseMock';
import { testAudit } from './helpers/sdmVectors';

/**
 * S-NFC3.5 — the public scan endpoint, and key hygiene over a FULL flow.
 *
 * Hygiene: run scan -> claim -> transfer initiate -> transfer complete (plus
 * every rejection path) with console.log/info/warn/error captured — which is
 * where both the structured logger and the security-event emitter write —
 * then assert that no derived key (META, FILE, SDM session MAC key) and no
 * root appears anywhere in: captured output, HTTP response bodies, or the
 * database rows the flow wrote.
 */

const SDM_ROOT = 'C3'.repeat(32);
const UID = '04A27E02936980';
const OTHER_UID = '04DE5F1EACC040';
const TAG_ID = '55555555-5555-4555-8555-555555555555';
const OWNER = '11111111-1111-4111-8111-111111111111';
const BUYER = '22222222-2222-4222-8222-222222222222';

let META: Buffer;
const FILE = new Map<string, Buffer>();

beforeAll(async () => {
  const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
  const p = createLocalTagKeyProvider({ sdmRootKeyHex: SDM_ROOT, allowLocalKeys: true });
  META = await p.deriveKey({ role: 'META', version: 1 }, testAudit);
  for (const u of [UID, OTHER_UID]) {
    FILE.set(u, await p.deriveKey({ role: 'FILE', version: 1, uid: Buffer.from(u, 'hex') }, testAudit));
  }
  quiet.mockRestore();
});

const tapParts = (counter: number, uid = UID) => {
  const u = Buffer.from(uid, 'hex');
  const plain = buildPiccPlaintext(u, counter, Buffer.from('A1B2C3D4E5', 'hex'));
  return {
    picc: encryptPiccBlock(plain, META).toString('hex').toUpperCase(),
    mac: computeSdmMac(FILE.get(uid) as Buffer, u, plain.subarray(8, 11), Buffer.alloc(0)).toString('hex').toUpperCase(),
    ctrLE: Buffer.from(plain.subarray(8, 11)),
  };
};
const sunFor = (counter: number, uid = UID): string => {
  const t = tapParts(counter, uid);
  return buildSunUrl('https://am.example', 'tok', t.picc, t.mac);
};

let tables: Tables;
let hooks: MockHooks;
let output: string[];
let spies: Array<ReturnType<typeof vi.spyOn>>;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => createMockSupabase(tables, hooks) }));
const stripeCreate = vi.fn();
vi.mock('../lib/stripe', () => ({ getStripe: () => ({ paymentIntents: { create: stripeCreate } }) }));

const tagRow = (overrides: Row = {}): Row => ({
  id: TAG_ID,
  tag_uid: UID,
  sdm_key_version: 1,
  lifecycle_status: 'ENROLLED',
  current_owner_id: null,
  seller_id: OWNER,
  sun_counter: 0,
  disclosure: { origin_video: false, creator_name: false, claim_date: false, location: false },
  linked_item_id: null,
  verification_id: null,
  status: 'registered',
  ...overrides,
});

const makeReq = (userId: string | null, body: Row = {}, params: Row = {}) => ({
  requestId: 'test-req',
  path: '/scan',
  ip: '203.0.113.5',
  user: userId ? { id: userId } : undefined,
  headers: { authorization: userId ? 'Bearer header.eyJhYWwiOiJhYWwxIn0.sig' : undefined, 'user-agent': 'vitest' },
  socket: { remoteAddress: '203.0.113.5' },
  body,
  params,
});

const responses: unknown[] = [];
const call = async (fn: (req: never, res: never) => Promise<unknown>, req: ReturnType<typeof makeReq>) => {
  const res: { status: number; body: Row } = { status: 200, body: {} };
  const handler = {
    status(code: number) { res.status = code; return this; },
    json(payload: Row) { res.body = payload; responses.push(payload); return this; },
    headersSent: false,
  };
  let threw: { code?: string; message: string; details?: Row } | null = null;
  try {
    await fn(req as never, handler as never);
  } catch (err) {
    threw = err as typeof threw;
    responses.push({ message: (err as Error).message, details: (err as { details?: unknown }).details });
  }
  return { ...res, threw };
};

beforeEach(() => {
  resetMockIds();
  vi.resetModules();
  stripeCreate.mockReset();
  stripeCreate.mockResolvedValue({ id: 'pi_test_1', client_secret: 'cs_test_1' });
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  process.env.OWNERSHIP_SALT_KEY = randomBytes(32).toString('base64');
  process.env.NFC_KEY_PROVIDER = 'local';
  process.env.NFC_ALLOW_LOCAL_KEYS = 'true';
  process.env.NFC_LOCAL_SDM_ROOT_KEY = SDM_ROOT;
  delete process.env.FEATURE_REQUIRE_2FA;
  hooks = {};
  responses.length = 0;
  tables = {
    nfc_tags: [tagRow()],
    verification_events: [],
    item_verifications: [],
    ownership_transfers: [],
    ownership_proofs: [],
    users: [
      { id: OWNER, role: 'user', email: 'owner@example.com', billing_country: 'US' },
      { id: BUYER, role: 'user', email: 'buyer@example.com', billing_country: 'US' },
    ],
  };
  output = [];
  const capture = (...args: unknown[]) => { output.push(args.map(String).join(' ')); };
  spies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(capture));
});

afterEach(() => spies.forEach((s) => s.mockRestore()));

const nfc = async () => import('../controllers/nfcController');
const mgmt = async () => import('../controllers/tagManagementController');
const events = (name: string) =>
  output
    .map((l) => { try { return JSON.parse(l) as Row; } catch { return null; } })
    .filter((e): e is Row => e !== null && e.event === name);

describe('POST /nfc/scan (AN12196)', () => {
  it('identifies the chip from one META decrypt and accepts a fresh tap', async () => {
    const { scanTag } = await nfc();
    const out = await call(scanTag, makeReq(null, { sunMessage: sunFor(1) }));

    expect(out.status).toBe(200);
    expect(out.body.data).toMatchObject({ valid: true, tagId: TAG_ID, counterValue: 1 });
    expect(tables.nfc_tags[0].sun_counter).toBe(1);
    expect(tables.nfc_tags[0].status).toBe('active');
    expect(events('nfc.sun_verify')[0]).toMatchObject({ context: 'verify', sun_result: 'ok', result: 'ok' });
    // META once + FILE once — no trial decryption across tags.
    expect(events('kms.op').filter((e) => e.operation === 'GenerateMac')).toHaveLength(2);
  });

  it('replayed URL -> replay_detected', async () => {
    const { scanTag } = await nfc();
    const url = sunFor(1);
    await call(scanTag, makeReq(null, { sunMessage: url }));
    const out = await call(scanTag, makeReq(null, { sunMessage: url }));

    expect(out.body.data).toMatchObject({ valid: false, reason: 'replay_detected' });
    expect(events('nfc.sun_verify').at(-1)).toMatchObject({ sun_result: 'replay_detected' });
  });

  it('one flipped MAC byte -> invalid_signature, counter untouched', async () => {
    const { scanTag } = await nfc();
    const t = tapParts(1);
    const mac = Buffer.from(t.mac, 'hex');
    mac[0] ^= 0x01;
    const out = await call(scanTag, makeReq(null, { sunMessage: buildSunUrl('https://am.example', 'tok', t.picc, mac.toString('hex')) }));

    expect(out.body.data).toMatchObject({ valid: false, reason: 'invalid_signature' });
    expect(tables.nfc_tags[0].sun_counter).toBe(0);
  });

  it('direct mode: Tag-A PICC/MAC with Tag-B UID fails', async () => {
    tables.nfc_tags.push(tagRow({ id: '66666666-6666-4666-8666-666666666666', tag_uid: OTHER_UID }));
    const { scanTag } = await nfc();
    const t = tapParts(1, UID);
    const out = await call(scanTag, makeReq(null, { piccData: t.picc, cmac: t.mac, tagUid: OTHER_UID }));

    expect(out.body.data).toMatchObject({ valid: false, reason: 'invalid_signature' });
    expect(tables.nfc_tags.every((r) => r.sun_counter === 0)).toBe(true);
  });

  it('an un-enrolled chip is not found; garbage is not found', async () => {
    tables.nfc_tags = [];
    const { scanTag } = await nfc();
    expect((await call(scanTag, makeReq(null, { sunMessage: sunFor(1) }))).status).toBe(404);
    expect(events('nfc.sun_verify').at(-1)).toMatchObject({ sun_result: 'unknown_tag' });

    const garbage = buildSunUrl('https://am.example', 'tok', '00'.repeat(16), '00'.repeat(8));
    expect((await call(scanTag, makeReq(null, { sunMessage: garbage }))).status).toBe(404);
  });

  it('a chip stamped with a different key version does not verify under v1', async () => {
    tables.nfc_tags[0].sdm_key_version = 2;
    const { scanTag } = await nfc();
    expect((await call(scanTag, makeReq(null, { sunMessage: sunFor(1) }))).status).toBe(404);
  });

  it('race: the conditional counter burn matching no row -> replay_detected', async () => {
    hooks.beforeUpdate = (table, patch) => {
      if (table === 'nfc_tags' && 'sun_counter' in patch) tables.nfc_tags[0].sun_counter = 1;
    };
    const { scanTag } = await nfc();
    const out = await call(scanTag, makeReq(null, { sunMessage: sunFor(1) }));

    expect(out.body.data).toMatchObject({ valid: false, reason: 'replay_detected' });
    expect(tables.verification_events.at(-1)).toMatchObject({ cmac_valid: false });
  });
});

describe('no chip key material in logs, events, responses or the DB over a full flow', () => {
  it('scan -> claim -> transfer -> complete, plus rejections', async () => {
    const { scanTag } = await nfc();
    const { claimTag, initiateTransfer, completeTransfer, enrollTag } = await mgmt();

    await call(scanTag, makeReq(null, { sunMessage: sunFor(1) }));
    await call(scanTag, makeReq(null, { sunMessage: sunFor(1) })); // replay
    await call(claimTag, makeReq(OWNER, { tagUid: UID, sunMessage: sunFor(1) })); // stale
    await call(claimTag, makeReq(OWNER, { tagUid: UID, sunMessage: sunFor(2).replace(/cmac=\w+/, 'cmac=0011223344556677') }));
    const claimed = await call(claimTag, makeReq(OWNER, { tagUid: UID, sunMessage: sunFor(2) }));
    expect(claimed.threw).toBeNull();
    await call(initiateTransfer, makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toUserId: BUYER }));
    const transferId = String(tables.ownership_transfers[0].id);
    await call(completeTransfer, makeReq(BUYER, { tagUid: UID, sunMessage: sunFor(3, OTHER_UID) }, { id: transferId }));
    const done = await call(completeTransfer, makeReq(BUYER, { tagUid: UID, sunMessage: sunFor(3) }, { id: transferId }));
    expect(done.threw).toBeNull();
    await call(enrollTag, makeReq(OWNER, { tagUid: OTHER_UID }));

    // The flow really ran, and really derived keys.
    expect(events('kms.op').length).toBeGreaterThanOrEqual(8);
    expect(tables.nfc_tags[0].sun_counter).toBe(3);

    const secrets: string[] = [SDM_ROOT, META.toString('hex')];
    for (const [uid, key] of FILE) {
      secrets.push(key.toString('hex'));
      for (const c of [1, 2, 3]) {
        const ctr = tapParts(c, uid).ctrLE;
        secrets.push(deriveSessionMacKey(key, Buffer.from(uid, 'hex'), ctr).toString('hex'));
      }
    }

    const haystack = [
      output.join('\n'),
      JSON.stringify(responses),
      JSON.stringify(tables),
    ].join('\n').toUpperCase();

    for (const s of secrets) expect(haystack).not.toContain(s.toUpperCase());
    // And no row anywhere carries a key column.
    expect(JSON.stringify(tables)).not.toMatch(/aes_key|aesKey/);
  });
});
