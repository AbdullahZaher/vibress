-- EXT-401: operator event admission ledger, additive for fresh/upgraded installs.
-- Previously queued unledgered events must be drained before enabling the
-- strict ledger-backed worker. Do not silently replay old unverified jobs.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "plugin_event_receipts" (
  "id" text PRIMARY KEY,
  "event_id" text NOT NULL,
  "plugin_id" text NOT NULL REFERENCES "plugins" ("id") ON DELETE RESTRICT,
  "publication_id" text NOT NULL REFERENCES "publications" ("id") ON DELETE CASCADE,
  "envelope_hash" text NOT NULL,
  "envelope" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "finalized_at" timestamptz,
  CONSTRAINT "plugin_event_receipts_sha_check"
    CHECK ("envelope_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "plugin_event_receipts_status_check"
    CHECK ("status" IN ('pending', 'dispatching', 'queued', 'executed', 'retired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "plugin_event_receipts_scope_event_idx"
  ON "plugin_event_receipts" ("publication_id", "plugin_id", "event_id");
CREATE INDEX IF NOT EXISTS "plugin_event_receipts_status_created_idx"
  ON "plugin_event_receipts" ("status", "created_at");
