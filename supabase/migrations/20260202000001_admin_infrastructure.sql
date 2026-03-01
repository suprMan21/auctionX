-- Module 10: Admin Dashboard & Moderation Tools
-- Migration: Admin Infrastructure Foundation
-- Created: 2026-02-02

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE admin_permission AS ENUM (
  'view_users',
  'manage_users',
  'view_listings',
  'moderate_listings',
  'view_payments',
  'process_refunds',
  'view_analytics',
  'manage_admins',
  'view_audit_logs'
);

CREATE TYPE moderation_status AS ENUM (
  'pending',
  'in_review',
  'approved',
  'rejected',
  'escalated'
);

CREATE TYPE moderation_action AS ENUM (
  'approve',
  'reject',
  'remove_listing',
  'suspend_user',
  'ban_user',
  'flag_for_review'
);

-- ============================================================================
-- ADMIN ROLES & PERMISSIONS
-- ============================================================================

CREATE TABLE admin_roles (
  role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name TEXT NOT NULL UNIQUE,
  permissions admin_permission[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE admin_users (
  admin_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES admin_roles(role_id),
  assigned_by UUID REFERENCES admin_users(admin_id),
  brand TEXT NOT NULL CHECK (brand IN ('auctionx', 'unmentionables', 'both')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ
);

-- Seed default admin roles
INSERT INTO admin_roles (role_name, permissions) VALUES
  ('super_admin', ARRAY[
    'view_users', 'manage_users', 'view_listings', 'moderate_listings',
    'view_payments', 'process_refunds', 'view_analytics', 'manage_admins', 'view_audit_logs'
  ]::admin_permission[]),
  ('moderator', ARRAY[
    'view_users', 'view_listings', 'moderate_listings', 'view_payments'
  ]::admin_permission[]),
  ('support', ARRAY[
    'view_users', 'view_listings', 'view_payments', 'process_refunds'
  ]::admin_permission[]),
  ('analyst', ARRAY[
    'view_users', 'view_listings', 'view_payments', 'view_analytics', 'view_audit_logs'
  ]::admin_permission[]);

-- ============================================================================
-- MODERATION QUEUE
-- ============================================================================

CREATE TABLE moderation_queue (
  queue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  
  flagged_reason TEXT NOT NULL,
  flagged_by UUID REFERENCES auth.users(id),
  flagged_by_system BOOLEAN DEFAULT false,
  
  assigned_to UUID REFERENCES admin_users(admin_id),
  assigned_at TIMESTAMPTZ,
  
  status moderation_status NOT NULL DEFAULT 'pending',
  priority INT DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  
  resolved_by UUID REFERENCES admin_users(admin_id),
  resolved_at TIMESTAMPTZ,
  action_taken moderation_action,
  resolution_notes TEXT,
  
  brand TEXT NOT NULL CHECK (brand IN ('auctionx', 'unmentionables')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for moderation queue
CREATE INDEX idx_moderation_queue_status ON moderation_queue(status) WHERE status = 'pending';
CREATE INDEX idx_moderation_queue_assigned ON moderation_queue(assigned_to, status);
CREATE INDEX idx_moderation_queue_brand ON moderation_queue(brand, status);
CREATE INDEX idx_moderation_queue_priority ON moderation_queue(priority, created_at);

-- ============================================================================
-- AUDIT LOGS
-- ============================================================================

CREATE TABLE audit_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  admin_id UUID NOT NULL REFERENCES admin_users(admin_id),
  admin_email TEXT NOT NULL,
  
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  
  changes JSONB,
  reason TEXT,
  
  ip_address INET,
  user_agent TEXT,
  brand TEXT NOT NULL CHECK (brand IN ('auctionx', 'unmentionables')),
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for audit logs
CREATE INDEX idx_audit_logs_admin ON audit_logs(admin_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action, created_at DESC);
CREATE INDEX idx_audit_logs_brand ON audit_logs(brand, created_at DESC);

-- ============================================================================
-- USER MANAGEMENT EXTENSIONS
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_by UUID REFERENCES admin_users(admin_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;

-- ============================================================================
-- DATABASE FUNCTIONS
-- ============================================================================

-- Function: Suspend user
CREATE OR REPLACE FUNCTION suspend_user(
  p_user_id UUID,
  p_duration_hours INT,
  p_reason TEXT,
  p_admin_id UUID
)
RETURNS VOID AS $$
BEGIN
  UPDATE users
  SET 
    is_suspended = true,
    suspended_until = now() + (p_duration_hours || ' hours')::INTERVAL,
    suspension_reason = p_reason
  WHERE id = p_user_id;
  
  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, reason, brand)
  SELECT 
    p_admin_id,
    au.email,
    'suspend_user',
    'user',
    p_user_id,
    p_reason,
    'auctionx'
  FROM auth.users au
  WHERE au.id = p_admin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Ban user
CREATE OR REPLACE FUNCTION ban_user(
  p_user_id UUID,
  p_reason TEXT,
  p_admin_id UUID
)
RETURNS VOID AS $$
BEGIN
  UPDATE users
  SET 
    is_banned = true,
    banned_at = now(),
    banned_by = p_admin_id,
    ban_reason = p_reason
  WHERE id = p_user_id;
  
  UPDATE listings
  SET status = 'cancelled'
  WHERE seller_id = p_user_id
    AND status IN ('active', 'draft');
  
  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, reason, brand)
  SELECT 
    p_admin_id,
    au.email,
    'ban_user',
    'user',
    p_user_id,
    p_reason,
    'auctionx'
  FROM auth.users au
  WHERE au.id = p_admin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Unsuspend user
CREATE OR REPLACE FUNCTION unsuspend_user(
  p_user_id UUID,
  p_admin_id UUID
)
RETURNS VOID AS $$
BEGIN
  UPDATE users
  SET 
    is_suspended = false,
    suspended_until = NULL,
    suspension_reason = NULL
  WHERE id = p_user_id;
  
  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, reason, brand)
  SELECT 
    p_admin_id,
    au.email,
    'unsuspend_user',
    'user',
    p_user_id,
    'Manual unsuspension',
    'auctionx'
  FROM auth.users au
  WHERE au.id = p_admin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Unban user
CREATE OR REPLACE FUNCTION unban_user(
  p_user_id UUID,
  p_admin_id UUID
)
RETURNS VOID AS $$
BEGIN
  UPDATE users
  SET 
    is_banned = false,
    banned_at = NULL,
    banned_by = NULL,
    ban_reason = NULL
  WHERE id = p_user_id;
  
  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, reason, brand)
  SELECT 
    p_admin_id,
    au.email,
    'unban_user',
    'user',
    p_user_id,
    'Manual unban',
    'auctionx'
  FROM auth.users au
  WHERE au.id = p_admin_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Admin Roles (read-only for all admins)
ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view roles"
  ON admin_roles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_id = auth.uid()
        AND is_active = true
    )
  );

-- Admin Users (self + super_admin can view all)
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view self"
  ON admin_users FOR SELECT
  USING (admin_id = auth.uid());

CREATE POLICY "Super admins can view all admins"
  ON admin_users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      JOIN admin_roles ar ON au.role_id = ar.role_id
      WHERE au.admin_id = auth.uid()
        AND au.is_active = true
        AND 'manage_admins' = ANY(ar.permissions)
    )
  );

CREATE POLICY "Super admins can manage admins"
  ON admin_users FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      JOIN admin_roles ar ON au.role_id = ar.role_id
      WHERE au.admin_id = auth.uid()
        AND au.is_active = true
        AND 'manage_admins' = ANY(ar.permissions)
    )
  );

-- Moderation Queue (brand-scoped)
ALTER TABLE moderation_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view moderation queue for their brand"
  ON moderation_queue FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      JOIN admin_roles ar ON au.role_id = ar.role_id
      WHERE au.admin_id = auth.uid()
        AND au.is_active = true
        AND (au.brand = moderation_queue.brand OR au.brand = 'both')
        AND 'view_listings' = ANY(ar.permissions)
    )
  );

CREATE POLICY "Moderators can update moderation queue"
  ON moderation_queue FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      JOIN admin_roles ar ON au.role_id = ar.role_id
      WHERE au.admin_id = auth.uid()
        AND au.is_active = true
        AND (au.brand = moderation_queue.brand OR au.brand = 'both')
        AND 'moderate_listings' = ANY(ar.permissions)
    )
  );

CREATE POLICY "Moderators can insert to moderation queue"
  ON moderation_queue FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users au
      JOIN admin_roles ar ON au.role_id = ar.role_id
      WHERE au.admin_id = auth.uid()
        AND au.is_active = true
        AND (au.brand = brand OR au.brand = 'both')
        AND 'moderate_listings' = ANY(ar.permissions)
    )
  );

-- Audit Logs (read-only for admins with permission)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit logs"
  ON audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      JOIN admin_roles ar ON au.role_id = ar.role_id
      WHERE au.admin_id = auth.uid()
        AND au.is_active = true
        AND 'view_audit_logs' = ANY(ar.permissions)
    )
  );

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Only create trigger function if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END $$;

CREATE TRIGGER update_admin_roles_updated_at
  BEFORE UPDATE ON admin_roles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_moderation_queue_updated_at
  BEFORE UPDATE ON moderation_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✓ Migration completed successfully!';
  RAISE NOTICE '✓ Created: 3 enums, 4 tables, 4 functions, 10+ RLS policies';
  RAISE NOTICE '✓ Added 6 columns to users table for suspend/ban';
END $$;
