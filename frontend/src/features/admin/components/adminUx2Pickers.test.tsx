import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AdminReissueRequest, AdminTag } from '../api/adminApi';
import type { AccountDetail } from '../api/accountSchemas';

/**
 * Admin console UX-2 (AC 2 + 3): pick the replacement chip by typing, staff
 * role by radio, price changed from its own card. Picking never acts; every
 * safety step (reason, typed confirmation, Confirm) is unchanged.
 */

const api = vi.hoisted(() => ({
  listTags: vi.fn(),
  resetTag: vi.fn(),
  fulfilReissue: vi.fn(),
  setAccountRole: vi.fn(),
  getPricing: vi.fn(),
  setPrice: vi.fn(),
  cancelPrice: vi.fn(),
}));

vi.mock('../api/adminApi', async () => {
  const actual = await vi.importActual<typeof import('../api/adminApi')>('../api/adminApi');
  return { ...actual, adminApi: api };
});

import { AdminResetDialog } from './AdminTagDialogs';
import { AdminReissueFulfilDialog } from './AdminReissueDialogs';
import { AccountActionDialog } from './AdminAccountDialogs';
import { AdminPricingPage } from '../pages/AdminPricingPage';

const OLD_ID = '55555555-5555-4555-8555-555555555555';
const REASON = 'Chip damaged in shipping, owner verified';

const tag = (overrides: Partial<AdminTag> = {}): AdminTag => ({
  id: OLD_ID,
  chipName: 'chip_004',
  uidSuffix: '936980',
  serialSuffix: 'AE6CA9',
  lifecycleStatus: 'ACTIVE',
  ownerAccountId: '11111111-1111-4111-8111-111111111111',
  creatorAccountId: null,
  itemId: null,
  sdmKeyVersion: 2,
  sunCounter: 4,
  registeredAt: '2026-10-03T17:47:00.000Z',
  activatedAt: '2026-10-03T18:00:00.000Z',
  suspendedAt: null,
  suspendedReason: null,
  retiredAt: null,
  retiredReason: null,
  replacedByTagId: null,
  destructionStatus: null,
  ...overrides,
});

const blank = (id: string, chipName: string, serialSuffix: string) =>
  tag({ id, chipName, serialSuffix, lifecycleStatus: 'ENROLLED', ownerAccountId: null, activatedAt: null });

const CHIPS = [
  blank('a0000000-0000-4000-8000-000000000005', 'chip_005', '11AA22'),
  blank('a0000000-0000-4000-8000-000000000006', 'chip_006', '33BB44'),
  blank('a0000000-0000-4000-8000-000000000007', 'chip_007', '55CC66'),
];

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.listTags.mockResolvedValue({ success: true, data: { tags: CHIPS, pagination: { page: 1, limit: 100, total: 3 } } });
  api.resetTag.mockResolvedValue({ success: true, data: { newTagId: CHIPS[1].id } });
  api.fulfilReissue.mockResolvedValue({ success: true, data: { newTagId: CHIPS[1].id } });
});

const renderReset = () => {
  const onClose = vi.fn();
  render(<AdminResetDialog open tag={tag()} onClose={onClose} onDone={vi.fn()} />);
  return { dialog: screen.getByRole('dialog', { name: 'Move token to a new chip' }), onClose };
};

describe('replacement chip combobox (reset)', () => {
  it('is a combobox that filters as you type, by chip name or serial ending', async () => {
    const user = userEvent.setup();
    const { dialog } = renderReset();
    const box = within(dialog).getByRole('combobox', { name: /Replacement chip/ });
    expect(box).toHaveAttribute('aria-controls', within(dialog).getByRole('listbox', { hidden: true }).id);
    // Same API call as before UX-2.
    expect(api.listTags).toHaveBeenCalledWith({ status: 'ENROLLED', limit: 100 });

    await user.type(box, '006');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('chip_006')]);

    await user.clear(box);
    await user.type(box, 'cc66');
    expect(within(dialog).getAllByRole('option')).toHaveLength(1);
    expect(within(dialog).getByRole('option')).toHaveTextContent('chip_007');

    await user.clear(box);
    await user.type(box, 'zzz');
    expect(within(dialog).queryAllByRole('option')).toHaveLength(0);
    expect(within(dialog).getByText(/No chip matches/)).toBeInTheDocument();
  });

  it('arrow keys move the highlight and Enter selects it without submitting or calling the API', async () => {
    const user = userEvent.setup();
    const { dialog, onClose } = renderReset();
    const box = await within(dialog).findByRole('combobox', { name: /Replacement chip/ });
    await within(dialog).findAllByRole('option');
    box.focus();

    await user.keyboard('{ArrowDown}{ArrowDown}');
    const active = box.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active as string)).toHaveTextContent('chip_006');
    await user.keyboard('{ArrowUp}{ArrowDown}');
    expect(document.getElementById(box.getAttribute('aria-activedescendant') as string)).toHaveTextContent('chip_006');

    await user.keyboard('{Enter}');
    expect(box).toHaveValue('chip_006');
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).getByText(/Chosen:/)).toHaveTextContent('chip_006');
    expect(api.resetTag).not.toHaveBeenCalled();
    expect(api.fulfilReissue).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Escape with the list open closes the list only; the dialog stays.
    await user.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a mouse pick never calls the API; Confirm stays disabled until reason + old chip serial are typed', async () => {
    const user = userEvent.setup();
    const { dialog } = renderReset();
    const submit = within(dialog).getByRole('button', { name: 'Move token and retire old chip' });

    await user.type(within(dialog).getByRole('combobox', { name: /Replacement chip/ }), 'chip_006');
    await user.click(await within(dialog).findByRole('option', { name: /chip_006/ }));
    expect(api.resetTag).not.toHaveBeenCalled();
    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    expect(submit).toBeDisabled();
    // The new chip's serial must not unlock it.
    await user.type(within(dialog).getByLabelText(/last 6 characters/), '33BB44');
    expect(submit).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/last 6 characters/));
    await user.type(within(dialog).getByLabelText(/last 6 characters/), 'ae6ca9');
    expect(submit).toBeEnabled();

    // Editing the chip text drops the choice and re-locks Confirm.
    await user.type(within(dialog).getByRole('combobox', { name: /Replacement chip/ }), 'x');
    expect(submit).toBeDisabled();
    await user.clear(within(dialog).getByRole('combobox', { name: /Replacement chip/ }));
    await user.type(within(dialog).getByRole('combobox', { name: /Replacement chip/ }), '33bb');
    await user.keyboard('{Enter}'); // the only match
    expect(submit).toBeEnabled();
    expect(api.resetTag).not.toHaveBeenCalled();

    await user.click(submit);
    expect(api.resetTag).toHaveBeenCalledWith(OLD_ID, { newTagId: CHIPS[1].id, reason: REASON, confirmSuffix: 'ae6ca9' });
  });
});

describe('replacement chip combobox (complete re-issue)', () => {
  const request: AdminReissueRequest = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tagId: OLD_ID,
    tag: { uidSuffix: '936980', serialSuffix: 'AE6CA9', lifecycleStatus: 'ACTIVE', sdmKeyVersion: 2, requesterStillOwner: true },
    requesterAccountId: '11111111-1111-4111-8111-111111111111',
    status: 'APPROVED',
    paymentStatus: 'PAID',
    listAmountUsdCents: 1000,
    chargedAmount: 1000,
    chargedCurrency: 'usd',
    photoCount: 1,
    photoUrls: [],
    tappedAt: '2026-10-09T09:00:00.000Z',
    reviewReason: null,
    waiveReason: null,
    reviewedBy: null,
    reviewedAt: null,
    paidAt: '2026-10-09T11:00:00.000Z',
    fulfilledAt: null,
    newTagId: null,
    createdAt: '2026-10-09T09:01:00.000Z',
  } as AdminReissueRequest;

  it('Enter picks the chip, never fulfils; Confirm gated on reason + old serial', async () => {
    const user = userEvent.setup();
    render(<AdminReissueFulfilDialog open request={request} onClose={vi.fn()} onDone={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Move token and retire old chip' });

    await within(dialog).findAllByRole('option');
    await user.type(within(dialog).getByRole('combobox', { name: /Replacement chip/ }), 'chip_00');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(within(dialog).getByRole('combobox')).toHaveValue('chip_005');
    expect(api.fulfilReissue).not.toHaveBeenCalled();
    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/last 6 characters/), 'AE6CA9');
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(api.fulfilReissue).toHaveBeenCalledWith(request.id, { newTagId: CHIPS[0].id, reason: REASON, confirmSuffix: 'AE6CA9' });
  });
});

describe('staff role radios', () => {
  const account = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'fan@example.com',
    email_confirmed: true,
    display_name: 'Fan',
    created_at: '2026-10-01T00:00:00Z',
    last_sign_in_at: '2026-10-20T00:00:00Z',
    status: 'active',
    suspended_at: null,
    suspended_until: null,
    suspension_reason: null,
    retired_at: null,
    retire_reason: null,
    retired_by_email: null,
    staff_role: 'admin',
    age_verified: false,
    active_sessions: 1,
    pending_transfers: 0,
    is_self: false,
    delete: null,
  } as AccountDetail;

  it('a fieldset of radios; choosing one never calls the API and Save stays gated on the reason', async () => {
    const user = userEvent.setup();
    render(<AccountActionDialog open action="role" account={account} onClose={vi.fn()} onDone={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const group = within(dialog).getByRole('group', { name: 'Staff role' });
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: /^Admin/ })).toBeChecked();
    const save = within(dialog).getByRole('button', { name: 'Save staff role' });

    await user.click(within(group).getByRole('radio', { name: 'Support' }));
    expect(within(group).getByRole('radio', { name: 'Support' })).toBeChecked();
    expect(api.setAccountRole).not.toHaveBeenCalled();
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Reason/), 'too short');
    expect(save).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/Reason/));
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    expect(save).toBeEnabled();

    // Back to the current role: nothing to save.
    await user.click(within(group).getByRole('radio', { name: /^Admin/ }));
    expect(save).toBeDisabled();

    await user.click(within(group).getByRole('radio', { name: 'No staff role' }));
    await user.click(save);
    expect(api.setAccountRole).toHaveBeenCalledWith(account.id, null, REASON);
  });
});

describe('pricing: Change on each card', () => {
  const renderPage = () => render(<MemoryRouter><AdminPricingPage /></MemoryRouter>);

  beforeEach(() => {
    api.getPricing.mockResolvedValue({
      current: { transfer: 250, token: 2500, reissue: 1000 },
      defaults: { transfer: 250, token: 2500, reissue: 1000 },
      history: [],
    });
  });

  it('opens the dialog for that price, with no price picker and no Now/Later radio', async () => {
    const user = userEvent.setup();
    renderPage();
    const cards = await screen.findByRole('list', { name: 'Prices in effect' });
    expect(within(cards).getAllByRole('button', { name: /^Change/ })).toHaveLength(3);

    await user.click(within(cards).getByRole('button', { name: /^Change new token price/ }));
    const dialog = screen.getByRole('dialog', { name: 'Change new token price' });
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Price')).not.toBeInTheDocument();
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
    expect(api.setPrice).not.toHaveBeenCalled();
  });

  it('empty start date reads "Starts now"; a date reads "Starts on …" and schedules', async () => {
    const user = userEvent.setup();
    api.setPrice.mockResolvedValue({ id: 'new', kind: 'token', amountUsdCents: 3000, effectiveFrom: '2099-03-01T14:00:00.000Z' });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^Change new token price/ }));
    const dialog = screen.getByRole('dialog');
    const status = within(dialog).getByRole('status');

    expect(status).toHaveTextContent('Starts now.');
    expect(within(dialog).getByRole('button', { name: 'Set price' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('New price (USD)'), '30');
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    expect(status).toHaveTextContent(/New token price changes from .* to .*\.Starts now\./);

    await user.type(within(dialog).getByLabelText(/Start date and time/), '2099-03-01T09:00');
    expect(status).toHaveTextContent(`Starts on ${new Date(2099, 2, 1, 9, 0).toLocaleString()}.`);
    expect(status).not.toHaveTextContent('Starts now');
    await user.click(within(dialog).getByRole('button', { name: 'Clear' }));
    expect(status).toHaveTextContent('Starts now.');

    await user.type(within(dialog).getByLabelText(/Start date and time/), '2099-03-01T09:00');
    await user.click(within(dialog).getByRole('button', { name: 'Schedule price' }));
    const body = api.setPrice.mock.calls[0][0] as { kind: string; effectiveFrom: string };
    expect(body.kind).toBe('token');
    expect(body.effectiveFrom).toMatch(/^2099-03-01T09:00:00[+-]\d{2}:\d{2}$/);
  });

  it('a half-typed date (value still empty) never passes as "starts now"', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /^Change new token price/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('New price (USD)'), '30');
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);

    // Browsers keep value '' for a partly typed datetime-local and fire no change event; only badInput shows it.
    const field = within(dialog).getByLabelText(/Start date and time/) as HTMLInputElement;
    Object.defineProperty(field, 'validity', { configurable: true, value: { badInput: true } });
    fireEvent.keyUp(field, { key: '3' });

    const status = within(dialog).getByRole('status');
    expect(status).not.toHaveTextContent('Starts now');
    expect(within(dialog).getByText('Finish the date and time, or clear it to start now.')).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: /price$/ });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(api.setPrice).not.toHaveBeenCalled();
  });
});
