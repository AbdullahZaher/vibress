#!/usr/bin/env tsx
/**
 * Provisions the three least-privilege platform serving roles:
 * - the tenant runtime role (RLS-bound DML, no registry or membership access);
 * - the membership-directory reader (SELECT on platform_memberships only);
 * - the deployment verifier (SELECT on installations and registrations only).
 *
 * Run after migrations, as the database owner. It never prints passwords.
 * The reference app only asserts these roles at boot; it does not create them.
 */
import { Client } from "pg";
import {
  provisionPlatformDeploymentVerifierRole,
  provisionPlatformMembershipReaderRole,
  provisionPlatformRuntimeRole,
  readPlatformDeploymentVerifierConfig,
  readPlatformMembershipReaderConfig,
  readPlatformRuntimeRoleConfig,
} from "@vibress/database";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const runtime = readPlatformRuntimeRoleConfig();
  const reader = readPlatformMembershipReaderConfig();
  const verifier = readPlatformDeploymentVerifierConfig();
  if (!runtime) {
    throw new Error(
      "POSTGRES_PLATFORM_APP_PASSWORD is required (and POSTGRES_PLATFORM_APP_USER if not vibress_platform_app)",
    );
  }
  if (!reader) {
    throw new Error(
      "POSTGRES_PLATFORM_READER_PASSWORD is required (and POSTGRES_PLATFORM_READER_USER if not vibress_platform_reader)",
    );
  }
  if (!verifier) {
    throw new Error(
      "POSTGRES_PLATFORM_VERIFIER_PASSWORD is required (and POSTGRES_PLATFORM_VERIFIER_USER if not vibress_platform_verifier)",
    );
  }
  if (
    new Set([runtime.roleName, reader.roleName, verifier.roleName]).size !== 3
  ) {
    throw new Error(
      "Runtime, membership-reader and deployment-verifier roles must have different names",
    );
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const identity = (
      await client.query<{ current_user: string }>("SELECT current_user")
    ).rows[0]?.current_user;
    console.log(
      `Provisioning platform roles as '${identity}' (runtime: ${runtime.roleName}, reader: ${reader.roleName}, verifier: ${verifier.roleName})`,
    );

    await provisionPlatformRuntimeRole(client, runtime);
    await provisionPlatformMembershipReaderRole(client, reader);
    await provisionPlatformDeploymentVerifierRole(client, verifier);

    const roles = await client.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
        WHERE rolname = ANY($1) ORDER BY rolname`,
      [[runtime.roleName, reader.roleName, verifier.roleName]],
    );
    for (const role of roles.rows) {
      if (role.rolsuper || role.rolbypassrls) {
        throw new Error(
          `Role '${role.rolname}' is privileged after provisioning; refusing to report success`,
        );
      }
    }
    if (roles.rows.length !== 3) {
      throw new Error("Expected exactly three provisioned roles");
    }
    console.log(
      "Platform roles provisioned; connect as them to run the boot assertions.",
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    "[provision-platform-roles] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
