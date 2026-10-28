import { useEffect, useRef, useState, type FormEvent } from 'react';

/** Shown under the field and stored with each signup as the consent wording (CASL). */
export const CONSENT_TEXT =
  'By joining, you agree to get emails about Authentic Materials from The Craving Company Inc. Unsubscribe anytime.';

export type EarlyAccessSubmit = (signup: {
  email: string;
  consentText: string;
  /** Honeypot value: people never see the field, so it is empty unless a bot filled it. */
  website: string;
  /** How long the form was open before submit. */
  fillMs: number;
}) => Promise<void>;

/** A failure the person can act on; its message is shown as-is. */
export class SignupProblem extends Error {}

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done' } | { kind: 'error'; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Early-access signup. The one network call the public site may make (Decisions DB:
 * "Landing-only site exception"), passed in as `onSubmit` so the page itself stays free of API code.
 */
export const EarlyAccessForm = ({ onSubmit }: { onSubmit: EarlyAccessSubmit }) => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [website, setWebsite] = useState('');
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL.test(value)) {
      setStatus({ kind: 'error', message: 'That email does not look right. Check it and try again.' });
      return;
    }
    setStatus({ kind: 'sending' });
    try {
      await onSubmit({ email: value, consentText: CONSENT_TEXT, website, fillMs: Date.now() - openedAt.current });
      setStatus({ kind: 'done' });
    } catch (err) {
      const message = err instanceof SignupProblem && err.message ? err.message.slice(0, 200) : null;
      setStatus({ kind: 'error', message: message ?? 'Something went wrong on our side. Try again in a minute.' });
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
      {/* Honeypot: hidden from people and screen readers; bots that fill every field give themselves away. */}
      <div className="hp" aria-hidden="true">
        <label htmlFor="early-access-website">Website</label>
        <input
          id="early-access-website"
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      <p className="fine">A quick hello now, then one email when seals are ready. No spam. Pinky promise.</p>
      <p className="fine" id="early-access-consent">{CONSENT_TEXT}</p>
      <p className="signup-msg signup-msg--err" role="alert">
        {status.kind === 'error' ? status.message : ''}
      </p>
    </form>
  );
};
