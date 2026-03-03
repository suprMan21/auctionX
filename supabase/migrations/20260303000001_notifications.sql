-- Module 16: Notifications System
-- Creates notifications table, notification_preferences table, indexes, RLS policies, and realtime publication.

-- ── notifications table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              text NOT NULL,
  title             text NOT NULL,
  body              text NOT NULL,
  action_url        text,
  read_at           timestamptz,
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ── notification_preferences table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_preferences (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  in_app_enabled           boolean NOT NULL DEFAULT true,
  email_enabled            boolean NOT NULL DEFAULT true,
  auction_won              boolean NOT NULL DEFAULT true,
  auction_outbid           boolean NOT NULL DEFAULT true,
  payment_received         boolean NOT NULL DEFAULT true,
  payout_completed         boolean NOT NULL DEFAULT true,
  escrow_released          boolean NOT NULL DEFAULT true,
  message_received         boolean NOT NULL DEFAULT true,
  item_scanned             boolean NOT NULL DEFAULT true,
  settlement_cascade       boolean NOT NULL DEFAULT true,
  payment_window_expiring  boolean NOT NULL DEFAULT true,
  dispute_opened           boolean NOT NULL DEFAULT true,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, read_at)
  WHERE read_at IS NULL;

-- ── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- notifications: users may only SELECT and UPDATE their own rows
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'notifications_select_own'
  ) THEN
    CREATE POLICY notifications_select_own ON notifications
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'notifications_update_own'
  ) THEN
    CREATE POLICY notifications_update_own ON notifications
      FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

-- notification_preferences: users may do everything on their own row
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notification_preferences' AND policyname = 'notification_preferences_all_own'
  ) THEN
    CREATE POLICY notification_preferences_all_own ON notification_preferences
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- ── Realtime ─────────────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
