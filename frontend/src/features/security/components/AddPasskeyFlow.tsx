import { useId, useState } from 'react';
import { Button } from '@/components/common/Button';
import { mfaApi } from '../api/mfaApi';
import { createPasskey } from '../lib/webauthn';
import { isCancelled, mfaErrorCopy } from '../lib/copy';
import { BackupCodesPanel } from './BackupCodesPanel';

interface AddPasskeyFlowProps {
  /** Needed unless this is the account's first sign-in method. */
  readonly getStepUpToken: () => Promise<string | null>;
  readonly isFirst: boolean;
  readonly breakGlass: boolean;
  readonly onFinished: () => void;
  readonly onCancel: () => void;
}

type Step = { kind: 'name' } | { kind: 'codes'; codes: string[] };

// Same rule as the server: 1-40 characters, no angle brackets or control characters.
const validName = (name: string): boolean =>
  name.length >= 1 && name.length <= 40 && [...name].every((c) => c !== '<' && c !== '>' && c.charCodeAt(0) >= 0x20);

/** Name it → browser prompt → (first method only) the backup codes, once. */
export const AddPasskeyFlow = ({ getStepUpToken, isFirst, breakGlass, onFinished, onCancel }: AddPasskeyFlowProps) => {
  const [step, setStep] = useState<Step>({ kind: 'name' });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const helpId = useId();
  const trimmed = name.trim();
  const valid = validName(trimmed);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = isFirst ? undefined : await getStepUpToken();
      if (!isFirst && !token) return;
      const { challengeId, options } = await mfaApi.passkeyRegisterOptions(token ?? undefined);
      const response = await createPasskey(options);
      const result = await mfaApi.passkeyRegisterVerify({ challengeId, nickname: trimmed, response });
      if (result.backupCodes) setStep({ kind: 'codes', codes: result.backupCodes });
      else onFinished();
    } catch (err) {
      if (!isCancelled(err)) setError(mfaErrorCopy(err));
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === 'codes') return <BackupCodesPanel codes={step.codes} onDone={onFinished} />;

  return (
    <form onSubmit={(e) => void add(e)} className="space-y-3">
      <label htmlFor={nameId} className="block text-sm text-gray-300">Name this passkey</label>
      <input
        id={nameId}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={breakGlass ? 'YubiKey 1' : 'My iPhone'}
        maxLength={40}
        aria-describedby={helpId}
        disabled={busy}
        autoFocus
        className="w-full rounded-xl bg-dark-700 border border-white/10 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <p id={helpId} className="text-xs text-gray-400">
        {breakGlass
          ? 'This account needs a hardware security key. A passkey saved to a phone or password manager will be refused.'
          : 'So you can tell your passkeys apart later. Passkeys saved to iCloud Keychain or Google Password Manager stay with you if you lose this phone.'}
      </p>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={!valid || busy} aria-busy={busy}>
          {busy ? 'Follow the prompt on your device…' : 'Add passkey'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
};
