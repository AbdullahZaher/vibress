-- P06 additive AUTHORIZATION ID experiment, NOT a production migration.
-- Requires disposable PG16 0059/0060 + E2 fixture. No legacy authorization is upgraded.
DO $scope$
BEGIN
  IF current_database() !~ '^vibress_s03_[a-z0-9_]+$'
     OR current_setting('server_version_num')::int NOT BETWEEN 160000 AND 169999 THEN
    RAISE EXCEPTION 'disposable PostgreSQL 16 only' USING ERRCODE='42501';
  END IF;
END $scope$;

CREATE TABLE public.s03_p06_submissions (
  submission_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  operation_id uuid NOT NULL UNIQUE DEFAULT pg_catalog.gen_random_uuid(),
  installation_id text NOT NULL,
  canonical_plan_digest text NOT NULL CHECK (canonical_plan_digest ~ '^[0-9a-f]{64}$'),
  author_login text NOT NULL,
  author_principal text NOT NULL,
  author_instance uuid NOT NULL,
  author_generation bigint NOT NULL CHECK (author_generation > 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  FOREIGN KEY (installation_id, canonical_plan_digest)
    REFERENCES public.platform_schema_plans(installation_id, plan_digest)
);
CREATE TABLE public.s03_p06_approvals (
  approval_id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  submission_id uuid NOT NULL UNIQUE REFERENCES public.s03_p06_submissions(submission_id),
  approver_login text NOT NULL,
  approver_principal text NOT NULL,
  approver_instance uuid NOT NULL,
  approver_generation bigint NOT NULL CHECK (approver_generation > 0),
  approved_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > approved_at)
);
REVOKE ALL ON public.s03_p06_submissions, public.s03_p06_approvals FROM PUBLIC;

CREATE FUNCTION public.s03_p06_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
  RAISE EXCEPTION 'immutable experimental authorization' USING ERRCODE='42501';
END $body$;
CREATE TRIGGER s03_p06_submission_immutable BEFORE UPDATE OR DELETE
  ON public.s03_p06_submissions FOR EACH ROW EXECUTE FUNCTION public.s03_p06_immutable();
CREATE TRIGGER s03_p06_approval_immutable BEFORE UPDATE OR DELETE
  ON public.s03_p06_approvals FOR EACH ROW EXECUTE FUNCTION public.s03_p06_immutable();
REVOKE ALL ON FUNCTION public.s03_p06_immutable() FROM PUBLIC;

-- Fixture owner is a trust root; separate production owner/ACL assessment outstanding.
-- New submission references an immutable content record, not its old authorization.
-- Does NOT grant DDL or integrate the original operator/journal with the new identity.
CREATE FUNCTION public.s03_p06_submit(p_installation text, p_digest text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE a record; result uuid;
BEGIN
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

CREATE FUNCTION public.s03_p06_approve(p_submission uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE s record; a record; k text; result uuid;
BEGIN
  -- Serialize competing approval identities for the same immutable submission.
  SELECT * INTO s FROM public.s03_p06_submissions WHERE submission_id=p_submission FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission unavailable' USING ERRCODE='42501'; END IF;
  FOR k IN SELECT v FROM pg_catalog.unnest(ARRAY[s.author_login, session_user::text]) AS x(v)
    ORDER BY v COLLATE "C"
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

-- Read-only diagnostic: not an authoritative final pre-DDL authorization check.
CREATE FUNCTION public.s03_p06_is_current(p_operation uuid,p_approval uuid)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $body$
  SELECT EXISTS (SELECT 1 FROM public.s03_p06_submissions s
    JOIN public.s03_p06_approvals p USING (submission_id)
    JOIN public.platform_schema_trusted_actors a ON a.login_name=s.author_login
    JOIN public.platform_schema_trusted_actors b ON b.login_name=p.approver_login
    WHERE s.operation_id=p_operation AND p.approval_id=p_approval
      AND a.active AND b.active AND a.actor_kind='AUTHOR' AND b.actor_kind='APPROVER'
      AND a.principal_id=s.author_principal AND b.principal_id=p.approver_principal
      AND a.actor_instance_id=s.author_instance AND a.actor_generation=s.author_generation
      AND b.actor_instance_id=p.approver_instance AND b.actor_generation=p.approver_generation
      AND p.expires_at>pg_catalog.clock_timestamp())
$body$;
REVOKE ALL ON FUNCTION public.s03_p06_submit(text,text), public.s03_p06_approve(uuid),
  public.s03_p06_is_current(uuid,uuid) FROM PUBLIC;
