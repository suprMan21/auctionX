-- S-ADMIN1 Ph3b — admin-set token prices + free-transfer vouchers.
--
-- Implements the Locked decisions:
--   * "Token prices become admin-set (default $2.50 transfer, $10 token/re-issue)
--     with free-transfer vouchers; admin + super_admin only" (2026-10-03)
--   * "Free-transfer vouchers are granted to an account, not issued as
--     redeemable codes" (2026-10-11)
-- and Boss's Ph3b calls (2026-10-24):
--   * a transfer's price is locked when the sender starts it (as re-issue already is)
--   * a price change takes effect now or from a future date; a scheduled change
--     can be cancelled before it starts; no backdating
--   * a voucher is used by whoever pays the fee
--
--   1. token_prices: effective-dated price history. The price in effect is the
--      newest uncancelled row whose effective_from has passed.
--   2. admin_set_token_price / admin_cancel_token_price: admin + super_admin only,
--      audited in the same transaction.
--   3. transfer_voucher_grants / transfer_voucher_redemptions: N free transfers
--      granted to an account, with a reason and an optional expiry.
--   4. admin_grant_transfer_vouchers / admin_revoke_transfer_voucher.
--   5. apply_transfer_fee gains a 'voucher' source, and redeem_transfer_voucher
--      consumes a voucher and completes the transfer through it in ONE
--      transaction. A voucher never has a second copy of the completion rules.
--
-- Additive and idempotent: safe to re-run. apply_transfer_fee keeps its exact
-- signature and every existing outcome; the payment_method CHECK is widened
-- (adds 'voucher'), never narrowed.

-- ── 1. token_prices ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.token_prices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             TEXT NOT NULL,
  amount_usd_cents INTEGER NOT NULL,
  effective_from   TIMESTAMPTZ NOT NULL,
  reason           TEXT NOT NULL,
  -- NULL only for the seeded launch defaults below.
  created_by       UUID REFERENCES public.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at     TIMESTAMPTZ,
  cancelled_by     UUID REFERENCES public.users(id),
  cancel_reason    TEXT,
  CONSTRAINT token_prices_kind_chk
    CHECK (kind IN ('transfer', 'token', 'reissue')),
  -- Stripe's USD minimum is $0.50. A free transfer is a voucher, not a $0 price.
  CONSTRAINT token_prices_amount_chk
    CHECK (amount_usd_cents BETWEEN 50 AND 100000),
  CONSTRAINT token_prices_reason_chk
    CHECK (length(btrim(coalesce(reason, ''))) >= 10),
  CONSTRAINT token_prices_cancel_chk
    CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_token_prices_kind_effective
  ON public.token_prices(kind, effective_from DESC);

ALTER TABLE public.token_prices ENABLE ROW LEVEL SECURITY;
-- Backend (service_role) only. No policies: anon/authenticated read nothing.
REVOKE ALL ON public.token_prices FROM PUBLIC, anon, authenticated;

-- Launch defaults, so history starts with the prices actually charged so far.
-- Matches the env fallbacks in backend/src/lib/tokenFees.ts.
INSERT INTO public.token_prices (kind, amount_usd_cents, effective_from, reason)
SELECT v.kind, v.cents, '2026-09-19T00:00:00Z', 'Launch default (decision 2026-10-03)'
  FROM (VALUES ('transfer', 250), ('token', 1000), ('reissue', 1000)) AS v(kind, cents)
 WHERE NOT EXISTS (SELECT 1 FROM public.token_prices p WHERE p.kind = v.kind);

-- The price in effect right now, or NULL if none (the backend then uses its
-- env default). STABLE: one answer per statement.
CREATE OR REPLACE FUNCTION current_token_price(p_kind TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT amount_usd_cents
    FROM token_prices
   WHERE kind = p_kind
     AND cancelled_at IS NULL
     AND effective_from <= now()
   ORDER BY effective_from DESC, created_at DESC
   LIMIT 1;
$$;

-- ── 2. Admin: set / cancel a price ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_set_token_price(
  p_admin          UUID,
  p_kind           TEXT,
  p_amount         INTEGER,
  p_effective_from TIMESTAMPTZ,
  p_reason         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Raises unless p_admin is an active admin or super_admin.
  v_email     TEXT := payment_admin_actor_email(p_admin, true);
  v_effective TIMESTAMPTZ := coalesce(p_effective_from, now());
  v_previous  INTEGER := current_token_price(p_kind);
  v_row       token_prices%ROWTYPE;
BEGIN
  IF coalesce(p_kind, '') NOT IN ('transfer', 'token', 'reissue') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = 'check_violation';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;
  -- No backdating. A minute of slack for clock skew between backend and DB.
  IF v_effective < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'effective_in_past' USING ERRCODE = 'check_violation';
  END IF;
  IF v_effective < now() THEN
    v_effective := now();
  END IF;

  INSERT INTO token_prices (kind, amount_usd_cents, effective_from, reason, created_by)
  VALUES (p_kind, p_amount, v_effective, btrim(p_reason), p_admin)
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email, 'token_price_set', 'token_price', v_row.id,
    jsonb_build_object(
      'kind', p_kind,
      'amount_usd_cents', p_amount,
      'previous_amount_usd_cents', v_previous,
      'effective_from', v_effective,
      'scheduled', v_effective > now()
    ),
    btrim(p_reason), 'auctionx'
  );

  RETURN to_jsonb(v_row);
END;
$$;

-- Only a change that has not started yet can be cancelled. To undo a price
-- already in effect, set a new one: history is never rewritten.
CREATE OR REPLACE FUNCTION admin_cancel_token_price(
  p_admin  UUID,
  p_price  UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := payment_admin_actor_email(p_admin, true);
  v_row   token_prices%ROWTYPE;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_row FROM token_prices WHERE id = p_price FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'price_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_row.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'price_already_cancelled' USING ERRCODE = 'check_violation';
  END IF;
  IF v_row.effective_from <= now() THEN
    RAISE EXCEPTION 'price_already_effective' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE token_prices
     SET cancelled_at = now(), cancelled_by = p_admin, cancel_reason = btrim(p_reason)
   WHERE id = p_price
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email, 'token_price_cancel', 'token_price', p_price,
    jsonb_build_object(
      'kind', v_row.kind,
      'amount_usd_cents', v_row.amount_usd_cents,
      'effective_from', v_row.effective_from
    ),
    btrim(p_reason), 'auctionx'
  );

  RETURN to_jsonb(v_row);
END;
$$;

-- ── 3. Vouchers ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transfer_voucher_grants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  quantity      INTEGER NOT NULL,
  remaining     INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  expires_at    TIMESTAMPTZ,
  granted_by    UUID NOT NULL REFERENCES public.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID REFERENCES public.users(id),
  revoke_reason TEXT,
  CONSTRAINT transfer_voucher_grants_quantity_chk
    CHECK (quantity BETWEEN 1 AND 100),
  CONSTRAINT transfer_voucher_grants_remaining_chk
    CHECK (remaining BETWEEN 0 AND quantity),
  CONSTRAINT transfer_voucher_grants_reason_chk
    CHECK (length(btrim(coalesce(reason, ''))) >= 10),
  CONSTRAINT transfer_voucher_grants_revoke_chk
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_transfer_voucher_grants_user
  ON public.transfer_voucher_grants(user_id);

CREATE TABLE IF NOT EXISTS public.transfer_voucher_redemptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id              UUID NOT NULL REFERENCES public.transfer_voucher_grants(id),
  -- One voucher per transfer, ever.
  transfer_id           UUID NOT NULL UNIQUE REFERENCES public.ownership_transfers(id),
  user_id               UUID NOT NULL REFERENCES public.users(id),
  list_amount_usd_cents INTEGER,
  redeemed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transfer_voucher_redemptions_grant
  ON public.transfer_voucher_redemptions(grant_id);

ALTER TABLE public.transfer_voucher_grants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_voucher_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transfer_voucher_grants      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.transfer_voucher_redemptions FROM PUBLIC, anon, authenticated;

-- A voucher-completed transfer records how it was paid.
DO $$ BEGIN
  ALTER TABLE ownership_transfers DROP CONSTRAINT IF EXISTS ownership_transfers_payment_method_chk;
  ALTER TABLE ownership_transfers
    ADD CONSTRAINT ownership_transfers_payment_method_chk
    CHECK (payment_method IS NULL OR payment_method IN ('card', 'credit', 'voucher'));
END $$;

-- Free transfers a user can use right now.
CREATE OR REPLACE FUNCTION available_transfer_vouchers(p_user UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(remaining), 0)::INTEGER
    FROM transfer_voucher_grants
   WHERE user_id = p_user
     AND revoked_at IS NULL
     AND remaining > 0
     AND (expires_at IS NULL OR expires_at > now());
$$;

-- ── 4. Admin: grant / revoke ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_grant_transfer_vouchers(
  p_admin      UUID,
  p_user       UUID,
  p_quantity   INTEGER,
  p_reason     TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := payment_admin_actor_email(p_admin, true);
  v_row   transfer_voucher_grants%ROWTYPE;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 100 THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'check_violation';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'expiry_in_past' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user) THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO transfer_voucher_grants (user_id, quantity, remaining, reason, expires_at, granted_by)
  VALUES (p_user, p_quantity, p_quantity, btrim(p_reason), p_expires_at, p_admin)
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email, 'voucher_grant', 'transfer_voucher_grant', v_row.id,
    jsonb_build_object('user_id', p_user, 'quantity', p_quantity, 'expires_at', p_expires_at),
    btrim(p_reason), 'auctionx'
  );

  RETURN to_jsonb(v_row);
END;
$$;

-- Revoking keeps the row (and its redemptions) for the record; unused
-- vouchers on it can no longer be used.
CREATE OR REPLACE FUNCTION admin_revoke_transfer_voucher(
  p_admin  UUID,
  p_grant  UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := payment_admin_actor_email(p_admin, true);
  v_row   transfer_voucher_grants%ROWTYPE;
BEGIN
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_row FROM transfer_voucher_grants WHERE id = p_grant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'grant_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'grant_already_revoked' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE transfer_voucher_grants
     SET revoked_at = now(), revoked_by = p_admin, revoke_reason = btrim(p_reason)
   WHERE id = p_grant
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (admin_id, admin_email, action, entity_type, entity_id, changes, reason, brand)
  VALUES (
    p_admin, v_email, 'voucher_revoke', 'transfer_voucher_grant', p_grant,
    jsonb_build_object('user_id', v_row.user_id, 'quantity', v_row.quantity, 'unused', v_row.remaining),
    btrim(p_reason), 'auctionx'
  );

  RETURN to_jsonb(v_row);
END;
$$;

-- ── 5. apply_transfer_fee: add the 'voucher' source ─────────────────────────
-- Identical to the Ph3a definition except:
--   * p_source may be 'voucher'. Then p_intent must be NULL, the transfer must
--     have no PaymentIntent (a card payment may already be under way), and a
--     redemption row for this transfer must already exist in this transaction,
--     i.e. only redeem_transfer_voucher can complete a transfer for free.
--   * stripe_payment_intent_id is only overwritten when an intent is given.

CREATE OR REPLACE FUNCTION apply_transfer_fee(
  p_transfer     UUID,
  p_intent       TEXT,
  p_ownership_id TEXT,
  p_tag_ref      TEXT,
  p_salt_enc     TEXT,
  p_source       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t       ownership_transfers%ROWTYPE;
  v_tag     nfc_tags%ROWTYPE;
  v_now     TIMESTAMPTZ := now();
  v_voucher BOOLEAN := coalesce(p_source, '') = 'voucher';
BEGIN
  IF coalesce(p_source, '') NOT IN ('webhook', 'sweep', 'reapply', 'voucher') THEN
    RAISE EXCEPTION 'invalid_source' USING ERRCODE = 'check_violation';
  END IF;
  IF v_voucher THEN
    IF p_intent IS NOT NULL THEN
      RAISE EXCEPTION 'voucher_with_intent' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF length(btrim(coalesce(p_intent, ''))) = 0 THEN
    RAISE EXCEPTION 'intent_required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_t FROM ownership_transfers WHERE id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_voucher THEN
    -- A card payment was started: never also complete it for free.
    IF v_t.stripe_payment_intent_id IS NOT NULL THEN
      RETURN jsonb_build_object('outcome', 'intent_mismatch', 'tag_id', v_t.tag_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM transfer_voucher_redemptions WHERE transfer_id = p_transfer) THEN
      RAISE EXCEPTION 'voucher_not_redeemed' USING ERRCODE = 'check_violation';
    END IF;
  -- Bind to the intent this transfer created, so a succeeded intent from
  -- elsewhere cannot complete (or be reported as completing) someone else's.
  ELSIF v_t.stripe_payment_intent_id IS NOT NULL AND v_t.stripe_payment_intent_id <> p_intent THEN
    RETURN jsonb_build_object('outcome', 'intent_mismatch', 'tag_id', v_t.tag_id);
  END IF;

  IF coalesce(v_t.status, '') = 'COMPLETED' THEN
    IF NOT v_voucher THEN
      UPDATE payment_incidents
         SET status = 'RESOLVED', resolution = p_source, resolved_at = v_now
       WHERE stripe_payment_intent_id = p_intent AND status = 'OPEN';
    END IF;
    RETURN jsonb_build_object('outcome', 'already_completed', 'tag_id', v_t.tag_id);
  END IF;

  IF coalesce(v_t.status, '') <> 'PENDING' THEN
    RETURN jsonb_build_object('outcome', 'not_payable', 'tag_id', v_t.tag_id, 'status', v_t.status);
  END IF;
  IF v_t.to_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'no_recipient', 'tag_id', v_t.tag_id);
  END IF;

  SELECT * INTO v_tag FROM nfc_tags WHERE id = v_t.tag_id FOR UPDATE;
  IF NOT FOUND OR coalesce(v_tag.lifecycle_status::text, '') = 'RETIRED' THEN
    RETURN jsonb_build_object('outcome', 'not_payable', 'tag_id', v_t.tag_id, 'status', 'tag_retired');
  END IF;

  UPDATE ownership_transfers
     SET status                   = 'COMPLETED',
         transfer_fee_paid        = true,
         completed_at             = v_now,
         transferred_at           = v_now,
         stripe_payment_intent_id = coalesce(p_intent, stripe_payment_intent_id)
   WHERE id = p_transfer;

  -- Ownership moves here, and only here. A suspended token stays suspended:
  -- paying a transfer must not lift an admin suspension.
  UPDATE nfc_tags
     SET current_owner_id = v_t.to_user_id,
         lifecycle_status = CASE WHEN v_tag.lifecycle_status::text = 'SUSPENDED'
                                 THEN v_tag.lifecycle_status ELSE 'ACTIVE' END
   WHERE id = v_t.tag_id;

  UPDATE ownership_proofs SET status = 'stale'
   WHERE tag_id = v_t.tag_id AND status = 'current';

  INSERT INTO ownership_proofs (
    tag_id, ownership_event_id, ownership_event_type, ownership_id, tag_ref, salt_enc, owner_id, status
  ) VALUES (
    v_t.tag_id, p_transfer, 'transfer', p_ownership_id, p_tag_ref, p_salt_enc, v_t.to_user_id, 'current'
  );

  IF NOT v_voucher THEN
    UPDATE payment_incidents
       SET status = 'RESOLVED', resolution = p_source, resolved_at = v_now
     WHERE stripe_payment_intent_id = p_intent AND status = 'OPEN';
  END IF;

  RETURN jsonb_build_object('outcome', 'applied', 'tag_id', v_t.tag_id, 'to_user_id', v_t.to_user_id);
END;
$$;

-- ── 6. redeem_transfer_voucher ──────────────────────────────────────────────
-- Uses one of the fee payer's vouchers and completes the transfer, atomically.
-- The payer is read from the row (fee_payer SELLER -> sender, else recipient),
-- never taken from the caller.
-- Outcomes: applied | no_voucher (nothing changed; take a card payment)
--           | not_found | not_payable | no_recipient | intent_mismatch
-- Any outcome other than applied/no_voucher rolls the voucher use back.
-- The proof values are minted by the backend (the salt key never reaches the DB).

CREATE OR REPLACE FUNCTION redeem_transfer_voucher(
  p_transfer     UUID,
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
  v_t     ownership_transfers%ROWTYPE;
  v_payer UUID;
  v_grant transfer_voucher_grants%ROWTYPE;
  v_out   JSONB;
BEGIN
  SELECT * INTO v_t FROM ownership_transfers WHERE id = p_transfer FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF coalesce(v_t.status, '') <> 'PENDING' THEN
    RETURN jsonb_build_object('outcome', 'not_payable', 'tag_id', v_t.tag_id, 'status', v_t.status);
  END IF;
  IF v_t.stripe_payment_intent_id IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'intent_mismatch', 'tag_id', v_t.tag_id);
  END IF;
  IF v_t.to_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'no_recipient', 'tag_id', v_t.tag_id);
  END IF;

  v_payer := CASE WHEN v_t.fee_payer = 'SELLER' THEN v_t.from_user_id ELSE v_t.to_user_id END;
  IF v_payer IS NULL THEN
    RETURN jsonb_build_object('outcome', 'no_voucher', 'tag_id', v_t.tag_id);
  END IF;

  -- Soonest-expiring first, so a voucher with a deadline is not wasted.
  SELECT * INTO v_grant
    FROM transfer_voucher_grants
   WHERE user_id = v_payer
     AND revoked_at IS NULL
     AND remaining > 0
     AND (expires_at IS NULL OR expires_at > now())
   ORDER BY expires_at ASC NULLS LAST, created_at ASC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_voucher', 'tag_id', v_t.tag_id);
  END IF;

  UPDATE transfer_voucher_grants SET remaining = remaining - 1 WHERE id = v_grant.id;

  INSERT INTO transfer_voucher_redemptions (grant_id, transfer_id, user_id, list_amount_usd_cents)
  VALUES (v_grant.id, p_transfer, v_payer, v_t.list_amount_usd_cents);

  UPDATE ownership_transfers
     SET payment_method   = 'voucher',
         charged_amount   = 0,
         charged_currency = 'usd',
         fx_rate          = 1
   WHERE id = p_transfer;

  v_out := apply_transfer_fee(p_transfer, NULL, p_ownership_id, p_tag_ref, p_salt_enc, 'voucher');

  IF v_out->>'outcome' <> 'applied' THEN
    -- Roll back the voucher use with everything else.
    RAISE EXCEPTION 'voucher_apply_%', v_out->>'outcome' USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_out || jsonb_build_object('grant_id', v_grant.id, 'payer_id', v_payer);
END;
$$;

-- ── 7. Grants: backend (service_role) only ──────────────────────────────────

REVOKE ALL ON FUNCTION current_token_price(TEXT)                                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_set_token_price(UUID, TEXT, INTEGER, TIMESTAMPTZ, TEXT)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_cancel_token_price(UUID, UUID, TEXT)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION available_transfer_vouchers(UUID)                                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_grant_transfer_vouchers(UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_revoke_transfer_voucher(UUID, UUID, TEXT)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_transfer_fee(UUID, TEXT, TEXT, TEXT, TEXT, TEXT)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION redeem_transfer_voucher(UUID, TEXT, TEXT, TEXT)                   FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.token_prices                 TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.transfer_voucher_grants      TO service_role;
GRANT SELECT, INSERT         ON public.transfer_voucher_redemptions TO service_role;

GRANT EXECUTE ON FUNCTION current_token_price(TEXT)                                         TO service_role;
GRANT EXECUTE ON FUNCTION admin_set_token_price(UUID, TEXT, INTEGER, TIMESTAMPTZ, TEXT)     TO service_role;
GRANT EXECUTE ON FUNCTION admin_cancel_token_price(UUID, UUID, TEXT)                        TO service_role;
GRANT EXECUTE ON FUNCTION available_transfer_vouchers(UUID)                                 TO service_role;
GRANT EXECUTE ON FUNCTION admin_grant_transfer_vouchers(UUID, UUID, INTEGER, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION admin_revoke_transfer_voucher(UUID, UUID, TEXT)                   TO service_role;
GRANT EXECUTE ON FUNCTION apply_transfer_fee(UUID, TEXT, TEXT, TEXT, TEXT, TEXT)            TO service_role;
GRANT EXECUTE ON FUNCTION redeem_transfer_voucher(UUID, TEXT, TEXT, TEXT)                   TO service_role;
