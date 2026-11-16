import type { ClientBase } from "pg";
import {
  assertSafePlatformRuntimeRole,
  type RuntimeRoleAttributes,
} from "./platform-runtime-role";

export interface PlatformDeploymentVerifierConfig {
  roleName: string;
  password: string;
}

const ROLE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export function readPlatformDeploymentVerifierConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlatformDeploymentVerifierConfig | null {
  const password = env.POSTGRES_PLATFORM_VERIFIER_PASSWORD?.trim();
  if (!password) {
    return null;
  }
  const roleName =
    env.POSTGRES_PLATFORM_VERIFIER_USER?.trim() ||
    "vibress_platform_verifier";
  if (!ROLE_NAME_PATTERN.test(roleName)) {
    throw new Error(
      "POSTGRES_PLATFORM_VERIFIER_USER must be lowercase letters, digits, and underscores (max 63 chars)",
    );
  }
  return { roleName, password };
}

/**
 * Creates the read-only role used once at serving startup to verify the
 * provisioned application and installation identity.
 *
 * It holds SELECT on the two deployment registry relations and nothing else:
 * no mutation, no tenant data, no membership directory, no functions and no
 * schema CREATE. The operator provisioning process is the only writer.
 */
export async function provisionPlatformDeploymentVerifierRole(
  client: ClientBase,
  { roleName, password }: PlatformDeploymentVerifierConfig,
): Promise<void> {
  if (typeof roleName !== "string" || !ROLE_NAME_PATTERN.test(roleName)) {
    throw new Error("Invalid platform deployment verifier role name");
  }
  if (!password) {
    throw new Error("Platform deployment verifier password must not be empty");
  }

  const current = await client.query<{ current_user: string }>(
    "SELECT current_user",
  );
  if (current.rows[0]?.current_user === roleName) {
    throw new Error(
      "POSTGRES_PLATFORM_VERIFIER_USER must differ from the migration/owner role",
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
      "Refusing to manage an existing superuser as the platform deployment verifier",
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

  for (const table of [
    "platform_installations",
    "platform_application_registrations",
  ]) {
    const present = await client.query<{ present: boolean }>(
      "SELECT to_regclass($1) IS NOT NULL AS present",
      [`public.${table}`],
    );
    if (!present.rows[0]?.present) {
      throw new Error(
        `public.${table} does not exist; apply the platform migrations before provisioning the verifier role`,
      );
    }
  }

  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await client.query(`REVOKE CREATE ON SCHEMA public FROM ${role}`);

  await client.query(
    `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role}`,
  );
  await client.query(
    `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
  );
  await client.query(
    `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM ${role}`,
  );
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
    `GRANT SELECT ON TABLE public.platform_installations TO ${role}`,
  );
  await client.query(
    `GRANT SELECT ON TABLE public.platform_application_registrations TO ${role}`,
  );
}

export async function assertSafePlatformDeploymentVerifierRole(client: {
  query: <TRow = unknown>(
    sql: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: TRow[] }>;
}): Promise<RuntimeRoleAttributes> {
  return assertSafePlatformRuntimeRole(client, {
    profile: "deployment_verifier",
  });
}
