-- DISPOSABLE PG16 prototype. Actor-only lifecycle path, not global L1.
-- Requires the unchanged 0059/0060 and R1/E2 fixtures.
DO $scope$
BEGIN
  IF current_database() !~ '^vibress_s03_[a-z0-9_]+$'
     OR current_setting('server_version_num')::int NOT BETWEEN 160000 AND 169999 THEN
    RAISE EXCEPTION 'disposable PostgreSQL 16 only' USING ERRCODE='42501';
  END IF;
END $scope$;

CREATE TABLE public.s03_p06_admin_capability (
  installation_id text NOT NULL REFERENCES public.platform_schema_registry(installation_id),
  delegate_login text NOT NULL,
  PRIMARY KEY (installation_id, delegate_login)
);
CREATE TABLE public.s03_p06_lifecycle_audit (
  event_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  actor_instance uuid NOT NULL,
  old_generation bigint NOT NULL,
  new_generation bigint NOT NULL CHECK (new_generation > old_generation),
  old_active boolean NOT NULL,
  new_active boolean NOT NULL,
  changed_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
REVOKE ALL ON public.s03_p06_admin_capability, public.s03_p06_lifecycle_audit FROM PUBLIC;

-- New fixture-only trigger replaces the 0060 attachment, not the historical file.
-- SECURITY INVOKER sees the actual executing role. Ordinary delegate cannot SET
-- ROLE the dedicated NOLOGIN gateway owner or mutate the roster directly.
CREATE FUNCTION public.s03_p06_actor_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE roster_owner text; gateway_owner text; root boolean; acceptable boolean;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(c.relowner) INTO roster_owner FROM pg_catalog.pg_class c
    WHERE c.oid='public.platform_schema_trusted_actors'::pg_catalog.regclass;
  SELECT rolsuper INTO root FROM pg_catalog.pg_roles WHERE rolname=session_user;
  IF session_user IS DISTINCT FROM roster_owner AND NOT COALESCE(root,false) THEN
    SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO gateway_owner FROM pg_catalog.pg_proc p
      WHERE p.oid='public.s03_p06_set_actor_active(text,text,boolean)'::pg_catalog.regprocedure;
    IF current_user IS DISTINCT FROM gateway_owner OR TG_OP <> 'UPDATE'
      THEN RAISE EXCEPTION 'actor mutation requires governed gateway' USING ERRCODE='42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.s03_p06_admin_capability c
        JOIN public.platform_schema_registry r USING (installation_id)
        WHERE c.delegate_login=session_user AND r.database_name=current_database()
        AND r.environment IN ('test','development'))
      THEN RAISE EXCEPTION 'actor mutation capability denied' USING ERRCODE='42501'; END IF;
    IF (pg_catalog.to_jsonb(NEW) - 'active') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - 'active')
      THEN RAISE EXCEPTION 'gateway permits active transition only' USING ERRCODE='42501'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT (rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication))
    INTO acceptable FROM pg_catalog.pg_roles WHERE rolname=NEW.login_name;
  IF NOT COALESCE(acceptable,false)
    THEN RAISE EXCEPTION 'individual nonprivileged login required' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $body$;

CREATE FUNCTION public.s03_p06_set_actor_active(p_installation text,p_actor text,p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE affected bigint;
BEGIN
  IF p_active IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.s03_p06_admin_capability c
      JOIN public.platform_schema_registry r USING (installation_id)
    WHERE c.installation_id=p_installation AND c.delegate_login=session_user
      AND r.database_name=current_database() AND r.environment IN ('test','development')
      AND (SELECT count(*) FROM public.platform_schema_registry)=1)
    THEN RAISE EXCEPTION 'actor mutation capability denied' USING ERRCODE='42501'; END IF;
  -- Actor-only writers take X BEFORE tuple lock. They never take A, R or I
  -- afterward, preserving P05 deactivation during a target-table wait.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('vibress_m03s03_actor'),
    pg_catalog.hashtext(p_actor));
  UPDATE public.platform_schema_trusted_actors SET active=p_active
    WHERE login_name=p_actor AND active IS DISTINCT FROM p_active;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'actor transition unavailable' USING ERRCODE='42501'; END IF;
END $body$;

CREATE FUNCTION public.s03_p06_write_lifecycle_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
  IF OLD.active IS DISTINCT FROM NEW.active THEN
    INSERT INTO public.s03_p06_lifecycle_audit
      (actor_instance,old_generation,new_generation,old_active,new_active,changed_by)
    VALUES(NEW.actor_instance_id,OLD.actor_generation,NEW.actor_generation,OLD.active,NEW.active,session_user);
  END IF;
  RETURN NEW;
END $body$;
CREATE TRIGGER s03_p06_lifecycle_audit_write AFTER UPDATE ON public.platform_schema_trusted_actors
  FOR EACH ROW EXECUTE FUNCTION public.s03_p06_write_lifecycle_audit();
DROP TRIGGER platform_schema_trusted_actor_provisioning ON public.platform_schema_trusted_actors;
CREATE TRIGGER platform_schema_trusted_actor_provisioning
  BEFORE INSERT OR UPDATE OR DELETE ON public.platform_schema_trusted_actors
  FOR EACH ROW EXECUTE FUNCTION public.s03_p06_actor_write_guard();
REVOKE ALL ON FUNCTION public.s03_p06_actor_write_guard(),
  public.s03_p06_set_actor_active(text,text,boolean), public.s03_p06_write_lifecycle_audit() FROM PUBLIC;
-- Dedicated owner/grants provisioned only in owned disposable test database.
-- Unchanged combined approval/revocation paths, root bypass and full lifecycle
-- (register, delete, rename, role change) remain outside this narrow proof.
