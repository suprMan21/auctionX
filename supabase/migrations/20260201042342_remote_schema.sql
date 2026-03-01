


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."auction_status" AS ENUM (
    'DRAFT',
    'SCHEDULED',
    'ACTIVE',
    'ENDED',
    'CANCELLED',
    'SETTLED'
);


ALTER TYPE "public"."auction_status" OWNER TO "postgres";


CREATE TYPE "public"."brand_type" AS ENUM (
    'AUCTIONX',
    'UNMENTIONABLES'
);


ALTER TYPE "public"."brand_type" OWNER TO "postgres";


CREATE TYPE "public"."content_flag" AS ENUM (
    'CONCERT_GEAR',
    'MEMORABILIA',
    'AUTOGRAPHED',
    'SPORTS_EQUIPMENT',
    'VINTAGE_COLLECTIBLES',
    'FAN_MERCHANDISE',
    'CREATOR_MERCH',
    'COSPLAY',
    'GAMING',
    'COLLECTIBLES',
    'DIGITAL_GOODS',
    'ADULT_CONTENT',
    'NSFW',
    '18_PLUS',
    'EXPLICIT',
    'INTIMATE_ITEMS'
);


ALTER TYPE "public"."content_flag" OWNER TO "postgres";


CREATE TYPE "public"."content_risk_level" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH'
);


ALTER TYPE "public"."content_risk_level" OWNER TO "postgres";


CREATE TYPE "public"."currency_code" AS ENUM (
    'CAD',
    'USD'
);


ALTER TYPE "public"."currency_code" OWNER TO "postgres";


CREATE TYPE "public"."item_condition" AS ENUM (
    'NEW',
    'LIKE_NEW',
    'EXCELLENT',
    'GOOD',
    'FAIR',
    'POOR'
);


ALTER TYPE "public"."item_condition" OWNER TO "postgres";


CREATE TYPE "public"."listing_status" AS ENUM (
    'DRAFT',
    'PENDING_REVIEW',
    'ACTIVE',
    'SOLD',
    'CANCELLED',
    'REMOVED'
);


ALTER TYPE "public"."listing_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_method_type" AS ENUM (
    'CARD',
    'CRYPTO'
);


ALTER TYPE "public"."payment_method_type" OWNER TO "postgres";


CREATE TYPE "public"."payment_processor" AS ENUM (
    'STRIPE',
    'PAYMENTCLOUD',
    'SIGNATURE',
    'CCBILL',
    'NOWPAYMENTS'
);


ALTER TYPE "public"."payment_processor" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'pending',
    'processing',
    'succeeded',
    'failed',
    'cancelled',
    'refunded'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_window_status" AS ENUM (
    'ACTIVE',
    'EXPIRED',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE "public"."payment_window_status" OWNER TO "postgres";


CREATE TYPE "public"."processor_health_status" AS ENUM (
    'HEALTHY',
    'DEGRADED',
    'DOWN'
);


ALTER TYPE "public"."processor_health_status" OWNER TO "postgres";


CREATE TYPE "public"."tier_level" AS ENUM (
    'TIER_1',
    'TIER_2',
    'TIER_3'
);


ALTER TYPE "public"."tier_level" OWNER TO "postgres";


CREATE TYPE "public"."transaction_status" AS ENUM (
    'PENDING',
    'PROCESSING',
    'SUCCEEDED',
    'FAILED',
    'REFUNDED',
    'PARTIALLY_REFUNDED',
    'DISPUTED',
    'EXPIRED'
);


ALTER TYPE "public"."transaction_status" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'user',
    'moderator',
    'admin',
    'super_admin',
    'support',
    'finance'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE TYPE "public"."verification_status" AS ENUM (
    'NONE',
    'PENDING',
    'APPROVED',
    'REJECTED'
);


ALTER TYPE "public"."verification_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_platform_fee_percent"("tier" "public"."tier_level") RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
BEGIN
  RETURN CASE tier
    WHEN 'TIER_3' THEN 15.00
    WHEN 'TIER_2' THEN 17.50
    ELSE 20.00
  END;
END;
$$;


ALTER FUNCTION "public"."calculate_platform_fee_percent"("tier" "public"."tier_level") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_processor_success_rate"("p_processor" "public"."payment_processor", "p_hours" integer DEFAULT 24) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_total INTEGER;
  v_successful INTEGER;
BEGIN
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE success = TRUE)
  INTO v_total, v_successful
  FROM payment_attempts
  WHERE processor = p_processor
    AND created_at >= NOW() - (p_hours || ' hours')::INTERVAL;
  
  IF v_total = 0 THEN
    RETURN 100.00;
  END IF;
  
  RETURN ROUND((v_successful::DECIMAL / v_total::DECIMAL) * 100, 2);
END;
$$;


ALTER FUNCTION "public"."calculate_processor_success_rate"("p_processor" "public"."payment_processor", "p_hours" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_seller_tier"("trailing_12mo_sales" bigint) RETURNS "public"."tier_level"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $_$
BEGIN
  RETURN CASE
    WHEN trailing_12mo_sales >= 10000000 THEN 'TIER_3'::tier_level  -- $100K+
    WHEN trailing_12mo_sales >= 1000000 THEN 'TIER_2'::tier_level   -- $10K+
    ELSE 'TIER_1'::tier_level
  END;
END;
$_$;


ALTER FUNCTION "public"."calculate_seller_tier"("trailing_12mo_sales" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."determine_risk_level"("flags" "public"."content_flag"[]) RETURNS "public"."content_risk_level"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  high_risk_flags content_flag[] := ARRAY[
    'ADULT_CONTENT'::content_flag,
    'NSFW'::content_flag,
    '18_PLUS'::content_flag,
    'EXPLICIT'::content_flag,
    'INTIMATE_ITEMS'::content_flag
  ];
  medium_risk_flags content_flag[] := ARRAY[
    'CREATOR_MERCH'::content_flag,
    'COSPLAY'::content_flag,
    'GAMING'::content_flag,
    'COLLECTIBLES'::content_flag,
    'DIGITAL_GOODS'::content_flag
  ];
BEGIN
  IF flags && high_risk_flags THEN
    RETURN 'HIGH'::content_risk_level;
  ELSIF flags && medium_risk_flags THEN
    RETURN 'MEDIUM'::content_risk_level;
  ELSE
    RETURN 'LOW'::content_risk_level;
  END IF;
END;
$$;


ALTER FUNCTION "public"."determine_risk_level"("flags" "public"."content_flag"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_single_default_address"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE shipping_addresses
    SET is_default = false
    WHERE user_id = NEW.user_id AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ensure_single_default_address"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_minimum_next_bid"("auction_uuid" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  auction_record RECORD;
BEGIN
  SELECT current_price_cents, minimum_increment_cents
  INTO auction_record
  FROM auctions
  WHERE id = auction_uuid;
  RETURN auction_record.current_price_cents + auction_record.minimum_increment_cents;
END;
$$;


ALTER FUNCTION "public"."get_minimum_next_bid"("auction_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_winning_bid"("auction_uuid" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT id FROM bids
  WHERE auction_id = auction_uuid
  ORDER BY amount_cents DESC, created_at ASC
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_winning_bid"("auction_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.users (id, email, role, seller_tier)
  VALUES (
    NEW.id,
    NEW.email,
    'user',
    'TIER_1'
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_proxy_bid"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_auction auctions%ROWTYPE;
  v_new_price_cents INTEGER;
BEGIN
  SELECT * INTO v_auction
  FROM auctions
  WHERE id = NEW.auction_id
  FOR UPDATE;

  IF v_auction.high_bidder_id IS NULL THEN
    UPDATE auctions
    SET 
      current_price_cents = v_auction.starting_price_cents,
      high_bidder_id = NEW.bidder_id,
      high_bidder_max_cents = NEW.max_bid_cents
    WHERE id = NEW.auction_id;
    RETURN NEW;
  END IF;

  IF NEW.bidder_id = v_auction.high_bidder_id THEN
    IF NEW.max_bid_cents IS NOT NULL AND 
       (v_auction.high_bidder_max_cents IS NULL OR NEW.max_bid_cents > v_auction.high_bidder_max_cents) THEN
      UPDATE auctions
      SET high_bidder_max_cents = NEW.max_bid_cents
      WHERE id = NEW.auction_id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.max_bid_cents IS NULL THEN
    IF v_auction.high_bidder_max_cents IS NULL OR NEW.amount_cents > v_auction.high_bidder_max_cents THEN
      UPDATE auctions
      SET 
        current_price_cents = NEW.amount_cents,
        high_bidder_id = NEW.bidder_id,
        high_bidder_max_cents = NULL
      WHERE id = NEW.auction_id;
    ELSE
      v_new_price_cents := LEAST(
        NEW.amount_cents + v_auction.minimum_increment_cents,
        v_auction.high_bidder_max_cents
      );
      
      UPDATE auctions
      SET current_price_cents = v_new_price_cents
      WHERE id = NEW.auction_id;

      INSERT INTO bids (auction_id, bidder_id, amount_cents, max_bid_cents, is_auto_bid)
      VALUES (NEW.auction_id, v_auction.high_bidder_id, v_new_price_cents, v_auction.high_bidder_max_cents, true);
    END IF;
    RETURN NEW;
  END IF;

  IF v_auction.high_bidder_max_cents IS NULL OR NEW.max_bid_cents > v_auction.high_bidder_max_cents THEN
    v_new_price_cents := LEAST(
      COALESCE(v_auction.high_bidder_max_cents, v_auction.current_price_cents) + v_auction.minimum_increment_cents,
      NEW.max_bid_cents
    );

    UPDATE auctions
    SET 
      current_price_cents = v_new_price_cents,
      high_bidder_id = NEW.bidder_id,
      high_bidder_max_cents = NEW.max_bid_cents
    WHERE id = NEW.auction_id;
  ELSIF NEW.max_bid_cents = v_auction.high_bidder_max_cents THEN
    RETURN NEW;
  ELSE
    v_new_price_cents := LEAST(
      NEW.max_bid_cents + v_auction.minimum_increment_cents,
      v_auction.high_bidder_max_cents
    );
    
    UPDATE auctions
    SET current_price_cents = v_new_price_cents
    WHERE id = NEW.auction_id;

    INSERT INTO bids (auction_id, bidder_id, amount_cents, max_bid_cents, is_auto_bid)
    VALUES (NEW.auction_id, v_auction.high_bidder_id, v_new_price_cents, v_auction.high_bidder_max_cents, true);
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_proxy_bid"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_login"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.users
  SET last_login_at = NOW()
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_user_login"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_high_bidder"("auction_uuid" "uuid", "user_uuid" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auctions 
    WHERE id = auction_uuid AND high_bidder_id = user_uuid
  );
END;
$$;


ALTER FUNCTION "public"."is_high_bidder"("auction_uuid" "uuid", "user_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_self_bid"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  auction_seller_id UUID;
BEGIN
  SELECT seller_id INTO auction_seller_id
  FROM auctions
  WHERE id = NEW.auction_id;
  
  IF NEW.bidder_id = auction_seller_id THEN
    RAISE EXCEPTION 'Cannot bid on your own auction';
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_self_bid"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_seller_tier"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  new_tier tier_level;
BEGIN
  new_tier := calculate_seller_tier(NEW.trailing_12mo_sales_cents);
  
  IF new_tier != OLD.seller_tier THEN
    NEW.seller_tier := new_tier;
    NEW.tier_updated_at := now();
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_seller_tier"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_shipping_address_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_shipping_address_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."auctions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "listing_id" "uuid" NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "starting_price_cents" bigint NOT NULL,
    "current_price_cents" bigint NOT NULL,
    "reserve_price_cents" bigint,
    "minimum_increment_cents" bigint DEFAULT 100 NOT NULL,
    "currency" character varying(3) DEFAULT 'CAD'::character varying NOT NULL,
    "status" "public"."auction_status" DEFAULT 'DRAFT'::"public"."auction_status" NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "winner_id" "uuid",
    "winning_bid_id" "uuid",
    "high_bidder_id" "uuid",
    "high_bidder_max_cents" bigint,
    "second_highest_max_cents" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "auctions_check" CHECK (("current_price_cents" >= "starting_price_cents")),
    CONSTRAINT "auctions_check1" CHECK ((("reserve_price_cents" IS NULL) OR ("reserve_price_cents" >= "starting_price_cents"))),
    CONSTRAINT "auctions_check2" CHECK (("end_time" > "start_time")),
    CONSTRAINT "auctions_minimum_increment_cents_check" CHECK (("minimum_increment_cents" >= 50)),
    CONSTRAINT "auctions_starting_price_cents_check" CHECK (("starting_price_cents" >= 100))
);


ALTER TABLE "public"."auctions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bids" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auction_id" "uuid" NOT NULL,
    "bidder_id" "uuid" NOT NULL,
    "amount_cents" bigint NOT NULL,
    "max_bid_cents" bigint,
    "is_auto_bid" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bids_amount_cents_check" CHECK (("amount_cents" > 0)),
    CONSTRAINT "bids_check" CHECK ((("max_bid_cents" IS NULL) OR ("max_bid_cents" >= "amount_cents")))
);


ALTER TABLE "public"."bids" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "parent_id" "uuid",
    "brand_restriction" "public"."brand_type",
    "is_nsfw" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


COMMENT ON TABLE "public"."categories" IS 'Hierarchical product categories';



CREATE TABLE IF NOT EXISTS "public"."crypto_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "nowpayments_payment_id" "text" NOT NULL,
    "crypto_currency" character varying(10) NOT NULL,
    "crypto_amount" numeric(20,8) NOT NULL,
    "crypto_address" "text" NOT NULL,
    "payment_url" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "actually_paid_crypto" numeric(20,8),
    "network_fee_crypto" numeric(20,8),
    "completed_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."crypto_payments" OWNER TO "postgres";


COMMENT ON TABLE "public"."crypto_payments" IS 'Cryptocurrency payment tracking via NOWPayments';



CREATE TABLE IF NOT EXISTS "public"."listing_media" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "listing_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "s3_key" "text" NOT NULL,
    "s3_bucket" "text" NOT NULL,
    "url" "text" NOT NULL,
    "thumbnail_url" "text",
    "width" integer,
    "height" integer,
    "duration_seconds" integer,
    "size_bytes" bigint NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "listing_media_type_check" CHECK (("type" = ANY (ARRAY['IMAGE'::"text", 'VIDEO'::"text"])))
);


ALTER TABLE "public"."listing_media" OWNER TO "postgres";


COMMENT ON TABLE "public"."listing_media" IS 'Images and videos for listings (S3-backed)';



CREATE TABLE IF NOT EXISTS "public"."listings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "category_id" "uuid" NOT NULL,
    "condition" "public"."item_condition" NOT NULL,
    "brand" "public"."brand_type" NOT NULL,
    "location_city" "text",
    "location_region" "text",
    "location_country" character(2),
    "currency" "public"."currency_code" DEFAULT 'CAD'::"public"."currency_code" NOT NULL,
    "reserve_price_cents" bigint,
    "status" "public"."listing_status" DEFAULT 'DRAFT'::"public"."listing_status" NOT NULL,
    "is_nsfw" boolean DEFAULT false NOT NULL,
    "requires_age_verification" boolean DEFAULT false NOT NULL,
    "is_featured" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_at" timestamp with time zone,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."listings" OWNER TO "postgres";


COMMENT ON TABLE "public"."listings" IS 'Items listed for sale';



CREATE TABLE IF NOT EXISTS "public"."payment_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "correlation_id" "uuid" NOT NULL,
    "processor" "public"."payment_processor" NOT NULL,
    "attempt_number" integer NOT NULL,
    "success" boolean DEFAULT false NOT NULL,
    "processor_payment_id" "text",
    "error_code" "text",
    "error_message" "text",
    "response_time_ms" integer,
    "raw_response" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_attempts_attempt_number_check" CHECK (("attempt_number" > 0))
);


ALTER TABLE "public"."payment_attempts" OWNER TO "postgres";


COMMENT ON TABLE "public"."payment_attempts" IS 'Individual processor attempts within cascade';



CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auction_id" "uuid" NOT NULL,
    "buyer_id" "uuid" NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "processor_payment_id" "text",
    "processor_customer_id" "text",
    "amount_cents" bigint NOT NULL,
    "currency" "public"."currency_code" DEFAULT 'CAD'::"public"."currency_code" NOT NULL,
    "status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status" NOT NULL,
    "payment_window_expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


COMMENT ON TABLE "public"."payments" IS 'Buyer payments via Stripe/Segpay';



COMMENT ON COLUMN "public"."payments"."payment_window_expires_at" IS 'Winner has 20 minutes to complete payment';



CREATE TABLE IF NOT EXISTS "public"."processor_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "processor" "public"."payment_processor" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "priority" integer NOT NULL,
    "supported_flags" "public"."content_flag"[] DEFAULT '{}'::"public"."content_flag"[] NOT NULL,
    "max_attempts" integer DEFAULT 2 NOT NULL,
    "retry_delay_ms" integer DEFAULT 3000 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "processor_config_max_attempts_check" CHECK (("max_attempts" > 0)),
    CONSTRAINT "processor_config_priority_check" CHECK (("priority" > 0)),
    CONSTRAINT "processor_config_retry_delay_ms_check" CHECK (("retry_delay_ms" >= 0))
);


ALTER TABLE "public"."processor_config" OWNER TO "postgres";


COMMENT ON TABLE "public"."processor_config" IS 'Processor configuration and feature flags';



CREATE TABLE IF NOT EXISTS "public"."processor_health" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "processor" "public"."payment_processor" NOT NULL,
    "status" "public"."processor_health_status" DEFAULT 'HEALTHY'::"public"."processor_health_status" NOT NULL,
    "latency_ms" integer,
    "success_rate_24h" numeric(5,2),
    "last_error" "text",
    "checked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."processor_health" OWNER TO "postgres";


COMMENT ON TABLE "public"."processor_health" IS 'Real-time processor health monitoring';



CREATE TABLE IF NOT EXISTS "public"."refunds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "processor" "public"."payment_processor" NOT NULL,
    "processor_refund_id" "text" NOT NULL,
    "amount_cents" bigint NOT NULL,
    "reason" "text",
    "initiated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "refunds_amount_cents_check" CHECK (("amount_cents" > 0))
);


ALTER TABLE "public"."refunds" OWNER TO "postgres";


COMMENT ON TABLE "public"."refunds" IS 'Refund records for transactions';



CREATE TABLE IF NOT EXISTS "public"."settlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auction_id" "uuid" NOT NULL,
    "payment_id" "uuid" NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "gross_amount_cents" bigint NOT NULL,
    "platform_fee_cents" bigint NOT NULL,
    "processor_fee_cents" bigint NOT NULL,
    "net_amount_cents" bigint NOT NULL,
    "platform_fee_percent" numeric(5,2) NOT NULL,
    "processor_fee_percent" numeric(5,2) NOT NULL,
    "processor_transaction_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "settled_at" timestamp with time zone
);


ALTER TABLE "public"."settlements" OWNER TO "postgres";


COMMENT ON TABLE "public"."settlements" IS 'Seller payouts after successful sales';



COMMENT ON COLUMN "public"."settlements"."platform_fee_percent" IS 'AuctionX platform fee (varies by seller tier)';



COMMENT ON COLUMN "public"."settlements"."processor_fee_percent" IS 'Payment processor fee (Stripe ~2.9%, Segpay ~10%)';



CREATE TABLE IF NOT EXISTS "public"."shipping_addresses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address_line1" "text" NOT NULL,
    "address_line2" "text",
    "city" "text" NOT NULL,
    "region" "text" NOT NULL,
    "postal_code" "text" NOT NULL,
    "country" character(2) NOT NULL,
    "phone_number" "text",
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shipping_addresses" OWNER TO "postgres";


COMMENT ON TABLE "public"."shipping_addresses" IS 'Buyer shipping addresses for order fulfillment';



CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auction_id" "uuid" NOT NULL,
    "buyer_id" "uuid" NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "amount_cents" bigint NOT NULL,
    "platform_fee_cents" bigint NOT NULL,
    "seller_payout_cents" bigint NOT NULL,
    "currency" character varying(3) DEFAULT 'CAD'::character varying NOT NULL,
    "status" "public"."transaction_status" DEFAULT 'PENDING'::"public"."transaction_status" NOT NULL,
    "content_flags" "public"."content_flag"[] DEFAULT '{}'::"public"."content_flag"[] NOT NULL,
    "risk_level" "public"."content_risk_level" NOT NULL,
    "cascade_correlation_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_window_expires_at" timestamp with time zone NOT NULL,
    "payment_window_status" "public"."payment_window_status" DEFAULT 'ACTIVE'::"public"."payment_window_status" NOT NULL,
    "successful_processor" "public"."payment_processor",
    "successful_payment_id" "text",
    "payment_completed_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transactions_amount_cents_check" CHECK (("amount_cents" > 0)),
    CONSTRAINT "transactions_platform_fee_cents_check" CHECK (("platform_fee_cents" >= 0)),
    CONSTRAINT "transactions_seller_payout_cents_check" CHECK (("seller_payout_cents" >= 0)),
    CONSTRAINT "valid_fee_split" CHECK (("amount_cents" = ("platform_fee_cents" + "seller_payout_cents")))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


COMMENT ON TABLE "public"."transactions" IS 'Payment transactions for auction settlements';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "display_name" "text",
    "photo_url" "text",
    "phone_number" "text",
    "role" "public"."user_role" DEFAULT 'user'::"public"."user_role" NOT NULL,
    "seller_tier" "public"."tier_level" DEFAULT 'TIER_1'::"public"."tier_level" NOT NULL,
    "lifetime_sales_cents" bigint DEFAULT 0 NOT NULL,
    "trailing_12mo_sales_cents" bigint DEFAULT 0 NOT NULL,
    "tier_updated_at" timestamp with time zone,
    "age_verified" boolean DEFAULT false NOT NULL,
    "age_verified_at" timestamp with time zone,
    "age_verification_provider" "text",
    "seller_verification_status" "public"."verification_status" DEFAULT 'NONE'::"public"."verification_status" NOT NULL,
    "seller_verification_submitted_at" timestamp with time zone,
    "seller_verification_reviewed_at" timestamp with time zone,
    "seller_verification_rejection_reason" "text",
    "is_banned" boolean DEFAULT false NOT NULL,
    "banned_at" timestamp with time zone,
    "banned_until" timestamp with time zone,
    "ban_reason" "text",
    "is_suspended" boolean DEFAULT false NOT NULL,
    "suspended_at" timestamp with time zone,
    "suspended_until" timestamp with time zone,
    "suspension_reason" "text",
    "warning_count" integer DEFAULT 0 NOT NULL,
    "preferred_brand" "public"."brand_type" DEFAULT 'AUCTIONX'::"public"."brand_type",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_login_at" timestamp with time zone,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON TABLE "public"."users" IS 'User accounts with profile, verification, and seller information';



COMMENT ON COLUMN "public"."users"."seller_tier" IS 'Tier determines platform fee: TIER_1=20%, TIER_2=17.5%, TIER_3=15%';



COMMENT ON COLUMN "public"."users"."trailing_12mo_sales_cents" IS 'Sales in last 12 months (cents) - used for tier calculation';



ALTER TABLE ONLY "public"."auctions"
    ADD CONSTRAINT "auctions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bids"
    ADD CONSTRAINT "bids_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."crypto_payments"
    ADD CONSTRAINT "crypto_payments_nowpayments_payment_id_key" UNIQUE ("nowpayments_payment_id");



ALTER TABLE ONLY "public"."crypto_payments"
    ADD CONSTRAINT "crypto_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."listing_media"
    ADD CONSTRAINT "listing_media_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."listings"
    ADD CONSTRAINT "listings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auctions"
    ADD CONSTRAINT "one_auction_per_listing" UNIQUE ("listing_id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "one_transaction_per_auction" UNIQUE ("auction_id");



ALTER TABLE ONLY "public"."payment_attempts"
    ADD CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."processor_config"
    ADD CONSTRAINT "processor_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."processor_config"
    ADD CONSTRAINT "processor_config_processor_key" UNIQUE ("processor");



ALTER TABLE ONLY "public"."processor_health"
    ADD CONSTRAINT "processor_health_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."processor_health"
    ADD CONSTRAINT "processor_health_processor_key" UNIQUE ("processor");



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shipping_addresses"
    ADD CONSTRAINT "shipping_addresses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_attempts"
    ADD CONSTRAINT "unique_attempt_per_transaction" UNIQUE ("transaction_id", "processor", "attempt_number");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_auctions_end_time" ON "public"."auctions" USING "btree" ("end_time");



CREATE INDEX "idx_auctions_listing_id" ON "public"."auctions" USING "btree" ("listing_id");



CREATE INDEX "idx_auctions_seller_id" ON "public"."auctions" USING "btree" ("seller_id");



CREATE INDEX "idx_auctions_start_time" ON "public"."auctions" USING "btree" ("start_time");



CREATE INDEX "idx_auctions_status" ON "public"."auctions" USING "btree" ("status");



CREATE INDEX "idx_auctions_winner_id" ON "public"."auctions" USING "btree" ("winner_id");



CREATE INDEX "idx_bids_auction_created" ON "public"."bids" USING "btree" ("auction_id", "created_at" DESC);



CREATE INDEX "idx_bids_auction_id" ON "public"."bids" USING "btree" ("auction_id");



CREATE INDEX "idx_bids_bidder_id" ON "public"."bids" USING "btree" ("bidder_id");



CREATE INDEX "idx_bids_created_at" ON "public"."bids" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_categories_brand" ON "public"."categories" USING "btree" ("brand_restriction");



CREATE INDEX "idx_categories_parent_id" ON "public"."categories" USING "btree" ("parent_id");



CREATE INDEX "idx_categories_slug" ON "public"."categories" USING "btree" ("slug");



CREATE INDEX "idx_crypto_payments_expires_at" ON "public"."crypto_payments" USING "btree" ("expires_at");



CREATE INDEX "idx_crypto_payments_nowpayments_id" ON "public"."crypto_payments" USING "btree" ("nowpayments_payment_id");



CREATE INDEX "idx_crypto_payments_transaction_id" ON "public"."crypto_payments" USING "btree" ("transaction_id");



CREATE INDEX "idx_listing_media_listing_id" ON "public"."listing_media" USING "btree" ("listing_id", "sort_order");



CREATE INDEX "idx_listing_media_sort_order" ON "public"."listing_media" USING "btree" ("listing_id", "sort_order");



CREATE INDEX "idx_listings_active" ON "public"."listings" USING "btree" ("status", "brand") WHERE (("status" = 'ACTIVE'::"public"."listing_status") AND ("deleted_at" IS NULL));



CREATE INDEX "idx_listings_brand" ON "public"."listings" USING "btree" ("brand");



CREATE INDEX "idx_listings_category_id" ON "public"."listings" USING "btree" ("category_id");



CREATE INDEX "idx_listings_created_at" ON "public"."listings" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_listings_seller_id" ON "public"."listings" USING "btree" ("seller_id");



CREATE INDEX "idx_listings_status" ON "public"."listings" USING "btree" ("status");



CREATE INDEX "idx_payment_attempts_correlation_id" ON "public"."payment_attempts" USING "btree" ("correlation_id");



CREATE INDEX "idx_payment_attempts_created_at" ON "public"."payment_attempts" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_payment_attempts_processor" ON "public"."payment_attempts" USING "btree" ("processor");



CREATE INDEX "idx_payment_attempts_transaction_id" ON "public"."payment_attempts" USING "btree" ("transaction_id");



CREATE INDEX "idx_payments_auction_id" ON "public"."payments" USING "btree" ("auction_id");



CREATE INDEX "idx_payments_buyer_id" ON "public"."payments" USING "btree" ("buyer_id");



CREATE INDEX "idx_payments_processor_payment_id" ON "public"."payments" USING "btree" ("processor_payment_id");



CREATE INDEX "idx_payments_seller_id" ON "public"."payments" USING "btree" ("seller_id");



CREATE INDEX "idx_payments_status" ON "public"."payments" USING "btree" ("status");



CREATE INDEX "idx_refunds_processor_id" ON "public"."refunds" USING "btree" ("processor_refund_id");



CREATE INDEX "idx_refunds_transaction_id" ON "public"."refunds" USING "btree" ("transaction_id");



CREATE INDEX "idx_settlements_auction_id" ON "public"."settlements" USING "btree" ("auction_id");



CREATE INDEX "idx_settlements_payment_id" ON "public"."settlements" USING "btree" ("payment_id");



CREATE INDEX "idx_settlements_seller_id" ON "public"."settlements" USING "btree" ("seller_id");



CREATE INDEX "idx_settlements_status" ON "public"."settlements" USING "btree" ("status");



CREATE INDEX "idx_shipping_addresses_is_default" ON "public"."shipping_addresses" USING "btree" ("user_id", "is_default") WHERE ("is_default" = true);



CREATE INDEX "idx_shipping_addresses_user_id" ON "public"."shipping_addresses" USING "btree" ("user_id");



CREATE INDEX "idx_transactions_auction_id" ON "public"."transactions" USING "btree" ("auction_id");



CREATE INDEX "idx_transactions_buyer_id" ON "public"."transactions" USING "btree" ("buyer_id");



CREATE INDEX "idx_transactions_correlation_id" ON "public"."transactions" USING "btree" ("cascade_correlation_id");



CREATE INDEX "idx_transactions_payment_window" ON "public"."transactions" USING "btree" ("payment_window_expires_at") WHERE ("payment_window_status" = 'ACTIVE'::"public"."payment_window_status");



CREATE INDEX "idx_transactions_seller_id" ON "public"."transactions" USING "btree" ("seller_id");



CREATE INDEX "idx_transactions_status" ON "public"."transactions" USING "btree" ("status");



CREATE INDEX "idx_users_deleted_at" ON "public"."users" USING "btree" ("deleted_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email");



CREATE INDEX "idx_users_role" ON "public"."users" USING "btree" ("role");



CREATE INDEX "idx_users_seller_tier" ON "public"."users" USING "btree" ("seller_tier");



CREATE OR REPLACE TRIGGER "auto_update_seller_tier" BEFORE UPDATE OF "trailing_12mo_sales_cents" ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_seller_tier"();



CREATE OR REPLACE TRIGGER "enforce_single_default" BEFORE INSERT OR UPDATE ON "public"."shipping_addresses" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_single_default_address"();



CREATE OR REPLACE TRIGGER "prevent_self_bidding" BEFORE INSERT ON "public"."bids" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_self_bid"();



CREATE OR REPLACE TRIGGER "set_updated_at_categories" BEFORE UPDATE ON "public"."categories" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_updated_at_listings" BEFORE UPDATE ON "public"."listings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_updated_at_payments" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_updated_at_settlements" BEFORE UPDATE ON "public"."settlements" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_updated_at_shipping_addresses" BEFORE UPDATE ON "public"."shipping_addresses" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_updated_at_users" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "shipping_addresses_updated_at" BEFORE UPDATE ON "public"."shipping_addresses" FOR EACH ROW EXECUTE FUNCTION "public"."update_shipping_address_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_proxy_bid" AFTER INSERT ON "public"."bids" FOR EACH ROW EXECUTE FUNCTION "public"."handle_proxy_bid"();



CREATE OR REPLACE TRIGGER "update_auctions_updated_at" BEFORE UPDATE ON "public"."auctions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_crypto_payments_updated_at" BEFORE UPDATE ON "public"."crypto_payments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_processor_config_updated_at" BEFORE UPDATE ON "public"."processor_config" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_processor_health_updated_at" BEFORE UPDATE ON "public"."processor_health" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_transactions_updated_at" BEFORE UPDATE ON "public"."transactions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."auctions"
    ADD CONSTRAINT "auctions_high_bidder_id_fkey" FOREIGN KEY ("high_bidder_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."auctions"
    ADD CONSTRAINT "auctions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."auctions"
    ADD CONSTRAINT "auctions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."auctions"
    ADD CONSTRAINT "auctions_winner_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bids"
    ADD CONSTRAINT "bids_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bids"
    ADD CONSTRAINT "bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crypto_payments"
    ADD CONSTRAINT "crypto_payments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."listing_media"
    ADD CONSTRAINT "listing_media_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."listings"
    ADD CONSTRAINT "listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."listings"
    ADD CONSTRAINT "listings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_attempts"
    ADD CONSTRAINT "payment_attempts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id");



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."shipping_addresses"
    ADD CONSTRAINT "shipping_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can manage categories" ON "public"."categories" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"public"."user_role", 'super_admin'::"public"."user_role"]))))));



CREATE POLICY "Age-verified users can view NSFW listings" ON "public"."listings" FOR SELECT USING ((("status" = 'ACTIVE'::"public"."listing_status") AND ("deleted_at" IS NULL) AND ("is_nsfw" = true) AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."age_verified" = true))))));



COMMENT ON POLICY "Age-verified users can view NSFW listings" ON "public"."listings" IS 'NSFW content requires age verification via Yoti';



CREATE POLICY "Anyone can view active listings" ON "public"."listings" FOR SELECT USING (("status" = ANY (ARRAY['ACTIVE'::"public"."listing_status", 'SOLD'::"public"."listing_status"])));



CREATE POLICY "Anyone can view listing media" ON "public"."listing_media" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."listings"
  WHERE (("listings"."id" = "listing_media"."listing_id") AND (("listings"."status" = ANY (ARRAY['ACTIVE'::"public"."listing_status", 'SOLD'::"public"."listing_status"])) OR ("listings"."seller_id" = "auth"."uid"()))))));



CREATE POLICY "Anyone can view users" ON "public"."users" FOR SELECT USING (true);



CREATE POLICY "Buyers can view own payments" ON "public"."payments" FOR SELECT USING (("auth"."uid"() = "buyer_id"));



CREATE POLICY "Categories are viewable by everyone" ON "public"."categories" FOR SELECT USING (true);



CREATE POLICY "Finance can view all payments" ON "public"."payments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"public"."user_role", 'super_admin'::"public"."user_role", 'finance'::"public"."user_role"]))))));



CREATE POLICY "Finance can view all settlements" ON "public"."settlements" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"public"."user_role", 'super_admin'::"public"."user_role", 'finance'::"public"."user_role"]))))));



CREATE POLICY "Moderators can view all listings" ON "public"."listings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"public"."user_role", 'super_admin'::"public"."user_role", 'moderator'::"public"."user_role"]))))));



CREATE POLICY "Public can view SFW active listings" ON "public"."listings" FOR SELECT USING ((("status" = 'ACTIVE'::"public"."listing_status") AND ("deleted_at" IS NULL) AND ("is_nsfw" = false)));



COMMENT ON POLICY "Public can view SFW active listings" ON "public"."listings" IS 'Non-authenticated users can browse non-NSFW active listings';



CREATE POLICY "Public can view listing media" ON "public"."listing_media" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."listings"
  WHERE (("listings"."id" = "listing_media"."listing_id") AND ("listings"."status" = 'ACTIVE'::"public"."listing_status") AND ("listings"."deleted_at" IS NULL) AND (("listings"."is_nsfw" = false) OR (EXISTS ( SELECT 1
           FROM "public"."users"
          WHERE (("users"."id" = "auth"."uid"()) AND ("users"."age_verified" = true)))))))));



CREATE POLICY "Sellers can create listings" ON "public"."listings" FOR INSERT WITH CHECK (("auth"."uid"() = "seller_id"));



CREATE POLICY "Sellers can delete own listings" ON "public"."listings" FOR DELETE USING (("auth"."uid"() = "seller_id"));



CREATE POLICY "Sellers can manage own listing media" ON "public"."listing_media" USING ((EXISTS ( SELECT 1
   FROM "public"."listings"
  WHERE (("listings"."id" = "listing_media"."listing_id") AND ("listings"."seller_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."listings"
  WHERE (("listings"."id" = "listing_media"."listing_id") AND ("listings"."seller_id" = "auth"."uid"())))));



CREATE POLICY "Sellers can update own listings" ON "public"."listings" FOR UPDATE USING (("auth"."uid"() = "seller_id")) WITH CHECK (("auth"."uid"() = "seller_id"));



CREATE POLICY "Sellers can view own drafts" ON "public"."listings" FOR SELECT USING (("auth"."uid"() = "seller_id"));



CREATE POLICY "Sellers can view own listings" ON "public"."listings" FOR SELECT USING (("auth"."uid"() = "seller_id"));



CREATE POLICY "Sellers can view own settlements" ON "public"."settlements" FOR SELECT USING (("auth"."uid"() = "seller_id"));



CREATE POLICY "Sellers can view payments for own auctions" ON "public"."payments" FOR SELECT USING (("auth"."uid"() = "seller_id"));



CREATE POLICY "Service role can create payments" ON "public"."payments" FOR INSERT WITH CHECK (false);



COMMENT ON POLICY "Service role can create payments" ON "public"."payments" IS 'Payments are created by backend service after Stripe/Segpay confirmation';



CREATE POLICY "Service role can create settlements" ON "public"."settlements" FOR INSERT WITH CHECK (false);



COMMENT ON POLICY "Service role can create settlements" ON "public"."settlements" IS 'Settlements are calculated and created by backend settlement service';



CREATE POLICY "Users can delete own addresses" ON "public"."shipping_addresses" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own addresses" ON "public"."shipping_addresses" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own addresses" ON "public"."shipping_addresses" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."users" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK ((("auth"."uid"() = "id") AND ("role" = ( SELECT "users_1"."role"
   FROM "public"."users" "users_1"
  WHERE ("users_1"."id" = "auth"."uid"()))) AND ("seller_tier" = ( SELECT "users_1"."seller_tier"
   FROM "public"."users" "users_1"
  WHERE ("users_1"."id" = "auth"."uid"())))));



CREATE POLICY "Users can view own addresses" ON "public"."shipping_addresses" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Verified sellers can create listings" ON "public"."listings" FOR INSERT WITH CHECK ((("auth"."uid"() = "seller_id") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."seller_verification_status" = 'APPROVED'::"public"."verification_status"))))));



ALTER TABLE "public"."auctions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auctions_public_read" ON "public"."auctions" FOR SELECT USING (("status" = ANY (ARRAY['ACTIVE'::"public"."auction_status", 'ENDED'::"public"."auction_status", 'SETTLED'::"public"."auction_status"])));



CREATE POLICY "auctions_seller_create" ON "public"."auctions" FOR INSERT WITH CHECK ((("seller_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."listings"
  WHERE (("listings"."id" = "auctions"."listing_id") AND ("listings"."seller_id" = "auth"."uid"()))))));



CREATE POLICY "auctions_seller_read" ON "public"."auctions" FOR SELECT USING (("seller_id" = "auth"."uid"()));



CREATE POLICY "auctions_seller_update" ON "public"."auctions" FOR UPDATE USING ((("seller_id" = "auth"."uid"()) AND ("status" = ANY (ARRAY['DRAFT'::"public"."auction_status", 'SCHEDULED'::"public"."auction_status"])))) WITH CHECK (("seller_id" = "auth"."uid"()));



ALTER TABLE "public"."bids" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bids_create" ON "public"."bids" FOR INSERT WITH CHECK ((("bidder_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."auctions"
  WHERE (("auctions"."id" = "bids"."auction_id") AND ("auctions"."status" = 'ACTIVE'::"public"."auction_status") AND ("auctions"."seller_id" <> "auth"."uid"()) AND (("now"() >= "auctions"."start_time") AND ("now"() <= "auctions"."end_time")))))));



CREATE POLICY "bids_read" ON "public"."bids" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."auctions"
  WHERE (("auctions"."id" = "bids"."auction_id") AND (("auctions"."status" = ANY (ARRAY['ACTIVE'::"public"."auction_status", 'ENDED'::"public"."auction_status", 'SETTLED'::"public"."auction_status"])) OR ("auctions"."seller_id" = "auth"."uid"()))))));



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crypto_payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "crypto_payments_admin_all" ON "public"."crypto_payments" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"public"."user_role", 'super_admin'::"public"."user_role", 'finance'::"public"."user_role"]))))));



CREATE POLICY "crypto_payments_transaction_owner_read" ON "public"."crypto_payments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."transactions" "t"
  WHERE (("t"."id" = "crypto_payments"."transaction_id") AND (("t"."buyer_id" = "auth"."uid"()) OR ("t"."seller_id" = "auth"."uid"()))))));



ALTER TABLE "public"."listing_media" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."listings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payment_attempts_admin_all" ON "public"."payment_attempts" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"public"."user_role", 'super_admin'::"public"."user_role", 'finance'::"public"."user_role"]))))));



CREATE POLICY "payment_attempts_transaction_owner_read" ON "public"."payment_attempts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."transactions" "t"
  WHERE (("t"."id" = "payment_attempts"."transaction_id") AND (("t"."buyer_id" = "auth"."uid"()) OR ("t"."seller_id" = "auth"."uid"()))))));



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."processor_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "processor_config_admin_all" ON "public"."processor_config" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"public"."user_role", 'super_admin'::"public"."user_role"]))))));



ALTER TABLE "public"."processor_health" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "processor_health_admin_all" ON "public"."processor_health" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"public"."user_role", 'super_admin'::"public"."user_role"]))))));



CREATE POLICY "processor_health_public_read" ON "public"."processor_health" FOR SELECT USING (true);



ALTER TABLE "public"."refunds" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "refunds_admin_all" ON "public"."refunds" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"public"."user_role", 'super_admin'::"public"."user_role", 'finance'::"public"."user_role"]))))));



CREATE POLICY "refunds_transaction_owner_read" ON "public"."refunds" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."transactions" "t"
  WHERE (("t"."id" = "refunds"."transaction_id") AND (("t"."buyer_id" = "auth"."uid"()) OR ("t"."seller_id" = "auth"."uid"()))))));



ALTER TABLE "public"."settlements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shipping_addresses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transactions_admin_all" ON "public"."transactions" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"public"."user_role", 'super_admin'::"public"."user_role", 'finance'::"public"."user_role"]))))));



CREATE POLICY "transactions_buyer_read" ON "public"."transactions" FOR SELECT USING (("buyer_id" = "auth"."uid"()));



CREATE POLICY "transactions_seller_read" ON "public"."transactions" FOR SELECT USING (("seller_id" = "auth"."uid"()));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."calculate_platform_fee_percent"("tier" "public"."tier_level") TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_platform_fee_percent"("tier" "public"."tier_level") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_platform_fee_percent"("tier" "public"."tier_level") TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_processor_success_rate"("p_processor" "public"."payment_processor", "p_hours" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_processor_success_rate"("p_processor" "public"."payment_processor", "p_hours" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_processor_success_rate"("p_processor" "public"."payment_processor", "p_hours" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_seller_tier"("trailing_12mo_sales" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_seller_tier"("trailing_12mo_sales" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_seller_tier"("trailing_12mo_sales" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."determine_risk_level"("flags" "public"."content_flag"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."determine_risk_level"("flags" "public"."content_flag"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."determine_risk_level"("flags" "public"."content_flag"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_single_default_address"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_single_default_address"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_single_default_address"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_minimum_next_bid"("auction_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_minimum_next_bid"("auction_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_minimum_next_bid"("auction_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_winning_bid"("auction_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_winning_bid"("auction_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_winning_bid"("auction_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_proxy_bid"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_proxy_bid"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_proxy_bid"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_user_login"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_user_login"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_user_login"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_high_bidder"("auction_uuid" "uuid", "user_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_high_bidder"("auction_uuid" "uuid", "user_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_high_bidder"("auction_uuid" "uuid", "user_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_self_bid"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_self_bid"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_self_bid"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_seller_tier"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_seller_tier"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_seller_tier"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_shipping_address_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_shipping_address_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_shipping_address_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";


















GRANT ALL ON TABLE "public"."auctions" TO "anon";
GRANT ALL ON TABLE "public"."auctions" TO "authenticated";
GRANT ALL ON TABLE "public"."auctions" TO "service_role";



GRANT ALL ON TABLE "public"."bids" TO "anon";
GRANT ALL ON TABLE "public"."bids" TO "authenticated";
GRANT ALL ON TABLE "public"."bids" TO "service_role";



GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON TABLE "public"."crypto_payments" TO "anon";
GRANT ALL ON TABLE "public"."crypto_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."crypto_payments" TO "service_role";



GRANT ALL ON TABLE "public"."listing_media" TO "anon";
GRANT ALL ON TABLE "public"."listing_media" TO "authenticated";
GRANT ALL ON TABLE "public"."listing_media" TO "service_role";



GRANT ALL ON TABLE "public"."listings" TO "anon";
GRANT ALL ON TABLE "public"."listings" TO "authenticated";
GRANT ALL ON TABLE "public"."listings" TO "service_role";



GRANT ALL ON TABLE "public"."payment_attempts" TO "anon";
GRANT ALL ON TABLE "public"."payment_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."processor_config" TO "anon";
GRANT ALL ON TABLE "public"."processor_config" TO "authenticated";
GRANT ALL ON TABLE "public"."processor_config" TO "service_role";



GRANT ALL ON TABLE "public"."processor_health" TO "anon";
GRANT ALL ON TABLE "public"."processor_health" TO "authenticated";
GRANT ALL ON TABLE "public"."processor_health" TO "service_role";



GRANT ALL ON TABLE "public"."refunds" TO "anon";
GRANT ALL ON TABLE "public"."refunds" TO "authenticated";
GRANT ALL ON TABLE "public"."refunds" TO "service_role";



GRANT ALL ON TABLE "public"."settlements" TO "anon";
GRANT ALL ON TABLE "public"."settlements" TO "authenticated";
GRANT ALL ON TABLE "public"."settlements" TO "service_role";



GRANT ALL ON TABLE "public"."shipping_addresses" TO "anon";
GRANT ALL ON TABLE "public"."shipping_addresses" TO "authenticated";
GRANT ALL ON TABLE "public"."shipping_addresses" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_user_login AFTER INSERT ON auth.sessions FOR EACH ROW EXECUTE FUNCTION public.handle_user_login();

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS objects_delete_delete_prefix ON storage.objects;
DROP TRIGGER IF EXISTS objects_delete_delete_prefix ON storage.objects;
CREATE TRIGGER objects_delete_delete_prefix AFTER DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();

DROP TRIGGER IF EXISTS objects_insert_create_prefix ON storage.objects;
CREATE TRIGGER objects_insert_create_prefix BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.objects_insert_prefix_trigger();
DROP TRIGGER IF EXISTS objects_insert_create_prefix ON storage.objects;

DROP TRIGGER IF EXISTS objects_update_create_prefix ON storage.objects;
CREATE TRIGGER objects_update_create_prefix BEFORE UPDATE ON storage.objects FOR EACH ROW WHEN (((new.name <> old.name) OR (new.bucket_id <> old.bucket_id))) EXECUTE FUNCTION storage.objects_update_prefix_trigger();
DROP TRIGGER IF EXISTS objects_update_create_prefix ON storage.objects;

DROP TRIGGER IF EXISTS objects_update_create_prefix ON storage.objects;
DROP TRIGGER IF EXISTS prefixes_create_hierarchy ON storage.prefixes;
CREATE TRIGGER prefixes_create_hierarchy BEFORE INSERT ON storage.prefixes FOR EACH ROW WHEN ((pg_trigger_depth() < 1)) EXECUTE FUNCTION storage.prefixes_insert_trigger();

DROP TRIGGER IF EXISTS prefixes_delete_hierarchy ON storage.prefixes;
CREATE TRIGGER prefixes_delete_hierarchy AFTER DELETE ON storage.prefixes FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();
DROP TRIGGER IF EXISTS prefixes_delete_hierarchy ON storage.prefixes;


