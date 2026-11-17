-- M03-S03 operator-only schema metadata. Additive control-plane tables; no runtime grants.
CREATE TABLE "platform_schema_registry" (
  installation_id text PRIMARY KEY NOT NULL REFERENCES platform_installations(id) ON DELETE RESTRICT,
  application_id text NOT NULL REFERENCES platform_applications(id) ON DELETE RESTRICT,
  environment text NOT NULL CHECK (environment IN ('test','development')),
  database_name text NOT NULL,
  operator_role text NOT NULL,
  runtime_role text NOT NULL,
  manifest jsonb NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "platform_schema_plans" (
  installation_id text NOT NULL REFERENCES platform_schema_registry(installation_id) ON DELETE RESTRICT,
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[0-9a-f]{64}$'),
  expected_manifest jsonb NOT NULL,
  plan jsonb NOT NULL,
  author text NOT NULL CHECK (length(btrim(author)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, plan_digest)
);
CREATE TABLE "platform_schema_approvals" (
  installation_id text NOT NULL,
  plan_digest text NOT NULL,
  operation_id text NOT NULL,
  approver text NOT NULL CHECK (length(btrim(approver)) > 0),
  operator_role text NOT NULL,
  environment text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (installation_id, plan_digest, operation_id),
  FOREIGN KEY (installation_id, plan_digest)
    REFERENCES platform_schema_plans(installation_id, plan_digest) ON DELETE RESTRICT,
  CONSTRAINT platform_schema_approvals_expiry_check CHECK (expires_at > approved_at)
);
CREATE TABLE "platform_schema_migration_journal" (
  installation_id text NOT NULL,
  operation_id text NOT NULL,
  plan_digest text NOT NULL,
  previous_digest text NOT NULL CHECK (previous_digest ~ '^[0-9a-f]{64}$'),
  new_digest text NOT NULL CHECK (new_digest ~ '^[0-9a-f]{64}$'),
  authorization_ref text NOT NULL,
  operator_role text NOT NULL,
  status text NOT NULL CHECK (status = 'COMPLETED'),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  catalog_evidence jsonb NOT NULL,
  PRIMARY KEY (installation_id, operation_id),
  FOREIGN KEY (installation_id, plan_digest, operation_id)
    REFERENCES platform_schema_approvals(installation_id, plan_digest, operation_id)
    ON DELETE RESTRICT,
  CONSTRAINT platform_schema_journal_times_check CHECK (completed_at >= started_at)
);
CREATE INDEX platform_schema_approvals_expiry_idx
 ON platform_schema_approvals(expires_at, installation_id);
-- Intentional: no GRANTs or privileged role provisioning. Provisioner owns approvals.
