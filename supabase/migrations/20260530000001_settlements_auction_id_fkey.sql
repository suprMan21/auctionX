-- Add missing foreign-key constraint settlements.auction_id -> auctions.id.
--
-- The settlements table was created without this FK in the original
-- 20260201042342_remote_schema.sql migration. Other FKs (payment_id, seller_id)
-- were present from day one; auction_id was overlooked. The gap manifested on
-- 2026-05-29 during the Session 21 E2E test: PostgREST refused to embed
--   settlements?select=*,auction:auctions(...)
-- with PGRST200 (Could not find a relationship between settlements and
-- auctions), which the backend getSettlement handler caught and surfaced as a
-- generic 404 Settlement not found to the buyer.
--
-- This migration adds the missing constraint. Applied inline to staging on
-- 2026-05-29 via the Supabase Dashboard SQL editor; this file makes the same
-- change reproducible against prod when cutover happens.
--
-- Schema Extension Rules check: pure ADD CONSTRAINT, no column rename, no enum
-- change, no field removal. Safe and append-only.

ALTER TABLE public.settlements
  ADD CONSTRAINT IF NOT EXISTS settlements_auction_id_fkey
  FOREIGN KEY (auction_id) REFERENCES public.auctions(id);

-- Refresh PostgREST schema cache so the new relationship is immediately
-- visible to embed queries. Without this, PostgREST takes 5-10 minutes to
-- auto-refresh, and any embed against settlements + auctions will keep
-- returning PGRST200 in the interim.
NOTIFY pgrst, 'reload schema';
