-- S-ADMIN1 Ph3b — live checks of admin pricing + free-transfer vouchers on staging
-- (20261024000001_s_admin1_ph3b_pricing_vouchers.sql).
--
-- Leaves NOTHING behind: the whole run is one DO block that ends by raising an
-- exception carrying the results, so every seed row, price, grant, audit row
-- and the temporary failure trigger roll back.
--
-- Run: supabase db query --linked -f supabase/tests/s_admin1_ph3b_live.sql
-- Expect: ERROR  P0001: RESULTS {...} with every check "ok".

DO $$
DECLARE
  v_owner   CONSTANT UUID := '0b211aed-3cf9-4729-818d-f0ed88dd68b8';  -- test@
  v_buyer   CONSTANT UUID := '885d30e1-4322-49a8-8363-b7926991c58d';  -- test2@ (made support below)
  v_admin   CONSTANT UUID := '2b3f1532-9345-4720-8fac-55d07517c78b';  -- super_admin
  v_reason  CONSTANT TEXT := 'Live check S-ADMIN1 Ph3b, rolled back';
  v_tag     UUID := gen_random_uuid();
  v_tag2    UUID := gen_random_uuid();
  v_tag3    UUID := gen_random_uuid();
  v_tag4    UUID := gen_random_uuid();
  v_t1      UUID := gen_random_uuid();   -- recipient pays, uses a voucher
  v_t2      UUID := gen_random_uuid();   -- sender pays, sender has none
  v_t3      UUID := gen_random_uuid();   -- card payment already started
  v_t4      UUID := gen_random_uuid();   -- apply forced to fail -> voucher rolls back
  v_t5      UUID := gen_random_uuid();   -- paid by card via webhook (regression)
  v_support_role UUID;
  v_base    INTEGER;
  v_price   JSONB;
  v_sched   JSONB;
  v_grant   JSONB;
  v_grant2  JSONB;
  v_res     JSONB := '{}'::jsonb;
  v_out     JSONB;
  v_n       INT;
  v_ok      BOOLEAN;
  v_rem     INT;
BEGIN
  -- ── Seed ─────────────────────────────────────────────────────────────────
  INSERT INTO nfc_tags (id, tag_uid, chip_serial, sdm_key_version, seller_id, lifecycle_status, current_owner_id, status, metadata)
  VALUES
    (v_tag,  'FFAD0000PH3B001', upper(encode(gen_random_bytes(8), 'hex')), 2, v_admin, 'ACTIVE', v_owner, 'active', '{"test":"s-admin1-ph3b"}'),
    (v_tag2, 'FFAD0000PH3B002', upper(encode(gen_random_bytes(8), 'hex')), 2, v_admin, 'ACTIVE', v_owner, 'active', '{"test":"s-admin1-ph3b"}'),
    (v_tag3, 'FFAD0000PH3B003', upper(encode(gen_random_bytes(8), 'hex')), 2, v_admin, 'ACTIVE', v_owner, 'active', '{"test":"s-admin1-ph3b"}'),
    (v_tag4, 'FFAD0000PH3B004', upper(encode(gen_random_bytes(8), 'hex')), 2, v_admin, 'ACTIVE', v_owner, 'active', '{"test":"s-admin1-ph3b"}');

  INSERT INTO ownership_transfers (id, tag_id, from_user_id, to_user_id, transfer_type, status, fee_payer, stripe_payment_intent_id, list_amount_usd_cents, payment_method, initiated_at)
  VALUES
    (v_t1, v_tag,  v_owner, v_buyer, 'SALE', 'PENDING', 'BUYER',  NULL,             300, 'card', now()),
    (v_t2, v_tag2, v_owner, v_buyer, 'SALE', 'PENDING', 'SELLER', NULL,             300, 'card', now()),
    (v_t3, v_tag3, v_owner, v_buyer, 'SALE', 'PENDING', 'BUYER',  'pi_ph3b_live_3', 300, 'card', now()),
    (v_t4, v_tag4, v_owner, v_buyer, 'SALE', 'PENDING', 'BUYER',  NULL,             300, 'card', now());

  SELECT role_id INTO v_support_role FROM admin_roles WHERE role_name = 'support';
  INSERT INTO admin_users (admin_id, role_id, brand, is_active) VALUES (v_buyer, v_support_role, 'auctionx', true);

  -- ── Prices ───────────────────────────────────────────────────────────────

  -- 01. Launch defaults are seeded and in effect.
  SELECT count(*) INTO v_n FROM token_prices WHERE reason = 'Launch default (decision 2026-10-03)';
  v_base := current_token_price('transfer');
  v_res := v_res || jsonb_build_object('01_defaults_seeded',
    CASE WHEN v_n >= 3 AND v_base IS NOT NULL AND current_token_price('reissue') IS NOT NULL THEN 'ok'
         ELSE 'FAIL: n=' || v_n || ' transfer=' || coalesce(v_base::text, 'null') END);

  -- 02. Support may not set a price.
  BEGIN
    PERFORM admin_set_token_price(v_buyer, 'transfer', 300, NULL, v_reason);
    v_res := v_res || jsonb_build_object('02_support_forbidden', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('02_support_forbidden', CASE WHEN SQLERRM LIKE 'admin_forbidden%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 03. A plain user (no admin_users row) may not either.
  BEGIN
    PERFORM admin_set_token_price(v_owner, 'transfer', 300, NULL, v_reason);
    v_res := v_res || jsonb_build_object('03_user_forbidden', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('03_user_forbidden', CASE WHEN SQLERRM LIKE 'admin_forbidden%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 04. No backdating.
  BEGIN
    PERFORM admin_set_token_price(v_admin, 'transfer', 300, now() - interval '1 day', v_reason);
    v_res := v_res || jsonb_build_object('04_no_backdating', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('04_no_backdating', CASE WHEN SQLERRM LIKE 'effective_in_past%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 05. Below Stripe's floor is refused by the CHECK.
  BEGIN
    PERFORM admin_set_token_price(v_admin, 'transfer', 49, NULL, v_reason);
    v_res := v_res || jsonb_build_object('05_amount_floor', 'FAIL: no error');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('05_amount_floor', CASE WHEN SQLERRM LIKE '%token_prices_amount_chk%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 06. A NULL reason is refused (the NULL-passes-CHECK trap).
  BEGIN
    PERFORM admin_set_token_price(v_admin, 'transfer', 300, NULL, NULL);
    v_res := v_res || jsonb_build_object('06_reason_null', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('06_reason_null', CASE WHEN SQLERRM LIKE 'reason_required%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 07. Set now: in effect immediately, audited with the previous price.
  v_price := admin_set_token_price(v_admin, 'transfer', 300, NULL, v_reason);
  SELECT count(*) INTO v_n FROM audit_logs
   WHERE action = 'token_price_set' AND entity_id = (v_price->>'id')::uuid AND admin_id = v_admin
     AND (changes->>'previous_amount_usd_cents')::int = v_base AND (changes->>'amount_usd_cents')::int = 300;
  v_res := v_res || jsonb_build_object('07_set_now_audited',
    CASE WHEN current_token_price('transfer') = 300 AND v_n = 1 THEN 'ok'
         ELSE 'FAIL: price=' || current_token_price('transfer') || ' audit=' || v_n END);

  -- 08. Scheduled: not in effect yet; can be cancelled once.
  v_sched := admin_set_token_price(v_admin, 'transfer', 500, now() + interval '7 days', v_reason);
  v_ok := current_token_price('transfer') = 300;
  PERFORM admin_cancel_token_price(v_admin, (v_sched->>'id')::uuid, v_reason);
  SELECT count(*) INTO v_n FROM audit_logs WHERE action = 'token_price_cancel' AND entity_id = (v_sched->>'id')::uuid;
  BEGIN
    PERFORM admin_cancel_token_price(v_admin, (v_sched->>'id')::uuid, v_reason);
    v_res := v_res || jsonb_build_object('08_schedule_cancel', 'FAIL: double cancel allowed');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('08_schedule_cancel',
      CASE WHEN v_ok AND v_n = 1 AND SQLERRM LIKE 'price_already_cancelled%' THEN 'ok' ELSE 'FAIL: ' || v_ok || '/' || v_n || '/' || SQLERRM END);
  END;

  -- 09. A price already in effect cannot be cancelled.
  BEGIN
    PERFORM admin_cancel_token_price(v_admin, (v_price->>'id')::uuid, v_reason);
    v_res := v_res || jsonb_build_object('09_no_cancel_in_effect', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('09_no_cancel_in_effect', CASE WHEN SQLERRM LIKE 'price_already_effective%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- ── Vouchers: grant / revoke ─────────────────────────────────────────────

  -- 10. Support may not grant; an expiry in the past is refused.
  BEGIN
    PERFORM admin_grant_transfer_vouchers(v_buyer, v_buyer, 1, v_reason, NULL);
    v_res := v_res || jsonb_build_object('10_grant_guards', 'FAIL: support granted');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'admin_forbidden%' THEN
      v_res := v_res || jsonb_build_object('10_grant_guards', 'FAIL: ' || SQLERRM);
    ELSE
      BEGIN
        PERFORM admin_grant_transfer_vouchers(v_admin, v_buyer, 1, v_reason, now() - interval '1 hour');
        v_res := v_res || jsonb_build_object('10_grant_guards', 'FAIL: past expiry accepted');
      EXCEPTION WHEN OTHERS THEN
        v_res := v_res || jsonb_build_object('10_grant_guards', CASE WHEN SQLERRM LIKE 'expiry_in_past%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
      END;
    END IF;
  END;

  -- 11. Grant 2 to test2@, audited; available = 2.
  v_grant := admin_grant_transfer_vouchers(v_admin, v_buyer, 2, v_reason, NULL);
  SELECT count(*) INTO v_n FROM audit_logs WHERE action = 'voucher_grant' AND entity_id = (v_grant->>'id')::uuid;
  v_res := v_res || jsonb_build_object('11_grant_audited',
    CASE WHEN v_n = 1 AND available_transfer_vouchers(v_buyer) = 2 THEN 'ok'
         ELSE 'FAIL: audit=' || v_n || ' available=' || available_transfer_vouchers(v_buyer) END);

  -- ── Vouchers: redeem ─────────────────────────────────────────────────────

  -- 12. The recipient pays and has a voucher: the transfer completes for free,
  --     ownership moves, one voucher is used, everything is recorded.
  v_out := redeem_transfer_voucher(v_t1, '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc');
  SELECT remaining INTO v_rem FROM transfer_voucher_grants WHERE id = (v_grant->>'id')::uuid;
  SELECT (t.status = 'COMPLETED' AND t.payment_method = 'voucher' AND t.charged_amount = 0
          AND t.stripe_payment_intent_id IS NULL AND g.current_owner_id = v_buyer
          AND EXISTS (SELECT 1 FROM transfer_voucher_redemptions r WHERE r.transfer_id = v_t1 AND r.user_id = v_buyer AND r.list_amount_usd_cents = 300)
          AND EXISTS (SELECT 1 FROM ownership_proofs p WHERE p.tag_id = v_tag AND p.ownership_event_id = v_t1 AND p.status = 'current' AND p.owner_id = v_buyer))
    INTO v_ok
    FROM ownership_transfers t JOIN nfc_tags g ON g.id = t.tag_id WHERE t.id = v_t1;
  v_res := v_res || jsonb_build_object('12_redeem_applies',
    CASE WHEN v_out->>'outcome' = 'applied' AND v_rem = 1 AND v_ok THEN 'ok'
         ELSE 'FAIL: ' || v_out::text || ' remaining=' || v_rem || ' ok=' || coalesce(v_ok::text, 'null') END);

  -- 13. Redeeming the same transfer again changes nothing.
  v_out := redeem_transfer_voucher(v_t1, '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc');
  SELECT remaining INTO v_rem FROM transfer_voucher_grants WHERE id = (v_grant->>'id')::uuid;
  v_res := v_res || jsonb_build_object('13_redeem_idempotent',
    CASE WHEN v_out->>'outcome' = 'not_payable' AND v_rem = 1 THEN 'ok' ELSE 'FAIL: ' || v_out::text || ' remaining=' || v_rem END);

  -- 14. The sender pays and has no voucher (the recipient's is not used).
  v_out := redeem_transfer_voucher(v_t2, '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc');
  SELECT remaining INTO v_rem FROM transfer_voucher_grants WHERE id = (v_grant->>'id')::uuid;
  SELECT status = 'PENDING' INTO v_ok FROM ownership_transfers WHERE id = v_t2;
  v_res := v_res || jsonb_build_object('14_payer_is_sender',
    CASE WHEN v_out->>'outcome' = 'no_voucher' AND v_rem = 1 AND v_ok THEN 'ok' ELSE 'FAIL: ' || v_out::text || ' remaining=' || v_rem END);

  -- 15. A card payment already started: no voucher.
  v_out := redeem_transfer_voucher(v_t3, '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc');
  SELECT remaining INTO v_rem FROM transfer_voucher_grants WHERE id = (v_grant->>'id')::uuid;
  v_res := v_res || jsonb_build_object('15_not_with_card_intent',
    CASE WHEN v_out->>'outcome' = 'intent_mismatch' AND v_rem = 1 THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- 16. ATOMICITY: the apply fails at its last write -> the voucher use, the
  --     redemption row and the transfer all roll back.
  CREATE OR REPLACE FUNCTION pg_temp.ph3b_fail_proof() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN
    IF NEW.tag_ref = 'ph3b-force-fail' THEN RAISE EXCEPTION 'ph3b_forced_failure'; END IF;
    RETURN NEW;
  END $f$;
  CREATE TRIGGER ph3b_fail_proof BEFORE INSERT ON ownership_proofs
    FOR EACH ROW EXECUTE FUNCTION pg_temp.ph3b_fail_proof();
  BEGIN
    PERFORM redeem_transfer_voucher(v_t4, '0x' || encode(gen_random_bytes(32), 'hex'), 'ph3b-force-fail', 'saltenc');
    v_res := v_res || jsonb_build_object('16_redeem_atomic', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    SELECT remaining INTO v_rem FROM transfer_voucher_grants WHERE id = (v_grant->>'id')::uuid;
    SELECT (t.status = 'PENDING' AND t.payment_method = 'card' AND g.current_owner_id = v_owner
            AND NOT EXISTS (SELECT 1 FROM transfer_voucher_redemptions r WHERE r.transfer_id = v_t4))
      INTO v_ok FROM ownership_transfers t JOIN nfc_tags g ON g.id = t.tag_id WHERE t.id = v_t4;
    v_res := v_res || jsonb_build_object('16_redeem_atomic',
      CASE WHEN v_rem = 1 AND v_ok THEN 'ok' ELSE 'FAIL: remaining=' || v_rem || ' ok=' || v_ok || ' err=' || SQLERRM END);
  END;
  DROP TRIGGER ph3b_fail_proof ON ownership_proofs;

  -- 17. apply_transfer_fee will not complete a transfer for free on its own.
  BEGIN
    PERFORM apply_transfer_fee(v_t4, NULL, '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc', 'voucher');
    v_res := v_res || jsonb_build_object('17_voucher_source_needs_redemption', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('17_voucher_source_needs_redemption',
      CASE WHEN SQLERRM LIKE 'voucher_not_redeemed%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;
  BEGIN
    PERFORM apply_transfer_fee(v_t4, 'pi_x', '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc', 'voucher');
    v_res := v_res || jsonb_build_object('17b_voucher_source_no_intent', 'FAIL: no error');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('17b_voucher_source_no_intent',
      CASE WHEN SQLERRM LIKE 'voucher_with_intent%' THEN 'ok' ELSE 'FAIL: ' || SQLERRM END);
  END;

  -- 18. Revoke: unused vouchers can no longer be used; audited; once only.
  PERFORM admin_revoke_transfer_voucher(v_admin, (v_grant->>'id')::uuid, v_reason);
  SELECT count(*) INTO v_n FROM audit_logs WHERE action = 'voucher_revoke' AND entity_id = (v_grant->>'id')::uuid AND (changes->>'unused')::int = 1;
  v_out := redeem_transfer_voucher(v_t4, '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc');
  BEGIN
    PERFORM admin_revoke_transfer_voucher(v_admin, (v_grant->>'id')::uuid, v_reason);
    v_res := v_res || jsonb_build_object('18_revoke', 'FAIL: double revoke');
  EXCEPTION WHEN OTHERS THEN
    v_res := v_res || jsonb_build_object('18_revoke',
      CASE WHEN v_n = 1 AND v_out->>'outcome' = 'no_voucher' AND available_transfer_vouchers(v_buyer) = 0
                AND SQLERRM LIKE 'grant_already_revoked%' THEN 'ok'
           ELSE 'FAIL: audit=' || v_n || ' out=' || v_out::text || ' err=' || SQLERRM END);
  END;

  -- 19. An expired grant is not used; the soonest-expiring live grant is.
  INSERT INTO transfer_voucher_grants (user_id, quantity, remaining, reason, expires_at, granted_by, created_at)
  VALUES (v_buyer, 1, 1, v_reason, now() - interval '1 minute', v_admin, now() - interval '2 days');
  v_grant2 := admin_grant_transfer_vouchers(v_admin, v_buyer, 1, v_reason, now() + interval '1 day');
  PERFORM admin_grant_transfer_vouchers(v_admin, v_buyer, 1, v_reason, NULL);
  v_out := redeem_transfer_voucher(v_t4, '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc');
  v_res := v_res || jsonb_build_object('19_expiry_order',
    CASE WHEN v_out->>'outcome' = 'applied' AND v_out->>'grant_id' = v_grant2->>'id' AND available_transfer_vouchers(v_buyer) = 1 THEN 'ok'
         ELSE 'FAIL: ' || v_out::text END);

  -- 20. Regression: a card payment still applies through the webhook path.
  -- (One PENDING transfer per tag: retire t2 first.)
  UPDATE ownership_transfers SET status = 'CANCELLED' WHERE id = v_t2;
  INSERT INTO ownership_transfers (id, tag_id, from_user_id, to_user_id, transfer_type, status, fee_payer, stripe_payment_intent_id, initiated_at)
  VALUES (v_t5, v_tag2, v_owner, v_buyer, 'SALE', 'PENDING', 'BUYER', 'pi_ph3b_live_5', now());
  v_out := apply_transfer_fee(v_t5, 'pi_ph3b_live_5', '0x' || encode(gen_random_bytes(32), 'hex'), 'tagref', 'saltenc', 'webhook');
  SELECT current_owner_id = v_buyer INTO v_ok FROM nfc_tags WHERE id = v_tag2;
  v_res := v_res || jsonb_build_object('20_card_path_unchanged',
    CASE WHEN v_out->>'outcome' = 'applied' AND v_ok THEN 'ok' ELSE 'FAIL: ' || v_out::text END);

  -- 21. payment_method accepts 'voucher' and still rejects anything else.
  BEGIN
    UPDATE ownership_transfers SET payment_method = 'bogus' WHERE id = v_t3;
    v_res := v_res || jsonb_build_object('21_payment_method_chk', 'FAIL: bogus accepted');
  EXCEPTION WHEN check_violation THEN
    v_res := v_res || jsonb_build_object('21_payment_method_chk', 'ok');
  END;

  -- 22. No client role can read the new tables or run the new functions.
  v_ok := NOT has_table_privilege('anon', 'public.token_prices', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.token_prices', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.transfer_voucher_grants', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.transfer_voucher_redemptions', 'SELECT')
      AND NOT has_function_privilege('authenticated', 'public.redeem_transfer_voucher(uuid,text,text,text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.admin_set_token_price(uuid,text,integer,timestamptz,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.admin_grant_transfer_vouchers(uuid,uuid,integer,text,timestamptz)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.apply_transfer_fee(uuid,text,text,text,text,text)', 'EXECUTE');
  v_res := v_res || jsonb_build_object('22_no_client_access', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  RAISE EXCEPTION 'RESULTS %', v_res;
END;
$$;
