import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, resetMockIds, type MockHooks, type Tables, type Row } from './helpers/supabaseMock';

/**
 * Legacy public chip endpoints (GET /nfc/:tagId, GET /nfc/by-uid/:uid), still
 * read by the mobile app. Anyone may call them without signing in, so they
 * return only public-safe data (2026-10-26): never the full chip UID, account
 * IDs, the tap history's IP addresses, browsers, tap links or scanners, the
 * owner's wallet, or marketplace review records.
 */

const TAG = '33333333-3333-4333-8333-333333333333';
const OWNER = '11111111-1111-4111-8111-111111111111';
const CREATOR = '22222222-2222-4222-8222-222222222222';
const SCANNER = '44444444-4444-4444-8444-444444444444';
const UID = '04A27E02936980';

let tables: Tables;
let hooks: MockHooks;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => createMockSupabase(tables, hooks) }));

const SECRETS = [
  UID, OWNER, CREATOR, SCANNER, '203.0.113.5', 'Mozilla/5.0', 'picc_data=SECRET', '0xWALLET',
  'reviewer note', 'tenant-1', 'internal metadata',
];

beforeEach(() => {
  resetMockIds();
  vi.resetModules();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  hooks = {};
  tables = {
    nfc_tags: [{
      id: TAG, tag_uid: UID, chip_serial: null, tenant_id: 'tenant-1', item_id: null, seller_id: CREATOR,
      verification_id: 'v-1', status: 'active', sun_counter: 12, registered_at: '2026-10-01T00:00:00Z',
      activated_at: '2026-10-02T00:00:00Z', metadata: { note: 'internal metadata' }, lifecycle_status: 'ACTIVE',
      current_owner_id: OWNER, linked_item_id: null, disclosure: {},
    }],
    verification_events: [{
      id: 'e1', tag_id: TAG, scan_type: 'verification', cmac_valid: true, created_at: '2026-10-20T00:00:00Z',
      video_proof_status: null, sun_counter_value: 12, scanned_by: SCANNER, ip_address: '203.0.113.5',
      user_agent: 'Mozilla/5.0', sun_message: 'https://am.example/verify/x?picc_data=SECRET',
    }],
    nft_metadata: [{
      tag_id: TAG, chain: 'base', contract_address: '0xCONTRACT', token_id: '7', mint_tx_hash: '0xTX',
      metadata_uri: 'ipfs://meta', minted_at: '2026-10-03T00:00:00Z', owner_wallet: '0xWALLET', metadata_json: {},
    }],
    public_tag_provenance: [{ tag_id: TAG, creator_name: 'Studio A' }],
    item_verifications: [{ id: 'v-1', notes: 'reviewer note' }],
    users: [{ id: CREATOR, display_name: 'Creator Private Name' }],
  };
});

const call = async (handler: 'getTagVerification' | 'getTagByUid', params: Row) => {
  const mod = await import('../controllers/nfcController');
  const out: { status: number; body: Row | null } = { status: 200, body: null };
  const res = {
    status(code: number) { out.status = code; return this; },
    json(body: Row) { out.body = body; return this; },
  };
  await (mod[handler] as unknown as (req: unknown, res: unknown) => Promise<void>)(
    { params, requestId: 't', path: '/x', headers: {} }, res,
  );
  return out;
};

describe.each([
  ['GET /nfc/:tagId', 'getTagVerification' as const, { tagId: TAG }],
  ['GET /nfc/by-uid/:uid', 'getTagByUid' as const, { tagUid: UID.toLowerCase() }],
])('%s (public)', (_name, handler, params) => {
  it('returns the public view only', async () => {
    const out = await call(handler, params);
    expect(out.status).toBe(200);
    const data = (out.body as { data: Row }).data;
    expect(data.tag).toEqual({
      id: TAG, tag_uid: '…936980', status: 'active', lifecycle_status: 'ACTIVE',
      registered_at: '2026-10-01T00:00:00Z', activated_at: '2026-10-02T00:00:00Z', linked_item_id: null,
    });
    expect(data.events).toEqual([{ scan_type: 'verification', cmac_valid: true, created_at: '2026-10-20T00:00:00Z', video_proof_status: null }]);
    expect(data.nft).toMatchObject({ chain: 'base', contract_address: '0xCONTRACT', token_id: '7' });
    expect(data.verification).toBeNull();
    expect(data.seller).toEqual({ display_name: 'Studio A' }); // vetted provenance name, not the users row
  });

  it('never carries private fields', async () => {
    const raw = JSON.stringify((await call(handler, params)).body);
    for (const secret of SECRETS) expect(raw).not.toContain(secret);
    for (const key of ['current_owner_id', 'seller_id', 'scanned_by', 'ip_address', 'user_agent', 'sun_message', 'sun_counter', 'owner_wallet']) {
      expect(raw).not.toContain(`"${key}"`);
    }
  });
});

describe('input checks', () => {
  it('a malformed token ID or UID is a plain 404, nothing read', async () => {
    expect((await call('getTagVerification', { tagId: 'not-a-uuid' })).status).toBe(404);
    expect((await call('getTagByUid', { tagUid: 'zz' })).status).toBe(404);
  });
});
