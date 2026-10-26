-- PLUG-UPD-01: inert operator-only staged upgrade plan; additive and empty
-- for existing installs. No plugin code or schema migration is run by this.
SET LOCAL lock_timeout = '5s';

CREATE TABLE "plugin_upgrade_plans" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL REFERENCES "plugins" ("id") ON DELETE RESTRICT,
  "manifest_id" text NOT NULL,
  "from_version" text NOT NULL,
  "to_version" text NOT NULL,
  "from_artifact_sha256" text NOT NULL,
  "to_artifact_sha256" text NOT NULL,
  "from_lockfile_sha256" text NOT NULL,
  "to_lockfile_sha256" text NOT NULL,
  "from_signer_sha256" text NOT NULL,
  "to_signer_sha256" text NOT NULL,
  "capabilities_added" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "capabilities_removed" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "plan_sha256" text NOT NULL,
  "status" text NOT NULL DEFAULT 'staged',
  "revision" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plugin_upgrade_plans_status_check" CHECK
    ("status" IN ('staged', 'preflighted', 'approved', 'quiesced',
                  'migrated', 'activated', 'observed', 'completed', 'aborted')),
  CONSTRAINT "plugin_upgrade_plans_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "plugin_upgrade_plans_digests_check" CHECK (
    "from_artifact_sha256" ~ '^[a-f0-9]{64}$' AND
    "to_artifact_sha256" ~ '^[a-f0-9]{64}$' AND
    "from_lockfile_sha256" ~ '^[a-f0-9]{64}$' AND
    "to_lockfile_sha256" ~ '^[a-f0-9]{64}$' AND
    "from_signer_sha256" ~ '^[a-f0-9]{64}$' AND
    "to_signer_sha256" ~ '^[a-f0-9]{64}$' AND
    "plan_sha256" ~ '^[a-f0-9]{64}$'
  )
);

-- One unfinished plan per plugin globally; NOT per arbitrary caller/tenant.
CREATE UNIQUE INDEX "plugin_upgrade_plans_active_owner_idx"
  ON "plugin_upgrade_plans" ("plugin_id")
  WHERE "status" NOT IN ('aborted', 'completed');
CREATE INDEX "plugin_upgrade_plans_owner_created_idx"
  ON "plugin_upgrade_plans" ("plugin_id", "created_at");
