import type { ClientBase } from "pg";

export interface PlatformRuntimeRoleConfig {
  roleName: string;
  password: string;
}

const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export function readPlatformRuntimeRoleConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlatformRuntimeRoleConfig | null {
  const password = env.POSTGRES_PLATFORM_APP_PASSWORD?.trim();
  if (!password) {
    return null;
  }
  const roleName =
    env.POSTGRES_PLATFORM_APP_USER?.trim() || "vibress_platform_app";
  if (!ROLE_NAME_PATTERN.test(roleName)) {
    throw new Error(
      "POSTGRES_PLATFORM_APP_USER must be lowercase letters, digits, and underscores (max 63 chars)",
    );
  }
  return { roleName, password };
}

/**
 * Creates the least-privilege role that serves platform tenant-owned resources.
 *
 * The role is a non-owner with NOBYPASSRLS. It intentionally has:
 * - DML on `platform_crm_customers` only;
 * - no schema CREATE/ALTER/DROP;
 * - no TRUNCATE or REFERENCES (neither is governed by RLS);
 * - no function EXECUTE grants to the platform tables/infrastructure.
 *
 * `platform_applications`, `platform_installations`, `platform_tenants` and
 * `platform_application_registrations` are operator-owned registry tables and
 * are not reachable by this role. `platform_memberships` is the principal
 * directory, read before a verified scope exists, so it is denied as well.
 */
export async function provisionPlatformRuntimeRole(
  client: ClientBase,
  { roleName, password }: PlatformRuntimeRoleConfig,
): Promise<void> {
  if (typeof roleName !== "string" || !ROLE_NAME_PATTERN.test(roleName)) {
    throw new Error("Invalid platform runtime role name");
  }
  if (!password) {
    throw new Error("Platform runtime role password must not be empty");
  }

  const current = await client.query<{ current_user: string }>(
    "SELECT current_user",
  );
  if (current.rows[0]?.current_user === roleName) {
    throw new Error(
      "POSTGRES_PLATFORM_APP_USER must differ from the migration/owner role",
    );
  }

  const role = client.escapeIdentifier(roleName);
  const quotedPassword = client.escapeLiteral(password);

  const existing = await client.query<{ rolsuper: boolean }>(
    "SELECT rolsuper FROM pg_roles WHERE rolname = $1",
    [roleName],
  );
  if (existing.rows[0]?.rolsuper) {
    throw new Error(
      "Refusing to manage an existing superuser as the platform runtime role",
    );
  }
  if (existing.rowCount) {
    await client.query(`ALTER ROLE ${role} LOGIN PASSWORD ${quotedPassword}`);
  } else {
    await client.query(`CREATE ROLE ${role} LOGIN PASSWORD ${quotedPassword}`);
  }
  await client.query(
    `ALTER ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
  );

  const databaseRow = await client.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  const databaseName = databaseRow.rows[0]?.name;
  if (!databaseName) {
    throw new Error("Unable to resolve the current database");
  }
  const database = client.escapeIdentifier(databaseName);

  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  // Runtime must never create objects, even in its own schema.
  await client.query(`REVOKE CREATE ON SCHEMA public FROM ${role}`);

  await client.query(
    `REVOKE ALL PRIVILEGES ON TABLE public.platform_crm_customers FROM ${role}`,
  );
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_crm_customers TO ${role}`,
  );
  // RLS does not cover TRUNCATE/REFERENCES/TRIGGER; deny them explicitly.
  await client.query(
    `REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.platform_crm_customers FROM ${role}`,
  );

  await client.query(
    `REVOKE ALL PRIVILEGES ON TABLE public.platform_applications FROM ${role}`,
  );
  await client.query(
    `REVOKE ALL PRIVILEGES ON TABLE public.platform_installations FROM ${role}`,
  );
  await client.query(
    `REVOKE ALL PRIVILEGES ON TABLE public.platform_tenants FROM ${role}`,
  );
  for (const table of [
    "platform_application_registrations",
    "platform_memberships",
  ]) {
    const exists = await client.query<{ present: boolean }>(
      "SELECT to_regclass($1) IS NOT NULL AS present",
      [`public.${table}`],
    );
    if (!exists.rows[0]?.present) continue;
    await client.query(
      `REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM ${role}`,
    );
  }
  await client.query(
    `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM ${role}`,
  );
}

export interface RuntimeRoleAttributes {
  readonly currentUser: string;
  readonly sessionUser: string;
  readonly isSuperuser: boolean;
  readonly isBypassRls: boolean;
  readonly isCreateRole: boolean;
  readonly isCreateDb: boolean;
  readonly isReplication: boolean;
}

export type PlatformRuntimeRoleViolationCode =
  | "identity_unresolved"
  | "identity_superuser"
  | "identity_bypass_rls"
  | "identity_createrole"
  | "identity_createdb"
  | "identity_replication"
  | "privileged_role_membership"
  | "schema_create_privilege"
  | "database_create_privilege"
  | "owns_database"
  | "owns_schema"
  | "owns_table"
  | "owns_function"
  | "registry_table_privilege"
  | "tenant_table_forbidden_privilege"
  | "security_definer_execute";

export interface PlatformRuntimeRoleViolation {
  readonly code: PlatformRuntimeRoleViolationCode;
  readonly detail: string;
}

export class UnsafePlatformRuntimeRoleError extends Error {
  readonly attributes: Partial<RuntimeRoleAttributes> | undefined;
  readonly violations: readonly PlatformRuntimeRoleViolation[];

  constructor(
    reason: string,
    attributes?: Partial<RuntimeRoleAttributes>,
    violations: readonly PlatformRuntimeRoleViolation[] = [],
  ) {
    super(`Unsafe platform runtime role: ${reason}`);
    this.name = "UnsafePlatformRuntimeRoleError";
    this.attributes = attributes;
    this.violations = violations;
  }
}

interface RuntimeIdentityRow {
  currentUser: string;
  sessionUser: string;
  currentIsSuperuser: boolean;
  currentIsBypassRls: boolean;
  currentIsCreateRole: boolean;
  currentIsCreateDb: boolean;
  currentIsReplication: boolean;
  sessionIsSuperuser: boolean;
  sessionIsBypassRls: boolean;
  sessionIsCreateRole: boolean;
  sessionIsCreateDb: boolean;
  sessionIsReplication: boolean;
}

const REGISTRY_TABLES = [
  "platform_applications",
  "platform_installations",
  "platform_tenants",
  "platform_application_registrations",
  "platform_memberships",
] as const;

const REGISTRY_TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

const TENANT_TABLE_FORBIDDEN_PRIVILEGES = [
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

/**
 * Validates that the active PostgreSQL connection has verified non-owner,
 * least-privilege runtime credentials suitable for serving tenant-bound traffic.
 *
 * The check covers both `current_user` and `session_user`: a login may drop
 * to a least-privilege role with SET ROLE and later restore its session
 * identity or any role it is a member of, so both identities must be safe.
 *
 * All checks fail closed. A violation is reported for:
 * - superuser, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION attributes;
 * - membership in (and therefore SET ROLE to) any such privileged role;
 * - CREATE on the public schema or the current database;
 * - ownership of the database, any schema, platform tables or functions;
 * - any table/column privilege on operator registry and membership tables;
 * - TRUNCATE/REFERENCES/TRIGGER on the tenant table (not governed by RLS);
 * - EXECUTE on a SECURITY DEFINER function in a non-system schema.
 */
export async function assertSafePlatformRuntimeRole(
  client: { query: <TRow = unknown>(sql: string, params?: readonly unknown[]) => Promise<{ rows: TRow[] }> },
): Promise<RuntimeRoleAttributes> {
  const roleRow = (
    await client.query<RuntimeIdentityRow>(
      `SELECT current_user AS "currentUser",
              session_user AS "sessionUser",
              cr.rolsuper AS "currentIsSuperuser",
              cr.rolbypassrls AS "currentIsBypassRls",
              cr.rolcreaterole AS "currentIsCreateRole",
              cr.rolcreatedb AS "currentIsCreateDb",
              cr.rolreplication AS "currentIsReplication",
              sr.rolsuper AS "sessionIsSuperuser",
              sr.rolbypassrls AS "sessionIsBypassRls",
              sr.rolcreaterole AS "sessionIsCreateRole",
              sr.rolcreatedb AS "sessionIsCreateDb",
              sr.rolreplication AS "sessionIsReplication"
         FROM pg_roles cr
         JOIN pg_roles sr ON sr.rolname = session_user
        WHERE cr.rolname = current_user`,
    )
  ).rows[0];

  if (!roleRow) {
    throw new UnsafePlatformRuntimeRoleError(
      "unable to resolve current_user and session_user in pg_roles",
      undefined,
      [
        {
          code: "identity_unresolved",
          detail: "current_user or session_user is missing from pg_roles",
        },
      ],
    );
  }

  const attributes: RuntimeRoleAttributes = {
    currentUser: roleRow.currentUser,
    sessionUser: roleRow.sessionUser,
    isSuperuser: roleRow.currentIsSuperuser,
    isBypassRls: roleRow.currentIsBypassRls,
    isCreateRole: roleRow.currentIsCreateRole,
    isCreateDb: roleRow.currentIsCreateDb,
    isReplication: roleRow.currentIsReplication,
  };

  const violations: PlatformRuntimeRoleViolation[] = [];
  const seen = new Set<string>();
  const addViolation = (
    code: PlatformRuntimeRoleViolationCode,
    detail: string,
  ): void => {
    const key = `${code}:${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ code, detail });
  };

  const identities = [
    {
      label: "current_user",
      name: roleRow.currentUser,
      isSuperuser: roleRow.currentIsSuperuser,
      isBypassRls: roleRow.currentIsBypassRls,
      isCreateRole: roleRow.currentIsCreateRole,
      isCreateDb: roleRow.currentIsCreateDb,
      isReplication: roleRow.currentIsReplication,
    },
    ...(roleRow.sessionUser === roleRow.currentUser
      ? []
      : [
          {
            label: "session_user",
            name: roleRow.sessionUser,
            isSuperuser: roleRow.sessionIsSuperuser,
            isBypassRls: roleRow.sessionIsBypassRls,
            isCreateRole: roleRow.sessionIsCreateRole,
            isCreateDb: roleRow.sessionIsCreateDb,
            isReplication: roleRow.sessionIsReplication,
          },
        ]),
  ];

  for (const identity of identities) {
    const who = `${identity.label} '${identity.name}'`;
    if (identity.isSuperuser) {
      addViolation(
        "identity_superuser",
        `${who} has superuser privileges (rolsuper=true)`,
      );
    }
    if (identity.isBypassRls) {
      addViolation(
        "identity_bypass_rls",
        `${who} bypasses row-level security (rolbypassrls=true)`,
      );
    }
    if (identity.isCreateRole) {
      addViolation(
        "identity_createrole",
        `${who} can create and administer roles (rolcreaterole=true)`,
      );
    }
    if (identity.isCreateDb) {
      addViolation(
        "identity_createdb",
        `${who} can create databases (rolcreatedb=true)`,
      );
    }
    if (identity.isReplication) {
      addViolation(
        "identity_replication",
        `${who} has replication privileges (rolreplication=true)`,
      );
    }
  }

  const memberships = (
    await client.query<{ identity: string; roleName: string }>(
      `SELECT i.identity::text AS identity, r.rolname AS "roleName"
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         JOIN pg_roles r
           ON r.rolname <> i.identity
          AND (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole
               OR r.rolcreatedb OR r.rolreplication)
          AND pg_has_role(i.identity, r.oid, 'MEMBER')
        ORDER BY 1, 2`,
    )
  ).rows;
  for (const membership of memberships) {
    addViolation(
      "privileged_role_membership",
      `'${membership.identity}' is a member of privileged role '${membership.roleName}' and can SET ROLE to it`,
    );
  }

  const ddlPrivileges = (
    await client.query<{
      identity: string;
      canCreateInSchema: boolean;
      canCreateDatabase: boolean;
    }>(
      `SELECT i.identity::text AS identity,
              has_schema_privilege(i.identity, 'public', 'CREATE') AS "canCreateInSchema",
              has_database_privilege(i.identity, current_database(), 'CREATE') AS "canCreateDatabase"
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)`,
    )
  ).rows;
  for (const privilege of ddlPrivileges) {
    if (privilege.canCreateInSchema) {
      addViolation(
        "schema_create_privilege",
        `'${privilege.identity}' has CREATE on schema public`,
      );
    }
    if (privilege.canCreateDatabase) {
      addViolation(
        "database_create_privilege",
        `'${privilege.identity}' has CREATE on the current database`,
      );
    }
  }

  const ownershipRows = (
    await client.query<{ scope: "database" | "schema"; name: string }>(
      `SELECT 'database'::text AS scope, d.datname AS name
         FROM pg_database d
        WHERE d.datname = current_database()
          AND pg_get_userbyid(d.datdba) IN (current_user, session_user)
        UNION ALL
       SELECT 'schema'::text AS scope, n.nspname AS name
         FROM pg_namespace n
        WHERE pg_get_userbyid(n.nspowner) IN (current_user, session_user)`,
    )
  ).rows;
  for (const owned of ownershipRows) {
    if (owned.scope === "database") {
      addViolation("owns_database", `runtime identity owns database '${owned.name}'`);
    } else {
      addViolation("owns_schema", `runtime identity owns schema '${owned.name}'`);
    }
  }

  const ownedTables = (
    await client.query<{ tableName: string }>(
      `SELECT c.relname AS "tableName"
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN (
            'platform_crm_customers',
            'platform_application_registrations',
            'platform_memberships',
            'platform_installations',
            'platform_tenants',
            'platform_applications'
          )
          AND pg_get_userbyid(c.relowner) IN (current_user, session_user)`,
    )
  ).rows;
  if (ownedTables.length > 0) {
    addViolation(
      "owns_table",
      `runtime identity owns tables: ${ownedTables.map((r) => r.tableName).join(", ")}`,
    );
  }

  const registryPrivileges = (
    await client.query<{
      identity: string;
      tableName: string;
      privileges: string[];
    }>(
      `SELECT i.identity::text AS identity,
              t.table_name AS "tableName",
              array_agg(p.privilege ORDER BY p.privilege) AS privileges
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         CROSS JOIN unnest($1::text[]) AS t(table_name)
         CROSS JOIN unnest($2::text[]) AS p(privilege)
        WHERE to_regclass(format('public.%I', t.table_name)) IS NOT NULL
          AND has_table_privilege(
            i.identity, format('public.%I', t.table_name), p.privilege
          )
        GROUP BY i.identity, t.table_name`,
      [REGISTRY_TABLES, REGISTRY_TABLE_PRIVILEGES],
    )
  ).rows;
  for (const privilege of registryPrivileges) {
    addViolation(
      "registry_table_privilege",
      `'${privilege.identity}' has ${privilege.privileges.join(", ")} on registry table '${privilege.tableName}'`,
    );
  }

  const registryColumnPrivileges = (
    await client.query<{
      identity: string;
      tableName: string;
      privileges: string[];
    }>(
      `SELECT i.identity::text AS identity,
              t.table_name AS "tableName",
              array_agg(p.privilege ORDER BY p.privilege) AS privileges
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         CROSS JOIN unnest($1::text[]) AS t(table_name)
         CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']::text[]) AS p(privilege)
        WHERE to_regclass(format('public.%I', t.table_name)) IS NOT NULL
          AND has_any_column_privilege(
            i.identity, format('public.%I', t.table_name), p.privilege
          )
          AND NOT has_table_privilege(
            i.identity, format('public.%I', t.table_name), p.privilege
          )
        GROUP BY i.identity, t.table_name`,
      [REGISTRY_TABLES],
    )
  ).rows;
  for (const privilege of registryColumnPrivileges) {
    addViolation(
      "registry_table_privilege",
      `'${privilege.identity}' has column-level ${privilege.privileges.join(", ")} on registry table '${privilege.tableName}'`,
    );
  }

  if (
    (
      await client.query<{ present: boolean }>(
        "SELECT to_regclass('public.platform_crm_customers') IS NOT NULL AS present",
      )
    ).rows[0]?.present
  ) {
    const tenantPrivileges = (
      await client.query<{ identity: string; privileges: string[] }>(
        `SELECT identity, array_agg(DISTINCT privilege ORDER BY privilege) AS privileges
           FROM (
             SELECT i.identity::text AS identity, p.privilege
               FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
               CROSS JOIN unnest($1::text[]) AS p(privilege)
              WHERE has_table_privilege(
                      i.identity, 'public.platform_crm_customers', p.privilege
                    )
             UNION
             SELECT i.identity::text AS identity, 'REFERENCES'::text AS privilege
               FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
              WHERE has_any_column_privilege(
                      i.identity, 'public.platform_crm_customers', 'REFERENCES'
                    )
                AND NOT has_table_privilege(
                      i.identity, 'public.platform_crm_customers', 'REFERENCES'
                    )
           ) AS tenant_privileges
          GROUP BY identity`,
        [TENANT_TABLE_FORBIDDEN_PRIVILEGES],
      )
    ).rows;
    for (const privilege of tenantPrivileges) {
      addViolation(
        "tenant_table_forbidden_privilege",
        `'${privilege.identity}' has ${privilege.privileges.join(", ")} on tenant table 'platform_crm_customers'`,
      );
    }
  }

  const functionRows = (
    await client.query<{
      schemaName: string;
      functionName: string;
      ownedByIdentity: boolean;
      executableSecurityDefiner: boolean;
    }>(
      `SELECT n.nspname AS "schemaName",
              p.proname AS "functionName",
              pg_get_userbyid(p.proowner) IN (current_user, session_user) AS "ownedByIdentity",
              (
                p.prosecdef
                AND EXISTS (
                  SELECT 1
                    FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
                   WHERE has_function_privilege(i.identity, p.oid, 'EXECUTE')
                )
              ) AS "executableSecurityDefiner"
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND NOT EXISTS (
            SELECT 1
              FROM pg_depend d
             WHERE d.classid = 'pg_proc'::regclass
               AND d.objid = p.oid
               AND d.deptype = 'e'
          )
          AND (
            pg_get_userbyid(p.proowner) IN (current_user, session_user)
            OR (
              p.prosecdef
              AND EXISTS (
                SELECT 1
                  FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
                 WHERE has_function_privilege(i.identity, p.oid, 'EXECUTE')
              )
            )
          )`,
    )
  ).rows;

  const ownedFunctions = functionRows
    .filter((row) => row.ownedByIdentity)
    .map((row) => `${row.schemaName}.${row.functionName}`);
  if (ownedFunctions.length > 0) {
    addViolation(
      "owns_function",
      `runtime identity owns functions: ${ownedFunctions.join(", ")}`,
    );
  }

  const executableSecurityDefiners = functionRows
    .filter((row) => row.executableSecurityDefiner)
    .map((row) => `${row.schemaName}.${row.functionName}`);
  if (executableSecurityDefiners.length > 0) {
    addViolation(
      "security_definer_execute",
      `runtime identity can execute SECURITY DEFINER functions: ${executableSecurityDefiners.join(", ")}`,
    );
  }

  if (violations.length > 0) {
    throw new UnsafePlatformRuntimeRoleError(
      violations.map((violation) => violation.detail).join("; "),
      attributes,
      Object.freeze(violations),
    );
  }

  return attributes;
}

