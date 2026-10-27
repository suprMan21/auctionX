import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';

/**
 * Admin console UX-3: dashboard growth tiles + charts, the Settings page,
 * audit targets that open their record, the phone menu, and free transfers
 * on an account page.
 */

const api = vi.hoisted(() => ({
  getGrowth: vi.fn(),
  getAuditLogs: vi.fn(),
  getAuditFacets: vi.fn(),
  getHealth: vi.fn(),
  listReissueRequests: vi.fn(),
  listStuckPayments: vi.fn(),
  getModerationQueue: vi.fn(),
  getPricing: vi.fn(),
  listVoucherGrants: vi.fn(),
  grantVouchers: vi.fn(),
  getAccountSettings: vi.fn(),
  searchAccounts: vi.fn(),
  listTags: vi.fn(),
}));

vi.mock('../api/adminApi', async () => {
  const actual = await vi.importActual<typeof import('../api/adminApi')>('../api/adminApi');
  return { ...actual, adminApi: api };
});
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: async () => ({ count: 0, error: null }) }) }) } }));
vi.mock('@/features/auth/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { email: 'staff@example.com' } }, signOut: vi.fn() }) }));

import { AdminDashboardPage } from './AdminDashboardPage';
import { AdminSettingsPage } from './AdminSettingsPage';
import { AdminAuditLogPage } from './AdminAuditLogPage';
import { AdminLayout } from '../AdminLayout';
import { AccountFreeTransfers } from '../components/AccountFreeTransfers';
import { niceScale, runningTotal } from '../lib/growthMath';
import { AdminRoleContext } from '../lib/adminRole';
import { WorkQueueProvider } from '../components/WorkQueueProvider';
import { recordLinkFor } from '../lib/recordLinks';
import { customRange, daysInclusive, presetRange } from '../lib/growthRange';
import { accessFor } from '../test/adminAccess';

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const TOKEN = '33333333-3333-4333-8333-333333333333';

const Where = () => {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}{l.search}</p>;
};

const withRole = (role: string | null, ui: React.ReactNode, path = '/admin') =>
  render(
    <AdminRoleContext.Provider value={accessFor(role)}>
      <MemoryRouter initialEntries={[path]}>
        <WorkQueueProvider>
          <Routes>
            <Route path="/admin/pricing" element={<Navigate to="/admin/settings?tab=pricing" replace />} />
            <Route path="*" element={<>{ui}<Where /></>} />
          </Routes>
        </WorkQueueProvider>
      </MemoryRouter>
    </AdminRoleContext.Provider>,
  );

const growth = (q: { series: string; bucket: string; from: string; to: string; tz: string }) => ({
  ...q,
  addedToday: q.series === 'tokens' ? 3 : 5,
  active: q.series === 'tokens' ? 12 : 40,
  totalBefore: 10,
  points: [{ start: q.from, count: 2 }, { start: '2026-10-27', count: 1 }],
});

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getGrowth.mockImplementation(async (q) => growth(q));
  api.getAuditLogs.mockResolvedValue({ logs: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } });
  api.getHealth.mockResolvedValue({ status: 'ok' });
  api.listReissueRequests.mockResolvedValue({ success: true, data: { requests: [], pagination: { page: 1, limit: 1, total: 0 } } });
  api.listStuckPayments.mockResolvedValue({ success: true, data: { incidents: [], pagination: { page: 1, limit: 1, total: 0 } } });
});

// ─── Dashboard growth ────────────────────────────────────────────────────────

describe('dashboard growth', () => {
  it('admin sees both panels; tiles open the filtered lists', async () => {
    withRole('admin', <AdminDashboardPage />);
    const tokens = await screen.findByRole('region', { name: 'Tokens' });
    const accounts = screen.getByRole('region', { name: 'Accounts' });
    await waitFor(() => expect(within(tokens).getByRole('link', { name: /12\s*Active/ })).toHaveAttribute('href', '/admin/tags?status=ACTIVE'));
    expect(within(tokens).getByRole('link', { name: /3\s*Added today/ })).toHaveAttribute('href', '/admin/tags');
    await waitFor(() => expect(within(accounts).getByRole('link', { name: /40\s*Active/ })).toHaveAttribute('href', '/admin/users?status=active'));
    expect(within(accounts).getByRole('link', { name: /5\s*New today/ })).toBeInTheDocument();
  });

  it('support sees accounts only and never asks for token counts', async () => {
    withRole('support', <AdminDashboardPage />);
    await screen.findByRole('region', { name: 'Accounts' });
    expect(screen.queryByRole('region', { name: 'Tokens' })).not.toBeInTheDocument();
    await waitFor(() => expect(api.getGrowth).toHaveBeenCalled());
    expect(api.getGrowth.mock.calls.every(([q]) => q.series === 'accounts')).toBe(true);
  });

  it('opens on Month (30 local days by day) and Year asks for 12 months by month', async () => {
    withRole('admin', <AdminDashboardPage />);
    const tokens = await screen.findByRole('region', { name: 'Tokens' });
    await waitFor(() => expect(api.getGrowth).toHaveBeenCalledWith(expect.objectContaining({ series: 'tokens', bucket: 'day' })));
    const first = api.getGrowth.mock.calls.find(([q]) => q.series === 'tokens')![0];
    expect(daysInclusive(first.from, first.to)).toBe(30);
    expect(first.tz).toBeTruthy();

    await userEvent.click(within(tokens).getByRole('button', { name: 'Year' }));
    await waitFor(() => expect(api.getGrowth).toHaveBeenCalledWith(expect.objectContaining({ series: 'tokens', bucket: 'month' })));
    const tokenCalls = api.getGrowth.mock.calls.filter(([q]) => q.series === 'tokens');
    const year = tokenCalls[tokenCalls.length - 1][0];
    expect(year.from.endsWith('-01')).toBe(true);
    expect(within(tokens).getByRole('button', { name: 'Year' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('custom range: a reversed range is refused before any request', async () => {
    withRole('admin', <AdminDashboardPage />);
    const tokens = await screen.findByRole('region', { name: 'Tokens' });
    await userEvent.click(within(tokens).getByRole('button', { name: 'Custom' }));
    const calls = api.getGrowth.mock.calls.length;
    const from = within(tokens).getByLabelText('From');
    const to = within(tokens).getByLabelText('To');
    await userEvent.clear(from); await userEvent.type(from, '2026-10-20');
    await userEvent.clear(to); await userEvent.type(to, '2026-10-01');
    await userEvent.click(within(tokens).getByRole('button', { name: 'Show' }));
    expect(within(tokens).getByRole('alert')).toHaveTextContent('From must be on or before To.');
    expect(api.getGrowth.mock.calls.length).toBe(calls);
  });

  it('every value is in a table view, and Total shows the running total', async () => {
    withRole('admin', <AdminDashboardPage />);
    const tokens = await screen.findByRole('region', { name: 'Tokens' });
    await within(tokens).findByRole('img', { name: /Tokens added per day/ });
    const table = within(tokens).getByRole('table', { name: 'Tokens added per day' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    await userEvent.click(within(tokens).getByRole('button', { name: 'Total' }));
    const total = within(tokens).getByRole('table', { name: 'Tokens in total, by day' });
    expect(within(total).getAllByRole('cell').map((c) => c.textContent).filter((_, i) => i % 2 === 1)).toEqual(['12', '13']);
  });

  it('a failed load says so and the tiles read Unavailable', async () => {
    api.getGrowth.mockRejectedValue(new Error('nope'));
    withRole('admin', <AdminDashboardPage />);
    const tokens = await screen.findByRole('region', { name: 'Tokens' });
    await waitFor(() => expect(within(tokens).getByRole('alert')).toHaveTextContent('Tokens could not be loaded. Try again.'));
    expect(within(tokens).getAllByText('Unavailable')).toHaveLength(2);
  });

  it('chart helpers: running total and clean axis', () => {
    expect(runningTotal({ series: 'tokens', bucket: 'day', tz: 'UTC', from: 'a', to: 'b', addedToday: 0, active: 0, totalBefore: 4, points: [{ start: 'a', count: 1 }, { start: 'b', count: 0 }, { start: 'c', count: 3 }] }).map((p) => p.value)).toEqual([5, 5, 8]);
    expect(niceScale(0)).toEqual({ top: 4, step: 1 });
    expect(niceScale(7)).toEqual({ top: 8, step: 2 });
    expect(niceScale(130)).toEqual({ top: 150, step: 50 });
  });
});

describe('growth time frames', () => {
  it('Month is the last 30 days ending today; Year starts on the 1st, 11 months back', () => {
    const now = new Date(2026, 9, 27, 23, 30);
    expect(presetRange('month', now)).toEqual({ from: '2026-09-28', to: '2026-10-27', bucket: 'day' });
    expect(presetRange('year', now)).toEqual({ from: '2025-11-01', to: '2026-10-27', bucket: 'month' });
  });

  it('custom: by day up to 92 days, by month after, at most 5 years', () => {
    expect(customRange('2026-10-01', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-01', bucket: 'day' });
    expect(customRange('2026-01-01', '2026-10-27')).toMatchObject({ bucket: 'month' });
    expect(customRange('2020-01-01', '2026-10-27')).toEqual({ error: 'Pick at most 5 years.' });
    expect(customRange('2026-02-30', '2026-10-27')).toEqual({ error: 'Pick both dates.' });
    expect(daysInclusive('2026-11-01', '2026-11-02')).toBe(2); // across the clock change
  });
});

// ─── Audit targets link to their record ─────────────────────────────────────

describe('audit targets open their record', () => {
  const row = (entity_type: string, entity_id: string) => ({ entity_type, entity_id });

  it('maps each type to its page, only for staff who may open it', () => {
    const admin = accessFor('admin');
    const support = accessFor('support');
    expect(recordLinkFor(row('user', ACCOUNT), support)).toBe(`/admin/users/${ACCOUNT}`);
    expect(recordLinkFor(row('nfc_tag', TOKEN), admin)).toBe(`/admin/tags/${TOKEN}`);
    expect(recordLinkFor(row('nfc_tag', TOKEN), support)).toBeNull();
    expect(recordLinkFor(row('reissue_request', TOKEN), admin)).toBe(`/admin/reissue-requests?request=${TOKEN}`);
    expect(recordLinkFor(row('token_price', TOKEN), admin)).toBe('/admin/settings?tab=pricing');
    expect(recordLinkFor(row('transfer_voucher_grant', TOKEN), support)).toBeNull();
    expect(recordLinkFor(row('account_settings', TOKEN), support)).toBe('/admin/settings?tab=account-deletion');
    expect(recordLinkFor(row('admin_search', ACCOUNT), admin)).toBeNull();
    expect(recordLinkFor(row('user', 'not-a-uuid'), admin)).toBeNull();
  });

  it('audit log Target column and dashboard Recent activity link to the token', async () => {
    const log = {
      log_id: 'l1', admin_id: ACCOUNT, admin_email: 'staff@example.com', action: 'tag_suspend', entity_type: 'nfc_tag',
      entity_id: TOKEN, changes: null, reason: 'x', created_at: '2026-10-27T10:00:00Z', brand: 'auctionx',
    };
    api.getAuditLogs.mockResolvedValue({ logs: [log], pagination: { page: 1, limit: 50, total: 1, pages: 1 } });
    api.getAuditFacets.mockResolvedValue({ actors: [], actions: [], entity_types: [] });
    const { unmount } = withRole('admin', <AdminAuditLogPage />, '/admin/audit-logs');
    expect(await screen.findByRole('link', { name: /Token 33333333/ })).toHaveAttribute('href', `/admin/tags/${TOKEN}`);
    unmount();

    withRole('admin', <AdminDashboardPage />);
    const recent = await screen.findByRole('link', { name: /Token suspended/ });
    expect(recent).toHaveAttribute('href', `/admin/tags/${TOKEN}`);
  });
});

// ─── Settings ────────────────────────────────────────────────────────────────

describe('Settings page', () => {
  it('admin sees all three sections on one page; support only Account deletion', async () => {
    api.getAccountSettings.mockResolvedValue({ deleteWindowHours: 24 });
    api.getPricing.mockReturnValue(new Promise(() => {}));
    api.listVoucherGrants.mockReturnValue(new Promise(() => {}));
    const { unmount } = withRole('admin', <AdminSettingsPage />, '/admin/settings');
    const jump = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(jump).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['#settings-pricing', '#settings-free-transfers', '#settings-account-deletion']);
    for (const name of ['Pricing', 'Free transfers', 'Account deletion']) expect(screen.getByRole('region', { name })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Pricing' })).toBeInTheDocument();
    unmount();
    api.getPricing.mockClear();
    api.listVoucherGrants.mockClear();

    withRole('support', <AdminSettingsPage />, '/admin/settings?tab=pricing');
    expect(screen.getByRole('region', { name: 'Account deletion' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Pricing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).not.toBeInTheDocument();
    expect(api.getPricing).not.toHaveBeenCalled();
    expect(api.listVoucherGrants).not.toHaveBeenCalled();
  });

  it('old Pricing links land on the Settings tab', async () => {
    api.getPricing.mockReturnValue(new Promise(() => {}));
    api.listVoucherGrants.mockReturnValue(new Promise(() => {}));
    api.getAccountSettings.mockReturnValue(new Promise(() => {}));
    withRole('admin', <AdminSettingsPage />, '/admin/pricing');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/settings?tab=pricing'));
  });

  it('a role with none of the tabs gets the no-access note', () => {
    withRole(null, <AdminSettingsPage />, '/admin/settings');
    expect(screen.getByRole('heading', { name: 'Not available for your staff role' })).toBeInTheDocument();
  });
});

// ─── Phone menu ──────────────────────────────────────────────────────────────

describe('phone menu', () => {
  it('moves focus in, keeps Tab inside, and closes on Escape back to the menu button', async () => {
    const user = userEvent.setup();
    withRole('super_admin', <AdminLayout />);
    const open = screen.getByRole('button', { name: 'Open navigation menu' });
    await user.click(open);
    const dialog = screen.getByRole('dialog', { name: 'Admin menu' });
    const links = within(dialog).getAllByRole('link');
    expect(links[0]).toHaveFocus();
    // Shift+Tab from the first element wraps to the last (Sign out).
    await user.tab({ shift: true });
    expect(within(dialog).getByRole('button', { name: 'Sign out' })).toHaveFocus();
    await user.tab();
    expect(links[0]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });
});

// ─── Account page: free transfers ───────────────────────────────────────────

describe('free transfers on an account page', () => {
  it('nothing is looked up until Show; Grant opens the dialog with the email filled in', async () => {
    api.listVoucherGrants.mockResolvedValue({
      grants: [{
        id: 'g1', userEmail: 'fan@example.com', quantity: 3, remaining: 2, used: 1, reason: 'Thanks for testing',
        expiresAt: null, status: 'active', grantedBy: 'staff@example.com', createdAt: '2026-10-20T10:00:00Z',
        revokedAt: null, revokedBy: null, revokeReason: null,
      }],
      total: 1, page: 1, limit: 25,
    });
    withRole('admin', <AccountFreeTransfers email="fan@example.com" />, `/admin/users/${ACCOUNT}`);
    expect(api.listVoucherGrants).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Show free transfers' }));
    expect(await screen.findByText('2 unused free transfers.')).toBeInTheDocument();
    expect(api.listVoucherGrants).toHaveBeenCalledWith({ email: 'fan@example.com', limit: 25 });

    await userEvent.click(screen.getByRole('button', { name: 'Grant free transfers…' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('fan@example.com')).toBeInTheDocument();
  });
});
