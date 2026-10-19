-- Migration 0041: scoped external extension settings; never copy v1 global secrets.
-- Depends on 0040. Existing installations remain untouched and every new
-- external plugin has no settings until explicitly configured by Staff.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "plugin_publication_settings" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "publication_id" text NOT NULL,
  "key" text NOT NULL,
  "value" text,
  "encrypted_value" text,
  "is_secret" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plugin_pub_settings_owner_fk" FOREIGN KEY ("plugin_id", "publication_id")
    REFERENCES "plugin_publication_states" ("plugin_id", "publication_id") ON DELETE RESTRICT,
  CONSTRAINT "plugin_pub_settings_value_check" CHECK (
    (is_secret = true AND value IS NULL AND encrypted_value IS NOT NULL)
    OR (is_secret = false AND encrypted_value IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "plugin_pub_settings_unique_idx"
  ON "plugin_publication_settings" ("plugin_id", "publication_id", "key");

CREATE INDEX IF NOT EXISTS "plugin_pub_settings_publication_idx"
  ON "plugin_publication_settings" ("publication_id");
