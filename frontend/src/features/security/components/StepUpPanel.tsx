import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { mfaApi, type StepUpAction } from '../api/mfaApi';
import { useMfaStore } from '../store/mfaStore';
import { allowedStepUpMethods, secondFactorPathFor, type StepUpMethod } from '../lib/stepUp';
import { getPasskeyAssertion } from '../lib/webauthn';
import { isCancelled, mfaErrorCopy } from '../lib/copy';
import { MfaApiError } from '../api/mfaApi';
import { CodeEntryForm } from './CodeEntryForm';

interface StepUpPanelProps {
  readonly action: StepUpAction;
  readonly targetId: string;
  /** What is being confirmed, e.g. "release this token". */
  readonly purpose: string;
  readonly onConfirmed: (stepUpToken: string) => void;
  readonly onCancel: () => void;
}

type Mode = { kind: 'choose' } | { kind: 'code'; method: Exclude<StepUpMethod, 'passkey'> };

/**
 * "Confirm it's you": a fresh passkey check (or, where allowed, a code) for one
 * action on one target. Hands back a single-use grant that lasts 2 minutes.
 * Rendered inside an existing dialog, or wrapped by StepUpDialog.
 */
export const StepUpPanel = ({ action, targetId, purpose, onConfirmed, onCancel }: StepUpPanelProps) => {
  const status = useMfaStore((s) => s.status);
  const refresh = useMfaStore((s) => s.refresh);
  const location = useLocation();
  const [mode, setMode] = useState<Mode>({ kind: 'choose' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsSignInStep, setNeedsSignInStep] = useState(false);

  useEffect(() => {
    if (!status) void refresh();
  }, [status, refresh]);

  const allowed = allowedStepUpMethods(action, status?.isStaff ?? true);
  const usablePasskeys = (status?.passkeys ?? []).filter((p) => !(status?.breakGlass && p.synced));
  const canPasskey = allowed.includes('passkey') && usablePasskeys.length > 0;
  const canTotp = allowed.includes('totp') && Boolean(status?.authenticatorApp) && !status?.breakGlass;
  const canBackup = allowed.includes('recovery_code') && (status?.backupCodesLeft ?? 0) > 0;
  const nothingUsable = status !== null && !canPasskey && !canTotp && !canBackup;

  const fail = (err: unknown) => {
    if (isCancelled(err)) {
      setError(null);
      return;
    }
    if (err instanceof MfaApiError && err.reason === 'second_factor_required') setNeedsSignInStep(true);
    setError(mfaErrorCopy(err));
  };

  const withPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const { challengeId, options } = await mfaApi.stepUpOptions(action, targetId);
      const response = await getPasskeyAssertion(options);
      const grant = await mfaApi.stepUpVerifyPasskey(challengeId, response);
      onConfirmed(grant.stepUpToken);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const withCode = async (method: 'totp' | 'recovery_code', code: string) => {
    setBusy(true);
    setError(null);
    try {
      const grant = await mfaApi.stepUpVerifyCode(
        action,
        targetId,
        method === 'totp' ? { totp: code } : { recoveryCode: code },
      );
      if (method === 'recovery_code') void refresh();
      onConfirmed(grant.stepUpToken);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="step-up-heading" className="space-y-4">
      <h3 id="step-up-heading" className="text-lg font-semibold text-white">
        Confirm it&apos;s you
      </h3>
      <p className="text-sm text-gray-300">
        To {purpose}, confirm with {canPasskey ? 'your passkey (Face ID, fingerprint or security key)' : 'one of the options below'}.
      </p>

      {status === null && <p className="text-sm text-gray-400" role="status">Loading…</p>}

      {nothingUsable && (
        <p className="text-sm text-amber-200" role="alert">
          {allowed.length === 1
            ? 'This needs a passkey. '
            : 'This needs a passkey or authenticator app. '}
          <Link to="/settings/security" className="underline text-primary-300">Add one in Security settings</Link>, then try again.
        </p>
      )}

      {mode.kind === 'choose' && !nothingUsable && status !== null && (
        <div className="flex flex-col gap-3">
          {canPasskey && (
            <Button onClick={() => void withPasskey()} disabled={busy} aria-busy={busy}>
              {busy ? 'Waiting for your passkey…' : 'Use passkey'}
            </Button>
          )}
          {canTotp && (
            <Button variant="secondary" onClick={() => { setError(null); setMode({ kind: 'code', method: 'totp' }); }} disabled={busy}>
              Use authenticator app code
            </Button>
          )}
          {canBackup && (
            <Button variant="ghost" onClick={() => { setError(null); setMode({ kind: 'code', method: 'recovery_code' }); }} disabled={busy}>
              Use a backup code
            </Button>
          )}
        </div>
      )}

      {mode.kind === 'code' && (
        <CodeEntryForm
          kind={mode.method}
          busy={busy}
          submitLabel="Confirm"
          onSubmit={(code) => void withCode(mode.method, code)}
          onBack={() => { setError(null); setMode({ kind: 'choose' }); }}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}{' '}
          {needsSignInStep && (
            <Link to={secondFactorPathFor(location.pathname + location.search)} className="underline text-primary-300">
              Confirm your sign-in
            </Link>
          )}
        </p>
      )}

      <Button variant="secondary" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
    </section>
  );
};
