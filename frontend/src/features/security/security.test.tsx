import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { MfaStatus } from './api/mfaApi';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mfa = vi.hoisted(() => ({
  status: vi.fn(),
  stepUpOptions: vi.fn(),
  stepUpVerifyPasskey: vi.fn(),
  stepUpVerifyCode: vi.fn(),
  accountChangePermit: vi.fn(),
}));
vi.mock('./api/mfaApi', async () => {
  const actual = await vi.importActual<typeof import('./api/mfaApi')>('./api/mfaApi');
  return { ...actual, mfaApi: { ...actual.mfaApi, ...mfa } };
});

const tokens = vi.hoisted(() => ({ release: vi.fn(), completeTransfer: vi.fn() }));
vi.mock('@/features/tokens/api/tokenApi', async () => {
  const actual = await vi.importActual<typeof import('@/features/tokens/api/tokenApi')>('@/features/tokens/api/tokenApi');
  return { ...actual, tokenApi: tokens };
});
const sb = vi.hoisted(() => ({ updateUser: vi.fn(), reauthenticate: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { ...sb, getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } },
}));
vi.mock('@/lib/stripe', () => ({ stripePromise: Promise.resolve(null), stripeAppearance: {}, isStripeConfigured: true, isStripeTestMode: false }));

import { allowedStepUpMethods, isSecondFactorRefusal, isStepUpRefusal } from './lib/stepUp';
import { useMfaStore, sessionKeyOf } from './store/mfaStore';
import { StepUpPanel } from './components/StepUpPanel';
import { BackupCodesPanel } from './components/BackupCodesPanel';
import { SecondFactorGate } from './components/SecondFactorGate';
import { MfaApiError } from './api/mfaApi';
import { TokenApiError } from '@/features/tokens/api/tokenApi';
import { ReleaseTokenDialog } from '@/features/tokens/components/ReleaseTokenDialog';
import { TransferCompleteFlow } from '@/features/tokens/components/TransferCompleteFlow';
import { ChangePasswordForm } from './components/ChangePasswordForm';

const baseStatus = (over: Partial<MfaStatus> = {}): MfaStatus => ({
  passkeys: [],
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

const passkey = { id: 'pk-1', nickname: 'My iPhone', synced: true, createdAt: '2026-10-27T12:00:00Z', lastUsedAt: null, usableFrom: null, fromRecovery: false };
const tomorrow = () => new Date(Date.now() + 24 * 3600 * 1000).toISOString();

const seed = (status: MfaStatus | null) =>
  useMfaStore.setState({ sessionKey: 'k', status, state: status ? 'ready' : 'idle' });

const stepUpRefusal = () => new TokenApiError('Confirm it is you', 403, 'step_up_required', 'step_up_required');

beforeEach(() => {
  vi.clearAllMocks();
  useMfaStore.getState().clear();
});

// ── Rules ───────────────────────────────────────────────────────────────────

describe('allowedStepUpMethods', () => {
  it('lets anyone fix sign-in methods with any factor', () => {
    expect(allowedStepUpMethods('factor_remove', true)).toEqual(['passkey', 'totp', 'recovery_code']);
  });
  it('allows an authenticator code for release, but not a backup code', () => {
    expect(allowedStepUpMethods('release', false)).toEqual(['passkey', 'totp']);
    expect(allowedStepUpMethods('transfer_complete', false)).toEqual(['passkey', 'totp']);
  });
  it('is passkey only for staff token actions and every admin action', () => {
    expect(allowedStepUpMethods('release', true)).toEqual(['passkey']);
    expect(allowedStepUpMethods('price_change', false)).toEqual(['passkey']);
    expect(allowedStepUpMethods('admin_approve', false)).toEqual(['passkey']);
  });
  it('recognises refusals by reason or by admin code', () => {
    expect(isStepUpRefusal(stepUpRefusal())).toBe(true);
    expect(isStepUpRefusal({ code: 'step_up_required' })).toBe(true);
    expect(isSecondFactorRefusal(new TokenApiError('x', 403, 'permission_denied', '2fa_required'))).toBe(true);
    expect(isStepUpRefusal(new Error('nope'))).toBe(false);
  });
});

describe('sessionKeyOf', () => {
  it('keys on the session_id claim and falls back to the user id', () => {
    const payload = btoa(JSON.stringify({ session_id: 'sess-1' })).replace(/=+$/, '');
    expect(sessionKeyOf(`h.${payload}.s`, 'u1')).toBe('u1:sess-1');
    expect(sessionKeyOf('garbage', 'u1')).toBe('u1');
    expect(sessionKeyOf(undefined, 'u1')).toBe('u1');
  });
});

// ── Step-up panel ───────────────────────────────────────────────────────────

const renderPanel = (action: 'release' | 'factor_remove' = 'release') => {
  const onConfirmed = vi.fn();
  render(
    <MemoryRouter>
      <StepUpPanel action={action} targetId="tag-1" purpose="release this token" onConfirmed={onConfirmed} onCancel={vi.fn()} />
    </MemoryRouter>,
  );
  return { onConfirmed };
};

describe('StepUpPanel', () => {
  it('offers an authenticator code for release to a collector, never a backup code', async () => {
    seed(baseStatus({ authenticatorApp: true }));
    const { onConfirmed } = renderPanel();
    expect(screen.queryByRole('button', { name: 'Use passkey' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use a backup code' })).toBeNull();

    mfa.stepUpVerifyCode.mockResolvedValue({ stepUpToken: 'grant', expiresAt: 'x', action: 'release', targetId: 'tag-1' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use authenticator app code' }));
    await user.type(screen.getByLabelText('Code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith('grant'));
    expect(mfa.stepUpVerifyCode).toHaveBeenCalledWith('release', 'tag-1', { totp: '123456' });
  });

  it('asks a staff account with only an authenticator app to add a passkey', () => {
    seed(baseStatus({ authenticatorApp: true, isStaff: true }));
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Use authenticator app code' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('This needs a passkey.');
    expect(screen.getByRole('link', { name: /Security settings/ })).toHaveAttribute('href', '/settings/security');
  });

  it('offers a backup code for changing sign-in methods', () => {
    seed(baseStatus({ passkeys: [passkey] }));
    renderPanel('factor_remove');
    expect(screen.getByRole('button', { name: 'Use passkey' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use a backup code' })).toBeInTheDocument();
  });

  it('does not offer a passkey or app added with a code until its 24 hours are up', () => {
    seed(baseStatus({ passkeys: [{ ...passkey, usableFrom: tomorrow() }], authenticatorApp: true, authenticatorAppUsableFrom: tomorrow() }));
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Use passkey' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use authenticator app code' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('24 hours after it was added');
  });

  it('offers them again once the wait is over', () => {
    seed(baseStatus({ passkeys: [{ ...passkey, usableFrom: new Date(Date.now() - 1000).toISOString() }] }));
    renderPanel();
    expect(screen.getByRole('button', { name: 'Use passkey' })).toBeInTheDocument();
  });

  it('shows the server reason in plain words and keeps the person on the panel', async () => {
    seed(baseStatus({ authenticatorApp: true }));
    mfa.stepUpVerifyCode.mockRejectedValue(new MfaApiError('x', 400, 'invalid_argument', 'invalid_code'));
    const { onConfirmed } = renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use authenticator app code' }));
    await user.type(screen.getByLabelText('Code from your authenticator app'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work');
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});

// ── Token screens ───────────────────────────────────────────────────────────

describe('Release with step-up', () => {
  it('asks to confirm when the server requires it, then sends the release again with the grant', async () => {
    seed(baseStatus({ authenticatorApp: true }));
    tokens.release.mockRejectedValueOnce(stepUpRefusal()).mockResolvedValueOnce({ tagId: 'tag-1', status: 'RELEASED' });
    mfa.stepUpVerifyCode.mockResolvedValue({ stepUpToken: 'grant-1', expiresAt: 'x', action: 'release', targetId: 'tag-1' });
    const onReleased = vi.fn();
    render(
      <MemoryRouter>
        <ReleaseTokenDialog isOpen tagId="tag-1" onClose={vi.fn()} onReleased={onReleased} />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'I understand, continue' }));
    await user.type(screen.getByRole('textbox'), 'RELEASE');
    await user.click(screen.getByRole('button', { name: 'Release forever' }));

    await user.click(await screen.findByRole('button', { name: 'Use authenticator app code' }));
    await user.type(screen.getByLabelText('Code from your authenticator app'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onReleased).toHaveBeenCalled());
    expect(tokens.release).toHaveBeenNthCalledWith(1, 'tag-1', undefined);
    expect(tokens.release).toHaveBeenNthCalledWith(2, 'tag-1', 'grant-1');
  });
});

describe('Accept transfer with step-up', () => {
  it('keeps the tap session when the server asks for a step-up first', async () => {
    seed(baseStatus({ authenticatorApp: true }));
    tokens.completeTransfer.mockRejectedValueOnce(stepUpRefusal());
    const onSessionSpent = vi.fn();
    render(
      <MemoryRouter>
        <TransferCompleteFlow transferId="tr-1" tagId="tag-1" tapSession="tap-1" onSessionSpent={onSessionSpent} />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Accept and continue to payment' }));
    expect(await screen.findByText(/Confirm it.s you/)).toBeInTheDocument();
    expect(onSessionSpent).not.toHaveBeenCalled();
  });

  it('keeps the tap session on a second-factor refusal too', async () => {
    seed(baseStatus());
    tokens.completeTransfer.mockRejectedValueOnce(new TokenApiError('x', 403, 'permission_denied', '2fa_required'));
    const onSessionSpent = vi.fn();
    render(
      <MemoryRouter>
        <TransferCompleteFlow transferId="tr-1" tagId="tag-1" tapSession="tap-1" onSessionSpent={onSessionSpent} />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Accept and continue to payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/two-step sign-in/);
    expect(onSessionSpent).not.toHaveBeenCalled();
  });
});

// ── Backup codes + gate ─────────────────────────────────────────────────────

describe('BackupCodesPanel', () => {
  it('keeps Done off until the person says the codes are saved', async () => {
    const onDone = vi.fn();
    render(<BackupCodesPanel codes={['AAAAA-BBBBB', 'CCCCC-DDDDD']} onDone={onDone} />);
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox'));
    await user.click(done);
    expect(onDone).toHaveBeenCalled();
  });
});

describe('SecondFactorGate', () => {
  const session = { access_token: 'x.y.z', user: { id: 'u1' } } as unknown as Session;
  const renderGate = () =>
    render(
      <MemoryRouter initialEntries={['/tokens']}>
        <Routes>
          <Route path="/tokens" element={<SecondFactorGate session={session}><p>My tokens</p></SecondFactorGate>} />
          <Route path="/sign-in/verify" element={<p>Second step</p>} />
          <Route path="/settings/security/setup" element={<p>Setup</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it('sends an unverified session to the second step when it is required', async () => {
    mfa.status.mockResolvedValue(baseStatus({ secondFactorRequired: true, sessionVerified: false }));
    renderGate();
    expect(await screen.findByText('Second step')).toBeInTheDocument();
  });

  it('sends an account with no method to setup when it is required', async () => {
    mfa.status.mockResolvedValue(baseStatus({ secondFactorRequired: true, hasFactor: false, enrolmentRequired: true, sessionVerified: false }));
    renderGate();
    expect(await screen.findByText('Setup')).toBeInTheDocument();
  });

  it('changes nothing while two-step sign-in is not required', async () => {
    mfa.status.mockResolvedValue(baseStatus({ sessionVerified: false }));
    renderGate();
    await waitFor(() => expect(mfa.status).toHaveBeenCalled());
    expect(screen.getByText('My tokens')).toBeInTheDocument();
  });

  it('renders the page when the status cannot be loaded (the server still refuses)', async () => {
    mfa.status.mockRejectedValue(new MfaApiError('down', 503, 'unavailable', null));
    renderGate();
    await waitFor(() => expect(useMfaStore.getState().state).toBe('error'));
    expect(screen.getByText('My tokens')).toBeInTheDocument();
  });
});

// ── Password change ─────────────────────────────────────────────────────────

describe('ChangePasswordForm', () => {
  const renderForm = () => {
    const onDone = vi.fn();
    render(<MemoryRouter><ChangePasswordForm onDone={onDone} /></MemoryRouter>);
    return { onDone };
  };
  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText('New password'), 'correct horse battery');
    await user.type(screen.getByLabelText('Confirm new password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
  };

  it('changes it straight away for an account with no second factor', async () => {
    seed(baseStatus({ hasFactor: false, sessionVerified: false }));
    sb.updateUser.mockResolvedValue({ error: null });
    const { onDone } = renderForm();
    await fill(userEvent.setup());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mfa.accountChangePermit).not.toHaveBeenCalled();
  });

  it('asks a two-step account to confirm its sign-in first', () => {
    seed(baseStatus({ authenticatorApp: true, sessionVerified: false }));
    renderForm();
    expect(screen.getByRole('link', { name: 'Confirm now' })).toHaveAttribute('href', expect.stringContaining('/sign-in/verify'));
  });

  it('gets a permit after Confirm it is you, then saves', async () => {
    seed(baseStatus({ authenticatorApp: true }));
    mfa.stepUpVerifyCode.mockResolvedValue({ stepUpToken: 'g', expiresAt: 'x', action: 'account_change', targetId: 'password' });
    mfa.accountChangePermit.mockResolvedValue({ kind: 'password', expiresAt: 'x' });
    sb.updateUser.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    const { onDone } = renderForm();
    await fill(user);
    await user.click(await screen.findByRole('button', { name: 'Use authenticator app code' }));
    await user.type(screen.getByLabelText('Code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mfa.stepUpVerifyCode).toHaveBeenCalledWith('account_change', 'password', { totp: '123456' });
    expect(mfa.accountChangePermit).toHaveBeenCalledWith('password', 'g');
    expect(mfa.accountChangePermit.mock.invocationCallOrder[0]).toBeLessThan(sb.updateUser.mock.invocationCallOrder[0]);
  });

  it('asks for the emailed code when Supabase wants it, then confirms again before retrying', async () => {
    seed(baseStatus({ authenticatorApp: true }));
    mfa.stepUpVerifyCode.mockResolvedValue({ stepUpToken: 'g', expiresAt: 'x', action: 'account_change', targetId: 'password' });
    mfa.accountChangePermit.mockResolvedValue({ kind: 'password', expiresAt: 'x' });
    sb.updateUser
      .mockResolvedValueOnce({ error: { code: 'reauthentication_needed', message: 'reauth' } })
      .mockResolvedValueOnce({ error: null });
    sb.reauthenticate.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    const { onDone } = renderForm();
    await fill(user);
    await user.click(await screen.findByRole('button', { name: 'Use authenticator app code' }));
    await user.type(screen.getByLabelText('Code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await user.type(await screen.findByLabelText(/We emailed you a code/), '987654');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await user.click(await screen.findByRole('button', { name: 'Use authenticator app code' }));
    await user.type(screen.getByLabelText('Code from your authenticator app'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sb.updateUser).toHaveBeenLastCalledWith({ password: 'correct horse battery', nonce: '987654' });
    expect(mfa.accountChangePermit).toHaveBeenCalledTimes(2);
  });

  it('explains a database refusal (no valid permit)', async () => {
    seed(baseStatus({ hasFactor: false, sessionVerified: false }));
    sb.updateUser.mockResolvedValue({ error: { message: 'Database error updating user' } });
    renderForm();
    await fill(userEvent.setup());
    expect(await screen.findByRole('alert')).toHaveTextContent('Confirm it’s you again');
  });
});
