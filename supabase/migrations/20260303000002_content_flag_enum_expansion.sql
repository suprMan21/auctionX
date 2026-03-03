-- Migration: Expand content_flag enum with MEDIUM-risk flags
-- Adds: SWIMWEAR, LINGERIE, PERSONAL_ITEM, FETISH
-- Adds: default_content_flag TEXT column to categories table
--
-- These flags are documented in CONTENT_FLAG_GUIDELINES.md and referenced
-- in CascadeOrchestrator.FLAG_SCORES (score 3–5 = MEDIUM risk), but were
-- missing from the DB enum, causing the orchestrator to silently ignore them.
--
-- Using ALTER TYPE ... ADD VALUE (Postgres 10+) which is non-transactional.
-- Each ADD VALUE is idempotent with IF NOT EXISTS.

ALTER TYPE content_flag ADD VALUE IF NOT EXISTS 'SWIMWEAR';
ALTER TYPE content_flag ADD VALUE IF NOT EXISTS 'LINGERIE';
ALTER TYPE content_flag ADD VALUE IF NOT EXISTS 'PERSONAL_ITEM';
ALTER TYPE content_flag ADD VALUE IF NOT EXISTS 'FETISH';

-- Add default_content_flag to categories so each category can declare
-- its baseline risk level. Uses TEXT (not the enum type) to remain
-- compatible with the locked Zod schemas and allow NULL for uncategorised.
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS default_content_flag TEXT DEFAULT NULL;

COMMENT ON COLUMN categories.default_content_flag IS
  'Default content_flag enum value for this category. Used by process-payment '
  'to establish the minimum risk floor. NULL means LOW risk (no floor).';
