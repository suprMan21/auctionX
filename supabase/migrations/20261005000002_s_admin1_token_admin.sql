-- S-ADMIN1 Ph1 — token admin console foundations.
--
--   1. Roles: manage_nfc for super_admin + a new 'admin' role.
--   2. nfc_tags: optional suspension / retirement / destruction columns.
--   3. Retired chips are frozen (Locked 2026-10-02: never reused).
--   4. audit_logs is append-only.
--   5. admin_set_tag_suspension(): ACTIVE <-> SUSPENDED, audited.
--   6. admin_reset_token(): the token reset in ONE transaction, replacing the
--      five-write, non-atomic POST /nfc/replace.
--
-- Schema-extension rules: optional columns only, nothing renamed/retyped.
-- The manage_nfc enum value was added in 20261005000001 (separate transaction).

-- ── 1. Roles ────────────────────────────────────────────────────────────────

UPDATE admin_roles
   SET permissions = array_append(permissions, 'manage_nfc'::admin_permission)
 WHERE role_name = 'super_admin'
   AND NOT ('manage_nfc'::admin_permission = ANY (permissions));

-- user_role has 'admin' but admin_roles never seeded one. Token admins get NFC
-- management plus read access; no manage_admins (only super_admin grants roles).
INSERT INTO admin_roles (role_name, permissions)
VALUES ('admin', ARRAY['view_users', 'view_audit_logs', 'manage_nfc']::admin_permission[])
ON CONFLICT (role_name) DO NOTHING;

-- ── 2. nfc_tags columns ─────────────────────────────────────────────────────

ALTER TABLE nfc_tags ADD COLUMN IF NOT EXISTS suspended_at       TIMESTAMPTZ;
ALTER TABLE nfc_tags ADD COLUMN IF NOT EXISTS suspended_reason   TEXT;
ALTER TABLE nfc_tags ADD COLUMN IF NOT EXISTS retired_at         TIMESTAMPTZ;
ALTER TABLE nfc_tags ADD COLUMN IF NOT EXISTS retired_reason     TEXT;
ALTER TABLE nfc_tags ADD COLUMN IF NOT EXISTS replaced_by_tag_id UUID REFERENCES nfc_tags(id);
ALTER TABLE nfc_tags ADD COLUMN IF NOT EXISTS destruction_status TEXT;

DO $$ BEGIN
  ALTER TABLE nfc_tags
    ADD CONSTRAINT nfc_tags_destruction_status_chk
    CHECK (destruction_status IS NULL OR destruction_status IN ('PENDING', 'DESTROYED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Retired chips are frozen ─────────────────────────────────────────────
-- Once RETIRED, nothing may bring the chip back, give it an owner, or point it
-- at an item or key version again. Only destruction tracking may change.

CREATE OR REPLACE FUNCTION nfc_tags_freeze_retired()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.lifecycle_status = 'RETIRED' AND (
       NEW.lifecycle_status   IS DISTINCT FROM OLD.lifecycle_status
    OR NEW.current_owner_id   IS DISTINCT FROM OLD.current_owner_id
    OR NEW.item_id            IS DISTINCT FROM OLD.item_id
    OR NEW.linked_item_id     IS DISTINCT FROM OLD.linked_item_id
    OR NEW.sdm_key_version    IS DISTINCT FROM OLD.sdm_key_version
    OR NEW.tag_uid            IS DISTINCT FROM OLD.tag_uid
    OR NEW.replaced_by_tag_id IS DISTINCT FROM OLD.replaced_by_tag_id
  ) THEN
    RAISE EXCEPTION 'tag_retired: a retired tag cannot be changed or reused'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nfc_tags_freeze_retired ON nfc_tags;
CREATE TRIGGER nfc_tags_freeze_retired
  BEFORE UPDATE ON nfc_tags
  FOR EACH ROW EXECUTE FUNCTION nfc_tags_freeze_retired();

-- ── 4. audit_logs is append-only ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_logs_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

-- ── Shared: the acting admin must hold manage_nfc ───────────────────────────
-- Defence in depth: the API already checks this, but the functions refuse to
-- run for anyone else even if called with the service key by mistake.

CREATE OR REPLACE FUNCTION admin_nfc_actor_email(p_admin UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT au.email INTO v_email
    FROM admin_users a
    JOIN admin_roles r ON r.role_id = a.role_id
    JOIN auth.users au ON au.id = a.admin_id
   WHERE a.admin_id = p_admin
     AND a.is_active
     AND 'manage_nfc'::admin_permission = ANY (r.permissions);

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'admin_forbidden: actor lacks manage_nfc' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_email;
END;
$$;

-- ── 5. Suspend / unsuspend ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_set_tag_suspension(
  p_tag     UUID,
  p_suspend BOOLEAN,
  p_admin   UUID,
  p_reason  TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  TEXT := admin_nfc_actor_email(p_admin);
  v_status nfc_lifecycle_status;
  v_new    nfc_lifecycle_status;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT lifecycle_status INTO v_status FROM nfc_tags WHERE id = p_tag FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tag_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_suspend AND v_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'invalid_state: only an ACTIVE tag can be suspended (is %)', v_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT p_suspend AND v_status IS DISTINCT FROM 'SUSPENDED' THEN
    RAISE EXCEPTION 'invalid_state: only a SUSPENDED tag can be unsuspended (is %)', v_status
      USING ERRCODE = 'check_violation';
  END IF;

  v_new := CASE WHEN p_suspend THEN 'SUSPENDED' ELSE 'ACTIVE' END;

  -- sun_counter is deliberately untouched.
  UPDATE nfc_tags
     SET lifecycle_status = v_new,
         suspended_at     = CASE WHEN p_suspend THEN now() ELSE NULL END,
         suspended_reason = CASE WHEN p_suspend THEN p_reason ELSE NULL END
   WHERE id = p_tag;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email,
    CASE WHEN p_suspend THEN 'tag_suspend' ELSE 'tag_unsuspend' END,
    'nfc_tag', p_tag,
    jsonb_build_object('before', jsonb_build_object('lifecycle_status', v_status),
                       'after',  jsonb_build_object('lifecycle_status', v_new)),
    p_reason, 'auctionx'
  );

  RETURN v_new::TEXT;
END;
$$;

-- ── 6. Token reset (master replace) ─────────────────────────────────────────
-- Moves ownership, item link, disclosure and history onto a new ENROLLED chip,
-- retires the old chip permanently (marked for destruction) and rotates the
-- Ownership ID. All-or-nothing: any failure rolls back every step.
--
-- The proof is minted by the backend first (the salt envelope key never enters
-- the database) and passed in. p_custody_id is that proof's ownership event id
-- and becomes the ownership_transfers row id.

CREATE OR REPLACE FUNCTION admin_reset_token(
  p_old_tag      UUID,
  p_new_tag      UUID,
  p_admin        UUID,
  p_reason       TEXT,
  p_custody_id   UUID,
  p_ownership_id TEXT,
  p_tag_ref      TEXT,
  p_salt_enc     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := admin_nfc_actor_email(p_admin);
  v_old   nfc_tags%ROWTYPE;
  v_new   nfc_tags%ROWTYPE;
  v_now   TIMESTAMPTZ := now();
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;
  IF p_old_tag = p_new_tag THEN
    RAISE EXCEPTION 'same_tag' USING ERRCODE = 'check_violation';
  END IF;

  -- Lock both rows in a fixed order so two concurrent resets cannot deadlock.
  PERFORM 1 FROM nfc_tags WHERE id IN (p_old_tag, p_new_tag) ORDER BY id FOR UPDATE;

  SELECT * INTO v_old FROM nfc_tags WHERE id = p_old_tag;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'old_tag_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_new FROM nfc_tags WHERE id = p_new_tag;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'new_tag_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_old.lifecycle_status NOT IN ('ACTIVE', 'SUSPENDED') THEN
    RAISE EXCEPTION 'old_tag_invalid_state: %', v_old.lifecycle_status USING ERRCODE = 'check_violation';
  END IF;
  IF v_old.current_owner_id IS NULL THEN
    RAISE EXCEPTION 'old_tag_no_owner' USING ERRCODE = 'check_violation';
  END IF;
  IF v_new.lifecycle_status IS DISTINCT FROM 'ENROLLED' OR v_new.current_owner_id IS NOT NULL THEN
    RAISE EXCEPTION 'new_tag_not_enrolled: %', v_new.lifecycle_status USING ERRCODE = 'check_violation';
  END IF;
  -- A pending transfer points at the old chip; resetting under it would let the
  -- webhook later apply a paid transfer to a retired tag.
  IF EXISTS (SELECT 1 FROM ownership_transfers WHERE tag_id = p_old_tag AND status = 'PENDING') THEN
    RAISE EXCEPTION 'transfer_pending' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE nfc_tags
     SET lifecycle_status = 'ACTIVE',
         current_owner_id = v_old.current_owner_id,
         linked_item_id   = v_old.linked_item_id,
         item_id          = v_old.item_id,
         disclosure       = v_old.disclosure,
         activated_at     = v_now,
         status           = 'active'
   WHERE id = p_new_tag;

  UPDATE nfc_tags
     SET lifecycle_status   = 'RETIRED',
         current_owner_id   = NULL,
         status             = 'retired',
         retired_at         = v_now,
         retired_reason     = p_reason,
         replaced_by_tag_id = p_new_tag,
         destruction_status = 'PENDING'
   WHERE id = p_old_tag;

  INSERT INTO ownership_transfers (
    id, tag_id, from_user_id, to_user_id, transfer_type, status,
    reissued_token, requires_reverification, initiated_at, completed_at,
    list_amount_usd_cents, charged_amount, charged_currency, fx_rate
  ) VALUES (
    p_custody_id, p_new_tag, v_old.current_owner_id, v_old.current_owner_id, 'REISSUE', 'COMPLETED',
    true, false, v_now, v_now,
    0, 0, 'usd', 1
  );

  UPDATE ownership_proofs SET status = 'stale'
   WHERE tag_id IN (p_old_tag, p_new_tag) AND status = 'current';

  INSERT INTO ownership_proofs (
    tag_id, ownership_event_id, ownership_event_type, ownership_id, tag_ref, salt_enc, owner_id, status
  ) VALUES (
    p_new_tag, p_custody_id, 'transfer', p_ownership_id, p_tag_ref, p_salt_enc, v_old.current_owner_id, 'current'
  );

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email, 'tag_reset', 'nfc_tag', p_old_tag,
    jsonb_build_object(
      'before', jsonb_build_object('old_tag', jsonb_build_object('lifecycle_status', v_old.lifecycle_status),
                                   'new_tag', jsonb_build_object('lifecycle_status', v_new.lifecycle_status)),
      'after',  jsonb_build_object('old_tag', jsonb_build_object('lifecycle_status', 'RETIRED',
                                                                 'destruction_status', 'PENDING'),
                                   'new_tag', jsonb_build_object('id', p_new_tag, 'lifecycle_status', 'ACTIVE')),
      'custody_record_id', p_custody_id
    ),
    p_reason, 'auctionx'
  );

  RETURN jsonb_build_object(
    'old_tag_id', p_old_tag,
    'new_tag_id', p_new_tag,
    'owner_id',   v_old.current_owner_id
  );
END;
$$;

-- ── Grants: backend (service_role) only ─────────────────────────────────────
-- Supabase's default privileges grant EXECUTE on new functions to anon and
-- authenticated; revoke explicitly (lesson: check grants, not just RLS).

REVOKE ALL ON FUNCTION admin_nfc_actor_email(UUID)                                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_set_tag_suspension(UUID, BOOLEAN, UUID, TEXT)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_reset_token(UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nfc_tags_freeze_retired()                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION audit_logs_append_only()                                     FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION admin_set_tag_suspension(UUID, BOOLEAN, UUID, TEXT)          TO service_role;
GRANT EXECUTE ON FUNCTION admin_reset_token(UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;
