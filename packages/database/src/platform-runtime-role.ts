import type { ClientBase } from "pg";
import {
  assertValidRuntimePrivilegeContract,
  type PlatformRuntimePrivilegeContract,
  type RuntimeRelationGrant,
  type RuntimeSequenceGrant,
} from "./platform-runtime-privilege-contract";

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
 * The role is a non-owner with NOBYPASSRLS. Its entire authority comes from the
 * supplied runtime privilege contract: today's reference profile receives DML on
 * `platform_crm_customers` only. Historical grants on every other non-system
 * relation, sequence and function are revoked first, so a previously broader
 * role cannot keep authority that the contract does not describe.
 *
 * The contract never permits schema CREATE, TRUNCATE, REFERENCES, TRIGGER,
 * sequence ownership or owner-defined function execution. Operator registry and
 * membership tables are not part of any runtime profile.
 */
export async function provisionPlatformRuntimeRole(
  client: ClientBase,
  { roleName, password }: PlatformRuntimeRoleConfig,
  contract: PlatformRuntimePrivilegeContract,
): Promise<void> {
  if (typeof roleName !== "string" || !ROLE_NAME_PATTERN.test(roleName)) {
    throw new Error("Invalid platform runtime role name");
  }
  if (!password) {
    throw new Error("Platform runtime role password must not be empty");
  }
  assertValidRuntimePrivilegeContract(contract);

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
  await client.query(`REVOKE CREATE ON DATABASE ${database} FROM ${role}`);

  const schemas = (
    await client.query<{ name: string }>(
      `SELECT nspname AS name
         FROM pg_namespace
        WHERE nspname NOT IN ('pg_catalog', 'information_schema')
          AND nspname NOT LIKE 'pg_toast%'
        ORDER BY nspname`,
    )
  ).rows;
  const allowedSchemas = new Set(contract.schemas);

  // Revoke everything first: a role provisioned under an older, broader policy
  // must not retain authority that the current contract does not describe.
  for (const schemaRow of schemas) {
    const schema = client.escapeIdentifier(schemaRow.name);
    await client.query(
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} FROM ${role}`,
    );
    await client.query(
      `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${role}`,
    );
    await client.query(
      `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} FROM ${role}`,
    );
    await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA ${schema} FROM ${role}`);
    if (allowedSchemas.has(schemaRow.name)) {
      await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    }
  }

  for (const grant of contract.relations) {
    await assertContractRelation(client, grant);
    await client.query(
      `GRANT ${grant.privileges.join(", ")} ON TABLE ${client.escapeIdentifier(grant.schema)}.${client.escapeIdentifier(grant.relation)} TO ${role}`,
    );
  }
  for (const grant of contract.sequences) {
    await assertContractSequence(client, grant);
    await client.query(
      `GRANT ${grant.privileges.join(", ")} ON SEQUENCE ${client.escapeIdentifier(grant.schema)}.${client.escapeIdentifier(grant.sequence)} TO ${role}`,
    );
  }
  for (const grant of contract.functions) {
    const signatures = (
      await client.query<{ signature: string }>(
        `SELECT p.oid::regprocedure::text AS signature
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = $1
            AND p.proname = $2
            AND p.prokind IN ('f', 'p')
            AND pg_get_function_identity_arguments(p.oid) = $3`,
        [grant.schema, grant.name, grant.identityArguments],
      )
    ).rows.map((row) => row.signature);
    if (signatures.length !== 1) {
      throw new Error(
        `Runtime privilege contract references function '${grant.schema}.${grant.name}(${grant.identityArguments})' but found ${signatures.length} matching definitions`,
      );
    }
    await client.query(
      `GRANT EXECUTE ON FUNCTION ${signatures[0]} TO ${role}`,
    );
  }
}

const RELKIND_TO_CONTRACT: Readonly<Record<string, RuntimeRelationGrant["kind"]>> =
  Object.freeze({
    r: "table",
    p: "table",
    v: "view",
    m: "materialized_view",
    f: "foreign_table",
  });

async function assertContractRelation(
  client: ClientBase,
  grant: RuntimeRelationGrant,
): Promise<void> {
  const row = (
    await client.query<{ kind: string }>(
      `SELECT c.relkind::text AS kind
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2`,
      [grant.schema, grant.relation],
    )
  ).rows[0];
  if (!row) {
    throw new Error(
      `Runtime privilege contract references missing relation '${grant.schema}.${grant.relation}'`,
    );
  }
  if (RELKIND_TO_CONTRACT[row.kind] !== grant.kind) {
    throw new Error(
      `Runtime privilege contract declares '${grant.schema}.${grant.relation}' as ${grant.kind}, but the database has relkind '${row.kind}'`,
    );
  }
}

async function assertContractSequence(
  client: ClientBase,
  grant: RuntimeSequenceGrant,
): Promise<void> {
  const row = (
    await client.query<{ kind: string }>(
      `SELECT c.relkind::text AS kind
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2`,
      [grant.schema, grant.sequence],
    )
  ).rows[0];
  if (row?.kind !== "S") {
    throw new Error(
      `Runtime privilege contract references missing sequence '${grant.schema}.${grant.sequence}'`,
    );
  }
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
  | "unexpected_role_membership"
  | "schema_create_privilege"
  | "database_create_privilege"
  | "owns_database"
  | "owns_schema"
  | "owns_table"
  | "owns_function"
  | "registry_table_privilege"
  | "tenant_table_forbidden_privilege"
  | "security_definer_execute"
  | "membership_read_missing"
  | "membership_write_privilege"
  | "unexpected_relation_privilege"
  | "view_not_security_invoker"
  | "unexpected_column_privilege"
  | "unexpected_sequence_privilege"
  | "unexpected_schema_privilege"
  | "unexpected_function_execute"
  | "contract_function_missing"
  | "privilege_contract_missing"
  | "privilege_contract_invalid";

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
  "platform_application_registry_changes",
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

const SEQUENCE_PRIVILEGES = ["USAGE", "SELECT", "UPDATE"] as const;

const COLUMN_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "REFERENCES"] as const;

export type PlatformRoleProfile =
  | "runtime"
  | "membership_reader"
  | "deployment_verifier";

export interface PlatformRoleAssertionOptions {
  /**
   * `membership_reader` validates the dedicated membership-directory reader:
   * SELECT on `platform_memberships` only, and no privilege on any other
   * relation, sequence or function.
   *
   * `deployment_verifier` validates the read-only boot verifier: SELECT on
   * `platform_installations` and `platform_application_registrations` only,
   * and no mutation privilege or access to any other relation.
   */
  readonly profile?: PlatformRoleProfile;
  /**
   * Required for the `runtime` profile. Provisioning grants exactly this
   * contract and boot rejects every effective privilege outside it. A missing
   * or malformed contract fails closed rather than falling back to a fixed
   * reference policy.
   */
  readonly privilegeContract?: PlatformRuntimePrivilegeContract;
}

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
 * - any unexpected SET-able role membership, including NOINHERIT and indirect
 *   memberships in otherwise ordinary roles that own objects or hold extra
 *   ACLs; a dedicated runtime/reader login must not be able to SET ROLE at all;
 * - CREATE on any non-system schema or the current database;
 * - ownership of the database, any schema, platform tables or functions;
 * - any table/column privilege on operator registry and membership tables;
 * - TRUNCATE/REFERENCES/TRIGGER on the tenant table (not governed by RLS);
 * - EXECUTE on a SECURITY DEFINER function in a non-system schema.
 *
 * The `membership_reader` profile applies the same identity, ownership and
 * function checks to the membership-directory reader, which must hold SELECT
 * on `platform_memberships` and no privilege on any other relation.
 *
 * The `deployment_verifier` profile applies them to the read-only boot
 * verifier, which must hold SELECT on `platform_installations` and
 * `platform_application_registrations` and no privilege on any other relation.
 *
 * The `runtime` profile additionally requires a
 * {@link PlatformRuntimePrivilegeContract}. Every effective privilege on every
 * non-system table, view, materialized view, foreign table, sequence and
 * owner-defined function must be described by that contract. Privileges that
 * arrive through PUBLIC or role inheritance are visible to the same check,
 * because it asks PostgreSQL for effective privileges.
 */
export async function assertSafePlatformRuntimeRole(
  client: { query: <TRow = unknown>(sql: string, params?: readonly unknown[]) => Promise<{ rows: TRow[] }> },
  options: PlatformRoleAssertionOptions = {},
): Promise<RuntimeRoleAttributes> {
  const isReader = options.profile === "membership_reader";
  const isVerifier = options.profile === "deployment_verifier";
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

  // `pg_has_role(..., 'MEMBER')` follows the full transitive membership
  // closure and returns true for NOINHERIT memberships, which are not usable
  // implicitly but are still SET-able. A dedicated runtime/reader/verifier
  // login must have no memberships at all: any SET-able role could own
  // protected objects or carry ACLs that `current_user` checks never see.
  const memberships = (
    await client.query<{
      identity: string;
      roleName: string;
      privileged: boolean;
    }>(
      `SELECT i.identity::text AS identity,
              r.rolname AS "roleName",
              (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole
               OR r.rolcreatedb OR r.rolreplication) AS privileged
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         JOIN pg_roles r
           ON r.rolname <> i.identity
          AND pg_has_role(i.identity, r.oid, 'MEMBER')
        ORDER BY 1, 2`,
    )
  ).rows;
  for (const membership of memberships) {
    if (membership.privileged) {
      addViolation(
        "privileged_role_membership",
        `'${membership.identity}' is a member of privileged role '${membership.roleName}' and can SET ROLE to it`,
      );
    } else {
      addViolation(
        "unexpected_role_membership",
        `'${membership.identity}' is a SET-able member of role '${membership.roleName}'; dedicated platform logins must have no role memberships`,
      );
    }
  }

  const ddlPrivileges = (
    await client.query<{
      identity: string;
      canCreateDatabase: boolean;
    }>(
      `SELECT i.identity::text AS identity,
              has_database_privilege(i.identity, current_database(), 'CREATE') AS "canCreateDatabase"
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)`,
    )
  ).rows;
  const schemaCreatePrivileges = (
    await client.query<{ identity: string; schemaName: string }>(
      `SELECT i.identity::text AS identity, n.nspname AS "schemaName"
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         CROSS JOIN pg_namespace n
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND has_schema_privilege(i.identity, n.oid, 'CREATE')`,
    )
  ).rows;
  for (const privilege of ddlPrivileges) {
    if (privilege.canCreateDatabase) {
      addViolation(
        "database_create_privilege",
        `'${privilege.identity}' has CREATE on the current database`,
      );
    }
  }
  for (const privilege of schemaCreatePrivileges) {
    addViolation(
      "schema_create_privilege",
      `'${privilege.identity}' has CREATE on schema '${privilege.schemaName}'`,
    );
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

  if (!isReader && !isVerifier) {
    const ownedTables = (
      await client.query<{ tableName: string }>(
        `SELECT c.relname AS "tableName"
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname IN (
              'platform_crm_customers',
              'platform_application_registrations',
              'platform_application_registry_changes',
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

    const otherOwnedRelations = (
      await client.query<{ relation: string }>(
        `SELECT i.identity::text AS identity,
                format('%I.%I', n.nspname, c.relname) AS relation
           FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
           CROSS JOIN pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
            AND n.nspname NOT LIKE 'pg_toast%'
            AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
            AND pg_get_userbyid(c.relowner) = i.identity`,
      )
    ).rows;
    if (otherOwnedRelations.length > 0) {
      addViolation(
        "owns_table",
        `runtime identity owns relations: ${otherOwnedRelations
          .map((row) => row.relation)
          .join(", ")}`,
      );
    }
  }

  const registryTables = isReader
    ? REGISTRY_TABLES.filter((table) => table !== "platform_memberships")
    : isVerifier
      ? REGISTRY_TABLES.filter(
          (table) =>
            table !== "platform_installations" &&
            table !== "platform_application_registrations",
        )
      : REGISTRY_TABLES;

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
      [registryTables, REGISTRY_TABLE_PRIVILEGES],
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
      [registryTables],
    )
  ).rows;
  for (const privilege of registryColumnPrivileges) {
    addViolation(
      "registry_table_privilege",
      `'${privilege.identity}' has column-level ${privilege.privileges.join(", ")} on registry table '${privilege.tableName}'`,
    );
  }

  if (isReader) {
    await inspectReadOnlyRelationAccess(client, roleRow, addViolation, {
      requiredSelectTables: ["platform_memberships"],
      allowedSelectTables: ["platform_memberships"],
      missingRelationCode: "membership_read_missing",
      missingSelectCode: "membership_read_missing",
      writeCode: "membership_write_privilege",
    });
  } else if (isVerifier) {
    await inspectReadOnlyRelationAccess(client, roleRow, addViolation, {
      requiredSelectTables: [
        "platform_installations",
        "platform_application_registrations",
      ],
      allowedSelectTables: [
        "platform_installations",
        "platform_application_registrations",
      ],
      missingRelationCode: "unexpected_relation_privilege",
      missingSelectCode: "unexpected_relation_privilege",
      writeCode: "unexpected_relation_privilege",
    });
  }

  if (
    !isReader &&
    !isVerifier &&
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

  if (!isReader && !isVerifier) {
    if (!options.privilegeContract) {
      addViolation(
        "privilege_contract_missing",
        "the runtime profile requires an explicit PlatformRuntimePrivilegeContract; no implicit allowlist is used",
      );
    } else {
      try {
        assertValidRuntimePrivilegeContract(options.privilegeContract);
        await inspectRuntimePrivilegeContract(
          client,
          roleRow,
          addViolation,
          options.privilegeContract,
        );
      } catch (error) {
        addViolation(
          "privilege_contract_invalid",
          error instanceof Error
            ? error.message
            : "runtime privilege contract is invalid",
        );
      }
    }
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

type AddViolation = (
  code: PlatformRuntimeRoleViolationCode,
  detail: string,
) => void;

interface ReadOnlyRoleSpec {
  readonly requiredSelectTables: readonly string[];
  readonly allowedSelectTables: readonly string[];
  readonly missingRelationCode: PlatformRuntimeRoleViolationCode;
  readonly missingSelectCode: PlatformRuntimeRoleViolationCode;
  readonly writeCode: PlatformRuntimeRoleViolationCode;
}

/**
 * Read-only profiles (membership reader, deployment verifier) must hold
 * table-level SELECT on their required registry relations and nothing else.
 * Any write, column-only grant, sequence privilege, relation ownership or
 * access to another non-system relation fails closed.
 */
async function inspectReadOnlyRelationAccess(
  client: {
    query: <TRow = unknown>(
      sql: string,
      params?: readonly unknown[],
    ) => Promise<{ rows: TRow[] }>;
  },
  roleRow: RuntimeIdentityRow,
  addViolation: AddViolation,
  spec: ReadOnlyRoleSpec,
): Promise<void> {
  const identities = [...new Set([roleRow.currentUser, roleRow.sessionUser])];

  for (const table of spec.requiredSelectTables) {
    const present = (
      await client.query<{ present: boolean }>(
        "SELECT to_regclass($1) IS NOT NULL AS present",
        [`public.${table}`],
      )
    ).rows[0]?.present;
    if (!present) {
      addViolation(
        spec.missingRelationCode,
        `public.${table} does not exist; apply the platform migrations before boot`,
      );
      continue;
    }

    const privileges = (
      await client.query<{ identity: string; privilege: string }>(
        `SELECT i.identity::text AS identity, p.privilege
           FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
           CROSS JOIN unnest($1::text[]) AS p(privilege)
          WHERE has_table_privilege(i.identity, $2, p.privilege)`,
        [REGISTRY_TABLE_PRIVILEGES, `public.${table}`],
      )
    ).rows;
    const columnWrites = (
      await client.query<{ identity: string; privilege: string }>(
        `SELECT i.identity::text AS identity, p.privilege
           FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
           CROSS JOIN unnest($1::text[]) AS p(privilege)
          WHERE has_any_column_privilege(i.identity, $2, p.privilege)
            AND NOT has_table_privilege(i.identity, $2, p.privilege)`,
        [COLUMN_PRIVILEGES, `public.${table}`],
      )
    ).rows;

    for (const identity of identities) {
      const tablePrivileges = privileges
        .filter((row) => row.identity === identity)
        .map((row) => row.privilege);
      if (!tablePrivileges.includes("SELECT")) {
        addViolation(
          spec.missingSelectCode,
          `'${identity}' lacks table-level SELECT on '${table}'`,
        );
      }
      const writes = tablePrivileges.filter(
        (privilege) => privilege !== "SELECT",
      );
      const columnWritePrivileges = columnWrites
        .filter((row) => row.identity === identity)
        .map((row) => `${row.privilege} (column)`);
      const allWrites = [...writes, ...columnWritePrivileges];
      if (allWrites.length > 0) {
        addViolation(
          spec.writeCode,
          `'${identity}' has ${allWrites.join(", ")} on '${table}'`,
        );
      }
    }
  }

  const relationPrivileges = (
    await client.query<{
      identity: string;
      relation: string;
      privileges: string[];
    }>(
      `SELECT i.identity::text AS identity,
              format('%I.%I', n.nspname, c.relname) AS relation,
              array_agg(DISTINCT p.privilege ORDER BY p.privilege) AS privileges
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         CROSS JOIN pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest($1::text[]) AS p(privilege)
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND NOT (
            n.nspname = 'public'
            AND c.relname = ANY($2::text[])
            AND p.privilege = 'SELECT'
          )
          AND has_table_privilege(i.identity, c.oid, p.privilege)
        GROUP BY i.identity, n.nspname, c.relname`,
      [REGISTRY_TABLE_PRIVILEGES, spec.allowedSelectTables],
    )
  ).rows;
  for (const privilege of relationPrivileges) {
    addViolation(
      "unexpected_relation_privilege",
      `'${privilege.identity}' has ${privilege.privileges.join(", ")} on relation '${privilege.relation}'`,
    );
  }

  const columnPrivileges = (
    await client.query<{
      identity: string;
      relation: string;
      privileges: string[];
    }>(
      `SELECT i.identity::text AS identity,
              format('%I.%I', n.nspname, c.relname) AS relation,
              array_agg(DISTINCT p.privilege ORDER BY p.privilege) AS privileges
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         CROSS JOIN pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest($1::text[]) AS p(privilege)
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND NOT (
            n.nspname = 'public'
            AND c.relname = ANY($2::text[])
            AND p.privilege = 'SELECT'
          )
          AND has_any_column_privilege(i.identity, c.oid, p.privilege)
          AND NOT has_table_privilege(i.identity, c.oid, p.privilege)
        GROUP BY i.identity, n.nspname, c.relname`,
      [COLUMN_PRIVILEGES, spec.allowedSelectTables],
    )
  ).rows;
  for (const privilege of columnPrivileges) {
    addViolation(
      "unexpected_relation_privilege",
      `'${privilege.identity}' has column-level ${privilege.privileges.join(", ")} on relation '${privilege.relation}'`,
    );
  }

  const sequencePrivileges = (
    await client.query<{
      identity: string;
      relation: string;
      privileges: string[];
    }>(
      `SELECT i.identity::text AS identity,
              format('%I.%I', n.nspname, c.relname) AS relation,
              array_agg(DISTINCT p.privilege ORDER BY p.privilege) AS privileges
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         CROSS JOIN pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest($1::text[]) AS p(privilege)
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND c.relkind = 'S'
          AND has_sequence_privilege(i.identity, c.oid, p.privilege)
        GROUP BY i.identity, n.nspname, c.relname`,
      [SEQUENCE_PRIVILEGES],
    )
  ).rows;
  for (const privilege of sequencePrivileges) {
    addViolation(
      "unexpected_relation_privilege",
      `'${privilege.identity}' has ${privilege.privileges.join(", ")} on sequence '${privilege.relation}'`,
    );
  }

  const ownedRelations = (
    await client.query<{ identity: string; relation: string }>(
      `SELECT i.identity::text AS identity,
              format('%I.%I', n.nspname, c.relname) AS relation
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         CROSS JOIN pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
          AND pg_get_userbyid(c.relowner) = i.identity`,
    )
  ).rows;
  if (ownedRelations.length > 0) {
    addViolation(
      "owns_table",
      `'${roleRow.currentUser}' owns relations: ${ownedRelations
        .map((row) => row.relation)
        .join(", ")}`,
    );
  }
}

const CONTRACT_TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

const NON_SYSTEM_SCHEMA_PREDICATE = `n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'`;

/**
 * Enforces the versioned runtime privilege contract against effective
 * privileges. The queries ask PostgreSQL per identity, so direct grants,
 * grants through PUBLIC, grants inherited from a role and grants made on a
 * view that executes with its owner's rights are all visible.
 *
 * Trigger functions are excluded from the executable-function check: they
 * cannot be called as ordinary functions. Their PUBLIC EXECUTE grants remain
 * part of the separately tracked R26 remediation.
 */
async function inspectRuntimePrivilegeContract(
  client: {
    query: <TRow = unknown>(
      sql: string,
      params?: readonly unknown[],
    ) => Promise<{ rows: TRow[] }>;
  },
  roleRow: RuntimeIdentityRow,
  addViolation: AddViolation,
  contract: PlatformRuntimePrivilegeContract,
): Promise<void> {
  const allowedRelations = new Map(
    contract.relations.map((grant) => [
      `${grant.schema}.${grant.relation}`,
      grant,
    ]),
  );
  const allowedSequences = new Map(
    contract.sequences.map((grant) => [
      `${grant.schema}.${grant.sequence}`,
      grant,
    ]),
  );
  const allowedFunctions = new Set(
    contract.functions.map(
      (grant) =>
        `${grant.schema}.${grant.name}(${grant.identityArguments})`,
    ),
  );
  const allowedSchemas = new Set(contract.schemas);

  for (const grant of contract.relations) {
    if (grant.kind !== "view") continue;
    const options = (
      await client.query<{ options: string | null }>(
        `SELECT array_to_string(c.reloptions, ',') AS options
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2`,
        [grant.schema, grant.relation],
      )
    ).rows[0]?.options;
    if (options === undefined) continue;
    const invoker = (options ?? "")
      .split(",")
      .find((option) => option.startsWith("security_invoker="))
      ?.slice("security_invoker=".length)
      .toLowerCase();
    if (invoker !== "true" && invoker !== "on") {
      addViolation(
        "view_not_security_invoker",
        `'${grant.schema}.${grant.relation}' is declared as a view but is not security_invoker; PostgreSQL would evaluate it with the view owner's rights and skip row-level security for the caller (R35)`,
      );
    }
  }

  const relationPrivileges = (
    await client.query<{
      identity: string;
      schemaName: string;
      relationName: string;
      kind: string;
      privileges: string[];
    }>(
      `SELECT i.identity::text AS identity,
              n.nspname AS "schemaName",
              c.relname AS "relationName",
              c.relkind::text AS kind,
              array_agg(DISTINCT p.privilege ORDER BY p.privilege) AS privileges
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         CROSS JOIN pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest($1::text[]) AS p(privilege)
        WHERE ${NON_SYSTEM_SCHEMA_PREDICATE}
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_table_privilege(i.identity, c.oid, p.privilege)
        GROUP BY i.identity, n.nspname, c.relname, c.relkind`,
      [CONTRACT_TABLE_PRIVILEGES],
    )
  ).rows;
  for (const row of relationPrivileges) {
    const key = `${row.schemaName}.${row.relationName}`;
    const grant = allowedRelations.get(key);
    if (!grant) {
      addViolation(
        "unexpected_relation_privilege",
        `'${row.identity}' has ${row.privileges.join(", ")} on relation '${key}', which the runtime privilege contract does not describe`,
      );
      continue;
    }
    if (RELKIND_TO_CONTRACT[row.kind] !== grant.kind) {
      addViolation(
        "unexpected_relation_privilege",
        `relation '${key}' is a ${RELKIND_TO_CONTRACT[row.kind] ?? row.kind}, but the runtime privilege contract declares ${grant.kind}`,
      );
      continue;
    }
    const extra = row.privileges.filter(
      (privilege) =>
        !grant.privileges.includes(
          privilege as (typeof grant.privileges)[number],
        ),
    );
    if (extra.length > 0) {
      addViolation(
        "unexpected_relation_privilege",
        `'${row.identity}' has ${extra.join(", ")} on relation '${key}' beyond the runtime privilege contract`,
      );
    }
  }

  const columnPrivileges = (
    await client.query<{
      identity: string;
      schemaName: string;
      relationName: string;
      privileges: string[];
    }>(
      `SELECT i.identity::text AS identity,
              n.nspname AS "schemaName",
              c.relname AS "relationName",
              array_agg(DISTINCT p.privilege ORDER BY p.privilege) AS privileges
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         CROSS JOIN pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']::text[]) AS p(privilege)
        WHERE ${NON_SYSTEM_SCHEMA_PREDICATE}
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_any_column_privilege(i.identity, c.oid, p.privilege)
          AND NOT has_table_privilege(i.identity, c.oid, p.privilege)
        GROUP BY i.identity, n.nspname, c.relname`,
    )
  ).rows;
  for (const row of columnPrivileges) {
    addViolation(
      "unexpected_column_privilege",
      `'${row.identity}' has column-level ${row.privileges.join(", ")} on relation '${row.schemaName}.${row.relationName}'; the runtime privilege contract does not support column grants`,
    );
  }

  const sequencePrivileges = (
    await client.query<{
      identity: string;
      schemaName: string;
      relationName: string;
      privileges: string[];
    }>(
      `SELECT i.identity::text AS identity,
              n.nspname AS "schemaName",
              c.relname AS "relationName",
              array_agg(DISTINCT p.privilege ORDER BY p.privilege) AS privileges
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         CROSS JOIN pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']::text[]) AS p(privilege)
        WHERE ${NON_SYSTEM_SCHEMA_PREDICATE}
          AND c.relkind = 'S'
          AND has_sequence_privilege(i.identity, c.oid, p.privilege)
        GROUP BY i.identity, n.nspname, c.relname`,
    )
  ).rows;
  for (const row of sequencePrivileges) {
    const key = `${row.schemaName}.${row.relationName}`;
    const grant = allowedSequences.get(key);
    if (!grant) {
      addViolation(
        "unexpected_sequence_privilege",
        `'${row.identity}' has ${row.privileges.join(", ")} on sequence '${key}', which the runtime privilege contract does not describe`,
      );
      continue;
    }
    const extra = row.privileges.filter(
      (privilege) =>
        !grant.privileges.includes(
          privilege as (typeof grant.privileges)[number],
        ),
    );
    if (extra.length > 0) {
      addViolation(
        "unexpected_sequence_privilege",
        `'${row.identity}' has ${extra.join(", ")} on sequence '${key}' beyond the runtime privilege contract`,
      );
    }
  }

  const schemaUsages = (
    await client.query<{ identity: string; schemaName: string }>(
      `SELECT i.identity::text AS identity, n.nspname AS "schemaName"
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         CROSS JOIN pg_namespace n
        WHERE ${NON_SYSTEM_SCHEMA_PREDICATE}
          AND has_schema_privilege(i.identity, n.oid, 'USAGE')`,
    )
  ).rows;
  for (const usage of schemaUsages) {
    if (!allowedSchemas.has(usage.schemaName)) {
      addViolation(
        "unexpected_schema_privilege",
        `'${usage.identity}' has USAGE on schema '${usage.schemaName}', which the runtime privilege contract does not describe`,
      );
    }
  }

  const executableFunctions = (
    await client.query<{
      identity: string;
      schemaName: string;
      functionName: string;
      identityArguments: string;
    }>(
      `SELECT i.identity::text AS identity,
              n.nspname AS "schemaName",
              p.proname AS "functionName",
              pg_get_function_identity_arguments(p.oid) AS "identityArguments"
         FROM unnest(ARRAY[current_user, session_user]) AS i(identity)
         CROSS JOIN pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE ${NON_SYSTEM_SCHEMA_PREDICATE}
          AND p.prokind IN ('f', 'p')
          AND p.prorettype <> 'trigger'::regtype
          AND NOT EXISTS (
            SELECT 1
              FROM pg_depend d
             WHERE d.classid = 'pg_proc'::regclass
               AND d.objid = p.oid
               AND d.deptype = 'e'
          )
          AND has_function_privilege(i.identity, p.oid, 'EXECUTE')
        GROUP BY i.identity, n.nspname, p.proname,
                 pg_get_function_identity_arguments(p.oid)`,
    )
  ).rows;
  for (const executable of executableFunctions) {
    const key = `${executable.schemaName}.${executable.functionName}(${executable.identityArguments})`;
    if (!allowedFunctions.has(key)) {
      addViolation(
        "unexpected_function_execute",
        `'${executable.identity}' can execute '${key}', which the runtime privilege contract does not describe`,
      );
    }
  }

  for (const grant of contract.functions) {
    const definition = (
      await client.query<{ present: boolean }>(
        `SELECT true AS present
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = $1
            AND p.proname = $2
            AND p.prokind IN ('f', 'p')
            AND pg_get_function_identity_arguments(p.oid) = $3
          LIMIT 1`,
        [grant.schema, grant.name, grant.identityArguments],
      )
    ).rows[0];
    if (!definition?.present) {
      addViolation(
        "contract_function_missing",
        `the runtime privilege contract authorizes '${grant.schema}.${grant.name}(${grant.identityArguments})', but no such function definition exists`,
      );
    }
  }
}
