import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminPriceChange, AdminPricing, AdminVoucherGrant, AdminVoucherList } from '../api/pricingSchemas';

/**
 * S-ADMIN1 Ph3b — admin Pricing and Free transfers pages, and that only admin
 * and super_admin get them (support sees neither the nav items nor the pages).
 */

const api = vi.hoisted(() => ({
  getPricing: vi.fn(),
  setPrice: vi.fn(),
  cancelPrice: vi.fn(),
  listVoucherGrants: vi.fn(),
  grantVouchers: vi.fn(),
  revokeVoucherGrant: vi.fn(),
}));

vi.mock('../api/adminApi', async () => {
  const actual = await vi.importActual<typeof import('../api/adminApi')>('../api/adminApi');
  return { ...actual, adminApi: api };
});

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ session: { user: { email: 'boss@example.com' } }, signOut: vi.fn() }),
}));

import { AdminPricingPage } from './AdminPricingPage';
import { AdminVouchersPage } from './AdminVouchersPage';
import { AdminLayout } from '../AdminLayout';
import { AdminRoleGate } from '../components/AdminRoleGate';
import { AdminRoleContext, PRICING_ROLES } from '../lib/adminRole';
import { parseDollarsToCents, toIsoWithOffset } from '../lib/pricing';
import { adminPricingSchema, parseEnvelope } from '../api/pricingSchemas';

const REASON = 'Raising the fee for the new chip order';
const money = (cents: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);

const change = (overrides: Partial<AdminPriceChange> = {}): AdminPriceChange => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'transfer',
  amountUsdCents: 250,
  effectiveFrom: '2026-10-01T00:00:00.000Z',
  reason: 'Launch default price',
  status: 'in_effect',
  createdBy: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  ...overrides,
});

const SCHEDULED = change({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  amountUsdCents: 300,
  effectiveFrom: '2099-01-01T14:00:00.000Z',
  reason: 'New year price change',
  status: 'scheduled',
  createdBy: 'admin@example.com',
});

const pricing = (history: AdminPriceChange[] = [SCHEDULED, change()]): AdminPricing => ({
  current: { transfer: 250, token: 2500, reissue: 1000 },
  defaults: { transfer: 250, token: 2500, reissue: 1000 },
  history,
});

const grant = (overrides: Partial<AdminVoucherGrant> = {}): AdminVoucherGrant => ({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  userEmail: 'fan@example.com',
  quantity: 3,
  remaining: 2,
  used: 1,
  reason: 'Thank-you for early testing',
  expiresAt: null,
  status: 'active',
  grantedBy: 'admin@example.com',
  createdAt: '2026-10-20T12:00:00.000Z',
  revokedAt: null,
  revokedBy: null,
  revokeReason: null,
  ...overrides,
});

const grants = (items: AdminVoucherGrant[], total = items.length, page = 1): AdminVoucherList => ({
  grants: items, total, page, limit: 25,
});

const withRole = (role: string | null, ui: React.ReactNode) => (
  <AdminRoleContext.Provider value={{ status: 'known', role }}>{ui}</AdminRoleContext.Provider>
);

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
});

// ── Helpers ─────────────────────────────────────────────────────────────────

describe('pricing helpers', () => {
  it('reads dollars as integer cents without float maths', () => {
    expect(parseDollarsToCents('3')).toBe(300);
    expect(parseDollarsToCents('3.5')).toBe(350);
    expect(parseDollarsToCents('$1,000.00')).toBe(100_000);
    expect(parseDollarsToCents('0.29')).toBe(29);
    expect(parseDollarsToCents('3.555')).toBeNull();
    expect(parseDollarsToCents('abc')).toBeNull();
    expect(parseDollarsToCents('-1')).toBeNull();
  });

  it('validates admin responses: a shape the page does not expect is an error', () => {
    expect(parseEnvelope(adminPricingSchema, { success: true, data: pricing() })).toEqual(pricing());
    expect(() => parseEnvelope(adminPricingSchema, { success: true, data: { current: {} } })).toThrow('Unexpected response from the server.');
    expect(() => parseEnvelope(adminPricingSchema, { success: false, data: null, error: 'x' })).toThrow('Unexpected response');
  });

  it('writes a local time as ISO 8601 with an offset', () => {
    const iso = toIsoWithOffset(new Date(2026, 10, 1, 9, 30, 0));
    expect(iso).toMatch(/^2026-11-01T09:30:00[+-]\d{2}:\d{2}$/);
    expect(new Date(iso).getTime()).toBe(new Date(2026, 10, 1, 9, 30, 0).getTime());
  });
});

// ── Pricing page ────────────────────────────────────────────────────────────

describe('AdminPricingPage', () => {
  const renderPage = () => render(<MemoryRouter><AdminPricingPage /></MemoryRouter>);

  it('shows the price in effect for each kind, the next scheduled change, and the history', async () => {
    api.getPricing.mockResolvedValue(pricing());
    renderPage();

    const cards = await screen.findByRole('list', { name: 'Prices in effect' });
    expect(within(cards).getByRole('heading', { name: 'Transfer fee' })).toBeInTheDocument();
    expect(within(cards).getByText(money(250))).toBeInTheDocument();
    expect(within(cards).getByText(money(1000))).toBeInTheDocument();
    expect(within(cards).getByText(money(2500))).toBeInTheDocument();
    expect(within(cards).getByText(new RegExp(`Changes to ${money(300).replace('$', '\\$')}`))).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByText('Scheduled')).toBeInTheDocument();
    expect(within(table).getByText('In effect')).toBeInTheDocument();
    expect(within(table).getByText('Launch default')).toBeInTheDocument();
    expect(within(table).getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText(/applies only to transfers started, and re-issue requests made, after it takes effect/)).toBeInTheDocument();
  });

  it('offers Cancel only on scheduled changes', async () => {
    api.getPricing.mockResolvedValue(pricing([
      SCHEDULED,
      change(),
      change({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', status: 'superseded', amountUsdCents: 200 }),
      change({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'cancelled', amountUsdCents: 400, cancelledAt: '2026-10-02T00:00:00.000Z', cancelReason: 'Changed our mind' }),
    ]));
    renderPage();

    await screen.findByRole('table');
    expect(screen.getAllByRole('button', { name: /^Cancel the/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: `Cancel the transfer fee change to ${money(300)}` })).toBeInTheDocument();
    expect(screen.getByText(/Changed our mind/)).toBeInTheDocument();
  });

  it('cancelling a scheduled change needs a reason, then sends it and reloads', async () => {
    api.getPricing.mockResolvedValue(pricing());
    api.cancelPrice.mockResolvedValue({ id: SCHEDULED.id, cancelledAt: '2026-10-24T00:00:00.000Z' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /^Cancel the transfer fee change/ }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this scheduled change' });
    const submit = within(dialog).getByRole('button', { name: 'Cancel the change' });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.click(submit);

    expect(api.cancelPrice).toHaveBeenCalledWith(SCHEDULED.id, REASON);
    expect(api.getPricing).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the server’s message when a cancel is refused', async () => {
    api.getPricing.mockResolvedValue(pricing());
    api.cancelPrice.mockRejectedValue(new Error('This price is already in effect. Set a new price instead.'));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /^Cancel the transfer fee change/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel the change' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already in effect. Set a new price instead.');
  });

  it('Change price validates the amount and reason, confirms the change, and posts cents with effectiveFrom null for Now', async () => {
    api.getPricing.mockResolvedValue(pricing());
    api.setPrice.mockResolvedValue({ id: 'new', kind: 'transfer', amountUsdCents: 300, effectiveFrom: '2026-10-24T00:00:00.000Z' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Change price…' }));
    const dialog = screen.getByRole('dialog', { name: 'Change a price' });
    const submit = within(dialog).getByRole('button', { name: 'Set price' });
    const amount = within(dialog).getByLabelText('New price (USD)');

    await user.type(amount, '0.49');
    expect(within(dialog).getByText(/Enter an amount from/)).toBeInTheDocument();
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    expect(submit).toBeDisabled();

    await user.clear(amount);
    await user.type(amount, '3');
    expect(within(dialog).queryByText(/Enter an amount from/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('status')).toHaveTextContent(`Transfer fee changes from ${money(250)} to ${money(300)} now.`);

    await user.clear(within(dialog).getByLabelText(/Reason/));
    await user.type(within(dialog).getByLabelText(/Reason/), 'too short');
    expect(submit).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/Reason/));
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.click(submit);

    expect(api.setPrice).toHaveBeenCalledWith({ kind: 'transfer', amountUsdCents: 300, effectiveFrom: null, reason: REASON });
    expect(api.getPricing).toHaveBeenCalledTimes(2);
  });

  it('rejects more than $1,000', async () => {
    api.getPricing.mockResolvedValue(pricing());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Change price…' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('New price (USD)'), '1000.01');
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    expect(within(dialog).getByRole('button', { name: 'Set price' })).toBeDisabled();
  });

  it('schedules a change for a future time, sent as ISO with an offset', async () => {
    api.getPricing.mockResolvedValue(pricing());
    api.setPrice.mockResolvedValue({ id: 'new', kind: 'reissue', amountUsdCents: 1200, effectiveFrom: '2099-03-01T14:00:00.000Z' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Change price…' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Price'), 'reissue');
    await user.type(within(dialog).getByLabelText('New price (USD)'), '12');
    await user.click(within(dialog).getByRole('radio', { name: 'Schedule' }));
    const submit = within(dialog).getByRole('button', { name: 'Schedule price' });
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    expect(submit).toBeDisabled();

    const startsAt = within(dialog).getByLabelText(/Start date and time/);
    await user.type(startsAt, '2099-03-01T09:00');
    expect(within(dialog).getByRole('status')).toHaveTextContent(`Re-issue fee changes from ${money(1000)} to ${money(1200)} on`);
    await user.click(submit);

    const body = api.setPrice.mock.calls[0][0] as { effectiveFrom: string };
    expect(body).toMatchObject({ kind: 'reissue', amountUsdCents: 1200, reason: REASON });
    expect(body.effectiveFrom).toMatch(/^2099-03-01T09:00:00[+-]\d{2}:\d{2}$/);
  });

  it('shows the error when prices cannot be loaded', async () => {
    api.getPricing.mockRejectedValue(new Error('Insufficient permissions'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient permissions');
  });
});

// ── Vouchers page ───────────────────────────────────────────────────────────

describe('AdminVouchersPage', () => {
  const renderPage = (path = '/admin/vouchers') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/vouchers" element={<AdminVouchersPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('lists grants with status, and says email lookups are audit-logged', async () => {
    api.listVoucherGrants.mockResolvedValue(grants([
      grant(),
      grant({ id: 'c2', status: 'revoked', remaining: 0, revokedAt: '2026-10-21T00:00:00.000Z', revokeReason: 'Granted by mistake' }),
    ]));
    renderPage();

    const table = await screen.findByRole('table');
    expect(api.listVoucherGrants).toHaveBeenCalledWith({ email: undefined, page: 1, limit: 25 });
    expect(within(table).getAllByText('fan@example.com')).toHaveLength(2);
    expect(within(table).getByText('Active')).toBeInTheDocument();
    expect(within(table).getByText('Revoked')).toBeInTheDocument();
    expect(within(table).getByText(/Granted by mistake/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Revoke free transfers/ })).toHaveLength(1);
    expect(screen.getByText('Each email lookup is recorded in the audit log.')).toBeInTheDocument();
  });

  it('filters by exact email, lowercased', async () => {
    api.listVoucherGrants.mockResolvedValue(grants([]));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('No free transfers have been granted yet.');
    await user.type(screen.getByLabelText('Account email (exact)'), '  Fan@Example.COM ');
    await user.click(screen.getByRole('button', { name: 'Find' }));

    expect(api.listVoucherGrants).toHaveBeenLastCalledWith({ email: 'fan@example.com', page: 1, limit: 25 });
    expect(await screen.findByText('No free transfers have been granted to fan@example.com.')).toBeInTheDocument();
  });

  it('pages through grants', async () => {
    api.listVoucherGrants.mockResolvedValue(grants([grant()], 60));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(api.listVoucherGrants).toHaveBeenLastCalledWith({ email: undefined, page: 2, limit: 25 });
  });

  it('grants free transfers with a trimmed, lowercased email and the quantity', async () => {
    api.listVoucherGrants.mockResolvedValue(grants([]));
    api.grantVouchers.mockResolvedValue({ id: 'g1', userEmail: 'fan@example.com', quantity: 3, remaining: 3, expiresAt: null });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Grant free transfers…' }));
    const dialog = screen.getByRole('dialog', { name: 'Grant free transfers' });
    const submit = within(dialog).getByRole('button', { name: 'Grant' });

    await user.type(within(dialog).getByLabelText('Account email'), '  Fan@Example.COM ');
    const qty = within(dialog).getByLabelText('How many');
    await user.clear(qty);
    await user.type(qty, '101');
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    expect(submit).toBeDisabled();

    await user.clear(qty);
    await user.type(qty, '3');
    expect(within(dialog).getByRole('status')).toHaveTextContent('Gives fan@example.com 3 free transfers, with no expiry.');
    await user.click(submit);

    expect(api.grantVouchers).toHaveBeenCalledWith({ email: 'fan@example.com', quantity: 3, reason: REASON, expiresAt: null });
    expect(api.listVoucherGrants).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sends an expiry as the end of the chosen day with an offset', async () => {
    api.listVoucherGrants.mockResolvedValue(grants([]));
    api.grantVouchers.mockResolvedValue({ id: 'g1', userEmail: 'fan@example.com', quantity: 1, remaining: 1, expiresAt: '2099-12-31T23:59:59-05:00' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Grant free transfers…' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Account email'), 'fan@example.com');
    await user.type(within(dialog).getByLabelText('Expires (optional)'), '2099-12-31');
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.click(within(dialog).getByRole('button', { name: 'Grant' }));

    const body = api.grantVouchers.mock.calls[0][0] as { expiresAt: string };
    expect(body.expiresAt).toMatch(/^2099-12-31T23:59:59[+-]\d{2}:\d{2}$/);
  });

  it('shows the server’s message when the email has no account', async () => {
    api.listVoucherGrants.mockResolvedValue(grants([]));
    api.grantVouchers.mockRejectedValue(new Error('No account uses that email'));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Grant free transfers…' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Account email'), 'nobody@example.com');
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.click(within(dialog).getByRole('button', { name: 'Grant' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No account uses that email');
  });

  it('revoke says how many unused free transfers it cancels, needs a reason, then reloads', async () => {
    api.listVoucherGrants.mockResolvedValue(grants([grant()]));
    api.revokeVoucherGrant.mockResolvedValue({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', revokedAt: '2026-10-24T00:00:00.000Z', unused: 2 });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Revoke free transfers for fan@example.com' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke free transfers' });
    expect(within(dialog).getByText(/cancels the 2 free transfers still unused from this grant for fan@example.com/)).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: 'Revoke' });
    expect(submit).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Reason/), REASON);
    await user.click(submit);

    expect(api.revokeVoucherGrant).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', REASON);
    expect(api.listVoucherGrants).toHaveBeenCalledTimes(2);
  });
});

// ── Role gating ─────────────────────────────────────────────────────────────

describe('Pricing and free transfers are admin and super_admin only', () => {
  const renderLayout = (role: string | null) =>
    render(
      withRole(role, (
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<p>dashboard</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      )),
    );

  const nav = () => screen.getAllByRole('navigation', { name: 'Admin navigation' })[0];

  it.each(['admin', 'super_admin'])('shows the nav items to %s', (role) => {
    renderLayout(role);
    expect(within(nav()).getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/admin/pricing');
    expect(within(nav()).getByRole('link', { name: 'Free transfers' })).toHaveAttribute('href', '/admin/vouchers');
  });

  it.each(['support', null])('hides the nav items from %s', (role) => {
    renderLayout(role);
    expect(within(nav()).getByRole('link', { name: 'Stuck payments' })).toBeInTheDocument();
    expect(within(nav()).queryByRole('link', { name: 'Pricing' })).not.toBeInTheDocument();
    expect(within(nav()).queryByRole('link', { name: 'Free transfers' })).not.toBeInTheDocument();
  });

  it('hides the nav items while the role is still loading', () => {
    render(
      <AdminRoleContext.Provider value={{ status: 'loading' }}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route path="/admin" element={<AdminLayout />} />
          </Routes>
        </MemoryRouter>
      </AdminRoleContext.Provider>,
    );
    expect(within(nav()).queryByRole('link', { name: 'Pricing' })).not.toBeInTheDocument();
  });

  it('does not load either page for support', () => {
    render(withRole('support', (
      <MemoryRouter>
        <AdminRoleGate roles={PRICING_ROLES}><AdminPricingPage /></AdminRoleGate>
        <AdminRoleGate roles={PRICING_ROLES}><AdminVouchersPage /></AdminRoleGate>
      </MemoryRouter>
    )));

    expect(screen.getAllByRole('heading', { name: 'Admins only' })).toHaveLength(2);
    expect(api.getPricing).not.toHaveBeenCalled();
    expect(api.listVoucherGrants).not.toHaveBeenCalled();
  });

  it('loads the page for an admin', async () => {
    api.getPricing.mockResolvedValue(pricing());
    render(withRole('admin', (
      <MemoryRouter>
        <AdminRoleGate roles={PRICING_ROLES}><AdminPricingPage /></AdminRoleGate>
      </MemoryRouter>
    )));

    expect(await screen.findByRole('heading', { name: 'Pricing' })).toBeInTheDocument();
    expect(api.getPricing).toHaveBeenCalledTimes(1);
  });
});
