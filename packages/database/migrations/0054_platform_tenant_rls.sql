-- Migration 0054: universal platform kernel identity and tenant-owned RLS.
--
-- Additive only. Publications remain the CMS identity; an Application or a
-- Tenant is never derived from a publication id and `pub_default` is not a
-- fallback for either.
--
-- The runtime role is a non-owner with NOBYPASSRLS. Policies fail closed when
-- the transaction-local application/tenant context is missing or empty.
-- TRUNCATE and REFERENCES are not governed by RLS, so the runtime role must
-- also be denied those privileges (see provisionPlatformRuntimeRole).

CREATE TABLE IF NOT EXISTS "platform_applications" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "platform_installations" (
  "id" text PRIMARY KEY NOT NULL,
  "application_id" text NOT NULL REFERENCES "platform_applications" ("id") ON DELETE CASCADE,
  "environment" text NOT NULL,
  "artifact_digest" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "platform_installations_application_idx"
  ON "platform_installations" ("application_id");

CREATE TABLE IF NOT EXISTS "platform_tenants" (
  "id" text PRIMARY KEY NOT NULL,
  "application_id" text NOT NULL REFERENCES "platform_applications" ("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "platform_tenants_application_idx"
  ON "platform_tenants" ("application_id");

CREATE UNIQUE INDEX IF NOT EXISTS "platform_tenants_id_application_idx"
  ON "platform_tenants" ("id", "application_id");

CREATE TABLE IF NOT EXISTS "platform_crm_customers" (
  "id" text PRIMARY KEY NOT NULL,
  "application_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "name" text NOT NULL,
  "email" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "platform_crm_customers_tenant_fk"
    FOREIGN KEY ("tenant_id", "application_id")
    REFERENCES "platform_tenants" ("id", "application_id")
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "platform_crm_customers_tenant_idx"
  ON "platform_crm_customers" ("application_id", "tenant_id");

ALTER TABLE "platform_crm_customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_crm_customers" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_crm_customers_tenant_isolation"
  ON "platform_crm_customers";
CREATE POLICY "platform_crm_customers_tenant_isolation"
  ON "platform_crm_customers"
  FOR ALL
  USING (
    "tenant_id" = NULLIF(current_setting('vibress.tenant_id', true), '')
    AND "application_id" = NULLIF(current_setting('vibress.application_id', true), '')
  )
  WITH CHECK (
    "tenant_id" = NULLIF(current_setting('vibress.tenant_id', true), '')
    AND "application_id" = NULLIF(current_setting('vibress.application_id', true), '')
  );
