/**
 * NotificationPreferencesPage — toggle switches for all notification preference columns.
 *
 * Features:
 *   - Fetches existing preferences on mount (upserts defaults if none)
 *   - Toggle switches grouped by section
 *   - in_app_enabled is always locked to true (labeled "Always on")
 *   - Debounced PUT on change (300ms)
 *   - Success toast on save
 *   - Dark mode glassmorphism design
 *
 * Route: /settings/notifications (ProtectedRoute)
 *
 * @module features/notifications/pages/NotificationPreferencesPage
 */

import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import type { NotificationPreferences } from '../types/notification';

// ── Types ─────────────────────────────────────────────────────────────────────

type BooleanPrefs = Omit<NotificationPreferences, 'id' | 'user_id' | 'updated_at' | 'in_app_enabled'>;

interface Section {
  label: string;
  items: Array<{ key: keyof BooleanPrefs; label: string; description: string }>;
}

// ── Preference sections ───────────────────────────────────────────────────────

const SECTIONS: Section[] = [
  {
    label: 'Email Notifications',
    items: [
      { key: 'email_enabled', label: 'Email notifications', description: 'Master toggle for all email notifications' },
    ],
  },
  {
    label: 'Auctions',
    items: [
      { key: 'auction_won', label: 'Auction won', description: 'When you win an auction' },
      { key: 'auction_outbid', label: 'Outbid alerts', description: 'When someone outbids you' },
      { key: 'settlement_cascade', label: 'Purchase offers', description: 'When a cascaded purchase offer comes to you' },
      { key: 'payment_window_expiring', label: 'Payment window expiring', description: 'Reminder before your payment window closes' },
    ],
  },
  {
    label: 'Payments & Payouts',
    items: [
      { key: 'payment_received', label: 'Payment received', description: 'When payment is confirmed for your listing' },
      { key: 'payout_completed', label: 'Payout initiated', description: 'When your payout is sent to your account' },
      { key: 'escrow_released', label: 'Escrow released', description: 'When escrow funds are released' },
      { key: 'dispute_opened', label: 'Disputes', description: 'When a dispute is opened on a settlement' },
    ],
  },
  {
    label: 'Messages & Items',
    items: [
      { key: 'message_received', label: 'New messages', description: 'When you receive a message from another user' },
      { key: 'item_scanned', label: 'NFC scans', description: 'When your NFC-verified item is scanned' },
    ],
  },
];

// ── Toggle component ──────────────────────────────────────────────────────────

function Toggle({
  id,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 ${
        checked ? 'bg-primary-600' : 'bg-gray-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/** Notification preferences settings page. */
export function NotificationPreferencesPage() {
  const [prefs, setPrefs] = useState<BooleanPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPrefsRef = useRef<BooleanPrefs | null>(null);

  // Fetch preferences on mount
  useEffect(() => {
    api.getNotificationPreferences()
      .then((p) => {
        const { id: _id, user_id: _uid, updated_at: _ua, in_app_enabled: _ia, ...rest } = p;
        setPrefs(rest);
        latestPrefsRef.current = rest;
      })
      .catch(() => setError('Failed to load preferences'))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = (key: keyof BooleanPrefs, value: boolean) => {
    setPrefs((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, [key]: value };
      latestPrefsRef.current = updated;

      // Debounced save
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        if (!latestPrefsRef.current) return;
        try {
          await api.updateNotificationPreferences(latestPrefsRef.current);
          toast.success('Preferences saved');
        } catch {
          toast.error('Failed to save preferences');
        }
      }, 300);

      return updated;
    });
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-dark-800 py-8 px-4">
        <div className="max-w-xl mx-auto glass rounded-2xl p-8 text-center text-gray-400">Loading…</div>
      </main>
    );
  }

  if (error || !prefs) {
    return (
      <main className="min-h-screen bg-dark-800 py-8 px-4">
        <div className="max-w-xl mx-auto glass rounded-2xl p-8 text-center text-red-400">
          {error ?? 'Something went wrong'}
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-screen bg-dark-800 py-8 px-4">
      <div className="max-w-xl mx-auto">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-2 text-sm text-gray-400">
            <li><Link to="/profile" className="hover:text-white transition-colors">Profile</Link></li>
            <li aria-hidden="true">›</li>
            <li className="text-gray-200" aria-current="page">Notification Preferences</li>
          </ol>
        </nav>

        <h1 className="text-2xl font-bold text-white mb-2">Notification Preferences</h1>
        <p className="text-sm text-gray-400 mb-8">
          Control which notifications you receive. In-app notifications are always on.
        </p>

        {/* In-app always-on note */}
        <div className="glass rounded-2xl p-4 mb-6 flex items-center gap-3 border border-primary-500/20">
          <span className="text-primary-400 text-lg" aria-hidden="true">🔔</span>
          <div>
            <p className="text-sm font-medium text-white">In-app notifications are always enabled</p>
            <p className="text-xs text-gray-400">You'll always receive notifications in the app. Use the toggles below to control email delivery.</p>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-6">
          {SECTIONS.map((section) => (
            <div key={section.label} className="glass rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/10">
                <h2 className="text-sm font-semibold text-gray-200">{section.label}</h2>
              </div>
              <div className="divide-y divide-white/5">
                {section.items.map((item) => {
                  const value = prefs[item.key] as boolean;
                  return (
                    <div key={item.key} className="flex items-center justify-between px-5 py-4 gap-4">
                      <div className="min-w-0">
                        <label
                          htmlFor={`pref-${item.key}`}
                          className="text-sm font-medium text-gray-200 cursor-pointer"
                        >
                          {item.label}
                        </label>
                        <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
                      </div>
                      <Toggle
                        id={`pref-${item.key}`}
                        checked={value}
                        onChange={(val) => handleToggle(item.key, val)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-gray-500 mt-8 text-center">
          Changes are saved automatically.
        </p>
      </div>
    </main>
  );
}
