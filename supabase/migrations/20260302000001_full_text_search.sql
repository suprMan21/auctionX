-- Migration: Module 14 — Full-Text Search + Saved Searches
-- Adds pg_trgm extension, tsvector search_vector column, GIN index,
-- auto-update trigger, trigram index on title, and saved_searches table.

-- ──────────────────────────────────────────────────────────────────────────────
-- Extensions
-- ──────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ──────────────────────────────────────────────────────────────────────────────
-- listings: add search_vector column
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Populate existing rows: weight A on title, B on description
UPDATE listings
SET search_vector = to_tsvector(
  'english',
  coalesce(title, '') || ' ' || coalesce(description, '')
)
WHERE search_vector IS NULL;

-- Auto-update trigger function
CREATE OR REPLACE FUNCTION listings_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$;

-- Trigger: fire before insert or update on title/description
DROP TRIGGER IF EXISTS listings_search_vector_trigger ON listings;
CREATE TRIGGER listings_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, description
  ON listings
  FOR EACH ROW
  EXECUTE FUNCTION listings_search_vector_update();

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_listings_search
  ON listings USING GIN (search_vector);

-- Trigram index for LIKE/ILIKE fallback on title
CREATE INDEX IF NOT EXISTS idx_listings_title_trgm
  ON listings USING GIN (title gin_trgm_ops);

-- ──────────────────────────────────────────────────────────────────────────────
-- saved_searches table
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_searches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name               text NOT NULL,
  query              text NOT NULL DEFAULT '',
  filters            jsonb NOT NULL DEFAULT '{}',
  notify_new_results boolean NOT NULL DEFAULT false,
  last_checked_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Row Level Security
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists to make migration idempotent
DROP POLICY IF EXISTS saved_searches_user_all ON saved_searches;

CREATE POLICY saved_searches_user_all
  ON saved_searches
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
