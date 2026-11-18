-- Disposable P06 integrated extension, not a numbered migration. Apply transactionally after E2/P06 fixtures.
DO $scope$ BEGIN
 IF current_database() !~ '^vibress_s03_[a-z0-9_]+$' OR current_setting('server_version_num')::int NOT BETWEEN 160000 AND 169999
 THEN RAISE EXCEPTION 'disposable PostgreSQL 16 only' USING ERRCODE='42501'; END IF;
END $scope$;
-- Independent epoch is provisioned by the lab recovery authority, never
-- auto-generated from the database being restored. The existing new P06
-- submission table is empty at this additive fixture boundary.
CREATE TABLE public.s03_p06_recovery_epochs (
 installation_id text PRIMARY KEY REFERENCES public.platform_schema_registry(installation_id),
 epoch_id uuid NOT NULL UNIQUE
);
CREATE TABLE public.s03_p06_actor_enrollments (
 actor_instance_id uuid PRIMARY KEY REFERENCES public.s03_e2_actor_instance_history(actor_instance_id),
 epoch_id uuid NOT NULL,
 role_oid oid NOT NULL
);
ALTER TABLE public.s03_p06_submissions ADD COLUMN recovery_epoch uuid NOT NULL;
REVOKE ALL ON public.s03_p06_recovery_epochs, public.s03_p06_actor_enrollments FROM PUBLIC;
CREATE FUNCTION public.s03_p06_record_epoch_enrollment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE epoch uuid;
BEGIN
 SELECT epoch_id INTO epoch FROM public.s03_p06_recovery_epochs
 WHERE (SELECT count(*) FROM public.s03_p06_recovery_epochs)=1;
 IF epoch IS NULL THEN RAISE EXCEPTION 'recovery enrollment unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO public.s03_p06_actor_enrollments(actor_instance_id,epoch_id,role_oid)
 SELECT NEW.actor_instance_id,epoch,oid FROM pg_catalog.pg_roles WHERE rolname=NEW.login_name;
 IF NOT FOUND THEN RAISE EXCEPTION 'enrollment role unavailable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER zzz_s03_p06_epoch_enroll AFTER INSERT ON public.platform_schema_trusted_actors
 FOR EACH ROW EXECUTE FUNCTION public.s03_p06_record_epoch_enrollment();
REVOKE ALL ON FUNCTION public.s03_p06_record_epoch_enrollment() FROM PUBLIC;
ALTER TABLE public.s03_p06_submissions ADD UNIQUE(installation_id,operation_id,submission_id,canonical_plan_digest);
ALTER TABLE public.s03_p06_approvals ADD UNIQUE(approval_id,submission_id);
CREATE TABLE public.s03_p06_revocations (
 approval_id uuid PRIMARY KEY REFERENCES public.s03_p06_approvals(approval_id),
 revoked_by text NOT NULL, revoked_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE TABLE public.s03_p06_completed_operations (
 installation_id text NOT NULL, operation_id uuid PRIMARY KEY, submission_id uuid NOT NULL UNIQUE,
 approval_id uuid NOT NULL UNIQUE, canonical_plan_digest text NOT NULL,
 previous_digest text NOT NULL CHECK(previous_digest ~ '^[0-9a-f]{64}$'),
 new_digest text NOT NULL CHECK(new_digest ~ '^[0-9a-f]{64}$'), operator_role text NOT NULL,
 final_authorized_at timestamptz NOT NULL, completed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 catalog_evidence jsonb NOT NULL, CHECK(completed_at >= final_authorized_at),
 FOREIGN KEY(installation_id,operation_id,submission_id,canonical_plan_digest)
 REFERENCES public.s03_p06_submissions(installation_id,operation_id,submission_id,canonical_plan_digest),
 FOREIGN KEY(approval_id,submission_id) REFERENCES public.s03_p06_approvals(approval_id,submission_id)
);
CREATE TRIGGER s03_p06_completed_immutable BEFORE UPDATE OR DELETE ON public.s03_p06_completed_operations
 FOR EACH ROW EXECUTE FUNCTION public.s03_p06_immutable();
CREATE TRIGGER s03_p06_revocation_immutable BEFORE UPDATE OR DELETE ON public.s03_p06_revocations
 FOR EACH ROW EXECUTE FUNCTION public.s03_p06_immutable();
REVOKE ALL ON public.s03_p06_completed_operations,public.s03_p06_revocations FROM PUBLIC;
-- Transaction reservation aborts repeated governed identity/revocation calls. Retention and legacy writers remain open.
CREATE TABLE public.s03_p06_call_guard(transaction_id xid8 PRIMARY KEY);
REVOKE ALL ON public.s03_p06_call_guard FROM PUBLIC;
CREATE FUNCTION public.s03_p06_enter() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
 INSERT INTO public.s03_p06_call_guard VALUES(pg_catalog.pg_current_xact_id());
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'one governed call per transaction' USING ERRCODE='42501';
END $body$;
REVOKE ALL ON FUNCTION public.s03_p06_enter() FROM PUBLIC;
CREATE FUNCTION public.s03_p06_revoke(p_approval uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
 PERFORM public.s03_p06_enter();
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('vibress_m03s03_p06_approval'),pg_catalog.hashtext(p_approval::text));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('vibress_m03s03_actor'),pg_catalog.hashtext(session_user::text));
 IF NOT EXISTS(SELECT 1 FROM public.s03_p06_approvals a JOIN public.s03_p06_submissions s USING(submission_id)
 JOIN public.platform_schema_registry r USING(installation_id) JOIN public.platform_schema_trusted_actors v ON v.login_name=a.approver_login
 WHERE a.approval_id=p_approval AND a.approver_login=session_user AND v.active AND v.actor_kind='APPROVER'
 AND v.principal_id=a.approver_principal AND v.actor_instance_id=a.approver_instance AND v.actor_generation=a.approver_generation
 AND r.database_name=current_database() AND r.environment IN ('test','development'))
 THEN RAISE EXCEPTION 'revocation authority unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO public.s03_p06_revocations(approval_id,revoked_by) VALUES(p_approval,session_user);
END $body$;
REVOKE ALL ON FUNCTION public.s03_p06_revoke(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.s03_p06_submit(p_installation text, p_digest text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE a record; result uuid; epoch uuid;
BEGIN
  PERFORM public.s03_p06_enter();
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('vibress_m03s03_actor'),pg_catalog.hashtext(session_user::text));
  SELECT epoch_id INTO epoch FROM public.s03_p06_recovery_epochs WHERE installation_id=p_installation;
  SELECT t.* INTO a FROM public.platform_schema_trusted_actors t
    JOIN public.s03_p06_actor_enrollments e USING(actor_instance_id)
    JOIN pg_catalog.pg_roles pr ON pr.oid=e.role_oid AND pr.rolname=t.login_name
    WHERE t.login_name=session_user AND t.actor_kind='AUTHOR' AND t.active AND e.epoch_id=epoch
      AND pr.rolcanlogin AND NOT (pr.rolsuper OR pr.rolbypassrls OR pr.rolcreatedb OR pr.rolcreaterole OR pr.rolreplication);
  IF NOT FOUND THEN RAISE EXCEPTION 'ineligible author' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_schema_plans p
    JOIN public.platform_schema_registry r USING (installation_id)
    WHERE p.installation_id=p_installation AND p.plan_digest=p_digest
    AND p.author_login=session_user AND p.author_principal_id=a.principal_id
    AND r.database_name=current_database() AND r.environment IN ('test','development'))
  THEN RAISE EXCEPTION 'content scope unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO public.s03_p06_submissions
    (installation_id,canonical_plan_digest,author_login,author_principal,author_instance,author_generation,recovery_epoch)
  VALUES (p_installation,p_digest,session_user,a.principal_id,a.actor_instance_id,a.actor_generation,epoch)
  RETURNING submission_id INTO result;
  RETURN result;
END $body$;

CREATE OR REPLACE FUNCTION public.s03_p06_approve(p_submission uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE s record; a record; k text; result uuid;
BEGIN
  PERFORM public.s03_p06_enter();
  -- Serialize creation without holding an UPDATE tuple lock needed by journal FKs.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('vibress_m03s03_p06_submission'),pg_catalog.hashtext(p_submission::text));
  SELECT * INTO s FROM public.s03_p06_submissions WHERE submission_id=p_submission;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission unavailable' USING ERRCODE='42501'; END IF;
  FOR k IN SELECT v FROM pg_catalog.unnest(ARRAY[s.author_login, session_user::text]) AS x(v)
    ORDER BY pg_catalog.hashtext(v),v COLLATE "C"
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('vibress_m03s03_actor'),pg_catalog.hashtext(k));
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.s03_p06_recovery_epochs
    WHERE installation_id=s.installation_id AND epoch_id=s.recovery_epoch)
  THEN RAISE EXCEPTION 'fresh recovery submission required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_schema_trusted_actors t JOIN public.s03_p06_actor_enrollments e USING(actor_instance_id)
    JOIN pg_catalog.pg_roles pr ON pr.oid=e.role_oid AND pr.rolname=t.login_name
    WHERE pr.rolcanlogin AND NOT (pr.rolsuper OR pr.rolbypassrls OR pr.rolcreatedb OR pr.rolcreaterole OR pr.rolreplication)
      AND t.login_name=s.author_login AND t.principal_id=s.author_principal AND t.actor_kind='AUTHOR'
      AND t.active AND t.actor_instance_id=s.author_instance AND t.actor_generation=s.author_generation AND e.epoch_id=s.recovery_epoch)
  THEN RAISE EXCEPTION 'fresh submission required' USING ERRCODE='42501'; END IF;
  SELECT t.* INTO a FROM public.platform_schema_trusted_actors t JOIN public.s03_p06_actor_enrollments e USING(actor_instance_id)
    JOIN pg_catalog.pg_roles pr ON pr.oid=e.role_oid AND pr.rolname=t.login_name
    WHERE t.login_name=session_user AND t.actor_kind='APPROVER' AND t.active AND e.epoch_id=s.recovery_epoch
      AND pr.rolcanlogin AND NOT (pr.rolsuper OR pr.rolbypassrls OR pr.rolcreatedb OR pr.rolcreaterole OR pr.rolreplication);
  IF NOT FOUND OR a.principal_id=s.author_principal OR session_user=s.author_login
  THEN RAISE EXCEPTION 'independent approver required' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.s03_p06_approvals WHERE submission_id=p_submission)
  THEN RAISE EXCEPTION 'fresh submission required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.s03_p06_approvals
    (submission_id,approver_login,approver_principal,approver_instance,approver_generation,expires_at)
  VALUES(p_submission,session_user,a.principal_id,a.actor_instance_id,a.actor_generation,
    pg_catalog.clock_timestamp()+interval '20 minutes') RETURNING approval_id INTO result;
  RETURN result;
END $body$;


-- Existing content-registration entrypoint is governed too; it does not grant
-- executable authorization. No old approval/revoke EXECUTE in integrated provisioning.
CREATE OR REPLACE FUNCTION public.platform_schema_submit_plan(
  p_installation_id text,p_plan_digest text,p_expected_manifest text,p_plan text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
  PERFORM public.s03_p06_enter();
  -- 0060's provenance trigger takes a registry SHARE lock. Acquire it
  -- before the actor fence, not after it; operator holds registry before X.
  PERFORM 1 FROM public.platform_schema_registry
    WHERE installation_id=p_installation_id AND database_name=current_database()
      AND environment IN ('test','development') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'content registration scope denied' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('vibress_m03s03_actor'),pg_catalog.hashtext(session_user::text));
  INSERT INTO public.platform_schema_plans(installation_id,plan_digest,expected_manifest,plan,author)
  VALUES(p_installation_id,p_plan_digest,p_expected_manifest,p_plan,session_user);
END $body$;

-- Integrated installer must apply the original actor gateway fixture first.
CREATE OR REPLACE FUNCTION public.s03_p06_set_actor_active(p_installation text,p_actor text,p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE affected bigint;
BEGIN
  PERFORM public.s03_p06_enter();
  -- Capability mutations and uses serialize before actor fences. No registry
  -- tuple lock here: P05 must remain able to deactivate during target waits.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('vibress_m03s03_p06_capability'),pg_catalog.hashtext(session_user::text));
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


-- Defense in depth for ordinary direct INSERT even if an accidental grant is
-- introduced. Current fixture table/function owner is an explicit trust root.
-- Each protected INSERT must arrive via its SECURITY DEFINER entrypoint.
CREATE FUNCTION public.s03_p06_protected_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE owner_name text;
BEGIN
 SELECT pg_catalog.pg_get_userbyid(relowner) INTO owner_name
   FROM pg_catalog.pg_class WHERE oid=TG_RELID;
 IF current_user IS DISTINCT FROM owner_name THEN
   RAISE EXCEPTION 'protected insert requires governed entrypoint' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER aa_s03_p06_plan_insert BEFORE INSERT ON public.platform_schema_plans
 FOR EACH ROW EXECUTE FUNCTION public.s03_p06_protected_insert();
CREATE TRIGGER aa_s03_p06_submission_insert BEFORE INSERT ON public.s03_p06_submissions
 FOR EACH ROW EXECUTE FUNCTION public.s03_p06_protected_insert();
CREATE TRIGGER aa_s03_p06_approval_insert BEFORE INSERT ON public.s03_p06_approvals
 FOR EACH ROW EXECUTE FUNCTION public.s03_p06_protected_insert();
CREATE TRIGGER aa_s03_p06_revocation_insert BEFORE INSERT ON public.s03_p06_revocations
 FOR EACH ROW EXECUTE FUNCTION public.s03_p06_protected_insert();
REVOKE ALL ON FUNCTION public.s03_p06_protected_insert() FROM PUBLIC;

-- Root-only maintenance, bounded per call. Never delete the current or any
-- potentially active xid. This is not a recovery-epoch guarantee across restore.
CREATE FUNCTION public.s03_p06_prune_call_guard() RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE removed bigint;
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user IS DISTINCT FROM
   (SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class
    WHERE oid='public.s03_p06_call_guard'::pg_catalog.regclass)
 THEN RAISE EXCEPTION 'guard maintenance requires trust root' USING ERRCODE='42501'; END IF;
 DELETE FROM public.s03_p06_call_guard WHERE transaction_id IN (
   SELECT transaction_id FROM public.s03_p06_call_guard
   WHERE transaction_id < pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot())
     AND transaction_id <> pg_catalog.pg_current_xact_id()
   ORDER BY transaction_id LIMIT 1000
 );
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END $body$;
REVOKE ALL ON FUNCTION public.s03_p06_prune_call_guard() FROM PUBLIC;

-- Root-only purpose-specific administrative paths. Root remains capable of
-- bypassing them; no ordinary caller gains roster or capability authority.
CREATE FUNCTION public.s03_p06_root_enter(p_installation text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
 IF current_user IS DISTINCT FROM session_user OR current_user IS DISTINCT FROM
   (SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class
    WHERE oid='public.platform_schema_trusted_actors'::pg_catalog.regclass)
 THEN RAISE EXCEPTION 'authenticated roster owner required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.platform_schema_registry WHERE installation_id=p_installation
    AND database_name=current_database() AND environment IN ('test','development')
    AND (SELECT count(*) FROM public.platform_schema_registry)=1)
 THEN RAISE EXCEPTION 'root scope unavailable' USING ERRCODE='42501'; END IF;
 PERFORM public.s03_p06_enter();
 -- Serialize root administrative writers with each other, BEFORE any DML.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('vibress_m03s03_p06_root'),0);
END $body$;
CREATE FUNCTION public.s03_p06_root_register(p_installation text,p_login text,p_principal text,p_kind text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE result uuid;
BEGIN
 PERFORM public.s03_p06_root_enter(p_installation);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('vibress_m03s03_actor'),pg_catalog.hashtext(p_login));
 INSERT INTO public.platform_schema_trusted_actors(login_name,principal_id,actor_kind)
 VALUES(p_login,p_principal,p_kind) RETURNING actor_instance_id INTO result;
 RETURN result;
END $body$;
CREATE FUNCTION public.s03_p06_root_retire(p_installation text,p_login text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
 PERFORM public.s03_p06_root_enter(p_installation);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('vibress_m03s03_actor'),pg_catalog.hashtext(p_login));
 DELETE FROM public.platform_schema_trusted_actors WHERE login_name=p_login;
 IF NOT FOUND THEN RAISE EXCEPTION 'actor unavailable' USING ERRCODE='42501'; END IF;
END $body$;
CREATE FUNCTION public.s03_p06_root_replace(p_installation text,p_login text,p_principal text,p_kind text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE result uuid;
BEGIN
 PERFORM public.s03_p06_root_enter(p_installation);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('vibress_m03s03_actor'),pg_catalog.hashtext(p_login));
 DELETE FROM public.platform_schema_trusted_actors WHERE login_name=p_login;
 IF NOT FOUND THEN RAISE EXCEPTION 'actor unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO public.platform_schema_trusted_actors(login_name,principal_id,actor_kind)
 VALUES(p_login,p_principal,p_kind) RETURNING actor_instance_id INTO result;
 RETURN result;
END $body$;
CREATE FUNCTION public.s03_p06_root_set_capability(p_installation text,p_delegate text,p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
 PERFORM public.s03_p06_root_enter(p_installation);
 IF p_enabled IS NULL THEN RAISE EXCEPTION 'capability state required' USING ERRCODE='42501'; END IF;
 -- FK on INSERT can acquire registry KEY SHARE. Establish registry first.
 PERFORM 1 FROM public.platform_schema_registry WHERE installation_id=p_installation FOR SHARE;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('vibress_m03s03_p06_capability'),pg_catalog.hashtext(p_delegate));
 IF p_enabled THEN
   IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=p_delegate AND rolcanlogin
      AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
   THEN RAISE EXCEPTION 'invalid delegate role' USING ERRCODE='42501'; END IF;
   INSERT INTO public.s03_p06_admin_capability VALUES(p_installation,p_delegate);
 ELSE
   DELETE FROM public.s03_p06_admin_capability WHERE installation_id=p_installation AND delegate_login=p_delegate;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'capability transition unavailable' USING ERRCODE='42501'; END IF;
END $body$;
REVOKE ALL ON FUNCTION public.s03_p06_root_enter(text),public.s03_p06_root_register(text,text,text,text),
 public.s03_p06_root_retire(text,text),public.s03_p06_root_replace(text,text,text,text),
 public.s03_p06_root_set_capability(text,text,boolean) FROM PUBLIC;
