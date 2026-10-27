/**
 * Account types (2026-10-27): the sign-up choice and the Account type page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { YotiStatus } from '@/lib/api';

const verification = vi.hoisted(() => ({
  getStatus: vi.fn(),
  requestCreator: vi.fn(),
  startVerification: vi.fn(),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, verification } };
});

const auth = vi.hoisted(() => ({ signUp: vi.fn() }));
vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({
    signUp: auth.signUp, loading: false, error: null, clearError: vi.fn(), user: null, initialized: true,
  }),
}));

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

import { AccountTypePage, viewFor } from './AccountTypePage';
import { SignupPage } from '@/features/auth/pages/SignupPage';

const status = (overrides: Partial<YotiStatus> = {}): YotiStatus => ({
  seller_verification_status: 'NONE',
  submitted_at: null,
  reviewed_at: null,
  rejection_reason: null,
  age_verified: false,
  age_verified_at: null,
  age_verification_provider: null,
  last_session: null,
  feature_enabled: true,
  account_type: 'collector',
  creator_requested_at: null,
  ...overrides,
} as YotiStatus);

const REQ = '2026-10-27T12:00:00Z';

const renderPage = (url = '/settings/account-type') =>
  render(<MemoryRouter initialEntries={[url]}><AccountTypePage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('viewFor', () => {
  it.each([
    [status({ account_type: 'creator', creator_requested_at: REQ, seller_verification_status: 'VERIFIED' }), 'creator'],
    [status(), 'collector'],
    [status({ seller_verification_status: 'VERIFIED' }), 'collector'], // verified for another purpose, never asked
    [status({ creator_requested_at: REQ }), 'request_saved'],
    [status({ creator_requested_at: REQ, seller_verification_status: 'PENDING' }), 'checking'],
    [status({ creator_requested_at: REQ, seller_verification_status: 'REJECTED' }), 'rejected'],
    [status({ creator_requested_at: REQ, seller_verification_status: 'REVOKED' }), 'blocked'],
    [status({ creator_requested_at: REQ, seller_verification_status: 'FLAGGED' }), 'blocked'],
  ])('%#', (s, view) => {
    expect(viewFor(s)).toBe(view);
  });
});

describe('Account type page', () => {
  it('a creator sees that they are a creator, with no button', async () => {
    verification.getStatus.mockResolvedValue(status({ account_type: 'creator', creator_requested_at: REQ, seller_verification_status: 'VERIFIED' }));
    renderPage();
    expect(await screen.findByRole('heading', { name: "You're a creator" })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('Become a creator saves the request, then starts the identity check and returns here', async () => {
    verification.getStatus.mockResolvedValue(status());
    verification.requestCreator.mockResolvedValue(undefined);
    verification.startVerification.mockResolvedValue({ session_url: 'https://yoti.example/session' });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, origin: 'https://am.test' });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Become a creator' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://yoti.example/session'));
    expect(verification.requestCreator).toHaveBeenCalledTimes(1);
    expect(verification.startVerification).toHaveBeenCalledWith('seller_kyc', 'https://am.test/settings/account-type?returned=1');
    vi.unstubAllGlobals();
  });

  it('already verified for another purpose: becomes a creator with no second check', async () => {
    verification.getStatus
      .mockResolvedValueOnce(status({ seller_verification_status: 'VERIFIED' }))
      .mockResolvedValueOnce(status({ seller_verification_status: 'VERIFIED', creator_requested_at: REQ, account_type: 'creator' }));
    verification.requestCreator.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Become a creator' }));
    expect(await screen.findByRole('heading', { name: "You're a creator" })).toBeInTheDocument();
    expect(verification.startVerification).not.toHaveBeenCalled();
  });

  it('checks switched off: the request is saved and no check starts', async () => {
    verification.getStatus
      .mockResolvedValueOnce(status({ feature_enabled: false }))
      .mockResolvedValueOnce(status({ feature_enabled: false, creator_requested_at: REQ }));
    verification.requestCreator.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Become a creator' }));
    expect(await screen.findByText("Identity checks open soon. We've kept your request.")).toBeInTheDocument();
    expect(verification.startVerification).not.toHaveBeenCalled();
  });

  it('the check cannot start: says the request is saved', async () => {
    verification.getStatus.mockResolvedValue(status({ creator_requested_at: REQ }));
    verification.requestCreator.mockResolvedValue(undefined);
    verification.startVerification.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Verify my identity' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Your request is saved, but the identity check couldn't start.");
  });

  it('back from the check: waits for the result and shows creator', async () => {
    verification.getStatus
      .mockResolvedValueOnce(status({ creator_requested_at: REQ, seller_verification_status: 'PENDING' }))
      .mockResolvedValue(status({ creator_requested_at: REQ, seller_verification_status: 'VERIFIED', account_type: 'creator' }));
    renderPage('/settings/account-type?returned=1');
    expect(await screen.findByRole('heading', { name: "We're checking your identity" })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: "You're a creator" }, { timeout: 4000 })).toBeInTheDocument();
  });

  it('a revoked check points to support, with no retry', async () => {
    verification.getStatus.mockResolvedValue(status({ creator_requested_at: REQ, seller_verification_status: 'REVOKED' }));
    renderPage();
    expect(await screen.findByRole('link', { name: 'hello@authentic-materials.com' })).toHaveAttribute('href', 'mailto:hello@authentic-materials.com');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Sign-up choice', () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText('Email Address'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.type(screen.getByLabelText('Confirm Password'), 'secret123');
  };

  it('defaults to collector and lands on the profile', async () => {
    auth.signUp.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<MemoryRouter><SignupPage /></MemoryRouter>);
    expect(screen.getByRole('radio', { name: /A collector/ })).toBeChecked();
    expect(screen.queryByText(/bidding/i)).not.toBeInTheDocument();
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Sign Up' }));
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledWith('new@example.com', 'secret123', 'collector'));
    expect(navigate).toHaveBeenCalledWith('/profile');
  });

  it('creator choice is sent with sign-up and goes straight to the identity check page', async () => {
    auth.signUp.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<MemoryRouter><SignupPage /></MemoryRouter>);
    await user.click(screen.getByRole('radio', { name: /A creator/ }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Sign Up' }));
    await waitFor(() => expect(auth.signUp).toHaveBeenCalledWith('new@example.com', 'secret123', 'creator'));
    expect(navigate).toHaveBeenCalledWith('/settings/account-type');
  });
});
