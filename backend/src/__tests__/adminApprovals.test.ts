import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { type NextFunction, type Request, type Response } from 'express';
import { permissionsFor } from './helpers/adminRoles';
import { createMockSupabase, resetMockIds, type MockHooks, type Tables, type Row } from './helpers/supabaseMock';
import { canonicalJson, payloadHash } from '../lib/admin/approvals';

/**
 * S-2FA Ph3a — two-admin approval.
 *
 * Proven here:
 *   - flag off, or a caller with act_without_approval (super_admin): the action runs at once
 *   - flag on, daily admin: token reset / suspend and account suspend / retire are stored as a
 *     request (202) with the parsed payload and its hash; nothing runs
 *   - a reset whose typed confirmation is wrong is refused before a request is stored
 *   - approve needs a passkey step-up bound to the request, runs the STORED payload as the
 *     approver, refuses a payload that does not match its hash, and records the outcome
 *   - reject needs a reason; database refusals (own request, already decided) map to safe text
 *   - the queue: waiting_for_me hides your own requests, never returns the typed confirmation,
 *     and support (no manage_nfc / manage_users) is refused
 *
 * The database rules (audit row first, not your own request, one open request per target,
 * 24 h expiry, requester still active) are proven by supabase/tests/s_2fa_ph3a_approvals_live.sql.
 */

const ADMIN = '44444444-4444-4444-8444-444444444444';
const OTHER_ADMIN = '55555555-5555-4555-8555-555555555555';
const TARGET = '22222222-2222-4222-8222-222222222222';
const TAG = '33333333-3333-4333-8333-333333333333';
const NEW_TAG = '66666666-6666-4666-8666-666666666666';
const APPROVAL = '77777777-7777-4777-8777-777777777777';
const REASON = 'Support ticket 1234: account review';
const REISSUE = '88888888-8888-4888-8888-888888888888';

let tables: Tables;
let hooks: MockHooks;
let rpcCalls: Array<{ fn: string; args: Row }>;
let rpcAnswers: Record<string, { data?: unknown; error?: string }>;
let stepUpOk: boolean;
let stepUpCalls: Array<{ action: string; target: string }>;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(tables, hooks),
}));

vi.mock('../lib/mfa/jwtClaims', () => ({
  readVerifiedClaims: () => ({ sessionId: 'sess-1', sub: currentAdminId }),
}));

vi.mock('../lib/mfa/mfaService', () => ({
  consumeStepUp: async (_caller: unknown, _header: unknown, action: string, target: string) => {
    stepUpCalls.push({ action, target });
    return stepUpOk;
  },
  hasSecondFactor: async () => true,
}));

vi.mock('../lib/reissueEvidence', () => ({
  evidenceViewUrl: async (key: string) => `https://signed.example/${key}`,
}));

vi.mock('../lib/notifications/reissueEmails', () => ({
  notifyReissueOwner: async () => undefined,
}));

vi.mock('../lib/ownership/ownershipProof', () => ({
  mintOwnershipProof: () => ({ ownershipId: 'own-1', tagRef: 'ref-1', saltEnc: 'salt-1' }),
}));

let currentAdminId = ADMIN;

const appWith = async (role: string, adminId = ADMIN) => {
  currentAdminId = adminId;
  const { default: tags } = await import('../routes/admin/tags');
  const { default: users } = await import('../routes/admin/users');
  const { default: approvals } = await import('../routes/admin/approvals');
  const { default: reissue } = await import('../routes/admin/reissue');
  const { getMe } = await import('../controllers/adminAccountsController');
  const { handle } = await import('../routes/tagManagement');
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.headers.authorization = 'Bearer test.token.sig';
    (req as unknown as { admin: Row }).admin = {
      admin_id: adminId, email: `${role}@example.com`, role, permissions: permissionsFor(role), brand: 'both',
    };
    next();
  });
  app.get('/admin/me', handle(getMe));
  app.use('/admin/tags', tags);
  app.use('/admin/users', users);
  app.use('/admin/approvals', approvals);
  app.use('/admin/reissue-requests', reissue);
  return app;
};

beforeEach(() => {
  resetMockIds();
  vi.resetModules();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  process.env.FEATURE_ADMIN_TWO_PERSON = 'true';
  rpcCalls = [];
  stepUpOk = true;
  stepUpCalls = [];
  rpcAnswers = {
    admin_set_tag_suspension: { data: 'SUSPENDED' },
    admin_reset_token: { data: null },
    admin_suspend_account: { data: { status: 'suspended' } },
    admin_retire_account: { data: { status: 'retired' } },
    admin_request_approval: { data: { id: APPROVAL, expires_at: '2026-10-28T23:00:00Z' } },
    admin_record_approval_result: { data: null },
    admin_fulfil_reissue: { data: null },
    admin_unsuspend_account: { data: { status: 'active' } },
    admin_reactivate_account: { data: { status: 'active' } },
  };
  hooks = {
    rpc: (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      const a = rpcAnswers[fn];
      if (!a) throw new Error(`unexpected rpc ${fn}`);
      return { data: a.data ?? null, error: a.error ? { message: a.error } : null };
    },
  };
  tables = {
    nfc_tags: [
      { id: TAG, tag_uid: '04A27E02936980', chip_serial: 'AAAA00BBBB11CC22', chip_name: 'chip_004' },
      { id: NEW_TAG, tag_uid: '04A27E02936981', chip_serial: 'AAAA00BBBB11DD33', chip_name: 'chip_005' },
    ],
    users: [
      { id: ADMIN, email: 'admin@example.com' },
      { id: OTHER_ADMIN, email: 'admin2@example.com' },
      { id: TARGET, email: 'collector@example.com' },
    ],
    admin_action_approvals: [],
    reissue_requests: [{
      id: REISSUE, tag_id: TAG, requester_id: TARGET, status: 'APPROVED', payment_status: 'WAIVED',
      tap_session_id: null, photo_keys: ['ev/1.jpg', 'ev/2.jpg'], list_amount_usd_cents: 1000, charged_amount: null,
      charged_currency: null, review_reason: 'Seal lifting at the corner', waive_reason: 'Goodwill, first re-issue',
      reviewed_by: ADMIN, reviewed_at: '2026-10-27T09:00:00Z', paid_at: null, fulfilled_at: null, fulfilled_by: null,
      new_tag_id: null, created_at: '2026-10-26T12:00:00Z',
    }],
    audit_logs: [],
  };
});

afterEach(() => {
  delete process.env.FEATURE_ADMIN_TWO_PERSON;
});

const calls = (fn: string) => rpcCalls.filter((c) => c.fn === fn);

describe('gated actions', () => {
  it('flag off: a daily admin acts at once', async () => {
    process.env.FEATURE_ADMIN_TWO_PERSON = 'false';
    const app = await appWith('admin');
    const res = await request(app).post(`/admin/tags/${TAG}/suspend`).send({ reason: REASON });
    expect(res.status).toBe(200);
    expect(calls('admin_set_tag_suspension')).toHaveLength(1);
    expect(calls('admin_request_approval')).toHaveLength(0);
  });

  it('flag on: super_admin (act_without_approval) acts at once', async () => {
    const app = await appWith('super_admin');
    const res = await request(app).post(`/admin/users/${TARGET}/suspend`).send({ hours: 24, reason: REASON });
    expect(res.status).toBe(200);
    expect(calls('admin_suspend_account')).toHaveLength(1);
    expect(calls('admin_request_approval')).toHaveLength(0);
  });

  it.each([
    ['tag_suspend', `/admin/tags/${TAG}/suspend`, { reason: REASON }, TAG, 'admin_set_tag_suspension'],
    ['account_suspend', `/admin/users/${TARGET}/suspend`, { hours: 48, reason: REASON }, TARGET, 'admin_suspend_account'],
    ['account_retire', `/admin/users/${TARGET}/retire`, { reason: REASON }, TARGET, 'admin_retire_account'],
    ['tag_reset', `/admin/tags/${TAG}/reset`, { newTagId: NEW_TAG, reason: REASON, confirmSuffix: '11cc22' }, TAG, 'admin_reset_token'],
  ])('flag on: daily admin %s is stored for approval, nothing runs', async (action, path, body, target, actionRpc) => {
    const app = await appWith('admin');
    const res = await request(app).post(path).send(body);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      success: true,
      data: { approvalRequired: true, approvalId: APPROVAL, expiresAt: '2026-10-28T23:00:00Z' },
      error: null,
    });
    const [req] = calls('admin_request_approval');
    expect(req.args).toMatchObject({ p_admin: ADMIN, p_action: action, p_target: target, p_payload: body, p_reason: REASON });
    expect(req.args.p_payload_hash).toBe(payloadHash(body));
    expect(calls(actionRpc)).toHaveLength(0);
  });

  it('a reset with the wrong typed confirmation is refused before a request is stored', async () => {
    const app = await appWith('admin');
    const res = await request(app).post(`/admin/tags/${TAG}/reset`).send({ newTagId: NEW_TAG, reason: REASON, confirmSuffix: '000000' });
    expect(res.status).toBe(400);
    expect(calls('admin_request_approval')).toHaveLength(0);
  });

  it('an invalid body is refused before a request is stored', async () => {
    const app = await appWith('admin');
    const res = await request(app).post(`/admin/users/${TARGET}/suspend`).send({ hours: 0, reason: REASON });
    expect(res.status).toBe(400);
    expect(calls('admin_request_approval')).toHaveLength(0);
  });

  it('a second open request for the same target is refused with plain text', async () => {
    rpcAnswers.admin_request_approval = { error: 'approval_pending' };
    const app = await appWith('admin');
    const res = await request(app).post(`/admin/tags/${TAG}/suspend`).send({ reason: REASON });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already has a request waiting/);
  });

  it('GET /me says whether actions need approval', async () => {
    expect((await request(await appWith('admin')).get('/admin/me')).body.data.approvalRequired).toBe(true);
    expect((await request(await appWith('super_admin')).get('/admin/me')).body.data.approvalRequired).toBe(false);
  });
});

describe('re-issue fulfil and lifting holds', () => {
  const FULFIL = { newTagId: NEW_TAG, reason: REASON, confirmSuffix: '11cc22' };

  it('a daily admin\'s re-issue fulfil always waits, even after they approved the re-issue', async () => {
    const app = await appWith('admin');
    const res = await request(app).post(`/admin/reissue-requests/${REISSUE}/fulfil`).send(FULFIL);
    expect(res.status).toBe(202);
    expect(calls('admin_request_approval')[0].args).toMatchObject({ p_action: 'reissue_fulfil', p_target: REISSUE, p_payload: FULFIL });
    expect(calls('admin_fulfil_reissue')).toHaveLength(0);
  });

  it('a fulfil with the wrong confirmation is refused before a request is stored', async () => {
    const app = await appWith('admin');
    const res = await request(app).post(`/admin/reissue-requests/${REISSUE}/fulfil`).send({ ...FULFIL, confirmSuffix: '000000' });
    expect(res.status).toBe(400);
    expect(calls('admin_request_approval')).toHaveLength(0);
  });

  it('super_admin fulfils at once', async () => {
    const app = await appWith('super_admin');
    const res = await request(app).post(`/admin/reissue-requests/${REISSUE}/fulfil`).send(FULFIL);
    expect(res.status).toBe(200);
    expect(calls('admin_fulfil_reissue')).toHaveLength(1);
  });

  it('approving a stored fulfil runs it as the approver', async () => {
    rpcAnswers.admin_decide_approval = {
      data: { id: APPROVAL, action: 'reissue_fulfil', target_id: REISSUE, payload: FULFIL, payload_hash: payloadHash(FULFIL), requested_by: ADMIN },
    };
    const app = await appWith('admin', OTHER_ADMIN);
    const res = await request(app).post(`/admin/approvals/${APPROVAL}/approve`).send({});
    expect(res.status).toBe(200);
    expect(calls('admin_fulfil_reissue')[0].args).toMatchObject({ p_request: REISSUE, p_new_tag: NEW_TAG, p_admin: OTHER_ADMIN });
  });

  it.each([
    ['tag_unsuspend', `/admin/tags/${TAG}/unsuspend`, 'tag_suspend', 'nfc_tag', TAG, 'admin_set_tag_suspension'],
    ['account_unsuspend', `/admin/users/${TARGET}/unsuspend`, 'account_suspend', 'user', TARGET, 'admin_unsuspend_account'],
    ['account_reactivate', `/admin/users/${TARGET}/reactivate`, 'account_retire', 'user', TARGET, 'admin_reactivate_account'],
  ])('%s: your own hold lifts at once; someone else\'s waits; an unknown one waits', async (action, path, setAction, entityType, target, rpc) => {
    const app = await appWith('admin');
    // Unknown setter (no audit row): waits.
    expect((await request(app).post(path).send({ reason: REASON })).status).toBe(202);

    // Set by the caller (latest row): runs at once.
    tables.audit_logs.push(
      { log_id: 'h0', admin_id: OTHER_ADMIN, admin_email: 'admin2@example.com', action: setAction, entity_type: entityType, entity_id: target, reason: 'old hold', created_at: '2026-10-20T00:00:00Z' },
      { log_id: 'h1', admin_id: ADMIN, admin_email: 'admin@example.com', action: setAction, entity_type: entityType, entity_id: target, reason: 'my hold', created_at: '2026-10-27T00:00:00Z' },
    );
    rpcCalls.length = 0;
    expect((await request(app).post(path).send({ reason: REASON })).status).toBe(200);
    expect(calls(rpc)).toHaveLength(1);

    // Set by someone else: waits, nothing runs.
    tables.audit_logs.push({ log_id: 'h2', admin_id: OTHER_ADMIN, admin_email: 'admin2@example.com', action: setAction, entity_type: entityType, entity_id: target, reason: 'stolen token hold', created_at: '2026-10-27T05:00:00Z' });
    rpcCalls.length = 0;
    const res = await request(app).post(path).send({ reason: REASON });
    expect(res.status).toBe(202);
    expect(calls('admin_request_approval')[0].args.p_action).toBe(action);
    expect(calls(rpc)).toHaveLength(0);
  });

  it('the re-issue ticket carries everything needed to decide, never the typed confirmation', async () => {
    tables.admin_action_approvals = [{
      id: 'r1', action: 'reissue_fulfil', target_id: REISSUE, payload: FULFIL, reason: REASON, requested_by: ADMIN,
      requested_at: '2026-10-27T10:00:00Z', expires_at: '2099-01-01T00:00:00Z', decided_by: null, decided_at: null,
      decision: null, decision_note: null, executed_at: null, result: null,
    }];
    const res = await request(await appWith('admin', OTHER_ADMIN)).get('/admin/approvals?status=waiting_for_me');
    const [ticket] = res.body.data.approvals;
    expect(ticket.target).toEqual({ kind: 'reissue', id: REISSUE, tokenId: TAG, chipName: 'chip_004', serialSuffix: '11CC22' });
    expect(ticket.details).toEqual({
      newTagId: NEW_TAG,
      newChip: { chipName: 'chip_005', serialSuffix: '11DD33' },
      reissue: {
        id: REISSUE, status: 'APPROVED', paymentStatus: 'WAIVED', listAmountUsdCents: 1000, chargedAmount: null, chargedCurrency: null,
        waiveReason: 'Goodwill, first re-issue', reviewReason: 'Seal lifting at the corner',
        reviewedBy: { id: ADMIN, email: 'admin@example.com' }, reviewedAt: '2026-10-27T09:00:00Z',
        requestedAt: '2026-10-26T12:00:00Z', paidAt: null,
        owner: { id: TARGET, email: 'collector@example.com' },
        photoCount: 2, photoUrls: ['https://signed.example/ev/1.jpg', 'https://signed.example/ev/2.jpg'],
      },
    });
    expect(ticket.canApprove).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('confirmSuffix');
  });

  it('a hold-lifting ticket says who set the hold', async () => {
    tables.audit_logs.push({ log_id: 'h1', admin_id: OTHER_ADMIN, admin_email: 'admin2@example.com', action: 'account_suspend', entity_type: 'user', entity_id: TARGET, reason: 'Fraud review', created_at: '2026-10-27T01:00:00Z' });
    tables.admin_action_approvals = [{
      id: 'u1', action: 'account_unsuspend', target_id: TARGET, payload: { reason: REASON }, reason: REASON, requested_by: ADMIN,
      requested_at: '2026-10-27T10:00:00Z', expires_at: '2099-01-01T00:00:00Z', decided_by: null, decided_at: null,
      decision: null, decision_note: null, executed_at: null, result: null,
    }];
    const res = await request(await appWith('admin', OTHER_ADMIN)).get('/admin/approvals?status=open');
    expect(res.body.data.approvals[0].details).toEqual({
      hold: { setBy: { id: OTHER_ADMIN, email: 'admin2@example.com' }, setAt: '2026-10-27T01:00:00Z', reason: 'Fraud review' },
    });
  });
});

describe('approve', () => {
  const decided = (payload: Row, action = 'account_suspend', target = TARGET, hash = payloadHash(payload)) => ({
    data: { id: APPROVAL, action, target_id: target, payload, payload_hash: hash, requested_by: ADMIN, decision: 'approved' },
  });

  it('needs a passkey step-up bound to the request', async () => {
    stepUpOk = false;
    rpcAnswers.admin_decide_approval = decided({ hours: 24, reason: REASON });
    const app = await appWith('admin', OTHER_ADMIN);
    const res = await request(app).post(`/admin/approvals/${APPROVAL}/approve`).send({});
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('step_up_required');
    expect(stepUpCalls).toEqual([{ action: 'admin_approve', target: APPROVAL }]);
    expect(calls('admin_decide_approval')).toHaveLength(0);
  });

  it('runs the stored payload as the approver and records the outcome', async () => {
    rpcAnswers.admin_decide_approval = decided({ hours: 72, reason: REASON });
    const app = await appWith('admin', OTHER_ADMIN);
    const res = await request(app).post(`/admin/approvals/${APPROVAL}/approve`).send({});
    expect(res.status).toBe(200);
    expect(calls('admin_decide_approval')[0].args).toMatchObject({ p_admin: OTHER_ADMIN, p_id: APPROVAL, p_decision: 'approved' });
    expect(calls('admin_suspend_account')[0].args).toEqual({ p_admin: OTHER_ADMIN, p_target: TARGET, p_hours: 72, p_reason: REASON });
    expect(calls('admin_record_approval_result')[0].args).toEqual({ p_id: APPROVAL, p_result: { ok: true } });
  });

  it('runs a stored reset, re-checking the typed confirmation', async () => {
    rpcAnswers.admin_decide_approval = decided({ newTagId: NEW_TAG, reason: REASON, confirmSuffix: '11CC22' }, 'tag_reset', TAG);
    const app = await appWith('admin', OTHER_ADMIN);
    const res = await request(app).post(`/admin/approvals/${APPROVAL}/approve`).send({});
    expect(res.status).toBe(200);
    expect(calls('admin_reset_token')[0].args).toMatchObject({ p_old_tag: TAG, p_new_tag: NEW_TAG, p_admin: OTHER_ADMIN });
  });

  it('refuses a payload that does not match its hash; nothing runs', async () => {
    rpcAnswers.admin_decide_approval = decided({ hours: 8760, reason: REASON }, 'account_suspend', TARGET, payloadHash({ hours: 1, reason: REASON }));
    const app = await appWith('admin', OTHER_ADMIN);
    const res = await request(app).post(`/admin/approvals/${APPROVAL}/approve`).send({});
    expect(res.status).toBe(500);
    expect(calls('admin_suspend_account')).toHaveLength(0);
    expect(calls('admin_record_approval_result')[0].args.p_result).toMatchObject({ ok: false });
  });

  it('records a failed run and returns its error', async () => {
    rpcAnswers.admin_decide_approval = decided({ reason: REASON }, 'account_retire');
    rpcAnswers.admin_retire_account = { error: 'already_retired: x' };
    const app = await appWith('admin', OTHER_ADMIN);
    const res = await request(app).post(`/admin/approvals/${APPROVAL}/approve`).send({});
    expect(res.status).toBe(409);
    expect(calls('admin_record_approval_result')[0].args.p_result).toEqual({
      ok: false, code: 'conflict', message: 'This account is already retired.',
    });
  });

  it.each([
    ['same_admin', 403, /different admin/],
    ['approval_closed', 409, /already been decided/],
    ['approval_expired', 409, /expired after 24 hours/],
    ['requester_inactive', 409, /no longer has access/],
    ['something_unexpected: raw db text', 500, /Nothing was changed/],
  ])('database refusal %s maps to safe text', async (dbError, status, text) => {
    rpcAnswers.admin_decide_approval = { error: dbError };
    const app = await appWith('admin');
    const res = await request(app).post(`/admin/approvals/${APPROVAL}/approve`).send({});
    expect(res.status).toBe(status);
    expect(res.body.error).toMatch(text);
    expect(JSON.stringify(res.body)).not.toContain('raw db text');
  });

  it('a body is not accepted (nothing about the action can be changed at approval)', async () => {
    const app = await appWith('admin', OTHER_ADMIN);
    const res = await request(app).post(`/admin/approvals/${APPROVAL}/approve`).send({ hours: 1 });
    expect(res.status).toBe(400);
    expect(calls('admin_decide_approval')).toHaveLength(0);
  });
});

describe('reject and cancel', () => {
  it('reject needs a reason of at least 10 characters', async () => {
    rpcAnswers.admin_decide_approval = { data: {} };
    const app = await appWith('admin', OTHER_ADMIN);
    expect((await request(app).post(`/admin/approvals/${APPROVAL}/reject`).send({ reason: 'no' })).status).toBe(400);
    const res = await request(app).post(`/admin/approvals/${APPROVAL}/reject`).send({ reason: 'Wrong account, see ticket 99' });
    expect(res.status).toBe(200);
    expect(calls('admin_decide_approval')[0].args).toEqual({ p_admin: OTHER_ADMIN, p_id: APPROVAL, p_decision: 'rejected', p_note: 'Wrong account, see ticket 99' });
  });

  it('cancel by someone else is refused with plain text', async () => {
    rpcAnswers.admin_decide_approval = { error: 'not_requester' };
    const app = await appWith('admin', OTHER_ADMIN);
    const res = await request(app).post(`/admin/approvals/${APPROVAL}/cancel`).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Only the admin who asked/);
  });
});

describe('queue', () => {
  const future = '2099-01-01T00:00:00Z';
  const past = '2020-01-01T00:00:00Z';
  const row = (id: string, extra: Row): Row => ({
    id, action: 'tag_reset', target_id: TAG,
    payload: { newTagId: NEW_TAG, reason: REASON, confirmSuffix: '11CC22' },
    reason: REASON, requested_by: ADMIN, requested_at: '2026-10-27T10:00:00Z', expires_at: future,
    decided_by: null, decided_at: null, decision: null, decision_note: null, executed_at: null, result: null,
    ...extra,
  });

  beforeEach(() => {
    tables.admin_action_approvals = [
      row('a1', {}),
      row('a2', { requested_by: OTHER_ADMIN, action: 'account_suspend', target_id: TARGET, payload: { hours: 24, reason: REASON } }),
      row('a3', { expires_at: past }),
      row('a4', { decision: 'approved', decided_by: OTHER_ADMIN, decided_at: '2026-10-27T11:00:00Z', result: { ok: true } }),
    ];
  });

  it('waiting_for_me hides your own requests', async () => {
    const res = await request(await appWith('admin')).get('/admin/approvals?status=waiting_for_me');
    expect(res.status).toBe(200);
    expect(res.body.data.approvals.map((a: Row) => a.id)).toEqual(['a2']);
    expect(res.body.data.approvals[0]).toMatchObject({
      status: 'pending', canApprove: true, canCancel: false,
      target: { kind: 'account', id: TARGET, email: 'collector@example.com' },
      requestedBy: { id: OTHER_ADMIN, email: 'admin2@example.com' },
      details: { hours: 24 },
    });
  });

  it('open shows your own request as cancellable, not approvable', async () => {
    const res = await request(await appWith('admin')).get('/admin/approvals?status=open');
    const mine = res.body.data.approvals.find((a: Row) => a.id === 'a1');
    expect(mine).toMatchObject({ canApprove: false, canCancel: true, target: { kind: 'token', chipName: 'chip_004', serialSuffix: '11CC22' } });
    expect(mine.details.newChip).toEqual({ chipName: 'chip_005', serialSuffix: '11DD33' });
    expect(res.body.data.approvals.map((a: Row) => a.id).sort()).toEqual(['a1', 'a2']);
  });

  it('closed includes expired and decided requests', async () => {
    const res = await request(await appWith('admin')).get('/admin/approvals?status=closed');
    const byId = Object.fromEntries(res.body.data.approvals.map((a: Row) => [a.id, a.status]));
    expect(byId).toEqual({ a3: 'expired', a4: 'approved' });
  });

  it('never returns the typed confirmation or the raw payload', async () => {
    const res = await request(await appWith('admin')).get('/admin/approvals?status=all');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('confirmSuffix');
    expect(text).not.toContain('payload');
  });

  it('id returns just that request', async () => {
    const res = await request(await appWith('admin')).get('/admin/approvals?status=all&id=77777777-7777-4777-8777-777777777777');
    expect(res.status).toBe(200);
    expect(res.body.data.approvals).toEqual([]);
    tables.admin_action_approvals.push(row('77777777-7777-4777-8777-777777777777', {}));
    const res2 = await request(await appWith('admin')).get('/admin/approvals?status=all&id=77777777-7777-4777-8777-777777777777');
    expect(res2.body.data.approvals.map((a: Row) => a.id)).toEqual(['77777777-7777-4777-8777-777777777777']);
  });

  it('support (no manage_nfc / manage_users) is refused', async () => {
    const res = await request(await appWith('support')).get('/admin/approvals');
    expect(res.status).toBe(403);
  });
});

describe('payload hash', () => {
  it('is stable across key order (Postgres jsonb reorders keys)', () => {
    expect(canonicalJson({ reason: 'x', hours: 2 })).toBe(canonicalJson({ hours: 2, reason: 'x' }));
    expect(payloadHash({ b: { d: 1, c: 2 }, a: [1, 2] })).toBe(payloadHash({ a: [1, 2], b: { c: 2, d: 1 } }));
    expect(payloadHash({ hours: 1 })).not.toBe(payloadHash({ hours: 2 }));
  });
});
