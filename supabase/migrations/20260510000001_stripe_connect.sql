-- Phase 7D — Stripe Connect onboarding
--
-- Adds connected-account state to users so sellers can be onboarded to Stripe
-- Express, and a transfer-id column on payouts so release-escrow can record
-- the resulting Stripe Transfer for reconciliation.
--
-- All adds are nullable / default-safe per the Schema Extension Rules in
-- CLAUDE.md (no removes, no renames, no required fields).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarding_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_stripe_connect_account_id
  ON public.users (stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT UNIQUE;
