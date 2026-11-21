-- M03-S03 E2-A TEST FIXTURE ONLY. NOT a numbered migration or approved policy.
-- Installed only after unchanged 0059/0060 in disposable localhost PostgreSQL 16.
-- No runtime/operator actor UPDATE/DELETE/INSERT grants, no production deployment.
ALTER TABLE public.platform_schema_trusted_actors
  ADD COLUMN actor_instance_id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  ADD COLUMN actor_generation bigint NOT NULL DEFAULT 1 CHECK (actor_generation > 0);
ALTER TABLE public.platform_schema_plans
  ADD COLUMN author_actor_instance_id uuid,
  ADD COLUMN author_actor_generation bigint;
ALTER TABLE public.platform_schema_approvals
  ADD COLUMN author_actor_instance_id uuid,
  ADD COLUMN author_actor_generation bigint,
  ADD COLUMN approver_actor_instance_id uuid,
  ADD COLUMN approver_actor_generation bigint;

CREATE FUNCTION public.s03_e2_actor_lifecycle_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $e2$
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.actor_generation <> 1 OR NEW.actor_instance_id IS NULL THEN
      RAISE EXCEPTION 'invalid new actor generation' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.actor_instance_id IS DISTINCT FROM OLD.actor_instance_id
     OR NEW.actor_generation IS DISTINCT FROM OLD.actor_generation THEN
    RAISE EXCEPTION 'actor generation or identity may not be directly rewritten'
      USING ERRCODE='42501';
  END IF;
  IF (NEW.active, NEW.actor_kind, NEW.login_name, NEW.principal_id)
       IS DISTINCT FROM
     (OLD.active, OLD.actor_kind, OLD.login_name, OLD.principal_id) THEN
    IF OLD.actor_generation = 9223372036854775807 THEN
      RAISE EXCEPTION 'actor generation exhausted' USING ERRCODE='42501';
    END IF;
    NEW.actor_generation := OLD.actor_generation + 1;
  END IF;
  RETURN NEW;
END $e2$;

CREATE TRIGGER zz_s03_e2_actor_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON public.platform_schema_trusted_actors
FOR EACH ROW EXECUTE FUNCTION public.s03_e2_actor_lifecycle_guard();

-- Preserve actor instance UUIDs across deletion/re-registration. This ledger is
-- owner-only and append-only; the PK denies accidental reuse even after DELETE.
CREATE TABLE public.s03_e2_actor_instance_history (
  actor_instance_id uuid PRIMARY KEY,
  login_name text NOT NULL,
  principal_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
-- Existing actors receive a newly assigned identity at this migration boundary.
-- Reserve those UUIDs before installing the INSERT trigger. Never backfill old
-- plan or approval provenance with the current identity or generation.
INSERT INTO public.s03_e2_actor_instance_history
  (actor_instance_id,login_name,principal_id)
SELECT actor_instance_id,login_name,principal_id
FROM public.platform_schema_trusted_actors;

CREATE FUNCTION public.s03_e2_record_actor_instance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $e2$
BEGIN
  INSERT INTO public.s03_e2_actor_instance_history
    (actor_instance_id,login_name,principal_id)
  VALUES (NEW.actor_instance_id,NEW.login_name,NEW.principal_id);
  RETURN NEW;
END $e2$;
CREATE TRIGGER zz_s03_e2_record_instance
AFTER INSERT ON public.platform_schema_trusted_actors
FOR EACH ROW EXECUTE FUNCTION public.s03_e2_record_actor_instance();

CREATE FUNCTION public.s03_e2_identity_history_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $e2$
BEGIN
  RAISE EXCEPTION 'actor instance identity history is append-only' USING ERRCODE='42501';
END $e2$;
CREATE TRIGGER s03_e2_identity_history_immutable
BEFORE UPDATE OR DELETE ON public.s03_e2_actor_instance_history
FOR EACH ROW EXECUTE FUNCTION public.s03_e2_identity_history_immutability();
REVOKE ALL ON public.s03_e2_actor_instance_history FROM PUBLIC;
REVOKE ALL ON FUNCTION public.s03_e2_record_actor_instance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.s03_e2_identity_history_immutability() FROM PUBLIC;

-- Trigger names ensure existing 0060 provenance executes before E2 capture.
CREATE FUNCTION public.s03_e2_bind_plan_author()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $e2$
DECLARE actor record;
BEGIN
  IF NEW.author_actor_instance_id IS NOT NULL
      OR NEW.author_actor_generation IS NOT NULL THEN
    RAISE EXCEPTION 'forged E2 author provenance' USING ERRCODE='42501';
  END IF;
  SELECT actor_instance_id, actor_generation, active, principal_id, actor_kind
    INTO actor FROM public.platform_schema_trusted_actors
    WHERE login_name = NEW.author_login;
  IF NOT FOUND OR NOT actor.active OR actor.actor_kind <> 'AUTHOR'
      OR actor.principal_id IS DISTINCT FROM NEW.author_principal_id THEN
    RAISE EXCEPTION 'author E2 provenance invalid' USING ERRCODE='42501';
  END IF;
  NEW.author_actor_instance_id := actor.actor_instance_id;
  NEW.author_actor_generation := actor.actor_generation;
  RETURN NEW;
END $e2$;

CREATE TRIGGER zz_s03_e2_plan_bind
BEFORE INSERT ON public.platform_schema_plans
FOR EACH ROW EXECUTE FUNCTION public.s03_e2_bind_plan_author();

CREATE FUNCTION public.s03_e2_bind_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $e2$
DECLARE author record; approver record;
BEGIN
  IF NEW.author_actor_instance_id IS NOT NULL OR NEW.author_actor_generation IS NOT NULL
      OR NEW.approver_actor_instance_id IS NOT NULL OR NEW.approver_actor_generation IS NOT NULL THEN
    RAISE EXCEPTION 'forged E2 approval provenance' USING ERRCODE='42501';
  END IF;
  SELECT p.author_login, p.author_principal_id,
         p.author_actor_instance_id, p.author_actor_generation
    INTO author FROM public.platform_schema_plans p
    WHERE p.installation_id=NEW.installation_id AND p.plan_digest=NEW.plan_digest;
  IF NOT FOUND OR author.author_actor_instance_id IS NULL
      OR author.author_actor_generation IS NULL THEN
    RAISE EXCEPTION 'unattested E2 author plan' USING ERRCODE='42501';
  END IF;
  -- An old plan cannot receive a new approval after a committed author lifecycle change.
  PERFORM 1 FROM public.platform_schema_trusted_actors a
   WHERE a.login_name=author.author_login AND a.actor_kind='AUTHOR'
     AND a.active AND a.principal_id=author.author_principal_id
     AND a.actor_instance_id=author.author_actor_instance_id
     AND a.actor_generation=author.author_actor_generation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale author generation requires fresh plan' USING ERRCODE='42501';
  END IF;
  SELECT actor_instance_id, actor_generation, active, principal_id, actor_kind
    INTO approver FROM public.platform_schema_trusted_actors
    WHERE login_name=NEW.approver_login;
  IF NOT FOUND OR NOT approver.active OR approver.actor_kind <> 'APPROVER'
      OR approver.principal_id IS DISTINCT FROM NEW.approver_principal_id THEN
    RAISE EXCEPTION 'approver E2 provenance invalid' USING ERRCODE='42501';
  END IF;
  NEW.author_actor_instance_id := author.author_actor_instance_id;
  NEW.author_actor_generation := author.author_actor_generation;
  NEW.approver_actor_instance_id := approver.actor_instance_id;
  NEW.approver_actor_generation := approver.actor_generation;
  RETURN NEW;
END $e2$;

CREATE TRIGGER zz_s03_e2_approval_bind
BEFORE INSERT ON public.platform_schema_approvals
FOR EACH ROW EXECUTE FUNCTION public.s03_e2_bind_approval();

REVOKE ALL ON FUNCTION public.s03_e2_actor_lifecycle_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.s03_e2_bind_plan_author() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.s03_e2_bind_approval() FROM PUBLIC;

COMMENT ON COLUMN public.platform_schema_trusted_actors.actor_generation IS
  'EXPERIMENT ONLY: transactionally monotonic under E2 lifecycle trigger';

-- L1 test-only governed combined lifecycle transaction. SECURITY INVOKER;
-- callable only by the fixture DB table owner, never the runtime/operator.
-- Acquires all advisory and registry locks before any actor/approval row DML.
-- Existing migration 0060 remains unchanged and its guards still execute.
CREATE FUNCTION public.s03_test_governed_deactivate_and_revoke(
  p_installation text, p_digest text, p_operation text, p_actor text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,pg_temp AS $l1$
DECLARE owner_name text; affected bigint;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO owner_name
    FROM pg_catalog.pg_class c
    WHERE c.oid='public.platform_schema_trusted_actors'::pg_catalog.regclass;
  IF session_user IS DISTINCT FROM owner_name OR current_user IS DISTINCT FROM session_user THEN
    RAISE EXCEPTION 'governed lifecycle test owner required' USING ERRCODE='42501';
  END IF;
  -- Lock hierarchy: installation I -> registry R -> approval tuple R_approval
  -- -> approval advisory A -> actor X -> implicit actor UPDATE. The explicit
  -- R_approval lock mirrors the 0060 revocation trigger's implicit order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('vibress_m03s03'),pg_catalog.hashtext(p_installation));
  PERFORM 1 FROM public.platform_schema_registry
    WHERE installation_id=p_installation FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing installation' USING ERRCODE='42501'; END IF;
  -- Existing migration 0060 approval UPDATE acquires its tuple lock BEFORE
  -- its BEFORE trigger requests approval advisory A. Pre-lock this same tuple
  -- before A so mixed governed/direct revokers cannot invert R_approval/A.
  -- The dedicated operator never locks approval rows FOR UPDATE.
  PERFORM 1 FROM public.platform_schema_approvals
    WHERE installation_id=p_installation AND plan_digest=p_digest
      AND operation_id=p_operation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing approval row' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('vibress_m03s03_approval'),
    pg_catalog.hashtext(p_installation || ':' || p_digest || ':' || p_operation));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('vibress_m03s03_actor'),pg_catalog.hashtext(p_actor));
  UPDATE public.platform_schema_trusted_actors SET active=false
    WHERE login_name=p_actor AND active=true;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'actor missing or disabled' USING ERRCODE='42501'; END IF;
  UPDATE public.platform_schema_approvals SET revoked_at=pg_catalog.clock_timestamp()
    WHERE installation_id=p_installation AND plan_digest=p_digest
      AND operation_id=p_operation AND revoked_at IS NULL;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'approval missing/revoked' USING ERRCODE='42501'; END IF;
END $l1$;

REVOKE ALL ON FUNCTION public.s03_test_governed_deactivate_and_revoke(text,text,text,text) FROM PUBLIC;
