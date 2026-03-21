-- Phase 7A: Add review_sellers admin permission
-- SEPARATE MIGRATION from table creation (lesson #3: enum + RLS same transaction).

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

-- Grant review_sellers to super_admin role
-- Uses ::text cast to avoid enum reference issues (lesson #3)
UPDATE public.admin_roles
SET permissions = array_append(permissions, 'review_sellers'::admin_permission)
WHERE role_name = 'super_admin'
  AND NOT ('review_sellers'::text = ANY(SELECT unnest(permissions)::text));
