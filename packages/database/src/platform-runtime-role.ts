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
}

export class UnsafePlatformRuntimeRoleError extends Error {
  readonly attributes: Partial<RuntimeRoleAttributes> | undefined;

  constructor(reason: string, attributes?: Partial<RuntimeRoleAttributes>) {
    super(`Unsafe platform runtime role: ${reason}`);
    this.name = "UnsafePlatformRuntimeRoleError";
    this.attributes = attributes;
  }
}

/**
 * Validates that the active PostgreSQL connection has verified non-owner,
 * least-privilege runtime credentials suitable for serving tenant-bound traffic:
 * - not a superuser (rolsuper = false);
 * - cannot bypass row-level security (rolbypassrls = false);
 * - does not own tenant-isolated or registry tables.
 */
export async function assertSafePlatformRuntimeRole(
  client: { query: <TRow = unknown>(sql: string, params?: readonly unknown[]) => Promise<{ rows: TRow[] }> },
): Promise<RuntimeRoleAttributes> {
  const roleRow = (
    await client.query<RuntimeRoleAttributes>(
      `SELECT current_user AS "currentUser",
              session_user AS "sessionUser",
              r.rolsuper AS "isSuperuser",
              r.rolbypassrls AS "isBypassRls"
         FROM pg_roles r
        WHERE r.rolname = current_user`,
    )
  ).rows[0];

  if (!roleRow) {
    throw new UnsafePlatformRuntimeRoleError("unable to resolve current_user in pg_roles");
  }

  if (roleRow.isSuperuser) {
    throw new UnsafePlatformRuntimeRoleError(
      `role '${roleRow.currentUser}' has superuser privileges (rolsuper=true)`,
      roleRow,
    );
  }

  if (roleRow.isBypassRls) {
    throw new UnsafePlatformRuntimeRoleError(
      `role '${roleRow.currentUser}' has bypassrls privilege (rolbypassrls=true)`,
      roleRow,
    );
  }

  // Ensure runtime role does not own any tenant or registry tables
  const ownershipRows = (
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
          AND pg_get_userbyid(c.relowner) = current_user`,
    )
  ).rows;

  if (ownershipRows.length > 0) {
    const tableNames = ownershipRows.map((r) => r.tableName).join(", ");
    throw new UnsafePlatformRuntimeRoleError(
      `role '${roleRow.currentUser}' owns tables: ${tableNames}`,
      roleRow,
    );
  }

  return roleRow;
}

