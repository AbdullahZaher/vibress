#!/usr/bin/env tsx
/**
 * Provisions the two least-privilege platform serving roles:
 * - the tenant runtime role (RLS-bound DML, no registry or membership access);
 * - the membership-directory reader (SELECT on platform_memberships only).
 *
 * Run after migrations, as the database owner. It never prints passwords.
 * The reference app only asserts these roles at boot; it does not create them.
 */
import { Client } from "pg";
import {
  provisionPlatformMembershipReaderRole,
  provisionPlatformRuntimeRole,
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
  if (runtime.roleName === reader.roleName) {
    throw new Error(
      "Runtime and membership-reader roles must have different names",
    );
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const identity = (
      await client.query<{ current_user: string }>("SELECT current_user")
    ).rows[0]?.current_user;
    console.log(
      `Provisioning platform roles as '${identity}' (runtime: ${runtime.roleName}, reader: ${reader.roleName})`,
    );

    await provisionPlatformRuntimeRole(client, runtime);
    await provisionPlatformMembershipReaderRole(client, reader);

    const roles = await client.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
        WHERE rolname = ANY($1) ORDER BY rolname`,
      [[runtime.roleName, reader.roleName]],
    );
    for (const role of roles.rows) {
      if (role.rolsuper || role.rolbypassrls) {
        throw new Error(
          `Role '${role.rolname}' is privileged after provisioning; refusing to report success`,
        );
      }
    }
    if (roles.rows.length !== 2) {
      throw new Error("Expected exactly two provisioned roles");
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
