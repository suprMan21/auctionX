import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ClaimResult, IncomingTransfer, MyToken, OwnershipLookup, TapResult } from '../api/schemas';

// ── Mocks ───────────────────────────────────────────────────────────────────

const authState: { user: { id: string } | null } = { user: null };
vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ user: authState.user }),
}));

const api = vi.hoisted(() => ({
  tap: vi.fn<(sunMessage: string) => Promise<TapResult>>(),
  claimWithTapSession: vi.fn<(token: string) => Promise<ClaimResult>>(),
  myTokens: vi.fn<() => Promise<MyToken[]>>(),
  incomingTransfers: vi.fn<() => Promise<IncomingTransfer[]>>(),
  lookupOwnership: vi.fn<(id: string) => Promise<OwnershipLookup>>(),
}));

vi.mock('../api/tokenApi', async () => {
  const actual = await vi.importActual<typeof import('../api/tokenApi')>('../api/tokenApi');
  return { ...actual, tokenApi: api };
});

import { TokenApiError } from '../api/tokenApi';
import { TokenVerifyPage } from './TokenVerifyPage';
import { MyTokensPage } from './MyTokensPage';
import { OwnershipLookupPage } from './OwnershipLookupPage';

// ── Fixtures ────────────────────────────────────────────────────────────────

const PICC = 'EF963FF7828658A599F3041510671E88';
const CMAC = '94EED9EE65337086';
const TAP_PATH = `/verify/chip_001?picc_data=${PICC}&cmac=${CMAC}`;
const SESSION = 'S'.repeat(43);
const OWNERSHIP_ID = '0x' + 'ab'.repeat(32);

const provenance = (overrides: Partial<NonNullable<Extract<TapResult, { valid: true }>['provenance']>> = {}) => ({
  tag_id: 'tag-1',
  lifecycle_status: 'ENROLLED',
  is_valid: false,
  claim_date: null,
  creator_name: null,
  origin_video_url: null,
  origin_location: null,
  origin_date: null,
  current_ownership_id: null,
  enrolled_at: '2026-10-01T00:00:00.000Z',
  ...overrides,
});

const enrolledTap = (overrides: Partial<Extract<TapResult, { valid: true }>> = {}): TapResult => ({
  valid: true,
  tagId: 'tag-1',
  lifecycleStatus: 'ENROLLED',
  provenance: provenance(),
  tapSession: { token: SESSION, expiresAt: new Date(Date.now() + 600_000).toISOString() },
  viewer: null,
  ...overrides,
});

/** Exposes the router's current URL so tests can assert the SUN params were stripped. */
const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
};

const renderVerify = (path: string, { strict = false } = {}) => {
  // The page reads window.location.href as the tapped URL.
  window.history.replaceState({}, '', path);
  const tree = (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/verify/:tokenName" element={<><TokenVerifyPage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};

beforeEach(() => {
  sessionStorage.clear();
  authState.user = null;
  Object.values(api).forEach((fn) => fn.mockReset());
});

// ── Verify page ─────────────────────────────────────────────────────────────

describe('TokenVerifyPage', () => {
  it('verifies a tap once, then strips the one-time parameters', async () => {
    api.tap.mockResolvedValue(enrolledTap());

    renderVerify(TAP_PATH, { strict: true });

    expect(await screen.findByRole('heading', { name: 'Unclaimed.' })).toBeInTheDocument();
    expect(screen.getByText(/Genuine Authentic Materials token/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/verify\/chip_001$/));
    // The full tapped URL is what the backend verifies.
    expect(api.tap.mock.calls[0][0]).toContain(`picc_data=${PICC}`);
  });

  it('asks an anonymous visitor to sign in, returning to this page', async () => {
    api.tap.mockResolvedValue(enrolledTap());
    renderVerify(TAP_PATH);

    const link = await screen.findByRole('link', { name: 'Sign in to claim' });
    expect(link).toHaveAttribute('href', '/login?next=%2Fverify%2Fchip_001');
  });

  it('claims with the tap session after a confirmation step', async () => {
    authState.user = { id: 'user-1' };
    api.tap.mockResolvedValue(enrolledTap());
    api.claimWithTapSession.mockResolvedValue({ tagId: 'tag-1', lifecycleStatus: 'ACTIVE', ownershipId: OWNERSHIP_ID });
    const user = userEvent.setup();

    renderVerify(TAP_PATH);
    await user.click(await screen.findByRole('button', { name: 'Claim token' }));
    expect(api.claimWithTapSession).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm claim' }));

    expect(await screen.findByText('Claimed. It is yours.')).toBeInTheDocument();
    expect(screen.getByText(OWNERSHIP_ID)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'You own this.' })).toBeInTheDocument();
    expect(api.claimWithTapSession).toHaveBeenCalledWith(SESSION);
  });

  it('explains an expired tap session and stops offering the claim', async () => {
    authState.user = { id: 'user-1' };
    api.tap.mockResolvedValue(enrolledTap());
    api.claimWithTapSession.mockRejectedValue(
      new TokenApiError('expired', 400, 'invalid_argument', 'tap_session_invalid'),
    );
    const user = userEvent.setup();

    renderVerify(TAP_PATH);
    await user.click(await screen.findByRole('button', { name: 'Claim token' }));
    await user.click(screen.getByRole('button', { name: 'Confirm claim' }));

    expect(await screen.findByText(/Your tap has expired or was already used/)).toBeInTheDocument();
  });

  it('shows the 2FA explanation instead of a raw error', async () => {
    authState.user = { id: 'user-1' };
    api.tap.mockResolvedValue(enrolledTap());
    api.claimWithTapSession.mockRejectedValue(
      new TokenApiError('Two-factor authentication is required', 403, 'permission_denied', '2fa_required'),
    );
    const user = userEvent.setup();

    renderVerify(TAP_PATH);
    await user.click(await screen.findByRole('button', { name: 'Claim token' }));
    await user.click(screen.getByRole('button', { name: 'Confirm claim' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/two-factor authentication/i);
  });

  it('shows "already used" for a replayed tap', async () => {
    api.tap.mockResolvedValue({ valid: false, reason: 'replay_detected' });
    renderVerify(TAP_PATH);

    expect(await screen.findByRole('heading', { name: 'This tap was already used.' })).toBeInTheDocument();
    expect(screen.queryByText(/Genuine/)).not.toBeInTheDocument();
  });

  it('warns plainly about an unregistered chip', async () => {
    api.tap.mockRejectedValue(new TokenApiError('No NFC tag matched the scan', 404, 'not_found', null));
    renderVerify(TAP_PATH);

    expect(await screen.findByRole('heading', { name: 'This is not a registered token.' })).toBeInTheDocument();
  });

  it('shows the buyer warning on an active token the visitor does not own', async () => {
    api.tap.mockResolvedValue(
      enrolledTap({
        lifecycleStatus: 'ACTIVE',
        tapSession: null,
        provenance: provenance({ lifecycle_status: 'ACTIVE', is_valid: true, creator_name: 'Disclosed Creator' }),
      }),
    );
    renderVerify(TAP_PATH);

    expect(await screen.findByRole('heading', { name: 'Verified.' })).toBeInTheDocument();
    expect(screen.getByText(/Do not pay until the owner starts a transfer to you/)).toBeInTheDocument();
    expect(screen.getByText('Disclosed Creator')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim token' })).not.toBeInTheDocument();
  });

  it.each([
    ['RELEASED', 'Released.'],
    ['RETIRED', 'Retired.'],
    ['SUSPENDED', 'On hold.'],
  ])('labels a %s token as no longer actionable', async (status, heading) => {
    api.tap.mockResolvedValue(enrolledTap({ lifecycleStatus: status, tapSession: null }));
    renderVerify(TAP_PATH);

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim token' })).not.toBeInTheDocument();
  });

  it('reads a refreshed page from the tab cache without re-sending the tap', async () => {
    api.tap.mockResolvedValue(enrolledTap());
    const first = renderVerify(TAP_PATH);
    await screen.findByRole('heading', { name: 'Unclaimed.' });
    first.unmount();

    renderVerify('/verify/chip_001');

    expect(await screen.findByRole('heading', { name: 'Unclaimed.' })).toBeInTheDocument();
    expect(api.tap).toHaveBeenCalledTimes(1);
  });

  it('asks for a tap when there is nothing to verify', async () => {
    renderVerify('/verify/chip_001');

    expect(await screen.findByRole('heading', { name: 'Tap the token to verify it.' })).toBeInTheDocument();
    expect(api.tap).not.toHaveBeenCalled();
  });
});

// ── My Tokens ───────────────────────────────────────────────────────────────

const renderAt = (path: string, routePath: string, element: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={element} />
      </Routes>
    </MemoryRouter>,
  );

describe('MyTokensPage', () => {
  it('shows an empty collection with a way forward', async () => {
    api.myTokens.mockResolvedValue([]);
    api.incomingTransfers.mockResolvedValue([]);
    renderAt('/tokens', '/tokens', <MyTokensPage />);

    expect(await screen.findByText('No tokens yet.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Waiting for you' })).not.toBeInTheDocument();
  });

  it('lists owned tokens and incoming transfers', async () => {
    api.myTokens.mockResolvedValue([
      {
        tagId: 'abcdef12-0000-4000-8000-000000000000',
        lifecycleStatus: 'ACTIVE',
        claimedAt: '2026-10-02T00:00:00.000Z',
        title: null,
        disclosure: {},
        ownershipId: OWNERSHIP_ID,
        provenance: null,
        pendingTransfer: null,
      },
    ]);
    api.incomingTransfers.mockResolvedValue([
      {
        transferId: 'tr-1',
        tagId: 'tag-9',
        transferType: 'gift',
        feePayer: 'SELLER',
        listAmountUsdCents: 250,
        initiatedAt: null,
        provenance: null,
      },
    ]);
    renderAt('/tokens', '/tokens', <MyTokensPage />);

    const link = await screen.findByRole('link', { name: /Token ABCDEF12/ });
    expect(link).toHaveAttribute('href', '/tokens/abcdef12-0000-4000-8000-000000000000');
    expect(screen.getByText('A token is being gifted to you.')).toBeInTheDocument();
    expect(screen.getByText(/The sender is covering the transfer fee/)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    api.myTokens.mockRejectedValue(new TokenApiError('Please sign in to continue.', 401, 'unauthenticated', null));
    api.incomingTransfers.mockResolvedValue([]);
    renderAt('/tokens', '/tokens', <MyTokensPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Please sign in to continue.');
  });
});

// ── Ownership lookup ────────────────────────────────────────────────────────

describe('OwnershipLookupPage', () => {
  it('says only "no longer current" for a stale ID', async () => {
    api.lookupOwnership.mockResolvedValue({ status: 'stale', message: 'This Ownership ID is no longer current' });
    renderAt(`/ownership/${OWNERSHIP_ID}`, '/ownership/:ownershipId', <OwnershipLookupPage />);

    expect(await screen.findByRole('heading', { name: 'No longer current.' })).toBeInTheDocument();
    expect(screen.queryByText('The story')).not.toBeInTheDocument();
  });

  it('shows the public record and "You own this" for the owner', async () => {
    api.lookupOwnership.mockResolvedValue({
      status: 'current',
      youOwnThis: true,
      provenance: provenance({ lifecycle_status: 'ACTIVE', is_valid: true }),
    });
    renderAt(`/ownership/${OWNERSHIP_ID}`, '/ownership/:ownershipId', <OwnershipLookupPage />);

    expect(await screen.findByRole('heading', { name: 'You own this.' })).toBeInTheDocument();
    expect(screen.getByText('The story')).toBeInTheDocument();
  });
});
