import { useEffect, useId, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { mfaApi } from '../api/mfaApi';
import { sessionKeyOf, useMfaStore } from '../store/mfaStore';
import { secondFactorPathFor } from '../lib/stepUp';
import { mfaErrorCopy } from '../lib/copy';
import { StepUpPanel } from './StepUpPanel';

interface ChangePasswordFormProps {
  readonly onDone: () => void;
  readonly submitLabel?: string;
}

type Step =
  | { kind: 'form' }
  /** `nonce` set: retrying after Supabase's emailed code, which needs a fresh permit. */
  | { kind: 'step-up'; nonce?: string }
  | { kind: 'saving' }
  | { kind: 'nonce' };

/**
 * New password, then (for an account with a passkey or authenticator app)
 * "Confirm it's you", then a one-time permit from our backend, then the change
 * itself through Supabase. Without the permit the database refuses the change
 * (trigger guard_auth_change, migration 20261027000010), so a stolen password
 * alone can no longer set a new one.
 *
 * Supabase "Secure password change" may also ask for a code it emails
 * (reauthentication) when the session is older than a day.
 */
export const ChangePasswordForm = ({ onDone, submitLabel = 'Set new password' }: ChangePasswordFormProps) => {
  const { session } = useAuth();
  const location = useLocation();
  const { status, ensure } = useMfaStore();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nonce, setNonce] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [error, setError] = useState<string | null>(null);
  const pwId = useId();
  const confirmId = useId();
  const nonceId = useId();

  useEffect(() => {
    if (session) void ensure(sessionKeyOf(session.access_token, session.user.id));
  }, [session, ensure]);

  const needsSecondFactor = Boolean(status?.hasFactor);
  const sessionVerified = Boolean(status?.sessionVerified);

  const update = async (permitToken: string | null, withNonce?: string) => {
    setStep({ kind: 'saving' });
    setError(null);
    try {
      if (permitToken) await mfaApi.accountChangePermit('password', permitToken);
      const { error: updateErr } = await supabase.auth.updateUser(withNonce ? { password, nonce: withNonce } : { password });
      if (updateErr) {
        const code = (updateErr as { code?: string }).code;
        if (code === 'reauthentication_needed' || code === 'reauth_nonce_missing') {
          await supabase.auth.reauthenticate();
          setStep({ kind: 'nonce' });
          return;
        }
        if (code === 'reauthentication_not_valid') {
          setError('That code did not work. Check the latest email and try again.');
          setStep({ kind: 'nonce' });
          return;
        }
        if (code === 'same_password') {
          setError('Choose a password you have not used on this account.');
        } else if (code === 'weak_password') {
          setError('Choose a stronger password: longer, and not a common one.');
        } else if (/database error/i.test(updateErr.message)) {
          // The database refused: no valid permit (expired or already used).
          setError('Confirm it’s you again, then save within 2 minutes.');
        } else {
          setError(updateErr.message);
        }
        setStep({ kind: 'form' });
        return;
      }
      setPassword('');
      setConfirm('');
      setStep({ kind: 'form' });
      onDone();
    } catch (err) {
      setError(mfaErrorCopy(err));
      setStep({ kind: 'form' });
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (needsSecondFactor) {
      setStep({ kind: 'step-up' });
      return;
    }
    void update(null);
  };

  if (needsSecondFactor && !sessionVerified) {
    return (
      <p className="text-sm text-gray-300" role="status">
        Your account uses two-step sign-in, so confirm it&apos;s you before changing your password.{' '}
        <Link to={secondFactorPathFor(location.pathname + location.search)} className="underline text-primary-300">
          Confirm now
        </Link>
      </p>
    );
  }

  if (step.kind === 'step-up') {
    return (
      <StepUpPanel
        action="account_change"
        targetId="password"
        purpose="change your password"
        onConfirmed={(token) => void update(token, step.nonce)}
        onCancel={() => setStep({ kind: 'form' })}
      />
    );
  }

  if (step.kind === 'nonce') {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!nonce.trim()) return;
          // The first permit was not spent (Supabase stopped before saving), but
          // ask again rather than rely on it still being inside its 2 minutes.
          if (needsSecondFactor) setStep({ kind: 'step-up', nonce: nonce.trim() });
          else void update(null, nonce.trim());
        }}
      >
        <label htmlFor={nonceId} className="block text-sm text-gray-300">
          We emailed you a code to confirm this change. Enter it here.
        </label>
        <input
          id={nonceId}
          value={nonce}
          onChange={(e) => setNonce(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          className="w-full rounded-xl bg-dark-700 border border-white/10 px-4 py-3 font-mono text-lg tracking-widest text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <Button type="submit" disabled={!nonce.trim()}>Confirm</Button>
      </form>
    );
  }

  const saving = step.kind === 'saving';
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor={pwId} className="block text-sm font-medium text-gray-300 mb-1">New password</label>
        <input
          id={pwId}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          disabled={saving}
          className="w-full h-11 px-3 rounded-xl bg-dark-600 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>
      <div>
        <label htmlFor={confirmId} className="block text-sm font-medium text-gray-300 mb-1">Confirm new password</label>
        <input
          id={confirmId}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          disabled={saving}
          className="w-full h-11 px-3 rounded-xl bg-dark-600 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <Button type="submit" disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : submitLabel}</Button>
    </form>
  );
};
