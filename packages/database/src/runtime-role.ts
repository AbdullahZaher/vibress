import type { ClientBase } from "pg";

export interface RuntimeRoleConfig {
  roleName: string;
  password: string;
}

const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export function readRuntimeRoleConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeRoleConfig | null {
  const password = env.POSTGRES_APP_PASSWORD?.trim();
  if (!password) {
    return null;
  }
  const roleName = env.POSTGRES_APP_USER?.trim() || "vibress_app";
  if (!ROLE_NAME_PATTERN.test(roleName)) {
    throw new Error(
      "POSTGRES_APP_USER must be lowercase letters, digits, and underscores (max 63 chars)",
    );
  }
  return { roleName, password };
}

/**
 * Creates or refreshes the least-privilege runtime role used by api/worker.
 *
 * The role may run DML on core tables and create the operator-approved plugin
 * storage tables the runtime provisions on demand. Core objects stay owned by
 * the migration role, so the runtime cannot ALTER, DROP, or TRUNCATE them.
 */
export async function provisionRuntimeRole(
  client: ClientBase,
  { roleName, password }: RuntimeRoleConfig,
): Promise<void> {
  if (typeof roleName !== "string" || !ROLE_NAME_PATTERN.test(roleName)) {
    throw new Error("Invalid runtime role name");
  }
  if (!password) {
    throw new Error("Runtime role password must not be empty");
  }

  const current = await client.query<{ current_user: string }>(
    "SELECT current_user",
  );
  if (current.rows[0]?.current_user === roleName) {
    throw new Error(
      "POSTGRES_APP_USER must differ from the migration/owner role",
    );
  }

  const role = client.escapeIdentifier(roleName);
  const quotedPassword = client.escapeLiteral(password);

  const existing = await client.query<{ rolsuper: boolean }>(
    "SELECT rolsuper FROM pg_roles WHERE rolname = $1",
    [roleName],
  );
  if (existing.rows[0]?.rolsuper) {
    // Demoting an unrelated existing superuser would be destructive.
    throw new Error("Refusing to manage an existing superuser as the runtime role");
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
  // CREATE is limited to the public schema and is required for plugin storage
  // tables, which the runtime creates on demand from operator-approved models.
  await client.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${role}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
  );
  await client.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
  );
  await client.query(
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${role}`,
  );
}
