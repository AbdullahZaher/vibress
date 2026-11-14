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
