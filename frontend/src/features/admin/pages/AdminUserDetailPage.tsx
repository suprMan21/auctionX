/**
 * Admin user detail page.
 * Shows user info, listing/bid history, and action modals (suspend/unsuspend/ban/unban).
 * @module Module 10 — Admin Dashboard
 */

import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { adminApi } from '../api/adminApi';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import type { AdminUser, AdminUserStats } from '../types/admin';

// ─── Types ────────────────────────────────────────────────────────────────────

type ModalType = 'suspend' | 'ban' | 'unban' | null;

interface RecentListing {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

interface RecentBid {
  id: string;
  amount_cents: number;
  created_at: string;
  auction_id: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Status badge for user detail header. */
const StatusBadge = ({ user }: { user: AdminUser }) => {
  if (user.is_banned) {
    return <span className="px-3 py-1 rounded-full text-xs font-medium bg-error-500/20 text-error-500">Banned</span>;
  }
  if (user.is_suspended) {
    return <span className="px-3 py-1 rounded-full text-xs font-medium bg-warning-500/20 text-warning-500">Suspended</span>;
  }
  return <span className="px-3 py-1 rounded-full text-xs font-medium bg-success-500/20 text-success-500">Active</span>;
};

/** Listing status badge. */
const ListingStatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, string> = {
    ACTIVE: 'bg-success-500/20 text-success-500',
    DRAFT: 'bg-gray-500/20 text-gray-400',
    SOLD: 'bg-primary-500/20 text-primary-400',
    CANCELLED: 'bg-error-500/20 text-error-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? 'bg-gray-500/20 text-gray-400'}`}>
      {status}
    </span>
  );
};

/** Suspend form embedded in modal. */
const SuspendForm = ({
  onSubmit,
  loading,
}: {
  onSubmit: (durationHours: number, reason: string) => void;
  loading: boolean;
}) => {
  const [reason, setReason] = useState('');
  const [durationHours, setDurationHours] = useState(24);

  const durationOptions = [
    { label: '1 hour', value: 1 },
    { label: '24 hours', value: 24 },
    { label: '72 hours (3 days)', value: 72 },
    { label: '168 hours (1 week)', value: 168 },
    { label: '720 hours (30 days)', value: 720 },
  ];

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Duration</label>
        <select
          value={durationHours}
          onChange={(e) => setDurationHours(Number(e.target.value))}
          className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-dark-700 text-white border border-transparent
                     focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
        >
          {durationOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Reason *</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Reason for suspension…"
          className="w-full px-4 py-3 rounded-xl bg-dark-700 text-white placeholder:text-gray-500
                     border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
                     resize-none"
        />
      </div>

      <Button
        variant="primary"
        fullWidth
        disabled={!reason.trim() || loading}
        onClick={() => onSubmit(durationHours, reason.trim())}
      >
        {loading ? 'Suspending…' : 'Confirm Suspend'}
      </Button>
    </div>
  );
};

/** Reason-only form embedded in modal (for ban/unban). */
const ReasonForm = ({
  label,
  buttonLabel,
  onSubmit,
  loading,
  requireReason,
}: {
  label: string;
  buttonLabel: string;
  onSubmit: (reason: string) => void;
  loading: boolean;
  requireReason: boolean;
}) => {
  const [reason, setReason] = useState('');

  return (
    <div className="space-y-4">
      {requireReason && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">{label} *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Enter reason…"
            className="w-full px-4 py-3 rounded-xl bg-dark-700 text-white placeholder:text-gray-500
                       border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
                       resize-none"
          />
        </div>
      )}

      <Button
        variant="primary"
        fullWidth
        disabled={(requireReason && !reason.trim()) || loading}
        onClick={() => onSubmit(reason.trim())}
      >
        {loading ? 'Processing…' : buttonLabel}
      </Button>
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * AdminUserDetailPage — full user profile with action buttons and modals.
 */
export const AdminUserDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [user, setUser] = useState<AdminUser | null>(null);
  const [stats, setStats] = useState<AdminUserStats | null>(null);
  const [listings, setListings] = useState<RecentListing[]>([]);
  const [bids, setBids] = useState<RecentBid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [detailRes, listingsRes, bidsRes] = await Promise.all([
        adminApi.getUser(id),
        supabase
          .from('listings')
          .select('id, title, status, created_at')
          .eq('seller_id', id)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('bids')
          .select('id, amount_cents, created_at, auction_id')
          .eq('bidder_id', id)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      setUser(detailRes.user);
      setStats(detailRes.stats);
      setListings((listingsRes.data ?? []) as RecentListing[]);
      setBids((bidsRes.data ?? []) as RecentBid[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleSuspend = async (durationHours: number, reason: string) => {
    if (!id) return;
    setActionLoading(true);
    try {
      await adminApi.suspendUser(id, durationHours, reason);
      toast.success('User suspended');
      setActiveModal(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to suspend user');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsuspend = async () => {
    if (!id) return;
    setActionLoading(true);
    try {
      await adminApi.unsuspendUser(id);
      toast.success('User unsuspended');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unsuspend user');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBan = async (reason: string) => {
    if (!id) return;
    setActionLoading(true);
    try {
      await adminApi.banUser(id, reason);
      toast.success('User banned');
      setActiveModal(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to ban user');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnban = async () => {
    if (!id) return;
    setActionLoading(true);
    try {
      await adminApi.unbanUser(id);
      toast.success('User unbanned');
      setActiveModal(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unban user');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="glass rounded-2xl p-6 border border-error-500/30">
        <p className="text-error-400 text-sm">{error ?? 'User not found'}</p>
        <button onClick={() => navigate('/admin/users')} className="mt-3 text-primary-400 text-sm hover:text-primary-300">
          ← Back to users
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Link to="/admin/users" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
        ← Back to Users
      </Link>

      {/* User info card */}
      <div className="glass rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-white">{user.email}</h1>
              <StatusBadge user={user} />
            </div>
            {user.display_name && <p className="text-gray-400">{user.display_name}</p>}
            <div className="flex flex-wrap gap-4 pt-2 text-sm text-gray-400">
              <span>Tier: <span className="text-white">{user.seller_tier}</span></span>
              <span>Sales: <span className="text-white">${(user.lifetime_sales_cents / 100).toLocaleString()}</span></span>
              <span>Joined: <span className="text-white">{new Date(user.created_at).toLocaleDateString()}</span></span>
              {user.last_login_at && (
                <span>Last login: <span className="text-white">{new Date(user.last_login_at).toLocaleDateString()}</span></span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {!user.is_banned && !user.is_suspended && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setActiveModal('suspend')}>Suspend</Button>
                <Button variant="secondary" size="sm" onClick={() => setActiveModal('ban')}>Ban</Button>
              </>
            )}
            {user.is_suspended && !user.is_banned && (
              <>
                <Button variant="secondary" size="sm" onClick={handleUnsuspend} disabled={actionLoading}>
                  {actionLoading ? 'Processing…' : 'Unsuspend'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setActiveModal('ban')}>Ban</Button>
              </>
            )}
            {user.is_banned && (
              <Button variant="secondary" size="sm" onClick={() => setActiveModal('unban')}>Unban</Button>
            )}
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="mt-6 pt-6 border-t border-white/10 grid grid-cols-3 gap-4">
            <div>
              <p className="text-2xl font-bold text-white">{stats.listingsCount}</p>
              <p className="text-xs text-gray-400">Total Listings</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats.activeListingsCount}</p>
              <p className="text-xs text-gray-400">Active</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats.soldListingsCount}</p>
              <p className="text-xs text-gray-400">Sold</p>
            </div>
          </div>
        )}
      </div>

      {/* Recent Listings */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Recent Listings</h2>
        {listings.length === 0 ? (
          <p className="text-gray-500 text-sm">No listings.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left pb-2 text-gray-400 font-medium">Title</th>
                  <th className="text-left pb-2 text-gray-400 font-medium">Status</th>
                  <th className="text-left pb-2 text-gray-400 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {listings.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 text-white pr-4 max-w-[200px] truncate">{l.title}</td>
                    <td className="py-2 pr-4"><ListingStatusBadge status={l.status} /></td>
                    <td className="py-2 text-gray-400">{new Date(l.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Bids */}
      <div className="glass rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Recent Bids</h2>
        {bids.length === 0 ? (
          <p className="text-gray-500 text-sm">No bids.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left pb-2 text-gray-400 font-medium">Amount</th>
                  <th className="text-left pb-2 text-gray-400 font-medium">Auction ID</th>
                  <th className="text-left pb-2 text-gray-400 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {bids.map((b) => (
                  <tr key={b.id}>
                    <td className="py-2 text-white pr-4">${(b.amount_cents / 100).toLocaleString()}</td>
                    <td className="py-2 text-gray-400 pr-4 font-mono text-xs">{b.auction_id.slice(0, 12)}…</td>
                    <td className="py-2 text-gray-400">{new Date(b.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Suspend modal */}
      <Modal isOpen={activeModal === 'suspend'} onClose={() => setActiveModal(null)} title="Suspend User">
        <SuspendForm onSubmit={handleSuspend} loading={actionLoading} />
      </Modal>

      {/* Ban modal */}
      <Modal isOpen={activeModal === 'ban'} onClose={() => setActiveModal(null)} title="Ban User">
        <ReasonForm
          label="Reason for ban"
          buttonLabel="Confirm Ban"
          onSubmit={handleBan}
          loading={actionLoading}
          requireReason
        />
      </Modal>

      {/* Unban modal */}
      <Modal isOpen={activeModal === 'unban'} onClose={() => setActiveModal(null)} title="Unban User">
        <p className="text-gray-300 mb-4">Are you sure you want to remove this user's ban?</p>
        <ReasonForm
          label=""
          buttonLabel="Confirm Unban"
          onSubmit={handleUnban}
          loading={actionLoading}
          requireReason={false}
        />
      </Modal>
    </div>
  );
};
