import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/common/Button';
import { mfaApi } from '../api/mfaApi';
import { mfaErrorCopy } from '../lib/copy';
import { BackupCodesPanel } from './BackupCodesPanel';
import { CodeEntryForm } from './CodeEntryForm';

interface AuthenticatorAppSetupProps {
  readonly getStepUpToken: () => Promise<string | null>;
  readonly isFirst: boolean;
  readonly onFinished: () => void;
  readonly onCancel: () => void;
}

type Step =
  | { kind: 'start' }
  | { kind: 'scan'; secret: string; uri: string }
  | { kind: 'codes'; codes: string[] };

/** Start → scan the QR code (or type the key) → enter the first code. */
export const AuthenticatorAppSetup = ({ getStepUpToken, isFirst, onFinished, onCancel }: AuthenticatorAppSetupProps) => {
  const [step, setStep] = useState<Step>({ kind: 'start' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = isFirst ? undefined : await getStepUpToken();
      if (!isFirst && !token) return;
      const { secret, otpauthUri } = await mfaApi.totpSetup(token ?? undefined);
      setStep({ kind: 'scan', secret, uri: otpauthUri });
    } catch (err) {
      setError(mfaErrorCopy(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (code: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await mfaApi.totpConfirm(code);
      if (result.backupCodes) setStep({ kind: 'codes', codes: result.backupCodes });
      else onFinished();
    } catch (err) {
      setError(mfaErrorCopy(err));
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === 'codes') return <BackupCodesPanel codes={step.codes} onDone={onFinished} />;

  if (step.kind === 'start') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-300">
          Use an app like 1Password, Google Authenticator or Microsoft Authenticator. It shows a new 6-digit code every 30 seconds.
        </p>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void start()} disabled={busy} aria-busy={busy}>
            {busy ? 'Starting…' : 'Set up authenticator app'}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      </div>
    );
  }

  // Group the key in 4s so it can be typed by hand.
  const grouped = step.secret.replace(/(.{4})/g, '$1 ').trim();
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-300">Scan this with your authenticator app.</p>
      <div className="inline-block rounded-xl bg-white p-3">
        <QRCodeSVG value={step.uri} size={176} title="QR code for your authenticator app" />
      </div>
      <details className="text-sm text-gray-300">
        <summary className="cursor-pointer text-primary-300">Can&apos;t scan? Type this key instead</summary>
        <p className="mt-2 font-mono text-white break-all select-all">{grouped}</p>
      </details>
      <CodeEntryForm kind="totp" busy={busy} submitLabel="Turn on" onSubmit={(c) => void confirm(c)} onBack={onCancel} />
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    </div>
  );
};
