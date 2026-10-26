import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AdminVoucherGrant } from '../api/pricingSchemas';

/**
 * Admin console UX-1: the console search (one match opens it), the "Needs
 * attention" queue cards, accounts shown as links, free transfers not
 * re-looked-up after a change, and the audit-log time filter.
 */

const api = vi.hoisted(() => ({
  searchAccounts: vi.fn(),
  listTags: vi.fn(),
  listReissueRequests: vi.fn(),
  listStuckPayments: vi.fn(),
  getAuditLogs: vi.fn(),
  getAuditFacets: vi.fn(),
  getHealth: vi.fn(),
  listVoucherGrants: vi.fn(),
  revokeVoucherGrant: vi.fn(),
}));

vi.mock('../api/adminApi', async () => {
  const actual = await vi.importActual<typeof import('../api/adminApi')>('../api/adminApi');
  return { ...actual, adminApi: api };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: async () => ({ count: 0, error: null }) }) }) } }));

import { ConsoleSearch } from '../components/ConsoleSearch';
import { AccountLink } from '../components/AccountLink';
import { AdminDashboardPage } from './AdminDashboardPage';
import { AdminVouchersPage } from './AdminVouchersPage';
import { AdminAuditLogPage } from './AdminAuditLogPage';
import { AdminRoleContext } from '../lib/adminRole';
import { WorkQueueProvider } from '../components/WorkQueueProvider';
import { accessFor } from '../test/adminAccess';

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const TOKEN = '33333333-3333-4333-8333-333333333333';

const Where = () => <p data-testid="where">{useLocation().pathname}{useLocation().search}</p>;

const withRole = (role: string, ui: React.ReactNode, path = '/admin') =>
  render(
    <AdminRoleContext.Provider value={accessFor(role)}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<>{ui}<Where /></>} />
        </Routes>
      </MemoryRouter>
    </AdminRoleContext.Provider>,
  );

const accounts = (list: Array<{ id: string; email: string }>) => ({
  accounts: list.map((a) => ({
    id: a.id, email: a.email, display_name: null, created_at: '2026-10-01T00:00:00Z',
    last_sign_in_at: null, status: 'active', staff_role: null,
  })),
  pagination: { page: 1, limit: 5, total: list.length, pages: 1 },
});

const tags = (list: Array<{ id: string; chipName: string }>) => ({
  success: true,
  data: {
    tags: list.map((t) => ({ id: t.id, chipName: t.chipName, uidSuffix: 'ABC123', serialSuffix: null, lifecycleStatus: 'ACTIVE', ownerEmail: null })),
    pagination: { page: 1, limit: 5, total: list.length },
  },
});

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});

describe('console search', () => {
  it('one match opens it straight away, and the term never goes in the URL', async () => {
    api.searchAccounts.mockResolvedValue(accounts([{ id: ACCOUNT, email: 'fan@example.com' }]));
    api.listTags.mockResolvedValue(tags([]));
    withRole('admin', <ConsoleSearch />);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search the console' }), 'fan@example.com{Enter}');

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/admin/users/${ACCOUNT}`));
    expect(screen.getByTestId('where')).not.toHaveTextContent('fan');
    expect(api.searchAccounts).toHaveBeenCalledWith({ q: 'fan@example.com', limit: 5 });
    expect(api.listTags).toHaveBeenCalledWith({ q: 'fan@example.com', limit: 5 });
  });

  it('several matches are listed under the box, accounts and tokens apart', async () => {
    api.searchAccounts.mockResolvedValue(accounts([{ id: ACCOUNT, email: 'fan@example.com' }]));
    api.listTags.mockResolvedValue(tags([{ id: TOKEN, chipName: 'chip_004' }]));
    withRole('super_admin', <ConsoleSearch />);

    await userEvent.type(screen.getByRole('searchbox'), 'fan{Enter}');

    const accountsList = await screen.findByRole('region', { name: 'Matching accounts' });
    expect(within(accountsList).getByRole('link', { name: /fan@example.com/ })).toHaveAttribute('href', `/admin/users/${ACCOUNT}`);
    const tokensList = screen.getByRole('region', { name: 'Matching tokens' });
    expect(within(tokensList).getByRole('link', { name: /chip_004/ })).toHaveAttribute('href', `/admin/tags/${TOKEN}`);
    expect(screen.getByTestId('where')).toHaveTextContent('/admin');
  });

  it('support searches accounts only (no token permission), and nothing runs until submitted', async () => {
    api.searchAccounts.mockResolvedValue(accounts([]));
    withRole('support', <ConsoleSearch />);

    await userEvent.type(screen.getByRole('searchbox'), 'nobody');
    expect(api.searchAccounts).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
    expect(api.listTags).not.toHaveBeenCalled();
  });
});

describe('needs attention', () => {
  const renderDashboard = (role: string) => {
    api.listReissueRequests.mockImplementation(async ({ status }: { status: string }) => ({
      success: true, data: { requests: [], pagination: { page: 1, limit: 1, total: status === 'PENDING' ? 2 : 1 } },
    }));
    api.listStuckPayments.mockResolvedValue({ success: true, data: { items: [], total: 3, page: 1, limit: 1, canRefund: true, githubIssuesConfigured: true } });
    api.searchAccounts.mockResolvedValue(accounts([]));
    api.getAuditLogs.mockResolvedValue({ logs: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } });
    api.getHealth.mockRejectedValue(new Error('down'));
    return withRole(role, <WorkQueueProvider><AdminDashboardPage /></WorkQueueProvider>);
  };

  it('admin sees each queue with its count, one click from the filtered list', async () => {
    renderDashboard('admin');
    const section = await screen.findByRole('region', { name: 'Needs attention' });
    await waitFor(() => expect(within(section).getByRole('link', { name: /2\s*Re-issues to review/ })).toHaveAttribute('href', '/admin/reissue-requests?status=PENDING'));
    expect(within(section).getByRole('link', { name: /1\s*Re-issues ready for a new chip/ })).toHaveAttribute('href', '/admin/reissue-requests?status=READY');
    expect(within(section).getByRole('link', { name: /3\s*Stuck payments/ })).toHaveAttribute('href', '/admin/stuck-payments?status=OPEN');
  });

  it('support sees only stuck payments (no token permission)', async () => {
    renderDashboard('support');
    const section = await screen.findByRole('region', { name: 'Needs attention' });
    await waitFor(() => expect(within(section).getByRole('link', { name: /3\s*Stuck payments/ })).toBeInTheDocument());
    expect(within(section).queryByText(/Re-issues/)).not.toBeInTheDocument();
    expect(api.listReissueRequests).not.toHaveBeenCalled();
  });
});

describe('accounts shown as links', () => {
  it('links to the account page for staff who may view accounts', () => {
    withRole('support', <AccountLink id={ACCOUNT} email="fan@example.com" />);
    expect(screen.getByRole('link', { name: 'fan@example.com' })).toHaveAttribute('href', `/admin/users/${ACCOUNT}`);
  });

  it('plain text for staff without account access; a short ID when there is no email', () => {
    render(
      <AdminRoleContext.Provider value={{ status: 'known', role: 'x', permissions: ['manage_nfc'], adminId: 'a' }}>
        <MemoryRouter><AccountLink id={ACCOUNT} email={null} /></MemoryRouter>
      </AdminRoleContext.Provider>,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Account 22222222…')).toBeInTheDocument();
  });
});

describe('free transfers after a change', () => {
  const grant: AdminVoucherGrant = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', userEmail: 'fan@example.com', quantity: 3, remaining: 2, used: 1,
    reason: 'Thank-you for early testing', expiresAt: null, status: 'active', grantedBy: 'admin@example.com',
    createdAt: '2026-10-20T12:00:00.000Z', revokedAt: null, revokedBy: null, revokeReason: null,
  };

  it('an email-filtered list is updated in place, not looked up (and audited) again', async () => {
    api.listVoucherGrants.mockResolvedValue({ grants: [grant], total: 1, page: 1, limit: 25 });
    api.revokeVoucherGrant.mockResolvedValue({ id: grant.id, revokedAt: '2026-10-26T12:00:00.000Z', unused: 2 });
    withRole('admin', <AdminVouchersPage />, '/admin/vouchers?email=fan%40example.com');

    await userEvent.click(await screen.findByRole('button', { name: /Revoke free transfers for fan@example.com/ }));
    await userEvent.type(screen.getByLabelText(/Reason/), 'Granted to the wrong account');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke free transfers' }));

    expect(await screen.findByText('Revoked')).toBeInTheDocument();
    expect(api.listVoucherGrants).toHaveBeenCalledTimes(1);
  });
});

describe('audit log time filter', () => {
  it('"Yesterday" sends the previous local day as from/to', async () => {
    api.getAuditFacets.mockResolvedValue({ actions: [], entity_types: [], actors: [] });
    api.getAuditLogs.mockResolvedValue({ logs: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } });
    withRole('admin', <AdminAuditLogPage />, '/admin/audit-logs');

    await userEvent.selectOptions(await screen.findByLabelText('Filter by time'), 'yesterday');

    await waitFor(() => {
      const last = api.getAuditLogs.mock.calls[api.getAuditLogs.mock.calls.length - 1]?.[0] as { from?: string; to?: string };
      expect(last.from).toBeTruthy();
      expect(Date.parse(last.to!) - Date.parse(last.from!)).toBeGreaterThanOrEqual(23 * 3600_000);
      expect(Date.parse(last.to!) - Date.parse(last.from!)).toBeLessThanOrEqual(25 * 3600_000);
    });
    expect(screen.getByTestId('where')).toHaveTextContent('when=yesterday');
  });
});
