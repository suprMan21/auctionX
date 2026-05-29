-- ============================================================================
-- Session 20 — Dummy Auctions Seed
-- ============================================================================
-- Inserts 10 listing + auction pairs across status / brand / timing variations
-- so the new /admin/auctions surface has realistic data to act on.
--
-- All titles are prefixed "[DUMMY-S20]" so they're trivial to filter and clean
-- up later (cleanup query is at the bottom of this file, commented out).
--
-- How to run:
--   1. Supabase Dashboard → SQL Editor → New query → paste this file → Run.
--   2. Or via CLI:  supabase db execute --project-ref pmlofthmobglcfkqjtru < docs/seed-session-20-dummy-auctions.sql
--
-- Seller for every row is Boss admin (2b3f1532-9345-4720-8fac-55d07517c78b).
-- Edit the v_seller_id below if you want them owned by a different account.
-- ============================================================================

DO $$
DECLARE
  v_seller_id uuid := '2b3f1532-9345-4720-8fac-55d07517c78b';
  v_cat_am    uuid;
  v_cat_um    uuid;
  v_now       timestamptz := now();
  v_listing   uuid;
BEGIN
  -- Pick one AUCTIONX-eligible category and one UNMENTIONABLES-eligible category.
  -- Falls back to any category if no brand_restriction is set.
  SELECT id INTO v_cat_am
    FROM categories
    WHERE brand_restriction = 'AUCTIONX' OR brand_restriction IS NULL
    ORDER BY (brand_restriction = 'AUCTIONX') DESC NULLS LAST, name
    LIMIT 1;

  SELECT id INTO v_cat_um
    FROM categories
    WHERE brand_restriction = 'UNMENTIONABLES' OR brand_restriction IS NULL
    ORDER BY (brand_restriction = 'UNMENTIONABLES') DESC NULLS LAST, name
    LIMIT 1;

  IF v_cat_am IS NULL OR v_cat_um IS NULL THEN
    RAISE EXCEPTION 'No category rows found — seed categories before running this script';
  END IF;

  -- ── 1. ACTIVE / Authentic Materials / ends in ~24h ─────────────────────────
  INSERT INTO listings (brand, category_id, condition, description, is_featured, is_nsfw, seller_id, status, title, currency, published_at)
  VALUES ('AUCTIONX', v_cat_am, 'EXCELLENT',
    '[DUMMY-S20] Authentic Materials test row. Ends in ~24h, no bids yet, modest reserve.',
    false, false, v_seller_id, 'ACTIVE',
    '[DUMMY-S20] Signed 1986 tour program', 'USD', v_now)
  RETURNING id INTO v_listing;
  INSERT INTO auctions (listing_id, seller_id, status, current_price_cents, reserve_price_cents, starting_price_cents,
                        start_time, end_time, currency)
  VALUES (v_listing, v_seller_id, 'ACTIVE', 5000, 7500, 5000,
          v_now - interval '2 hours', v_now + interval '24 hours', 'USD');

  -- ── 2. ACTIVE / Authentic Materials / ending soon (~6h) ────────────────────
  INSERT INTO listings (brand, category_id, condition, description, is_featured, is_nsfw, seller_id, status, title, currency, published_at)
  VALUES ('AUCTIONX', v_cat_am, 'GOOD',
    '[DUMMY-S20] Ending in ~6h — useful for testing the "Ending soonest" sort.',
    false, false, v_seller_id, 'ACTIVE',
    '[DUMMY-S20] Vintage concert poster set', 'USD', v_now - interval '1 day')
  RETURNING id INTO v_listing;
  INSERT INTO auctions (listing_id, seller_id, status, current_price_cents, reserve_price_cents, starting_price_cents,
                        start_time, end_time, currency)
  VALUES (v_listing, v_seller_id, 'ACTIVE', 3200, 4000, 2500,
          v_now - interval '1 day', v_now + interval '6 hours', 'USD');

  -- ── 3. ACTIVE / Authentic Materials / multi-day window ─────────────────────
  INSERT INTO listings (brand, category_id, condition, description, is_featured, is_nsfw, seller_id, status, title, currency, published_at)
  VALUES ('AUCTIONX', v_cat_am, 'LIKE_NEW',
    '[DUMMY-S20] Long-running auction (3 days). Use for sort + filter testing.',
    false, false, v_seller_id, 'ACTIVE',
    '[DUMMY-S20] Game-used jersey w/ COA', 'USD', v_now - interval '6 hours')
  RETURNING id INTO v_listing;
  INSERT INTO auctions (listing_id, seller_id, status, current_price_cents, reserve_price_cents, starting_price_cents,
                        start_time, end_time, currency)
  VALUES (v_listing, v_seller_id, 'ACTIVE', 25000, 40000, 20000,
          v_now - interval '6 hours', v_now + interval '3 days', 'USD');

  -- ── 4. ACTIVE / Unmentionables (NSFW) / ends in ~12h ───────────────────────
  INSERT INTO listings (brand, category_id, condition, description, is_featured, is_nsfw, seller_id, status, title, currency, published_at, requires_age_verification)
  VALUES ('UNMENTIONABLES', v_cat_um, 'EXCELLENT',
    '[DUMMY-S20] Unmentionables (NSFW) brand-filter test row.',
    false, true, v_seller_id, 'ACTIVE',
    '[DUMMY-S20] Personal item — discreet listing #1', 'USD', v_now - interval '3 hours', true)
  RETURNING id INTO v_listing;
  INSERT INTO auctions (listing_id, seller_id, status, current_price_cents, reserve_price_cents, starting_price_cents,
                        start_time, end_time, currency)
  VALUES (v_listing, v_seller_id, 'ACTIVE', 8000, 10000, 6000,
          v_now - interval '3 hours', v_now + interval '12 hours', 'USD');

  -- ── 5. ACTIVE / Unmentionables / longer window ─────────────────────────────
  INSERT INTO listings (brand, category_id, condition, description, is_featured, is_nsfw, seller_id, status, title, currency, published_at, requires_age_verification)
  VALUES ('UNMENTIONABLES', v_cat_um, 'NEW',
    '[DUMMY-S20] Second Unmentionables active auction.',
    false, true, v_seller_id, 'ACTIVE',
    '[DUMMY-S20] Personal item — discreet listing #2', 'USD', v_now - interval '1 day', true)
  RETURNING id INTO v_listing;
  INSERT INTO auctions (listing_id, seller_id, status, current_price_cents, reserve_price_cents, starting_price_cents,
                        start_time, end_time, currency)
  VALUES (v_listing, v_seller_id, 'ACTIVE', 12000, 18000, 10000,
          v_now - interval '1 day', v_now + interval '5 days', 'USD');

  -- ── 6. ENDED / Authentic Materials (good Restart candidate) ────────────────
  INSERT INTO listings (brand, category_id, condition, description, is_featured, is_nsfw, seller_id, status, title, currency, published_at)
  VALUES ('AUCTIONX', v_cat_am, 'GOOD',
    '[DUMMY-S20] Ran out of time yesterday. Restart-eligible (no settlement).',
    false, false, v_seller_id, 'ACTIVE',
    '[DUMMY-S20] Autographed photo lot', 'USD', v_now - interval '4 days')
  RETURNING id INTO v_listing;
  INSERT INTO auctions (listing_id, seller_id, status, current_price_cents, reserve_price_cents, starting_price_cents,
                        start_time, end_time, currency)
  VALUES (v_listing, v_seller_id, 'ENDED', 4500, 6000, 3000,
          v_now - interval '4 days', v_now - interval '1 day', 'USD');

  -- ── 7. ENDED / Unmentionables (another Restart candidate) ──────────────────
  INSERT INTO listings (brand, category_id, condition, description, is_featured, is_nsfw, seller_id, status, title, currency, published_at, requires_age_verification)
  VALUES ('UNMENTIONABLES', v_cat_um, 'EXCELLENT',
    '[DUMMY-S20] NSFW ended 2 days ago. Use to test Restart from Unmentionables.',
    false, true, v_seller_id, 'ACTIVE',
    '[DUMMY-S20] Personal item — discreet listing #3', 'USD', v_now - interval '5 days', true)
  RETURNING id INTO v_listing;
  INSERT INTO auctions (listing_id, seller_id, status, current_price_cents, reserve_price_cents, starting_price_cents,
                        start_time, end_time, currency)
  VALUES (v_listing, v_seller_id, 'ENDED', 9000, 15000, 7500,
          v_now - interval '5 days', v_now - interval '2 days', 'USD');

  -- ── 8. CANCELLED / Authentic Materials (Restart-eligible too) ──────────────
  INSERT INTO listings (brand, category_id, condition, description, is_featured, is_nsfw, seller_id, status, title, currency, published_at)
  VALUES ('AUCTIONX', v_cat_am, 'FAIR',
    '[DUMMY-S20] Cancelled mid-run. Restart should re-activate listing + auction.',
    false, false, v_seller_id, 'CANCELLED',
    '[DUMMY-S20] Counterfeit-flagged collectible', 'USD', v_now - interval '2 days')
  RETURNING id INTO v_listing;
  INSERT INTO auctions (listing_id, seller_id, status, current_price_cents, reserve_price_cents, starting_price_cents,
                        start_time, end_time, currency)
  VALUES (v_listing, v_seller_id, 'CANCELLED', 1500, 5000, 1500,
          v_now - interval '2 days', v_now + interval '1 day', 'USD');

  -- ── 9. CANCELLED / Unmentionables ──────────────────────────────────────────
  INSERT INTO listings (brand, category_id, condition, description, is_featured, is_nsfw, seller_id, status, title, currency, published_at, requires_age_verification)
  VALUES ('UNMENTIONABLES', v_cat_um, 'POOR',
    '[DUMMY-S20] Cancelled Unmentionables. Second Restart candidate.',
    false, true, v_seller_id, 'CANCELLED',
    '[DUMMY-S20] Personal item — pulled by admin', 'USD', v_now - interval '3 days', true)
  RETURNING id INTO v_listing;
  INSERT INTO auctions (listing_id, seller_id, status, current_price_cents, reserve_price_cents, starting_price_cents,
                        start_time, end_time, currency)
  VALUES (v_listing, v_seller_id, 'CANCELLED', 0, NULL, 2000,
          v_now - interval '3 days', v_now + interval '2 days', 'USD');

  -- ── 10. SCHEDULED / Authentic Materials (starts in ~6h) ────────────────────
  INSERT INTO listings (brand, category_id, condition, description, is_featured, is_nsfw, seller_id, status, title, currency, published_at)
  VALUES ('AUCTIONX', v_cat_am, 'NEW',
    '[DUMMY-S20] Scheduled to start in ~6h, runs for 5 days. Tests SCHEDULED filter.',
    false, false, v_seller_id, 'ACTIVE',
    '[DUMMY-S20] Limited-edition presale lot', 'USD', v_now)
  RETURNING id INTO v_listing;
  INSERT INTO auctions (listing_id, seller_id, status, current_price_cents, reserve_price_cents, starting_price_cents,
                        start_time, end_time, currency)
  VALUES (v_listing, v_seller_id, 'SCHEDULED', 10000, 25000, 10000,
          v_now + interval '6 hours', v_now + interval '5 days 6 hours', 'USD');

  RAISE NOTICE '[DUMMY-S20] Inserted 10 listing+auction pairs. Filter for "[DUMMY-S20]" in /admin/auctions to see them.';
END $$;

-- ============================================================================
-- Cleanup (run AFTER you're done testing).
-- Deletes every dummy listing + the cascaded auction row + bids if any.
-- ============================================================================
-- DELETE FROM bids WHERE auction_id IN (
--   SELECT a.id FROM auctions a
--   JOIN listings l ON l.id = a.listing_id
--   WHERE l.title LIKE '[DUMMY-S20]%'
-- );
-- DELETE FROM auctions WHERE listing_id IN (SELECT id FROM listings WHERE title LIKE '[DUMMY-S20]%');
-- DELETE FROM listings WHERE title LIKE '[DUMMY-S20]%';
