-- EXT-203 initial host-owned typed record storage and immutable migration receipt ledger.
-- No dynamic plugin DDL is executed from HTTP or SDK operations.
-- New tables only: legacy plugins, publication states, settings and content unchanged.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "plugin_data_models" (
  "plugin_id" text NOT NULL REFERENCES "plugins"("id") ON DELETE RESTRICT,
  "model_id" text NOT NULL,
  "schema_hash" text NOT NULL,
  "field_schema" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plugin_data_models_pk" PRIMARY KEY ("plugin_id", "model_id"),
  CONSTRAINT "plugin_data_model_name_check" CHECK (model_id ~ '^[a-z][a-z0-9-]{0,63}$'),
  CONSTRAINT "plugin_data_model_hash_check" CHECK (schema_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "plugin_data_model_schema_check" CHECK (jsonb_typeof(field_schema) = 'object')
);

CREATE TABLE IF NOT EXISTS "plugin_data_migration_ledger" (
  "plugin_id" text NOT NULL REFERENCES "plugins"("id") ON DELETE RESTRICT,
  "migration_id" text NOT NULL,
  "checksum" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plugin_data_migration_ledger_pk" PRIMARY KEY ("plugin_id", "migration_id"),
  CONSTRAINT "plugin_data_migration_id_check" CHECK (migration_id ~ '^[a-z0-9][a-z0-9_-]{0,99}$'),
  CONSTRAINT "plugin_data_migration_checksum_check" CHECK (checksum ~ '^[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS "plugin_data_records" (
  "plugin_id" text NOT NULL,
  "publication_id" text NOT NULL REFERENCES "publications"("id") ON DELETE CASCADE,
  "model_id" text NOT NULL,
  "record_id" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "data" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plugin_data_records_pk" PRIMARY KEY ("plugin_id", "publication_id", "model_id", "record_id"),
  CONSTRAINT "plugin_data_records_model_fk" FOREIGN KEY ("plugin_id", "model_id")
    REFERENCES "plugin_data_models"("plugin_id", "model_id") ON DELETE RESTRICT,
  CONSTRAINT "plugin_data_records_version_check" CHECK (version > 0),
  CONSTRAINT "plugin_data_records_id_check" CHECK (length(record_id) BETWEEN 1 AND 128),
  CONSTRAINT "plugin_data_records_payload_check" CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS "plugin_data_records_pub_model_idx"
  ON "plugin_data_records" ("publication_id", "plugin_id", "model_id", "created_at", "record_id");
