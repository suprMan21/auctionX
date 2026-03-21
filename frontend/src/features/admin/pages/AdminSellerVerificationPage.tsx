import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { adminApi } from '../api/adminApi';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import type { SellerVerificationQueueItem, SellerVerificationDetail } from '../types/admin';

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-yellow-500/20 text-yellow-400',
  APPROVED: 'bg-emerald-500/20 text-emerald-400',
  REJECTED: 'bg-red-500/20 text-red-400',
  REVOKED: 'bg-red-500/20 text-red-400',
};

const DOC_TYPE_LABELS: Record<string, string> = {
  government_id: 'Government ID',
  selfie_with_id: 'Selfie with ID',
  proof_of_address: 'Proof of Address',
  business_license: 'Business License',
};

const FilterPills = ({ active, onChange }: { active: string; onChange: (v: string) => void }) => {
  const options = [
    { label: 'Pending', value: 'PENDING' },
    { label: 'Approved', value: 'APPROVED' },
    { label: 'Rejected', value: 'REJECTED' },
    { label: 'All', value: '' },
  ];

  return (
    <div className="flex gap-2 flex-wrap">
      {options.map(opt => (
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

const QueueCard = ({
  item,
  onSelect,
}: {
  item: SellerVerificationQueueItem;
  onSelect: (userId: string) => void;
}) => (
  <button
    onClick={() => onSelect(item.userId)}
    className="glass rounded-2xl p-6 text-left w-full transition-colors hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
  >
    <div className="flex items-start justify-between gap-2 mb-3">
      <div className="min-w-0">
        <p className="text-white font-medium truncate">
          {item.displayName || item.email}
        </p>
        <p className="text-gray-400 text-sm truncate">{item.email}</p>
      </div>
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[item.status] || 'bg-gray-500/20 text-gray-400'}`}>
        {item.status}
      </span>
    </div>
    <div className="flex flex-wrap gap-4 text-xs text-gray-400">
      <span>{item.documentCount} document{item.documentCount !== 1 ? 's' : ''}</span>
      {item.submittedAt && <span>Submitted {new Date(item.submittedAt).toLocaleDateString()}</span>}
      <span>Joined {new Date(item.createdAt).toLocaleDateString()}</span>
    </div>
  </button>
);

export const AdminSellerVerificationPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get('status') ?? 'PENDING';

  const [queue, setQueue] = useState<SellerVerificationQueueItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detail view
  const [detail, setDetail] = useState<SellerVerificationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Reject modal
  const [rejectUserId, setRejectUserId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');

  const loadQueue = async (status: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getSellerVerificationQueue({ status: status || undefined });
      setQueue(res.data.queue);
      setPendingCount(res.data.stats.pendingCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadQueue(statusFilter); }, [statusFilter]);

  const handleFilterChange = (v: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (v) next.set('status', v); else next.delete('status');
      return next;
    });
    setDetail(null);
  };

  const handleSelectUser = async (userId: string) => {
    setDetailLoading(true);
    try {
      const res = await adminApi.getSellerVerificationDetail(userId);
      setDetail(res.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load detail');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!detail) return;
    setActionLoading(true);
    try {
      await adminApi.approveSellerVerification(detail.user.id, 'Approved via admin review');
      toast.success('Seller approved');
      setDetail(null);
      await loadQueue(statusFilter);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectUserId || !rejectReason.trim() || !rejectNotes.trim()) return;
    setActionLoading(true);
    try {
      await adminApi.rejectSellerVerification(rejectUserId, rejectReason.trim(), rejectNotes.trim());
      toast.success('Seller rejected');
      setRejectUserId(null);
      setRejectReason('');
      setRejectNotes('');
      setDetail(null);
      await loadQueue(statusFilter);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBackToQueue = () => setDetail(null);

  // Detail view
  if (detail) {
    return (
      <div className="space-y-6">
        <button onClick={handleBackToQueue} className="text-sm text-gray-400 hover:text-white transition-colors focus:outline-none">
          &larr; Back to queue
        </button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{detail.user.displayName || detail.user.email}</h1>
            <p className="text-gray-400 text-sm">{detail.user.email}</p>
          </div>
          <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${STATUS_BADGE[detail.user.status] || 'bg-gray-500/20 text-gray-400'}`}>
            {detail.user.status}
          </span>
        </div>

        {/* User info */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">User Info</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-400">Joined</p>
              <p className="text-white">{new Date(detail.user.createdAt).toLocaleDateString()}</p>
            </div>
            {detail.user.submittedAt && (
              <div>
                <p className="text-gray-400">Submitted</p>
                <p className="text-white">{new Date(detail.user.submittedAt).toLocaleDateString()}</p>
              </div>
            )}
            {detail.user.reviewedAt && (
              <div>
                <p className="text-gray-400">Reviewed</p>
                <p className="text-white">{new Date(detail.user.reviewedAt).toLocaleDateString()}</p>
              </div>
            )}
            {detail.user.sellerTier && (
              <div>
                <p className="text-gray-400">Seller Tier</p>
                <p className="text-white">{detail.user.sellerTier}</p>
              </div>
            )}
          </div>
          {detail.user.rejectionReason && (
            <div className="mt-4 p-3 bg-red-500/10 rounded-xl border border-red-500/20">
              <p className="text-xs text-gray-400 font-medium mb-1">Previous Rejection Reason</p>
              <p className="text-sm text-red-400">{detail.user.rejectionReason}</p>
            </div>
          )}
        </div>

        {/* Documents */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">
            Documents ({detail.documents.length})
          </h2>
          {detail.documents.length === 0 ? (
            <p className="text-gray-400 text-sm">No documents uploaded.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {detail.documents.map(doc => (
                <div key={doc.id} className="bg-dark-800 rounded-xl p-4 border border-white/5">
                  <p className="text-sm font-medium text-white mb-2">
                    {DOC_TYPE_LABELS[doc.document_type] || doc.document_type}
                  </p>
                  {doc.mime_type.startsWith('image/') ? (
                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={doc.file_url}
                        alt={doc.document_type}
                        className="w-full h-48 object-cover rounded-lg border border-white/10 mb-2"
                      />
                    </a>
                  ) : (
                    <a
                      href={doc.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center h-48 rounded-lg border border-white/10 bg-white/5 mb-2 text-gray-400 hover:text-white transition-colors"
                    >
                      View PDF
                    </a>
                  )}
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                    {doc.file_size_bytes && <span>{(doc.file_size_bytes / 1024).toFixed(0)} KB</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Review History */}
        {detail.reviews.length > 0 && (
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Review History</h2>
            <div className="space-y-3">
              {detail.reviews.map(review => (
                <div key={review.id} className="bg-dark-800 rounded-xl p-3 border border-white/5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      review.action === 'approve' ? 'bg-emerald-500/20 text-emerald-400'
                      : review.action === 'reject' ? 'bg-red-500/20 text-red-400'
                      : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {review.action}
                    </span>
                    <span className="text-xs text-gray-500">{new Date(review.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-gray-300">{review.notes}</p>
                  <p className="text-xs text-gray-500 mt-1">{review.previous_status} &rarr; {review.new_status}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {detail.user.status === 'PENDING' && (
          <div className="flex gap-3">
            <Button variant="primary" disabled={actionLoading} onClick={handleApprove}>
              {actionLoading ? 'Approving...' : 'Approve'}
            </Button>
            <Button variant="secondary" disabled={actionLoading} onClick={() => {
              setRejectUserId(detail.user.id);
              setRejectReason('');
              setRejectNotes('');
            }}>
              Reject
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Queue list view
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Seller Verification</h1>
        <p className="text-gray-400 text-sm mt-1">
          {pendingCount} pending review{pendingCount !== 1 ? 's' : ''}
        </p>
      </div>

      <FilterPills active={statusFilter} onChange={handleFilterChange} />

      {loading || detailLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="glass rounded-2xl p-6 border border-red-500/30">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      ) : queue.length === 0 ? (
        <div className="glass rounded-2xl p-6">
          <p className="text-gray-400 text-sm">No sellers in this queue.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {queue.map(item => (
            <QueueCard key={item.userId} item={item} onSelect={handleSelectUser} />
          ))}
        </div>
      )}

      {/* Reject modal */}
      <Modal
        isOpen={rejectUserId !== null}
        onClose={() => { setRejectUserId(null); setRejectReason(''); setRejectNotes(''); }}
        title="Reject Seller Verification"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Reason (shown to seller) *
            </label>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
              placeholder="e.g., ID photo is blurry, please resubmit a clear photo..."
              className="w-full px-4 py-3 rounded-xl bg-dark-700 text-white placeholder:text-gray-400
                border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
                resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Internal notes *
            </label>
            <textarea
              value={rejectNotes}
              onChange={e => setRejectNotes(e.target.value)}
              rows={2}
              placeholder="Internal notes for admin audit trail..."
              className="w-full px-4 py-3 rounded-xl bg-dark-700 text-white placeholder:text-gray-400
                border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
                resize-none"
            />
          </div>
          <Button
            variant="primary"
            fullWidth
            disabled={!rejectReason.trim() || !rejectNotes.trim() || actionLoading}
            onClick={handleRejectSubmit}
          >
            {actionLoading ? 'Rejecting...' : 'Confirm Reject'}
          </Button>
        </div>
      </Modal>
    </div>
  );
};
