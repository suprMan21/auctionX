/**
 * NotificationBell — header bell icon with unread count badge and dropdown.
 *
 * Features:
 *   - Unread count badge (live via Supabase Realtime)
 *   - Dropdown overlay with last 10 notifications
 *   - Mark individual or all as read
 *   - Navigate to action_url on click
 *   - "View all" → /notifications
 *   - Closes on outside click or Escape key
 *
 * @module features/notifications/components/NotificationBell
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';
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

// ── useUnreadNotificationCount hook ──────────────────────────────────────────

/**
 * Subscribes to unread notification count for the given user.
 * Updates on Realtime INSERT into the notifications table.
 */
export function useUnreadNotificationCount(userId: string | undefined): number {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(() => {
    if (!userId) { setCount(0); return; }
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null)
      .then(({ count: c }) => setCount(c ?? 0));
  }, [userId]);

  useEffect(() => {
    if (!userId) { setCount(0); return; }
    fetchCount();

    const channel = supabase
      .channel(`notif-bell:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, fetchCount)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications' }, fetchCount)
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [userId, fetchCount]);

  return count;
}

// ── NotificationBell component ────────────────────────────────────────────────

interface NotificationBellProps {
  userId: string | undefined;
}

/** Bell icon button with unread badge and dropdown of recent notifications. */
export function NotificationBell({ userId }: NotificationBellProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const unreadCount = useUnreadNotificationCount(userId);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Fetch notifications when dropdown opens
  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true);
    api.getNotifications(1)
      .then((res) => setNotifications(res.notifications.slice(0, 10)))
      .catch(() => {/* ignore */})
      .finally(() => setLoading(false));
  }, [open, userId]);

  const handleItemClick = async (notif: Notification) => {
    // Mark as read
    if (!notif.read_at) {
      api.markNotificationRead(notif.id).catch(() => {/* ignore */});
      setNotifications((prev) =>
        prev.map((n) => n.id === notif.id ? { ...n, read_at: new Date().toISOString() } : n)
      );
    }
    setOpen(false);
    if (notif.action_url) {
      // Navigate to relative path or external URL
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

  if (!userId) return null;

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center justify-center w-10 h-10 rounded-xl text-gray-300
                   hover:text-white hover:bg-white/5 transition-colors
                   focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
      >
        {/* Bell SVG */}
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zm0 16a3 3 0 01-2.83-2h5.66A3 3 0 0110 18z" />
        </svg>
        {/* Unread badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-semibold">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-12 w-80 z-50 glass rounded-2xl border border-white/10 shadow-xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="text-sm font-semibold text-white">Notifications</span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                >
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={() => { setOpen(false); navigate('/notifications'); }}
                className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                View all
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto divide-y divide-white/5">
            {loading && (
              <div className="px-4 py-6 text-center text-sm text-gray-400">Loading…</div>
            )}
            {!loading && notifications.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-gray-400">No notifications yet</div>
            )}
            {!loading && notifications.map((notif) => (
              <button
                key={notif.id}
                type="button"
                onClick={() => handleItemClick(notif)}
                className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-white/5 transition-colors ${
                  !notif.read_at ? 'bg-primary-500/5' : ''
                }`}
              >
                <span className="text-lg flex-none mt-0.5" aria-hidden="true">
                  {typeIcon(notif.type)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-medium leading-tight ${notif.read_at ? 'text-gray-300' : 'text-white'}`}>
                      {notif.title}
                    </p>
                    {!notif.read_at && (
                      <span className="w-2 h-2 rounded-full bg-primary-500 flex-none mt-1" aria-label="Unread" />
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{notif.body}</p>
                  <p className="text-xs text-gray-500 mt-1">{timeAgo(notif.created_at)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
