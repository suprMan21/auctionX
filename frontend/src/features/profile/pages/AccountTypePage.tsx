/**
 * /settings/account-type — Collector or Creator (2026-10-27).
 *
 * Every account starts as a Collector. Becoming a Creator needs an identity
 * check (Yoti, purpose seller_kyc). This page records the request, starts the
 * check, and is also where the check sends the user back (?returned=1), so it
 * waits briefly for the result. The account type itself is set only by the
 * database; this page just reads it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { api, type YotiStatus } from '@/lib/api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { OpenAppButton } from '@/features/app/OpenAppButton';
import { withFromApp } from '@/features/app/fromApp';

const POLL_MS = 2000;
const MAX_POLLS = 15;
const VERIFIED = new Set(['VERIFIED', 'APPROVED']);
const SUPPORT_EMAIL = 'hello@authentic-materials.com';

type View =
  | 'creator'
  | 'collector'
  | 'request_saved'
  | 'checking'
  | 'rejected'
  | 'blocked';

export const viewFor = (s: YotiStatus): View => {
  if (s.account_type === 'creator') return 'creator';
  if (!s.creator_requested_at) return 'collector';
  const check = s.seller_verification_status;
  if (check === 'PENDING') return 'checking';
  if (check === 'REJECTED') return 'rejected';
  if (check === 'FLAGGED' || check === 'REVOKED') return 'blocked';
  // Verified but account_type not yet updated would be a brief race; show checking.
  if (VERIFIED.has(check)) return 'checking';
  return 'request_saved';
};

export const AccountTypePage = () => {
  const [params] = useSearchParams();
  const returned = params.get('returned') === '1';
  const [status, setStatus] = useState<YotiStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [polls, setPolls] = useState(0);
  const { user } = useAuth();

  const load = useCallback(async () => {
    try {
      setStatus(await api.verification.getStatus());
      setLoadError(null);
    } catch {
      setLoadError("We couldn't load your account type. Refresh the page to try again.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Back from the identity check: the result arrives a few seconds later.
  const view = status ? viewFor(status) : null;
  useEffect(() => {
    if (!returned || view !== 'checking' || polls >= MAX_POLLS) return;
    const t = window.setTimeout(() => { setPolls((n) => n + 1); void load(); }, POLL_MS);
    return () => window.clearTimeout(t);
  }, [returned, view, polls, load]);

  const startCheck = async () => {
    setStarting(true);
    setActionError(null);
    try {
      await api.verification.requestCreator();
      // Already verified (e.g. for the age check): the account is a creator now,
      // and checks switched off: the request is saved. Either way, no Yoti visit.
      const fresh = await api.verification.getStatus();
      if (fresh.account_type === 'creator' || fresh.feature_enabled === false) {
        setStatus(fresh);
        setStarting(false);
        return;
      }
      const { session_url } = await api.verification.startVerification(
        'seller_kyc',
        // Keeps the app flag through the identity check.
        withFromApp(`${window.location.origin}/settings/account-type?returned=1`),
      );
      window.location.assign(session_url);
    } catch {
      // The request is saved even when the check cannot start.
      await load();
      setActionError("Your request is saved, but the identity check couldn't start. Try again in a few minutes.");
      setStarting(false);
    }
  };

  const checksOpen = status?.feature_enabled !== false;
  const startButton = (label: string) => (
    <Button variant="primary" onClick={startCheck} disabled={starting}>
      {starting ? 'Starting…' : label}
    </Button>
  );

  return (
    <main id="main-content" className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-white mb-6">Account type</h1>

      {loadError && <p role="alert" className="text-red-400">{loadError}</p>}
      {!status && !loadError && <p className="text-gray-400">Loading…</p>}

      {status && view && (
        <section className="glass rounded-2xl p-6 space-y-4" aria-live="polite">
          {view === 'creator' && (
            <>
              <h2 className="text-lg font-semibold text-white">You're a creator</h2>
              <p className="text-gray-300">Your identity check is complete. You can seal your own items.</p>
              <OpenAppButton email={user?.email} />
            </>
          )}

          {view === 'collector' && (
            <>
              <h2 className="text-lg font-semibold text-white">You're a collector</h2>
              <p className="text-gray-300">
                Creators seal their own items. To become one, verify your identity with our verification
                partner. It takes a few minutes.
              </p>
              {startButton('Become a creator')}
            </>
          )}

          {view === 'request_saved' && (
            <>
              <h2 className="text-lg font-semibold text-white">Finish becoming a creator</h2>
              <p className="text-gray-300">
                Your creator request is saved. Verify your identity to finish. Until then your account stays a
                collector account.
              </p>
              {startButton('Verify my identity')}
            </>
          )}

          {view === 'checking' && (
            <>
              <h2 className="text-lg font-semibold text-white">We're checking your identity</h2>
              <p className="text-gray-300">
                {returned && polls < MAX_POLLS
                  ? 'This usually takes a few seconds. This page updates on its own.'
                  : 'This can take a few minutes. Refresh this page to see the result.'}
              </p>
              <OpenAppButton email={user?.email} />
            </>
          )}

          {view === 'rejected' && (
            <>
              <h2 className="text-lg font-semibold text-white">We couldn't verify your identity</h2>
              <p className="text-gray-300">You can try again. Your account stays a collector account until the check passes.</p>
              {startButton('Try again')}
            </>
          )}

          {view === 'blocked' && (
            <>
              <h2 className="text-lg font-semibold text-white">Your creator request needs a review</h2>
              <p className="text-gray-300">
                Email <a className="text-accent-500 underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and
                we'll help.
              </p>
            </>
          )}

          {!checksOpen && view === 'request_saved' && (
            <p className="text-sm text-gray-400">Identity checks open soon. We've kept your request.</p>
          )}
          {actionError && <p role="alert" className="text-sm text-red-400">{actionError}</p>}
        </section>
      )}
    </main>
  );
};
