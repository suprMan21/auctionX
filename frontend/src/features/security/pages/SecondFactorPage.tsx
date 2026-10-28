/**
 * /sign-in/verify?next=… (S-2FA Ph2): the step after the password. Passkey
 * first; an authenticator code or a backup code as the other ways in.
 */

import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { loginPathFor, safeNextPath } from '@/features/auth/lib/safeNext';
import { mfaApi } from '../api/mfaApi';
import { sessionKeyOf, useMfaStore } from '../store/mfaStore';
import { getPasskeyAssertion } from '../lib/webauthn';
import { isCancelled, mfaErrorCopy } from '../lib/copy';
import { CodeEntryForm } from '../components/CodeEntryForm';

type Mode = 'choose' | 'totp' | 'recovery_code';

export const SecondFactorPage = () => {
  const { session, initialized, signOut } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNextPath(params.get('next'), '/tokens');
  const { status, state, ensure, refresh } = useMfaStore();
  const [mode, setMode] = useState<Mode>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) void ensure(sessionKeyOf(session.access_token, session.user.id));
  }, [session, ensure]);

  if (!initialized) return null;
  if (!session) return <Navigate to={loginPathFor(`/sign-in/verify?next=${encodeURIComponent(next)}`)} replace />;
  if (status?.sessionVerified) return <Navigate to={next} replace />;
  if (status && !status.hasFactor) {
    return <Navigate to={status.enrolmentRequired ? `/settings/security/setup?next=${encodeURIComponent(next)}` : next} replace />;
  }

  const finish = async (backupCodesLeft: number | null) => {
    await refresh();
    if (backupCodesLeft !== null && backupCodesLeft <= 3) {
      navigate(`/settings/security`, { replace: true });
      return;
    }
    navigate(next, { replace: true });
  };

  const withPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const { challengeId, options } = await mfaApi.signInOptions();
      const response = await getPasskeyAssertion(options);
      const result = await mfaApi.signInVerify({ passkey: { challengeId, response } });
      await finish(result.backupCodesLeft);
    } catch (err) {
      if (!isCancelled(err)) setError(mfaErrorCopy(err));
    } finally {
      setBusy(false);
    }
  };

  const withCode = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await mfaApi.signInVerify(mode === 'totp' ? { totp: { code } } : { recoveryCode: { code } });
      await finish(result.backupCodesLeft);
    } catch (err) {
      setError(mfaErrorCopy(err));
    } finally {
      setBusy(false);
    }
  };

  const hasPasskey = (status?.passkeys.length ?? 0) > 0;
  const hasTotp = Boolean(status?.authenticatorApp) && !status?.breakGlass;
  const hasCodes = (status?.backupCodesLeft ?? 0) > 0;
  const lockedUntil = status?.codeEntryLockedUntil ? new Date(status.codeEntryLockedUntil) : null;
  const codesLocked = lockedUntil !== null && lockedUntil.getTime() > Date.now();

  return (
    <div className="min-h-screen bg-dark-800 flex items-center justify-center p-4">
      <main id="main-content" className="glass rounded-2xl p-8 max-w-md w-full space-y-5">
        <h1 className="text-2xl font-bold text-white">Confirm it&apos;s you</h1>
        <p className="text-gray-400 text-sm">
          Your password was right. One more step keeps your seals safe if someone else learns it.
        </p>

        {!status && state !== 'error' && <p className="text-gray-400 text-sm" role="status">Loading…</p>}
        {state === 'error' && !status && (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-red-300">We couldn&apos;t load your sign-in options.</p>
            <Button variant="secondary" onClick={() => void refresh()}>Try again</Button>
          </div>
        )}

        {status && mode === 'choose' && (
          <div className="flex flex-col gap-3">
            {hasPasskey && (
              <Button onClick={() => void withPasskey()} disabled={busy} aria-busy={busy}>
                {busy ? 'Waiting for your passkey…' : 'Use passkey'}
              </Button>
            )}
            {hasTotp && (
              <Button variant="secondary" onClick={() => { setError(null); setMode('totp'); }} disabled={busy || codesLocked}>
                Use authenticator app code
              </Button>
            )}
            {hasCodes && (
              <Button variant="ghost" onClick={() => { setError(null); setMode('recovery_code'); }} disabled={busy || codesLocked}>
                Use a backup code
              </Button>
            )}
            {codesLocked && (
              <p className="text-xs text-amber-200">
                Too many wrong codes. Code entry opens again at {lockedUntil!.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
                {hasPasskey ? ' Your passkey still works.' : ''}
              </p>
            )}
          </div>
        )}

        {status && mode !== 'choose' && (
          <CodeEntryForm
            kind={mode}
            busy={busy}
            submitLabel="Continue"
            onSubmit={(c) => void withCode(c)}
            onBack={() => { setError(null); setMode('choose'); }}
          />
        )}

        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

        <div className="border-t border-white/10 pt-4 space-y-2 text-sm text-gray-400">
          <p>
            Lost your passkeys{hasTotp ? ', authenticator app' : ''} and backup codes? We can&apos;t switch off two-step
            sign-in for you, but you can recover your account by email. It takes 3 days, so someone with your password
            can&apos;t do it quietly.
          </p>
          {!status?.isStaff && (
            <Link to="/sign-in/recover" className="block text-primary-300 underline">Recover by email</Link>
          )}
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
