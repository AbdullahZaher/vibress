-- Disposable legacy admission observation V1. No migration or serving grant.
-- Install transactionally by the lab root; grant EXECUTE only to that lab's
-- runtime principal, never SELECT on protected metadata.
DO $scope$ BEGIN
 IF current_database() !~ '^vibress_s03_[a-z0-9_]+$' OR current_setting('server_version_num')::int NOT BETWEEN 160000 AND 169999
 THEN RAISE EXCEPTION 'disposable PostgreSQL 16 only' USING ERRCODE='42501'; END IF;
END $scope$;
CREATE FUNCTION public.s03_p06_admission_observation_v1()
RETURNS TABLE(version integer,application_id text,installation_id text,epoch_id text,database_name text,database_oid text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
 SELECT 1,r.application_id,r.installation_id,e.epoch_id::text,current_database()::text,d.oid::text
 FROM public.platform_schema_registry r
 JOIN public.platform_installations i ON i.id=r.installation_id AND i.application_id=r.application_id AND i.environment=r.environment
 JOIN public.s03_p06_recovery_epochs e ON e.installation_id=r.installation_id
 JOIN pg_catalog.pg_database d ON d.datname=current_database()
 WHERE r.database_name=current_database() AND r.runtime_role=session_user
 AND r.environment IN ('test','development')
 AND (SELECT count(*) FROM public.platform_schema_registry)=1
 AND (SELECT count(*) FROM public.platform_installations)=1
 AND (SELECT count(*) FROM public.s03_p06_recovery_epochs)=1
$body$;
REVOKE ALL ON FUNCTION public.s03_p06_admission_observation_v1() FROM PUBLIC;
