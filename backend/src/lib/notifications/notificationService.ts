/**
 * notificationService — preference-aware in-app and email notification delivery.
 *
 * Usage:
 *   import { notificationService } from '../lib/notifications/notificationService';
 *   await notificationService.send(serviceClient, {
 *     userId: '...', type: 'AUCTION_WON', title: '...', body: '...', actionUrl: '/settlements/...'
 *   });
 *
 * The caller must pass a Supabase service-role client so that notifications can be
 * inserted for any user regardless of RLS. Never use the anon/user-scoped client here.
 *
 * Preference checking:
 *   - Fetches (or upserts defaults for) the user's notification_preferences row.
 *   - Checks in_app_enabled AND the type-specific boolean column before inserting.
 *   - Checks email_enabled AND the type-specific boolean column before sending email.
 *   - Unknown types bypass preference filtering (treated as always-enabled).
 *
 * @module notificationService
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from './emailSender';

/** Shape of a notification to deliver. */
export interface NotificationPayload {
  userId: string;
  type: string;
  title: string;
  body: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Maps notification type string → column name in notification_preferences.
 * Types not listed here are treated as always-enabled.
 */
const PREF_COLUMN_MAP: Record<string, string> = {
  AUCTION_WON:              'auction_won',
  AUCTION_OUTBID:           'auction_outbid',
  PAYMENT_RECEIVED:         'payment_received',
  PAYOUT_COMPLETED:         'payout_completed',
  ESCROW_RELEASED:          'escrow_released',
  MESSAGE_RECEIVED:         'message_received',
  ITEM_SCANNED:             'item_scanned',
  SETTLEMENT_CASCADE:       'settlement_cascade',
  PAYMENT_WINDOW_EXPIRING:  'payment_window_expiring',
  DISPUTE_OPENED:           'dispute_opened',
};

type PrefsRow = Record<string, boolean | string | null>;

/**
 * Fetch (or upsert with defaults) the notification_preferences row for a user.
 * Uses service client to bypass RLS.
 */
async function fetchPreferences(supabase: SupabaseClient, userId: string): Promise<PrefsRow> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[notificationService] fetchPreferences error:', error.message);
    // Return permissive defaults on fetch failure
    return { in_app_enabled: true, email_enabled: true };
  }

  if (data) return data as PrefsRow;

  // Upsert defaults (first time for this user)
  const { data: inserted, error: insertError } = await supabase
    .from('notification_preferences')
    .insert({ user_id: userId })
    .select('*')
    .single();

  if (insertError || !inserted) {
    console.error('[notificationService] upsert preferences error:', insertError?.message);
    return { in_app_enabled: true, email_enabled: true };
  }

  return inserted as PrefsRow;
}

/**
 * Check whether a specific notification should be sent, based on user preferences.
 * @param prefs - The user's preference row.
 * @param channel - 'in_app' or 'email'
 * @param type - Notification type string (e.g. 'AUCTION_WON')
 */
function isEnabled(prefs: PrefsRow, channel: 'in_app' | 'email', type: string): boolean {
  const masterKey = channel === 'in_app' ? 'in_app_enabled' : 'email_enabled';
  if (prefs[masterKey] === false) return false;

  const typeKey = PREF_COLUMN_MAP[type];
  if (!typeKey) return true; // Unknown type → always send
  return prefs[typeKey] !== false;
}

class NotificationService {
  /**
   * Send a single notification to one user.
   * Inserts an in-app notification row and optionally sends an email.
   * Errors are caught and logged — notification failures never throw.
   */
  async send(supabase: SupabaseClient, payload: NotificationPayload): Promise<void> {
    try {
      const prefs = await fetchPreferences(supabase, payload.userId);

      // ── In-app notification ──────────────────────────────────────────────
      if (isEnabled(prefs, 'in_app', payload.type)) {
        const { error } = await supabase.from('notifications').insert({
          user_id: payload.userId,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          action_url: payload.actionUrl ?? null,
          metadata: payload.metadata ?? {},
        });

        if (error) {
          console.error('[notificationService] in-app insert error:', error.message, {
            userId: payload.userId,
            type: payload.type,
          });
        }
      }

      // ── Email notification ───────────────────────────────────────────────
      if (isEnabled(prefs, 'email', payload.type)) {
        // Fetch user's email
        const { data: user } = await supabase
          .from('users')
          .select('email')
          .eq('id', payload.userId)
          .maybeSingle();

        const userEmail = (user as { email?: string } | null)?.email;
        if (userEmail) {
          await sendEmail({
            to: userEmail,
            subject: payload.title,
            html: `<p>${payload.body}</p>${payload.actionUrl
              ? `<p><a href="${payload.actionUrl}">View details</a></p>`
              : ''}`,
          }).catch((err: unknown) => {
            console.error('[notificationService] email send error:', err);
          });
        }
      }
    } catch (err) {
      // Never let notification errors propagate to callers
      console.error('[notificationService] send error (non-fatal):', err);
    }
  }

  /**
   * Send notifications to multiple users in parallel.
   * Uses Promise.allSettled so a single failure doesn't block others.
   */
  async sendBatch(supabase: SupabaseClient, payloads: NotificationPayload[]): Promise<void> {
    await Promise.allSettled(payloads.map((p) => this.send(supabase, p)));
  }
}

/** Singleton instance — import and call directly from controllers. */
export const notificationService = new NotificationService();
