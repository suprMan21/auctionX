/**
 * AdminVerificationDetailPage (S22). Mirror of AdminAuctionDetailPage:
 * back link → header → account info → session history → review history →
 * status change gated by window.confirm + window.prompt(reason)
 * + react-hot-toast. Shown as part of "Creator ID checks".
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
import { ACTION_FAILED, NONE, errorMessage, formatWhen as fmt, loadFailed } from '../lib/display';
import { auditActionLabel, codeLabel, idCheckPurposeLabel, idCheckStatusLabel, idSessionStatusLabel } from '../lib/labels';
import { hasPermission, PERMISSIONS, useAdminRole } from '../lib/adminRole';

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
  const canChange = hasPermission(useAdminRole(), PERMISSIONS.manageCreatorIds);
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
      setError(errorMessage(err, loadFailed('This ID check')));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const handleOverride = async (newStatus: AdminYotiVerificationStatus) => {
    if (!userId || !data) return;
    const label = idCheckStatusLabel(newStatus);
    if (newStatus === data.user.seller_verification_status) {
      toast.error(`The status is already ${label}.`);
      return;
    }
    if (!window.confirm(`Change the status to ${label}? This is recorded in the audit log.`)) return;
    const reason = window.prompt(
      `Why are you changing the status to ${label}? At least 10 characters. This is recorded in the audit log.`,
    );
    if (!reason || reason.trim().length < 10) {
      toast.error('Status not changed. The reason needs at least 10 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await adminApi.overrideYotiVerification(userId, newStatus, reason.trim());
      toast.success(`Status changed to ${label}.`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, ACTION_FAILED));
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
          ← All creator ID checks
        </Link>
        <div className="glass rounded-2xl p-6 border border-red-500/30">
          <p className="text-red-400 text-sm">{error || 'ID check not found. Check the link or search again.'}</p>
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
        ← All creator ID checks
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
          title={user.seller_verification_status}
          className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${
            STATUS_BADGE[user.seller_verification_status] ?? 'bg-gray-500/20 text-gray-400'
          }`}
        >
          {idCheckStatusLabel(user.seller_verification_status)}
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
          <p className="text-gray-400">Age verified</p>
          <p className="text-white">
            {user.age_verified ? `Yes (${fmt(user.age_verified_at)})` : 'No'}
            {user.yoti_age_estimate != null && (
              <span className="text-xs text-gray-500"> (estimated age {user.yoti_age_estimate})</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-gray-400">Checked by</p>
          <p className="text-white">{codeLabel(user.age_verification_provider, NONE)}</p>
        </div>
        <div className="md:col-span-2">
          <p className="text-gray-400">Reason for rejection</p>
          <p className="text-white">{user.seller_verification_rejection_reason || NONE}</p>
        </div>
      </div>

      {/* Yoti session history */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          ID check sessions ({data.sessions.length})
        </h2>
        {data.sessions.length === 0 ? (
          <p className="text-gray-400 text-sm">No ID check sessions yet.</p>
        ) : (
          <ul className="space-y-3">
            {data.sessions.map((sess: AdminYotiSessionRow) => (
              <li key={sess.id} className="bg-dark-800 rounded-xl p-3 border border-white/5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <span className="font-mono text-xs text-gray-300">{sess.yoti_session_id}</span>
                  <span className="text-xs text-gray-400">{idCheckPurposeLabel(sess.purpose)}</span>
                </div>
                <div className="text-xs text-gray-400">
                  Status: <span className="text-white">{idSessionStatusLabel(sess.status)}</span> · Last update:{' '}
                  <span className="text-white">{codeLabel(sess.last_event_type, NONE)}</span> · At:{' '}
                  <span className="text-white">{fmt(sess.last_event_at)}</span>
                  {sess.age_estimate != null && (
                    <> · Estimated age: <span className="text-white">{sess.age_estimate}</span></>
                  )}
                  {sess.rejection_reason && (
                    <> · Reason: <span className="text-red-400">{sess.rejection_reason}</span></>
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
          <h2 className="text-lg font-semibold text-white mb-4">Review history</h2>
          <ul className="space-y-3">
            {data.reviews.map((review: AdminYotiVerificationReview) => (
              <li key={review.id} className="bg-dark-800 rounded-xl p-3 border border-white/5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/20 text-gray-300">
                    {auditActionLabel(review.action)}
                  </span>
                  <span className="text-xs text-gray-500">{fmt(review.created_at)}</span>
                </div>
                <p className="text-sm text-gray-300">{review.notes}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {idCheckStatusLabel(review.previous_status)} → {idCheckStatusLabel(review.new_status)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Override actions: admin and super admin only (manage_creator_ids); the API checks too. */}
      {canChange && (
      <div className="glass rounded-2xl p-6 border border-white/10">
        <h2 className="text-lg font-semibold text-white mb-3">Change status</h2>
        <p className="text-sm text-gray-400 mb-4">
          Set the status yourself. You give a reason (at least 10 characters), and the change is recorded in the
          audit log and the review history.
        </p>
        <div className="flex flex-wrap gap-2">
          {OVERRIDE_TARGETS.map((target) => (
            <Button
              key={target}
              variant={target === user.seller_verification_status ? 'ghost' : 'secondary'}
              disabled={submitting || target === user.seller_verification_status}
              onClick={() => handleOverride(target)}
            >
              {submitting ? 'Saving…' : `Set to ${idCheckStatusLabel(target)}…`}
            </Button>
          ))}
        </div>
      </div>
      )}
    </div>
  );
};
