import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MyToken, OwnerReissue, TapResult } from '../api/schemas';

/**
 * S-ADMIN1 Ph2 owner screens: the replacement request (live tap + live camera
 * photos), the web pay page, and the token-page status section.
 */

const authState: { user: { id: string } | null } = { user: { id: 'owner-1' } };
vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ user: authState.user }),
}));

const api = vi.hoisted(() => ({
  myTokens: vi.fn(),
  myReissueRequests: vi.fn(),
  uploadReissuePhoto: vi.fn(),
  requestReissue: vi.fn(),
  payReissue: vi.fn(),
  cancelReissue: vi.fn(),
  tap: vi.fn(),
  incomingTransfers: vi.fn(),
}));

vi.mock('../api/tokenApi', async () => {
  const actual = await vi.importActual<typeof import('../api/tokenApi')>('../api/tokenApi');
  return { ...actual, tokenApi: api };
});

const confirmPayment = vi.hoisted(() => vi.fn());
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment }),
  useElements: () => ({}),
}));
vi.mock('@/lib/stripe', () => ({
  stripePromise: Promise.resolve(null),
  stripeAppearance: {},
  isStripeConfigured: true,
  isStripeTestMode: false,
}));

import { TokenApiError } from '../api/tokenApi';
import { saveTap } from '../lib/tapCache';
import { ReissueRequestPage } from './ReissueRequestPage';
import { ReissuePayPage } from './ReissuePayPage';
import { TokenVerifyPage } from './TokenVerifyPage';
import { ReplacementSection } from '../components/ReplacementSection';

// ── Fixtures ────────────────────────────────────────────────────────────────

const SESSION = 'S'.repeat(43);
const REQ = 'req-1';

const ownedToken = (overrides: Partial<MyToken> = {}): MyToken => ({
  tagId: 'tag-1',
  lifecycleStatus: 'ACTIVE',
  claimedAt: '2026-10-02T00:00:00.000Z',
  title: 'Signed jersey',
  disclosure: {},
  ownershipId: '0x' + 'ab'.repeat(32),
  provenance: null,
  pendingTransfer: null,
  ...overrides,
});

const reissue = (overrides: Partial<OwnerReissue> = {}): OwnerReissue => ({
  id: REQ,
  tagId: 'tag-1',
  status: 'APPROVED',
  paymentStatus: 'AWAITING_PAYMENT',
  listAmountUsdCents: 1000,
  chargedAmount: 1000,
  chargedCurrency: 'usd',
  createdAt: '2026-10-09T09:00:00.000Z',
  reviewedAt: '2026-10-09T10:00:00.000Z',
  paidAt: null,
  fulfilledAt: null,
  newTagId: null,
  ...overrides,
});

const ownerTap = (overrides: Partial<Extract<TapResult, { valid: true }>> = {}): TapResult => ({
  valid: true,
  tagId: 'tag-1',
  lifecycleStatus: 'ACTIVE',
  provenance: null,
  tapSession: { token: SESSION, expiresAt: new Date(Date.now() + 600_000).toISOString() },
  viewer: { youOwnThis: true, canClaim: false, pendingTransferId: null },
  ...overrides,
});

const renderAt = (path: string, routePath: string, element: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={element} />
      </Routes>
    </MemoryRouter>,
  );

// ── Camera doubles (jsdom has no camera, canvas or object URLs) ─────────────

const stopTrack = vi.fn();
const installCamera = () => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
  });
  // jsdom only accepts a real MediaStream here.
  const streams = new WeakMap<object, unknown>();
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get() { return streams.get(this) ?? null; },
    set(v: unknown) { streams.set(this, v); },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'videoWidth', { configurable: true, get: () => 1920 });
  Object.defineProperty(HTMLMediaElement.prototype, 'videoHeight', { configurable: true, get: () => 1440 });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb) {
    cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
  });
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
};

beforeEach(() => {
  sessionStorage.clear();
  authState.user = { id: 'owner-1' };
  Object.values(api).forEach((fn) => fn.mockReset());
  confirmPayment.mockReset();
  stopTrack.mockReset();
  api.myReissueRequests.mockResolvedValue([]);
  api.myTokens.mockResolvedValue([ownedToken()]);
  installCamera();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── Request page ────────────────────────────────────────────────────────────

describe('ReissueRequestPage', () => {
  const renderRequest = (tokenName = 'chip_003') =>
    renderAt(`/tokens/tag-1/replace?tap=${tokenName}`, '/tokens/:tagId/replace', <ReissueRequestPage />);

  it('asks for a tap first when there is no live tap of this chip', async () => {
    renderRequest();

    expect(await screen.findByRole('heading', { name: 'Tap the chip first' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open camera/ })).not.toBeInTheDocument();
    expect(screen.getByText(/If it has already come off, we cannot replace it/)).toBeInTheDocument();
  });

  it('does not accept a tap of a different chip', async () => {
    saveTap('chip_003', ownerTap({ tagId: 'other-tag' }));
    renderRequest();

    expect(await screen.findByRole('heading', { name: 'Tap the chip first' })).toBeInTheDocument();
  });

  it('needs at least one live photo and the "still attached" confirmation, then sends tap + photo keys', async () => {
    saveTap('chip_003', ownerTap());
    api.uploadReissuePhoto.mockResolvedValue('reissue-evidence/owner-1/k1.jpg');
    api.requestReissue.mockResolvedValue({
      reissueRequestId: REQ, status: 'PENDING', listAmountUsdCents: 1000, chargedAmount: 1000, chargedCurrency: 'usd',
    });
    const user = userEvent.setup();
    renderRequest();

    const send = await screen.findByRole('button', { name: 'Send replacement request' });
    expect(send).toBeDisabled();
    // Live camera only: there is no file picker.
    expect(document.querySelector('input[type="file"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open camera' }));
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' }, audio: false });
    await user.click(await screen.findByRole('button', { name: /Take photo/ }));
    expect(await screen.findByRole('img', { name: /Photo 1 of the chip/ })).toBeInTheDocument();
    expect(send).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'The chip is still attached to the item.' }));
    expect(send).toBeEnabled();
    await user.click(send);

    expect(await screen.findByRole('heading', { name: 'Replacement requested.' })).toBeInTheDocument();
    expect(api.uploadReissuePhoto).toHaveBeenCalledTimes(1);
    expect(api.requestReissue).toHaveBeenCalledWith({
      tagId: 'tag-1', tapSession: SESSION, photoKeys: ['reissue-evidence/owner-1/k1.jpg'],
    });
    // The tap session is spent; it must not be offered again.
    expect(JSON.parse(sessionStorage.getItem('am.tap.chip_003')!).result.tapSession).toBeNull();
  });

  it('stops at three photos and closes the camera', async () => {
    saveTap('chip_003', ownerTap());
    const user = userEvent.setup();
    renderRequest();

    await user.click(await screen.findByRole('button', { name: 'Open camera' }));
    for (let i = 0; i < 3; i += 1) await user.click(await screen.findByRole('button', { name: /Take photo/ }));

    expect(screen.getAllByRole('img', { name: /of the chip on the item/ })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Take photo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open camera|Take another photo/ })).not.toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();
  });

  it('explains an expired tap', async () => {
    saveTap('chip_003', ownerTap());
    api.uploadReissuePhoto.mockResolvedValue('k1');
    api.requestReissue.mockRejectedValue(new TokenApiError('x', 400, 'invalid_argument', 'tap_session_invalid'));
    const user = userEvent.setup();
    renderRequest();

    await user.click(await screen.findByRole('button', { name: 'Open camera' }));
    await user.click(await screen.findByRole('button', { name: /Take photo/ }));
    await user.click(screen.getByRole('checkbox', { name: 'The chip is still attached to the item.' }));
    await user.click(screen.getByRole('button', { name: 'Send replacement request' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Tap the chip again/);
  });

  it('shows the open request instead of a second form', async () => {
    saveTap('chip_003', ownerTap());
    api.myReissueRequests.mockResolvedValue([reissue({ status: 'PENDING', paymentStatus: null })]);
    renderRequest();

    expect(await screen.findByRole('heading', { name: 'Replacement requested.' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send replacement request' })).not.toBeInTheDocument();
  });

  it('refuses someone who does not own the token', async () => {
    api.myTokens.mockResolvedValue([]);
    renderRequest();

    expect(await screen.findByRole('heading', { name: 'Not in your collection.' })).toBeInTheDocument();
  });
});

// ── Pay page ────────────────────────────────────────────────────────────────

describe('ReissuePayPage', () => {
  const renderPay = (query = '') =>
    renderAt(`/tokens/reissue/${REQ}/pay${query}`, '/tokens/reissue/:requestId/pay', <ReissuePayPage />);

  it('shows the fee, starts payment, and waits for the webhook before saying it is paid', { timeout: 10000 }, async () => {
    api.myReissueRequests
      .mockResolvedValueOnce([reissue()])
      .mockResolvedValue([reissue({ paymentStatus: 'PAID', paidAt: '2026-10-09T11:00:00.000Z' })]);
    api.payReissue.mockResolvedValue({
      reissueRequestId: REQ, clientSecret: 'cs_1', chargedAmount: 1000, chargedCurrency: 'usd', listAmountUsdCents: 1000,
    });
    confirmPayment.mockResolvedValue({});
    const user = userEvent.setup();
    renderPay();

    expect(await screen.findByRole('heading', { name: 'Approved. Payment needed.' })).toBeInTheDocument();
    // The currency prefix depends on the machine locale ($ or US$).
    expect(screen.getByText(/\$10\.00/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(api.payReissue).toHaveBeenCalledWith(REQ);

    await user.click(await screen.findByRole('button', { name: /^Pay (US)?\$10\.00$/ }));
    expect(confirmPayment).toHaveBeenCalledWith(expect.objectContaining({
      redirect: 'if_required',
      confirmParams: { return_url: `${window.location.origin}/tokens/reissue/${REQ}/pay` },
    }));
    expect(await screen.findByText('Confirming your payment…')).toBeInTheDocument();

    // Stripe confirming is not "paid": the page polls until the webhook has run.
    expect(screen.queryByRole('heading', { name: 'We are preparing your new chip.' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'We are preparing your new chip.' }, { timeout: 5000 })).toBeInTheDocument();
  });

  it('keeps the card form open and shows the decline', async () => {
    api.myReissueRequests.mockResolvedValue([reissue()]);
    api.payReissue.mockResolvedValue({
      reissueRequestId: REQ, clientSecret: 'cs_1', chargedAmount: 1000, chargedCurrency: 'usd', listAmountUsdCents: 1000,
    });
    confirmPayment.mockResolvedValue({ error: { message: 'Your card was declined.' } });
    const user = userEvent.setup();
    renderPay();

    await user.click(await screen.findByRole('button', { name: 'Continue to payment' }));
    await user.click(await screen.findByRole('button', { name: /^Pay (US)?\$10\.00$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.');
    expect(screen.getByRole('button', { name: /^Pay (US)?\$10\.00$/ })).toBeInTheDocument();
  });

  it('offers no payment for a request still under review', async () => {
    api.myReissueRequests.mockResolvedValue([reissue({ status: 'PENDING', paymentStatus: null })]);
    renderPay();

    expect(await screen.findByRole('heading', { name: 'Replacement requested.' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).not.toBeInTheDocument();
  });

  it('says so when the request is not on this account', async () => {
    api.myReissueRequests.mockResolvedValue([]);
    renderPay();

    expect(await screen.findByRole('heading', { name: 'Request not found.' })).toBeInTheDocument();
  });

  it('reports a failed redirect payment', async () => {
    api.myReissueRequests.mockResolvedValue([reissue()]);
    renderPay('?redirect_status=failed');

    expect(await screen.findByRole('alert')).toHaveTextContent('Your payment did not go through');
  });
});

// ── Token page section + verify page entry point ────────────────────────────

describe('ReplacementSection', () => {
  const renderSection = () => render(<MemoryRouter><ReplacementSection tagId="tag-1" lifecycleStatus="ACTIVE" /></MemoryRouter>);

  it('explains how to start when nothing is open', async () => {
    renderSection();
    expect(await screen.findByRole('heading', { name: 'Chip coming loose?' })).toBeInTheDocument();
    expect(screen.getByText(/cannot replace a chip that has already come off/)).toBeInTheDocument();
  });

  it('links to the web pay page and lets the owner cancel', async () => {
    api.myReissueRequests.mockResolvedValueOnce([reissue()]).mockResolvedValue([]);
    api.cancelReissue.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderSection();

    expect(await screen.findByRole('link', { name: 'Pay the replacement fee' })).toHaveAttribute('href', `/tokens/reissue/${REQ}/pay`);
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));

    expect(api.cancelReissue).toHaveBeenCalledWith(REQ);
    expect(await screen.findByRole('heading', { name: 'Chip coming loose?' })).toBeInTheDocument();
  });

  it('offers no cancel once paid', async () => {
    api.myReissueRequests.mockResolvedValue([reissue({ paymentStatus: 'PAID' })]);
    renderSection();

    expect(await screen.findByRole('heading', { name: 'We are preparing your new chip.' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
  });
});

describe('TokenVerifyPage entry point', () => {
  const renderVerify = () =>
    renderAt('/verify/chip_003', '/verify/:tokenName', <TokenVerifyPage />);

  it('offers "Chip coming loose?" to the signed-in owner with a live tap', async () => {
    saveTap('chip_003', ownerTap());
    renderVerify();

    const link = await screen.findByRole('link', { name: 'Request a replacement chip' });
    expect(link).toHaveAttribute('href', '/tokens/tag-1/replace?tap=chip_003');
  });

  it('does not offer it to someone who does not own the token', async () => {
    saveTap('chip_003', ownerTap({ viewer: { youOwnThis: false, canClaim: false, pendingTransferId: null } }));
    api.incomingTransfers.mockResolvedValue([]);
    renderVerify();

    await screen.findByRole('heading', { name: 'Verified.' });
    expect(screen.queryByRole('link', { name: 'Request a replacement chip' })).not.toBeInTheDocument();
  });

  it('does not offer it once the tap has expired', async () => {
    saveTap('chip_003', ownerTap({ tapSession: { token: SESSION, expiresAt: '2020-01-01T00:00:00.000Z' } }));
    renderVerify();

    await screen.findByRole('heading', { name: 'You own this.' });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Request a replacement chip' })).not.toBeInTheDocument());
  });
});
