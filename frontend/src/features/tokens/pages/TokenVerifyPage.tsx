import { useEffect, useRef, useState } from 'react';
import './tapPage.css';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { tokenApi, TokenApiError } from '../api/tokenApi';
import type { ClaimResult, TapResult, ValidTap } from '../api/schemas';
import { hasSunParams, withoutSunParams } from '../lib/tapUrl';
import { forgetTapSession, isSessionLive, loadTap, saveTap } from '../lib/tapCache';
import { BUYER_WARNING, TAP_COPY, tapFailureCopy } from '../lib/copy';
import { useSealClock, type FreshTap } from '../lib/sealWindow';
import { TapSealCard } from '../components/TapSealCard';
import { ProvenanceCard } from '../components/ProvenanceCard';
import { ClaimTokenPanel } from '../components/ClaimTokenPanel';
import { TransferCompleteFlow } from '../components/TransferCompleteFlow';
import { loginPathFor } from '@/features/auth/lib/safeNext';

type View =
  | { kind: 'loading' }
  | { kind: 'no-tap' }
  | { kind: 'unknown-tag' }
  | { kind: 'error'; message: string }
  | { kind: 'result'; tap: TapResult };

/**
 * `/verify/:tokenName` — where a seal tap lands.
 *
 * One POST /nfc/tap per physical tap. The result is cached for this tab and the
 * one-time SUN parameters are stripped from the address bar, so a refresh or a
 * round trip through sign-in shows the same result instead of "already used".
 *
 * S-SEAL1 Ph1: Cinema theme on this page only (G4). The animated Verified seal shows
 * for about 90 s after a tap made on this page load; a remembered tap shows the still
 * Sealed seal (G3, no automatic re-check). Collector copy says "seal" (G1).
 */
export const TokenVerifyPage = () => {
  const { tokenName = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [claimed, setClaimed] = useState<ClaimResult | null>(null);
  const [fresh, setFresh] = useState<FreshTap | null>(null);
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
          // The Verified window is timed from this answer, on this page load only.
          setFresh(tap.valid ? { tokenName, at: Date.now() } : null);
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

  // A tap made before signing in carries no viewer, so after the sign-in round
  // trip the cached result cannot say a transfer is waiting. Ask instead.
  const [incomingTransferId, setIncomingTransferId] = useState<string | null>(null);
  const cachedTap = view.kind === 'result' && view.tap.valid ? view.tap : null;
  const needsIncomingLookup =
    Boolean(user) && cachedTap !== null && cachedTap.lifecycleStatus === 'ACTIVE' && !cachedTap.viewer;
  const lookupTagId = cachedTap?.tagId ?? null;
  useEffect(() => {
    if (!needsIncomingLookup || !lookupTagId) return;
    let cancelled = false;
    tokenApi
      .incomingTransfers()
      .then((incoming) => {
        if (!cancelled) setIncomingTransferId(incoming.find((t) => t.tagId === lookupTagId)?.transferId ?? null);
      })
      .catch(() => {
        // Not finding it only hides the accept panel; My Tokens still lists it.
      });
    return () => {
      cancelled = true;
    };
  }, [needsIncomingLookup, lookupTagId]);

  // Move focus to the result heading so screen readers announce the outcome.
  useEffect(() => {
    if (view.kind !== 'loading') headingRef.current?.focus();
  }, [view.kind]);

  const returnTo = location.pathname;

  return (
    <main id="main-content" className="am-tap" data-theme="cinema">
      <div className="am-tap-wrap">
        {view.kind === 'loading' && (
          <div role="status" className="am-tap-card am-tap-card--center">
            {TAP_COPY.checking}
          </div>
        )}

        {/* No seal is ever drawn on these views (no tap, unknown, error, failed). */}
        {view.kind === 'no-tap' && (
          <section className="am-tap-card am-tap-card--center">
            <h1 ref={headingRef} tabIndex={-1}>
              {TAP_COPY.noTapTitle}
            </h1>
            <p className="am-tap-body">{TAP_COPY.noTapBody}</p>
          </section>
        )}

        {view.kind === 'unknown-tag' && (
          <section className="am-tap-card am-tap-card--center" aria-live="polite">
            <p className="am-tap-kicker am-tap-kicker--bad">
              <span aria-hidden="true">✕ </span>{TAP_COPY.notVerified}
            </p>
            <h1 ref={headingRef} tabIndex={-1}>
              {TAP_COPY.unknownTitle}
            </h1>
            <p className="am-tap-body">{TAP_COPY.unknownBody}</p>
          </section>
        )}

        {view.kind === 'error' && (
          <section className="am-tap-card am-tap-card--center" role="alert">
            <h1 ref={headingRef} tabIndex={-1}>
              {TAP_COPY.errorTitle}
            </h1>
            <p className="am-tap-body">{view.message}</p>
          </section>
        )}

        {view.kind === 'result' && !view.tap.valid && (
          <section className="am-tap-card" aria-live="polite">
            <p className="am-tap-kicker am-tap-kicker--bad">
              <span aria-hidden="true">✕ </span>{TAP_COPY.notVerified}
            </p>
            <h1 ref={headingRef} tabIndex={-1}>
              {tapFailureCopy(view.tap.reason).title}
            </h1>
            <p className="am-tap-body">{tapFailureCopy(view.tap.reason).body}</p>
          </section>
        )}

        {view.kind === 'result' && view.tap.valid && (
          <ValidTapView
            tap={view.tap}
            tokenName={tokenName}
            fresh={fresh}
            claimed={claimed}
            signedIn={Boolean(user)}
            pendingTransferId={view.tap.viewer?.pendingTransferId ?? incomingTransferId}
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
  /** The chip's URL name: the tap cache key the replacement page reads. */
  readonly tokenName: string;
  /** The tap this page load made, if any (Verified window). */
  readonly fresh: FreshTap | null;
  readonly claimed: ClaimResult | null;
  readonly signedIn: boolean;
  /** A PENDING transfer of this token to the signed-in viewer. */
  readonly pendingTransferId: string | null;
  readonly returnTo: string;
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
  readonly onClaimed: (result: ClaimResult) => void;
  readonly onSessionSpent: () => void;
}

const ValidTapView = ({ tap, tokenName, fresh, claimed, signedIn, pendingTransferId, returnTo, headingRef, onClaimed, onSessionSpent }: ValidTapViewProps) => {
  const claimable = tap.lifecycleStatus === 'ENROLLED' && !claimed;
  const youOwnThis = Boolean(claimed) || Boolean(tap.viewer?.youOwnThis);
  const ownFresh = fresh !== null && fresh.tokenName === tokenName ? fresh : null;
  const { now, state } = useSealClock(ownFresh, tokenName);

  return (
    <>
      <TapSealCard
        lifecycleStatus={tap.lifecycleStatus}
        sealCode={tap.sealCode}
        checkedAt={tap.checkedAt}
        state={state}
        freshAt={ownFresh?.at ?? null}
        now={now}
        youOwnThis={youOwnThis}
        headingRef={headingRef}
      />

      {claimed && (
        <section className="glass rounded-2xl p-6" role="status">
          <h2 className="text-lg font-semibold text-white mb-2">{TAP_COPY.claimedTitle}</h2>
          <p className="text-gray-400 text-sm mb-3">{TAP_COPY.claimedBody}</p>
          <p className="font-mono text-xs text-gray-300 break-all mb-4">{claimed.ownershipId}</p>
          <Link to={`/tokens/${claimed.tagId}`} className="text-primary-300 underline hover:text-primary-200">
            {TAP_COPY.viewInMyTokens}
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

      {pendingTransferId && !youOwnThis && (
        <TransferCompleteFlow
          transferId={pendingTransferId}
          tagId={tap.tagId}
          tapSession={isSessionLive(tap) ? tap.tapSession!.token : null}
          onSessionSpent={onSessionSpent}
        />
      )}

      {tap.lifecycleStatus === 'ACTIVE' && !signedIn && (
        <section className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-2">{TAP_COPY.transferTitle}</h2>
          <p className="text-gray-400 text-sm mb-4">
            Sign in with the email address the owner used. You have 10 minutes from your tap.
          </p>
          <Link to={loginPathFor(returnTo)} className="text-primary-300 underline hover:text-primary-200">
            Sign in to accept
          </Link>
        </section>
      )}

      {/* S-ADMIN1 Ph2: the owner's live tap is the proof a replacement request needs. */}
      {tap.lifecycleStatus === 'ACTIVE' && youOwnThis && signedIn && !claimed && isSessionLive(tap) && (
        <section className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-2">{TAP_COPY.looseTitle}</h2>
          <p className="text-gray-400 text-sm mb-4">{TAP_COPY.looseBody}</p>
          <Link
            to={`/tokens/${tap.tagId}/replace?tap=${encodeURIComponent(tokenName)}`}
            className="text-primary-300 underline hover:text-primary-200"
          >
            {TAP_COPY.looseLink}
          </Link>
        </section>
      )}

      <ProvenanceCard provenance={tap.provenance} />

      {tap.lifecycleStatus === 'ACTIVE' && !youOwnThis && !pendingTransferId && (
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
