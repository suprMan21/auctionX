-- Phase 7A: Grant review_sellers permission to super_admin role
-- Must be a separate migration from ADD VALUE (lesson #3: new enum values
-- cannot be referenced in the same transaction they are created in).

UPDATE public.admin_roles
SET permissions = array_append(permissions, 'review_sellers'::admin_permission)
WHERE role_name = 'super_admin'
  AND NOT ('review_sellers'::text = ANY(SELECT unnest(permissions)::text));
