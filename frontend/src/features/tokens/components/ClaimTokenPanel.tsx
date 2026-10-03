import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { tokenApi, TokenApiError } from '../api/tokenApi';
import type { ClaimResult } from '../api/schemas';
import { claimErrorCopy } from '../lib/copy';
import { loginPathFor } from '@/features/auth/lib/safeNext';

interface ClaimTokenPanelProps {
  /** The verify page's path, so sign-in returns here with the tap remembered. */
  readonly returnTo: string;
  readonly signedIn: boolean;
  /** Tap session from the verify-page tap; null when spent or expired. */
  readonly tapSession: string | null;
  readonly onClaimed: (result: ClaimResult) => void;
  readonly onSessionSpent: () => void;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string };

/**
 * Origin claim from the verify page. One tap: the tap that opened the page is
 * the proof of possession (via its tap session).
 */
export const ClaimTokenPanel = ({ returnTo, signedIn, tapSession, onClaimed, onSessionSpent }: ClaimTokenPanelProps) => {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  // The error comes first: a failed claim also spends the session, and the
  // reason it failed (2FA, already claimed, …) matters more than "tap again".
  if (phase.kind === 'error') {
    return (
      <section aria-labelledby="claim-heading" className="glass rounded-2xl p-6">
        <h2 id="claim-heading" className="text-lg font-semibold text-white mb-2">
          Claim this token
        </h2>
        <p role="alert" className="text-red-300 text-sm">
          {phase.message}
        </p>
      </section>
    );
  }

  if (!tapSession) {
    return (
      <section aria-labelledby="claim-heading" className="glass rounded-2xl p-6">
        <h2 id="claim-heading" className="text-lg font-semibold text-white mb-2">
          Claim this token
        </h2>
        <p className="text-gray-400 text-sm">
          Your tap has expired. Tap the token again with your phone to claim it.
        </p>
      </section>
    );
  }

  if (!signedIn) {
    return (
      <section aria-labelledby="claim-heading" className="glass rounded-2xl p-6">
        <h2 id="claim-heading" className="text-lg font-semibold text-white mb-2">
          Claim this token
        </h2>
        <p className="text-gray-400 text-sm mb-5">
          This token has no owner yet. Sign in to claim it. You have 10 minutes from your tap.
        </p>
        <Link
          to={loginPathFor(returnTo)}
          className="inline-flex items-center justify-center min-h-[44px] px-6 py-3 rounded-btn font-semibold text-white bg-gradient-primary border border-white/10 shadow-glow hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
        >
          Sign in to claim
        </Link>
      </section>
    );
  }

  const submit = async () => {
    setPhase({ kind: 'submitting' });
    try {
      const result = await tokenApi.claimWithTapSession(tapSession);
      onSessionSpent();
      onClaimed(result);
    } catch (err) {
      const apiError = err instanceof TokenApiError ? err : null;
      // Any answer from /claim has spent the session, success or not.
      if (apiError && apiError.status !== 0) onSessionSpent();
      setPhase({
        kind: 'error',
        message: claimErrorCopy(apiError?.reason ?? null, apiError?.message ?? 'Something went wrong. Please try again.'),
      });
    }
  };

  return (
    <section aria-labelledby="claim-heading" className="glass rounded-2xl p-6">
      <h2 id="claim-heading" className="text-lg font-semibold text-white mb-2">
        Claim this token
      </h2>

      {phase.kind === 'idle' && (
        <>
          <p className="text-gray-400 text-sm mb-5">
            This token has no owner yet. Claiming it records you as its first owner.
          </p>
          <Button onClick={() => setPhase({ kind: 'confirming' })}>Claim token</Button>
        </>
      )}

      {(phase.kind === 'confirming' || phase.kind === 'submitting') && (
        <>
          <p className="text-gray-300 text-sm mb-2">
            You are about to become this token&apos;s owner.
          </p>
          <ul className="text-gray-400 text-sm mb-5 list-disc pl-5 space-y-1">
            <li>Your account stays private. The public page never shows who owns a token.</li>
            <li>A claim cannot be undone. Ownership only moves by transfer.</li>
          </ul>
          <div className="flex flex-wrap gap-3">
            <Button onClick={submit} disabled={phase.kind === 'submitting'} aria-busy={phase.kind === 'submitting'}>
              {phase.kind === 'submitting' ? 'Claiming…' : 'Confirm claim'}
            </Button>
            <Button variant="secondary" onClick={() => setPhase({ kind: 'idle' })} disabled={phase.kind === 'submitting'}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </section>
  );
};
