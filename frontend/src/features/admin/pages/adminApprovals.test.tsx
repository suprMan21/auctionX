import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Approval } from '../api/approvalSchemas';
import type { AccountDetail } from '../api/accountSchemas';
import type { AdminTag } from '../api/adminApi';

/**
 * S-2FA Ph3a — two-admin approval: the queue, Approve behind a passkey check,
 * Reject with a reason, Cancel on your own request, "Sent for approval" from
 * the action dialogs, the nav badge and the audit-log link.
 */

const api = vi.hoisted(() => ({
  listApprovals: vi.fn(),
  approveApproval: vi.fn(),
  rejectApproval: vi.fn(),
  cancelApproval: vi.fn(),
  setTagSuspension: vi.fn(),
  resetTag: vi.fn(),
  listTags: vi.fn(),
  suspendAccount: vi.fn(),
  accountAction: vi.fn(),
  listReissueRequests: vi.fn(),
  listStuckPayments: vi.fn(),
  fulfilReissue: vi.fn(),
}));

vi.mock('../api/adminApi', async () => {
  const actual = await vi.importActual<typeof import('../api/adminApi')>('../api/adminApi');
  return { ...actual, adminApi: api };
});

// The passkey check itself is covered in security.test.tsx; here it hands back a grant.
const stepUp = vi.hoisted(() => ({ grants: [] as string[] }));
vi.mock('@/features/security/components/StepUpPanel', () => ({
  StepUpPanel: ({ action, targetId, onConfirmed }: { action: string; targetId: string; onConfirmed: (t: string) => void }) => (
    <div data-testid="step-up" data-action={action} data-target={targetId}>
      <p>Confirm it&apos;s you</p>
      <button type="button" onClick={() => onConfirmed(stepUp.grants.shift() ?? 'grant')}>Use passkey</button>
    </div>
  ),
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ session: { user: { id: 'me-1', email: 'admin@example.com' } }, loading: false, initialized: true, signOut: vi.fn() }),
}));

import { AdminApprovalsPage } from './AdminApprovalsPage';
import { AdminSuspendDialog } from '../components/AdminTagDialogs';
import { AccountActionDialog } from '../components/AdminAccountDialogs';
import { AdminReissueFulfilDialog } from '../components/AdminReissueDialogs';
import type { AdminReissueRequest } from '../api/adminApi';
import { AdminLayout } from '../AdminLayout';
import { AdminApiError } from '../api/adminApi';
import { AdminRoleContext, type AdminAccessState } from '../lib/adminRole';
import { accessFor } from '../test/adminAccess';
import { recordLinkFor } from '../lib/recordLinks';
import { auditActionLabel, auditEntityLabel } from '../lib/labels';

const REQ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TAG = '55555555-5555-4555-8555-555555555555';
const USER = '22222222-2222-4222-8222-222222222222';
const REASON = 'Owner reported the item stolen yesterday';

const approval = (overrides: Partial<Approval> = {}): Approval => ({
  id: REQ,
  action: 'tag_suspend',
  status: 'pending',
  target: { kind: 'token', id: TAG, chipName: 'chip_004', serialSuffix: 'AE6CA9' },
  details: {},
  reason: REASON,
  requestedBy: { id: 'other-admin', email: 'admin2@example.com' },
  requestedAt: '2026-10-27T10:00:00.000Z',
  expiresAt: '2026-10-28T10:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  executedAt: null,
  outcome: null,
  canApprove: true,
  canCancel: false,
  ...overrides,
});

const list = (approvals: Approval[]) => ({
  approvals,
  pagination: { page: 1, limit: 25, total: approvals.length, pages: 1 },
});

const renderPage = (path = '/admin/approvals', access: AdminAccessState = accessFor('admin')) =>
  render(
    <AdminRoleContext.Provider value={access}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/approvals" element={<AdminApprovalsPage />} />
        </Routes>
      </MemoryRouter>
    </AdminRoleContext.Provider>,
  );

const stepUpRefusal = () => new AdminApiError('Confirm it is you first.', 403, 'step_up_required');

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  stepUp.grants = [];
});

describe('AdminApprovalsPage', () => {
  it('opens on Waiting for you and lists what, target, who and why', async () => {
    api.listApprovals.mockResolvedValue(list([approval()]));
    renderPage();

    const table = await screen.findByRole('table', { name: 'Approval requests' });
    expect(api.listApprovals).toHaveBeenCalledWith({ status: 'waiting_for_me', page: 1, limit: 25 });
    expect(screen.getByRole('button', { name: 'Waiting for you' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(table).getByRole('link', { name: 'Suspend token' })).toHaveAttribute('href', `/admin/approvals?request=${REQ}`);
    expect(within(table).getByRole('link', { name: 'chip_004' })).toHaveAttribute('href', `/admin/tags/${TAG}`);
    expect(within(table).getByText('admin2@example.com')).toBeInTheDocument();
    expect(within(table).getByText(REASON)).toBeInTheDocument();
    expect(within(table).getByText('Waiting for approval')).toBeInTheDocument();
  });

  it('filters by Open, Done and All', async () => {
    const user = userEvent.setup();
    api.listApprovals.mockResolvedValue(list([]));
    renderPage();
    expect(await screen.findByText(/Nothing is waiting for you/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(api.listApprovals).toHaveBeenLastCalledWith({ status: 'closed', page: 1, limit: 25 }));
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(api.listApprovals).toHaveBeenLastCalledWith({ status: 'open', page: 1, limit: 25 }));
    await user.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(api.listApprovals).toHaveBeenLastCalledWith({ status: 'all', page: 1, limit: 25 }));
  });

  it('a row click opens the request', async () => {
    const user = userEvent.setup();
    api.listApprovals.mockResolvedValue(list([approval()]));
    renderPage();
    const table = await screen.findByRole('table', { name: 'Approval requests' });
    await user.click(within(table).getByText(REASON));
    const dialog = await screen.findByRole('dialog', { name: 'Suspend token: chip_004' });
    expect(within(dialog).getByRole('button', { name: 'Approve…' })).toBeInTheDocument();
  });

  it('Approve asks for the passkey, retries with a new one when refused, and ends on Approved', async () => {
    const user = userEvent.setup();
    api.listApprovals.mockResolvedValue(list([approval()]));
    api.approveApproval.mockRejectedValueOnce(stepUpRefusal()).mockResolvedValueOnce({ approvalId: REQ, status: 'approved', result: {} });
    stepUp.grants = ['grant-1', 'grant-2'];
    renderPage(`/admin/approvals?request=${REQ}`);

    const dialog = await screen.findByRole('dialog', { name: 'Suspend token: chip_004' });
    await user.click(await within(dialog).findByRole('button', { name: 'Approve…' }));
    const panel = within(dialog).getByTestId('step-up');
    expect(panel).toHaveAttribute('data-action', 'admin_approve');
    expect(panel).toHaveAttribute('data-target', REQ);
    expect(api.approveApproval).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Use passkey' }));
    await waitFor(() => expect(api.approveApproval).toHaveBeenCalledWith(REQ, 'grant-1'));
    // The grant was not accepted: the passkey check comes back.
    await user.click(await within(dialog).findByRole('button', { name: 'Use passkey' }));
    await waitFor(() => expect(api.approveApproval).toHaveBeenLastCalledWith(REQ, 'grant-2'));
    expect(await within(dialog).findByText('Approved. Suspend token is done.')).toBeInTheDocument();
  });

  it('shows why an approved request did not run', async () => {
    api.listApprovals.mockResolvedValue(list([approval({
      action: 'tag_reset',
      status: 'approved',
      canApprove: false,
      details: { newTagId: TAG, newChip: { chipName: 'chip_005', serialSuffix: '11AA22' } },
      decidedBy: { id: 'me-1', email: 'admin@example.com' },
      decidedAt: '2026-10-27T11:00:00.000Z',
      outcome: { ok: false, message: 'A transfer is pending on this token; cancel it first' },
    })]));
    renderPage(`/admin/approvals?request=${REQ}`);
    const dialog = await screen.findByRole('dialog', { name: 'Move token to a new chip: chip_004' });
    expect(within(dialog).getByText('Approved, but it did not run: A transfer is pending on this token; cancel it first')).toBeInTheDocument();
    expect(within(dialog).getByText('chip_005')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Approve…' })).not.toBeInTheDocument();
  });

  it('Reject needs a reason of at least 10 characters', async () => {
    const user = userEvent.setup();
    api.listApprovals.mockResolvedValue(list([approval()]));
    api.rejectApproval.mockResolvedValue({ approvalId: REQ, status: 'rejected' });
    renderPage(`/admin/approvals?request=${REQ}`);

    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: 'Reject…' }));
    const button = within(dialog).getByRole('button', { name: 'Reject request' });
    expect(button).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason/), 'too short');
    expect(button).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason/), ' but now long enough');
    await user.click(button);
    expect(api.rejectApproval).toHaveBeenCalledWith(REQ, 'too short but now long enough');
    expect(await within(dialog).findByText('Rejected. Nothing was changed.')).toBeInTheDocument();
  });

  it('Cancel request shows only on your own request', async () => {
    const user = userEvent.setup();
    api.listApprovals.mockResolvedValue(list([approval()]));
    const { unmount } = renderPage(`/admin/approvals?request=${REQ}`);
    const other = await screen.findByRole('dialog');
    await within(other).findByRole('button', { name: 'Approve…' });
    expect(within(other).queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
    unmount();

    api.listApprovals.mockResolvedValue(list([approval({ canApprove: false, canCancel: true, requestedBy: { id: 'me-1', email: 'admin@example.com' } })]));
    api.cancelApproval.mockResolvedValue({ approvalId: REQ, status: 'cancelled' });
    renderPage(`/admin/approvals?request=${REQ}`);
    const mine = await screen.findByRole('dialog');
    expect(within(mine).queryByRole('button', { name: 'Approve…' })).not.toBeInTheDocument();
    await user.click(await within(mine).findByRole('button', { name: 'Cancel request' }));
    expect(api.cancelApproval).toHaveBeenCalledWith(REQ);
    expect(await within(mine).findByText('Request cancelled. Nothing was changed.')).toBeInTheDocument();
  });
});

// ── The action dialogs ──────────────────────────────────────────────────────

const tag: AdminTag = {
  id: TAG, chipName: 'chip_004', uidSuffix: '936980', serialSuffix: 'AE6CA9', lifecycleStatus: 'ACTIVE', ownerAccountId: null,
  creatorAccountId: null, itemId: null, sdmKeyVersion: 2, sunCounter: 3, registeredAt: null, activatedAt: null,
  suspendedAt: null, suspendedReason: null, retiredAt: null, retiredReason: null, replacedByTagId: null, destructionStatus: null,
};

const pending = { success: true, data: { approvalRequired: true, approvalId: REQ, expiresAt: '2026-10-28T10:00:00.000Z' }, error: null };

const inConsole = (ui: React.ReactNode, access: AdminAccessState) =>
  render(
    <AdminRoleContext.Provider value={access}>
      <MemoryRouter>{ui}</MemoryRouter>
    </AdminRoleContext.Provider>,
  );

describe('actions that wait for a second admin', () => {
  it('token suspend says so up front, then shows Sent for approval with a link to the request', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    api.setTagSuspension.mockResolvedValue(pending);
    inConsole(<AdminSuspendDialog open tag={tag} suspend onClose={vi.fn()} onDone={onDone} />, accessFor('admin', 'me-1', true));

    expect(screen.getByText(/Another admin approves this before it happens/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Reason/), REASON);
    await user.click(screen.getByRole('button', { name: 'Send for approval' }));

    expect(await screen.findByText('Sent for approval.')).toBeInTheDocument();
    expect(screen.getByText(/must approve this within 24 hours/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the request' })).toHaveAttribute('href', `/admin/approvals?request=${REQ}`);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('without approval mode the button keeps its own name', () => {
    inConsole(<AdminSuspendDialog open tag={tag} suspend onClose={vi.fn()} onDone={vi.fn()} />, accessFor('super_admin'));
    expect(screen.getByRole('button', { name: 'Suspend token' })).toBeInTheDocument();
    expect(screen.queryByText(/Another admin approves this/)).not.toBeInTheDocument();
  });

  it('a request already waiting shows as an error in the dialog', async () => {
    const user = userEvent.setup();
    api.setTagSuspension.mockRejectedValue(new AdminApiError('This token already has a request waiting for approval.', 409, 'conflict'));
    inConsole(<AdminSuspendDialog open tag={tag} suspend onClose={vi.fn()} onDone={vi.fn()} />, accessFor('admin', 'me-1', true));
    await user.type(screen.getByLabelText(/Reason/), REASON);
    await user.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This token already has a request waiting for approval.');
  });

  it('account retire answered 202 shows Sent for approval', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    api.accountAction.mockResolvedValue({ approvalRequired: true, approvalId: REQ, expiresAt: '2026-10-28T10:00:00.000Z' });
    const account = {
      id: USER, email: 'fan@example.com', email_confirmed: true, display_name: null, created_at: '2026-10-01T00:00:00Z',
      last_sign_in_at: null, status: 'active', account_type: 'collector', creator_requested_at: null, creator_check_status: 'NONE',
      suspended_at: null, suspended_until: null, suspension_reason: null, retired_at: null, retire_reason: null, retired_by_email: null,
      staff_role: null, age_verified: false, active_sessions: 0, pending_transfers: 0, is_self: false, delete: null,
    } as AccountDetail;
    inConsole(<AccountActionDialog open action="retire" account={account} onClose={vi.fn()} onDone={onDone} />, accessFor('admin', 'me-1', true));
    await user.type(screen.getByLabelText(/Reason/), REASON);
    await user.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(api.accountAction).toHaveBeenCalledWith(USER, 'retire', REASON);
    expect(await screen.findByText('Sent for approval.')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});

// ── Nav badge, dashboard count source, audit links ──────────────────────────

describe('approvals in the rest of the console', () => {
  it('the nav badge counts requests waiting for this admin', async () => {
    api.listApprovals.mockResolvedValue({ approvals: [], pagination: { page: 1, limit: 1, total: 3, pages: 3 } });
    api.listReissueRequests.mockResolvedValue({ success: true, data: { requests: [], pagination: { page: 1, limit: 1, total: 0 } } });
    api.listStuckPayments.mockResolvedValue({ success: true, data: { incidents: [], total: 0 } });
    render(
      <AdminRoleContext.Provider value={accessFor('admin')}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes><Route path="/admin" element={<AdminLayout />} /></Routes>
        </MemoryRouter>
      </AdminRoleContext.Provider>,
    );
    const nav = screen.getAllByRole('navigation')[0];
    await waitFor(() => expect(within(nav).getByRole('link', { name: /Approvals/ })).toHaveTextContent('3 waiting'));
    expect(api.listApprovals).toHaveBeenCalledWith({ status: 'waiting_for_me', limit: 1 });
  });

  it('no Approvals item or count call without manage_nfc or manage_users', () => {
    api.listStuckPayments.mockResolvedValue({ success: true, data: { incidents: [], total: 0 } });
    render(
      <AdminRoleContext.Provider value={accessFor('support')}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes><Route path="/admin" element={<AdminLayout />} /></Routes>
        </MemoryRouter>
      </AdminRoleContext.Provider>,
    );
    const nav = screen.getAllByRole('navigation')[0];
    expect(within(nav).queryByRole('link', { name: /Approvals/ })).not.toBeInTheDocument();
    expect(api.listApprovals).not.toHaveBeenCalled();
  });

  it('audit rows about a request link to it and read in plain words', () => {
    const log = { entity_type: 'admin_approval', entity_id: REQ };
    expect(recordLinkFor(log, accessFor('admin'))).toBe(`/admin/approvals?request=${REQ}`);
    expect(recordLinkFor(log, accessFor('support'))).toBeNull();
    expect(auditEntityLabel('admin_approval')).toBe('Approval request');
    expect(auditActionLabel('approval_request')).toBe('Sent for approval');
    expect(auditActionLabel('approval_approve')).toBe('Request approved');
    expect(auditActionLabel('approval_reject')).toBe('Request rejected');
    expect(auditActionLabel('approval_cancel')).toBe('Request cancelled');
  });
});

// ── Ph3a2: re-issue fulfil + lifting a hold ─────────────────────────────────

const RI = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NEW_TAG = 'a0000000-0000-4000-8000-000000000005';
const OWNER = '11111111-1111-4111-8111-111111111111';

const reissueDetails = (overrides: Record<string, unknown> = {}) => ({
  id: RI, status: 'APPROVED', paymentStatus: 'PAID', listAmountUsdCents: 1000, chargedAmount: 1000, chargedCurrency: 'usd',
  waiveReason: null, reviewReason: 'Photos show the chip lifting at one corner', reviewedBy: { id: 'rev-1', email: 'admin@example.com' },
  reviewedAt: '2026-10-26T09:00:00.000Z', requestedAt: '2026-10-25T09:00:00.000Z', paidAt: '2026-10-26T12:00:00.000Z',
  owner: { id: OWNER, email: 'owner@example.com' }, photoCount: 2,
  photoUrls: ['https://photos.example.com/1.jpg', 'https://photos.example.com/2.jpg'],
  ...overrides,
});

const fulfilApproval = (reissue: Record<string, unknown> | null = reissueDetails()) => approval({
  action: 'reissue_fulfil',
  target: { kind: 'reissue', id: RI, tokenId: TAG, chipName: 'chip_004', serialSuffix: 'AE6CA9' },
  details: { newTagId: NEW_TAG, newChip: { chipName: 'chip_005', serialSuffix: '11AA22' }, reissue } as Approval['details'],
});

describe('re-issue fulfil ticket', () => {
  it('shows everything the approver needs, with the photos inline', async () => {
    api.listApprovals.mockResolvedValue(list([fulfilApproval()]));
    renderPage(`/admin/approvals?request=${REQ}`);
    const dialog = await screen.findByRole('dialog', { name: 'Move token to a new chip (re-issue): chip_004' });

    expect(within(dialog).getByRole('link', { name: 'chip_004' })).toHaveAttribute('href', `/admin/tags/${TAG}`);
    expect(dialog).toHaveTextContent('serial …AE6CA9');
    expect(dialog).toHaveTextContent('chip_005');
    expect(within(dialog).getByRole('link', { name: 'owner@example.com' })).toHaveAttribute('href', `/admin/users/${OWNER}`);
    expect(dialog).toHaveTextContent('$10.00 paid');
    expect(dialog).toHaveTextContent('Re-issue approved by:admin@example.com');
    expect(dialog).toHaveTextContent('Photos show the chip lifting at one corner');
    expect(dialog).toHaveTextContent(REASON);
    expect(within(dialog).getByRole('link', { name: 'Open the re-issue request' })).toHaveAttribute('href', `/admin/reissue-requests?request=${RI}`);

    const photos = within(dialog).getAllByRole('img');
    expect(photos).toHaveLength(2);
    expect(photos[0]).toHaveAttribute('alt', 'Photo 1 of 2 of the chip on the item');
    expect(within(dialog).getByRole('link', { name: /Open photo 2 of 2 full size/ })).toHaveAttribute('href', 'https://photos.example.com/2.jpg');
  });

  it('a waived fee shows its reason; photos that did not sign offer Refresh, which reloads the request', async () => {
    const user = userEvent.setup();
    api.listApprovals.mockResolvedValue(list([fulfilApproval(reissueDetails({
      paymentStatus: 'WAIVED', chargedAmount: null, chargedCurrency: null, paidAt: null, waiveReason: 'Adhesive batch was faulty', photoUrls: [],
    }))]));
    renderPage(`/admin/approvals?request=${REQ}`);
    const dialog = await screen.findByRole('dialog', { name: /re-issue/ });

    expect(dialog).toHaveTextContent('Fee waived: Adhesive batch was faulty');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Photos could not be loaded, refresh.');
    const calls = api.listApprovals.mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.listApprovals.mock.calls.length).toBeGreaterThan(calls));
  });

  it('no photos at all says so', async () => {
    api.listApprovals.mockResolvedValue(list([fulfilApproval(reissueDetails({ photoCount: 0, photoUrls: [] }))]));
    renderPage(`/admin/approvals?request=${REQ}`);
    const dialog = await screen.findByRole('dialog', { name: /re-issue/ });
    expect(dialog).toHaveTextContent('No photos.');
    expect(within(dialog).queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('a missing re-issue block does not break the queue', async () => {
    api.listApprovals.mockResolvedValue(list([fulfilApproval(null)]));
    renderPage(`/admin/approvals?request=${REQ}`);
    const dialog = await screen.findByRole('dialog', { name: /re-issue/ });
    expect(dialog).toHaveTextContent('The re-issue request details could not be loaded.');
  });

  it('a hold-lifting request shows who set the hold', async () => {
    api.listApprovals.mockResolvedValue(list([approval({
      action: 'account_unsuspend',
      target: { kind: 'account', id: USER, email: 'fan@example.com' },
      details: { hold: { setBy: { id: 'other', email: 'admin2@example.com' }, setAt: '2026-10-26T08:00:00.000Z', reason: 'Chargeback under review' } } as Approval['details'],
    })]));
    renderPage(`/admin/approvals?request=${REQ}`);
    const dialog = await screen.findByRole('dialog', { name: 'Lift account suspension: fan@example.com' });
    expect(dialog).toHaveTextContent(/Hold set by admin2@example\.com on .+: Chargeback under review/);
  });
});

const reissueRequest = {
  id: RI, tagId: TAG,
  tag: { uidSuffix: '936980', serialSuffix: 'AE6CA9', lifecycleStatus: 'ACTIVE', sdmKeyVersion: 2, requesterStillOwner: true },
  requesterAccountId: OWNER, status: 'APPROVED', paymentStatus: 'PAID', listAmountUsdCents: 1000, chargedAmount: 1000,
  chargedCurrency: 'usd', photoCount: 1, photoUrls: [], tappedAt: null, reviewReason: null, waiveReason: null, reviewedBy: null,
  reviewedAt: null, paidAt: null, fulfilledAt: null, newTagId: null, createdAt: '2026-10-25T09:00:00.000Z',
} as unknown as AdminReissueRequest;

const enrolled = { ...tag, id: NEW_TAG, chipName: 'chip_005', serialSuffix: '11AA22', lifecycleStatus: 'ENROLLED' as const };

describe('re-issue fulfil and lifting a hold wait for a second admin', () => {
  it('fulfil says so up front and answers 202 with Sent for approval', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    api.listTags.mockResolvedValue({ success: true, data: { tags: [enrolled], pagination: { page: 1, limit: 100, total: 1 } } });
    api.fulfilReissue.mockResolvedValue(pending);
    inConsole(<AdminReissueFulfilDialog open request={reissueRequest} onClose={vi.fn()} onDone={onDone} />, accessFor('admin', 'me-1', true));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText(/Another admin approves this before the token moves/)).toBeInTheDocument();
    await within(dialog).findAllByRole('option');
    await user.type(within(dialog).getByRole('combobox', { name: /Replacement chip/ }), 'chip_005');
    await user.keyboard('{ArrowDown}{Enter}');
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.type(within(dialog).getByLabelText(/last 6 characters/), 'AE6CA9');
    await user.click(within(dialog).getByRole('button', { name: 'Send for approval' }));

    expect(api.fulfilReissue).toHaveBeenCalledWith(RI, { newTagId: NEW_TAG, reason: REASON, confirmSuffix: 'AE6CA9' });
    expect(await within(dialog).findByText('Sent for approval.')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('super_admin fulfils straight away with the normal button', () => {
    api.listTags.mockResolvedValue({ success: true, data: { tags: [enrolled], pagination: { page: 1, limit: 100, total: 1 } } });
    inConsole(<AdminReissueFulfilDialog open request={reissueRequest} onClose={vi.fn()} onDone={vi.fn()} />, accessFor('super_admin'));
    expect(screen.getByRole('button', { name: 'Move token and retire old chip' })).toBeInTheDocument();
    expect(screen.queryByText(/before the token moves/)).not.toBeInTheDocument();
  });

  it('lift token suspension keeps its label, explains the rule, and shows Sent for approval on 202', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    api.setTagSuspension.mockResolvedValue(pending);
    const suspended = { ...tag, lifecycleStatus: 'SUSPENDED' as const };
    inConsole(<AdminSuspendDialog open tag={suspended} suspend={false} onClose={vi.fn()} onDone={onDone} />, accessFor('admin', 'me-1', true));

    expect(screen.getByText('If another admin set this hold, a second admin approves lifting it.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Reason/), REASON);
    await user.click(screen.getByRole('button', { name: 'Lift suspension' }));
    expect(api.setTagSuspension).toHaveBeenCalledWith(TAG, false, REASON);
    expect(await screen.findByText('Sent for approval.')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('lift token suspension answered 200 finishes as before', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    api.setTagSuspension.mockResolvedValue({ success: true, data: { tagId: TAG, lifecycleStatus: 'ACTIVE' } });
    const suspended = { ...tag, lifecycleStatus: 'SUSPENDED' as const };
    inConsole(<AdminSuspendDialog open tag={suspended} suspend={false} onClose={vi.fn()} onDone={onDone} />, accessFor('admin', 'me-1', true));
    await user.type(screen.getByLabelText(/Reason/), REASON);
    await user.click(screen.getByRole('button', { name: 'Lift suspension' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(screen.queryByText('Sent for approval.')).not.toBeInTheDocument();
  });

  const heldAccount = (status: string) => ({
    id: USER, email: 'fan@example.com', email_confirmed: true, display_name: null, created_at: '2026-10-01T00:00:00Z',
    last_sign_in_at: null, status, account_type: 'collector', creator_requested_at: null, creator_check_status: 'NONE',
    suspended_at: null, suspended_until: null, suspension_reason: null, retired_at: null, retire_reason: null, retired_by_email: null,
    staff_role: null, age_verified: false, active_sessions: 0, pending_transfers: 0, is_self: false, delete: null,
  } as AccountDetail);

  it('account unsuspend answered 202 shows Sent for approval', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    api.accountAction.mockResolvedValue({ approvalRequired: true, approvalId: REQ, expiresAt: '2026-10-28T10:00:00.000Z' });
    inConsole(<AccountActionDialog open action="unsuspend" account={heldAccount('suspended')} onClose={vi.fn()} onDone={onDone} />, accessFor('admin', 'me-1', true));
    expect(screen.getByText(/If another admin set this hold/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Reason/), REASON);
    await user.click(screen.getByRole('button', { name: 'Lift suspension' }));
    expect(api.accountAction).toHaveBeenCalledWith(USER, 'unsuspend', REASON);
    expect(await screen.findByText('Sent for approval.')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('account reactivate answered 200 finishes as before', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    api.accountAction.mockResolvedValue(null);
    inConsole(<AccountActionDialog open action="reactivate" account={heldAccount('retired')} onClose={vi.fn()} onDone={onDone} />, accessFor('admin', 'me-1', true));
    await user.type(screen.getByLabelText(/Reason/), REASON);
    await user.click(screen.getByRole('button', { name: 'Reactivate account' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('reactivate'));
    expect(screen.queryByText('Sent for approval.')).not.toBeInTheDocument();
  });
});
