import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/common/Button';

interface EmailCodeFormProps {
  /** Masked address the code went to, e.g. "j•••@g•••.com". */
  readonly sentTo: string;
  readonly busy: boolean;
  readonly submitLabel: string;
  /** When another code may be asked for (ISO), or null. */
  readonly resendAfter: string | null;
  readonly onSubmit: (code: string) => void;
  readonly onResend: () => void;
  readonly onBack?: () => void;
}

/**
 * A 6-digit code from an email (S-2FA Ph3b). Typed, never a link, so reading
 * the email on a phone and typing it on a computer works. The code only works
 * in this browser: it is bound to this sign-in.
 */
export const EmailCodeForm = ({ sentTo, busy, submitLabel, resendAfter, onSubmit, onResend, onBack }: EmailCodeFormProps) => {
  const [code, setCode] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const id = useId();
  const helpId = useId();
  const value = code.replace(/[\s-]/g, '');
  const valid = /^\d{6}$/.test(value);
  const waitMs = resendAfter ? new Date(resendAfter).getTime() - now : 0;
  const wait = Math.max(0, Math.ceil(waitMs / 1000));

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [wait]);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) onSubmit(value);
      }}
    >
      <label htmlFor={id} className="block text-sm text-gray-300">
        Code sent to {sentTo}
      </label>
      <input
        id={id}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        aria-describedby={helpId}
        disabled={busy}
        autoFocus
        className="w-full rounded-xl bg-dark-700 border border-white/10 px-4 py-3 font-mono text-lg tracking-widest text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <p id={helpId} className="text-gray-400 text-xs">
        6 digits. It works for 10 minutes, only in this browser. We will never ask you for it.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={!valid || busy} aria-busy={busy}>
          {busy ? 'Checking…' : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onResend} disabled={busy || wait > 0}>
          {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
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
