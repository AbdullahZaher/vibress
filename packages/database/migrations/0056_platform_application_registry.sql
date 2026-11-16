-- Migration 0056: persisted application registry and membership directory.
--
-- Additive only. Number 0055 stays reserved for the unapplied R26 proposal
-- (`proposals/0055_revoke_public_execute.sql`), which is a shared-database
-- privilege change and must not be folded into a schema migration.
--
-- Both tables are operator-owned infrastructure:
-- - `platform_application_registrations` stores the serializable application
--   manifest and its digest. Handler code is never persisted; boot proves that
--   the deployed code still matches the registered digest.
-- - `platform_memberships` is the principal directory read before a verified
--   tenant scope exists, so it cannot be RLS-protected. The tenant runtime
--   role is denied access to both tables (see provisionPlatformRuntimeRole).

CREATE TABLE IF NOT EXISTS "platform_application_registrations" (
  "application_id" text PRIMARY KEY NOT NULL
    REFERENCES "platform_applications" ("id") ON DELETE CASCADE,
  "version" text NOT NULL,
  "manifest" jsonb NOT NULL,
  "manifest_digest" text NOT NULL,
  "registered_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "platform_application_registrations_digest_check"
    CHECK ("manifest_digest" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS "platform_memberships" (
  "application_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "principal_id" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "roles" text[] NOT NULL,
  "permissions" text[] NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("application_id", "tenant_id", "principal_id"),
  CONSTRAINT "platform_memberships_tenant_fk"
    FOREIGN KEY ("tenant_id", "application_id")
    REFERENCES "platform_tenants" ("id", "application_id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "platform_memberships_principal_idx"
  ON "platform_memberships" ("application_id", "principal_id");
