/**
 * NotificationsPage — full paginated notification history with filter tabs.
 *
 * Features:
 *   - Paginated list of all/unread notifications
 *   - Filter tabs: All | Unread
 *   - Click to navigate + mark as read
 *   - Mark all as read button
 *   - Realtime: new notifications appear without refresh
 *   - Dark mode glassmorphism design
 *
 * Route: /notifications (ProtectedRoute)
 *
 * @module features/notifications/pages/NotificationsPage
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
import { useAuth } from '@/features/auth/hooks/useAuth';
import type { Notification } from '../types/notification';

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function typeIcon(type: string): string {
  const map: Record<string, string> = {
    AUCTION_WON:             '🏆',
    AUCTION_OUTBID:          '⬆️',
    PAYMENT_RECEIVED:        '💳',
    PAYOUT_COMPLETED:        '💸',
    ESCROW_RELEASED:         '🔓',
    MESSAGE_RECEIVED:        '💬',
    ITEM_SCANNED:            '📡',
    SETTLEMENT_CASCADE:      '🔁',
    PAYMENT_WINDOW_EXPIRING: '⏰',
    DISPUTE_OPENED:          '⚠️',
  };
  return map[type] ?? '🔔';
}

// ── Component ─────────────────────────────────────────────────────────────────

/** Paginated notifications history page. */
export function NotificationsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getNotifications(page, unreadOnly);
      setNotifications(res.notifications);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch {
      setError('Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [page, unreadOnly]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime: re-fetch on new INSERT
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notifications-page:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => {
        fetchNotifications();
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [user?.id, fetchNotifications]);

  const handleItemClick = async (notif: Notification) => {
    if (!notif.read_at) {
      api.markNotificationRead(notif.id).catch(() => {/* ignore */});
      setNotifications((prev) =>
        prev.map((n) => n.id === notif.id ? { ...n, read_at: new Date().toISOString() } : n)
      );
    }
    if (notif.action_url) {
      if (notif.action_url.startsWith('http')) {
        window.location.href = notif.action_url;
      } else {
        navigate(notif.action_url);
      }
    }
  };

  const handleMarkAllRead = async () => {
    await api.markAllNotificationsRead().catch(() => {/* ignore */});
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: new Date().toISOString() })));
  };

  const handleTabChange = (tab: 'all' | 'unread') => {
    setUnreadOnly(tab === 'unread');
    setPage(1);
  };

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <main id="main-content" className="min-h-screen bg-dark-800 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Notifications</h1>
            <p className="text-sm text-gray-400 mt-1">
              {total > 0 ? `${total} total` : 'No notifications yet'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-sm text-primary-400 hover:text-primary-300 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                Mark all as read
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/settings/notifications')}
              className="text-sm text-gray-400 hover:text-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              Preferences
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-6 p-1 glass rounded-xl" role="tablist">
          {(['all', 'unread'] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={tab === (unreadOnly ? 'unread' : 'all')}
              type="button"
              onClick={() => handleTabChange(tab)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors capitalize focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 ${
                tab === (unreadOnly ? 'unread' : 'all')
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Error state */}
        {error && (
          <div className="glass rounded-2xl p-6 text-center text-red-400 mb-6">{error}</div>
        )}

        {/* Loading */}
        {loading && (
          <div className="glass rounded-2xl p-8 text-center text-gray-400">Loading…</div>
        )}

        {/* Empty state */}
        {!loading && !error && notifications.length === 0 && (
          <div className="glass rounded-2xl p-12 text-center">
            <div className="text-4xl mb-4">🔔</div>
            <p className="text-gray-400">
              {unreadOnly ? 'No unread notifications' : 'No notifications yet'}
            </p>
          </div>
        )}

        {/* Notification list */}
        {!loading && notifications.length > 0 && (
          <div className="glass rounded-2xl overflow-hidden divide-y divide-white/5">
            {notifications.map((notif) => (
              <button
                key={notif.id}
                type="button"
                onClick={() => handleItemClick(notif)}
                className={`w-full text-left px-5 py-4 flex gap-4 hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 ${
                  !notif.read_at ? 'bg-primary-500/5' : ''
                }`}
              >
                {/* Unread dot */}
                <div className="flex-none flex items-center">
                  {!notif.read_at
                    ? <span className="w-2 h-2 rounded-full bg-primary-500" aria-label="Unread" />
                    : <span className="w-2 h-2" aria-hidden="true" />
                  }
                </div>
                {/* Icon */}
                <span className="text-xl flex-none" aria-hidden="true">{typeIcon(notif.type)}</span>
                {/* Content */}
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${notif.read_at ? 'text-gray-300' : 'text-white'}`}>
                    {notif.title}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{notif.body}</p>
                  <p className="text-xs text-gray-500 mt-1">{timeAgo(notif.created_at)}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-300 hover:text-white
                         hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                         focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
            >
              ← Previous
            </button>
            <span className="text-sm text-gray-400">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-300 hover:text-white
                         hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                         focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
