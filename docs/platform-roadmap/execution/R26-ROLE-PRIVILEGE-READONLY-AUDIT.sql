-- Agent 02 R26 read-only PostgreSQL 16 privilege, RLS and ownership census.
-- Date: 2026-11-16. PREPARED BUT NOT EXECUTED. Do not run via any
-- production privileged write connection; use approved read-only audit identity.
-- Example: psql -X -v ON_ERROR_STOP=1 "$AUDIT_DATABASE_URL" -f path/to/file
-- IMPORTANT: inspect output for sensitive role names; no passwords are queried.
BEGIN TRANSACTION READ ONLY;
SELECT current_database() AS database_name, current_user AS auditor,
       session_user, version() AS server_version,
       current_setting('server_version_num')::int AS server_version_num,
       (current_setting('server_version_num')::int BETWEEN 160016 AND 169999)
         AS patched_postgresql_16_line;
-- 1. Role attributes; all non-system roles, including real service identities.
SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
       rolreplication, rolinherit
  FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname;
-- 2. Direct memberships and options (PG16): SET/INHERIT/ADMIN can differ.
SELECT member.rolname AS member, parent.rolname AS granted_role,
       am.inherit_option, am.set_option, am.admin_option
  FROM pg_auth_members am JOIN pg_roles member ON member.oid = am.member
       JOIN pg_roles parent ON parent.oid = am.roleid
 WHERE member.rolname !~ '^pg_' ORDER BY 1,2;
-- 3. Schema/database CREATE, CONNECT and owner authority (effective, includes
-- PUBLIC and inheritance; explain source through explicit ACL/memberships).
SELECT r.rolname, d.datname,
       has_database_privilege(r.oid,d.oid,'CONNECT') AS can_connect,
       has_database_privilege(r.oid,d.oid,'CREATE') AS can_create,
       pg_get_userbyid(d.datdba) AS database_owner
  FROM pg_roles r CROSS JOIN pg_database d
 WHERE r.rolname !~ '^pg_' AND d.datname=current_database() ORDER BY 1;
SELECT r.rolname, n.nspname, pg_get_userbyid(n.nspowner) AS schema_owner,
       has_schema_privilege(r.oid,n.oid,'USAGE') AS can_use,
       has_schema_privilege(r.oid,n.oid,'CREATE') AS can_create
  FROM pg_roles r CROSS JOIN pg_namespace n
 WHERE r.rolname !~ '^pg_'
   AND n.nspname NOT IN ('pg_catalog','information_schema')
   AND n.nspname NOT LIKE 'pg_toast%'
 ORDER BY 1,2;
-- 4. Every non-system routine: signature, ownership, SECURITY DEFINER,
-- search_path, extension status, stored ACL and effective PUBLIC EXECUTE.
SELECT n.nspname, p.oid::regprocedure AS signature,
       pg_get_userbyid(p.proowner) AS owner, p.prokind, p.prosecdef,
       p.proconfig AS function_settings, p.proacl AS explicit_acl,
       EXISTS (SELECT 1 FROM pg_depend d
               WHERE d.classid='pg_proc'::regclass
                 AND d.objid=p.oid AND d.deptype='e') AS extension_owned,
       has_function_privilege('public',p.oid,'EXECUTE') AS public_execute
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema')
   AND n.nspname NOT LIKE 'pg_toast%'
 ORDER BY 1,2;
-- 5. Direct/default function ACL entries; grantee OID 0 means PUBLIC.
SELECT n.nspname, p.oid::regprocedure AS signature,
       CASE WHEN a.grantee=0 THEN 'PUBLIC'
            ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type, a.is_grantable,
       pg_get_userbyid(a.grantor) AS grantor
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       CROSS JOIN LATERAL aclexplode(
         COALESCE(p.proacl,acldefault('f',p.proowner))) a
 WHERE n.nspname NOT IN ('pg_catalog','information_schema')
   AND n.nspname NOT LIKE 'pg_toast%'
 ORDER BY 1,2,3,4;
-- 6. Effective EXECUTE across all non-system routines and roles, including
-- grants inherited from other roles and PUBLIC. Look for unexpected TRUE.
SELECT r.rolname AS evaluated_role, p.oid::regprocedure AS signature,
       has_function_privilege(r.oid,p.oid,'EXECUTE') AS can_execute,
       p.prosecdef AS security_definer
  FROM pg_roles r CROSS JOIN pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE r.rolname !~ '^pg_'
   AND n.nspname NOT IN ('pg_catalog','information_schema')
   AND n.nspname NOT LIKE 'pg_toast%'
 ORDER BY 1,2;
-- 7. Global vs per-schema default ACL: GLOBAL function row uses namespace 0.
SELECT pg_get_userbyid(d.defaclrole) AS creating_role, d.defaclobjtype,
       CASE WHEN d.defaclnamespace=0 THEN '<GLOBAL>'
            ELSE d.defaclnamespace::regnamespace::text END AS scope,
       d.defaclnamespace, d.defaclacl AS acl
  FROM pg_default_acl d ORDER BY 1,2,3;
-- 8. RLS/policies on ALL non-system relations, including CMS coverage.
SELECT n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls,
       c.reloptions
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema')
   AND n.nspname NOT LIKE 'pg_toast%'
   AND c.relkind IN ('r','p','v','m','f')
 ORDER BY 1,2;
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  FROM pg_policies WHERE schemaname NOT IN ('pg_catalog','information_schema')
 ORDER BY schemaname,tablename,policyname;
-- 9. Abridged high-risk relation effective grant matrix (actual services).
SELECT r.rolname AS evaluated_role, n.nspname, c.relname,
       has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,
       has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
       has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,
       has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete,
       has_table_privilege(r.oid,c.oid,'TRUNCATE') AS can_truncate,
       has_table_privilege(r.oid,c.oid,'REFERENCES') AS can_reference,
       has_table_privilege(r.oid,c.oid,'TRIGGER') AS can_trigger
  FROM pg_roles r CROSS JOIN pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE r.rolname !~ '^pg_'
   AND n.nspname NOT IN ('pg_catalog','information_schema')
   AND n.nspname NOT LIKE 'pg_toast%'
   AND c.relkind IN ('r','p','v','m','f')
 ORDER BY 1,2,3;
-- 10. Extension versions; do not auto-update during read-only audit.
SELECT extname, extversion, pg_get_userbyid(extowner) AS owner
  FROM pg_extension ORDER BY extname;
COMMIT;
