-- Disposable P06 integrated extension, not a numbered migration. Apply transactionally after E2/P06 fixtures.
DO $scope$ BEGIN
 IF current_database() !~ '^vibress_s03_[a-z0-9_]+$' OR current_setting('server_version_num')::int NOT BETWEEN 160000 AND 169999
 THEN RAISE EXCEPTION 'disposable PostgreSQL 16 only' USING ERRCODE='42501'; END IF;
END $scope$;
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
DECLARE a record; result uuid;
BEGIN
  PERFORM public.s03_p06_enter();
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('vibress_m03s03_actor'),pg_catalog.hashtext(session_user::text));
  SELECT * INTO a FROM public.platform_schema_trusted_actors
    WHERE login_name=session_user AND actor_kind='AUTHOR' AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'ineligible author' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_schema_plans p
    JOIN public.platform_schema_registry r USING (installation_id)
    WHERE p.installation_id=p_installation AND p.plan_digest=p_digest
    AND p.author_login=session_user AND p.author_principal_id=a.principal_id
    AND r.database_name=current_database() AND r.environment IN ('test','development'))
  THEN RAISE EXCEPTION 'content scope unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO public.s03_p06_submissions
    (installation_id,canonical_plan_digest,author_login,author_principal,author_instance,author_generation)
  VALUES (p_installation,p_digest,session_user,a.principal_id,a.actor_instance_id,a.actor_generation)
  RETURNING submission_id INTO result;
  RETURN result;
END $body$;

CREATE OR REPLACE FUNCTION public.s03_p06_approve(p_submission uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE s record; a record; k text; result uuid;
BEGIN
  PERFORM public.s03_p06_enter();
  -- Serialize competing approval identities for the same immutable submission.
  SELECT * INTO s FROM public.s03_p06_submissions WHERE submission_id=p_submission FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission unavailable' USING ERRCODE='42501'; END IF;
  FOR k IN SELECT v FROM pg_catalog.unnest(ARRAY[s.author_login, session_user::text]) AS x(v)
    ORDER BY pg_catalog.hashtext(v),v COLLATE "C"
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('vibress_m03s03_actor'),pg_catalog.hashtext(k));
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.platform_schema_trusted_actors
    WHERE login_name=s.author_login AND principal_id=s.author_principal AND actor_kind='AUTHOR'
      AND active AND actor_instance_id=s.author_instance AND actor_generation=s.author_generation)
  THEN RAISE EXCEPTION 'fresh submission required' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM public.platform_schema_trusted_actors
    WHERE login_name=session_user AND actor_kind='APPROVER' AND active;
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

