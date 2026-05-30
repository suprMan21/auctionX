/**
 * AdminVerificationDetailPage (S22). Mirror of AdminAuctionDetailPage:
 * back link → header → user info → session history → review history →
 * destructive override action gated by window.confirm + window.prompt(reason)
 * + react-hot-toast.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button } from '@/components/common/Button';
import { adminApi } from '../api/adminApi';
import type {
  AdminYotiSessionRow,
  AdminYotiVerificationDetailResponse,
  AdminYotiVerificationReview,
  AdminYotiVerificationStatus,
  AdminYotiVerificationUserDetail,
} from '../api/adminApi';

const STATUS_BADGE: Record<AdminYotiVerificationStatus, string> = {
  NONE: 'bg-gray-500/20 text-gray-400',
  PENDING: 'bg-yellow-500/20 text-yellow-400',
  APPROVED: 'bg-emerald-500/20 text-emerald-400',
  REJECTED: 'bg-red-500/20 text-red-400',
  VIDEO_UPLOADED: 'bg-gray-500/20 text-gray-400',
  NFC_PROGRAMMED: 'bg-gray-500/20 text-gray-400',
  VERIFIED: 'bg-emerald-500/20 text-emerald-400',
  FLAGGED: 'bg-orange-500/20 text-orange-400',
  REVOKED: 'bg-red-500/20 text-red-400',
};

const fmt = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : '—');

const OVERRIDE_TARGETS: AdminYotiVerificationStatus[] = [
  'VERIFIED',
  'REJECTED',
  'REVOKED',
  'FLAGGED',
  'NONE',
];

export const AdminVerificationDetailPage = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<AdminYotiVerificationDetailResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getYotiVerificationDetail(userId);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load verification detail');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const handleOverride = async (newStatus: AdminYotiVerificationStatus) => {
    if (!userId || !data) return;
    if (newStatus === data.user.seller_verification_status) {
      toast.error(`User is already ${newStatus}`);
      return;
    }
    if (!window.confirm(`Override verification to ${newStatus}? This is audited.`)) return;
    const reason = window.prompt(
      `Reason for override → ${newStatus} (min 10 chars). This is written to the audit log.`,
    );
    if (!reason || reason.trim().length < 10) {
      toast.error('Override cancelled — reason must be at least 10 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await adminApi.overrideYotiVerification(userId, newStatus, reason.trim());
      toast.success(`Status overridden to ${newStatus}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to override verification');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link to="/admin/verifications" className="text-sm text-gray-400 hover:text-white">
          ← Back to verifications
        </Link>
        <div className="glass rounded-2xl p-6 border border-red-500/30">
          <p className="text-red-400 text-sm">{error || 'Verification not found'}</p>
        </div>
      </div>
    );
  }

  const user = data.user as AdminYotiVerificationUserDetail;

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/admin/verifications')}
        className="text-sm text-gray-400 hover:text-white transition-colors"
      >
        ← Back to verifications
      </button>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">
            {user.display_name || user.email}
          </h1>
          <p className="text-gray-400 text-sm">{user.email}</p>
        </div>
        <span
          className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${
            STATUS_BADGE[user.seller_verification_status] ?? 'bg-gray-500/20 text-gray-400'
          }`}
        >
          {user.seller_verification_status}
        </span>
      </div>

      {/* User info */}
      <div className="glass rounded-2xl p-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-gray-400">Submitted</p>
          <p className="text-white">{fmt(user.seller_verification_submitted_at)}</p>
        </div>
        <div>
          <p className="text-gray-400">Reviewed</p>
          <p className="text-white">{fmt(user.seller_verification_reviewed_at)}</p>
        </div>
        <div>
          <p className="text-gray-400">Age Verified</p>
          <p className="text-white">
            {user.age_verified ? `Yes (${fmt(user.age_verified_at)})` : 'No'}
            {user.yoti_age_estimate != null && (
              <span className="text-xs text-gray-500"> — estimate {user.yoti_age_estimate}</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-gray-400">Verification Provider</p>
          <p className="text-white">{user.age_verification_provider ?? '—'}</p>
        </div>
        <div className="md:col-span-2">
          <p className="text-gray-400">Rejection Reason</p>
          <p className="text-white">{user.seller_verification_rejection_reason || '—'}</p>
        </div>
      </div>

      {/* Yoti session history */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          Yoti Sessions ({data.sessions.length})
        </h2>
        {data.sessions.length === 0 ? (
          <p className="text-gray-400 text-sm">No Yoti sessions yet.</p>
        ) : (
          <ul className="space-y-3">
            {data.sessions.map((sess: AdminYotiSessionRow) => (
              <li key={sess.id} className="bg-dark-800 rounded-xl p-3 border border-white/5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <span className="font-mono text-xs text-gray-300">{sess.yoti_session_id}</span>
                  <span className="text-xs text-gray-400">{sess.purpose}</span>
                </div>
                <div className="text-xs text-gray-400">
                  status: <span className="text-white">{sess.status}</span> · last event:{' '}
                  <span className="text-white">{sess.last_event_type ?? '—'}</span> · at:{' '}
                  <span className="text-white">{fmt(sess.last_event_at)}</span>
                  {sess.age_estimate != null && (
                    <> · age est: <span className="text-white">{sess.age_estimate}</span></>
                  )}
                  {sess.rejection_reason && (
                    <> · reason: <span className="text-red-400">{sess.rejection_reason}</span></>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Review / override history */}
      {data.reviews.length > 0 && (
        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Review History</h2>
          <ul className="space-y-3">
            {data.reviews.map((review: AdminYotiVerificationReview) => (
              <li key={review.id} className="bg-dark-800 rounded-xl p-3 border border-white/5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/20 text-gray-300">
                    {review.action}
                  </span>
                  <span className="text-xs text-gray-500">{fmt(review.created_at)}</span>
                </div>
                <p className="text-sm text-gray-300">{review.notes}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {review.previous_status} → {review.new_status}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Override actions */}
      <div className="glass rounded-2xl p-6 border border-white/10">
        <h2 className="text-lg font-semibold text-white mb-3">Manual Override</h2>
        <p className="text-sm text-gray-400 mb-4">
          Force the verification status. Requires a reason ≥ 10 chars. Action is written to the audit
          log + `seller_verification_reviews` table.
        </p>
        <div className="flex flex-wrap gap-2">
          {OVERRIDE_TARGETS.map((target) => (
            <Button
              key={target}
              variant={target === user.seller_verification_status ? 'ghost' : 'secondary'}
              disabled={submitting || target === user.seller_verification_status}
              onClick={() => handleOverride(target)}
            >
              {submitting ? 'Working…' : `Set ${target}`}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
};
