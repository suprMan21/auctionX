/**
 * Notification domain types for Module 16.
 *
 * Mirrors the `notifications` and `notification_preferences` DB tables.
 *
 * @module features/notifications/types/notification
 */

/** A single in-app notification row. */
export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  read_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** User notification preference row. */
export interface NotificationPreferences {
  id: string;
  user_id: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  auction_won: boolean;
  auction_outbid: boolean;
  payment_received: boolean;
  payout_completed: boolean;
  escrow_released: boolean;
  message_received: boolean;
  item_scanned: boolean;
  settlement_cascade: boolean;
  payment_window_expiring: boolean;
  dispute_opened: boolean;
  updated_at: string;
}

/** Paginated notifications response from the API. */
export interface NotificationsResponse {
  notifications: Notification[];
  total: number;
  page: number;
  totalPages: number;
}
