import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { api } from '@/lib/api';
import type { YotiStatus } from '@/lib/api';
import { VerificationStatusBadge } from './VerificationStatusBadge';
import { isSellerVerified } from '../types/sellerVerification';

/**
 * /seller/verification/return — landing page Yoti redirects the user back to.
 *
 * `?status=success|failure` from the query string is ADVISORY ONLY (defence in
 * depth — Yoti's own brief says the webhook is the truth). We:
 *  1. Read the URL param so we can render an immediate UX skin.
 *  2. Poll `/verification/status` for up to ~30s. The webhook race usually
 *     resolves within a few seconds.
 *  3. If the polled status is VERIFIED — show success.
 *  4. If REJECTED — show failure copy + retry CTA.
 *  5. If still PENDING after ~30s — tell the user it's still processing and
 *     to refresh in a minute.
 */
const MAX_POLLS = 15; // ~30s at 2000ms
const POLL_INTERVAL_MS = 2000;

export const YotiReturnHandler = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialHint = params.get('status');
  const [status, setStatus] = useState<YotiStatus | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const tick = async (attempt: number) => {
      if (cancelled || stoppedRef.current) return;
      try {
        const fresh = await api.verification.getStatus();
        if (cancelled) return;
        setStatus(fresh);
        setPollCount(attempt);
        const terminal =
          isSellerVerified(fresh.seller_verification_status)
          || fresh.seller_verification_status === 'REJECTED'
          || fresh.seller_verification_status === 'NONE';
        if (terminal) {
          stoppedRef.current = true;
          return;
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to read status');
      }
      if (attempt < MAX_POLLS && !stoppedRef.current && !cancelled) {
        timer = window.setTimeout(() => tick(attempt + 1), POLL_INTERVAL_MS);
      }
    };

    tick(1);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const current = status?.seller_verification_status ?? 'PENDING';
  const isVerified = isSellerVerified(current);
  const isRejected = current === 'REJECTED';
  const stillPending = !isVerified && !isRejected && current === 'PENDING' && pollCount >= MAX_POLLS;

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <div className="glass rounded-2xl p-8 border border-white/10">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-2xl font-bold text-white">Identity Verification</h1>
          <VerificationStatusBadge status={current} size="md" />
        </div>

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        {isVerified ? (
          <>
            <p className="text-gray-300 mb-6">
              You're verified. You can now publish listings on the platform.
            </p>
            <div className="flex gap-3">
              <Button variant="primary" onClick={() => navigate('/listings/create')}>
                Create your first listing
              </Button>
              <Link to="/dashboard">
                <Button variant="ghost">Go to dashboard</Button>
              </Link>
            </div>
          </>
        ) : isRejected ? (
          <>
            <p className="text-gray-300 mb-2">
              We weren't able to verify your identity this time.
            </p>
            {status?.rejection_reason && (
              <p className="text-sm text-red-400 mb-4">{status.rejection_reason}</p>
            )}
            <Link to="/seller/verification">
              <Button variant="primary">Try again</Button>
            </Link>
          </>
        ) : stillPending ? (
          <>
            <p className="text-gray-300 mb-4">
              We're still waiting on a final result from our verification partner. This usually only
              takes a minute. Refresh this page shortly or check the status from your dashboard.
            </p>
            <div className="flex gap-3">
              <Button variant="primary" onClick={() => window.location.reload()}>
                Refresh
              </Button>
              <Link to="/dashboard">
                <Button variant="ghost">Go to dashboard</Button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-gray-300 mb-4">
              {initialHint === 'failure'
                ? 'It looks like the verification flow was interrupted. We\'re double-checking with our partner.'
                : 'Thanks — we\'re finalising your verification. This should only take a moment.'}
            </p>
            <p className="text-xs text-gray-500">
              Checking with our partner ({pollCount}/{MAX_POLLS})…
            </p>
          </>
        )}
      </div>
    </div>
  );
};
