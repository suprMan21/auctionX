import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { tokenApi, TokenApiError } from '../api/tokenApi';
import type { ClaimResult, TapResult, ValidTap } from '../api/schemas';
import { hasSunParams, withoutSunParams } from '../lib/tapUrl';
import { forgetTapSession, loadTap, saveTap } from '../lib/tapCache';
import { BUYER_WARNING, statusCopy, tapFailureCopy } from '../lib/copy';
import { TokenStatusBadge } from '../components/TokenStatusBadge';
import { ProvenanceCard } from '../components/ProvenanceCard';
import { ClaimTokenPanel } from '../components/ClaimTokenPanel';

type View =
  | { kind: 'loading' }
  | { kind: 'no-tap' }
  | { kind: 'unknown-tag' }
  | { kind: 'error'; message: string }
  | { kind: 'result'; tap: TapResult };

const isSessionLive = (tap: ValidTap, now: number = Date.now()): boolean =>
  Boolean(tap.tapSession && new Date(tap.tapSession.expiresAt).getTime() > now);

/**
 * `/verify/:tokenName` — where a chip tap lands.
 *
 * One POST /nfc/tap per physical tap. The result is cached for this tab and the
 * one-time SUN parameters are stripped from the address bar, so a refresh or a
 * round trip through sign-in shows the same result instead of "already used".
 */
export const TokenVerifyPage = () => {
  const { tokenName = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [claimed, setClaimed] = useState<ClaimResult | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;

    if (hasSunParams(location.search)) {
      setView({ kind: 'loading' });
      // The full tapped URL, exactly as the chip produced it.
      const sunMessage = window.location.href;
      tokenApi
        .tap(sunMessage)
        .then((tap) => {
          saveTap(tokenName, tap);
          if (cancelled) return;
          setView({ kind: 'result', tap });
          // Strip the spent SUN params so a refresh reads the cache.
          navigate({ pathname: location.pathname, search: withoutSunParams(location.search) }, { replace: true });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // Only the tap handler's own "no chip matched" (code not_found) means
          // an unregistered chip. A bare 404 (route not deployed, wrong API URL)
          // must not tell a collector a genuine token is fake.
          if (err instanceof TokenApiError && err.status === 404 && err.code === 'not_found') {
            setView({ kind: 'unknown-tag' });
          }
          else {
            setView({
              kind: 'error',
              message:
                err instanceof TokenApiError && err.status === 404
                  ? 'The verification service is not available right now. Please try again shortly.'
                  : err instanceof Error
                    ? err.message
                    : 'Something went wrong.',
            });
          }
        });
    } else {
      const cached = loadTap(tokenName);
      setView(cached ? { kind: 'result', tap: cached } : { kind: 'no-tap' });
    }

    return () => {
      cancelled = true;
    };
  }, [location.pathname, location.search, navigate, tokenName]);

  // Move focus to the result heading so screen readers announce the outcome.
  useEffect(() => {
    if (view.kind !== 'loading') headingRef.current?.focus();
  }, [view.kind]);

  const returnTo = location.pathname;

  return (
    <main id="main-content" className="min-h-screen bg-dark-800 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {view.kind === 'loading' && (
          <div role="status" className="glass rounded-2xl p-10 text-center text-gray-300">
            Checking this token…
          </div>
        )}

        {view.kind === 'no-tap' && (
          <section className="glass rounded-2xl p-8 text-center">
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-white mb-3 focus:outline-none">
              Tap the token to verify it.
            </h1>
            <p className="text-gray-400">
              Hold your phone near the Authentic Materials token. Each tap opens a fresh, one-time check.
            </p>
          </section>
        )}

        {view.kind === 'unknown-tag' && (
          <section className="glass rounded-2xl p-8 text-center" aria-live="polite">
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-white mb-3 focus:outline-none">
              This is not a registered token.
            </h1>
            <p className="text-gray-400">
              We have no record of this chip. Do not buy an item on the strength of it.
            </p>
          </section>
        )}

        {view.kind === 'error' && (
          <section className="glass rounded-2xl p-8 text-center" role="alert">
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-white mb-3 focus:outline-none">
              We could not check this token.
            </h1>
            <p className="text-gray-400">{view.message}</p>
          </section>
        )}

        {view.kind === 'result' && !view.tap.valid && (
          <section className="glass rounded-2xl p-8" aria-live="polite">
            <p className="text-sm font-semibold text-red-300 mb-2">
              <span aria-hidden="true">✕ </span>Not verified
            </p>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-white mb-3 focus:outline-none">
              {tapFailureCopy(view.tap.reason).title}
            </h1>
            <p className="text-gray-400">{tapFailureCopy(view.tap.reason).body}</p>
          </section>
        )}

        {view.kind === 'result' && view.tap.valid && (
          <ValidTapView
            tap={view.tap}
            claimed={claimed}
            signedIn={Boolean(user)}
            returnTo={returnTo}
            headingRef={headingRef}
            onClaimed={(result) => {
              setClaimed(result);
              const updated: ValidTap = {
                ...(view.tap as ValidTap),
                lifecycleStatus: 'ACTIVE',
                tapSession: null,
                viewer: { youOwnThis: true, canClaim: false, pendingTransferId: null },
              };
              saveTap(tokenName, updated);
              setView({ kind: 'result', tap: updated });
            }}
            onSessionSpent={() => {
              forgetTapSession(tokenName);
              setView((current) =>
                current.kind === 'result' && current.tap.valid
                  ? { kind: 'result', tap: { ...current.tap, tapSession: null } }
                  : current,
              );
            }}
          />
        )}
      </div>
    </main>
  );
};

interface ValidTapViewProps {
  readonly tap: ValidTap;
  readonly claimed: ClaimResult | null;
  readonly signedIn: boolean;
  readonly returnTo: string;
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
  readonly onClaimed: (result: ClaimResult) => void;
  readonly onSessionSpent: () => void;
}

const ValidTapView = ({ tap, claimed, signedIn, returnTo, headingRef, onClaimed, onSessionSpent }: ValidTapViewProps) => {
  const status = statusCopy(tap.lifecycleStatus);
  const claimable = tap.lifecycleStatus === 'ENROLLED' && !claimed;
  const youOwnThis = Boolean(claimed) || Boolean(tap.viewer?.youOwnThis);

  return (
    <>
      <section className="glass rounded-2xl p-8" aria-live="polite">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <p className="text-sm font-semibold text-emerald-300">
            <span aria-hidden="true">✓ </span>Genuine Authentic Materials token
          </p>
          <TokenStatusBadge status={tap.lifecycleStatus} />
        </div>
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-white mb-2 focus:outline-none">
          {youOwnThis ? 'You own this.' : status.label === 'Active' ? 'Verified.' : `${status.label}.`}
        </h1>
        <p className="text-gray-400">{status.detail}</p>
      </section>

      {claimed && (
        <section className="glass rounded-2xl p-6" role="status">
          <h2 className="text-lg font-semibold text-white mb-2">Claimed. It is yours.</h2>
          <p className="text-gray-400 text-sm mb-3">Your Ownership ID is your public fingerprint for this token.</p>
          <p className="font-mono text-xs text-gray-300 break-all mb-4">{claimed.ownershipId}</p>
          <Link to={`/tokens/${claimed.tagId}`} className="text-primary-300 underline hover:text-primary-200">
            View it in My Tokens
          </Link>
        </section>
      )}

      {claimable && (
        <ClaimTokenPanel
          returnTo={returnTo}
          signedIn={signedIn}
          tapSession={isSessionLive(tap) ? tap.tapSession!.token : null}
          onClaimed={onClaimed}
          onSessionSpent={onSessionSpent}
        />
      )}

      {tap.viewer?.pendingTransferId && (
        <section className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-2">A transfer to you is waiting.</h2>
          <p className="text-gray-400 text-sm">
            The owner has started a transfer of this token to you. You will find it under{' '}
            <Link to="/tokens" className="text-primary-300 underline hover:text-primary-200">My Tokens</Link>.
          </p>
        </section>
      )}

      <ProvenanceCard provenance={tap.provenance} />

      {tap.lifecycleStatus === 'ACTIVE' && !youOwnThis && (
        <aside className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5 text-sm text-amber-100">
          <p className="font-semibold mb-1">
            <span aria-hidden="true">! </span>Before you pay
          </p>
          <p>{BUYER_WARNING}</p>
        </aside>
      )}
    </>
  );
};
