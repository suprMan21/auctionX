import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AccountDetail, AccountSearch } from '../api/accountSchemas';

/**
 * S-ADMIN2 Ph1 — accounts console: the actions each role sees, the two-step
 * delete, token holdings on request only, permission-filtered nav, and the
 * admin route guard reading GET /admin/me.
 */

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  searchAccounts: vi.fn(),
  getAccount: vi.fn(),
  getAccountTokens: vi.fn(),
  suspendAccount: vi.fn(),
  accountAction: vi.fn(),
  deleteAccount: vi.fn(),
  setAccountRole: vi.fn(),
  setAccountType: vi.fn(),
  getAccountSettings: vi.fn(),
  setDeleteWindow: vi.fn(),
}));

vi.mock('../api/adminApi', async () => {
  const actual = await vi.importActual<typeof import('../api/adminApi')>('../api/adminApi');
  return { ...actual, adminApi: api };
});

const auth = vi.hoisted(() => ({
  session: { user: { id: 'me-1', email: 'boss@example.com' } } as unknown,
  signOut: vi.fn(),
}));
vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ session: auth.session, loading: false, initialized: true, signOut: auth.signOut }),
}));

import { AdminUsersPage } from './AdminUsersPage';
import { AdminUserDetailPage } from './AdminUserDetailPage';
import { AdminLayout } from '../AdminLayout';
import { AdminProtectedRoute } from '../components/AdminProtectedRoute';
import { AdminApiError } from '../api/adminApi';
import { AdminRoleContext, useAdminRole } from '../lib/adminRole';
import { accessFor } from '../test/adminAccess';
import { afterProfileLanding } from '@/features/profile/lib/landing';

const REASON = 'Support ticket 1234: account review';
const ID = '22222222-2222-4222-8222-222222222222';

const account = (overrides: Partial<AccountDetail> = {}): AccountDetail => ({
  id: ID,
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
  staff_role: null,
  account_type: 'collector',
  creator_requested_at: null,
  creator_check_status: 'NONE',
  age_verified: false,
  active_sessions: 1,
  pending_transfers: 0,
  is_self: false,
  delete: null,
  ...overrides,
});

const renderDetail = (role: string) =>
  render(
    <AdminRoleContext.Provider value={accessFor(role)}>
      <MemoryRouter initialEntries={[`/admin/users/${ID}`]}>
        <Routes>
          <Route path="/admin/users/:id" element={<AdminUserDetailPage />} />
        </Routes>
      </MemoryRouter>
    </AdminRoleContext.Provider>,
  );

const actions = () => screen.queryByRole('region', { name: 'Actions' });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getAccountSettings.mockResolvedValue({ deleteWindowHours: 24, updatedAt: '2026-10-25T00:00:00Z' });
  auth.session = { user: { id: 'me-1', email: 'boss@example.com' } };
  auth.signOut.mockReset();
});

describe('account detail: actions by role', () => {
  it('admin on a plain active account: Suspend and Retire, no role or delete', async () => {
    api.getAccount.mockResolvedValue(account());
    renderDetail('admin');
    const region = await screen.findByRole('region', { name: 'Actions' });
    expect(within(region).getByRole('button', { name: 'Suspend account…' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Retire account…' })).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: 'Change staff role…' })).not.toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('admin on a staff account: told only a super admin can change it', async () => {
    api.getAccount.mockResolvedValue(account({ staff_role: 'super_admin' }));
    renderDetail('admin');
    expect(await screen.findByText('This is a staff account. Only a super admin can change it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend account…' })).not.toBeInTheDocument();
  });

  it('own account: no actions', async () => {
    api.getAccount.mockResolvedValue(account({ is_self: true, staff_role: 'super_admin' }));
    renderDetail('super_admin');
    expect(await screen.findByText('You cannot change your own account here.')).toBeInTheDocument();
  });

  it('super admin on a suspended staff account can remove the role (not grant one)', async () => {
    api.getAccount.mockResolvedValue(account({ status: 'suspended', staff_role: 'admin' }));
    renderDetail('super_admin');
    const region = await screen.findByRole('region', { name: 'Actions' });
    await userEvent.click(within(region).getByRole('button', { name: 'Remove staff role…' }));
    const options = within(screen.getByRole('group', { name: 'Staff role' })).getAllByRole('radio').map((o) => o.closest('label')?.textContent);
    expect(options).toEqual(['No staff role']);
  });

  it('admin on an account retired with a staff role: no Reactivate, told why', async () => {
    api.getAccount.mockResolvedValue(account({ status: 'retired', retired_at: '2026-10-25T00:00:00Z', retired_staff_role: 'support' }));
    renderDetail('admin');
    expect(await screen.findByText(/Only a super admin can reactivate it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate account…' })).not.toBeInTheDocument();
  });

  it('admin on an account retired without a staff role: Reactivate offered', async () => {
    api.getAccount.mockResolvedValue(account({ status: 'retired', retired_at: '2026-10-25T00:00:00Z', retired_staff_role: null }));
    renderDetail('admin');
    expect(await screen.findByRole('button', { name: 'Reactivate account…' })).toBeInTheDocument();
  });

  it('support: no Actions section at all', async () => {
    api.getAccount.mockResolvedValue(account());
    renderDetail('support');
    await screen.findByRole('heading', { name: 'fan@example.com' });
    expect(actions()).not.toBeInTheDocument();
  });

  it('suspend sends the chosen length and reason, then reloads', async () => {
    api.getAccount.mockResolvedValueOnce(account()).mockResolvedValueOnce(account({ status: 'suspended', suspended_until: '2026-10-26T00:00:00Z', suspension_reason: REASON }));
    api.suspendAccount.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDetail('admin');
    await user.click(await screen.findByRole('button', { name: 'Suspend account…' }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Suspend account' });
    expect(submit).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText('Length'), '72');
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.click(submit);
    expect(api.suspendAccount).toHaveBeenCalledWith(ID, 72, REASON);
    expect(await screen.findByText('Account suspended and signed out everywhere.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lift suspension…' })).toBeInTheDocument();
  });
});

describe('two-step delete', () => {
  it('retired with blockers: lists them in plain words, no Delete button', async () => {
    api.getAccount.mockResolvedValue(account({
      status: 'retired', retired_at: '2026-10-25T00:00:00Z', retire_reason: REASON, retired_by_email: 'boss@example.com',
      delete: { window_hours: 24, eligible_at: '2026-10-26T00:00:00Z', blockers: ['delete_window_open', 'owns_tokens'] },
    }));
    renderDetail('super_admin');
    expect(await screen.findByText(/The waiting time after retiring has not passed yet/)).toBeInTheDocument();
    expect(screen.getByText('The account still owns tokens. Transfer them to another account first.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete account…' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate account…' })).toBeInTheDocument();
  });

  it('eligible: Delete needs the typed email part and a reason', async () => {
    api.getAccount.mockResolvedValue(account({
      status: 'retired', retired_at: '2026-10-20T00:00:00Z', retire_reason: REASON,
      delete: { window_hours: 24, eligible_at: '2026-10-21T00:00:00Z', blockers: [] },
    }));
    api.deleteAccount.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDetail('super_admin');
    await user.click(await screen.findByRole('button', { name: 'Delete account…' }));
    const dialog = screen.getByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Delete account permanently' });
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.type(within(dialog).getByLabelText(/to confirm/), 'wrong');
    expect(submit).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/to confirm/));
    await user.type(within(dialog).getByLabelText(/to confirm/), 'FAN');
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(api.deleteAccount).toHaveBeenCalledWith(ID, 'FAN', REASON);
    expect(await screen.findByRole('heading', { name: 'Account deleted' })).toBeInTheDocument();
  });

  it('admin (not super admin) never sees Delete even when eligible', async () => {
    api.getAccount.mockResolvedValue(account({ status: 'retired', retired_at: '2026-10-20T00:00:00Z' }));
    renderDetail('admin');
    await screen.findByRole('button', { name: 'Reactivate account…' });
    expect(screen.queryByRole('button', { name: 'Delete account…' })).not.toBeInTheDocument();
  });
});

describe('role change', () => {
  it('super admin grants a role; Save stays disabled until the role changes', async () => {
    api.getAccount.mockResolvedValue(account());
    api.setAccountRole.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDetail('super_admin');
    await user.click(await screen.findByRole('button', { name: 'Change staff role…' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    const save = within(dialog).getByRole('button', { name: 'Save staff role' });
    expect(save).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: 'Support' }));
    expect(api.setAccountRole).not.toHaveBeenCalled();
    await user.click(save);
    expect(api.setAccountRole).toHaveBeenCalledWith(ID, 'support', REASON);
  });

  it('only the three grantable roles are offered', async () => {
    api.getAccount.mockResolvedValue(account());
    const user = userEvent.setup();
    renderDetail('super_admin');
    await user.click(await screen.findByRole('button', { name: 'Change staff role…' }));
    const options = within(screen.getByRole('group', { name: 'Staff role' })).getAllByRole('radio').map((o) => o.closest('label')?.textContent);
    expect(options).toEqual(['No staff role (current)', 'Super admin', 'Admin', 'Support']);
  });
});

describe('token holdings (AC 4)', () => {
  it('load only when asked, for manage_nfc', async () => {
    api.getAccount.mockResolvedValue(account());
    api.getAccountTokens.mockResolvedValue({
      tokens: [
        { id: 't1', chip_name: 'chip_004', serial_suffix: '8A0351DE', lifecycle_status: 'ACTIVE', registered_at: null },
        { id: 't2', chip_name: null, serial_suffix: null, lifecycle_status: 'ENROLLED', registered_at: null },
      ],
      reissue_requests: [
        { id: 'r1', tag_id: 't1', status: 'APPROVED', payment_status: 'AWAITING_PAYMENT', created_at: '2026-10-20T00:00:00Z' },
      ],
    });
    const user = userEvent.setup();
    renderDetail('admin');
    await user.click(await screen.findByRole('button', { name: 'Show tokens' }));
    expect(api.getAccountTokens).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('link', { name: 'chip_004' })).toHaveAttribute('href', '/admin/tags/t1');
    // Plain words, never the raw id or enum.
    expect(screen.getByRole('link', { name: 'Unnamed token' })).toHaveAttribute('href', '/admin/tags/t2');
    const holdings = screen.getByRole('region', { name: 'Tokens and re-issues' });
    expect(within(holdings).getByTitle('ACTIVE')).toHaveTextContent('Active');
    expect(within(holdings).getByTitle('ENROLLED')).toHaveTextContent('Ready to claim');
    expect(screen.getByText(/: Waiting for payment$/)).toBeInTheDocument();
  });

  it('support (no manage_nfc) has no token section', async () => {
    api.getAccount.mockResolvedValue(account());
    renderDetail('support');
    await screen.findByRole('heading', { name: 'fan@example.com' });
    expect(screen.queryByRole('button', { name: 'Show tokens' })).not.toBeInTheDocument();
    expect(api.getAccountTokens).not.toHaveBeenCalled();
  });
});

describe('users list', () => {
  const page = (accounts: AccountSearch['accounts']): AccountSearch => ({
    accounts, pagination: { page: 1, limit: 25, total: accounts.length, pages: 1 },
  });

  it('shows role and status, and searches on Enter only, not while typing', async () => {
    api.searchAccounts.mockResolvedValue(page([
      { id: ID, email: 'fan@example.com', display_name: 'Fan', created_at: '2026-10-01T00:00:00Z', last_sign_in_at: null, status: 'suspended', staff_role: null, account_type: 'creator', creator_pending: false, creator_override: false },
      { id: 'b', email: 'staff@example.com', display_name: null, created_at: '2026-10-01T00:00:00Z', last_sign_in_at: null, status: 'active', staff_role: 'support', account_type: 'collector', creator_pending: false, creator_override: false },
      { id: 'c', email: 'new@example.com', display_name: null, created_at: '2026-10-01T00:00:00Z', last_sign_in_at: null, status: 'active', staff_role: null, account_type: 'collector', creator_pending: true, creator_override: false },
      { id: 'd', email: 'vip@example.com', display_name: null, created_at: '2026-10-01T00:00:00Z', last_sign_in_at: null, status: 'active', staff_role: null, account_type: 'creator', creator_pending: false, creator_override: true },
    ]));
    const user = userEvent.setup();
    render(
      <AdminRoleContext.Provider value={accessFor('support')}>
        <MemoryRouter initialEntries={['/admin/users']}><AdminUsersPage /></MemoryRouter>
      </AdminRoleContext.Provider>,
    );
    expect(await screen.findByRole('link', { name: 'fan@example.com' })).toHaveAttribute('href', `/admin/users/${ID}`);
    const table = screen.getByRole('table');
    expect(within(table).getByText('Suspended')).toBeInTheDocument();
    expect(within(table).getByText('Support')).toBeInTheDocument();
    expect(within(table).getAllByTestId('account-type-badge').map((b) => b.textContent)).toEqual(['Creator', 'Collector', 'Creator (verifying)', 'Creator (set by staff)']);
    expect(screen.queryByRole('button', { name: 'Change waiting time…' })).not.toBeInTheDocument(); // window edit: super admin only

    const box = screen.getByRole('searchbox', { name: 'Search accounts' });
    await user.type(box, 'staff');
    expect(api.searchAccounts).not.toHaveBeenCalledWith(expect.objectContaining({ q: 'staff' }));
    await user.type(box, '{Enter}');
    await waitFor(() => expect(api.searchAccounts).toHaveBeenLastCalledWith({ q: 'staff', status: 'all', type: 'all', page: 1, limit: 25 }));
  });

  it('filters by account type from the pills and from ?type=', async () => {
    api.searchAccounts.mockResolvedValue(page([]));
    const user = userEvent.setup();
    render(
      <AdminRoleContext.Provider value={accessFor('support')}>
        <MemoryRouter initialEntries={['/admin/users?type=creator']}><AdminUsersPage /></MemoryRouter>
      </AdminRoleContext.Provider>,
    );
    await waitFor(() => expect(api.searchAccounts).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'creator' })));
    await user.click(screen.getByRole('button', { name: 'Creator (verifying)' }));
    await waitFor(() => expect(api.searchAccounts).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'creator_pending', page: 1 })));
  });

  it('an unknown ?type= falls back to all types', async () => {
    api.searchAccounts.mockResolvedValue(page([]));
    render(
      <AdminRoleContext.Provider value={accessFor('support')}>
        <MemoryRouter initialEntries={['/admin/users?type=staff']}><AdminUsersPage /></MemoryRouter>
      </AdminRoleContext.Provider>,
    );
    await waitFor(() => expect(api.searchAccounts).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'all' })));
  });
});

describe('account type on the account page', () => {
  it.each([
    [{ account_type: 'creator' as const, creator_requested_at: '2026-10-02T00:00:00Z', creator_check_status: 'VERIFIED' }, 'Creator', 'Verified'],
    [{ account_type: 'collector' as const, creator_requested_at: '2026-10-02T00:00:00Z', creator_check_status: 'PENDING' }, 'Creator (verifying)', null],
    [{}, 'Collector', null],
  ])('%o → %s', async (overrides, badge, check) => {
    api.getAccount.mockResolvedValue(account(overrides));
    renderDetail('support');
    expect(await screen.findByTestId('account-type-badge')).toHaveTextContent(badge);
    if (check) expect(screen.getByText(check)).toBeInTheDocument();
    if (!('creator_requested_at' in overrides)) expect(screen.getByText('Not requested')).toBeInTheDocument();
  });
});

describe('nav by permission', () => {
  const navLinks = (role: string | null) => {
    render(
      <AdminRoleContext.Provider value={accessFor(role)}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes><Route path="/admin" element={<AdminLayout />} /></Routes>
        </MemoryRouter>
      </AdminRoleContext.Provider>,
    );
    const nav = screen.getAllByRole('navigation')[0];
    return within(nav).getAllByRole('link').map((l) => l.textContent?.trim());
  };

  it('support: users, stuck payments, creator ID checks and Settings (delete time only), no tokens or audit', () => {
    const links = navLinks('support');
    expect(links).toEqual(expect.arrayContaining(['Accounts', 'Stuck payments', 'Creator ID checks', 'Settings']));
    for (const hidden of ['Tokens', 'Re-issues', 'Pricing', 'Free transfers', 'Audit log']) expect(links).not.toContain(hidden);
  });

  it('admin: tokens, pricing and audit too', () => {
    expect(navLinks('admin')).toEqual(expect.arrayContaining(['Accounts', 'Tokens', 'Re-issues', 'Stuck payments', 'Settings', 'Creator ID checks', 'Audit log']));
  });

  it('super admin: every page, in order, under the plain names', () => {
    expect(navLinks('super_admin')).toEqual([
      'Dashboard', 'Re-issues', 'Stuck payments', 'Approvals', 'Creator ID checks', 'Tokens', 'Accounts', 'Audit log',
      'Settings', 'System health',
    ]);
  });

  it('UX-3: items sit under Queues, Records, Settings and System', () => {
    navLinks('super_admin');
    const nav = screen.getAllByRole('navigation')[0];
    const group = (name: string) => within(within(nav).getByRole('list', { name })).getAllByRole('link').map((l) => l.textContent?.trim());
    expect(within(nav).getAllByRole('heading').map((h) => h.textContent)).toEqual(['Queues', 'Records', 'Settings', 'System']);
    expect(group('Queues')).toEqual(['Re-issues', 'Stuck payments', 'Approvals', 'Creator ID checks']);
    expect(group('Records')).toEqual(['Tokens', 'Accounts', 'Audit log']);
    expect(group('Settings')).toEqual(['Settings']);
    expect(group('System')).toEqual(['System health']);
  });
});

describe('admin route guard (GET /admin/me)', () => {
  const renderGuard = () =>
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/" element={<p>home page</p>} />
          <Route path="/login" element={<p>login page</p>} />
          <Route path="/sign-in/verify" element={<p>second step</p>} />
          <Route path="/admin" element={<AdminProtectedRoute />}>
            <Route index element={<p>admin console</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

  it('an admin gets the console', async () => {
    api.getMe.mockResolvedValue({ adminId: 'me-1', email: 'boss@example.com', role: 'super_admin', permissions: ['view_users'] });
    renderGuard();
    expect(await screen.findByText('admin console')).toBeInTheDocument();
  });

  it('403 (not an admin, or a suspended/retired account) goes home', async () => {
    api.getMe.mockRejectedValue(new AdminApiError('This account is not active', 403, 'ACCOUNT_INACTIVE'));
    renderGuard();
    expect(await screen.findByText('home page')).toBeInTheDocument();
  });

  it('401 (expired or revoked session) signs out instead of going home', async () => {
    api.getMe.mockRejectedValue(new AdminApiError('Session has been invalidated', 401, 'SESSION_REVOKED'));
    renderGuard();
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('home page')).not.toBeInTheDocument();
  });

  it('unavailable: Try again asks the API again', async () => {
    api.getMe.mockRejectedValueOnce(new AdminApiError('Service temporarily unavailable', 503, 'UNAVAILABLE'));
    api.getMe.mockResolvedValueOnce({ adminId: 'me-1', email: 'boss@example.com', role: 'super_admin', permissions: [] });
    renderGuard();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('admin console')).toBeInTheDocument();
    expect(api.getMe).toHaveBeenCalledTimes(2);
  });

  it('ADMIN_2FA_REQUIRED opens the second sign-in step instead of signing out (S-2FA Ph2)', async () => {
    api.getMe.mockRejectedValue(new AdminApiError('Admin access needs two-factor sign-in', 403, 'ADMIN_2FA_REQUIRED'));
    renderGuard();
    expect(await screen.findByText('second step')).toBeInTheDocument();
    expect(screen.queryByText('login page')).toBeNull();
  });

  const RoleProbe = () => {
    const access = useAdminRole();
    return <p>role: {access.status === 'known' ? access.role : 'none'}</p>;
  };
  const renderGuardWithProbe = () =>
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/" element={<p>home page</p>} />
          <Route path="/admin" element={<AdminProtectedRoute />}>
            <Route index element={<RoleProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  const me = (role: string) => ({ adminId: 'me-1', email: 'boss@example.com', role, permissions: ['view_users'] });

  it('role revoked mid-session: the next check signs out (focus re-checks)', async () => {
    api.getMe.mockResolvedValueOnce(me('support'));
    renderGuardWithProbe();
    expect(await screen.findByText('role: support')).toBeInTheDocument();
    api.getMe.mockRejectedValue(new AdminApiError('User is not an admin', 403, 'FORBIDDEN'));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('role: support')).not.toBeInTheDocument();
    expect(screen.queryByText('home page')).not.toBeInTheDocument();
  });

  it('role changed mid-session: the console follows the new role', async () => {
    api.getMe.mockResolvedValueOnce(me('admin'));
    renderGuardWithProbe();
    expect(await screen.findByText('role: admin')).toBeInTheDocument();
    api.getMe.mockResolvedValue(me('support'));
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByText('role: support')).toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('a network blip on a re-check keeps the console', async () => {
    api.getMe.mockResolvedValueOnce(me('admin'));
    renderGuardWithProbe();
    expect(await screen.findByText('role: admin')).toBeInTheDocument();
    api.getMe.mockRejectedValue(new TypeError('Failed to fetch'));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(api.getMe).toHaveBeenCalledTimes(2));
    expect(screen.getByText('role: admin')).toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('signed out goes to login without asking the API', async () => {
    auth.session = null;
    renderGuard();
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(api.getMe).not.toHaveBeenCalled();
  });
});

describe('profile save landing (AC 11)', () => {
  it('lands on My Tokens while the marketplace is parked', () => {
    expect(afterProfileLanding()).toBe('/tokens');
  });
});

describe('change account type (admin + super admin)', () => {
  const typeOptions = () =>
    within(screen.getByRole('group', { name: 'Account type' })).getAllByRole('radio').map((o) => o.closest('label')?.querySelector('span > span')?.textContent);

  it('support cannot see the button', async () => {
    api.getAccount.mockResolvedValue(account());
    renderDetail('support');
    await screen.findByTestId('account-type-badge');
    expect(screen.queryByRole('button', { name: 'Change account type…' })).not.toBeInTheDocument();
  });

  it('admin skips the ID check for an unverified collector (3 clicks + reason)', async () => {
    api.getAccount.mockResolvedValue(account());
    api.setAccountType.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDetail('admin');
    await user.click(await screen.findByRole('button', { name: 'Change account type…' }));
    expect(typeOptions()).toEqual(['Collector (current)', 'Creator', 'Creator now, skip the ID check']);
    const dialog = screen.getByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Save account type' });
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    expect(save).toBeDisabled(); // nothing changed yet
    await user.click(within(dialog).getByRole('radio', { name: /skip the ID check/ }));
    await user.click(save);
    expect(api.setAccountType).toHaveBeenCalledWith(ID, 'creator', true, REASON);
    expect(await screen.findByText('Account type saved.')).toBeInTheDocument();
  });

  it('plain Creator keeps the ID check requirement', async () => {
    api.getAccount.mockResolvedValue(account());
    api.setAccountType.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderDetail('super_admin');
    await user.click(await screen.findByRole('button', { name: 'Change account type…' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: /^Creator Shows as Creator \(verifying\)/ }));
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.click(within(dialog).getByRole('button', { name: 'Save account type' }));
    expect(api.setAccountType).toHaveBeenCalledWith(ID, 'creator', false, REASON);
  });

  it('a verified account is offered no override; an overridden one can only go back to Collector', async () => {
    api.getAccount.mockResolvedValue(account({ creator_check_status: 'VERIFIED' }));
    const user = userEvent.setup();
    const { unmount } = renderDetail('admin');
    await user.click(await screen.findByRole('button', { name: 'Change account type…' }));
    expect(typeOptions()).toEqual(['Collector (current)', 'Creator']);
    unmount();

    api.getAccount.mockResolvedValue(account({
      account_type: 'creator', creator_requested_at: '2026-10-27T00:00:00Z',
      creator_override_at: '2026-10-27T00:00:00Z', creator_override_by_email: 'boss@example.com',
    }));
    renderDetail('admin');
    expect(await screen.findByTestId('account-type-badge')).toHaveTextContent('Creator (set by staff)');
    expect(screen.getByText(/boss@example.com on/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change account type…' }));
    expect(typeOptions()).toEqual(['Collector', 'Creator now, skip the ID check (current)']);
  });

  it('not offered on your own account', async () => {
    api.getAccount.mockResolvedValue(account({ is_self: true }));
    renderDetail('super_admin');
    await screen.findByTestId('account-type-badge');
    expect(screen.queryByRole('button', { name: 'Change account type…' })).not.toBeInTheDocument();
  });
});
