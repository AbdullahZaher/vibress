
-- EXT-203B1: immutable mapping of approved physical plugin-owned tables.
-- Additive: no content changes, backfill or executable plugin SQL.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "plugin_storage_physical_models" (
  "plugin_id" text NOT NULL,
  "model_key" text NOT NULL,
  "table_name" text NOT NULL,
  "schema_sha256" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plugin_storage_physical_models_owner_fk" FOREIGN KEY ("plugin_id", "model_key")
    REFERENCES "plugin_storage_models" ("plugin_id", "model_key") ON DELETE RESTRICT,
  CONSTRAINT "plugin_storage_physical_models_table_check" CHECK
    ("table_name" ~ '^ext_[a-f0-9]{40}$'),
  CONSTRAINT "plugin_storage_physical_models_digest_check" CHECK
    ("schema_sha256" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "plugin_storage_physical_models_owner_idx"
  ON "plugin_storage_physical_models" ("plugin_id", "model_key");
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_storage_physical_models_table_idx"
  ON "plugin_storage_physical_models" ("table_name");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'plugin_storage_physical_models'::regclass
      AND tgname = 'plugin_storage_physical_models_immutable'
  ) THEN
    CREATE TRIGGER "plugin_storage_physical_models_immutable"
      BEFORE UPDATE OR DELETE ON "plugin_storage_physical_models"
      FOR EACH ROW EXECUTE FUNCTION "vibress_plugin_storage_append_only"();
  END IF;
END;
$$;
