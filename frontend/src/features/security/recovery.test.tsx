import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { MfaStatus } from './api/mfaApi';

/**
 * S-2FA Ph3b screens: /sign-in/recover and the recovery / backup-email parts of
 * Security settings. The server enforces every rule (backend mfaRecovery.test.ts);
 * these check what the screens offer and send.
 */

const mfa = vi.hoisted(() => ({
  status: vi.fn(),
  recoveryOverview: vi.fn(),
  sendRecoveryCode: vi.fn(),
  startRecovery: vi.fn(),
  finishRecovery: vi.fn(),
  cancelRecovery: vi.fn(),
  undoRecovery: vi.fn(),
  addBackupEmail: vi.fn(),
  verifyBackupEmail: vi.fn(),
  removeBackupEmail: vi.fn(),
  stepUpOptions: vi.fn(),
}));
vi.mock('./api/mfaApi', async () => {
  const actual = await vi.importActual<typeof import('./api/mfaApi')>('./api/mfaApi');
  return { ...actual, mfaApi: { ...actual.mfaApi, ...mfa } };
});

const sb = vi.hoisted(() => ({ updateUser: vi.fn(), reauthenticate: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { ...sb, getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } },
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({
    session: { access_token: 'h.e30.s', user: { id: 'u1' } },
    initialized: true,
    signOut: vi.fn(),
  }),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { allowedStepUpMethods } from './lib/stepUp';
import { recoveryNonce } from './api/mfaApi';
import { useMfaStore } from './store/mfaStore';
import { RecoveryPage } from './pages/RecoveryPage';
import { SecurityPage } from './pages/SecurityPage';

const baseStatus = (over: Partial<MfaStatus> = {}): MfaStatus => ({
  passkeys: [{ id: 'pk-1', nickname: 'My iPhone', synced: true, createdAt: '2026-10-27T12:00:00Z', lastUsedAt: null, usableFrom: null, fromRecovery: false }],
  authenticatorApp: false,
  authenticatorAppUsableFrom: null,
  backupCodesLeft: 10,
  hasFactor: true,
  sessionVerified: true,
  enrolmentRequired: false,
  secondFactorRequired: false,
  breakGlass: false,
  isStaff: false,
  codeEntryLockedUntil: null,
  backupEmail: null,
  recovery: null,
  ...over,
});

const seed = (status: MfaStatus) => {
  useMfaStore.setState({ sessionKey: 'u1', status, state: 'ready' });
  mfa.status.mockResolvedValue(status);
};

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const RID = '99999999-9999-4999-8999-999999999999';
const CODE_ID = '88888888-8888-4888-8888-888888888888';

beforeEach(() => {
  vi.clearAllMocks();
  useMfaStore.getState().clear();
  try { window.localStorage.clear(); } catch { /* ignore */ }
});

describe('rules', () => {
  it('undo: passkey or authenticator app, never a backup code; backup email like sign-in methods', () => {
    expect(allowedStepUpMethods('recovery_undo', false)).toEqual(['passkey', 'totp']);
    expect(allowedStepUpMethods('recovery_channel', false)).toEqual(['passkey', 'totp', 'recovery_code']);
  });

  it('the browser nonce is random, URL-safe and stable', () => {
    const a = recoveryNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(recoveryNonce()).toBe(a);
  });
});

describe('/sign-in/recover', () => {
  const renderPage = () => render(<MemoryRouter><RecoveryPage /></MemoryRouter>);

  it('start: choose an address, type the code, see the 3-day wait', async () => {
    seed(baseStatus({ sessionVerified: false }));
    mfa.recoveryOverview.mockResolvedValue({
      available: true, notAvailableReason: null, recovery: null,
      channels: [{ channel: 'primary', sentTo: 'u•••@e•••.com' }, { channel: 'backup', sentTo: 'b•••@e•••.org' }],
    });
    mfa.sendRecoveryCode.mockResolvedValue({ codeId: CODE_ID, purpose: 'recovery_start', sentTo: 'b•••@e•••.org', expiresAt: inDays(0.01), resendAfter: null });
    mfa.startRecovery.mockResolvedValue({ status: 'holding', holdEndsAt: inDays(3), channel: 'backup' });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('radio', { name: /b•••@e•••.org/ }));
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(mfa.sendRecoveryCode).toHaveBeenCalledWith('backup');
    const input = await screen.findByLabelText(/Code sent to b•••@e•••.org/);
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    await user.type(input, '123456');
    await user.click(screen.getByRole('button', { name: 'Start recovery' }));
    expect(mfa.startRecovery).toHaveBeenCalledWith(CODE_ID, '123456');
    expect(await screen.findByText('Recovery started.')).toBeInTheDocument();
  });

  it('staff: explains instead of offering a code', async () => {
    seed(baseStatus({ sessionVerified: false, isStaff: true }));
    mfa.recoveryOverview.mockResolvedValue({ available: false, notAvailableReason: 'staff', recovery: null, channels: [] });
    renderPage();
    expect(await screen.findByText(/Staff accounts can’t be recovered by email/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email me a code' })).toBeNull();
  });

  it('waiting: shows when it can finish, no code button', async () => {
    seed(baseStatus({ sessionVerified: false }));
    mfa.recoveryOverview.mockResolvedValue({
      available: true, notAvailableReason: null, channels: [{ channel: 'primary', sentTo: 'u•••@e•••.com' }],
      recovery: { status: 'holding', holdEndsAt: inDays(2), ready: false, channel: 'primary' },
    });
    renderPage();
    expect(await screen.findByText('Recovery started.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email me a code' })).toBeNull();
  });

  it('finish with a new password: permit asked for, password saved, then add a method', async () => {
    seed(baseStatus({ sessionVerified: false }));
    mfa.recoveryOverview.mockResolvedValue({
      available: true, notAvailableReason: null, channels: [{ channel: 'primary', sentTo: 'u•••@e•••.com' }],
      recovery: { status: 'holding', holdEndsAt: inDays(-0.01), ready: true, channel: 'primary' },
    });
    mfa.sendRecoveryCode.mockResolvedValue({ codeId: CODE_ID, purpose: 'recovery_finish', sentTo: 'u•••@e•••.com', expiresAt: inDays(0.01), resendAfter: null });
    mfa.finishRecovery.mockResolvedValue({ status: 'completed', freezeEndsAt: inDays(7), addMethodBefore: inDays(0.02), passwordPermitExpiresAt: inDays(0.001) });
    sb.updateUser.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText('New password (optional)'), 'a-new-long-password');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(mfa.sendRecoveryCode).toHaveBeenCalledWith(undefined);
    await user.type(await screen.findByLabelText(/Code sent to/), '654321');
    await user.click(screen.getByRole('button', { name: 'Finish recovery' }));
    expect(mfa.finishRecovery).toHaveBeenCalledWith(CODE_ID, '654321', true);
    await waitFor(() => expect(sb.updateUser).toHaveBeenCalledWith({ password: 'a-new-long-password' }));
    expect(await screen.findByText('Your account is recovered.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add passkey' })).toBeInTheDocument();
  });

  it('a wrong code shows plain copy', async () => {
    seed(baseStatus({ sessionVerified: false }));
    mfa.recoveryOverview.mockResolvedValue({ available: true, notAvailableReason: null, recovery: null, channels: [{ channel: 'primary', sentTo: 'u•••@e•••.com' }] });
    mfa.sendRecoveryCode.mockResolvedValue({ codeId: CODE_ID, purpose: 'recovery_start', sentTo: 'u•••@e•••.com', expiresAt: inDays(0.01), resendAfter: null });
    const { MfaApiError } = await import('./api/mfaApi');
    mfa.startRecovery.mockRejectedValue(new MfaApiError('x', 400, 'invalid_argument', 'code_locked'));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Email me a code' }));
    await user.type(await screen.findByLabelText(/Code sent to/), '111111');
    await user.click(screen.getByRole('button', { name: 'Start recovery' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries. Ask for a new code.');
  });
});

describe('Security settings', () => {
  const renderPage = () => render(<MemoryRouter><SecurityPage /></MemoryRouter>);

  it('a waiting recovery: red notice with Cancel', async () => {
    seed(baseStatus({ recovery: { id: RID, status: 'holding', holdEndsAt: inDays(2), freezeEndsAt: null, mustAddMethod: false, addMethodBefore: null, canUndo: false } }));
    mfa.cancelRecovery.mockResolvedValue({ cancelled: RID });
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByText(/Someone started recovering this account/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel recovery' }));
    expect(mfa.cancelRecovery).toHaveBeenCalled();
  });

  it('frozen: changes disabled, Undo offered when allowed', async () => {
    seed(baseStatus({ recovery: { id: RID, status: 'completed', holdEndsAt: null, freezeEndsAt: inDays(6), mustAddMethod: false, addMethodBefore: null, canUndo: true } }));
    renderPage();
    expect(screen.getByText(/This account was recovered by email/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo recovery' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add a passkey' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Make new backup codes' })).toBeDisabled();
  });

  it('frozen without an old method: no Undo button', () => {
    seed(baseStatus({ recovery: { id: RID, status: 'completed', holdEndsAt: null, freezeEndsAt: inDays(6), mustAddMethod: false, addMethodBefore: null, canUndo: false } }));
    renderPage();
    expect(screen.queryByRole('button', { name: 'Undo recovery' })).toBeNull();
  });

  it('just recovered: may add its one method without a step-up', async () => {
    seed(baseStatus({ recovery: { id: RID, status: 'completed', holdEndsAt: null, freezeEndsAt: inDays(7), mustAddMethod: true, addMethodBefore: inDays(0.02), canUndo: false } }));
    renderPage();
    expect(screen.getByText(/Your account is recovered/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a passkey' })).toBeEnabled();
  });

  it('backup email: masked only, hidden for staff', () => {
    seed(baseStatus({ backupEmail: { masked: 'b•••@e•••.org', verified: true } }));
    const { unmount } = renderPage();
    expect(screen.getByRole('heading', { name: 'Backup email' })).toBeInTheDocument();
    expect(screen.getByText(/b•••@e•••.org/)).toBeInTheDocument();
    unmount();
    seed(baseStatus({ isStaff: true }));
    renderPage();
    expect(screen.queryByRole('heading', { name: 'Backup email' })).toBeNull();
  });
});
