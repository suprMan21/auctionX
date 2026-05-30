-- S23 (Phase 7A close-out) — seller_verification email preferences.
--
-- Adds two boolean columns to `notification_preferences` so users can opt out
-- of the post-Yoti seller_verification approval / rejection emails wired in
-- the same session.
--
-- Schema-lock posture: extension-only. Optional columns appended; DEFAULT true
-- + NOT NULL so existing rows (and the implicit Auth default-row insert path
-- in notificationService.fetchPreferences) backfill silently.
--
-- Companion code changes:
--   - backend/src/lib/notifications/notificationService.ts — PREF_COLUMN_MAP
--     gains SELLER_VERIFICATION_APPROVED + SELLER_VERIFICATION_REJECTED entries
--   - backend/src/lib/notifications/emailTemplates.ts — adds 2 templates
--   - backend/src/controllers/yotiVerificationController.ts — replaces the two
--     TODO(S23) postmark_stub log lines with real notificationService.send calls

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS seller_verification_approved boolean NOT NULL DEFAULT true;

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS seller_verification_rejected boolean NOT NULL DEFAULT true;
