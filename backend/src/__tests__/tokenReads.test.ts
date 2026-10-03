import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'crypto';
import { keccak256 } from 'viem';
import {
  buildPiccPlaintext,
  buildSunUrl,
  computeSdmMac,
  encryptPiccBlock,
} from '../services/nfc/ntag424Codec';
import { createLocalTagKeyProvider } from '../services/nfc/keys/tagKeyProvider';
import { createMockSupabase, resetMockIds, type Tables, type Row } from './helpers/supabaseMock';
import { spyOnSecurityEvents, type SecurityEventSpy } from './helpers/securityEvents';

/**
 * S-NFC3-FE Ph1 — tap sessions and the token read endpoints.
 *
 * The tap session is the one new piece of security surface in this session:
 * it turns a burned tap into a short-lived proof of possession. The tests
 * below pin each property the design depends on — single use, expiry, chip
 * binding, "a newer tap supersedes", and that a failed or terminal tap never
 * mints one — as behaviour, against REAL AN12196 SUN messages.
 */

const TEST_SDM_ROOT = '5A'.repeat(32);
const TAG_UID = '04A27E02936980';
const OTHER_UID = '04DE5F1EACC040';

const OWNER = '11111111-1111-4111-8111-111111111111';
const BUYER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const STAFF = '44444444-4444-4444-8444-444444444444';
const TAG_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_TAG_ID = '66666666-6666-4666-8666-666666666666';
const TRANSFER_ID = '77777777-7777-4777-8777-777777777777';

let META_KEY: Buffer;
const FILE_KEYS = new Map<string, Buffer>();

beforeAll(async () => {
  const provider = createLocalTagKeyProvider({ sdmRootKeyHex: TEST_SDM_ROOT, allowLocalKeys: true });
  const audit = {
    ctx: { requestId: 'setup', actorId: null, actorType: 'system' as const, ip: 'test', route: 'setup' },
  };
  const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
  META_KEY = await provider.deriveKey({ role: 'META', version: 1 }, audit);
  for (const uid of [TAG_UID, OTHER_UID]) {
    FILE_KEYS.set(uid, await provider.deriveKey({ role: 'FILE', version: 1, uid: Buffer.from(uid, 'hex') }, audit));
  }
  quiet.mockRestore();
});

const sunFor = (counter: number, uid: string = TAG_UID): string => {
  const uidBuf = Buffer.from(uid, 'hex');
  const plain = buildPiccPlaintext(uidBuf, counter, Buffer.from('0102030405', 'hex'));
  const enc = encryptPiccBlock(plain, META_KEY).toString('hex').toUpperCase();
  const mac = computeSdmMac(FILE_KEYS.get(uid) as Buffer, uidBuf, plain.subarray(8, 11), Buffer.alloc(0));
  return buildSunUrl('https://am.example', 'token_01', enc, mac.toString('hex').toUpperCase());
};

// ── Harness ─────────────────────────────────────────────────────────────────

let tables: Tables;
let logSpy: SecurityEventSpy;

const baseTag = (overrides: Row = {}): Row => ({
  id: TAG_ID,
  tag_uid: TAG_UID,
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

const provenanceFor = (tagId: string, overrides: Row = {}): Row => ({
  tag_id: tagId,
  lifecycle_status: 'ACTIVE',
  is_valid: true,
  claim_date: null,
  creator_name: null,
  origin_video_url: null,
  origin_location: null,
  origin_date: null,
  current_ownership_id: null,
  enrolled_at: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(tables),
}));

const stripeCreate = vi.fn();
vi.mock('../lib/stripe', () => ({
  getStripe: () => ({ paymentIntents: { create: stripeCreate } }),
}));

type TestUser = { id: string; email?: string; email_confirmed_at?: string | null };

const USERS: Record<string, TestUser> = {
  [OWNER]: { id: OWNER, email: 'owner@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' },
  [BUYER]: { id: BUYER, email: 'buyer@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' },
  [STRANGER]: { id: STRANGER, email: 'stranger@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' },
};

const makeReq = (user: TestUser | string | null, body: Row = {}, params: Row = {}) => {
  const resolved = typeof user === 'string' ? USERS[user] : user;
  return {
    requestId: 'test-req',
    user: resolved ?? undefined,
    headers: { authorization: resolved ? 'Bearer header.eyJhYWwiOiJhYWwxIn0.sig' : undefined },
    socket: { remoteAddress: '203.0.113.5' },
    ip: '203.0.113.5',
    body,
    params,
  };
};

const makeRes = () => {
  const res: { status: number; body: Row; headers: Record<string, string> } = { status: 0, body: {}, headers: {} };
  return {
    res,
    handler: {
      status(code: number) { res.status = code; return this; },
      json(payload: Row) { res.body = payload; return this; },
      setHeader(name: string, value: string) { res.headers[name.toLowerCase()] = value; },
      headersSent: false,
    },
  };
};

const call = async (
  fn: (req: never, res: never) => Promise<unknown>,
  req: ReturnType<typeof makeReq>,
) => {
  const { res, handler } = makeRes();
  try {
    await fn(req as never, handler as never);
    return { ...res, threw: null as { code?: string; message: string; details?: { reason?: string } } | null };
  } catch (err) {
    return { ...res, threw: err as { code?: string; message: string; details?: { reason?: string } } };
  }
};

const data = (out: { body: Row }) => out.body.data as Row;

beforeEach(() => {
  resetMockIds();
  vi.resetModules();
  stripeCreate.mockReset();
  stripeCreate.mockResolvedValue({ id: 'pi_test_123', client_secret: 'cs_test_123' });

  process.env.OWNERSHIP_SALT_KEY = randomBytes(32).toString('base64');
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  delete process.env.FEATURE_REQUIRE_2FA;
  process.env.NFC_KEY_PROVIDER = 'local';
  process.env.NFC_ALLOW_LOCAL_KEYS = 'true';
  process.env.NFC_LOCAL_SDM_ROOT_KEY = TEST_SDM_ROOT;

  logSpy = spyOnSecurityEvents();

  tables = {
    nfc_tags: [baseTag()],
    nfc_tap_sessions: [],
    verification_events: [],
    ownership_transfers: [],
    ownership_proofs: [],
    public_tag_provenance: [provenanceFor(TAG_ID, { lifecycle_status: 'ENROLLED', is_valid: false })],
    items: [],
    users: [
      { id: OWNER, role: 'user', email: 'owner@example.com', billing_country: 'US' },
      { id: BUYER, role: 'user', email: 'buyer@example.com', billing_country: 'US' },
      { id: STRANGER, role: 'user', email: 'stranger@example.com', billing_country: 'US' },
    ],
  };
});

afterEach(() => {
  logSpy.restore();
});

const reads = async () => import('../controllers/tokenReadController');
const writes = async () => import('../controllers/tagManagementController');
const tag = (): Row => tables.nfc_tags[0];

/** Taps the chip at `counter` and returns the minted tap-session token. */
const tapFor = async (counter: number, user: string | null = null): Promise<string> => {
  const { tapTag } = await reads();
  const out = await call(tapTag, makeReq(user, { sunMessage: sunFor(counter) }));
  const token = (data(out).tapSession as { token?: string } | null)?.token;
  if (!token) throw new Error(`tap ${counter} minted no session: ${JSON.stringify(out.body)}`);
  return token;
};

const pendingTransfer = (overrides: Row = {}): Row => ({
  id: TRANSFER_ID,
  tag_id: TAG_ID,
  from_user_id: OWNER,
  to_user_id: BUYER,
  to_email: null,
  status: 'PENDING',
  transfer_type: 'SALE',
  fee_payer: 'BUYER',
  list_amount_usd_cents: 250,
  charged_amount: null,
  charged_currency: null,
  initiated_at: '2026-10-03T12:00:00.000Z',
  completed_at: null,
  stripe_payment_intent_id: null,
  ...overrides,
});

// ── POST /nfc/tap ───────────────────────────────────────────────────────────

describe('POST /nfc/tap', () => {
  it('verifies, burns the counter, and mints a session for an ENROLLED token', async () => {
    const { tapTag } = await reads();
    const out = await call(tapTag, makeReq(null, { sunMessage: sunFor(3) }));

    expect(out.threw).toBeNull();
    expect(out.body).toMatchObject({ success: true, error: null });
    expect(data(out)).toMatchObject({ valid: true, tagId: TAG_ID, lifecycleStatus: 'ENROLLED', viewer: null });
    expect(tag().sun_counter).toBe(3);

    const session = data(out).tapSession as { token: string; expiresAt: string };
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Only the hash is stored, never the token.
    expect(tables.nfc_tap_sessions).toHaveLength(1);
    expect(JSON.stringify(tables.nfc_tap_sessions)).not.toContain(session.token);
    expect(tables.nfc_tap_sessions[0]).toMatchObject({ tag_id: TAG_ID, counter_value: 3 });

    expect(logSpy.named('nfc.tap_session')[0]).toMatchObject({ action: 'issue', result: 'ok' });
    // The token never reaches a log line.
    expect(logSpy.blob()).not.toContain(session.token);
  });

  it('returns the public provenance and nothing that identifies an owner', async () => {
    tables.nfc_tags[0] = baseTag({ lifecycle_status: 'ACTIVE', current_owner_id: OWNER });
    tables.public_tag_provenance = [provenanceFor(TAG_ID, { creator_name: 'Disclosed Creator' })];

    const { tapTag } = await reads();
    const out = await call(tapTag, makeReq(null, { sunMessage: sunFor(1) }));

    expect(data(out).provenance).toMatchObject({ tag_id: TAG_ID, is_valid: true, creator_name: 'Disclosed Creator' });
    const blob = JSON.stringify(out.body);
    expect(blob).not.toContain(OWNER);
    expect(blob).not.toContain(TAG_UID);
    expect(blob).not.toContain('owner@example.com');
  });

  it('reports a replayed tap as invalid and mints no session', async () => {
    tables.nfc_tags[0] = baseTag({ sun_counter: 5 });

    const { tapTag } = await reads();
    const out = await call(tapTag, makeReq(null, { sunMessage: sunFor(5) }));

    expect(data(out)).toEqual({ valid: false, reason: 'replay_detected' });
    expect(tables.nfc_tap_sessions).toHaveLength(0);
  });

  it('reports a forged MAC as invalid_signature and burns nothing', async () => {
    const forged = sunFor(2).replace(/cmac=([0-9A-F]{2})/, (_m, b: string) => `cmac=${b === '00' ? '01' : '00'}`);

    const { tapTag } = await reads();
    const out = await call(tapTag, makeReq(null, { sunMessage: forged }));

    expect(data(out)).toEqual({ valid: false, reason: 'invalid_signature' });
    expect(tag().sun_counter).toBe(0);
    expect(tables.nfc_tap_sessions).toHaveLength(0);
  });

  it.each(['RELEASED', 'RETIRED', 'SUSPENDED'])('verifies a %s token but mints no session', async (status) => {
    tables.nfc_tags[0] = baseTag({ lifecycle_status: status, current_owner_id: OWNER });
    tables.public_tag_provenance = [provenanceFor(TAG_ID, { lifecycle_status: status, is_valid: false })];

    const { tapTag } = await reads();
    const out = await call(tapTag, makeReq(null, { sunMessage: sunFor(1) }));

    expect(data(out)).toMatchObject({ valid: true, lifecycleStatus: status, tapSession: null });
    expect(tables.nfc_tap_sessions).toHaveLength(0);
  });

  it('404s a tap from a chip that was never enrolled', async () => {
    const { tapTag } = await reads();
    const out = await call(tapTag, makeReq(null, { sunMessage: sunFor(1, OTHER_UID) }));

    expect(out.threw?.code).toBe('not_found');
  });

  it('rejects a body that is not a tapped URL', async () => {
    const { tapTag } = await reads();
    const out = await call(tapTag, makeReq(null, { sunMessage: 'https://am.example/verify/x' }));

    expect(out.threw?.code).toBe('invalid_argument');
  });

  it('personalises for a signed-in owner, claimer and transfer recipient', async () => {
    const { tapTag } = await reads();

    const claimer = await call(tapTag, makeReq(BUYER, { sunMessage: sunFor(1) }));
    expect(data(claimer).viewer).toEqual({ youOwnThis: false, canClaim: true, pendingTransferId: null });

    tables.nfc_tags[0] = baseTag({ lifecycle_status: 'ACTIVE', current_owner_id: OWNER, sun_counter: 1 });
    tables.ownership_transfers = [pendingTransfer()];

    const owner = await call(tapTag, makeReq(OWNER, { sunMessage: sunFor(2) }));
    expect(data(owner).viewer).toEqual({ youOwnThis: true, canClaim: false, pendingTransferId: null });

    const recipient = await call(tapTag, makeReq(BUYER, { sunMessage: sunFor(3) }));
    expect(data(recipient).viewer).toMatchObject({ pendingTransferId: TRANSFER_ID });

    const stranger = await call(tapTag, makeReq(STRANGER, { sunMessage: sunFor(4) }));
    expect(data(stranger).viewer).toMatchObject({ pendingTransferId: null });
  });
});

// ── Claim with a tap session ────────────────────────────────────────────────

describe('claim via tap session', () => {
  it('claims with the session from the verify-page tap (one tap total)', async () => {
    const token = await tapFor(1);
    const { claimTag } = await writes();

    const out = await call(claimTag, makeReq(OWNER, { tapSession: token }));

    expect(out.threw).toBeNull();
    expect(data(out)).toMatchObject({ tagId: TAG_ID, lifecycleStatus: 'ACTIVE' });
    expect(tag()).toMatchObject({ lifecycle_status: 'ACTIVE', current_owner_id: OWNER, sun_counter: 1 });
    expect(tables.nfc_tap_sessions[0]).toMatchObject({ consumed_by: OWNER, consumed_for: 'claim' });
  });

  it('is single use', async () => {
    const token = await tapFor(1);
    const { claimTag } = await writes();
    await call(claimTag, makeReq(OWNER, { tapSession: token }));

    // Reset the tag so only the session's single-use rule can stop this.
    tables.nfc_tags[0] = baseTag({ sun_counter: 1 });
    const again = await call(claimTag, makeReq(BUYER, { tapSession: token }));

    expect(again.threw?.details?.reason).toBe('tap_session_invalid');
    expect(tag().current_owner_id).toBeNull();
  });

  it('expires after 10 minutes', async () => {
    const token = await tapFor(1);
    tables.nfc_tap_sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();

    const { claimTag } = await writes();
    const out = await call(claimTag, makeReq(OWNER, { tapSession: token }));

    expect(out.threw?.details?.reason).toBe('tap_session_invalid');
    expect(tag().lifecycle_status).toBe('ENROLLED');
  });

  it('is superseded by a newer tap of the same chip', async () => {
    const first = await tapFor(1);
    await tapFor(2); // someone else taps afterwards

    const { claimTag } = await writes();
    const out = await call(claimTag, makeReq(OWNER, { tapSession: first }));

    expect(out.threw?.details?.reason).toBe('tap_session_invalid');
    expect(tag().lifecycle_status).toBe('ENROLLED');
  });

  it('rejects an unknown or malformed token without saying which', async () => {
    const { claimTag } = await writes();

    const unknown = await call(claimTag, makeReq(OWNER, { tapSession: 'A'.repeat(43) }));
    expect(unknown.threw?.details?.reason).toBe('tap_session_invalid');

    const malformed = await call(claimTag, makeReq(OWNER, { tapSession: 'short' }));
    expect(malformed.threw?.code).toBe('invalid_argument');
  });

  it('refuses a body carrying both a session and a raw scan', async () => {
    const token = await tapFor(1);
    const { claimTag } = await writes();

    const out = await call(claimTag, makeReq(OWNER, { tapSession: token, tagUid: TAG_UID, sunMessage: sunFor(2) }));
    expect(out.threw?.code).toBe('invalid_argument');
  });

  it('still returns already_claimed (with a reason) for an ACTIVE token', async () => {
    tables.nfc_tags[0] = baseTag({ lifecycle_status: 'ACTIVE', current_owner_id: OWNER });
    const token = await tapFor(1);
    const { claimTag } = await writes();

    const out = await call(claimTag, makeReq(BUYER, { tapSession: token }));
    expect(out.threw?.details?.reason).toBe('already_claimed');
    expect(tag().current_owner_id).toBe(OWNER);
  });

  it('keeps the legacy raw-scan body working', async () => {
    const { claimTag } = await writes();
    const out = await call(claimTag, makeReq(OWNER, { tagUid: TAG_UID, sunMessage: sunFor(1) }));

    expect(out.threw).toBeNull();
    expect(tag().current_owner_id).toBe(OWNER);
  });
});

// ── Transfer completion with a tap session ──────────────────────────────────

describe('transfer completion via tap session', () => {
  beforeEach(() => {
    tables.nfc_tags[0] = baseTag({ lifecycle_status: 'ACTIVE', current_owner_id: OWNER });
    tables.nfc_tags.push(baseTag({ id: OTHER_TAG_ID, tag_uid: OTHER_UID, lifecycle_status: 'ENROLLED' }));
    tables.public_tag_provenance.push(provenanceFor(OTHER_TAG_ID));
    tables.ownership_transfers = [pendingTransfer()];
  });

  it('creates the PaymentIntent but leaves the transfer PENDING', async () => {
    const token = await tapFor(1);
    const { completeTransfer } = await writes();

    const out = await call(completeTransfer, makeReq(BUYER, { tapSession: token }, { id: TRANSFER_ID }));

    expect(out.threw).toBeNull();
    expect(data(out)).toMatchObject({ status: 'PENDING', clientSecret: 'cs_test_123' });
    expect(tables.ownership_transfers[0].status).toBe('PENDING');
    expect(tag().current_owner_id).toBe(OWNER);
  });

  it("rejects a session minted from a different chip", async () => {
    const { tapTag } = await reads();
    const other = await call(tapTag, makeReq(null, { sunMessage: sunFor(1, OTHER_UID) }));
    const token = (data(other).tapSession as { token: string }).token;
    // Same counter on both chips, so only the chip binding can reject it.
    tag().sun_counter = 1;

    const { completeTransfer } = await writes();
    const out = await call(completeTransfer, makeReq(BUYER, { tapSession: token }, { id: TRANSFER_ID }));

    expect(out.threw?.details?.reason).toBe('tap_session_invalid');
    expect(stripeCreate).not.toHaveBeenCalled();
  });

  it('rejects a non-recipient before spending their session', async () => {
    const token = await tapFor(1);
    const { completeTransfer } = await writes();

    const out = await call(completeTransfer, makeReq(STRANGER, { tapSession: token }, { id: TRANSFER_ID }));

    expect(out.threw?.code).toBe('permission_denied');
    expect(tables.nfc_tap_sessions[0].consumed_at ?? null).toBeNull();
  });
});

// ── GET /nfc/mine ───────────────────────────────────────────────────────────

describe('GET /nfc/mine', () => {
  it('lists only tokens the caller currently owns, with Ownership ID and pending transfer', async () => {
    tables.nfc_tags = [
      baseTag({ lifecycle_status: 'ACTIVE', current_owner_id: OWNER, activated_at: '2026-10-02T00:00:00Z', linked_item_id: 'item-1' }),
      baseTag({ id: OTHER_TAG_ID, tag_uid: OTHER_UID, lifecycle_status: 'ACTIVE', current_owner_id: BUYER }),
    ];
    tables.items = [{ id: 'item-1', title: 'Signed jersey' }];
    tables.ownership_proofs = [
      { tag_id: TAG_ID, owner_id: OWNER, status: 'current', ownership_id: '0x' + 'a'.repeat(64) },
      { tag_id: TAG_ID, owner_id: STRANGER, status: 'stale', ownership_id: '0x' + 'b'.repeat(64) },
    ];
    tables.public_tag_provenance = [provenanceFor(TAG_ID), provenanceFor(OTHER_TAG_ID)];
    tables.ownership_transfers = [pendingTransfer({ to_user_id: null, to_email: 'friend@example.com', transfer_type: 'GIFT' })];

    const { listMyTokens } = await reads();
    const out = await call(listMyTokens, makeReq(OWNER));
    const tokens = data(out).tokens as Row[];

    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      tagId: TAG_ID,
      title: 'Signed jersey',
      ownershipId: '0x' + 'a'.repeat(64),
      pendingTransfer: { transferId: TRANSFER_ID, transferType: 'gift', toEmail: 'friend@example.com' },
    });
  });

  it('returns an empty list for someone who owns nothing', async () => {
    const { listMyTokens } = await reads();
    const out = await call(listMyTokens, makeReq(STRANGER));
    expect(data(out)).toEqual({ tokens: [] });
  });

  it('requires a signed-in caller', async () => {
    const { listMyTokens } = await reads();
    const out = await call(listMyTokens, makeReq(null));
    expect(out.threw?.code).toBe('unauthenticated');
  });
});

// ── GET /nfc/transfers/incoming ─────────────────────────────────────────────

describe('GET /nfc/transfers/incoming', () => {
  it('matches by account and by confirmed email, never revealing the sender', async () => {
    tables.public_tag_provenance = [provenanceFor(TAG_ID)];
    tables.ownership_transfers = [
      pendingTransfer(),
      pendingTransfer({ id: '88888888-8888-4888-8888-888888888888', to_user_id: null, to_email: 'buyer@example.com' }),
      pendingTransfer({ id: '99999999-9999-4999-8999-999999999999', to_user_id: STRANGER }),
      pendingTransfer({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'COMPLETED' }),
    ];

    const { listIncomingTransfers } = await reads();
    const out = await call(listIncomingTransfers, makeReq(BUYER));
    const transfers = data(out).transfers as Row[];

    expect(transfers.map((t) => t.transferId).sort()).toEqual(
      [TRANSFER_ID, '88888888-8888-4888-8888-888888888888'].sort(),
    );
    expect(transfers[0]).toMatchObject({ listAmountUsdCents: 250, provenance: { tag_id: TAG_ID } });
    expect(JSON.stringify(out.body)).not.toContain(OWNER);
  });

  it('does not match an email the caller has not confirmed', async () => {
    tables.ownership_transfers = [pendingTransfer({ to_user_id: null, to_email: 'buyer@example.com' })];

    const { listIncomingTransfers } = await reads();
    const out = await call(
      listIncomingTransfers,
      makeReq({ id: BUYER, email: 'buyer@example.com', email_confirmed_at: null }),
    );

    expect(data(out).transfers).toEqual([]);
  });
});

// ── GET /nfc/transfer/:id ───────────────────────────────────────────────────

describe('GET /nfc/transfer/:id', () => {
  beforeEach(() => {
    tables.ownership_transfers = [pendingTransfer({ charged_amount: 250, charged_currency: 'usd' })];
  });

  it('answers the sender and the recipient with their role', async () => {
    const { getTransfer } = await reads();

    const sender = await call(getTransfer, makeReq(OWNER, {}, { id: TRANSFER_ID }));
    expect(data(sender)).toMatchObject({ status: 'PENDING', role: 'sender', chargedAmount: 250 });

    const recipient = await call(getTransfer, makeReq(BUYER, {}, { id: TRANSFER_ID }));
    expect(data(recipient)).toMatchObject({ role: 'recipient' });
  });

  it('forbids a third party and logs it', async () => {
    const { getTransfer } = await reads();
    const out = await call(getTransfer, makeReq(STRANGER, {}, { id: TRANSFER_ID }));

    expect(out.threw?.code).toBe('permission_denied');
    expect(logSpy.named('authz.denied')[0]).toMatchObject({ resource_type: 'transfer', reason: 'not_recipient' });
  });

  it('404s a malformed id', async () => {
    const { getTransfer } = await reads();
    const out = await call(getTransfer, makeReq(OWNER, {}, { id: 'nope' }));
    expect(out.threw?.code).toBe('not_found');
  });
});

// ── GET /nfc/:tagId/receipt ─────────────────────────────────────────────────

describe('GET /nfc/:tagId/receipt', () => {
  it('returns a Receipt that independently recomputes to the Ownership ID', async () => {
    const token = await tapFor(1);
    const { claimTag } = await writes();
    const claimed = await call(claimTag, makeReq(OWNER, { tapSession: token }));
    const ownershipId = data(claimed).ownershipId as string;

    const { getReceipt } = await reads();
    const out = await call(getReceipt, makeReq(OWNER, {}, { tagId: TAG_ID }));
    const receipt = data(out);

    expect(out.headers['cache-control']).toBe('no-store');
    expect(receipt.ownershipId).toBe(ownershipId);

    // Independent recomputation from the documented preimage.
    const preimage = Buffer.concat([
      Buffer.from(receipt.tagRef as string, 'utf8'),
      Buffer.from((receipt.ownershipEventId as string).replace(/-/g, ''), 'hex'),
      Buffer.from(receipt.saltHex as string, 'hex'),
    ]);
    expect(keccak256(preimage)).toBe(ownershipId);

    expect(logSpy.named('ownership.receipt')[0]).toMatchObject({ result: 'ok', tag_id: TAG_ID });
    // The salt never reaches a log line.
    expect(logSpy.blob()).not.toContain(receipt.saltHex as string);
  });

  it('forbids anyone but the current owner, including a previous owner', async () => {
    tables.nfc_tags[0] = baseTag({ lifecycle_status: 'ACTIVE', current_owner_id: BUYER });
    tables.ownership_proofs = [{ tag_id: TAG_ID, owner_id: OWNER, status: 'stale', salt_enc: 'x' }];

    const { getReceipt } = await reads();
    const out = await call(getReceipt, makeReq(OWNER, {}, { tagId: TAG_ID }));

    expect(out.threw?.code).toBe('permission_denied');
    expect(logSpy.named('ownership.receipt')[0]).toMatchObject({ result: 'forbidden' });
  });
});

// ── GET /ownership/:id — youOwnThis now works ───────────────────────────────

describe('GET /ownership/:ownershipId', () => {
  const ID = '0x' + 'c'.repeat(64);

  beforeEach(() => {
    tables.ownership_proofs = [{ tag_id: TAG_ID, owner_id: OWNER, status: 'current', ownership_id: ID }];
    tables.public_tag_provenance = [provenanceFor(TAG_ID)];
  });

  it('is true only for the signed-in current owner', async () => {
    const { resolveOwnershipId } = await import('../controllers/ownershipController');

    const owner = await call(resolveOwnershipId, makeReq(OWNER, {}, { ownershipId: ID }));
    expect(data(owner).youOwnThis).toBe(true);

    const other = await call(resolveOwnershipId, makeReq(BUYER, {}, { ownershipId: ID }));
    expect(data(other).youOwnThis).toBe(false);

    const anon = await call(resolveOwnershipId, makeReq(null, {}, { ownershipId: ID }));
    expect(data(anon).youOwnThis).toBe(false);
  });
});
