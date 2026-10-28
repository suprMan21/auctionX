import { useState, type FormEvent } from 'react';

/** Shown under the field and stored with each signup as the consent wording (CASL). */
export const CONSENT_TEXT =
  'By joining, you agree to get emails about Authentic Materials from The Craving Company Inc. Unsubscribe anytime.';

export type EarlyAccessSubmit = (signup: { email: string; consentText: string }) => Promise<void>;

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done' } | { kind: 'error'; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Early-access signup. The one network call the public site may make (Decisions DB:
 * "Landing-only site exception"), passed in as `onSubmit` so the page itself stays free of API code.
 */
export const EarlyAccessForm = ({ onSubmit }: { onSubmit: EarlyAccessSubmit }) => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL.test(value)) {
      setStatus({ kind: 'error', message: 'That email does not look right. Check it and try again.' });
      return;
    }
    setStatus({ kind: 'sending' });
    try {
      await onSubmit({ email: value, consentText: CONSENT_TEXT });
      setStatus({ kind: 'done' });
    } catch {
      setStatus({ kind: 'error', message: 'Something went wrong on our side. Try again in a minute.' });
    }
  };

  if (status.kind === 'done') {
    return (
      <p className="signup-msg signup-msg--ok" role="status">
        You're on the list. Check your inbox for a quick hello.
      </p>
    );
  }

  const sending = status.kind === 'sending';
  return (
    <form className="signup" onSubmit={submit} noValidate>
      <label htmlFor="early-access-email">Email address</label>
      <div className="row">
        <span className="am-field focus-ring-within">
          <input
            id="early-access-email"
            type="email"
            name="email"
            placeholder="you@example.com"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby="early-access-consent"
            aria-invalid={status.kind === 'error' ? true : undefined}
          />
        </span>
        <button className="am-btn am-btn--filled am-btn--lg state-layer focus-ring" type="submit" disabled={sending}>
          {sending ? 'Joining…' : 'Get early access'}
        </button>
      </div>
      <p className="fine">A quick hello now, then one email when seals are ready. No spam. Pinky promise.</p>
      <p className="fine" id="early-access-consent">{CONSENT_TEXT}</p>
      <p className="signup-msg signup-msg--err" role="alert">
        {status.kind === 'error' ? status.message : ''}
      </p>
    </form>
  );
};
