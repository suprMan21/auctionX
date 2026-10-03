import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import type { ReactElement } from 'react';
import type {
  Provenance,
  Receipt,
  ReleaseResult,
  TransferCompleteResult,
  TransferInitiateResult,
  TransferStatus,
} from '../api/schemas';

// ── Mocks ───────────────────────────────────────────────────────────────────

const api = vi.hoisted(() => ({
  initiateTransfer: vi.fn<(input: { tagId: string; transferType: 'sale' | 'gift'; toEmail: string }) => Promise<TransferInitiateResult>>(),
  completeTransfer: vi.fn<(transferId: string, tapSession: string) => Promise<TransferCompleteResult>>(),
  transferStatus: vi.fn<(transferId: string) => Promise<TransferStatus>>(),
  release: vi.fn<(tagId: string) => Promise<ReleaseResult>>(),
  updateDisclosure: vi.fn<(tagId: string, changes: Record<string, boolean>) => Promise<Record<string, boolean>>>(),
  receipt: vi.fn<(tagId: string) => Promise<Receipt>>(),
}));

vi.mock('../api/tokenApi', async () => {
  const actual = await vi.importActual<typeof import('../api/tokenApi')>('../api/tokenApi');
  return { ...actual, tokenApi: api };
});

// Stripe is mocked at the @stripe/react-stripe-js boundary.
const stripe = vi.hoisted(() => ({ confirmPayment: vi.fn() }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => stripe,
  useElements: () => ({}),
}));
vi.mock('@/lib/stripe', () => ({
  stripePromise: Promise.resolve(null),
  stripeAppearance: {},
  isStripeConfigured: true,
  isStripeTestMode: false,
}));

const download = vi.hoisted(() => vi.fn());
vi.mock('../lib/receipt', async () => {
  const actual = await vi.importActual<typeof import('../lib/receipt')>('../lib/receipt');
  return { ...actual, downloadJson: download };
});

import { TokenApiError } from '../api/tokenApi';
import { TransferInitiateDialog } from './TransferInitiateDialog';
import { ReleaseTokenDialog } from './ReleaseTokenDialog';
import { DisclosureSettings } from './DisclosureSettings';
import { OwnershipPanel } from './OwnershipPanel';
import { TransferProcessing, POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from './TransferProcessing';
import { TransferCompleteFlow } from './TransferCompleteFlow';

// ── Fixtures ────────────────────────────────────────────────────────────────

const TAG = '11111111-1111-4111-8111-111111111111';
const TRANSFER = '22222222-2222-4222-8222-222222222222';
const SESSION = 'S'.repeat(43);
const OWNERSHIP_ID = '0x' + 'ab'.repeat(32);

const provenance: Provenance = {
  tag_id: TAG,
  lifecycle_status: 'ACTIVE',
  is_valid: true,
  claim_date: null,
  creator_name: 'Jane Maker',
  origin_video_url: null,
  origin_location: null,
  origin_date: null,
  current_ownership_id: OWNERSHIP_ID,
  enrolled_at: null,
};

const transferStatus = (status: string): TransferStatus => ({
  transferId: TRANSFER,
  tagId: TAG,
  status,
  role: 'recipient',
  transferType: 'sale',
  feePayer: 'BUYER',
  listAmountUsdCents: 250,
  chargedAmount: 345,
  chargedCurrency: 'cad',
  initiatedAt: null,
  completedAt: null,
});

const withRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

/** axe in happy-dom: structural rules only (no layout, so no colour contrast). */
const expectNoAxeViolations = async (root: Element = document.body) => {
  const results = await axe.run(root, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
};

describe('axe harness', () => {
  it('does report violations under happy-dom (so a clean run means something)', async () => {
    const { container } = render(
      <div>
        <button type="button" />
        <input type="text" />
      </div>,
    );
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual(expect.arrayContaining(['button-name', 'label']));
  });
});

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  stripe.confirmPayment.mockReset();
  download.mockReset();
});

// ── Transfer initiate ───────────────────────────────────────────────────────

describe('TransferInitiateDialog', () => {
  const renderDialog = (onStarted = vi.fn()) =>
    render(<TransferInitiateDialog isOpen tagId={TAG} onClose={vi.fn()} onStarted={onStarted} />);

  it('rejects an invalid email without calling the API', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Recipient email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Start transfer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the email address');
    expect(screen.getByLabelText('Recipient email')).toHaveAttribute('aria-invalid', 'true');
    expect(api.initiateTransfer).not.toHaveBeenCalled();
  });

  it('starts a gift with the normalised email', async () => {
    api.initiateTransfer.mockResolvedValue({ transferId: TRANSFER, status: 'PENDING', listAmountUsdCents: 250 });
    const onStarted = vi.fn();
    const user = userEvent.setup();
    renderDialog(onStarted);

    await user.click(screen.getByRole('radio', { name: /Gift/ }));
    await user.type(screen.getByLabelText('Recipient email'), '  Friend@Example.COM ');
    await user.click(screen.getByRole('button', { name: 'Start transfer' }));

    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    expect(api.initiateTransfer).toHaveBeenCalledWith({ tagId: TAG, transferType: 'gift', toEmail: 'friend@example.com' });
  });

  it('explains a transfer that is already pending', async () => {
    api.initiateTransfer.mockRejectedValue(new TokenApiError('x', 409, 'conflict', 'transfer_pending'));
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Recipient email'), 'a@b.co');
    await user.click(screen.getByRole('button', { name: 'Start transfer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A transfer of this token is already in progress.');
  });

  it('has no axe violations', async () => {
    renderDialog();
    await expectNoAxeViolations();
  });
});

// ── Release ─────────────────────────────────────────────────────────────────

describe('ReleaseTokenDialog', () => {
  const renderDialog = (onReleased = vi.fn()) =>
    render(<ReleaseTokenDialog isOpen tagId={TAG} onClose={vi.fn()} onReleased={onReleased} />);

  it('needs the warning, then the exact phrase, before it releases', async () => {
    api.release.mockResolvedValue({ tagId: TAG, lifecycleStatus: 'RELEASED', irreversible: true });
    const onReleased = vi.fn();
    const user = userEvent.setup();
    renderDialog(onReleased);

    expect(screen.queryByRole('button', { name: 'Release forever' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I understand, continue' }));

    const submit = screen.getByRole('button', { name: 'Release forever' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/Type RELEASE/), 'release');
    expect(submit).toBeDisabled();

    await user.clear(screen.getByLabelText(/Type RELEASE/));
    await user.type(screen.getByLabelText(/Type RELEASE/), 'RELEASE');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(onReleased).toHaveBeenCalled());
    expect(api.release).toHaveBeenCalledWith(TAG);
  });

  it('cannot be bypassed with the keyboard', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'I understand, continue' }));
    const input = screen.getByLabelText(/Type RELEASE/);
    await user.type(input, 'RELEAS{Enter}');
    await user.keyboard('{Tab}{Enter}');
    await user.type(input, ' {Enter}');

    expect(api.release).not.toHaveBeenCalled();
  });

  it('explains a release blocked by a pending transfer', async () => {
    api.release.mockRejectedValue(new TokenApiError('x', 409, 'conflict', 'transfer_pending'));
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'I understand, continue' }));
    await user.type(screen.getByLabelText(/Type RELEASE/), 'RELEASE{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Cancel the pending transfer');
  });

  it('has no axe violations on either step', async () => {
    const user = userEvent.setup();
    renderDialog();
    await expectNoAxeViolations();
    await user.click(screen.getByRole('button', { name: 'I understand, continue' }));
    await expectNoAxeViolations();
  });
});

// ── Disclosure ──────────────────────────────────────────────────────────────

describe('DisclosureSettings', () => {
  const renderSettings = (onSaved = vi.fn()) =>
    render(
      <DisclosureSettings
        tagId={TAG}
        disclosure={{ creator_name: true }}
        provenance={provenance}
        onSaved={onSaved}
      />,
    );

  it('previews the change live and saves only what changed', async () => {
    api.updateDisclosure.mockResolvedValue({ creator_name: false, location: true });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderSettings(onSaved);

    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    expect(screen.getByText('Jane Maker')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Creator name' }));
    await user.click(screen.getByRole('switch', { name: 'Origin location' }));
    expect(screen.queryByText('Jane Maker')).not.toBeInTheDocument();
    expect(screen.getByText('Shown if the creator released it')).toBeInTheDocument();

    await user.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ creator_name: false, location: true }));
    expect(api.updateDisclosure).toHaveBeenCalledWith(TAG, { creator_name: false, location: true });
  });

  it('shows a save error', async () => {
    api.updateDisclosure.mockRejectedValue(new TokenApiError('This token has been released and is no longer valid', 400, 'failed_precondition', 'token_released'));
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('switch', { name: 'Claim date' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('released');
  });

  it('has no axe violations', async () => {
    const { container } = renderSettings();
    await expectNoAxeViolations(container);
  });
});

// ── Ownership + Receipt ─────────────────────────────────────────────────────

describe('OwnershipPanel', () => {
  it('downloads the Receipt built from the receipt endpoint', async () => {
    const receipt: Receipt = {
      ownershipId: OWNERSHIP_ID,
      ownershipEventId: '33333333-3333-4333-8333-333333333333',
      ownershipEventType: 'CLAIM',
      tagRef: 'am:tag:1',
      saltHex: 'cd'.repeat(32),
      issuedAt: '2026-10-03T00:00:00.000Z',
      algorithm: { hash: 'keccak256', preimage: 'p' },
    };
    api.receipt.mockResolvedValue(receipt);
    const user = userEvent.setup();
    withRouter(<OwnershipPanel tagId={TAG} ownershipId={OWNERSHIP_ID} />);

    expect(screen.getByRole('link', { name: 'Open public lookup' })).toHaveAttribute('href', `/ownership/${OWNERSHIP_ID}`);
    await user.click(screen.getByRole('button', { name: 'Download Receipt' }));

    expect(await screen.findByText('Receipt downloaded.')).toBeInTheDocument();
    const [fileName, doc] = download.mock.calls[0] as [string, Record<string, unknown>];
    expect(fileName).toBe('ownership-receipt-0xabababab.json');
    expect(doc).toMatchObject({ kind: 'authentic-materials.ownership-receipt', tagId: TAG, saltHex: receipt.saltHex });
  });

  it('reports a failed Receipt request', async () => {
    api.receipt.mockRejectedValue(new TokenApiError('Not found', 404, 'not_found', null));
    const user = userEvent.setup();
    withRouter(<OwnershipPanel tagId={TAG} ownershipId={OWNERSHIP_ID} />);

    await user.click(screen.getByRole('button', { name: 'Download Receipt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found');
    expect(download).not.toHaveBeenCalled();
  });
});

// ── Processing (polling) ────────────────────────────────────────────────────

describe('TransferProcessing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const flush = () => act(async () => {
    await Promise.resolve();
  });

  it('polls until COMPLETED, then stops', async () => {
    api.transferStatus
      .mockResolvedValueOnce(transferStatus('PENDING'))
      .mockResolvedValueOnce(transferStatus('PENDING'))
      .mockResolvedValue(transferStatus('COMPLETED'));
    const onCompleted = vi.fn();
    withRouter(<TransferProcessing transferId={TRANSFER} tagId={TAG} onCompleted={onCompleted} />);

    await flush();
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));

    expect(screen.getByText('It is yours.')).toBeInTheDocument();
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(api.transferStatus).toHaveBeenCalledTimes(3);

    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5));
    expect(api.transferStatus).toHaveBeenCalledTimes(3);
  });

  it('gives up after the timeout with a calm message', async () => {
    api.transferStatus.mockResolvedValue(transferStatus('PENDING'));
    withRouter(<TransferProcessing transferId={TRANSFER} tagId={TAG} />);

    await act(() => vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + POLL_INTERVAL_MS));
    expect(screen.getByText('Still finishing up.')).toBeInTheDocument();

    const calls = api.transferStatus.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5));
    expect(api.transferStatus).toHaveBeenCalledTimes(calls);
  });

  it('stops on a cancelled transfer', async () => {
    api.transferStatus.mockResolvedValue(transferStatus('CANCELLED'));
    withRouter(<TransferProcessing transferId={TRANSFER} tagId={TAG} />);

    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('The sender cancelled it.');
  });

  it('stops polling when unmounted', async () => {
    api.transferStatus.mockResolvedValue(transferStatus('PENDING'));
    const { unmount } = withRouter(<TransferProcessing transferId={TRANSFER} tagId={TAG} />);
    await flush();
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5));
    expect(api.transferStatus).toHaveBeenCalledTimes(1);
  });
});

// ── Accept + pay ────────────────────────────────────────────────────────────

describe('TransferCompleteFlow', () => {
  const charge: TransferCompleteResult = {
    transferId: TRANSFER,
    status: 'PENDING',
    clientSecret: 'pi_123_secret_456',
    listAmountUsdCents: 250,
    chargedAmount: 345,
    chargedCurrency: 'cad',
    fxRate: 1.38,
  };

  const renderFlow = (tapSession: string | null = SESSION, onSessionSpent = vi.fn()) =>
    withRouter(
      <TransferCompleteFlow transferId={TRANSFER} tagId={TAG} tapSession={tapSession} onSessionSpent={onSessionSpent} />,
    );

  it('asks for a fresh tap when the session is gone', () => {
    renderFlow(null);
    expect(screen.getByText(/Your tap has expired/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the server-charged amount, pays, then waits for the webhook', async () => {
    api.completeTransfer.mockResolvedValue(charge);
    api.transferStatus.mockResolvedValue(transferStatus('COMPLETED'));
    stripe.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    const onSessionSpent = vi.fn();
    const user = userEvent.setup();
    renderFlow(SESSION, onSessionSpent);

    await user.click(screen.getByRole('button', { name: 'Accept and continue to payment' }));
    expect(api.completeTransfer).toHaveBeenCalledWith(TRANSFER, SESSION);
    expect(onSessionSpent).toHaveBeenCalled();

    const amount = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'CAD' }).format(3.45);
    expect(await screen.findByText(amount)).toBeInTheDocument();
    expect(screen.getByTestId('payment-element')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `Pay ${amount}` }));
    expect(stripe.confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        redirect: 'if_required',
        confirmParams: { return_url: `${window.location.origin}/tokens?transfer=${TRANSFER}` },
      }),
    );
    expect(await screen.findByText('It is yours.')).toBeInTheDocument();
  });

  it('keeps the form after a declined card', async () => {
    api.completeTransfer.mockResolvedValue(charge);
    stripe.confirmPayment.mockResolvedValue({ error: { message: 'Your card was declined.' } });
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole('button', { name: 'Accept and continue to payment' }));
    await user.click(await screen.findByRole('button', { name: /^Pay / }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.');
    expect(screen.getByRole('button', { name: /^Pay / })).toBeEnabled();
    expect(api.transferStatus).not.toHaveBeenCalled();
  });

  it('explains a refused accept and spends the session', async () => {
    api.completeTransfer.mockRejectedValue(new TokenApiError('Forbidden', 403, 'permission_denied', null));
    const onSessionSpent = vi.fn();
    const user = userEvent.setup();
    renderFlow(SESSION, onSessionSpent);

    await user.click(screen.getByRole('button', { name: 'Accept and continue to payment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('belongs to a different account');
    expect(onSessionSpent).toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = renderFlow();
    await expectNoAxeViolations(container);
  });
});
