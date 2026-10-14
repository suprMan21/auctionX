/**
 * In-memory stand-ins for the S-ADMIN1 Ph3a database functions
 * (20261011000001_s_admin1_stuck_payments.sql), for the `rpc` hook of
 * supabaseMock.
 *
 * Database functions cannot run in memory, so these restate their rules over
 * the mock tables. That makes them a SECOND copy of the rules, and a copy can
 * drift: the functions themselves are proven on the real database by
 * supabase/tests/s_admin1_ph3a_live.sql. What these give the unit tests is
 * behaviour to assert against (did ownership move, did the incident close)
 * instead of "the function was called".
 *
 * Keep each branch in the same order as the SQL.
 */

import { randomUUID } from 'crypto';
import type { Row, Tables } from './supabaseMock';

type RpcAnswer = { data: unknown; error: { message: string } | null };

const SOURCES = ['webhook', 'sweep', 'reapply'];
const now = (): string => new Date().toISOString();
const fail = (message: string): RpcAnswer => ({ data: null, error: { message } });
const done = (data: Row): RpcAnswer => ({ data, error: null });

const table = (tables: Tables, name: string): Row[] => {
  if (!tables[name]) tables[name] = [];
  return tables[name];
};

const resolveOpenIncident = (tables: Tables, intent: unknown, source: unknown): void => {
  for (const inc of table(tables, 'payment_incidents')) {
    if (inc.stripe_payment_intent_id === intent && inc.status === 'OPEN') {
      Object.assign(inc, { status: 'RESOLVED', resolution: source, resolved_at: now() });
    }
  }
};

const applyTransferFee = (tables: Tables, a: Row): RpcAnswer => {
  if (!SOURCES.includes(String(a.p_source))) return fail('invalid_source');
  if (!a.p_intent) return fail('intent_required');

  const t = table(tables, 'ownership_transfers').find((r) => r.id === a.p_transfer);
  if (!t) return done({ outcome: 'not_found' });

  if (t.stripe_payment_intent_id && t.stripe_payment_intent_id !== a.p_intent) {
    return done({ outcome: 'intent_mismatch', tag_id: t.tag_id });
  }
  if (t.status === 'COMPLETED') {
    resolveOpenIncident(tables, a.p_intent, a.p_source);
    return done({ outcome: 'already_completed', tag_id: t.tag_id });
  }
  if (t.status !== 'PENDING') return done({ outcome: 'not_payable', tag_id: t.tag_id, status: t.status });
  if (!t.to_user_id) return done({ outcome: 'no_recipient', tag_id: t.tag_id });

  const tag = table(tables, 'nfc_tags').find((r) => r.id === t.tag_id);
  if (!tag || tag.lifecycle_status === 'RETIRED') {
    return done({ outcome: 'not_payable', tag_id: t.tag_id, status: 'tag_retired' });
  }

  Object.assign(t, {
    status: 'COMPLETED',
    transfer_fee_paid: true,
    completed_at: now(),
    transferred_at: now(),
    stripe_payment_intent_id: a.p_intent,
  });
  Object.assign(tag, {
    current_owner_id: t.to_user_id,
    lifecycle_status: tag.lifecycle_status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
  });
  for (const proof of table(tables, 'ownership_proofs')) {
    if (proof.tag_id === t.tag_id && proof.status === 'current') proof.status = 'stale';
  }
  table(tables, 'ownership_proofs').push({
    id: randomUUID(),
    tag_id: t.tag_id,
    ownership_event_id: a.p_transfer,
    ownership_event_type: 'transfer',
    ownership_id: a.p_ownership_id,
    tag_ref: a.p_tag_ref,
    salt_enc: a.p_salt_enc,
    owner_id: t.to_user_id,
    status: 'current',
  });
  resolveOpenIncident(tables, a.p_intent, a.p_source);
  return done({ outcome: 'applied', tag_id: t.tag_id, to_user_id: t.to_user_id });
};

const applyReissueFee = (tables: Tables, a: Row): RpcAnswer => {
  if (!SOURCES.includes(String(a.p_source))) return fail('invalid_source');
  if (!a.p_intent) return fail('intent_required');

  const req = table(tables, 'reissue_requests').find((r) => r.id === a.p_request);
  if (!req) return done({ outcome: 'not_found' });
  if ((req.stripe_payment_intent_id ?? null) !== a.p_intent) return done({ outcome: 'intent_mismatch' });

  const paidInfo = { requester_id: req.requester_id, charged_amount: req.charged_amount ?? null };
  if (req.payment_status === 'PAID') {
    resolveOpenIncident(tables, a.p_intent, a.p_source);
    return done({ outcome: 'already_paid', ...paidInfo });
  }
  if (req.status !== 'APPROVED' || req.payment_status !== 'AWAITING_PAYMENT') {
    return done({ outcome: 'not_payable', status: req.status, payment_status: req.payment_status ?? null });
  }

  Object.assign(req, { payment_status: 'PAID', paid_at: now() });
  resolveOpenIncident(tables, a.p_intent, a.p_source);
  return done({ outcome: 'applied', ...paidInfo });
};

const recordIncident = (tables: Tables, a: Row): RpcAnswer => {
  const incidents = table(tables, 'payment_incidents');
  const resolvedAs = (a.p_resolved_as ?? null) as string | null;
  if (resolvedAs !== null && !SOURCES.includes(resolvedAs)) return fail('invalid_source');

  const existing = incidents.find((r) => r.stripe_payment_intent_id === a.p_intent);
  if (!existing) {
    const transferExists = table(tables, 'ownership_transfers').some((r) => r.id === a.p_transfer);
    const reissueExists = table(tables, 'reissue_requests').some((r) => r.id === a.p_reissue);
    const row: Row = {
      id: randomUUID(),
      kind: a.p_kind,
      transfer_id: transferExists ? a.p_transfer : null,
      reissue_request_id: reissueExists ? a.p_reissue : null,
      stripe_payment_intent_id: a.p_intent,
      reason: a.p_reason,
      status: resolvedAs ? 'RESOLVED' : 'OPEN',
      resolution: resolvedAs,
      amount: a.p_amount ?? null,
      currency: a.p_currency ?? null,
      first_seen_at: now(),
      last_seen_at: now(),
      seen_count: 1,
      last_error: a.p_error ?? null,
      github_issue_number: null,
      github_issue_url: null,
      github_claimed_at: null,
      github_last_comment_at: null,
      resolved_at: resolvedAs ? now() : null,
      resolved_by: null,
      resolved_reason: null,
      stripe_refund_id: null,
    };
    incidents.push(row);
    return done({ ...row, is_new: true });
  }

  if (resolvedAs === null && existing.status === 'OPEN') {
    Object.assign(existing, {
      last_seen_at: now(),
      seen_count: Number(existing.seen_count) + 1,
      reason: a.p_reason,
      last_error: a.p_error ?? null,
    });
  }
  return done({ ...existing, is_new: false });
};

/** Mirrors payment_admin_actor_email: by ROLE NAME, active admins only. */
const actorAllowed = (tables: Tables, adminId: unknown, needAdmin: boolean): boolean => {
  const admin = table(tables, 'admin_users').find((r) => r.admin_id === adminId);
  if (!admin || admin.is_active !== true) return false;
  const role = table(tables, 'admin_roles').find((r) => r.role_id === admin.role_id);
  const name = String(role?.role_name ?? '');
  return name === 'admin' || name === 'super_admin' || (!needAdmin && name === 'support');
};

const audit = (tables: Tables, a: Row, action: string, changes: Row): void => {
  table(tables, 'audit_logs').push({
    log_id: randomUUID(),
    admin_id: a.p_admin,
    action,
    entity_type: 'payment_incident',
    entity_id: a.p_incident,
    changes,
    reason: a.p_reason,
    brand: 'auctionx',
  });
};

const adminReapply = (tables: Tables, a: Row): RpcAnswer => {
  if (!actorAllowed(tables, a.p_admin, false)) return fail('admin_forbidden: actor may not act on payments');
  if (String(a.p_reason ?? '').trim().length < 10) return fail('reason_required');

  const inc = table(tables, 'payment_incidents').find((r) => r.id === a.p_incident);
  if (!inc) return fail('incident_not_found');
  if (inc.status !== 'OPEN') return fail(`incident_not_open: ${String(inc.status)}`);

  let out: RpcAnswer;
  if (inc.kind === 'transfer_fee' && inc.transfer_id) {
    out = applyTransferFee(tables, {
      p_transfer: inc.transfer_id, p_intent: inc.stripe_payment_intent_id,
      p_ownership_id: a.p_ownership_id, p_tag_ref: a.p_tag_ref, p_salt_enc: a.p_salt_enc, p_source: 'reapply',
    });
  } else if (inc.kind === 'reissue_fee' && inc.reissue_request_id) {
    out = applyReissueFee(tables, {
      p_request: inc.reissue_request_id, p_intent: inc.stripe_payment_intent_id, p_source: 'reapply',
    });
  } else {
    out = done({ outcome: 'not_found' });
  }
  if (out.error) return out;

  const result = out.data as Row;
  if (['applied', 'already_completed', 'already_paid'].includes(String(result.outcome))) {
    Object.assign(inc, { resolved_by: a.p_admin, resolved_reason: a.p_reason });
  } else {
    Object.assign(inc, { last_seen_at: now(), last_error: `reapply_${String(result.outcome)}` });
  }
  audit(tables, a, 'payment_reapply', { kind: inc.kind, outcome: result.outcome });
  return done({ ...result, incident_id: a.p_incident, kind: inc.kind });
};

const adminRefund = (tables: Tables, a: Row): RpcAnswer => {
  if (!actorAllowed(tables, a.p_admin, true)) return fail('admin_forbidden: actor may not act on payments');
  if (String(a.p_reason ?? '').trim().length < 10) return fail('reason_required');
  if (!String(a.p_refund_id ?? '').trim()) return fail('refund_id_required');

  const inc = table(tables, 'payment_incidents').find((r) => r.id === a.p_incident);
  if (!inc) return fail('incident_not_found');
  if (inc.status !== 'OPEN') return fail(`incident_not_open: ${String(inc.status)}`);

  let cancelled = false;
  if (inc.kind === 'transfer_fee' && inc.transfer_id) {
    const t = table(tables, 'ownership_transfers').find((r) => r.id === inc.transfer_id);
    if (t && t.status === 'PENDING') {
      t.status = 'CANCELLED';
      cancelled = true;
    }
  }
  Object.assign(inc, {
    status: 'REFUNDED', resolution: 'refund', resolved_at: now(),
    resolved_by: a.p_admin, resolved_reason: a.p_reason, stripe_refund_id: a.p_refund_id,
  });
  audit(tables, a, 'payment_refund', { kind: inc.kind, refund_id: a.p_refund_id, transfer_cancelled: cancelled });
  return done({ incident_id: a.p_incident, status: 'REFUNDED', transfer_cancelled: cancelled });
};

/**
 * The `rpc` hook. `calls` records every call so a test can also assert on what
 * was sent. An unknown function throws, exactly like the mock without a hook.
 */
export const feeDbFake = (getTables: () => Tables, calls: Array<{ fn: string; args: Row }> = []) =>
  (fn: string, args: Row): RpcAnswer => {
    calls.push({ fn, args });
    const tables = getTables();
    switch (fn) {
      case 'apply_transfer_fee':
        return applyTransferFee(tables, args);
      case 'apply_reissue_fee':
        return applyReissueFee(tables, args);
      case 'record_payment_incident':
        return recordIncident(tables, args);
      case 'admin_reapply_payment':
        return adminReapply(tables, args);
      case 'admin_refund_payment_incident':
        return adminRefund(tables, args);
      default:
        throw new Error(`feeDbFake: rpc('${fn}') is not a Ph3a function`);
    }
  };
