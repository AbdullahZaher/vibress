-- Migration 0040: publication activation for operator-installed plugins.
-- Non-destructive for existing installations: no backfill, no rewrite of
-- global "plugins" or "plugin_settings"; absent row means disabled.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "plugin_publication_states" (
  "plugin_id" text NOT NULL REFERENCES "plugins"("id") ON DELETE RESTRICT,
  "publication_id" text NOT NULL REFERENCES "publications"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "plugin_pub_states_plugin_publication_idx"
  ON "plugin_publication_states" ("plugin_id", "publication_id");

CREATE INDEX IF NOT EXISTS "plugin_pub_states_publication_idx"
  ON "plugin_publication_states" ("publication_id");
