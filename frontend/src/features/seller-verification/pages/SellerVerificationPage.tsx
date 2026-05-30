import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/common/Button';
import { api } from '@/lib/api';
import type { YotiStatus, YotiVerificationPurpose } from '@/lib/api';
import { isYotiEnabledOnClient } from '@/lib/featureFlags';
import { VerificationStatusBadge } from '../components/VerificationStatusBadge';
import { isSellerVerified } from '../types/sellerVerification';

/**
 * SellerVerificationPage — Yoti hosted IDV redirect flow (S22).
 *
 * Replaces the legacy document upload UI. State is sourced from
 * GET /api/v1/verification/status; transitions to PENDING when the user starts
 * a session; truth flips to VERIFIED / REJECTED when the webhook lands.
 *
 * Brand-neutral copy — `/seller/verification` is the shared seller-KYC route
 * for both eventual brand frontends. Unmentionables-specific age-gate UI lives
 * in the future Unmentionables frontend per Locked decision 2026-05-29.
 */
export const SellerVerificationPage = () => {
  const [status, setStatus] = useState<YotiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const featureEnabled = isYotiEnabledOnClient();

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.verification.getStatus();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load verification status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleStart = async (purpose: YotiVerificationPurpose) => {
    setStarting(true);
    setError(null);
    try {
      const result = await api.verification.startVerification(purpose);
      window.location.href = result.session_url;
    } catch (err) {
      const e = err as Error & { code?: string };
      // Backend says coming-soon (flag off / availability). Mirror in copy.
      if (e.code === 'YOTI_NOT_AVAILABLE') {
        setError('Identity verification is coming soon — check back shortly.');
      } else {
        setError(e.message || 'Could not start verification. Please try again.');
      }
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Loading verification status…</div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-400">{error || 'Unable to load verification status'}</div>
      </div>
    );
  }

  const current = status.seller_verification_status;
  const isVerified = isSellerVerified(current);
  const isPending = current === 'PENDING';
  const isRejected = current === 'REJECTED';
  const canStart = !isVerified && !isPending && featureEnabled && status.feature_enabled;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold text-white">Identity Verification</h1>
          <VerificationStatusBadge status={current} size="md" />
        </div>
        <p className="text-gray-400">
          Verify your identity with our hosted verification partner to start selling. You'll be
          redirected to a secure page to complete the check; we never see your government ID.
        </p>
      </div>

      {/* Status panels */}
      {isPending && (
        <div className="glass rounded-2xl p-6 mb-6 border border-yellow-500/20">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-yellow-400 animate-pulse" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white">Verification in Progress</h2>
          </div>
          <p className="text-sm text-gray-400">
            We're waiting on the final result from our verification partner
            {status.submitted_at ? `, started on ${new Date(status.submitted_at).toLocaleDateString()}` : ''}.
            Most checks finish within a few minutes.
          </p>
        </div>
      )}

      {isVerified && (
        <div className="glass rounded-2xl p-6 mb-6 border border-emerald-500/20">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white">Verified</h2>
          </div>
          <p className="text-sm text-gray-400">
            Your identity is verified. You can publish listings on the platform.
          </p>
        </div>
      )}

      {isRejected && (
        <div className="glass rounded-2xl p-6 mb-6 border border-red-500/20">
          <h2 className="text-lg font-semibold text-white mb-2">Verification Rejected</h2>
          {status.rejection_reason && (
            <p className="text-sm text-red-400 mb-2">{status.rejection_reason}</p>
          )}
          <p className="text-sm text-gray-400">
            You can retry the hosted verification flow at any time.
          </p>
        </div>
      )}

      {current === 'REVOKED' && (
        <div className="glass rounded-2xl p-6 mb-6 border border-red-500/20">
          <h2 className="text-lg font-semibold text-white mb-2">Verification Revoked</h2>
          <p className="text-sm text-gray-400">
            Your seller verification has been revoked. Contact support for more information.
          </p>
        </div>
      )}

      {!featureEnabled || !status.feature_enabled ? (
        <div className="glass rounded-2xl p-6 mb-6 border border-white/10">
          <h2 className="text-lg font-semibold text-white mb-2">Identity verification coming soon</h2>
          <p className="text-sm text-gray-400">
            We're finalising our verification partner integration. You'll be able to verify your
            identity here shortly.
          </p>
        </div>
      ) : null}

      {error && <p className="text-sm text-red-400 mb-4" role="alert">{error}</p>}

      {canStart && (
        <div className="space-y-3">
          <Button
            variant="primary"
            fullWidth
            disabled={starting}
            onClick={() => handleStart('seller_kyc')}
          >
            {starting ? 'Redirecting…' : isRejected ? 'Retry Verification' : 'Start Verification'}
          </Button>
          <p className="text-xs text-gray-500 text-center">
            You'll be redirected to our verification partner. Returns you here when complete.
          </p>
        </div>
      )}
    </div>
  );
};
