import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminStuckPayment, AdminStuckPaymentListResponse } from '../api/adminApi';

/**
 * S-ADMIN1 Ph3a — the stuck-payment queue: Re-apply (typed reason), Refund
 * (admin only, typed reason and the end of the payment id), and Check now.
 */

const api = vi.hoisted(() => ({
  listStuckPayments: vi.fn(),
  reapplyStuckPayment: vi.fn(),
  refundStuckPayment: vi.fn(),
  sweepStuckPayments: vi.fn(),
}));

vi.mock('../api/adminApi', async () => {
  const actual = await vi.importActual<typeof import('../api/adminApi')>('../api/adminApi');
  return { ...actual, adminApi: api };
});

import { AdminStuckPaymentsPage } from './AdminStuckPaymentsPage';

const INCIDENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TAG = '55555555-5555-4555-8555-555555555555';
const REASON = 'Recipient has signed in, finishing the transfer';

const payment = (overrides: Partial<AdminStuckPayment> = {}): AdminStuckPayment => ({
  id: INCIDENT,
  kind: 'transfer_fee',
  reason: 'no_recipient',
  status: 'OPEN',
  resolution: null,
  transferId: '66666666-6666-4666-8666-666666666666',
  reissueRequestId: null,
  paymentIntentId: 'pi_3TestStuckAB12CD',
  amount: 250,
  currency: 'usd',
  firstSeenAt: '2026-10-11T09:00:00.000Z',
  lastSeenAt: '2026-10-11T09:20:00.000Z',
  seenCount: 3,
  lastError: null,
  githubIssueNumber: 41,
  githubIssueUrl: 'https://github.com/suprMan21/auctionX/issues/41',
  resolvedAt: null,
  refundId: null,
  target: { tagId: TAG, chipName: 'chip_009', status: 'PENDING', paymentStatus: null },
  ...overrides,
});

const list = (
  items: AdminStuckPayment[],
  flags: Partial<AdminStuckPaymentListResponse['data']> = {},
): AdminStuckPaymentListResponse => ({
  success: true,
  data: {
    items, total: items.length, page: 1, limit: 50,
    canRefund: true, githubIssuesConfigured: true, sweepConfigured: true,
    ...flags,
  },
});

const renderQueue = (path = '/admin/stuck-payments') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/stuck-payments" element={<AdminStuckPaymentsPage />} />
        <Route path="/admin/tags/:tagId" element={<p>tag page</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe('AdminStuckPaymentsPage', () => {
  it('shows an open payment with what went wrong, what to do, and the debug ticket', async () => {
    api.listStuckPayments.mockResolvedValue(list([payment()]));
    renderQueue();

    expect(await screen.findByRole('heading', { name: 'Transfer fee, 2.50 USD' })).toBeInTheDocument();
    expect(api.listStuckPayments).toHaveBeenCalledWith({ status: 'OPEN', limit: 50 });
    expect(screen.getByText('The payment arrived but the transfer has no recipient account yet.')).toBeInTheDocument();
    expect(screen.getByText('Ask the recipient to sign in and accept, then Re-apply.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'chip_009' })).toHaveAttribute('href', `/admin/tags/${TAG}`);
    expect(screen.getByRole('link', { name: /GitHub issue #41/ })).toHaveAttribute('href', 'https://github.com/suprMan21/auctionX/issues/41');
    expect(screen.getByText('pi_3TestStuckAB12CD')).toBeInTheDocument();
  });

  it('says so plainly when nothing is stuck', async () => {
    api.listStuckPayments.mockResolvedValue(list([]));
    renderQueue();

    expect(await screen.findByText('No stuck payments. Every paid fee has gone through.')).toBeInTheDocument();
  });

  it('Re-apply needs a typed reason, then sends it and reloads the queue', async () => {
    api.listStuckPayments.mockResolvedValue(list([payment()]));
    api.reapplyStuckPayment.mockResolvedValue({ success: true, data: {} });
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByRole('button', { name: 'Re-apply…' }));
    const dialog = screen.getByRole('dialog', { name: 'Re-apply this payment' });
    const submit = within(dialog).getByRole('button', { name: 'Re-apply payment' });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.click(submit);

    expect(api.reapplyStuckPayment).toHaveBeenCalledWith(INCIDENT, REASON);
    expect(api.listStuckPayments).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the dialog open and shows the server’s explanation when Re-apply changes nothing', async () => {
    api.listStuckPayments.mockResolvedValue(list([payment()]));
    api.reapplyStuckPayment.mockRejectedValue(new Error('The transfer has no recipient account yet. Ask the recipient to sign in and accept, then try again.'));
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByRole('button', { name: 'Re-apply…' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.click(within(dialog).getByRole('button', { name: 'Re-apply payment' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/no recipient account yet/);
    expect(api.listStuckPayments).toHaveBeenCalledTimes(1);
  });

  it('Refund needs a reason AND the last 6 characters of the payment id', async () => {
    api.listStuckPayments.mockResolvedValue(list([payment({ reason: 'not_payable', target: { tagId: TAG, chipName: 'chip_009', status: 'CANCELLED', paymentStatus: null } })]));
    api.refundStuckPayment.mockResolvedValue({ success: true, data: {} });
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByRole('button', { name: 'Refund…' }));
    const dialog = screen.getByRole('dialog', { name: 'Refund 2.50 USD' });
    const submit = within(dialog).getByRole('button', { name: 'Refund payment' });
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/last 6 characters of the payment id/), 'XXXXXX');
    expect(submit).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/last 6 characters of the payment id/));
    await user.type(within(dialog).getByLabelText(/last 6 characters of the payment id/), 'AB12CD');
    await user.click(submit);

    expect(api.refundStuckPayment).toHaveBeenCalledWith(INCIDENT, { reason: REASON, confirmSuffix: 'AB12CD' });
  });

  it('tells the admin a pending transfer will be cancelled, and to try Re-apply first when that could work', async () => {
    api.listStuckPayments.mockResolvedValue(list([payment()]));
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByRole('button', { name: 'Refund…' }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText(/transfer is cancelled and the token stays with its current owner/)).toBeInTheDocument();
    expect(within(dialog).getByText('This payment may still be appliable. Try Re-apply first.')).toBeInTheDocument();
  });

  it('offers support no Refund button', async () => {
    api.listStuckPayments.mockResolvedValue(list([payment()], { canRefund: false }));
    renderQueue();

    expect(await screen.findByRole('button', { name: 'Re-apply…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refund…' })).not.toBeInTheDocument();
  });

  it('offers no Re-apply for a payment that can only be refunded, and tells support who can', async () => {
    api.listStuckPayments.mockResolvedValue(list([payment({ reason: 'not_payable' })], { canRefund: false }));
    renderQueue();

    expect(await screen.findByText('This cannot be applied. Refund it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-apply…' })).not.toBeInTheDocument();
    expect(screen.getByText('A refund needs an admin.')).toBeInTheDocument();
  });

  it('shows closed payments with how they were closed and no actions', async () => {
    api.listStuckPayments.mockResolvedValue(list([
      payment({ status: 'REFUNDED', resolution: 'refund', resolvedAt: '2026-10-11T10:00:00.000Z', refundId: 're_3Test' }),
    ]));
    renderQueue('/admin/stuck-payments?status=REFUNDED');

    expect(await screen.findByText('re_3Test')).toBeInTheDocument();
    expect(api.listStuckPayments).toHaveBeenCalledWith({ status: 'REFUNDED', limit: 50 });
    expect(screen.queryByRole('button', { name: 'Re-apply…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refund…' })).not.toBeInTheDocument();
  });

  it('names a replacement chip fee as such', async () => {
    api.listStuckPayments.mockResolvedValue(list([payment({
      kind: 'reissue_fee', reason: 'not_payable', amount: 1000, transferId: null,
      reissueRequestId: '77777777-7777-4777-8777-777777777777',
      target: { tagId: TAG, chipName: 'chip_009', status: 'CANCELLED', paymentStatus: 'AWAITING_PAYMENT' },
    })]));
    renderQueue();

    expect(await screen.findByRole('heading', { name: 'Replacement chip fee, 10.00 USD' })).toBeInTheDocument();
    expect(screen.getByText('cancelled, awaiting payment')).toBeInTheDocument();
  });

  it('Check now runs the check, reports the result and reloads', async () => {
    api.listStuckPayments.mockResolvedValue(list([]));
    api.sweepStuckPayments.mockResolvedValue({
      success: true,
      data: { scanned: 9, checked: 4, settled: 3, applied: 1, stuck: 0, skippedRecent: 0, skippedRefunded: 0, truncated: false },
    });
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByRole('button', { name: 'Check now' }));

    expect(await screen.findByRole('status')).toHaveTextContent('4 paid fees checked, 1 applied, 0 stuck.');
    expect(api.listStuckPayments).toHaveBeenCalledTimes(2);
  });

  it('warns when the automatic check or the debug tickets are not set up', async () => {
    api.listStuckPayments.mockResolvedValue(list([], { sweepConfigured: false, githubIssuesConfigured: false }));
    renderQueue();

    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('The automatic 10-minute check is not set up on this server.');
    expect(note).toHaveTextContent('the debug team is not being told about new stuck payments');
  });

  it('shows the error when the queue cannot be loaded', async () => {
    api.listStuckPayments.mockRejectedValue(new Error('Insufficient permissions'));
    renderQueue();

    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient permissions');
  });
});
