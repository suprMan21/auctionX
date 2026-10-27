/**
 * /settings/security/setup?next=… (S-2FA Ph2): shown when two-step sign-in
 * is required and the account has no method yet. Passkey first; an
 * authenticator app as the alternative (not for the break-glass account).
 */

import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { safeNextPath } from '@/features/auth/lib/safeNext';
import { sessionKeyOf, useMfaStore } from '../store/mfaStore';
import { AddPasskeyFlow } from '../components/AddPasskeyFlow';
import { AuthenticatorAppSetup } from '../components/AuthenticatorAppSetup';
import { passkeysSupported } from '../lib/webauthn';

type Choice = null | 'passkey' | 'totp';

export const EnrolRequiredPage = () => {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNextPath(params.get('next'), '/tokens');
  const { status, ensure, refresh } = useMfaStore();
  const [choice, setChoice] = useState<Choice>(passkeysSupported() ? null : 'totp');
  // Set once a method is being added, so the backup codes stay on screen after it saves.
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (session) void ensure(sessionKeyOf(session.access_token, session.user.id));
  }, [session, ensure]);

  if (status?.hasFactor && !started) return <Navigate to={next} replace />;

  const finished = async () => {
    await refresh();
    navigate(next, { replace: true });
  };
  // First method: no existing one to confirm with.
  const noStepUp = async () => null;

  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      <div className="glass rounded-2xl p-8 space-y-5">
        <h1 className="text-2xl font-bold text-white">Protect your account</h1>
        <p className="text-gray-300 text-sm">
          Before you can claim, transfer or release tokens, add a second way to confirm it&apos;s you. It takes a minute.
        </p>

        {!status && <p className="text-gray-400 text-sm" role="status">Loading…</p>}

        {status && choice === null && (
          <div className="flex flex-col gap-3">
            <Button onClick={() => { setStarted(true); setChoice('passkey'); }}>Add a passkey (recommended)</Button>
            {!status.breakGlass && (
              <Button variant="secondary" onClick={() => { setStarted(true); setChoice('totp'); }}>Use an authenticator app</Button>
            )}
            <p className="text-xs text-gray-400">
              A passkey uses Face ID, your fingerprint or a security key. It can&apos;t be phished, and a passkey saved
              to iCloud Keychain or Google Password Manager survives a lost phone.
            </p>
          </div>
        )}

        {status && choice === 'passkey' && (
          <AddPasskeyFlow
            key="passkey"
            isFirst={!status.hasFactor}
            breakGlass={status.breakGlass}
            getStepUpToken={noStepUp}
            onFinished={() => void finished()}
            onCancel={() => setChoice(null)}
          />
        )}

        {status && choice === 'totp' && (
          <AuthenticatorAppSetup
            isFirst={!status.hasFactor}
            getStepUpToken={noStepUp}
            onFinished={() => void finished()}
            onCancel={() => setChoice(passkeysSupported() ? null : 'totp')}
          />
        )}
      </div>
    </main>
  );
};
