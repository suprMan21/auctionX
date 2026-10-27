import { useId, useState } from 'react';
import { Button } from '@/components/common/Button';

interface CodeEntryFormProps {
  readonly kind: 'totp' | 'recovery_code';
  readonly busy: boolean;
  readonly submitLabel: string;
  readonly onSubmit: (code: string) => void;
  readonly onBack?: () => void;
}

const TOTP_PATTERN = /^\d{6}$/;

/**
 * One field for a 6-digit authenticator code or a backup code. The code is
 * typed, never sent as a link, so it works when the phone and the computer
 * are different devices.
 */
export const CodeEntryForm = ({ kind, busy, submitLabel, onSubmit, onBack }: CodeEntryFormProps) => {
  const [code, setCode] = useState('');
  const id = useId();
  const helpId = useId();
  const isTotp = kind === 'totp';
  const value = isTotp ? code.replace(/\s/g, '') : code.trim();
  const valid = isTotp ? TOTP_PATTERN.test(value) : value.length >= 8 && value.length <= 32;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) onSubmit(value);
      }}
    >
      <label htmlFor={id} className="block text-sm text-gray-300">
        {isTotp ? 'Code from your authenticator app' : 'One of your backup codes'}
      </label>
      <input
        id={id}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode={isTotp ? 'numeric' : 'text'}
        autoComplete={isTotp ? 'one-time-code' : 'off'}
        autoCapitalize="off"
        spellCheck={false}
        maxLength={isTotp ? 7 : 32}
        aria-describedby={helpId}
        disabled={busy}
        autoFocus
        className="w-full rounded-xl bg-dark-700 border border-white/10 px-4 py-3 font-mono text-lg tracking-widest text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <p id={helpId} className="text-gray-400 text-xs">
        {isTotp
          ? '6 digits. If a code was just used, wait for the next one.'
          : 'Each backup code works once.'}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={!valid || busy} aria-busy={busy}>
          {busy ? 'Checking…' : submitLabel}
        </Button>
        {onBack && (
          <Button type="button" variant="secondary" onClick={onBack} disabled={busy}>
            Back
          </Button>
        )}
      </div>
    </form>
  );
};
