import type { ClientBase } from "pg";
import {
  assertSafePlatformRuntimeRole,
  type RuntimeRoleAttributes,
} from "./platform-runtime-role";

export interface PlatformMembershipReaderConfig {
  roleName: string;
  password: string;
}

const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export function readPlatformMembershipReaderConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlatformMembershipReaderConfig | null {
  const password = env.POSTGRES_PLATFORM_READER_PASSWORD?.trim();
  if (!password) {
    return null;
  }
  const roleName =
    env.POSTGRES_PLATFORM_READER_USER?.trim() || "vibress_platform_reader";
  if (!ROLE_NAME_PATTERN.test(roleName)) {
    throw new Error(
      "POSTGRES_PLATFORM_READER_USER must be lowercase letters, digits, and underscores (max 63 chars)",
    );
  }
  return { roleName, password };
}

/**
 * Creates the least-privilege role that resolves tenant memberships.
 *
 * The resolver runs before a verified tenant scope exists, so this role is
 * kept strictly narrower than the runtime role: SELECT on
 * `platform_memberships` and nothing else. Registry, tenant, CMS tables,
 * sequences and functions are denied. It is a non-owner with NOBYPASSRLS, so
 * it cannot be used to serve tenant-owned traffic.
 */
export async function provisionPlatformMembershipReaderRole(
  client: ClientBase,
  { roleName, password }: PlatformMembershipReaderConfig,
): Promise<void> {
  if (typeof roleName !== "string" || !ROLE_NAME_PATTERN.test(roleName)) {
    throw new Error("Invalid platform membership reader role name");
  }
  if (!password) {
    throw new Error("Platform membership reader password must not be empty");
  }

  const current = await client.query<{ current_user: string }>(
    "SELECT current_user",
  );
  if (current.rows[0]?.current_user === roleName) {
    throw new Error(
      "POSTGRES_PLATFORM_READER_USER must differ from the migration/owner role",
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
      "Refusing to manage an existing superuser as the platform membership reader",
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

  const databaseName = (
    await client.query<{ name: string }>(
      "SELECT current_database() AS name",
    )
  ).rows[0]?.name;
  if (!databaseName) {
    throw new Error("Unable to resolve the current database");
  }
  const database = client.escapeIdentifier(databaseName);

  const membershipTable = await client.query<{ present: boolean }>(
    "SELECT to_regclass('public.platform_memberships') IS NOT NULL AS present",
  );
  if (!membershipTable.rows[0]?.present) {
    throw new Error(
      "platform_memberships does not exist; apply the platform migrations before provisioning the reader role",
    );
  }

  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  // The reader must never create objects, even in its own schema.
  await client.query(`REVOKE CREATE ON SCHEMA public FROM ${role}`);

  // Clean up any previous grants before narrowing to a single SELECT.
  await client.query(
    `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role}`,
  );
  await client.query(
    `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
  );
  await client.query(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM ${role}`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${role}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${role}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM ${role}`,
  );

  await client.query(
    `GRANT SELECT ON TABLE public.platform_memberships TO ${role}`,
  );
}

/**
 * Boot-time assertion for the membership reader connection. Fails closed when
 * the reader holds anything other than table-level SELECT on
 * `platform_memberships`, or inherits a privileged identity.
 */
export async function assertSafePlatformMembershipReaderRole(client: {
  query: <TRow = unknown>(
    sql: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: TRow[] }>;
}): Promise<RuntimeRoleAttributes> {
  return assertSafePlatformRuntimeRole(client, {
    profile: "membership_reader",
  });
}
