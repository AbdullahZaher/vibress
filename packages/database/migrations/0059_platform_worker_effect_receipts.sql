-- M02-E14 additive, opt-in atomic SQL worker receipt ledger.
-- No role GRANT, legacy CMS remapping, or external-effect guarantee.
-- A row is visible only when its transaction's protected SQL effect commits.
-- Keep receipts while a queued/replayed operation may exist; deleting one
-- without a drained queue and durable tenant tombstone permits re-execution.
-- The composite FKs intentionally RESTRICT tenant/installation deletion until
-- an independently authorized offboarding retention/replay policy exists.

CREATE UNIQUE INDEX IF NOT EXISTS "platform_installations_id_application_idx"
  ON "platform_installations" ("id", "application_id");

CREATE TABLE IF NOT EXISTS "platform_worker_effect_receipts" (
  "installation_id" text NOT NULL,
  "application_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "nonce" text NOT NULL,
  "principal_id" text NOT NULL,
  "job_type" text NOT NULL,
  "schema_revision" text NOT NULL,
  "payload_digest" text NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "platform_worker_effect_receipts_pk"
    PRIMARY KEY ("installation_id", "application_id", "tenant_id", "nonce"),
  CONSTRAINT "platform_worker_effect_receipts_installation_fk"
    FOREIGN KEY ("installation_id", "application_id")
    REFERENCES "platform_installations" ("id", "application_id")
    ON DELETE RESTRICT,
  CONSTRAINT "platform_worker_effect_receipts_tenant_fk"
    FOREIGN KEY ("tenant_id", "application_id")
    REFERENCES "platform_tenants" ("id", "application_id")
    ON DELETE RESTRICT,
  CONSTRAINT "platform_worker_effect_receipts_nonce_check"
    CHECK (octet_length("nonce") BETWEEN 1 AND 256),
  CONSTRAINT "platform_worker_effect_receipts_digest_check"
    CHECK ("payload_digest" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS "platform_worker_effect_receipts_tenant_idx"
  ON "platform_worker_effect_receipts" ("application_id", "tenant_id");

ALTER TABLE "platform_worker_effect_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_worker_effect_receipts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "platform_worker_effect_receipts_read_scope"
  ON "platform_worker_effect_receipts" FOR SELECT
  USING (
    "application_id" = NULLIF(current_setting('vibress.application_id', true), '')
    AND "tenant_id" = NULLIF(current_setting('vibress.tenant_id', true), '')
  );

CREATE POLICY "platform_worker_effect_receipts_insert_scope"
  ON "platform_worker_effect_receipts" FOR INSERT
  WITH CHECK (
    "application_id" = NULLIF(current_setting('vibress.application_id', true), '')
    AND "tenant_id" = NULLIF(current_setting('vibress.tenant_id', true), '')
  );

-- A runtime role may receive only separately approved SELECT and INSERT.
-- No UPDATE/DELETE/TRUNCATE privileges are added here; no approval is implied.
REVOKE ALL ON TABLE "platform_worker_effect_receipts" FROM PUBLIC;
