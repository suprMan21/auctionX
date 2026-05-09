import { logger } from './utils/logger.ts';

export interface PostmarkEmailPayload {
  to: string;
  subject: string;
  htmlBody: string;
}

/**
 * Maps notification type string → column name in notification_preferences.
 * Mirrors backend/src/lib/notifications/notificationService.ts PREF_COLUMN_MAP.
 * Types not listed here are treated as always-enabled.
 */
const PREF_COLUMN_MAP: Record<string, string> = {
  AUCTION_WON: 'auction_won',
  AUCTION_OUTBID: 'auction_outbid',
  PAYMENT_RECEIVED: 'payment_received',
  PAYOUT_COMPLETED: 'payout_completed',
  ESCROW_RELEASED: 'escrow_released',
  MESSAGE_RECEIVED: 'message_received',
  ITEM_SCANNED: 'item_scanned',
  SETTLEMENT_CASCADE: 'settlement_cascade',
  PAYMENT_WINDOW_EXPIRING: 'payment_window_expiring',
  DISPUTE_OPENED: 'dispute_opened',
};

/**
 * Resolve whether a user should receive an email for a given notification type,
 * and return their email address if so. Returns null if the user has opted out
 * (master email_enabled=false or per-type pref=false), has no email on record,
 * or fetch fails. Matches the preference-check semantics of the backend
 * notificationService — Deno helpers don't share that code, so this mirrors it.
 */
export async function emailRecipient(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  type: string,
): Promise<string | null> {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .maybeSingle();

    const email = (user as { email?: string } | null)?.email;
    if (!email) return null;

    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('email_enabled, ' + (PREF_COLUMN_MAP[type] ?? ''))
      .eq('user_id', userId)
      .maybeSingle();

    // Permissive default: missing prefs row → opt-in
    if (!prefs) return email;

    const masterEnabled = (prefs as Record<string, unknown>).email_enabled !== false;
    if (!masterEnabled) return null;

    const typeKey = PREF_COLUMN_MAP[type];
    if (!typeKey) return email;
    const typeEnabled = (prefs as Record<string, unknown>)[typeKey] !== false;
    return typeEnabled ? email : null;
  } catch (err) {
    logger.warn('postmark.emailRecipient failed (defaulting to no-send)', {
      error: err instanceof Error ? err.message : String(err),
      userId,
      type,
    });
    return null;
  }
}

export async function sendEmail(payload: PostmarkEmailPayload): Promise<boolean> {
  const token = Deno.env.get('POSTMARK_SERVER_TOKEN');
  const from = Deno.env.get('POSTMARK_FROM_EMAIL') ?? 'noreply@authentic-materials.com';

  if (!token) {
    logger.warn('postmark.send skipped: POSTMARK_SERVER_TOKEN not set', { to: payload.to });
    return false;
  }

  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        From: from,
        To: payload.to,
        Subject: payload.subject,
        HtmlBody: payload.htmlBody,
        MessageStream: 'outbound',
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error('postmark.send failed', undefined, {
        status: res.status,
        body,
        to: payload.to,
        subject: payload.subject,
      });
      return false;
    }

    return true;
  } catch (err) {
    logger.error('postmark.send threw', err as Error, { to: payload.to });
    return false;
  }
}
