-- Migration 0039: publication-scoped featured post flag.
-- Constant DEFAULT false preserves all existing posts without a backfill.
SET LOCAL lock_timeout = '5s';
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "featured" boolean NOT NULL DEFAULT false;
