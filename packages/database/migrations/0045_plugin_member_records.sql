-- EXT-205: opt-in Member-owned plugin records. Additive and empty on upgrade.
-- Apply before enabling the optional Member storage capability.
-- Never backfill legacy Staff plugin records into Member-owned rows.
SET LOCAL lock_timeout = '5s';

-- Members already have a global primary key. This non-unique read index's
-- added unique sibling enables a composite tenant/member FK, rejecting
-- cross-publication rows even from maintenance SQL outside the Host.
-- Assess the index lock on very large self-hosted member datasets before upgrade.
CREATE UNIQUE INDEX IF NOT EXISTS "members_publication_id_id_uq"
  ON "members" ("publication_id", "id");

CREATE TABLE "plugin_member_records" (
  "plugin_id" text NOT NULL,
  "publication_id" text NOT NULL,
  "member_id" text NOT NULL,
  "model_key" text NOT NULL,
  "record_id" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "fields" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plugin_member_records_publication_fk"
    FOREIGN KEY ("plugin_id", "publication_id")
    REFERENCES "plugin_publication_states" ("plugin_id", "publication_id") ON DELETE RESTRICT,
  CONSTRAINT "plugin_member_records_member_scope_fk"
    FOREIGN KEY ("publication_id", "member_id")
    REFERENCES "members" ("publication_id", "id") ON DELETE CASCADE,
  CONSTRAINT "plugin_member_records_model_fk"
    FOREIGN KEY ("plugin_id", "model_key")
    REFERENCES "plugin_storage_physical_models" ("plugin_id", "model_key") ON DELETE RESTRICT,
  CONSTRAINT "plugin_member_records_version_check" CHECK ("version" > 0),
  CONSTRAINT "plugin_member_records_fields_check" CHECK (jsonb_typeof("fields") = 'object')
);

CREATE UNIQUE INDEX "plugin_member_records_owner_key_idx"
  ON "plugin_member_records" ("plugin_id", "publication_id", "member_id", "model_key", "record_id");
CREATE INDEX "plugin_member_records_publication_member_idx"
  ON "plugin_member_records" ("publication_id", "member_id");
