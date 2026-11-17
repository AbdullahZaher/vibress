import type { ClientBase } from "pg";

/**
 * M03-S03 / AG06-S03-02: database-observed effective authority, not ACL-text
 * inference. Only the dedicated operator process imports this module.
 *
 * Fail-closed policy: no executable SECURITY DEFINER function is allowlisted
 * for either the tenant runtime or the migration operator. Even an apparently
 * harmless function must undergo independent owner/search_path/body/chain
 * review before adding an explicit, versioned allowlist in a later change.
 */
export interface SchemaEffectivePrivilegeEvidence {
  readonly reachableSecurityDefinerCount: number;
  readonly roleMembershipCount: number;
  readonly unsafeSchemaAuthorityCount: number;
  readonly runtimeRelationOwnershipCount: number;
  readonly unsafeDatabaseOwnershipCount: number;
}

export async function inspectSchemaOperatorEffectivePrivileges(
  db: ClientBase,
  runtimeRole: string,
  operatorRole: string,
): Promise<SchemaEffectivePrivilegeEvidence> {
  // Both schema USAGE and function EXECUTE are needed for direct invocation.
  // PostgreSQL resolves these effective privileges across PUBLIC and INHERIT
  // grants. Test *both* connection identities: the operator may also be a
  // stepping stone into privileged routines.
  const definers = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef
        AND (
          (has_schema_privilege($1::name, n.oid, 'USAGE')
           AND has_function_privilege($1::name, p.oid, 'EXECUTE'))
          OR
          (has_schema_privilege($2::name, n.oid, 'USAGE')
           AND has_function_privilege($2::name, p.oid, 'EXECUTE'))
        )`,
    [runtimeRole, operatorRole],
  );

  // PostgreSQL 16 has distinct INHERIT and SET membership paths, including
  // transitive paths. A service role with any other membership is outside the
  // validated no-role-switch/no-inheritance topology.
  const memberships = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM pg_catalog.pg_roles target
      WHERE target.rolname <> ALL(ARRAY[$1::name, $2::name])
        AND (
          pg_has_role($1::name, target.oid, 'MEMBER')
          OR pg_has_role($2::name, target.oid, 'MEMBER')
          OR pg_has_role($1::name, target.oid, 'SET')
          OR pg_has_role($2::name, target.oid, 'SET')
          OR pg_has_role($1::name, target.oid, 'USAGE')
          OR pg_has_role($2::name, target.oid, 'USAGE')
        )`,
    [runtimeRole, operatorRole],
  );
  const schemaAuthority = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM pg_catalog.pg_namespace n
      WHERE n.nspname !~ '^pg_'
        AND n.nspname <> 'information_schema'
        AND (
          has_schema_privilege($1::name, n.oid, 'CREATE')
          OR has_schema_privilege($2::name, n.oid, 'CREATE')
          OR n.nspowner IN (
            SELECT oid FROM pg_catalog.pg_roles
             WHERE rolname IN ($1::name, $2::name)
          )
        )`,
    [runtimeRole, operatorRole],
  );
  const owners = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)`,
    [runtimeRole],
  );
  const dbOwners = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM pg_catalog.pg_database d
       JOIN pg_catalog.pg_roles r ON r.oid = d.datdba
      WHERE d.datname = current_database()
        AND r.rolname IN ($1::name, $2::name)`,
    [runtimeRole, operatorRole],
  );

  const asCount = (rows: readonly { total: string }[]): number => {
    const value = rows[0]?.total;
    if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
      throw new Error("PostgreSQL effective privilege inventory is incomplete");
    }
    const count = Number(value);
    if (!Number.isSafeInteger(count)) {
      throw new Error("PostgreSQL effective privilege inventory exceeded safe bounds");
    }
    return count;
  };
  return {
    reachableSecurityDefinerCount: asCount(definers.rows),
    roleMembershipCount: asCount(memberships.rows),
    unsafeSchemaAuthorityCount: asCount(schemaAuthority.rows),
    runtimeRelationOwnershipCount: asCount(owners.rows),
    unsafeDatabaseOwnershipCount: asCount(dbOwners.rows),
  };
}
