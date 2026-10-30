-- M8.8: additive, default-deny durable operator marketplace release admission.
-- No existing plugin is authorized or activated by this migration.
-- Released migrations must never be edited.
SET LOCAL lock_timeout = '5s';

CREATE TABLE "plugin_marketplace_admissions" (
  "plugin_id" text PRIMARY KEY NOT NULL
    REFERENCES "plugins"("id") ON DELETE RESTRICT,
  "publisher_id" text,
  "policy_revision" bigint NOT NULL,
  "admission" jsonb NOT NULL,
  "revoked" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plugin_marketplace_admissions_revision_check"
    CHECK ("policy_revision" > 0),
  CONSTRAINT "plugin_marketplace_admissions_json_check"
    CHECK (jsonb_typeof("admission") = 'object')
);

CREATE INDEX "plugin_marketplace_admissions_publisher_idx"
  ON "plugin_marketplace_admissions" ("publisher_id");
