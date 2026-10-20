-- EXT-203A: trusted plugin migration ledger and namespaced model catalog.
-- Additive: no modifications/backfill to legacy plugins, settings, activation,
-- publications or content. A plugin with migrations cannot be deleted casually.
-- This migration does NOT run plugin-provided SQL or create plugin data tables.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "plugin_schema_migrations" (
  "plugin_id" text NOT NULL REFERENCES "plugins"("id") ON DELETE RESTRICT,
  "migration_id" text NOT NULL,
  "package_version" text NOT NULL,
  "artifact_sha256" text NOT NULL,
  "migration_sha256" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plugin_schema_migrations_id_check" CHECK
    ("migration_id" ~ '^[0-9]{4}_[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT "plugin_schema_migrations_artifact_sha_check" CHECK
    ("artifact_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "plugin_schema_migrations_migration_sha_check" CHECK
    ("migration_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "plugin_schema_migrations_package_version_check" CHECK
    (length("package_version") BETWEEN 1 AND 128)
);
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_schema_migrations_owner_id_idx"
  ON "plugin_schema_migrations" ("plugin_id", "migration_id");

CREATE TABLE IF NOT EXISTS "plugin_storage_models" (
  "plugin_id" text NOT NULL,
  "model_key" text NOT NULL,
  "migration_id" text NOT NULL,
  "schema_sha256" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plugin_storage_models_migration_fk" FOREIGN KEY
    ("plugin_id", "migration_id")
    REFERENCES "plugin_schema_migrations" ("plugin_id", "migration_id")
    ON DELETE RESTRICT,
  CONSTRAINT "plugin_storage_models_key_check" CHECK
    ("model_key" ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT "plugin_storage_models_schema_sha_check" CHECK
    ("schema_sha256" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_storage_models_owner_key_idx"
  ON "plugin_storage_models" ("plugin_id", "model_key");

-- Append-only enforcement at the database boundary. Even a buggy API cannot
-- change an already approved migration digest or model reservation. Changes
-- require an operator-reviewed forward migration, not UPDATE or DELETE.
CREATE OR REPLACE FUNCTION "vibress_plugin_storage_append_only"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Plugin migration metadata is append-only'
    USING ERRCODE = '23514';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'plugin_schema_migrations'::regclass
      AND tgname = 'plugin_schema_migrations_immutable'
  ) THEN
    CREATE TRIGGER "plugin_schema_migrations_immutable"
      BEFORE UPDATE OR DELETE ON "plugin_schema_migrations"
      FOR EACH ROW EXECUTE FUNCTION "vibress_plugin_storage_append_only"();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'plugin_storage_models'::regclass
      AND tgname = 'plugin_storage_models_immutable'
  ) THEN
    CREATE TRIGGER "plugin_storage_models_immutable"
      BEFORE UPDATE OR DELETE ON "plugin_storage_models"
      FOR EACH ROW EXECUTE FUNCTION "vibress_plugin_storage_append_only"();
  END IF;
END;
$$;
