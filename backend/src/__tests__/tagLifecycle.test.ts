import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'crypto';
import {
  buildPiccPlaintext,
  buildSunUrl,
  computeSdmMac,
  encryptPiccBlock,
} from '../services/nfc/ntag424Codec';
import { createLocalTagKeyProvider } from '../services/nfc/keys/tagKeyProvider';
import { createMockSupabase, resetMockIds, type MockHooks, type Tables, type Row } from './helpers/supabaseMock';
import { spyOnSecurityEvents, type SecurityEventSpy } from './helpers/securityEvents';

/**
 * S-NFC3 — token lifecycle behaviour.
 *
 * These are the acceptance criteria that matter most, exercised as behaviour:
 *   - claim only on ENROLLED; everything else gets the right error code
 *   - replayed / stale SUN is rejected
 *   - 2FA gate
 *   - a pending transfer locks release
 *   - the previous owner loses every right after completion
 *   - a transfer reaches COMPLETED only via the webhook
 *   - release is irreversible
 *   - every rejection emits the matching security event with the right result
 *
 * SUN messages are REAL: AN12196 SDM built with the production codec, under
 * keys derived by the production local provider from a test SDM root — the
 * same derivation the controllers run — so the MAC and counter checks are
 * genuinely exercised rather than stubbed past.
 */

const TEST_SDM_ROOT = '5A'.repeat(32);
const TAG_UID = '04A27E02936980';
const OTHER_UID = '04DE5F1EACC040';
const OTHER_TAG_ID = '66666666-6666-4666-8666-666666666666';

const OWNER = '11111111-1111-4111-8111-111111111111';
const BUYER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const STAFF = '44444444-4444-4444-8444-444444444444';
const TAG_ID = '55555555-5555-4555-8555-555555555555';

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

/** Builds a genuinely valid AN12196 SUN URL for a given chip + read counter. */
const sunFor = (counter: number, uid: string = TAG_UID): string => {
  const uidBuf = Buffer.from(uid, 'hex');
  const plain = buildPiccPlaintext(uidBuf, counter, Buffer.from('0102030405', 'hex'));
  const enc = encryptPiccBlock(plain, META_KEY).toString('hex').toUpperCase();
  const mac = computeSdmMac(FILE_KEYS.get(uid) as Buffer, uidBuf, plain.subarray(8, 11), Buffer.alloc(0));
  return buildSunUrl('https://am.example', 'token_01', enc, mac.toString('hex').toUpperCase());
};

const reasonOf = (out: { threw: unknown }): unknown =>
  (out.threw as { details?: { reason?: unknown } } | null)?.details?.reason;

// ── Harness ─────────────────────────────────────────────────────────────────

let tables: Tables;
let hooks: MockHooks = {};
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
  status: 'registered',
  ...overrides,
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(tables, hooks),
}));

const stripeCreate = vi.fn();
vi.mock('../lib/stripe', () => ({
  getStripe: () => ({ paymentIntents: { create: stripeCreate } }),
}));

/** Minimal Express req/res doubles — the controllers only use a few fields. */
const makeReq = (userId: string | null, body: Row = {}, params: Row = {}) => ({
  requestId: 'test-req',
  user: userId ? { id: userId } : undefined,
  headers: { authorization: userId ? 'Bearer header.eyJhYWwiOiJhYWwxIn0.sig' : undefined },
  socket: { remoteAddress: '203.0.113.5' },
  body,
  params,
});

const makeRes = () => {
  const res: { status: number; body: Row } = { status: 0, body: {} };
  return {
    res,
    handler: {
      status(code: number) { res.status = code; return this; },
      json(payload: Row) { res.body = payload; return this; },
      headersSent: false,
    },
  };
};

const eventsNamed = (name: string) => logSpy.named(name);

const call = async (
  fn: (req: never, res: never) => Promise<unknown>,
  req: ReturnType<typeof makeReq>,
) => {
  const { res, handler } = makeRes();
  try {
    await fn(req as never, handler as never);
    return { ...res, threw: null as { code?: string; message: string } | null };
  } catch (err) {
    return { ...res, threw: err as { code?: string; message: string } };
  }
};

beforeEach(async () => {
  resetMockIds();
  vi.resetModules();
  stripeCreate.mockReset();
  stripeCreate.mockResolvedValue({ id: 'pi_test_123', client_secret: 'cs_test_123' });

  process.env.OWNERSHIP_SALT_KEY = randomBytes(32).toString('base64');
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  delete process.env.FEATURE_REQUIRE_2FA;
  process.env.NFC_KEY_PROVIDER = "local";
  process.env.NFC_ALLOW_LOCAL_KEYS = "true";
  process.env.NFC_LOCAL_SDM_ROOT_KEY = TEST_SDM_ROOT;
  hooks = {};

  logSpy = spyOnSecurityEvents();

  tables = {
    nfc_tags: [baseTag()],
    ownership_transfers: [],
    ownership_proofs: [],
    reissue_requests: [],
    users: [
      { id: OWNER, role: 'user', email: 'owner@example.com', billing_country: 'US' },
      { id: BUYER, role: 'user', email: 'buyer@example.com', billing_country: 'US' },
      { id: STRANGER, role: 'user', email: 'stranger@example.com', billing_country: 'US' },
      { id: STAFF, role: 'admin', email: 'staff@example.com', billing_country: 'US' },
    ],
  };
});

afterEach(() => {
  logSpy.restore();
});

const controllers = async () => import('../controllers/tagManagementController');
const tag = (): Row => tables.nfc_tags[0];

// ── Origin claim ────────────────────────────────────────────────────────────

describe('origin claim', () => {
  it('moves an ENROLLED tag to ACTIVE and mints exactly one current proof', async () => {
    const { claimTag } = await controllers();
    const out = await call(claimTag, makeReq(OWNER, { tagUid: TAG_UID, sunMessage: sunFor(1) }));

    expect(out.threw).toBeNull();
    expect(out.body.success).toBe(true);
    expect(tag().lifecycle_status).toBe('ACTIVE');
    expect(tag().current_owner_id).toBe(OWNER);
    // The tapped counter is burned so the same tap cannot be reused.
    expect(tag().sun_counter).toBe(1);

    const current = tables.ownership_proofs.filter((p) => p.status === 'current');
    expect(current).toHaveLength(1);
    expect(current[0].owner_id).toBe(OWNER);
    expect(String(current[0].ownership_id)).toMatch(/^0x[0-9a-f]{64}$/);

    expect(eventsNamed('nfc.claim')[0]).toMatchObject({ result: 'ok', prior_status: 'ENROLLED' });
  });

  it('rejects a second claim on an already-claimed tag', async () => {
    const { claimTag } = await controllers();
    await call(claimTag, makeReq(OWNER, { tagUid: TAG_UID, sunMessage: sunFor(1) }));
    logSpy.clear();

    const out = await call(claimTag, makeReq(BUYER, { tagUid: TAG_UID, sunMessage: sunFor(2) }));

    expect(out.threw?.message).toMatch(/already been claimed/i);
    expect(tag().current_owner_id).toBe(OWNER);
    expect(eventsNamed('nfc.claim')[0]).toMatchObject({ result: 'already_claimed' });
  });

  it('rejects a claim on a released token with token_released', async () => {
    tables.nfc_tags[0] = baseTag({ lifecycle_status: 'RELEASED' });

    const { claimTag } = await controllers();
    const out = await call(claimTag, makeReq(BUYER, { tagUid: TAG_UID, sunMessage: sunFor(1) }));

    expect(out.threw?.message).toMatch(/released/i);
    expect(eventsNamed('nfc.claim')[0]).toMatchObject({ result: 'token_released' });
  });

  it('rejects a claim on a retired token with token_retired', async () => {
    tables.nfc_tags[0] = baseTag({ lifecycle_status: 'RETIRED' });

    const { claimTag } = await controllers();
    const out = await call(claimTag, makeReq(BUYER, { tagUid: TAG_UID, sunMessage: sunFor(1) }));

    expect(out.threw?.message).toMatch(/retired/i);
    expect(eventsNamed('nfc.claim')[0]).toMatchObject({ result: 'token_retired' });
  });

  it('rejects a replayed SUN and records the replay', async () => {
    tables.nfc_tags[0] = baseTag({ sun_counter: 5 });

    const { claimTag } = await controllers();
    // Counter 5 is not greater than the last recorded 5.
    const out = await call(claimTag, makeReq(OWNER, { tagUid: TAG_UID, sunMessage: sunFor(5) }));

    expect(out.threw?.message).toMatch(/tap the tag again/i);
    expect(reasonOf(out)).toBe('replay_detected');
    expect(tag().lifecycle_status).toBe('ENROLLED');
    expect(eventsNamed('nfc.sun_verify')[0]).toMatchObject({
      sun_result: 'replay_detected',
      result: 'replay_detected',
      context: 'claim',
    });
    expect(eventsNamed('nfc.claim')[0]).toMatchObject({ result: 'replay_detected' });
  });

  it('treats a counter regression as replay_detected (counter/last_counter keep it distinguishable)', async () => {
    tables.nfc_tags[0] = baseTag({ sun_counter: 9 });

    const { claimTag } = await controllers();
    const out = await call(claimTag, makeReq(OWNER, { tagUid: TAG_UID, sunMessage: sunFor(3) }));

    expect(reasonOf(out)).toBe('replay_detected');
    // S-SEC0 still sees the regression: counter < last_counter.
    expect(eventsNamed('nfc.sun_verify')[0]).toMatchObject({
      sun_result: 'replay_detected',
      counter: 3,
      last_counter: 9,
    });
  });

  it('rejects a forged MAC as invalid_signature', async () => {
    const { claimTag } = await controllers();
    const forged = sunFor(1).replace(/cmac=[0-9a-f]+/i, 'cmac=0000000000000000');

    const out = await call(claimTag, makeReq(OWNER, { tagUid: TAG_UID, sunMessage: forged }));

    expect(reasonOf(out)).toBe('invalid_signature');
    expect(tag().lifecycle_status).toBe('ENROLLED');
    expect(eventsNamed('nfc.sun_verify')[0]).toMatchObject({
      sun_result: 'invalid_signature',
      result: 'invalid_signature',
    });
  });

  it.each([0, 3, 7, 15])('rejects one flipped MAC nibble (hex index %i) as invalid_signature', async (idx) => {
    const { claimTag } = await controllers();
    const url = new URL(sunFor(1));
    const mac = url.searchParams.get('cmac') as string;
    const nibble = (parseInt(mac[idx], 16) ^ 0x1).toString(16).toUpperCase();
    url.searchParams.set('cmac', mac.slice(0, idx) + nibble + mac.slice(idx + 1));

    const out = await call(claimTag, makeReq(OWNER, { tagUid: TAG_UID, sunMessage: url.toString() }));

    expect(reasonOf(out)).toBe('invalid_signature');
    expect(tag().lifecycle_status).toBe('ENROLLED');
    expect(tag().sun_counter).toBe(0);
  });

  it('rejects a Tag-A URL presented with Tag-B UID', async () => {
    // Both chips enrolled; the caller names B but taps A.
    tables.nfc_tags.push(baseTag({ id: OTHER_TAG_ID, tag_uid: OTHER_UID }));
    const { claimTag } = await controllers();

    const out = await call(claimTag, makeReq(OWNER, { tagUid: OTHER_UID, sunMessage: sunFor(1, TAG_UID) }));

    expect(reasonOf(out)).toBe('invalid_signature');
    expect(tables.nfc_tags.every((t) => t.lifecycle_status === 'ENROLLED')).toBe(true);
    expect(eventsNamed('nfc.sun_verify')[0]).toMatchObject({
      tag_id: OTHER_TAG_ID,
      sun_result: 'uid_mismatch',
      result: 'invalid_signature',
    });
  });

  it('loses the race cleanly: a conditional counter burn matching no row is replay_detected', async () => {
    const { claimTag } = await controllers();
    // A concurrent request with the same tap commits between our verify and
    // our conditional update.
    hooks.beforeUpdate = (table) => {
      if (table === 'nfc_tags') tables.nfc_tags[0].sun_counter = 1;
    };

    const out = await call(claimTag, makeReq(OWNER, { tagUid: TAG_UID, sunMessage: sunFor(1) }));

    expect(reasonOf(out)).toBe('replay_detected');
    expect(tag().lifecycle_status).toBe('ENROLLED');
    expect(tag().current_owner_id).toBeNull();
    expect(tables.ownership_proofs).toHaveLength(0);
    expect(eventsNamed('nfc.claim').at(-1)).toMatchObject({ result: 'replay_detected' });
  });

  it('blocks the claim when 2FA is required and the token is only aal1', async () => {
    process.env.FEATURE_REQUIRE_2FA = 'true';

    const { claimTag } = await controllers();
    const out = await call(claimTag, makeReq(OWNER, { tagUid: TAG_UID, sunMessage: sunFor(1) }));

    expect(out.threw?.message).toMatch(/two-factor/i);
    expect(tag().lifecycle_status).toBe('ENROLLED');
    expect(eventsNamed('auth.2fa_gate')[0]).toMatchObject({ gate: 'claim', outcome: 'failed', result: '2fa_required' });
    expect(eventsNamed('nfc.claim')[0]).toMatchObject({ result: '2fa_required' });
  });

  it('allows the claim with an aal2 token when 2FA is required', async () => {
    process.env.FEATURE_REQUIRE_2FA = 'true';

    const { claimTag } = await controllers();
    const req = makeReq(OWNER, { tagUid: TAG_UID, sunMessage: sunFor(1) });
    // { "aal": "aal2" }
    req.headers.authorization = 'Bearer header.eyJhYWwiOiJhYWwyIn0.sig';

    const out = await call(claimTag, req);

    expect(out.threw).toBeNull();
    expect(tag().lifecycle_status).toBe('ACTIVE');
    expect(eventsNamed('auth.2fa_gate')[0]).toMatchObject({ outcome: 'passed' });
  });
});

// ── Transfer ────────────────────────────────────────────────────────────────

const claimFirst = async () => {
  const { claimTag } = await controllers();
  await call(claimTag, makeReq(OWNER, { tagUid: TAG_UID, sunMessage: sunFor(1) }));
};

describe('transfer', () => {
  it('lets the owner initiate a pending transfer to an email with no account', async () => {
    await claimFirst();
    const { initiateTransfer } = await controllers();

    const out = await call(
      initiateTransfer,
      makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toEmail: 'newbuyer@example.com' }),
    );

    expect(out.threw).toBeNull();
    const row = tables.ownership_transfers[0];
    expect(row.status).toBe('PENDING');
    expect(row.to_user_id).toBeNull();
    expect(row.to_email).toBe('newbuyer@example.com');
    expect(row.list_amount_usd_cents).toBe(250);
  });

  it('refuses a second pending transfer for the same tag', async () => {
    await claimFirst();
    const { initiateTransfer } = await controllers();
    await call(initiateTransfer, makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toUserId: BUYER }));

    const out = await call(
      initiateTransfer,
      makeReq(OWNER, { tagId: TAG_ID, transferType: 'gift', toUserId: STRANGER }),
    );

    expect(out.threw?.message).toMatch(/already pending/i);
    expect(tables.ownership_transfers.filter((t) => t.status === 'PENDING')).toHaveLength(1);
  });

  it('refuses initiation by someone who is not the owner', async () => {
    await claimFirst();
    const { initiateTransfer } = await controllers();
    logSpy.clear();

    const out = await call(
      initiateTransfer,
      makeReq(STRANGER, { tagId: TAG_ID, transferType: 'sale', toUserId: BUYER }),
    );

    expect(out.threw?.message).toMatch(/forbidden/i);
    expect(eventsNamed('authz.denied')[0]).toMatchObject({ reason: 'not_owner', resource_type: 'tag' });
  });

  it('creates a PaymentIntent on completion but leaves the transfer PENDING', async () => {
    await claimFirst();
    const { initiateTransfer, completeTransfer } = await controllers();
    await call(initiateTransfer, makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toUserId: BUYER }));
    const transferId = String(tables.ownership_transfers[0].id);

    const out = await call(
      completeTransfer,
      makeReq(BUYER, { tagUid: TAG_UID, sunMessage: sunFor(2) }, { id: transferId }),
    );

    expect(out.threw).toBeNull();
    expect(stripeCreate).toHaveBeenCalledTimes(1);

    // The client response NEVER completes the transfer.
    expect(tables.ownership_transfers[0].status).toBe('PENDING');
    expect(tag().current_owner_id).toBe(OWNER);
    expect((out.body.data as Row).status).toBe('PENDING');
    expect((out.body.data as Row).clientSecret).toBe('cs_test_123');
  });

  it('keys the PaymentIntent by transfer id so a retry cannot double-charge', async () => {
    await claimFirst();
    const { initiateTransfer, completeTransfer } = await controllers();
    await call(initiateTransfer, makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toUserId: BUYER }));
    const transferId = String(tables.ownership_transfers[0].id);

    await call(completeTransfer, makeReq(BUYER, { tagUid: TAG_UID, sunMessage: sunFor(2) }, { id: transferId }));

    expect(stripeCreate.mock.calls[0][1]).toEqual({ idempotencyKey: `token-transfer-fee-${transferId}` });
    expect(stripeCreate.mock.calls[0][0]).toMatchObject({
      amount: 250,
      currency: 'usd',
      metadata: { transfer_id: transferId, kind: 'token_transfer_fee' },
    });
  });

  it('charges a gift the same $2.50 as a sale', async () => {
    await claimFirst();
    const { initiateTransfer, completeTransfer } = await controllers();
    await call(initiateTransfer, makeReq(OWNER, { tagId: TAG_ID, transferType: 'gift', toUserId: BUYER }));
    const transferId = String(tables.ownership_transfers[0].id);

    await call(completeTransfer, makeReq(BUYER, { tagUid: TAG_UID, sunMessage: sunFor(2) }, { id: transferId }));

    expect(stripeCreate.mock.calls[0][0].amount).toBe(250);
  });

  it('refuses completion by anyone but the named recipient', async () => {
    await claimFirst();
    const { initiateTransfer, completeTransfer } = await controllers();
    await call(initiateTransfer, makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toUserId: BUYER }));
    const transferId = String(tables.ownership_transfers[0].id);
    logSpy.clear();

    const out = await call(
      completeTransfer,
      makeReq(STRANGER, { tagUid: TAG_UID, sunMessage: sunFor(2) }, { id: transferId }),
    );

    expect(out.threw?.message).toMatch(/forbidden/i);
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(eventsNamed('authz.denied')[0]).toMatchObject({ reason: 'not_recipient' });
  });

  it('lets an email-targeted recipient complete once they have registered', async () => {
    await claimFirst();
    const { initiateTransfer, completeTransfer } = await controllers();
    await call(
      initiateTransfer,
      makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toEmail: 'buyer@example.com' }),
    );
    const transferId = String(tables.ownership_transfers[0].id);

    const out = await call(
      completeTransfer,
      makeReq(BUYER, { tagUid: TAG_UID, sunMessage: sunFor(2) }, { id: transferId }),
    );

    expect(out.threw).toBeNull();
    // The recipient is resolved onto the row once identified.
    expect(tables.ownership_transfers[0].to_user_id).toBe(BUYER);
  });

  it('rejects a stale SUN on completion', async () => {
    await claimFirst();
    const { initiateTransfer, completeTransfer } = await controllers();
    await call(initiateTransfer, makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toUserId: BUYER }));
    const transferId = String(tables.ownership_transfers[0].id);
    logSpy.clear();

    // Counter 1 was already burned by the claim.
    const out = await call(
      completeTransfer,
      makeReq(BUYER, { tagUid: TAG_UID, sunMessage: sunFor(1) }, { id: transferId }),
    );

    expect(out.threw?.message).toMatch(/tap the tag again/i);
    expect(reasonOf(out)).toBe('replay_detected');
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(eventsNamed('nfc.sun_verify')[0]).toMatchObject({
      context: 'transfer_complete',
      sun_result: 'replay_detected',
    });
  });

  it('rejects a second completion with the same tap (replayed URL)', async () => {
    await claimFirst();
    const { initiateTransfer, completeTransfer } = await controllers();
    await call(initiateTransfer, makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toUserId: BUYER }));
    const transferId = String(tables.ownership_transfers[0].id);
    const tap = sunFor(2);

    const first = await call(completeTransfer, makeReq(BUYER, { tagUid: TAG_UID, sunMessage: tap }, { id: transferId }));
    expect(first.threw).toBeNull();

    const replay = await call(completeTransfer, makeReq(BUYER, { tagUid: TAG_UID, sunMessage: tap }, { id: transferId }));
    expect(reasonOf(replay)).toBe('replay_detected');
    expect(stripeCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects completion with another chip's URL", async () => {
    await claimFirst();
    const { initiateTransfer, completeTransfer } = await controllers();
    await call(initiateTransfer, makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toUserId: BUYER }));
    const transferId = String(tables.ownership_transfers[0].id);
    logSpy.clear();

    const out = await call(
      completeTransfer,
      makeReq(BUYER, { tagUid: TAG_UID, sunMessage: sunFor(2, OTHER_UID) }, { id: transferId }),
    );

    expect(reasonOf(out)).toBe('invalid_signature');
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(eventsNamed('nfc.sun_verify')[0]).toMatchObject({ sun_result: 'uid_mismatch' });
  });

  it('loses the completion race cleanly: a zero-row counter burn is replay_detected', async () => {
    await claimFirst();
    const { initiateTransfer, completeTransfer } = await controllers();
    await call(initiateTransfer, makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toUserId: BUYER }));
    const transferId = String(tables.ownership_transfers[0].id);
    hooks.beforeUpdate = (table, patch) => {
      if (table === 'nfc_tags' && 'sun_counter' in patch) tables.nfc_tags[0].sun_counter = 2;
    };
    logSpy.clear();

    const out = await call(
      completeTransfer,
      makeReq(BUYER, { tagUid: TAG_UID, sunMessage: sunFor(2) }, { id: transferId }),
    );

    expect(reasonOf(out)).toBe('replay_detected');
    expect(stripeCreate).not.toHaveBeenCalled();
    expect(eventsNamed('nfc.sun_verify').at(-1)).toMatchObject({ sun_result: 'replay_detected' });
  });

  it('lets the sender cancel a pending transfer, and refuses cancel by others', async () => {
    await claimFirst();
    const { initiateTransfer, cancelTransfer } = await controllers();
    await call(initiateTransfer, makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toUserId: BUYER }));
    const transferId = String(tables.ownership_transfers[0].id);

    const denied = await call(cancelTransfer, makeReq(STRANGER, {}, { id: transferId }));
    expect(denied.threw?.message).toMatch(/forbidden/i);

    const out = await call(cancelTransfer, makeReq(OWNER, {}, { id: transferId }));
    expect(out.threw).toBeNull();
    expect(tables.ownership_transfers[0].status).toBe('CANCELLED');
  });
});

// ── Release ─────────────────────────────────────────────────────────────────

describe('release', () => {
  const releaseBody = { tagId: TAG_ID, confirm: true, confirmPhrase: 'RELEASE' };

  it('requires the double confirmation', async () => {
    await claimFirst();
    const { releaseTag } = await controllers();

    const out = await call(releaseTag, makeReq(OWNER, { tagId: TAG_ID, confirm: true }));

    expect(out.threw).not.toBeNull();
    expect(tag().lifecycle_status).toBe('ACTIVE');
  });

  it('kills the token irreversibly and stales the proof', async () => {
    await claimFirst();
    const { releaseTag, claimTag } = await controllers();

    const out = await call(releaseTag, makeReq(OWNER, releaseBody));

    expect(out.threw).toBeNull();
    expect(tag().lifecycle_status).toBe('RELEASED');
    expect(tag().current_owner_id).toBeNull();
    expect(tables.ownership_proofs.every((p) => p.status === 'stale')).toBe(true);
    expect(eventsNamed('nfc.release')[0]).toMatchObject({ result: 'ok' });

    // Release is never a gift mechanism: nobody can claim it afterwards.
    const reclaim = await call(claimTag, makeReq(BUYER, { tagUid: TAG_UID, sunMessage: sunFor(2) }));
    expect(reclaim.threw?.message).toMatch(/released/i);
  });

  it('is blocked while a transfer is pending', async () => {
    await claimFirst();
    const { initiateTransfer, releaseTag } = await controllers();
    await call(initiateTransfer, makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toUserId: BUYER }));
    logSpy.clear();

    const out = await call(releaseTag, makeReq(OWNER, releaseBody));

    expect(out.threw?.message).toMatch(/already pending/i);
    expect(tag().lifecycle_status).toBe('ACTIVE');
    expect(eventsNamed('nfc.release')[0]).toMatchObject({ result: 'transfer_pending' });
  });

  it('refuses release by a non-owner', async () => {
    await claimFirst();
    const { releaseTag } = await controllers();

    const out = await call(releaseTag, makeReq(STRANGER, releaseBody));

    expect(out.threw?.message).toMatch(/forbidden/i);
    expect(tag().lifecycle_status).toBe('ACTIVE');
  });
});

// ── Disclosure ──────────────────────────────────────────────────────────────

describe('disclosure', () => {
  it('lets the owner change it and logs field names only', async () => {
    await claimFirst();
    const { updateDisclosure } = await controllers();
    logSpy.clear();

    const out = await call(updateDisclosure, makeReq(OWNER, { origin_video: true }, { tagId: TAG_ID }));

    expect(out.threw).toBeNull();
    expect((tag().disclosure as Row).origin_video).toBe(true);

    const event = eventsNamed('nfc.disclosure_change')[0];
    expect(event).toMatchObject({ result: 'ok', fields_changed: ['origin_video'] });
    // Field names, never values.
    expect(JSON.stringify(event)).not.toContain('true,');
  });

  it('refuses a disclosure change by a non-owner', async () => {
    await claimFirst();
    const { updateDisclosure } = await controllers();

    const out = await call(updateDisclosure, makeReq(STRANGER, { origin_video: true }, { tagId: TAG_ID }));

    expect(out.threw?.message).toMatch(/forbidden/i);
    expect((tag().disclosure as Row).origin_video).toBe(false);
  });
});

// ── Enrollment ──────────────────────────────────────────────────────────────

describe('enroll', () => {
  it('refuses a non-staff caller and records the role denial', async () => {
    const { enrollTag } = await controllers();

    const out = await call(
      enrollTag,
      makeReq(OWNER, { tagUid: 'AABBCCDDEEFF00' }),
    );

    expect(out.threw?.message).toMatch(/forbidden/i);
    expect(eventsNamed('authz.denied')[0]).toMatchObject({ reason: 'role' });
  });

  it('lets staff enroll a tag into ENROLLED with no owner', async () => {
    const { enrollTag } = await controllers();

    const out = await call(
      enrollTag,
      makeReq(STAFF, { tagUid: 'aabbccddeeff00' }),
    );

    expect(out.threw).toBeNull();
    const created = tables.nfc_tags.find((t) => t.tag_uid === 'AABBCCDDEEFF00');
    expect(created?.lifecycle_status).toBe('ENROLLED');
    expect(created?.current_owner_id).toBeUndefined();
    // S-NFC3.5: no key material is stored — only the KDF version.
    expect(created && 'aes_key_enc' in created).toBe(false);
    expect(created?.sdm_key_version).toBe(1);
    expect(eventsNamed('nfc.enroll')[0]).toMatchObject({ result: 'ok' });
  });

  it('refuses an enrollment that tries to send key material', async () => {
    const { enrollTag } = await controllers();

    const out = await call(
      enrollTag,
      makeReq(STAFF, { tagUid: 'AABBCCDDEEFF00', aesKey: '00112233445566778899aabbccddeeff' }),
    );

    expect(out.threw?.code).toBe('invalid_argument');
    expect(tables.nfc_tags.find((t) => t.tag_uid === 'AABBCCDDEEFF00')).toBeUndefined();
  });
});

// ── Previous owner lockout (Rule 5) ─────────────────────────────────────────

describe('after a completed transfer', () => {
  /**
   * Puts the tables in the state the webhook leaves behind: ownership has moved
   * to BUYER and the completed transfer records OWNER as the sender.
   */
  const completeToBuyer = () => {
    tables.nfc_tags[0] = baseTag({
      lifecycle_status: 'ACTIVE',
      current_owner_id: BUYER,
      sun_counter: 2,
    });
    tables.ownership_transfers.push({
      id: '77777777-7777-4777-8777-777777777777',
      tag_id: TAG_ID,
      from_user_id: OWNER,
      to_user_id: BUYER,
      status: 'COMPLETED',
      transfer_type: 'SALE',
      fee_payer: 'BUYER',
    });
    tables.ownership_proofs.push({
      id: 'proof-new', tag_id: TAG_ID, status: 'current', owner_id: BUYER,
      ownership_id: `0x${'b'.repeat(64)}`,
    });
  };

  it('denies the previous owner a release, and says why', async () => {
    completeToBuyer();
    const { releaseTag } = await controllers();
    logSpy.clear();

    const out = await call(
      releaseTag,
      makeReq(OWNER, { tagId: TAG_ID, confirm: true, confirmPhrase: 'RELEASE' }),
    );

    expect(out.threw?.message).toMatch(/forbidden/i);
    expect(tag().lifecycle_status).toBe('ACTIVE');
    expect(tag().current_owner_id).toBe(BUYER);
    // Distinguished from a stranger: this is an expectation problem, not IDOR.
    expect(eventsNamed('authz.denied')[0]).toMatchObject({
      reason: 'previous_owner', resource_type: 'tag',
    });
  });

  it('denies the previous owner a new transfer', async () => {
    completeToBuyer();
    const { initiateTransfer } = await controllers();
    logSpy.clear();

    const out = await call(
      initiateTransfer,
      makeReq(OWNER, { tagId: TAG_ID, transferType: 'sale', toUserId: STRANGER }),
    );

    expect(out.threw?.message).toMatch(/forbidden/i);
    expect(eventsNamed('authz.denied')[0]).toMatchObject({ reason: 'previous_owner' });
  });

  it('denies the previous owner a disclosure edit', async () => {
    completeToBuyer();
    const { updateDisclosure } = await controllers();
    logSpy.clear();

    const out = await call(
      updateDisclosure,
      makeReq(OWNER, { creator_name: true }, { tagId: TAG_ID }),
    );

    expect(out.threw?.message).toMatch(/forbidden/i);
    expect((tag().disclosure as Row).creator_name).toBe(false);
    expect(eventsNamed('authz.denied')[0]).toMatchObject({ reason: 'previous_owner' });
  });

  it('lets the NEW owner act', async () => {
    completeToBuyer();
    const { updateDisclosure } = await controllers();

    const out = await call(
      updateDisclosure,
      makeReq(BUYER, { creator_name: true }, { tagId: TAG_ID }),
    );

    expect(out.threw).toBeNull();
    expect((tag().disclosure as Row).creator_name).toBe(true);
  });
});

// ── Replace ─────────────────────────────────────────────────────────────────

describe('replace', () => {
  const NEW_TAG_ID = '88888888-8888-4888-8888-888888888888';
  const ITEM_ID = '99999999-9999-4999-8999-999999999999';

  const withReplacementChip = () => {
    tables.nfc_tags[0] = baseTag({
      lifecycle_status: 'ACTIVE',
      current_owner_id: OWNER,
      linked_item_id: ITEM_ID,
      disclosure: { origin_video: true, creator_name: false, claim_date: true, location: false },
    });
    tables.nfc_tags.push(baseTag({
      id: NEW_TAG_ID,
      tag_uid: 'BBCCDDEEFF0011',
      lifecycle_status: 'ENROLLED',
      current_owner_id: null,
      linked_item_id: null,
    }));
  };

  const newTag = (): Row => tables.nfc_tags.find((t) => t.id === NEW_TAG_ID) as Row;

  it('carries the item link, owner and disclosure to the new chip and retires the old', async () => {
    withReplacementChip();
    const { replaceTag } = await controllers();

    const out = await call(replaceTag, makeReq(OWNER, { oldTagId: TAG_ID, newTagId: NEW_TAG_ID }));

    expect(out.threw).toBeNull();
    expect(tag().lifecycle_status).toBe('RETIRED');
    expect(tag().current_owner_id).toBeNull();

    // The verify page must still show the original origin record.
    expect(newTag().lifecycle_status).toBe('ACTIVE');
    expect(newTag().current_owner_id).toBe(OWNER);
    expect(newTag().linked_item_id).toBe(ITEM_ID);
    expect((newTag().disclosure as Row).origin_video).toBe(true);

    expect(eventsNamed('nfc.replace')[0]).toMatchObject({
      result: 'ok', old_tag_id: TAG_ID, new_tag_id: NEW_TAG_ID,
    });
  });

  it('moves the current ownership proof onto the new chip', async () => {
    withReplacementChip();
    const { replaceTag } = await controllers();

    await call(replaceTag, makeReq(OWNER, { oldTagId: TAG_ID, newTagId: NEW_TAG_ID }));

    const current = tables.ownership_proofs.filter((p) => p.status === 'current');
    expect(current).toHaveLength(1);
    expect(current[0].tag_id).toBe(NEW_TAG_ID);
    expect(current[0].owner_id).toBe(OWNER);
  });

  it('refuses a replacement chip that is not ENROLLED', async () => {
    withReplacementChip();
    (tables.nfc_tags.find((t) => t.id === NEW_TAG_ID) as Row).lifecycle_status = 'ACTIVE';
    const { replaceTag } = await controllers();

    const out = await call(replaceTag, makeReq(OWNER, { oldTagId: TAG_ID, newTagId: NEW_TAG_ID }));

    expect(out.threw?.message).toMatch(/enrolled and unclaimed/i);
    expect(tag().lifecycle_status).toBe('ACTIVE');
  });

  it('refuses replace by a stranger but allows staff', async () => {
    withReplacementChip();
    const { replaceTag } = await controllers();

    const denied = await call(replaceTag, makeReq(STRANGER, { oldTagId: TAG_ID, newTagId: NEW_TAG_ID }));
    expect(denied.threw?.message).toMatch(/forbidden/i);

    const allowed = await call(replaceTag, makeReq(STAFF, { oldTagId: TAG_ID, newTagId: NEW_TAG_ID }));
    expect(allowed.threw).toBeNull();
    expect(newTag().current_owner_id).toBe(OWNER);
  });
});

// ── Re-issue ────────────────────────────────────────────────────────────────

describe('reissue request', () => {
  it('opens a PENDING request priced at $10 and refuses a duplicate', async () => {
    await claimFirst();
    const { requestReissue } = await controllers();

    const out = await call(requestReissue, makeReq(BUYER, { tagId: TAG_ID }));

    expect(out.threw).toBeNull();
    expect(tables.reissue_requests[0]).toMatchObject({
      status: 'PENDING', requester_id: BUYER, list_amount_usd_cents: 1000,
    });
    expect(eventsNamed('nfc.reissue_request')[0]).toMatchObject({ result: 'ok' });

    const dup = await call(requestReissue, makeReq(BUYER, { tagId: TAG_ID }));
    expect(dup.threw?.message).toMatch(/already open/i);
    expect(tables.reissue_requests).toHaveLength(1);
  });

  it('refuses a re-issue request on a released token', async () => {
    tables.nfc_tags[0] = baseTag({ lifecycle_status: 'RELEASED' });
    const { requestReissue } = await controllers();

    const out = await call(requestReissue, makeReq(BUYER, { tagId: TAG_ID }));

    expect(out.threw?.message).toMatch(/released/i);
    expect(eventsNamed('nfc.reissue_request')[0]).toMatchObject({ result: 'token_released' });
  });
});
