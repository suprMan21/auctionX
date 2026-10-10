import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminTag, AdminTagDetailResponse } from '../api/adminApi';

// ── Mocks ───────────────────────────────────────────────────────────────────

const api = vi.hoisted(() => ({
  listTags: vi.fn(),
  getTag: vi.fn(),
  setTagSuspension: vi.fn(),
  resetTag: vi.fn(),
}));

vi.mock('../api/adminApi', async () => {
  const actual = await vi.importActual<typeof import('../api/adminApi')>('../api/adminApi');
  return { ...actual, adminApi: api };
});

import { AdminTagsPage } from './AdminTagsPage';
import { AdminTagDetailPage } from './AdminTagDetailPage';

// ── Fixtures ────────────────────────────────────────────────────────────────

const OLD_ID = '55555555-5555-4555-8555-555555555555';
const NEW_ID = '66666666-6666-4666-8666-666666666666';
const REASON = 'Chip damaged in shipping, owner verified';

const tag = (overrides: Partial<AdminTag> = {}): AdminTag => ({
  id: OLD_ID,
  uidSuffix: '936980',
  lifecycleStatus: 'ACTIVE',
  ownerAccountId: '11111111-1111-4111-8111-111111111111',
  creatorAccountId: null,
  itemId: null,
  sdmKeyVersion: 1,
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

const detail = (t: AdminTag): AdminTagDetailResponse => ({
  success: true,
  data: {
    tag: t,
    replacesTagIds: [],
    ownershipId: { status: 'current', issuedAt: '2026-10-03T18:12:00.000Z', anchoredAt: null },
    custody: [],
    taps: [],
    audit: [],
  },
});

const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={[`/admin/tags/${OLD_ID}`]}>
      <Routes>
        <Route path="/admin/tags/:tagId" element={<AdminTagDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

// ── Inventory ───────────────────────────────────────────────────────────────

describe('AdminTagsPage', () => {
  it('lists chips by UID suffix, each linking to its detail page', async () => {
    api.listTags.mockResolvedValue({
      success: true,
      data: { tags: [tag(), tag({ id: NEW_ID, uidSuffix: 'ACC040', lifecycleStatus: 'ENROLLED', ownerAccountId: null })], pagination: { page: 1, limit: 25, total: 2 } },
    });

    render(<MemoryRouter initialEntries={['/admin/tags']}><AdminTagsPage /></MemoryRouter>);

    const link = await screen.findByRole('link', { name: '…936980' });
    expect(link).toHaveAttribute('href', `/admin/tags/${OLD_ID}`);
    expect(screen.getByRole('link', { name: '…ACC040' })).toBeInTheDocument();
    expect(screen.getByText('2 chips')).toBeInTheDocument();
  });

  it('leads the chip label with its name when it has one', async () => {
    api.listTags.mockResolvedValue({
      success: true,
      data: { tags: [tag({ chipName: 'chip_004', serialSuffix: '0351DE' }), tag({ id: NEW_ID, uidSuffix: 'ACC040' })], pagination: { page: 1, limit: 25, total: 2 } },
    });

    render(<MemoryRouter initialEntries={['/admin/tags']}><AdminTagsPage /></MemoryRouter>);

    expect(await screen.findByRole('link', { name: 'chip_004 · …936980 · sn …0351DE' })).toHaveAttribute('href', `/admin/tags/${OLD_ID}`);
    expect(screen.getByRole('link', { name: '…ACC040' })).toBeInTheDocument();
  });

  it('filters by status through the API', async () => {
    api.listTags.mockResolvedValue({ success: true, data: { tags: [], pagination: { page: 1, limit: 25, total: 0 } } });
    const user = userEvent.setup();

    render(<MemoryRouter initialEntries={['/admin/tags']}><AdminTagsPage /></MemoryRouter>);
    await screen.findByText('No chips match the current filters.');
    await user.click(screen.getByRole('button', { name: 'Suspended' }));

    await waitFor(() => expect(api.listTags).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'SUSPENDED', page: 1 })));
    expect(screen.getByRole('button', { name: 'Suspended' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the server error instead of an empty table', async () => {
    api.listTags.mockRejectedValue(new Error('Insufficient permissions'));

    render(<MemoryRouter initialEntries={['/admin/tags']}><AdminTagsPage /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient permissions');
  });
});

// ── Detail + actions ────────────────────────────────────────────────────────

describe('AdminTagDetailPage', () => {
  it('offers Suspend and Reset for an ACTIVE chip, not Lift suspension', async () => {
    api.getTag.mockResolvedValue(detail(tag()));

    renderDetail();

    expect(await screen.findByRole('button', { name: 'Suspend' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset token…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lift suspension' })).not.toBeInTheDocument();
  });

  it('offers no actions at all for a RETIRED chip, and links to its replacement', async () => {
    api.getTag.mockResolvedValue(detail(tag({
      lifecycleStatus: 'RETIRED', ownerAccountId: null, retiredAt: '2026-10-05T00:00:00.000Z',
      replacedByTagId: NEW_ID, destructionStatus: 'PENDING',
    })));

    renderDetail();

    await screen.findByText(/Destruction:/);
    expect(screen.queryByRole('button', { name: /suspend|reset/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'this chip' })).toHaveAttribute('href', `/admin/tags/${NEW_ID}`);
  });

  it('suspends only after a reason of at least 10 characters, then reloads', async () => {
    api.getTag.mockResolvedValueOnce(detail(tag())).mockResolvedValueOnce(detail(tag({ lifecycleStatus: 'SUSPENDED' })));
    api.setTagSuspension.mockResolvedValue({ success: true, data: { tagId: OLD_ID, lifecycleStatus: 'SUSPENDED' } });
    const user = userEvent.setup();

    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Suspend' }));

    const dialog = screen.getByRole('dialog', { name: /Suspend chip …936980/ });
    const submit = within(dialog).getByRole('button', { name: 'Suspend token' });
    const reason = within(dialog).getByLabelText(/Reason/);
    expect(reason).toHaveFocus();
    await user.type(reason, 'too short');
    expect(submit).toBeDisabled();
    await user.type(reason, ' — now long enough');
    await user.click(submit);

    expect(api.setTagSuspension).toHaveBeenCalledWith(OLD_ID, true, 'too short — now long enough');
    expect(await screen.findByRole('button', { name: 'Lift suspension' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Token suspended.');
  });

  it('closes a dialog with Escape without calling the API', async () => {
    api.getTag.mockResolvedValue(detail(tag()));
    const user = userEvent.setup();

    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Suspend' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.setTagSuspension).not.toHaveBeenCalled();
  });

  it('blocks the reset until a chip, a reason and the matching UID suffix are given', async () => {
    api.getTag.mockResolvedValue(detail(tag()));
    api.listTags.mockResolvedValue({
      success: true,
      data: { tags: [tag({ id: NEW_ID, uidSuffix: 'ACC040', lifecycleStatus: 'ENROLLED', ownerAccountId: null })], pagination: { page: 1, limit: 100, total: 1 } },
    });
    api.resetTag.mockResolvedValue({
      success: true,
      data: { oldTagId: OLD_ID, newTagId: NEW_ID, oldLifecycleStatus: 'RETIRED', newLifecycleStatus: 'ACTIVE', destructionStatus: 'PENDING' },
    });
    const user = userEvent.setup();

    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Reset token…' }));
    const dialog = screen.getByRole('dialog', { name: /Reset token on chip …936980/ });
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    const submit = within(dialog).getByRole('button', { name: 'Retire chip and reset token' });

    expect(api.listTags).toHaveBeenCalledWith({ status: 'ENROLLED', limit: 100 });
    await user.selectOptions(await within(dialog).findByLabelText(/Replacement chip/), NEW_ID);
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    // The replacement chip's suffix is the classic slip — must not unlock the button.
    await user.type(within(dialog).getByLabelText(/last 6 characters/), 'ACC040');
    expect(submit).toBeDisabled();

    await user.clear(within(dialog).getByLabelText(/last 6 characters/));
    await user.type(within(dialog).getByLabelText(/last 6 characters/), '936980');
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(api.resetTag).toHaveBeenCalledWith(OLD_ID, { newTagId: NEW_ID, reason: REASON, confirmSuffix: '936980' });
  });

  it('keeps the reset dialog open and shows the server error on failure', async () => {
    api.getTag.mockResolvedValue(detail(tag()));
    api.listTags.mockResolvedValue({
      success: true,
      data: { tags: [tag({ id: NEW_ID, uidSuffix: 'ACC040', lifecycleStatus: 'ENROLLED', ownerAccountId: null })], pagination: { page: 1, limit: 100, total: 1 } },
    });
    api.resetTag.mockRejectedValue(new Error('A transfer is pending on this token; cancel it first'));
    const user = userEvent.setup();

    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Reset token…' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(await within(dialog).findByLabelText(/Replacement chip/), NEW_ID);
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.type(within(dialog).getByLabelText(/last 6 characters/), '936980');
    await user.click(within(dialog).getByRole('button', { name: 'Retire chip and reset token' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A transfer is pending');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
