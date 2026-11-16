// @vitest-environment node
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  provisionPlatformRuntimeRole,
} from "../../packages/database/src/platform-runtime-role";
import {
  provisionPlatformMembershipReaderRole,
} from "../../packages/database/src/platform-membership-reader";
import {
  provisionPlatformDeploymentVerifierRole,
} from "../../packages/database/src/platform-deployment-verifier";
import { REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT } from "../../packages/database/src/platform-runtime-privilege-contract";

/**
 * Production-shaped identity separation (directive section 5) on the dev
 * fixture: throwaway login roles only, no data or grant changes that survive the
 * run. Each serving identity is provisioned by the real code paths and then
 * exercised against its own deny matrix. The migration/owner role here is the
 * dev superuser; the non-superuser owner proof lives in
 * `platform-installation-isolation.test.ts`, and the deployment blocker (dev
 * owner is a superuser) stays recorded in the program status.
 */
const DATABASE_URL =
  process.env.PLATFORM_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5433/vibress";

const suffix = Date.now().toString(36);
const applicationId = `topo-app-${suffix}`;
const tenantId = `topo-tenant-${suffix}`;
const customerId = `topo-customer-${suffix}`;
const runtimeRole = `topo_rt_${suffix}`;
const readerRole = `topo_reader_${suffix}`;
const verifierRole = `topo_verifier_${suffix}`;
const runtimePassword = `rt_${suffix}`;
const readerPassword = `reader_${suffix}`;
const verifierPassword = `verifier_${suffix}`;

function urlFor(role: string, password: string): string {
  const url = new URL(DATABASE_URL);
  url.username = role;
  url.password = password;
  return url.toString();
}

let owner: Client;
let runtime: Client;
let reader: Client;
let verifier: Client;
let ownerRoleName: string;

beforeAll(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  ownerRoleName = (
    await owner.query<{ current_user: string }>("SELECT current_user")
  ).rows[0]!.current_user;

  await provisionPlatformRuntimeRole(
    owner,
    { roleName: runtimeRole, password: runtimePassword },
    REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
  );
  await provisionPlatformMembershipReaderRole(owner, {
    roleName: readerRole,
    password: readerPassword,
  });
  await provisionPlatformDeploymentVerifierRole(owner, {
    roleName: verifierRole,
    password: verifierPassword,
  });

  await owner.query(
    `INSERT INTO platform_applications (id, name) VALUES ($1, $2)`,
    [applicationId, "Topology probe application"],
  );
  await owner.query(
    `INSERT INTO platform_tenants (id, application_id, name) VALUES ($1, $2, $3)`,
    [tenantId, applicationId, "Topology probe tenant"],
  );
  await owner.query("BEGIN");
  try {
    await owner.query(
      `SELECT set_config('vibress.application_id', $1, true),
              set_config('vibress.tenant_id', $2, true)`,
      [applicationId, tenantId],
    );
    await owner.query(
      `INSERT INTO platform_crm_customers (id, application_id, tenant_id, name)
       VALUES ($1, $2, $3, 'Topology probe customer')`,
      [customerId, applicationId, tenantId],
    );
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => undefined);
    throw error;
  }

  runtime = new Client({
    connectionString: urlFor(runtimeRole, runtimePassword),
  });
  reader = new Client({ connectionString: urlFor(readerRole, readerPassword) });
  verifier = new Client({
    connectionString: urlFor(verifierRole, verifierPassword),
  });
  await runtime.connect();
  await reader.connect();
  await verifier.connect();
});

afterAll(async () => {
  await runtime?.end().catch(() => undefined);
  await reader?.end().catch(() => undefined);
  await verifier?.end().catch(() => undefined);
  if (owner) {
    await owner
      .query("DELETE FROM platform_applications WHERE id = $1", [applicationId])
      .catch(() => undefined);
    for (const role of [runtimeRole, readerRole, verifierRole]) {
      const roleIdent = owner.escapeIdentifier(role);
      await owner.query(`DROP OWNED BY ${roleIdent}`).catch(() => undefined);
      await owner.query(`DROP ROLE IF EXISTS ${roleIdent}`).catch(() => undefined);
    }
    await owner.end().catch(() => undefined);
  }
});

describe("serving identity attributes", () => {
  it("provisions three distinct non-superuser NOBYPASSRLS logins", async () => {
    const roles = await owner.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
         FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
      [[runtimeRole, readerRole, verifierRole]],
    );
    expect(roles.rows).toHaveLength(3);
    expect(new Set(roles.rows.map((row) => row.rolname)).size).toBe(3);
    for (const row of roles.rows) {
      expect(row).toMatchObject({
        rolsuper: false,
        rolbypassrls: false,
        rolcanlogin: true,
      });
    }
  });

  it("grants no serving role membership in any other role", async () => {
    const memberships = await owner.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.member
        WHERE r.rolname = ANY($1)`,
      [[runtimeRole, readerRole, verifierRole]],
    );
    expect(memberships.rows[0]?.count).toBe("0");
  });

  it("never lets a serving identity adopt the migration/owner role", async () => {
    const identities = await Promise.all(
      [runtime, reader, verifier].map(async (client) => {
        const result = await client.query<{ current_user: string }>(
          "SELECT current_user",
        );
        return result.rows[0]?.current_user;
      }),
    );
    expect(identities).toEqual([runtimeRole, readerRole, verifierRole]);
  });
});

describe("tenant ownership and row-level security", () => {
  it("keeps tenant tables owned by the migration role with FORCE RLS", async () => {
    const result = await owner.query<{
      owner: string;
      rls: boolean;
      force: boolean;
    }>(
      `SELECT pg_get_userbyid(c.relowner) AS owner,
              c.relrowsecurity AS rls,
              c.relforcerowsecurity AS force
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'platform_crm_customers'`,
    );
    expect(result.rows[0]).toEqual({
      owner: ownerRoleName,
      rls: true,
      force: true,
    });
  });

  it("hides tenant rows from the runtime role without scope and shows only the scoped tenant with it", async () => {
    const unscoped = await runtime.query(
      "SELECT id FROM platform_crm_customers",
    );
    expect(unscoped.rowCount).toBe(0);

    await runtime.query("BEGIN");
    try {
      await runtime.query(
        `SELECT set_config('vibress.application_id', $1, true),
                set_config('vibress.tenant_id', $2, true)`,
        [applicationId, tenantId],
      );
      const scoped = await runtime.query<{ id: string }>(
        "SELECT id FROM platform_crm_customers",
      );
      expect(scoped.rows.map((row) => row.id)).toContain(customerId);
    } finally {
      await runtime.query("ROLLBACK");
    }
  });
});

describe("identity deny matrix", () => {
  const denied = { code: "42501" } as const;

  it("denies the runtime role every operator and directory relation", async () => {
    for (const statement of [
      "SELECT id FROM platform_applications",
      "SELECT id FROM platform_installations",
      "SELECT application_id FROM platform_application_registrations",
      "SELECT id FROM platform_application_registry_changes",
      "SELECT application_id FROM platform_memberships",
      "CREATE TABLE public.topology_probe (id text)",
      "INSERT INTO platform_installations (id, application_id, environment) VALUES ('x', 'y', 'prod')",
    ]) {
      await expect(runtime.query(statement)).rejects.toMatchObject(denied);
    }
  });

  it("keeps the membership reader SELECT-only on memberships", async () => {
    await expect(
      reader.query("SELECT application_id FROM platform_memberships"),
    ).resolves.toBeDefined();
    for (const statement of [
      "SELECT id FROM platform_crm_customers",
      "SELECT id FROM platform_installations",
      "SELECT application_id FROM platform_application_registrations",
      "SELECT id FROM platform_application_registry_changes",
      "UPDATE platform_memberships SET active = active",
      "INSERT INTO platform_installations (id, application_id, environment) VALUES ('x', 'y', 'prod')",
    ]) {
      await expect(reader.query(statement)).rejects.toMatchObject(denied);
    }
  });

  it("keeps the deployment verifier SELECT-only on the registry tables", async () => {
    await expect(
      verifier.query("SELECT id FROM platform_installations"),
    ).resolves.toBeDefined();
    await expect(
      verifier.query("SELECT manifest_digest FROM platform_application_registrations"),
    ).resolves.toBeDefined();
    for (const statement of [
      "SELECT application_id FROM platform_memberships",
      "SELECT id FROM platform_crm_customers",
      "UPDATE platform_installations SET environment = environment",
      "INSERT INTO platform_application_registrations (application_id, version, manifest, manifest_digest) VALUES ('x', '1', '{}', repeat('a', 64))",
    ]) {
      await expect(verifier.query(statement)).rejects.toMatchObject(denied);
    }
  });
});
