/**
 * notificationController — in-app notification management endpoints.
 *
 * Routes:
 *   GET    /api/v1/notifications                  — list user's notifications (paginated)
 *   PATCH  /api/v1/notifications/:id/read         — mark single notification read
 *   POST   /api/v1/notifications/mark-all-read    — bulk mark all unread as read
 *   GET    /api/v1/notifications/preferences      — get/upsert notification preferences
 *   PUT    /api/v1/notifications/preferences      — update notification preferences
 *
 * All routes require authentication (requireAuth middleware applied in routes file).
 * Service client is used for all DB operations to bypass RLS; user_id is always
 * applied manually to prevent cross-user data access.
 *
 * @module notificationController
 */

import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { RequestWithId } from '../middleware/requestId';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';

interface NotifRequest extends RequestWithId, AuthRequest {}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ── Allowed preference keys (prevents arbitrary column writes) ────────────────

const PREF_BOOLEAN_COLUMNS = new Set([
  'email_enabled',
  'auction_won',
  'auction_outbid',
  'payment_received',
  'payout_completed',
  'escrow_released',
  'message_received',
  'item_scanned',
  'settlement_cascade',
  'payment_window_expiring',
  'dispute_opened',
]);

// ── GET /api/v1/notifications ─────────────────────────────────────────────────

/**
 * List paginated notifications for the authenticated user.
 * Optional query params: page (default 1), limit (default 20), unread (boolean).
 */
export const listNotifications = async (req: NotifRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const page = Math.max(1, parseInt(String(req.query['page'] ?? '1'), 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query['limit'] ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT));
    const unreadOnly = req.query['unread'] === 'true';
    const from = (page - 1) * limit;

    const supabase = getServiceClient();

    let query = supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (unreadOnly) {
      query = query.is('read_at', null);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error('list_notifications_failed', { userId, error: error.message });
      throw new AppError('internal', 'Failed to fetch notifications');
    }

    logger.info('notifications_listed', { userId, count: data?.length ?? 0, unreadOnly });

    return res.json({
      success: true,
      data: {
        notifications: data ?? [],
        total: count ?? 0,
        page,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── PATCH /api/v1/notifications/:id/read ─────────────────────────────────────

/**
 * Mark a single notification as read.
 * Sets read_at = NOW() only if the notification belongs to the requesting user.
 */
export const markRead = async (req: NotifRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const { id } = req.params;
    if (!id) throw new AppError('invalid_argument', 'Notification id is required');

    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)  // Ownership check
      .is('read_at', null)    // Idempotent — only update unread
      .select('id')
      .maybeSingle();

    if (error) {
      logger.error('mark_read_failed', { userId, notificationId: id, error: error.message });
      throw new AppError('internal', 'Failed to mark notification as read');
    }

    logger.info('notification_marked_read', { userId, notificationId: id, updated: !!data });

    return res.json({ success: true });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── POST /api/v1/notifications/mark-all-read ─────────────────────────────────

/**
 * Mark all unread notifications as read for the authenticated user.
 */
export const markAllRead = async (req: NotifRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const supabase = getServiceClient();

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);

    if (error) {
      logger.error('mark_all_read_failed', { userId, error: error.message });
      throw new AppError('internal', 'Failed to mark notifications as read');
    }

    logger.info('all_notifications_marked_read', { userId });

    return res.json({ success: true });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── GET /api/v1/notifications/preferences ────────────────────────────────────

/**
 * Fetch notification preferences for the authenticated user.
 * If no row exists, upserts a default row and returns it.
 */
export const getPreferences = async (req: NotifRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const supabase = getServiceClient();

    let { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error('get_preferences_failed', { userId, error: error.message });
      throw new AppError('internal', 'Failed to fetch preferences');
    }

    if (!data) {
      // Upsert defaults
      const inserted = await supabase
        .from('notification_preferences')
        .insert({ user_id: userId })
        .select('*')
        .single();

      if (inserted.error || !inserted.data) {
        logger.error('upsert_preferences_failed', { userId, error: inserted.error?.message });
        throw new AppError('internal', 'Failed to create default preferences');
      }

      data = inserted.data;
    }

    logger.info('preferences_fetched', { userId });

    return res.json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// ── PUT /api/v1/notifications/preferences ────────────────────────────────────

/**
 * Update notification preferences for the authenticated user.
 * Only allows updating boolean preference columns (not id, user_id, updated_at).
 * Note: in_app_enabled cannot be set to false via this endpoint (always-on for in-app).
 */
export const updatePreferences = async (req: NotifRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const body = req.body as Record<string, unknown>;

    // Whitelist only allowed boolean columns
    const updates: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(body)) {
      if (PREF_BOOLEAN_COLUMNS.has(key) && typeof value === 'boolean') {
        updates[key] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError('invalid_argument', 'No valid preference fields provided');
    }

    updates['updated_at' as string] = new Date().toISOString() as unknown as boolean;

    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from('notification_preferences')
      .upsert(
        { user_id: userId, ...updates },
        { onConflict: 'user_id' }
      )
      .select('*')
      .single();

    if (error || !data) {
      logger.error('update_preferences_failed', { userId, error: error?.message });
      throw new AppError('internal', 'Failed to update preferences');
    }

    logger.info('preferences_updated', { userId, fields: Object.keys(updates) });

    return res.json({ success: true, data });
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
