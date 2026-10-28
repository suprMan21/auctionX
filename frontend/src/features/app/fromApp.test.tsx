/**
 * S-MOB1 Phase B: the `from=app` flag and the one link back into the app.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  APP_OPEN_PATH,
  appOpenHref,
  appOpenOrigin,
  DEFAULT_APP_OPEN_ORIGIN,
  captureFromApp,
  clearFromApp,
  hasFromAppParam,
  isFromApp,
  withFromApp,
} from './fromApp';
import { FromAppCapture, OpenAppButton } from './OpenAppButton';
import { AppOpenPage } from '@/pages/AppOpenPage';

// ── Mocks for the finish screens ──
const authState = vi.hoisted(() => ({
  user: null as null | { email: string; user_metadata: Record<string, unknown> },
  session: null as null | object,
  signUp: vi.fn(),
  resetPassword: vi.fn(),
}));
vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({
    user: authState.user,
    session: authState.session,
    initialized: true,
    loading: false,
    error: null,
    clearError: vi.fn(),
    signUp: authState.signUp,
    resetPassword: authState.resetPassword,
  }),
}));

const storeSession = vi.hoisted(() => ({ value: null as null | object }));
vi.mock('@/features/auth/store/authStore', () => ({
  useAuthStore: { getState: () => ({ session: storeSession.value }) },
}));

const supabaseSession = vi.hoisted(() => ({ value: null as null | { user: { email: string } } }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: supabaseSession.value } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  },
}));

// The reset form: one button that finishes.
vi.mock('@/features/security/components/ChangePasswordForm', () => ({
  ChangePasswordForm: ({ onDone }: { onDone: () => void }) => (
    <button type="button" onClick={onDone}>Save password</button>
  ),
}));

const verification = vi.hoisted(() => ({
  getStatus: vi.fn(),
  requestCreator: vi.fn(),
  startVerification: vi.fn(),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, verification } };
});

import { SignupPage } from '@/features/auth/pages/SignupPage';
import { EmailConfirmedPage } from '@/features/auth/pages/EmailConfirmedPage';
import { ForgotPasswordPage } from '@/features/auth/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage';
import { AccountTypePage } from '@/features/profile/pages/AccountTypePage';

const APP_BUTTON = /open the authentic materials app/i;

const at = (url: string, element: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <FromAppCapture />
      <Routes>
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  clearFromApp();
  vi.clearAllMocks();
  authState.user = null;
  authState.session = null;
  storeSession.value = null;
  supabaseSession.value = null;
});

afterEach(() => clearFromApp());

describe('fromApp flag', () => {
  it('accepts only exactly from=app', () => {
    expect(hasFromAppParam('?from=app')).toBe(true);
    expect(hasFromAppParam('?x=1&from=app')).toBe(true);
    expect(hasFromAppParam('?from=APP')).toBe(false);
    expect(hasFromAppParam('?from=app2')).toBe(false);
    expect(hasFromAppParam('?from=')).toBe(false);
    expect(hasFromAppParam('?fromapp')).toBe(false);
    expect(hasFromAppParam('')).toBe(false);
  });

  it('remembers the flag for the tab and clears it', () => {
    expect(isFromApp('')).toBe(false);
    expect(captureFromApp('?from=web')).toBe(false);
    expect(isFromApp('')).toBe(false);
    expect(captureFromApp('?from=app')).toBe(true);
    expect(window.sessionStorage.getItem('am.fromApp')).toBe('1');
    expect(isFromApp('')).toBe(true);
    clearFromApp();
    expect(isFromApp('')).toBe(false);
    expect(window.sessionStorage.getItem('am.fromApp')).toBeNull();
  });

  it('still works when storage is blocked', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(captureFromApp('?from=app')).toBe(true);
    expect(isFromApp('')).toBe(true);
    get.mockRestore();
    set.mockRestore();
  });

  it('adds the fixed flag to a path only when flagged', () => {
    expect(withFromApp('/reset-password', false)).toBe('/reset-password');
    expect(withFromApp('/reset-password', true)).toBe('/reset-password?from=app');
    expect(withFromApp('https://x.test/a?returned=1', true)).toBe('https://x.test/a?returned=1&from=app');
    expect(withFromApp('/a#h', true)).toBe('/a?from=app#h');
  });
});

describe('appOpenHref', () => {
  it('is the fixed path, with only a valid email hint', () => {
    expect(appOpenHref()).toBe(`${DEFAULT_APP_OPEN_ORIGIN}${APP_OPEN_PATH}`);
    expect(appOpenHref(null)).toBe('https://authentic-materials.com/app/open');
    expect(appOpenHref('test@authentic-materials.com')).toBe('https://authentic-materials.com/app/open?email=test%40authentic-materials.com');
    expect(appOpenHref('not an email')).toBe('https://authentic-materials.com/app/open');
    expect(appOpenHref('a@b.co&next=https://evil.com')).toBe('https://authentic-materials.com/app/open');
    expect(appOpenHref('//evil.com/@x.y')).toBe('https://authentic-materials.com/app/open');
    expect(appOpenHref(`${'a'.repeat(250)}@b.co`)).toBe('https://authentic-materials.com/app/open');
  });
});

describe('OpenAppButton', () => {
  it('is hidden without the flag', () => {
    at('/register', <OpenAppButton email="a@b.co" />);
    expect(screen.queryByRole('link', { name: APP_BUTTON })).toBeNull();
  });

  it.each([
    '/x?from=app&next=https://evil.com',
    '/x?from=app&open=//evil.com',
    '/x?from=app&email=attacker@evil.com',
    '/x?from=app&redirect=javascript:alert(1)',
  ])('points at /app/open whatever else the URL says (%s)', (url) => {
    at(url, <OpenAppButton email="me@example.com" />);
    expect(screen.getByRole('link', { name: APP_BUTTON }).getAttribute('href')).toBe('https://authentic-materials.com/app/open?email=me%40example.com');
  });

  it('uses the flag remembered from an earlier page', () => {
    captureFromApp('?from=app');
    at('/settings/account-type', <OpenAppButton />);
    expect(screen.getByRole('link', { name: APP_BUTTON }).getAttribute('href')).toBe('https://authentic-materials.com/app/open');
  });
});

describe('appOpenOrigin', () => {
  it('uses an https origin from config, else the public site', () => {
    expect(appOpenOrigin(undefined)).toBe(DEFAULT_APP_OPEN_ORIGIN);
    expect(appOpenOrigin('https://app.example.com')).toBe('https://app.example.com');
    expect(appOpenOrigin('https://app.example.com/')).toBe('https://app.example.com');
    expect(appOpenOrigin('http://app.example.com')).toBe(DEFAULT_APP_OPEN_ORIGIN);
    expect(appOpenOrigin('https://app.example.com/evil')).toBe(DEFAULT_APP_OPEN_ORIGIN);
    expect(appOpenOrigin('javascript:alert(1)')).toBe(DEFAULT_APP_OPEN_ORIGIN);
    expect(appOpenOrigin('not a url')).toBe(DEFAULT_APP_OPEN_ORIGIN);
  });
  it('the link back is on another domain than the staging site (universal links need that)', () => {
    expect(new URL(appOpenHref()).host).not.toBe('d1bwev65w7rqzl.cloudfront.net');
  });
});

describe('/app/open page', () => {
  it('renders with no network call and no redirect', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    at('/app/open', <AppOpenPage />);
    expect(screen.getByRole('heading', { name: /opening the app/i })).toBeTruthy();
    expect(screen.getByText(/ask authentic materials for a tester invite/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('shows tester links only when given https URLs', () => {
    at('/app/open', <AppOpenPage testFlightUrl="https://testflight.apple.com/join/abc" playTestingUrl="http://insecure.example" />);
    expect(screen.getByRole('link', { name: /iphone/i }).getAttribute('href')).toBe('https://testflight.apple.com/join/abc');
    expect(screen.queryByRole('link', { name: /android/i })).toBeNull();
  });
});

describe('finish screens', () => {
  it('sign-up from the app with email confirmation shows Check your email (no app button yet)', async () => {
    authState.signUp.mockResolvedValue(undefined);
    at('/register?from=app', <SignupPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email address/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'secret123');
    await user.type(screen.getByLabelText(/confirm password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /sign up/i }));
    expect(await screen.findByRole('heading', { name: /check your email/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: APP_BUTTON })).toBeNull();
  });

  it('email confirmed: app button only with the flag', () => {
    authState.user = { email: 'new@example.com', user_metadata: { account_intent: 'creator' } };
    const { unmount } = at('/register/confirmed', <EmailConfirmedPage />);
    expect(screen.queryByRole('link', { name: APP_BUTTON })).toBeNull();
    unmount();
    at('/register/confirmed?from=app', <EmailConfirmedPage />);
    expect(screen.getByRole('link', { name: APP_BUTTON }).getAttribute('href')).toBe('https://authentic-materials.com/app/open?email=new%40example.com');
    expect(screen.getByRole('link', { name: /become a creator/i }).getAttribute('href')).toBe('/settings/account-type');
  });

  it('forgot password sent: no app button either way', async () => {
    authState.resetPassword.mockResolvedValue(undefined);
    at('/forgot-password?from=app', <ForgotPasswordPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email address/i), 'me@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(await screen.findByText(/open the link on this phone/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: APP_BUTTON })).toBeNull();
  });

  it.each([
    ['/reset-password', false],
    ['/reset-password?from=app', true],
  ])('password reset done at %s: app button %s', async (url, shown) => {
    supabaseSession.value = { user: { email: 'me@example.com' } };
    at(url, <ResetPasswordPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /save password/i }));
    await screen.findByText(/new password is set/i);
    const link = screen.queryByRole('link', { name: APP_BUTTON });
    if (shown) {
      await waitFor(() => expect(link?.getAttribute('href')).toBe('https://authentic-materials.com/app/open?email=me%40example.com'));
    } else {
      expect(link).toBeNull();
    }
  });

  it.each([
    [false, 0],
    [true, 1],
  ])('account type: creator view shows the app button only when flagged (flag %s)', async (flag, count) => {
    authState.user = { email: 'me@example.com', user_metadata: {} };
    verification.getStatus.mockResolvedValue({
      seller_verification_status: 'VERIFIED',
      feature_enabled: true,
      account_type: 'creator',
      creator_requested_at: '2026-10-27T12:00:00Z',
    });
    at(flag ? '/settings/account-type?from=app' : '/settings/account-type', <AccountTypePage />);
    await screen.findByRole('heading', { name: /you're a creator/i });
    expect(screen.queryAllByRole('link', { name: APP_BUTTON })).toHaveLength(count);
  });

  it('account type: the identity check return URL keeps the flag', async () => {
    verification.getStatus.mockResolvedValue({
      seller_verification_status: 'NONE',
      feature_enabled: true,
      account_type: 'collector',
      creator_requested_at: null,
    });
    verification.requestCreator.mockResolvedValue(undefined);
    verification.startVerification.mockResolvedValue({ session_url: 'https://yoti.test/s' });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign, origin: 'https://am.test', search: '' } });
    try {
      at('/settings/account-type?from=app', <AccountTypePage />);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /become a creator/i }));
      await waitFor(() => expect(verification.startVerification).toHaveBeenCalled());
      expect(verification.startVerification.mock.calls[0][1]).toBe('https://am.test/settings/account-type?returned=1&from=app');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
