-- Migration 0058: append-only audit of installation registration and changes.
--
-- Additive only. Number 0055 stays reserved for the unapplied R26 proposal.
--
-- Every installation create or update writes exactly one row in the same
-- statement that mutates `platform_installations`, so an accepted change is
-- always attributable and reproducible. Updates require an actor, a reason and
-- expected prior state (enforced by the registry store), and this table records
-- the actual before/after values observed by the database.
--
-- The foreign keys are RESTRICT: an installation or application with change
-- history cannot be deleted without first removing the audit rows explicitly.
-- The runtime, reader and verifier roles receive no privilege on this table;
-- the boot assertion treats it as a registry table.

CREATE TABLE IF NOT EXISTS "platform_installation_changes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "installation_id" text NOT NULL
    REFERENCES "platform_installations" ("id") ON DELETE RESTRICT,
  "application_id" text NOT NULL
    REFERENCES "platform_applications" ("id") ON DELETE RESTRICT,
  "change_kind" text NOT NULL,
  "actor" text NOT NULL,
  "reason" text NOT NULL,
  "deployment_reference" text,
  "previous_environment" text,
  "new_environment" text NOT NULL,
  "previous_artifact_digest" text,
  "new_artifact_digest" text,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "platform_installation_changes_kind_check"
    CHECK ("change_kind" IN ('created', 'updated')),
  CONSTRAINT "platform_installation_changes_actor_check"
    CHECK (length(btrim("actor")) > 0),
  CONSTRAINT "platform_installation_changes_reason_check"
    CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "platform_installation_changes_shape_check"
    CHECK (
      ("change_kind" = 'created'
        AND "previous_environment" IS NULL
        AND "previous_artifact_digest" IS NULL)
      OR
      ("change_kind" = 'updated'
        AND "previous_environment" IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS "platform_installation_changes_app_idx"
  ON "platform_installation_changes" ("application_id", "recorded_at");

CREATE INDEX IF NOT EXISTS "platform_installation_changes_installation_idx"
  ON "platform_installation_changes" ("installation_id", "recorded_at");
