-- Phase 7A: Add review_sellers admin permission
-- SEPARATE MIGRATION from table creation (lesson #3: enum + RLS same transaction).
-- NOTE: The UPDATE to grant this permission to super_admin is in migration 000003
-- because ADD VALUE cannot be used in the same transaction as a cast to the new value.

-- Idempotent enum append
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'review_sellers'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'admin_permission')
  ) THEN
    ALTER TYPE public.admin_permission ADD VALUE 'review_sellers';
  END IF;
END $$;
