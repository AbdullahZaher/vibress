-- MEM-101: Member custom avatar selection
-- Additive default column with zero-downtime lock safety.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "members"
  ADD COLUMN IF NOT EXISTS "avatar" text DEFAULT 'default';
