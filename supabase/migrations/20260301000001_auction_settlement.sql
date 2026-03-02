-- Module 11: Auction Settlement
-- Extends the existing settlements table and adds settlement_offers,
-- payment_penalties tables plus RPC helpers and RLS policies.

-- ─── A. Extend settlements table ───────────────────────────────────────────

-- Drop NOT NULL on payment_id so we can create settlements before payment exists
ALTER TABLE "public"."settlements"
  ALTER COLUMN "payment_id" DROP NOT NULL;

-- Add new columns needed for the settlement flow
ALTER TABLE "public"."settlements"
  ADD COLUMN IF NOT EXISTS "transaction_id" UUID REFERENCES "public"."transactions"("id"),
  ADD COLUMN IF NOT EXISTS "buyer_id" UUID REFERENCES "public"."users"("id"),
  ADD COLUMN IF NOT EXISTS "payment_window_expires_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "offer_attempt" INTEGER NOT NULL DEFAULT 1;

-- ─── B. settlement_offers table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "public"."settlement_offers" (
  "id" UUID DEFAULT gen_random_uuid() NOT NULL,
  "settlement_id" UUID NOT NULL REFERENCES "public"."settlements"("id") ON DELETE CASCADE,
  "bidder_id" UUID NOT NULL REFERENCES "public"."users"("id"),
  "offer_price_cents" BIGINT NOT NULL,
  "offer_rank" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
  -- PENDING_PAYMENT | ACCEPTED | DECLINED | EXPIRED | CANCELLED
  "payment_window_expires_at" TIMESTAMPTZ NOT NULL,
  "transaction_id" UUID REFERENCES "public"."transactions"("id"),
  "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
  "updated_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT "settlement_offers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."settlement_offers" OWNER TO "postgres";

CREATE TRIGGER "set_updated_at_settlement_offers"
  BEFORE UPDATE ON "public"."settlement_offers"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();

-- ─── C. payment_penalties table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "public"."payment_penalties" (
  "id" UUID DEFAULT gen_random_uuid() NOT NULL,
  "user_id" UUID NOT NULL REFERENCES "public"."users"("id"),
  "settlement_id" UUID NOT NULL REFERENCES "public"."settlements"("id"),
  "offer_id" UUID REFERENCES "public"."settlement_offers"("id"),
  "penalty_level" INTEGER NOT NULL,
  -- 1 = 7-day suspension, 2 = 30-day suspension, 3 = permanent ban
  "reason" TEXT NOT NULL DEFAULT 'payment_window_expired',
  "expires_at" TIMESTAMPTZ,
  -- NULL means permanent ban
  "applied_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
  "reversed_at" TIMESTAMPTZ,
  "reversed_by" UUID REFERENCES "public"."users"("id"),
  "reversal_reason" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT "payment_penalties_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."payment_penalties" OWNER TO "postgres";

-- ─── D. RPC functions ──────────────────────────────────────────────────────

-- get_next_eligible_bidder: finds the highest non-excluded bidder for an auction.
-- Using an RPC because Supabase JS client cannot do DISTINCT ON natively.
CREATE OR REPLACE FUNCTION "public"."get_next_eligible_bidder"(
  p_auction_id UUID,
  p_exclude_uids UUID[]
)
RETURNS TABLE (
  bidder_id UUID,
  max_bid_cents BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    b.bidder_id,
    MAX(b.max_bid_cents) AS max_bid_cents
  FROM public.bids b
  WHERE b.auction_id = p_auction_id
    AND b.bidder_id != ALL(COALESCE(p_exclude_uids, ARRAY[]::UUID[]))
  GROUP BY b.bidder_id
  ORDER BY max_bid_cents DESC
  LIMIT 1;
$$;

-- apply_payment_penalty: counts existing non-reversed penalties and applies
-- the next level. Updates users table for suspension/ban.
-- Returns the new penalty level applied (1, 2, or 3).
CREATE OR REPLACE FUNCTION "public"."apply_payment_penalty"(
  p_user_id UUID,
  p_settlement_id UUID,
  p_offer_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing_count INTEGER;
  v_penalty_level INTEGER;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- Count non-reversed penalties for this user
  SELECT COUNT(*)
  INTO v_existing_count
  FROM public.payment_penalties
  WHERE user_id = p_user_id
    AND reversed_at IS NULL;

  -- Determine next penalty level (cap at 3)
  v_penalty_level := LEAST(v_existing_count + 1, 3);

  -- Set expiry based on level
  CASE v_penalty_level
    WHEN 1 THEN v_expires_at := NOW() + INTERVAL '7 days';
    WHEN 2 THEN v_expires_at := NOW() + INTERVAL '30 days';
    ELSE         v_expires_at := NULL; -- permanent
  END CASE;

  -- Insert penalty record
  INSERT INTO public.payment_penalties (
    user_id, settlement_id, offer_id, penalty_level, expires_at
  ) VALUES (
    p_user_id, p_settlement_id, p_offer_id, v_penalty_level, v_expires_at
  );

  -- Update users table based on penalty level
  IF v_penalty_level = 3 THEN
    UPDATE public.users
    SET is_banned = true,
        updated_at = NOW()
    WHERE id = p_user_id;
  ELSE
    UPDATE public.users
    SET suspended_until = v_expires_at,
        updated_at = NOW()
    WHERE id = p_user_id;
  END IF;

  RETURN v_penalty_level;
END;
$$;

-- ─── E. RLS policies ───────────────────────────────────────────────────────

-- settlements: add buyer read policy
ALTER TABLE "public"."settlements" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyers can view own settlements"
  ON "public"."settlements"
  FOR SELECT
  USING (auth.uid() = buyer_id);

-- settlement_offers: bidder can read their own; seller can read via settlement JOIN
ALTER TABLE "public"."settlement_offers" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bidders can view own offers"
  ON "public"."settlement_offers"
  FOR SELECT
  USING (auth.uid() = bidder_id);

CREATE POLICY "Sellers can view offers for their settlements"
  ON "public"."settlement_offers"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.settlements s
      WHERE s.id = settlement_id
        AND s.seller_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage settlement_offers"
  ON "public"."settlement_offers"
  FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT ALL ON TABLE "public"."settlement_offers" TO "anon";
GRANT ALL ON TABLE "public"."settlement_offers" TO "authenticated";
GRANT ALL ON TABLE "public"."settlement_offers" TO "service_role";

-- payment_penalties: user can read own penalties
ALTER TABLE "public"."payment_penalties" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own penalties"
  ON "public"."payment_penalties"
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all penalties"
  ON "public"."payment_penalties"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Service role can manage payment_penalties"
  ON "public"."payment_penalties"
  FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT ALL ON TABLE "public"."payment_penalties" TO "anon";
GRANT ALL ON TABLE "public"."payment_penalties" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_penalties" TO "service_role";

-- ─── F. Indexes ────────────────────────────────────────────────────────────

-- settlements
CREATE INDEX IF NOT EXISTS "idx_settlements_buyer_id"
  ON "public"."settlements" ("buyer_id");

CREATE INDEX IF NOT EXISTS "idx_settlements_pending_payment_window"
  ON "public"."settlements" ("payment_window_expires_at")
  WHERE status = 'PENDING_PAYMENT';

-- settlement_offers
CREATE INDEX IF NOT EXISTS "idx_settlement_offers_settlement_id"
  ON "public"."settlement_offers" ("settlement_id");

CREATE INDEX IF NOT EXISTS "idx_settlement_offers_status"
  ON "public"."settlement_offers" ("status");

CREATE INDEX IF NOT EXISTS "idx_settlement_offers_payment_window"
  ON "public"."settlement_offers" ("payment_window_expires_at")
  WHERE status = 'PENDING_PAYMENT';

-- payment_penalties
CREATE INDEX IF NOT EXISTS "idx_payment_penalties_user_id"
  ON "public"."payment_penalties" ("user_id");

-- ─── G. pg_cron schedule (optional — only if pg_cron extension is enabled) ─
-- Uncomment and run manually if pg_cron + pg_net are available:
--
-- SELECT cron.schedule(
--   'check-payment-windows',
--   '* * * * *',
--   $$
--     SELECT net.http_post(
--       url := current_setting('app.supabase_url') || '/functions/v1/check-payment-window',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
--         'Content-Type', 'application/json'
--       ),
--       body := '{}'::jsonb
--     );
--   $$
-- );
