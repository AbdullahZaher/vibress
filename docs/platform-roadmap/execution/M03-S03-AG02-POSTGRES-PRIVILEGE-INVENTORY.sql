-- AG06-S03-02 effective PostgreSQL authority INVENTORY (READ ONLY).
-- Run with a DBA-observed read-only session against the exact target deployment.
-- Parameters must be replaced by verified service role names, not user claims.
-- Does NOT grant, revoke, lock application tables or change settings.
BEGIN TRANSACTION READ ONLY;

-- 1. Enumerate all relevant SECURITY DEFINER routines, ownership,
-- extension ancestry, callable paths via PUBLIC, direct grants, INHERIT/SET.
SELECT n.nspname AS schema_name, p.oid::regprocedure AS signature,
       pg_get_userbyid(p.proowner) AS definer_owner,
       p.prosecdef AS security_definer, p.proconfig AS function_settings,
       e.extname AS extension_name,
       p.proacl,
       has_schema_privilege(:'runtime_role', n.oid, 'USAGE') AS runtime_schema_usage,
       has_function_privilege(:'runtime_role', p.oid, 'EXECUTE') AS runtime_execute,
       has_schema_privilege(:'operator_role', n.oid, 'USAGE') AS operator_schema_usage,
       has_function_privilege(:'operator_role', p.oid, 'EXECUTE') AS operator_execute
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN pg_catalog.pg_depend dep ON dep.classid = 'pg_proc'::regclass
       AND dep.objid = p.oid AND dep.deptype = 'e'
  LEFT JOIN pg_catalog.pg_extension e ON e.oid = dep.refobjid
 WHERE p.prosecdef
 ORDER BY n.nspname, p.oid::regprocedure::text;

-- 2. PostgreSQL 16 separates role membership, inherited USAGE and SET ROLE.
SELECT member.rolname AS session_role, other.rolname AS reachable_role,
       pg_has_role(member.oid, other.oid, 'MEMBER') AS member,
       pg_has_role(member.oid, other.oid, 'USAGE') AS inherit_effective,
       pg_has_role(member.oid, other.oid, 'SET') AS set_role_reachable,
       other.rolsuper, other.rolbypassrls, other.rolcreaterole
  FROM pg_catalog.pg_roles member
 CROSS JOIN pg_catalog.pg_roles other
 WHERE member.rolname IN (:'runtime_role', :'operator_role')
   AND member.oid <> other.oid
   AND pg_has_role(member.oid, other.oid, 'MEMBER')
 ORDER BY member.rolname, other.rolname;

-- 3. All owned/accessible non-system schemas, never public-only.
SELECT n.nspname, pg_get_userbyid(n.nspowner) AS owner,
       n.nspacl,
       has_schema_privilege(:'runtime_role', n.oid, 'USAGE') AS runtime_usage,
       has_schema_privilege(:'runtime_role', n.oid, 'CREATE') AS runtime_create,
       has_schema_privilege(:'operator_role', n.oid, 'CREATE') AS operator_create
  FROM pg_catalog.pg_namespace n
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 ORDER BY n.nspname;

-- 4. Table ownership, dangerous runtime rights, RLS and schema boundaries.
SELECT n.nspname AS schema_name, c.relname, c.relkind,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity, c.relforcerowsecurity,
       has_table_privilege(:'runtime_role',c.oid,'TRUNCATE') AS runtime_truncate,
       has_table_privilege(:'runtime_role',c.oid,'TRIGGER') AS runtime_trigger,
       has_table_privilege(:'runtime_role',c.oid,'REFERENCES') AS runtime_references
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 ORDER BY n.nspname,c.relname;

SELECT d.datname, pg_get_userbyid(d.datdba) AS owner,
       has_database_privilege(:'runtime_role',d.oid,'CREATE') AS runtime_create,
       has_database_privilege(:'operator_role',d.oid,'CREATE') AS operator_create
  FROM pg_catalog.pg_database d WHERE d.datname = current_database();
COMMIT;
