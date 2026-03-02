/**
 * Admin moderation queue page.
 * Displays flagged listings as cards with assign/approve/reject actions.
 * Note: listing images are not available — moderation_queue join does not include listing_media.
 * @module Module 10 — Admin Dashboard
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { adminApi } from '../api/adminApi';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import type { ModerationQueueItem, ModerationStats } from '../types/admin';

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Status badge for a queue item. */
const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, string> = {
    pending: 'bg-warning-500/20 text-warning-400',
    in_review: 'bg-primary-500/20 text-primary-400',
    approved: 'bg-success-500/20 text-success-400',
    rejected: 'bg-error-500/20 text-error-400',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? 'bg-gray-500/20 text-gray-400'}`}>
      {status.replace('_', ' ')}
    </span>
  );
};

/** Filter pills for status tabs. */
const FilterPills = ({
  active,
  onChange,
}: {
  active: string;
  onChange: (v: string) => void;
}) => {
  const options = [
    { label: 'Pending', value: 'pending' },
    { label: 'In Review', value: 'in_review' },
    { label: 'All', value: '' },
  ];

  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors
                      focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
                      ${active === opt.value
                        ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                        : 'bg-dark-700 text-gray-400 hover:text-white hover:bg-dark-600'
                      }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
};

/** A single moderation queue card. */
const QueueCard = ({
  item,
  onAssign,
  onApprove,
  onReject,
  loading,
}: {
  item: ModerationQueueItem;
  onAssign: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  loading: boolean;
}) => (
  <div className="glass rounded-2xl p-6 space-y-4">
    {/* Header */}
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-white font-medium truncate">
          {item.listings?.title ?? `Listing ${item.listing_id.slice(0, 8)}…`}
        </p>
        {item.listings?.description && (
          <p className="text-gray-400 text-sm mt-1 line-clamp-2">{item.listings.description}</p>
        )}
      </div>
      <StatusBadge status={item.status} />
    </div>

    {/* Flagged reason */}
    <div className="bg-dark-800 rounded-xl p-3">
      <p className="text-xs text-gray-400 font-medium mb-1">Flagged reason</p>
      <p className="text-sm text-white">{item.flagged_reason}</p>
    </div>

    {/* Meta */}
    <div className="flex flex-wrap gap-4 text-xs text-gray-500">
      {item.priority != null && <span>Priority: {item.priority}</span>}
      {item.brand && <span>Brand: {item.brand}</span>}
      <span>Flagged: {item.flagged_by_system ? 'System' : 'Manual'}</span>
      {item.created_at && <span>{new Date(item.created_at).toLocaleDateString()}</span>}
    </div>

    {/* Note: images not available */}
    <p className="text-xs text-gray-600 italic">Listing images not available in moderation queue.</p>

    {/* Actions — only show for actionable statuses */}
    {(item.status === 'pending' || item.status === 'in_review') && (
      <div className="flex flex-wrap gap-2 pt-2 border-t border-white/10">
        {item.status === 'pending' && (
          <Button variant="secondary" size="sm" disabled={loading} onClick={() => onAssign(item.queue_id)}>
            Assign to Me
          </Button>
        )}
        <Button variant="secondary" size="sm" disabled={loading} onClick={() => onApprove(item.queue_id)}>
          Approve
        </Button>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => onReject(item.queue_id)}>
          Reject…
        </Button>
      </div>
    )}
  </div>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * AdminModerationPage — queue of flagged listings with moderation actions.
 */
export const AdminModerationPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get('status') ?? 'pending';

  const [queue, setQueue] = useState<ModerationQueueItem[]>([]);
  const [queueStats, setQueueStats] = useState<ModerationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reject modal
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');

  const load = async (status: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getModerationQueue({ status: status || undefined });
      setQueue(res.queue);
      setQueueStats(res.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(statusFilter); }, [statusFilter]);

  const handleFilterChange = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v) next.set('status', v); else next.delete('status');
      return next;
    });
  };

  const handleAssign = async (queueId: string) => {
    setActionLoading(true);
    try {
      await adminApi.assignModeration(queueId);
      toast.success('Item assigned to you');
      await load(statusFilter);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async (queueId: string) => {
    setActionLoading(true);
    try {
      await adminApi.resolveModeration(queueId, 'approve', 'Approved by admin');
      toast.success('Listing approved');
      await load(statusFilter);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectTarget || !rejectNotes.trim()) return;
    setActionLoading(true);
    try {
      await adminApi.resolveModeration(rejectTarget, 'reject', rejectNotes.trim());
      toast.success('Listing rejected');
      setRejectTarget(null);
      setRejectNotes('');
      await load(statusFilter);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Moderation Queue</h1>
        {queueStats && (
          <p className="text-gray-400 text-sm mt-1">
            {queueStats.pendingCount} pending · {queueStats.inReviewCount} in review
          </p>
        )}
      </div>

      <FilterPills active={statusFilter} onChange={handleFilterChange} />

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="glass rounded-2xl p-6 border border-error-500/30">
          <p className="text-error-400 text-sm">{error}</p>
        </div>
      ) : queue.length === 0 ? (
        <div className="glass rounded-2xl p-6">
          <p className="text-gray-500 text-sm">No items in queue.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {queue.map((item) => (
            <QueueCard
              key={item.queue_id}
              item={item}
              onAssign={handleAssign}
              onApprove={handleApprove}
              onReject={(id) => { setRejectTarget(id); setRejectNotes(''); }}
              loading={actionLoading}
            />
          ))}
        </div>
      )}

      {/* Reject modal */}
      <Modal
        isOpen={rejectTarget !== null}
        onClose={() => { setRejectTarget(null); setRejectNotes(''); }}
        title="Reject Listing"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Rejection notes *</label>
            <textarea
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              rows={4}
              placeholder="Explain why this listing is being rejected…"
              className="w-full px-4 py-3 rounded-xl bg-dark-700 text-white placeholder:text-gray-500
                         border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
                         resize-none"
            />
          </div>
          <Button
            variant="primary"
            fullWidth
            disabled={!rejectNotes.trim() || actionLoading}
            onClick={handleRejectSubmit}
          >
            {actionLoading ? 'Rejecting…' : 'Confirm Reject'}
          </Button>
        </div>
      </Modal>
    </div>
  );
};
