-- S-ANCHOR1 Ph1 — live checks for 20261027000004_s_anchor1_registry.
--
-- Leaves NOTHING behind: one DO block that ends by raising an exception with
-- the results, so every batch, alert and proof change rolls back. Uses two
-- existing ownership_proofs rows (needs at least two unbatched proofs).
--
-- Run: supabase db query --linked -f supabase/tests/s_anchor1_live.sql
-- Expect: ERROR  P0001: RESULTS {"ok": 20, "total": 20, "failures": {}}

DO $$
DECLARE
  v_reg   CONSTANT TEXT := '0x' || repeat('1', 40);
  v_chain CONSTANT INTEGER := 84532;
  v_root  CONSTANT TEXT := '0x' || repeat('a', 64);
  v_pad   CONSTANT TEXT := '0x' || repeat('b', 64);
  v_tx    CONSTANT TEXT := '0x' || repeat('c', 64);
  v_p1    RECORD;
  v_p2    RECORD;
  v_leaves JSONB;
  v_batch UUID;
  v_batch2 UUID;
  v_created BOOLEAN;
  v_ok    BOOLEAN;
  v_t     TEXT;
  v_n     INTEGER;
  v_res   JSONB := '{}'::jsonb;
BEGIN
  SELECT id, ownership_id INTO v_p1 FROM ownership_proofs WHERE anchor_batch_id IS NULL ORDER BY created_at LIMIT 1;
  SELECT id, ownership_id INTO v_p2 FROM ownership_proofs WHERE anchor_batch_id IS NULL AND id <> v_p1.id ORDER BY created_at LIMIT 1;
  IF v_p1.id IS NULL OR v_p2.id IS NULL THEN
    RAISE EXCEPTION 'need two unbatched ownership_proofs rows';
  END IF;

  -- 01. RLS on, no policies, on all three new tables.
  SELECT count(*) INTO v_n FROM pg_class
   WHERE relname IN ('anchor_batches', 'anchor_chain_state', 'anchor_alerts') AND relrowsecurity;
  v_ok := v_n = 3 AND NOT EXISTS (SELECT 1 FROM pg_policies
                                   WHERE tablename IN ('anchor_batches', 'anchor_chain_state', 'anchor_alerts'));
  v_res := v_res || jsonb_build_object('01_rls_no_policies', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_n END);

  -- 02. anon and authenticated hold no privilege on the new tables.
  v_ok := NOT (has_table_privilege('anon', 'anchor_batches', 'SELECT')
            OR has_table_privilege('authenticated', 'anchor_batches', 'SELECT')
            OR has_table_privilege('anon', 'anchor_alerts', 'SELECT')
            OR has_table_privilege('authenticated', 'anchor_alerts', 'INSERT')
            OR has_table_privilege('anon', 'anchor_chain_state', 'UPDATE')
            OR has_table_privilege('authenticated', 'anchor_chain_state', 'SELECT'));
  v_res := v_res || jsonb_build_object('02_no_table_grants', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 03. Functions: service_role only.
  v_ok := NOT has_function_privilege('anon', 'record_anchor_batch(text,date,timestamptz,text,text,integer,text,jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'record_anchor_batch(text,date,timestamptz,text,text,integer,text,jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'confirm_anchor_batch(uuid,text,bigint,timestamptz)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'confirm_anchor_batch(uuid,text,bigint,timestamptz)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'record_anchor_alert(text,text,jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'record_anchor_alert(text,text,jsonb)', 'EXECUTE')
      AND has_function_privilege('service_role', 'record_anchor_batch(text,date,timestamptz,text,text,integer,text,jsonb)', 'EXECUTE')
      AND has_function_privilege('service_role', 'confirm_anchor_batch(uuid,text,bigint,timestamptz)', 'EXECUTE')
      AND has_function_privilege('service_role', 'record_anchor_alert(text,text,jsonb)', 'EXECUTE');
  v_res := v_res || jsonb_build_object('03_function_grants', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 04. A daily batch files both proofs with their paths.
  v_leaves := jsonb_build_array(
    jsonb_build_object('proof_id', v_p1.id, 'ownership_id', v_p1.ownership_id, 'merkle_proof', jsonb_build_array(v_pad)),
    jsonb_build_object('proof_id', v_p2.id, 'ownership_id', v_p2.ownership_id, 'merkle_proof', jsonb_build_array(v_root)));
  SELECT batch_id, created INTO v_batch, v_created
    FROM record_anchor_batch('daily_batch', DATE '2001-01-01', now(), v_root, v_pad, v_chain, v_reg, v_leaves);
  SELECT count(*) INTO v_n FROM ownership_proofs
   WHERE anchor_batch_id = v_batch AND jsonb_array_length(merkle_proof) = 1;
  v_ok := v_created AND v_n = 2
      AND (SELECT leaf_count = 2 AND status = 'pending' FROM anchor_batches WHERE id = v_batch);
  v_res := v_res || jsonb_build_object('04_daily_batch_files_proofs', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_n END);

  -- 05. The same day again returns the existing batch and writes nothing.
  SELECT batch_id, created INTO v_batch2, v_created
    FROM record_anchor_batch('daily_batch', DATE '2001-01-01', now(), '0x' || repeat('d', 64), v_pad, v_chain, v_reg, '[]'::jsonb);
  v_ok := v_batch2 = v_batch AND NOT v_created
      AND (SELECT count(*) FROM anchor_batches WHERE registry_address = v_reg) = 1;
  v_res := v_res || jsonb_build_object('05_one_root_per_day', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 06. A proof already in a batch cannot be filed again; nothing is written.
  BEGIN
    PERFORM record_anchor_batch('per_event', NULL, now(), v_p1.ownership_id, NULL, v_chain, v_reg,
      jsonb_build_array(jsonb_build_object('proof_id', v_p1.id, 'ownership_id', v_p1.ownership_id, 'merkle_proof', '[]'::jsonb)));
    v_t := 'no error';
  EXCEPTION WHEN OTHERS THEN v_t := SQLERRM; END;
  v_ok := v_t = 'anchor_batch_conflict'
      AND (SELECT count(*) FROM anchor_batches WHERE registry_address = v_reg) = 1;
  v_res := v_res || jsonb_build_object('06_rebatch_refused', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_t END);

  -- 07. A leaf whose ownership_id does not match its proof row is refused.
  UPDATE ownership_proofs SET anchor_batch_id = NULL, merkle_proof = NULL WHERE anchor_batch_id = v_batch;
  BEGIN
    PERFORM record_anchor_batch('per_event', NULL, now(), v_root, NULL, v_chain, v_reg,
      jsonb_build_array(jsonb_build_object('proof_id', v_p1.id, 'ownership_id', v_root, 'merkle_proof', '[]'::jsonb)));
    v_t := 'no error';
  EXCEPTION WHEN OTHERS THEN v_t := SQLERRM; END;
  v_res := v_res || jsonb_build_object('07_wrong_ownership_id_refused', CASE WHEN v_t = 'anchor_batch_conflict' THEN 'ok' ELSE 'FAIL ' || v_t END);

  -- 08. A proof created after the cutoff is refused.
  BEGIN
    PERFORM record_anchor_batch('per_event', NULL, TIMESTAMPTZ '2000-01-01', v_p1.ownership_id, NULL, v_chain, v_reg,
      jsonb_build_array(jsonb_build_object('proof_id', v_p1.id, 'ownership_id', v_p1.ownership_id, 'merkle_proof', '[]'::jsonb)));
    v_t := 'no error';
  EXCEPTION WHEN OTHERS THEN v_t := SQLERRM; END;
  v_res := v_res || jsonb_build_object('08_after_cutoff_refused', CASE WHEN v_t = 'anchor_batch_conflict' THEN 'ok' ELSE 'FAIL ' || v_t END);

  -- 09. per_event with two leaves breaks the shape check.
  BEGIN
    PERFORM record_anchor_batch('per_event', NULL, now(), v_root, NULL, v_chain, v_reg, jsonb_build_array(
      jsonb_build_object('proof_id', v_p1.id, 'ownership_id', v_p1.ownership_id, 'merkle_proof', '[]'::jsonb),
      jsonb_build_object('proof_id', v_p2.id, 'ownership_id', v_p2.ownership_id, 'merkle_proof', '[]'::jsonb)));
    v_t := 'no error';
  EXCEPTION WHEN OTHERS THEN v_t := SQLERRM; END;
  v_res := v_res || jsonb_build_object('09_per_event_one_leaf', CASE WHEN v_t LIKE '%anchor_batches_shape_chk%' THEN 'ok' ELSE 'FAIL ' || v_t END);

  -- 10. A daily batch without a padding leaf is refused.
  BEGIN
    INSERT INTO anchor_batches (mode, batch_day, cutoff_at, merkle_root, leaf_count, chain_id, registry_address)
    VALUES ('daily_batch', DATE '2001-01-02', now(), v_root, 0, v_chain, v_reg);
    v_t := 'no error';
  EXCEPTION WHEN OTHERS THEN v_t := SQLERRM; END;
  v_res := v_res || jsonb_build_object('10_daily_needs_padding', CASE WHEN v_t LIKE '%anchor_batches_shape_chk%' THEN 'ok' ELSE 'FAIL ' || v_t END);

  -- 11. NULL mode and NULL status are refused (CHECK wraps them in coalesce).
  BEGIN
    INSERT INTO anchor_batches (mode, cutoff_at, merkle_root, leaf_count, chain_id, registry_address)
    VALUES (NULL, now(), v_root, 1, v_chain, v_reg);
    v_t := 'no error';
  EXCEPTION WHEN OTHERS THEN v_t := SQLERRM; END;
  v_ok := v_t LIKE '%anchor_batches_mode_chk%' OR v_t LIKE '%not-null%' OR v_t LIKE '%null value%';
  BEGIN
    UPDATE anchor_batches SET status = NULL WHERE id = v_batch;
    v_t := 'no error';
  EXCEPTION WHEN OTHERS THEN v_t := SQLERRM; END;
  v_ok := v_ok AND (v_t LIKE '%anchor_batches_status_chk%' OR v_t LIKE '%null value%');
  v_res := v_res || jsonb_build_object('11_null_mode_status_refused', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_t END);

  -- 12. An empty daily batch (a quiet day) is allowed.
  SELECT batch_id, created INTO v_batch2, v_created
    FROM record_anchor_batch('daily_batch', DATE '2001-01-03', now(), v_pad, v_pad, v_chain, v_reg, '[]'::jsonb);
  v_ok := v_created AND (SELECT leaf_count = 0 FROM anchor_batches WHERE id = v_batch2);
  v_res := v_res || jsonb_build_object('12_empty_day_allowed', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 13. 'submitted' needs a tx hash, nonce and time.
  BEGIN
    UPDATE anchor_batches SET status = 'submitted' WHERE id = v_batch;
    v_t := 'no error';
  EXCEPTION WHEN OTHERS THEN v_t := SQLERRM; END;
  v_res := v_res || jsonb_build_object('13_submitted_needs_tx', CASE WHEN v_t LIKE '%anchor_batches_submitted_chk%' THEN 'ok' ELSE 'FAIL ' || v_t END);

  -- Re-file both proofs into v_batch for the confirm checks.
  UPDATE ownership_proofs SET anchor_batch_id = v_batch, merkle_proof = '[]'::jsonb WHERE id IN (v_p1.id, v_p2.id);

  -- 14. A pending batch cannot be confirmed.
  v_ok := NOT confirm_anchor_batch(v_batch, v_tx, 100, now());
  v_res := v_res || jsonb_build_object('14_pending_not_confirmable', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 15. Only the bound tx confirms; it stamps every proof in the batch.
  UPDATE anchor_batches SET status = 'submitted', tx_hash = v_tx, tx_nonce = 7, submitted_at = now() WHERE id = v_batch;
  v_ok := NOT confirm_anchor_batch(v_batch, '0x' || repeat('e', 64), 100, now());
  v_ok := v_ok AND confirm_anchor_batch(v_batch, v_tx, 100, TIMESTAMPTZ '2001-01-02 00:00:05+00');
  SELECT count(*) INTO v_n FROM ownership_proofs
   WHERE anchor_batch_id = v_batch AND anchored_tx_hash = v_tx AND anchored_at = TIMESTAMPTZ '2001-01-02 00:00:05+00';
  v_ok := v_ok AND v_n = 2 AND (SELECT status = 'confirmed' AND block_number = 100 FROM anchor_batches WHERE id = v_batch);
  v_res := v_res || jsonb_build_object('15_confirm_stamps_proofs', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_n END);

  -- 16. Confirming twice is a no-op.
  v_res := v_res || jsonb_build_object('16_confirm_once', CASE WHEN NOT confirm_anchor_batch(v_batch, v_tx, 101, now()) THEN 'ok' ELSE 'FAIL' END);

  -- 17. A proof cannot carry a batch without a path (or the reverse).
  BEGIN
    UPDATE ownership_proofs SET merkle_proof = NULL WHERE id = v_p1.id;
    v_t := 'no error';
  EXCEPTION WHEN OTHERS THEN v_t := SQLERRM; END;
  v_res := v_res || jsonb_build_object('17_batch_and_path_together', CASE WHEN v_t LIKE '%ownership_proofs_batch_pair_chk%' THEN 'ok' ELSE 'FAIL ' || v_t END);

  -- 18. Alerts deduplicate: first is new, the repeat counts.
  SELECT is_new INTO v_created FROM record_anchor_alert('low_balance', 'live-test:low_balance', '{"wei":"1"}'::jsonb);
  v_ok := v_created;
  SELECT is_new INTO v_created FROM record_anchor_alert('low_balance', 'live-test:low_balance', '{"wei":"1"}'::jsonb);
  v_ok := v_ok AND NOT v_created
      AND (SELECT seen_count = 2 FROM anchor_alerts WHERE dedupe_key = 'live-test:low_balance');
  v_res := v_res || jsonb_build_object('18_alert_dedupe', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL' END);

  -- 19. Unknown and NULL alert kinds are refused.
  BEGIN
    PERFORM record_anchor_alert('something_else', 'live-test:x', '{}'::jsonb);
    v_t := 'no error';
  EXCEPTION WHEN OTHERS THEN v_t := SQLERRM; END;
  v_ok := v_t LIKE '%anchor_alerts_kind_chk%';
  BEGIN
    PERFORM record_anchor_alert(NULL, 'live-test:y', '{}'::jsonb);
    v_t := 'no error';
  EXCEPTION WHEN OTHERS THEN v_t := SQLERRM; END;
  v_ok := v_ok AND (v_t LIKE '%anchor_alerts_kind_chk%' OR v_t LIKE '%null value%');
  v_res := v_res || jsonb_build_object('19_alert_kind_checked', CASE WHEN v_ok THEN 'ok' ELSE 'FAIL ' || v_t END);

  -- 20. The hourly tick is scheduled.
  SELECT schedule INTO v_t FROM cron.job WHERE jobname = 'anchor-tick';
  v_res := v_res || jsonb_build_object('20_cron_hourly', CASE WHEN v_t = '7 * * * *' THEN 'ok' ELSE 'FAIL ' || coalesce(v_t, 'missing') END);

  RAISE EXCEPTION 'RESULTS %', (
    SELECT jsonb_build_object(
             'total', count(*),
             'ok', count(*) FILTER (WHERE value = '"ok"'::jsonb),
             'failures', coalesce(jsonb_object_agg(key, value) FILTER (WHERE value <> '"ok"'::jsonb), '{}'::jsonb))
      FROM jsonb_each(v_res));
END;
$$;
