/**
 * /sign-in/recover (S-2FA Ph3b): get back in after losing every passkey, the
 * authenticator app and the backup codes.
 *
 *   1. Pick the account email or the backup email, type the code.
 *   2. Wait 3 days. The owner is told on every address and can cancel.
 *   3. Come back, type a fresh code, add a new passkey or authenticator app
 *      (and optionally a new password). For 7 days after, transfers, releases
 *      and sign-in changes are paused.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { loginPathFor } from '@/features/auth/lib/safeNext';
import { supabase } from '@/lib/supabase';
import { mfaApi, type CodeSent, type RecoveryChannel, type RecoveryOverview } from '../api/mfaApi';
import { sessionKeyOf, useMfaStore } from '../store/mfaStore';
import { mfaErrorCopy } from '../lib/copy';
import { EmailCodeForm } from '../components/EmailCodeForm';
import { AddPasskeyFlow } from '../components/AddPasskeyFlow';
import { AuthenticatorAppSetup } from '../components/AuthenticatorAppSetup';

type Step =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'overview' }
  | { kind: 'code'; sent: CodeSent }
  | { kind: 'waiting'; holdEndsAt: string }
  | { kind: 'add_method'; freezeEndsAt: string; passwordError: string | null }
  | { kind: 'done'; freezeEndsAt: string };

const whenFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const when = (iso: string) => whenFmt.format(new Date(iso));

const NOT_AVAILABLE: Record<string, string> = {
  staff: 'Staff accounts can’t be recovered by email. Ask the super admin to remove your staff role, recover as a normal account, then get the role back.',
  no_method: 'This account has no passkey or authenticator app yet, so there is nothing to recover. Add one in Security settings.',
  frozen: 'This account was recovered recently. You can start another recovery when the 7-day pause ends.',
  no_email: 'Confirm your email address first, then come back.',
};

export const RecoveryPage = () => {
  const { session, initialized, signOut } = useAuth();
  const navigate = useNavigate();
  const { ensure, refresh } = useMfaStore();
  const [overview, setOverview] = useState<RecoveryOverview | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [channel, setChannel] = useState<RecoveryChannel>('primary');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pwId = useId();

  const load = useCallback(async () => {
    try {
      const o = await mfaApi.recoveryOverview();
      setOverview(o);
      setStep(o.recovery && !o.recovery.ready ? { kind: 'waiting', holdEndsAt: o.recovery.holdEndsAt } : { kind: 'overview' });
    } catch {
      setStep({ kind: 'error' });
    }
  }, []);

  // Keyed on the token, not the session object: a re-render must not reset the step.
  const accessToken = session?.access_token;
  const userId = session?.user.id;
  useEffect(() => {
    if (!accessToken || !userId) return;
    void ensure(sessionKeyOf(accessToken, userId));
    void load();
  }, [accessToken, userId, ensure, load]);

  if (!initialized) return null;
  if (!session) return <Navigate to={loginPathFor('/sign-in/recover')} replace />;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(mfaErrorCopy(err));
    } finally {
      setBusy(false);
    }
  };

  const finishing = Boolean(overview?.recovery?.ready);

  const send = () =>
    act(async () => {
      const sent = await mfaApi.sendRecoveryCode(finishing ? undefined : channel);
      setStep({ kind: 'code', sent });
    });

  const submitCode = (sent: CodeSent, code: string) =>
    act(async () => {
      if (sent.purpose === 'recovery_start') {
        const r = await mfaApi.startRecovery(sent.codeId, code);
        setStep({ kind: 'waiting', holdEndsAt: r.holdEndsAt });
        return;
      }
      const wantsPassword = newPassword.length > 0;
      const r = await mfaApi.finishRecovery(sent.codeId, code, wantsPassword);
      let passwordError: string | null = null;
      if (wantsPassword && r.passwordPermitExpiresAt) {
        const { error: pwErr } = await supabase.auth.updateUser({ password: newPassword });
        if (pwErr) passwordError = 'Your new password was not saved. You can set it from Security settings after the pause.';
      }
      setNewPassword('');
      await refresh();
      setStep({ kind: 'add_method', freezeEndsAt: r.freezeEndsAt, passwordError });
    });

  const methodAdded = async () => {
    await refresh();
    if (step.kind === 'add_method') setStep({ kind: 'done', freezeEndsAt: step.freezeEndsAt });
  };

  const status = useMfaStore.getState().status;
  const passwordOk = newPassword.length === 0 || newPassword.length >= 8;

  return (
    <div className="min-h-screen bg-dark-800 flex items-center justify-center p-4">
      <main id="main-content" className="glass rounded-2xl p-8 max-w-md w-full space-y-5">
        <h1 className="text-2xl font-bold text-white">Recover your account</h1>

        {step.kind === 'loading' && <p className="text-gray-400 text-sm" role="status">Loading…</p>}

        {step.kind === 'error' && (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-red-300">We couldn&apos;t load your account. Try again.</p>
            <Button variant="secondary" onClick={() => void load()}>Try again</Button>
          </div>
        )}

        {step.kind === 'overview' && overview && !overview.available && (
          overview.notAvailableReason === 'verified'
            ? <Navigate to="/settings/security" replace />
            : <p className="text-sm text-gray-300">{NOT_AVAILABLE[overview.notAvailableReason ?? ''] ?? 'Recovery is not available for this account.'}</p>
        )}

        {step.kind === 'overview' && overview?.available && !finishing && (
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              Lost your passkeys, authenticator app and backup codes? We&apos;ll email you a code. After that there is a
              3-day wait before you can get back in. We tell you on every address, so if someone else is trying, you
              have time to stop them.
            </p>
            {overview.channels.length > 1 ? (
              <fieldset className="space-y-2">
                <legend className="text-sm text-gray-300 mb-1">Send the code to</legend>
                {overview.channels.map((c) => (
                  <label key={c.channel} className="flex items-center gap-2 text-white">
                    <input
                      type="radio"
                      name="channel"
                      value={c.channel}
                      checked={channel === c.channel}
                      onChange={() => setChannel(c.channel)}
                      className="accent-primary-500"
                    />
                    {c.sentTo} <span className="text-xs text-gray-400">({c.channel === 'primary' ? 'account email' : 'backup email'})</span>
                  </label>
                ))}
              </fieldset>
            ) : (
              overview.channels[0] && <p className="text-sm text-gray-300">We&apos;ll send it to {overview.channels[0].sentTo}.</p>
            )}
            <Button onClick={() => void send()} disabled={busy} aria-busy={busy}>
              {busy ? 'Sending…' : 'Email me a code'}
            </Button>
          </div>
        )}

        {step.kind === 'overview' && overview?.available && finishing && (
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              The wait is over. We&apos;ll email you one more code to finish. Then you add a new passkey or authenticator
              app, and get new backup codes.
            </p>
            <div className="space-y-1">
              <label htmlFor={pwId} className="block text-sm text-gray-300">New password (optional)</label>
              <input
                id={pwId}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-xl bg-dark-700 border border-white/10 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-xs text-gray-400">
                {passwordOk
                  ? 'Leave empty to keep your current password. You can’t change it from Security settings for the next 7 days.'
                  : 'At least 8 characters.'}
              </p>
            </div>
            <Button onClick={() => void send()} disabled={busy || !passwordOk} aria-busy={busy}>
              {busy ? 'Sending…' : 'Email me a code'}
            </Button>
          </div>
        )}

        {step.kind === 'code' && (
          <EmailCodeForm
            sentTo={step.sent.sentTo}
            busy={busy}
            resendAfter={step.sent.resendAfter}
            submitLabel={step.sent.purpose === 'recovery_start' ? 'Start recovery' : 'Finish recovery'}
            onSubmit={(c) => void submitCode(step.sent, c)}
            onResend={() => void send()}
            onBack={() => { setError(null); setStep({ kind: 'overview' }); }}
          />
        )}

        {step.kind === 'waiting' && (
          <div className="space-y-3" role="status">
            <p className="text-white">Recovery started.</p>
            <p className="text-sm text-gray-300">
              You can finish on <strong className="text-white">{when(step.holdEndsAt)}</strong>. Sign in then and come back
              to this page.
            </p>
            <p className="text-sm text-gray-400">
              We emailed every address on the account. If it wasn&apos;t you, the owner can cancel it from any device that
              still has their passkey or authenticator app.
            </p>
          </div>
        )}

        {step.kind === 'add_method' && (
          <div className="space-y-4">
            <p className="text-white">Your account is recovered.</p>
            {step.passwordError && <p role="alert" className="text-sm text-amber-200">{step.passwordError}</p>}
            <p className="text-sm text-gray-300">
              Add a new way to sign in now (within 30 minutes). You&apos;ll get new backup codes: your old ones no longer work.
            </p>
            <AddPasskeyFlow isFirst breakGlass={false} getStepUpToken={async () => null} onFinished={() => void methodAdded()} onCancel={() => undefined} />
            {!status?.authenticatorApp && (
              <details className="text-sm text-gray-300">
                <summary className="cursor-pointer text-primary-300">Use an authenticator app instead</summary>
                <div className="mt-3">
                  <AuthenticatorAppSetup isFirst getStepUpToken={async () => null} onFinished={() => void methodAdded()} onCancel={() => undefined} />
                </div>
              </details>
            )}
          </div>
        )}

        {step.kind === 'done' && (
          <div className="space-y-3">
            <p className="text-white">You&apos;re back in.</p>
            <p className="text-sm text-gray-300">
              Until {when(step.freezeEndsAt)}, transfers, releases and sign-in changes are paused to keep your tokens safe.
            </p>
            <Button onClick={() => navigate('/settings/security', { replace: true })}>Go to Security settings</Button>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

        <div className="border-t border-white/10 pt-4 flex flex-wrap gap-4 text-sm">
          <Link to="/sign-in/verify" className="text-primary-300 underline">I found my passkey or codes</Link>
          <button
            type="button"
            onClick={() => { useMfaStore.getState().clear(); void signOut(); }}
            className="text-primary-300 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
          >
            Sign out
          </button>
        </div>
      </main>
    </div>
  );
};
