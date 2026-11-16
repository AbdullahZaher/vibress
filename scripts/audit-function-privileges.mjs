#!/usr/bin/env node
/**
 * Read-only inventory of function EXECUTE privileges (R26).
 *
 * Usage:
 *   node scripts/audit-function-privileges.mjs [connection-string]
 *
 * Defaults to `DATABASE_URL`. The session is forced read-only, so this script
 * cannot change grants; it only reports what PostgreSQL will enforce.
 */
import { Client } from "pg";

const connectionString =
  process.argv[2] ??
  process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5433/vibress";

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query("SET default_transaction_read_only = on");

  const identity = await client.query(
    `SELECT current_database() AS database,
            current_user AS role,
            version() AS version`,
  );

  const functions = await client.query(
    `SELECT p.oid::regprocedure::text AS signature,
            pg_get_userbyid(p.proowner) AS owner,
            p.prosecdef AS security_definer,
            p.prokind AS kind,
            coalesce(array_to_string(p.proconfig, ','), '') AS config,
            coalesce(p.proacl::text, '') AS acl,
            d.objid IS NOT NULL AS extension_owned,
            has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
      WHERE n.nspname = 'public'
      ORDER BY p.oid::regprocedure::text`,
  );

  const defaultAcls = await client.query(
    `SELECT pg_get_userbyid(defaclrole) AS owner,
            defaclobjtype AS object_type,
            defaclacl::text AS acl
       FROM pg_default_acl
      ORDER BY 1, 2`,
  );

  const roles = await client.query(
    `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
       FROM pg_roles
      WHERE rolname NOT LIKE 'pg\\_%'
      ORDER BY rolname`,
  );

  const rows = functions.rows;
  const report = {
    generated_at: new Date().toISOString(),
    identity: identity.rows[0],
    summary: {
      public_functions: rows.length,
      security_definer: rows.filter((row) => row.security_definer).length,
      extension_owned: rows.filter((row) => row.extension_owned).length,
      non_extension: rows.filter((row) => !row.extension_owned).length,
      public_execute: rows.filter((row) => row.public_execute).length,
      security_definer_with_public_execute: rows.filter(
        (row) => row.security_definer && row.public_execute,
      ).length,
      default_acl_entries: defaultAcls.rows.length,
    },
    functions: rows,
    default_acls: defaultAcls.rows,
    roles: roles.rows,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await client.end();
}
