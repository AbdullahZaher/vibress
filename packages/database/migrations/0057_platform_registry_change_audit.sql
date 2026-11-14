-- Migration 0057: append-only audit of application registry mutations.
--
-- Additive only. Number 0055 stays reserved for the unapplied R26 proposal.
--
-- `PostgresApplicationRegistryStore.sync` writes one row here in the same
-- statement that creates or updates `platform_application_registrations`, so a
-- mutation cannot commit without its audit row. "unchanged" boots and refused
-- drift writes produce no row.
--
-- The foreign key is RESTRICT, not CASCADE: deleting an application must fail
-- while audit history exists, rather than silently erasing it. Operation-owned
-- table: the runtime and membership-reader roles receive no privilege; the
-- boot assertion treats it as a registry table.

CREATE TABLE IF NOT EXISTS "platform_application_registry_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id" text NOT NULL
    REFERENCES "platform_applications" ("id") ON DELETE RESTRICT,
  "change_kind" text NOT NULL,
  "actor" text NOT NULL,
  "previous_digest" text,
  "new_digest" text NOT NULL,
  "previous_version" text,
  "new_version" text NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "platform_application_registry_changes_kind_check"
    CHECK ("change_kind" IN ('created', 'updated')),
  CONSTRAINT "platform_application_registry_changes_actor_check"
    CHECK (length(btrim("actor")) > 0),
  CONSTRAINT "platform_application_registry_changes_previous_digest_check"
    CHECK ("previous_digest" IS NULL OR "previous_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "platform_application_registry_changes_new_digest_check"
    CHECK ("new_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "platform_application_registry_changes_previous_version_check"
    CHECK ("previous_version" IS NULL OR length(btrim("previous_version")) > 0),
  CONSTRAINT "platform_application_registry_changes_new_version_check"
    CHECK (length(btrim("new_version")) > 0),
  CONSTRAINT "platform_application_registry_changes_shape_check"
    CHECK (
      ("change_kind" = 'created' AND "previous_digest" IS NULL AND "previous_version" IS NULL)
      OR
      ("change_kind" = 'updated' AND "previous_digest" IS NOT NULL AND "previous_version" IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS "platform_application_registry_changes_app_idx"
  ON "platform_application_registry_changes" ("application_id", "recorded_at");
