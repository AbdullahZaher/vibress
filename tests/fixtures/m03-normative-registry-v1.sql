-- Isolated prototype, not a numbered migration or production schema.
-- Root-controlled trust configuration and immutable revision extension of 0059.
DO $scope$ BEGIN
 IF current_database() !~ '^vibress_s03_norm_[a-z0-9_]+$' OR current_setting('server_version_num')::int NOT BETWEEN 160000 AND 169999
 THEN RAISE EXCEPTION 'disposable PG16 only'; END IF;
END $scope$;
CREATE TABLE public.platform_schema_installation_trust_v1 (
 installation_id text PRIMARY KEY REFERENCES public.platform_installations(id),
 application_id text NOT NULL REFERENCES public.platform_applications(id),
 database_name text NOT NULL UNIQUE, database_oid text NOT NULL,
 namespace text NOT NULL UNIQUE, installer_role text NOT NULL, runtime_role text NOT NULL,
 approval_key text NOT NULL, approval_key_digest text NOT NULL CHECK (approval_key_digest ~ '^[a-f0-9]{64}$'),
 epoch uuid NOT NULL, ledger_id uuid NOT NULL, profile text NOT NULL CHECK(profile='DEDICATED_PG16_CORE_V1'),
 revoked boolean NOT NULL DEFAULT false, CHECK(installer_role<>runtime_role)
);
CREATE TABLE public.platform_schema_revisions_v1 (
 installation_id text NOT NULL REFERENCES public.platform_schema_registry(installation_id),
 revision_digest text NOT NULL CHECK(revision_digest ~ '^[a-f0-9]{64}$'),
 parent_digest text, manifest text NOT NULL, physical_digest text NOT NULL, plan_digest text NOT NULL,
 operation_id uuid NOT NULL UNIQUE, approval_id uuid NOT NULL UNIQUE,
 authority_epoch uuid NOT NULL, authority_head text NOT NULL, authority_sequence bigint NOT NULL,
 signer_digest text NOT NULL, signed_evidence text NOT NULL, signature text NOT NULL,
 applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(installation_id,revision_digest),
 FOREIGN KEY(installation_id,parent_digest) REFERENCES public.platform_schema_revisions_v1(installation_id,revision_digest)
);
REVOKE ALL ON public.platform_schema_installation_trust_v1,public.platform_schema_revisions_v1 FROM PUBLIC;
