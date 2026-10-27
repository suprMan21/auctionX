import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminReissueRequest, AdminTag } from '../api/adminApi';

/**
 * S-ADMIN1 Ph2 — the admin re-issue queue: review (approve / approve without
 * fee / reject) and fulfil, which needs the serial suffix of the chip retired.
 */

const api = vi.hoisted(() => ({
  listReissueRequests: vi.fn(),
  reviewReissue: vi.fn(),
  fulfilReissue: vi.fn(),
  listTags: vi.fn(),
}));

vi.mock('../api/adminApi', async () => {
  const actual = await vi.importActual<typeof import('../api/adminApi')>('../api/adminApi');
  return { ...actual, adminApi: api };
});

import { AdminReissuePage } from './AdminReissuePage';
import { AdminApiError } from '../api/adminApi';

const REQ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TAG = '55555555-5555-4555-8555-555555555555';
const NEW_TAG = '66666666-6666-4666-8666-666666666666';
const REASON = 'Photos show the chip lifting, still attached';

const request = (overrides: Partial<AdminReissueRequest> = {}): AdminReissueRequest => ({
  id: REQ,
  tagId: TAG,
  tag: { uidSuffix: '936980', serialSuffix: 'AE6CA9', lifecycleStatus: 'ACTIVE', sdmKeyVersion: 2, requesterStillOwner: true },
  requesterAccountId: '11111111-1111-4111-8111-111111111111',
  status: 'PENDING',
  paymentStatus: null,
  listAmountUsdCents: 1000,
  chargedAmount: 1000,
  chargedCurrency: 'usd',
  photoCount: 2,
  photoUrls: ['https://s3.example/p1', 'https://s3.example/p2'],
  tappedAt: '2026-10-09T09:00:00.000Z',
  reviewReason: null,
  waiveReason: null,
  reviewedBy: null,
  reviewedAt: null,
  paidAt: null,
  fulfilledAt: null,
  newTagId: null,
  createdAt: '2026-10-09T09:01:00.000Z',
  ...overrides,
});

const enrolled = (overrides: Partial<AdminTag> = {}): AdminTag => ({
  id: NEW_TAG, uidSuffix: '936980', serialSuffix: '11AA22', lifecycleStatus: 'ENROLLED', ownerAccountId: null,
  creatorAccountId: null, itemId: null, sdmKeyVersion: 2, sunCounter: 0, registeredAt: '2026-10-09T08:00:00.000Z',
  activatedAt: null, suspendedAt: null, suspendedReason: null, retiredAt: null, retiredReason: null,
  replacedByTagId: null, destructionStatus: null, ...overrides,
});

const list = (requests: AdminReissueRequest[]) => ({
  success: true as const,
  data: { requests, pagination: { page: 1, limit: 50, total: requests.length } },
});

const renderQueue = (path = '/admin/reissue-requests') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/reissue-requests" element={<AdminReissuePage />} />
        <Route path="/admin/tags/:tagId" element={<p>tag page</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe('AdminReissuePage', () => {
  it('opens on Needs action and shows requests with the chip, the proof tap and the evidence photos', async () => {
    api.listReissueRequests.mockResolvedValue(list([request()]));
    renderQueue();

    expect(await screen.findByRole('link', { name: 'Serial …AE6CA9, Hardware ID …936980' })).toBeInTheDocument();
    expect(api.listReissueRequests).toHaveBeenCalledWith({ status: 'NEEDS_ACTION', page: 1, limit: 25 });
    expect(screen.getByRole('button', { name: 'Needs action' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('img', { name: /of the chip on the item/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Approve…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve without fee…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move to new chip/ })).not.toBeInTheDocument();
  });

  it('pages through a long queue instead of stopping at 50', async () => {
    api.listReissueRequests.mockResolvedValue({ ...list([request()]), data: { ...list([request()]).data, pagination: { page: 1, limit: 25, total: 60 } } });
    const user = userEvent.setup();
    renderQueue();

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.listReissueRequests).toHaveBeenLastCalledWith({ status: 'NEEDS_ACTION', page: 2, limit: 25 }));
  });

  it('?request= shows that one request, with a way back to the queue', async () => {
    api.listReissueRequests.mockResolvedValue(list([request()]));
    renderQueue(`/admin/reissue-requests?request=${request().id}`);

    expect(await screen.findByText('Showing one request.')).toBeInTheDocument();
    expect(api.listReissueRequests).toHaveBeenCalledWith({ id: request().id });
    expect(screen.getByRole('button', { name: 'Show all re-issues' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filter by stage' })).not.toBeInTheDocument();
  });

  it.each([
    ['Approve…', 'approve', 'Approve and request payment'],
    ['Approve without fee…', 'approve_waived', 'Approve with no fee'],
    ['Reject…', 'reject', 'Reject request'],
  ])('%s needs a typed reason, then sends %s', async (open, decision, confirm) => {
    api.listReissueRequests.mockResolvedValue(list([request()]));
    api.reviewReissue.mockResolvedValue({ success: true, data: {} });
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByRole('button', { name: open }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: confirm });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.click(submit);

    expect(api.reviewReissue).toHaveBeenCalledWith(REQ, decision, REASON);
    expect(api.listReissueRequests).toHaveBeenCalledTimes(2);
  });

  it('warns when the requester no longer owns the token', async () => {
    api.listReissueRequests.mockResolvedValue(list([request({ tag: { ...request().tag!, requesterStillOwner: false } })]));
    renderQueue();

    expect(await screen.findByText('The requester no longer owns this token.')).toBeInTheDocument();
  });

  it('offers no move to a new chip while payment is outstanding', async () => {
    api.listReissueRequests.mockResolvedValue(list([request({ status: 'APPROVED', paymentStatus: 'AWAITING_PAYMENT' })]));
    renderQueue('/admin/reissue-requests?status=AWAITING_PAYMENT');

    expect(await screen.findByText('Waiting for payment', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move to new chip/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve…' })).not.toBeInTheDocument();
  });

  it('completes a paid re-issue only with a chip, a reason and the SERIAL suffix of the old chip', async () => {
    api.listReissueRequests.mockResolvedValue(list([request({ status: 'APPROVED', paymentStatus: 'PAID', paidAt: '2026-10-09T11:00:00.000Z' })]));
    api.listTags.mockResolvedValue({ success: true, data: { tags: [enrolled()], pagination: { page: 1, limit: 100, total: 1 } } });
    api.fulfilReissue.mockResolvedValue({ success: true, data: { newTagId: NEW_TAG } });
    const user = userEvent.setup();
    renderQueue('/admin/reissue-requests?status=READY');

    await user.click(await screen.findByRole('button', { name: 'Move to new chip…' }));
    const dialog = screen.getByRole('dialog', { name: 'Complete re-issue for …936980 · sn …AE6CA9' });
    const submit = within(dialog).getByRole('button', { name: 'Move token and retire old chip' });

    await user.type(await within(dialog).findByRole('combobox', { name: /Replacement chip/ }), '11AA22');
    await user.click(await within(dialog).findByRole('option', { name: /11AA22/ }));
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    // The UID suffix every chip in the lot shares must not unlock it.
    await user.type(within(dialog).getByLabelText(/last 6 characters/), '936980');
    expect(submit).toBeDisabled();
    expect(within(dialog).getByText(/Expected: AE6CA9 \(end of the chip serial number\)/)).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText(/last 6 characters/));
    await user.type(within(dialog).getByLabelText(/last 6 characters/), 'ae6ca9');
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(api.fulfilReissue).toHaveBeenCalledWith(REQ, { newTagId: NEW_TAG, reason: REASON, confirmSuffix: 'ae6ca9' });
    expect(await screen.findByText('tag page')).toBeInTheDocument();
  });

  it('keeps the dialog open with the server error', async () => {
    api.listReissueRequests.mockResolvedValue(list([request()]));
    api.reviewReissue.mockRejectedValue(new AdminApiError('The requester no longer owns this token', 409, 'CONFLICT'));
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByRole('button', { name: 'Approve…' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.click(within(dialog).getByRole('button', { name: 'Approve and request payment' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The requester no longer owns this token');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('says the re-issue was not completed when the server fails, without its raw text', async () => {
    api.listReissueRequests.mockResolvedValue(list([request({ status: 'APPROVED', paymentStatus: 'WAIVED' })]));
    api.listTags.mockResolvedValue({ success: true, data: { tags: [enrolled()], pagination: { page: 1, limit: 100, total: 1 } } });
    api.fulfilReissue.mockRejectedValue(new AdminApiError('deadlock detected', 500, null));
    const user = userEvent.setup();
    renderQueue('/admin/reissue-requests?status=READY');

    expect(await screen.findByText('Fee waived, ready for a new chip', { selector: 'p' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move to new chip…' }));
    const dialog = screen.getByRole('dialog');
    await user.type(await within(dialog).findByRole('combobox', { name: /Replacement chip/ }), '11AA22');
    await user.click(await within(dialog).findByRole('option', { name: /11AA22/ }));
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.type(within(dialog).getByLabelText(/last 6 characters/), 'AE6CA9');
    await user.click(within(dialog).getByRole('button', { name: 'Move token and retire old chip' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The re-issue could not be completed. Nothing was changed. Try again.',
    );
    expect(within(dialog).queryByText(/deadlock/)).not.toBeInTheDocument();
  });
});
