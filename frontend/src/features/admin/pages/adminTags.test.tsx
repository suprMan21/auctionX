import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
import { AdminApiError } from '../api/adminApi';

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

    const link = await screen.findByRole('link', { name: 'Hardware ID …936980' });
    expect(link).toHaveAttribute('href', `/admin/tags/${OLD_ID}`);
    expect(screen.getByRole('link', { name: 'Hardware ID …ACC040' })).toBeInTheDocument();
    expect(screen.getByText('2 tokens')).toBeInTheDocument();
  });

  it('leads the chip label with its name when it has one', async () => {
    api.listTags.mockResolvedValue({
      success: true,
      data: { tags: [tag({ chipName: 'chip_004', serialSuffix: '0351DE' }), tag({ id: NEW_ID, uidSuffix: 'ACC040' })], pagination: { page: 1, limit: 25, total: 2 } },
    });

    render(<MemoryRouter initialEntries={['/admin/tags']}><AdminTagsPage /></MemoryRouter>);

    expect(await screen.findByRole('link', { name: 'chip_004, Serial …0351DE, Hardware ID …936980' })).toHaveAttribute('href', `/admin/tags/${OLD_ID}`);
    expect(screen.getByRole('link', { name: 'Hardware ID …ACC040' })).toBeInTheDocument();
  });

  it('filters by status through the API', async () => {
    api.listTags.mockResolvedValue({ success: true, data: { tags: [], pagination: { page: 1, limit: 25, total: 0 } } });
    const user = userEvent.setup();

    render(<MemoryRouter initialEntries={['/admin/tags']}><AdminTagsPage /></MemoryRouter>);
    await screen.findByText('No tokens match. Try another status or search.');
    await user.click(screen.getByRole('button', { name: 'Suspended' }));

    await waitFor(() => expect(api.listTags).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'SUSPENDED', page: 1 })));
    expect(screen.getByRole('button', { name: 'Suspended' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('searches with one box, keeps the term out of the address bar, and notes the audit', async () => {
    api.listTags.mockResolvedValue({ success: true, data: { tags: [], pagination: { page: 1, limit: 25, total: 0 } } });
    const user = userEvent.setup();
    const LocationProbe = () => <output data-testid="location">{useLocation().search}</output>;

    render(
      <MemoryRouter initialEntries={['/admin/tags?page=2']}>
        <AdminTagsPage />
        <LocationProbe />
      </MemoryRouter>,
    );
    await screen.findByText('No tokens match. Try another status or search.');
    await user.type(screen.getByRole('searchbox', { name: /owner email, token name or serial number/ }), 'collector@example.com');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() =>
      expect(api.listTags).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'collector@example.com', page: 1 })),
    );
    expect(screen.getByTestId('location').textContent).not.toContain('collector');
    expect(screen.getByText('Searches are recorded in the audit log.')).toBeInTheDocument();
  });

  it('blocks a search term the server would refuse', async () => {
    api.listTags.mockResolvedValue({ success: true, data: { tags: [], pagination: { page: 1, limit: 25, total: 0 } } });
    const user = userEvent.setup();

    render(<MemoryRouter initialEntries={['/admin/tags']}><AdminTagsPage /></MemoryRouter>);
    await screen.findByText('No tokens match. Try another status or search.');
    await user.type(screen.getByRole('searchbox'), 'a,b');

    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  });

  it('shows owner and creator emails, falling back to the short account id', async () => {
    api.listTags.mockResolvedValue({
      success: true,
      data: {
        tags: [
          tag({ ownerEmail: 'collector@example.com', creatorEmail: 'studio@example.com' }),
          tag({ id: NEW_ID, uidSuffix: 'ACC040', ownerEmail: null, ownerAccountId: '22222222-2222-4222-8222-222222222222' }),
        ],
        pagination: { page: 1, limit: 25, total: 2 },
        emailMatchesTruncated: true,
      },
    });

    render(<MemoryRouter initialEntries={['/admin/tags']}><AdminTagsPage /></MemoryRouter>);

    expect(await screen.findByText('collector@example.com')).toBeInTheDocument();
    expect(screen.getByText('studio@example.com')).toBeInTheDocument();
    expect(screen.getByText('Account 22222222…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('More than 50 accounts match');
  });

  it('shows the server error instead of an empty table', async () => {
    api.listTags.mockRejectedValue(new AdminApiError('Insufficient permissions', 403, 'FORBIDDEN'));

    render(<MemoryRouter initialEntries={['/admin/tags']}><AdminTagsPage /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient permissions');
  });

  it('never shows the raw text of a server crash', async () => {
    api.listTags.mockRejectedValue(new AdminApiError('relation "nfc_tags" does not exist', 500, null));

    render(<MemoryRouter initialEntries={['/admin/tags']}><AdminTagsPage /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Tokens could not be loaded. Try again.');
    expect(screen.queryByText(/nfc_tags/)).not.toBeInTheDocument();
  });

  it('labels statuses in plain words, keeping the raw value as a title', async () => {
    api.listTags.mockResolvedValue({
      success: true,
      data: { tags: [tag({ lifecycleStatus: 'ENROLLED', ownerAccountId: null })], pagination: { page: 1, limit: 25, total: 1 } },
    });

    render(<MemoryRouter initialEntries={['/admin/tags']}><AdminTagsPage /></MemoryRouter>);

    const badge = await screen.findByTitle('ENROLLED');
    expect(badge).toHaveTextContent('Ready to claim');
    expect(screen.queryByText('ENROLLED')).not.toBeInTheDocument();
  });
});

// ── Detail + actions ────────────────────────────────────────────────────────

describe('AdminTagDetailPage', () => {
  it('offers Suspend and Move to new chip for an ACTIVE token, not Lift suspension', async () => {
    api.getTag.mockResolvedValue(detail(tag()));

    renderDetail();

    expect(await screen.findByRole('button', { name: 'Suspend token…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to new chip…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lift suspension…' })).not.toBeInTheDocument();
  });

  it('offers no actions at all for a RETIRED chip, and links to its replacement', async () => {
    api.getTag.mockResolvedValue(detail(tag({
      lifecycleStatus: 'RETIRED', ownerAccountId: null, retiredAt: '2026-10-05T00:00:00.000Z',
      replacedByTagId: NEW_ID, destructionStatus: 'PENDING',
    })));

    renderDetail();

    await screen.findByText(/Chip destruction:/);
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /suspend|move/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Moved to a new chip/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'view' })).toHaveAttribute('href', `/admin/tags/${NEW_ID}`);
  });

  it('suspends only after a reason of at least 10 characters, then reloads', async () => {
    api.getTag.mockResolvedValueOnce(detail(tag())).mockResolvedValueOnce(detail(tag({ lifecycleStatus: 'SUSPENDED' })));
    api.setTagSuspension.mockResolvedValue({ success: true, data: { tagId: OLD_ID, lifecycleStatus: 'SUSPENDED' } });
    const user = userEvent.setup();

    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Suspend token…' }));

    const dialog = screen.getByRole('dialog', { name: /Suspend token …936980/ });
    const submit = within(dialog).getByRole('button', { name: 'Suspend token' });
    const reason = within(dialog).getByLabelText(/Reason/);
    expect(reason).toHaveFocus();
    await user.type(reason, 'too short');
    expect(submit).toBeDisabled();
    await user.type(reason, ' — now long enough');
    await user.click(submit);

    expect(api.setTagSuspension).toHaveBeenCalledWith(OLD_ID, true, 'too short — now long enough');
    expect(await screen.findByRole('button', { name: 'Lift suspension…' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Token suspended.');
  });

  it('closes a dialog with Escape without calling the API', async () => {
    api.getTag.mockResolvedValue(detail(tag()));
    const user = userEvent.setup();

    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Suspend token…' }));
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
    await user.click(await screen.findByRole('button', { name: 'Move to new chip…' }));
    const dialog = screen.getByRole('dialog', { name: 'Move token to a new chip' });
    expect(dialog).toHaveTextContent(/Token …936980 moves to the replacement chip/);
    expect(dialog).toHaveTextContent(/cannot be undone/i);
    const submit = within(dialog).getByRole('button', { name: 'Move token and retire old chip' });

    expect(api.listTags).toHaveBeenCalledWith({ status: 'ENROLLED', limit: 100 });
    await user.type(await within(dialog).findByRole('combobox', { name: /Replacement chip/ }), 'ACC040');
    await user.click(await within(dialog).findByRole('option', { name: /ACC040/ }));
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
    api.resetTag.mockRejectedValue(new AdminApiError('A transfer is pending on this token; cancel it first', 409, 'CONFLICT'));
    const user = userEvent.setup();

    renderDetail();
    await user.click(await screen.findByRole('button', { name: 'Move to new chip…' }));
    const dialog = screen.getByRole('dialog');
    await user.type(await within(dialog).findByRole('combobox', { name: /Replacement chip/ }), 'ACC040');
    await user.click(await within(dialog).findByRole('option', { name: /ACC040/ }));
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.type(within(dialog).getByLabelText(/last 6 characters/), '936980');
    await user.click(within(dialog).getByRole('button', { name: 'Move token and retire old chip' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A transfer is pending');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
