-- Fix generate_token_name RPC after users.username → users.display_name rename (v25.0 reconciliation).
-- Original definition lives in 20260301100000_nfc_verification.sql; that file has been applied to prod,
-- so we redefine via CREATE OR REPLACE here rather than editing the original migration.

CREATE OR REPLACE FUNCTION generate_token_name(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_display_name TEXT;
  v_count        INTEGER;
BEGIN
  SELECT display_name INTO v_display_name FROM users WHERE id = p_user_id;
  IF v_display_name IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM item_verifications
  WHERE seller_id = p_user_id;

  RETURN v_display_name || '_' || LPAD((v_count + 1)::TEXT, 2, '0');
END;
$$;
