-- M03-S03 Agent05: additive, fail-closed authenticated approval provenance.
-- Deploy only with independently approved owner provisioning. Old NULL provenance is DENIED.
-- This feature is test/development only. NEVER register pooled/shared logins as humans.
CREATE TABLE public.platform_schema_trusted_actors (
  login_name text PRIMARY KEY,
  principal_id text NOT NULL UNIQUE CHECK (length(btrim(principal_id)) > 0),
  actor_kind text NOT NULL CHECK (actor_kind IN ('AUTHOR', 'APPROVER')),
  identity_mode text NOT NULL DEFAULT 'INDIVIDUAL_DATABASE_LOGIN'
    CHECK (identity_mode = 'INDIVIDUAL_DATABASE_LOGIN'),
  active boolean NOT NULL DEFAULT true,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.platform_schema_plans
  ADD COLUMN author_login text,
  ADD COLUMN author_principal_id text,
  ADD COLUMN author_application_id text,
  ADD COLUMN author_environment text;

ALTER TABLE public.platform_schema_approvals
  ADD COLUMN approver_login text,
  ADD COLUMN approver_principal_id text,
  ADD COLUMN approved_application_id text,
  ADD COLUMN revoked_by_login text,
  ADD COLUMN revoked_by_principal_id text;

CREATE TABLE public.platform_schema_revocation_audit (
  installation_id text NOT NULL,
  plan_digest text NOT NULL,
  operation_id text NOT NULL,
  revoked_by_login text NOT NULL,
  revoked_by_principal_id text NOT NULL,
  revoked_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, plan_digest, operation_id)
);

-- PostgreSQL session_user is the authenticated LOGIN (not a human for shared DSNs).
-- Trigger checks are deliberately present even if a bad grant permits direct INSERT.
CREATE FUNCTION public.platform_schema_plan_provenance_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor record;
  scope record;
  is_super boolean;
BEGIN
  SELECT rolsuper INTO is_super FROM pg_catalog.pg_roles WHERE rolname = session_user;
  IF is_super THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW; -- Reserved DBA/disposable fixture override, never an ordinary role.
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'plan provenance is immutable' USING ERRCODE = '42501';
  END IF;
  SELECT principal_id, actor_kind, active INTO actor
    FROM public.platform_schema_trusted_actors WHERE login_name = session_user;
  IF NOT FOUND OR NOT actor.active OR actor.actor_kind <> 'AUTHOR' THEN
    RAISE EXCEPTION 'untrusted plan author' USING ERRCODE = '42501';
  END IF;
  IF NEW.author IS DISTINCT FROM session_user OR NEW.author_login IS NOT NULL
     OR NEW.author_principal_id IS NOT NULL OR NEW.author_application_id IS NOT NULL
     OR NEW.author_environment IS NOT NULL THEN
    RAISE EXCEPTION 'forged plan author provenance' USING ERRCODE = '42501';
  END IF;
  SELECT application_id, environment INTO scope
    FROM public.platform_schema_registry
    WHERE installation_id = NEW.installation_id FOR SHARE;
  IF NOT FOUND OR scope.environment NOT IN ('test','development') THEN
    RAISE EXCEPTION 'untrusted plan installation' USING ERRCODE = '42501';
  END IF;
  NEW.author_login := session_user;
  NEW.author_principal_id := actor.principal_id;
  NEW.author_application_id := scope.application_id;
  NEW.author_environment := scope.environment;
  RETURN NEW;
END $$;

CREATE FUNCTION public.platform_schema_approval_provenance_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  actor record;
  plan_actor record;
  scope record;
  is_super boolean;
BEGIN
  SELECT rolsuper INTO is_super FROM pg_catalog.pg_roles WHERE rolname = session_user;
  IF is_super THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW; -- Privileged DBA override: independently audited out of band.
  END IF;
  SELECT principal_id, actor_kind, active INTO actor
    FROM public.platform_schema_trusted_actors WHERE login_name = session_user;
  IF NOT FOUND OR NOT actor.active OR actor.actor_kind <> 'APPROVER' THEN
    RAISE EXCEPTION 'untrusted approval actor' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approval deletion is forbidden' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
       OR (to_jsonb(NEW) - 'revoked_at' - 'revoked_by_login' - 'revoked_by_principal_id') <>
          (to_jsonb(OLD) - 'revoked_at' - 'revoked_by_login' - 'revoked_by_principal_id')
       OR OLD.approver_principal_id IS DISTINCT FROM actor.principal_id THEN
      RAISE EXCEPTION 'approval is immutable except one-way authorized revocation'
        USING ERRCODE = '42501';
    END IF;
    NEW.revoked_at := clock_timestamp();
    NEW.revoked_by_login := session_user;
    NEW.revoked_by_principal_id := actor.principal_id;
    RETURN NEW;
  END IF;
  IF NEW.approver IS DISTINCT FROM session_user
     OR NEW.approver_login IS NOT NULL OR NEW.approver_principal_id IS NOT NULL
     OR NEW.approved_application_id IS NOT NULL OR NEW.revoked_at IS NOT NULL
     OR NEW.revoked_by_login IS NOT NULL OR NEW.revoked_by_principal_id IS NOT NULL THEN
    RAISE EXCEPTION 'forged approval provenance' USING ERRCODE = '42501';
  END IF;
  SELECT author_login, author_principal_id, author_application_id, author_environment
    INTO plan_actor FROM public.platform_schema_plans
    WHERE installation_id = NEW.installation_id AND plan_digest = NEW.plan_digest
    FOR SHARE;
  IF NOT FOUND OR plan_actor.author_login IS NULL
     OR plan_actor.author_principal_id IS NULL
     OR plan_actor.author_principal_id = actor.principal_id
     OR plan_actor.author_login = session_user THEN
    RAISE EXCEPTION 'self-approval or legacy unauthenticated plan'
      USING ERRCODE = '42501';
  END IF;
  SELECT application_id, environment, operator_role INTO scope
    FROM public.platform_schema_registry
    WHERE installation_id = NEW.installation_id FOR SHARE;
  IF NOT FOUND OR scope.application_id IS DISTINCT FROM plan_actor.author_application_id
     OR scope.environment IS DISTINCT FROM plan_actor.author_environment
     OR scope.environment NOT IN ('test','development')
     OR NEW.environment IS DISTINCT FROM scope.environment
     OR NEW.operator_role IS DISTINCT FROM scope.operator_role
     OR NEW.expires_at <= clock_timestamp()
     OR NEW.expires_at > clock_timestamp() + interval '1 day' THEN
    RAISE EXCEPTION 'approval scope, role, or expiration mismatch'
      USING ERRCODE = '42501';
  END IF;
  NEW.approved_at := clock_timestamp();
  NEW.approver_login := session_user;
  NEW.approver_principal_id := actor.principal_id;
  NEW.approved_application_id := scope.application_id;
  RETURN NEW;
END $$;

CREATE TRIGGER platform_schema_plans_provenance
  BEFORE INSERT OR UPDATE OR DELETE ON public.platform_schema_plans
  FOR EACH ROW EXECUTE FUNCTION public.platform_schema_plan_provenance_guard();

CREATE TRIGGER platform_schema_approvals_provenance
  BEFORE INSERT OR UPDATE OR DELETE ON public.platform_schema_approvals
  FOR EACH ROW EXECUTE FUNCTION public.platform_schema_approval_provenance_guard();

CREATE FUNCTION public.platform_schema_revocation_audit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    INSERT INTO public.platform_schema_revocation_audit
      (installation_id, plan_digest, operation_id, revoked_by_login,
       revoked_by_principal_id, revoked_at)
    VALUES (NEW.installation_id, NEW.plan_digest, NEW.operation_id,
      COALESCE(NEW.revoked_by_login, session_user),
      COALESCE(NEW.revoked_by_principal_id, 'PRIVILEGED_DBA_OVERRIDE'),
      NEW.revoked_at);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER platform_schema_revocation_audit_write
  AFTER UPDATE ON public.platform_schema_approvals
  FOR EACH ROW EXECUTE FUNCTION public.platform_schema_revocation_audit_guard();

-- Entrypoints intentionally infer login, environment and operator from trusted DB state.
CREATE FUNCTION public.platform_schema_submit_plan(
  p_installation_id text, p_plan_digest text, p_expected_manifest text, p_plan text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.platform_schema_plans
    (installation_id, plan_digest, expected_manifest, plan, author)
  VALUES (p_installation_id, p_plan_digest, p_expected_manifest, p_plan, session_user);
END $$;

CREATE FUNCTION public.platform_schema_approve_operation(
  p_installation_id text, p_plan_digest text, p_operation_id text, p_expires_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE scope record;
BEGIN
  SELECT environment, operator_role INTO scope FROM public.platform_schema_registry
    WHERE installation_id = p_installation_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'missing approval installation' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.platform_schema_approvals
    (installation_id, plan_digest, operation_id, approver, operator_role,
     environment, expires_at)
  VALUES (p_installation_id, p_plan_digest, p_operation_id, session_user,
     scope.operator_role, scope.environment, p_expires_at);
END $$;

CREATE FUNCTION public.platform_schema_revoke_operation(
  p_installation_id text, p_plan_digest text, p_operation_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.platform_schema_approvals SET revoked_at = clock_timestamp()
   WHERE installation_id = p_installation_id AND plan_digest = p_plan_digest
     AND operation_id = p_operation_id AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval missing or already revoked' USING ERRCODE = '42501';
  END IF;
END $$;

-- The operator has READ ONLY table ACLs. A vetted definer holds the approval
-- row lock; PostgreSQL SELECT ... FOR SHARE otherwise requires UPDATE privilege.
CREATE FUNCTION public.platform_schema_lock_approval(
  p_installation_id text, p_plan_digest text, p_operation_id text)
RETURNS TABLE (
  operation_id text, approver text, approver_login text,
  approver_principal_id text, approved_application_id text,
  operator_role text, environment text, approved_at timestamptz,
  expires_at timestamptz, revoked_at timestamptz, server_now timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_schema_registry r
     WHERE r.installation_id = p_installation_id
       AND r.operator_role = session_user
       AND r.environment IN ('test','development')
  ) THEN
    RAISE EXCEPTION 'unauthorized schema approval locking actor' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT a.operation_id, a.approver, a.approver_login,
       a.approver_principal_id, a.approved_application_id,
       a.operator_role, a.environment, a.approved_at,
       a.expires_at, a.revoked_at, clock_timestamp()
    FROM public.platform_schema_approvals a
   WHERE a.installation_id = p_installation_id AND a.plan_digest = p_plan_digest
     AND a.operation_id = p_operation_id FOR SHARE OF a;
END $;

-- SECURITY DEFINER functions have default PUBLIC EXECUTE unless explicitly revoked.
REVOKE ALL ON FUNCTION public.platform_schema_lock_approval(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_schema_submit_plan(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_schema_approve_operation(text,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_schema_revoke_operation(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_schema_plan_provenance_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_schema_approval_provenance_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.platform_schema_revocation_audit_guard() FROM PUBLIC;
REVOKE ALL ON public.platform_schema_trusted_actors FROM PUBLIC;
REVOKE ALL ON public.platform_schema_revocation_audit FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.platform_schema_plans FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.platform_schema_approvals FROM PUBLIC;
-- No actor grants in migration: independently provisioner-approved GRANT EXECUTE only.
-- Table owners, superusers and insecurely shared login credentials remain privileged risks.
