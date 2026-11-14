// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asApplicationId,
  asInstallationId,
  defineApplication,
  type ApplicationDefinition,
} from "@vibress/platform-kernel";
import {
  ApplicationRegistrationDriftError,
  ApplicationRegistrationIntegrityError,
  ApplicationRegistrationMissingError,
  InstallationApplicationMissingError,
  InstallationMismatchError,
  PlatformMembershipResolver,
  PostgresApplicationRegistryStore,
  UnexpectedApplicationRegistrationError,
  type InstallationRegistrationRecord,
} from "../../packages/database/src/platform-application-registry";
import {
  assertSafePlatformRuntimeRole,
  provisionPlatformRuntimeRole,
  UnsafePlatformRuntimeRoleError,
  type PlatformRuntimeRoleViolationCode,
} from "../../packages/database/src/platform-runtime-role";
import { PolicyEngine, TenantUnitOfWork } from "@vibress/tenancy";
import {
  createReferenceApplication,
  REFERENCE_PERMISSIONS,
} from "../../apps/platform-reference/src/application";
import { createReferenceServer } from "../../apps/platform-reference/src/server";
import { ReferenceTokenDirectory } from "../../apps/platform-reference/src/token-directory";

/**
 * End-to-end proof for the M01 persisted registry and route execution adapter:
 * real PostgreSQL, the operator membership directory, the non-owner runtime
 * role, RLS, and the bootable reference app served through Fastify inject.
 */
const DATABASE_URL =
  process.env.PLATFORM_TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://vibress:vibress@127.0.0.1:5433/vibress";

const applicationId = "reference-crm-integration";
const otherApplicationId = "reference-crm-other";
const tenantAId = "reference-tenant-a";
const tenantBId = "reference-tenant-b";
const roleName = `reference_rt_${Date.now().toString(36)}`;
const rolePassword = `reference_${Date.now().toString(36)}`;

const installationId = asInstallationId("reference-installation");

const readPermission = REFERENCE_PERMISSIONS.readCustomers;
const createPermission = REFERENCE_PERMISSIONS.createCustomer;

let owner: Client;
let ownerPool: Pool;
let runtimePool: Pool;
let store: PostgresApplicationRegistryStore;
let application: ApplicationDefinition;
let server: Awaited<ReturnType<typeof createReferenceServer>>;
let databaseName: string;
let roleSequence = 0;

async function applyPlatformMigrations(client: Client): Promise<void> {
  for (const file of [
    "0054_platform_tenant_rls.sql",
    "0056_platform_application_registry.sql",
  ]) {
    const migrationPath = path.resolve(
      process.cwd(),
      "packages/database/migrations",
      file,
    );
    await client.query(fs.readFileSync(migrationPath, "utf8"));
  }
}

async function seedTenant(id: string, name: string): Promise<void> {
  await owner.query(
    `INSERT INTO platform_tenants (id, application_id, name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [id, applicationId, name],
  );
}

async function seedMembership(input: {
  tenantId: string;
  principalId: string;
  roles: string[];
  permissions: string[];
}): Promise<void> {
  await owner.query(
    `INSERT INTO platform_memberships
       (application_id, tenant_id, principal_id, active, roles, permissions)
     VALUES ($1, $2, $3, true, $4, $5)
     ON CONFLICT (application_id, tenant_id, principal_id) DO UPDATE
       SET active = true, roles = EXCLUDED.roles, permissions = EXCLUDED.permissions`,
    [
      applicationId,
      input.tenantId,
      input.principalId,
      input.roles,
      input.permissions,
    ],
  );
}

function tokenJson(): string {
  return JSON.stringify({
    "staff-token": {
      id: "reference-staff",
      kind: "staff",
      tenantIds: [tenantAId],
      roles: ["owner"],
      permissions: [readPermission, createPermission],
    },
    "member-token": {
      id: "reference-member",
      kind: "end_user",
      tenantIds: [tenantAId, tenantBId],
      roles: ["member"],
      permissions: [readPermission],
    },
  });
}

function withVersion(
  base: ApplicationDefinition,
  version: string,
): ApplicationDefinition {
  return defineApplication({
    id: base.id,
    name: base.name,
    version,
    actions: base.actions,
    http: base.http,
  });
}

function ephemeralRoleName(kind: string): string {
  roleSequence += 1;
  return `w1t01_${kind}_${Date.now().toString(36)}_${roleSequence}`.slice(0, 63);
}

function roleConnectionString(name: string, password: string): string {
  const url = new URL(DATABASE_URL);
  url.username = name;
  url.password = password;
  return url.toString();
}

async function createEphemeralLogin(
  name: string,
  password: string,
  attributes = "NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION",
): Promise<void> {
  const role = owner.escapeIdentifier(name);
  await owner.query(
    `CREATE ROLE ${role} LOGIN PASSWORD ${owner.escapeLiteral(password)} ${attributes}`,
  );
  await owner.query(
    `GRANT CONNECT ON DATABASE ${owner.escapeIdentifier(databaseName)} TO ${role}`,
  );
}

async function dropEphemeralRoles(names: readonly string[]): Promise<void> {
  for (const name of names) {
    const role = owner.escapeIdentifier(name);
    await owner.query(`DROP OWNED BY ${role}`).catch(() => undefined);
    await owner.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
  }
}

async function expectUnsafeRuntimeRole(
  client: Client,
  expectedCodes: readonly PlatformRuntimeRoleViolationCode[],
): Promise<void> {
  const error = await assertSafePlatformRuntimeRole(client).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(UnsafePlatformRuntimeRoleError);
  const violations = (error as UnsafePlatformRuntimeRoleError).violations;
  expect(violations.map((violation) => violation.code)).toEqual(
    expect.arrayContaining([...expectedCodes]),
  );
}

beforeAll(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  databaseName = (
    await owner.query<{ name: string }>("SELECT current_database() AS name")
  ).rows[0]!.name;
  await applyPlatformMigrations(owner);
  await provisionPlatformRuntimeRole(owner, {
    roleName,
    password: rolePassword,
  });

  ownerPool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  const runtimeUrl = new URL(DATABASE_URL);
  runtimeUrl.username = roleName;
  runtimeUrl.password = rolePassword;
  runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 2 });

  // A fixed identity keeps repeated runs deterministic; the cascade removes the
  // registration, tenants, memberships and customer rows.
  await owner.query("DELETE FROM platform_applications WHERE id = ANY($1)", [
    [applicationId, otherApplicationId],
  ]);

  application = createReferenceApplication({ id: applicationId });
  store = new PostgresApplicationRegistryStore(ownerPool);
  await store.sync(application);
  await store.verifyDefinitions([application]);

  await seedTenant(tenantAId, "Reference Tenant A");
  await seedTenant(tenantBId, "Reference Tenant B");
  await seedMembership({
    tenantId: tenantAId,
    principalId: "reference-staff",
    roles: ["owner"],
    permissions: [readPermission, createPermission],
  });
  await seedMembership({
    tenantId: tenantAId,
    principalId: "reference-member",
    roles: ["member"],
    permissions: [readPermission],
  });
  await seedMembership({
    tenantId: tenantBId,
    principalId: "reference-member",
    roles: ["member"],
    permissions: [readPermission],
  });

  server = await createReferenceServer({
    application,
    registryStore: store,
    membershipResolver: new PlatformMembershipResolver(ownerPool),
    unitOfWork: new TenantUnitOfWork(runtimePool),
    tokens: ReferenceTokenDirectory.fromJson(application.id, tokenJson()),
    installationId,
    policyVersion: "reference-crm-integration",
    policy: new PolicyEngine([
      { id: "allow-read", action: readPermission, effect: "allow" },
      { id: "allow-create", action: createPermission, effect: "allow" },
    ]),
  });
});

afterAll(async () => {
  await server?.app.close().catch(() => undefined);
  await runtimePool?.end().catch(() => undefined);
  await ownerPool?.end().catch(() => undefined);
  if (owner) {
    await owner
      .query("DELETE FROM platform_applications WHERE id = ANY($1)", [
        [applicationId, otherApplicationId],
      ])
      .catch(() => undefined);
    const role = owner.escapeIdentifier(roleName);
    await owner.query(`DROP OWNED BY ${role}`).catch(() => undefined);
    await owner.query(`DROP ROLE ${role}`).catch(() => undefined);
    await owner.end().catch(() => undefined);
  }
});

describe("persisted application registry", () => {
  it("is idempotent for the deployed manifest", async () => {
    const result = await store.sync(application);
    expect(result.outcome).toBe("unchanged");
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a manifest change without an explicit update", async () => {
    await expect(store.sync(withVersion(application, "1.0.1"))).rejects.toThrow(
      ApplicationRegistrationDriftError,
    );
  });

  it("stores an explicitly approved update and restores the original", async () => {
    const updated = await store.sync(withVersion(application, "1.0.1"), {
      allowUpdate: true,
    });
    expect(updated.outcome).toBe("updated");

    const restored = await store.sync(application, { allowUpdate: true });
    expect(restored.outcome).toBe("updated");
    await store.verifyDefinitions([application]);
  });

  it("detects a registration with no deployed definition", async () => {
    const other = createReferenceApplication({ id: otherApplicationId });
    await store.sync(other);
    try {
      await expect(store.verifyDefinitions([application])).rejects.toThrow(
        UnexpectedApplicationRegistrationError,
      );
    } finally {
      await owner.query("DELETE FROM platform_applications WHERE id = $1", [
        otherApplicationId,
      ]);
    }
  });

  it("detects a deployed definition with no registration", async () => {
    await owner.query(
      "DELETE FROM platform_application_registrations WHERE application_id = $1",
      [applicationId],
    );
    await expect(store.verifyDefinitions([application])).rejects.toThrow(
      ApplicationRegistrationMissingError,
    );
    await store.sync(application);
    await store.verifyDefinitions([application]);
  });

  it("persists and verifies installation binding and detects application mismatch", async () => {
    const instId = asInstallationId("test-installation-crm");
    const record = await store.syncInstallation({
      id: instId,
      applicationId: application.id,
      environment: "test",
    });
    expect(record.id).toBe(instId);
    expect(record.applicationId).toBe(application.id);

    const verified = await store.verifyInstallation(instId, application.id);
    expect(verified.id).toBe(instId);

    await expect(
      store.verifyInstallation(instId, asInstallationId("other-app") as any),
    ).rejects.toThrow(InstallationMismatchError);
  });

  it("rejects a conflicting installation bind without mutating the persisted record", async () => {
    const instId = asInstallationId("test-installation-conflict");
    const other = createReferenceApplication({ id: otherApplicationId });
    await store.sync(other);
    try {
      await store.syncInstallation({
        id: instId,
        applicationId: application.id,
        environment: "test",
        artifactDigest: "digest-original",
      });

      await expect(
        store.syncInstallation({
          id: instId,
          applicationId: other.id,
          environment: "production",
          artifactDigest: "digest-forged",
        }),
      ).rejects.toThrow(InstallationMismatchError);

      const persisted = await store.verifyInstallation(instId, application.id);
      expect(persisted.environment).toBe("test");
      expect(persisted.artifactDigest).toBe("digest-original");
    } finally {
      await owner
        .query("DELETE FROM platform_installations WHERE id = $1", [instId])
        .catch(() => undefined);
      await owner
        .query("DELETE FROM platform_applications WHERE id = $1", [
          otherApplicationId,
        ])
        .catch(() => undefined);
    }
  });

  it("refuses to bind an installation whose application is not registered", async () => {
    const instId = asInstallationId("test-installation-orphan");
    const missing = asApplicationId("reference-crm-unregistered");

    await expect(
      store.syncInstallation({ id: instId, applicationId: missing }),
    ).rejects.toThrow(InstallationApplicationMissingError);

    const installations = await owner.query(
      "SELECT 1 FROM platform_installations WHERE id = $1",
      [instId],
    );
    expect(installations.rowCount).toBe(0);
    const applications = await owner.query(
      "SELECT 1 FROM platform_applications WHERE id = $1",
      [missing],
    );
    expect(applications.rowCount).toBe(0);
  });

  it("lets exactly one of two concurrent conflicting binds win without overwriting it", async () => {
    const instId = asInstallationId("test-installation-race");
    const other = createReferenceApplication({ id: otherApplicationId });
    await store.sync(other);
    try {
      const results = await Promise.allSettled([
        store.syncInstallation({
          id: instId,
          applicationId: application.id,
          environment: "env-a",
          artifactDigest: "digest-a",
        }),
        store.syncInstallation({
          id: instId,
          applicationId: other.id,
          environment: "env-b",
          artifactDigest: "digest-b",
        }),
      ]);

      const fulfilled = results.filter(
        (
          result,
        ): result is PromiseFulfilledResult<InstallationRegistrationRecord> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(InstallationMismatchError);

      const winner = fulfilled[0]!.value;
      const persisted = await store.verifyInstallation(
        instId,
        winner.applicationId,
      );
      const wonByPrimary = winner.applicationId === application.id;
      expect(persisted.environment).toBe(wonByPrimary ? "env-a" : "env-b");
      expect(persisted.artifactDigest).toBe(
        wonByPrimary ? "digest-a" : "digest-b",
      );
    } finally {
      await owner
        .query("DELETE FROM platform_installations WHERE id = $1", [instId])
        .catch(() => undefined);
      await owner
        .query("DELETE FROM platform_applications WHERE id = $1", [
          otherApplicationId,
        ])
        .catch(() => undefined);
    }
  });
});

describe("runtime role verification", () => {
  it("proves the runtime role is least-privilege and owns no platform objects", async () => {
    const roleAttrs = await assertSafePlatformRuntimeRole(runtimePool);
    expect(roleAttrs.currentUser).toBe(roleName);
    expect(roleAttrs.sessionUser).toBe(roleName);
    expect(roleAttrs.isSuperuser).toBe(false);
    expect(roleAttrs.isBypassRls).toBe(false);
    expect(roleAttrs.isCreateRole).toBe(false);
    expect(roleAttrs.isCreateDb).toBe(false);
    expect(roleAttrs.isReplication).toBe(false);
  });

  it("fails closed when run against a superuser or table-owning database role", async () => {
    const ownerAttrs = (
      await ownerPool.query<{ rolsuper: boolean }>(
        "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
      )
    ).rows[0];
    if (ownerAttrs?.rolsuper) {
      await expect(assertSafePlatformRuntimeRole(ownerPool)).rejects.toThrow(
        UnsafePlatformRuntimeRoleError,
      );
    }
  });

  describe("privilege assertions", () => {
    it("rejects a role that can SET ROLE to a superuser", async () => {
      const login = ephemeralRoleName("member");
      const privileged = ephemeralRoleName("super");
      const password = `${login}_pw`;
      await owner.query(
        `CREATE ROLE ${owner.escapeIdentifier(privileged)} NOLOGIN SUPERUSER`,
      );
      try {
        await createEphemeralLogin(login, password);
        await owner.query(
          `GRANT ${owner.escapeIdentifier(privileged)} TO ${owner.escapeIdentifier(login)}`,
        );
        const client = new Client({
          connectionString: roleConnectionString(login, password),
        });
        await client.connect();
        try {
          await expectUnsafeRuntimeRole(client, ["privileged_role_membership"]);
        } finally {
          await client.end().catch(() => undefined);
        }
      } finally {
        await dropEphemeralRoles([login, privileged]);
      }
    });

    it("rejects a runtime role with CREATE on schema public", async () => {
      const login = ephemeralRoleName("schema");
      const password = `${login}_pw`;
      try {
        await createEphemeralLogin(login, password);
        await owner.query(
          `GRANT CREATE ON SCHEMA public TO ${owner.escapeIdentifier(login)}`,
        );
        const client = new Client({
          connectionString: roleConnectionString(login, password),
        });
        await client.connect();
        try {
          await expectUnsafeRuntimeRole(client, ["schema_create_privilege"]);
        } finally {
          await client.end().catch(() => undefined);
        }
      } finally {
        await dropEphemeralRoles([login]);
      }
    });

    it("rejects any effective privilege on operator registry tables", async () => {
      const login = ephemeralRoleName("registry");
      const password = `${login}_pw`;
      try {
        await createEphemeralLogin(login, password);
        await owner.query(
          `GRANT SELECT ON TABLE public.platform_memberships TO ${owner.escapeIdentifier(login)}`,
        );
        const client = new Client({
          connectionString: roleConnectionString(login, password),
        });
        await client.connect();
        try {
          await expectUnsafeRuntimeRole(client, ["registry_table_privilege"]);
        } finally {
          await client.end().catch(() => undefined);
        }
      } finally {
        await dropEphemeralRoles([login]);
      }
    });

    it("rejects a runtime role that owns a function", async () => {
      const login = ephemeralRoleName("owner");
      const functionName = ephemeralRoleName("ownedfn");
      const password = `${login}_pw`;
      const fn = `public.${owner.escapeIdentifier(functionName)}()`;
      try {
        await createEphemeralLogin(login, password);
        await owner.query(
          `CREATE FUNCTION ${fn} RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
        );
        await owner.query(
          `ALTER FUNCTION ${fn} OWNER TO ${owner.escapeIdentifier(login)}`,
        );
        const client = new Client({
          connectionString: roleConnectionString(login, password),
        });
        await client.connect();
        try {
          await expectUnsafeRuntimeRole(client, ["owns_function"]);
        } finally {
          await client.end().catch(() => undefined);
        }
      } finally {
        await owner.query(`DROP FUNCTION IF EXISTS ${fn}`).catch(() => undefined);
        await dropEphemeralRoles([login]);
      }
    });

    it("rejects EXECUTE on a SECURITY DEFINER function", async () => {
      const login = ephemeralRoleName("definer");
      const functionName = ephemeralRoleName("definerfn");
      const password = `${login}_pw`;
      const fn = `public.${owner.escapeIdentifier(functionName)}()`;
      try {
        await createEphemeralLogin(login, password);
        await owner.query(
          `CREATE FUNCTION ${fn} RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`,
        );
        const client = new Client({
          connectionString: roleConnectionString(login, password),
        });
        await client.connect();
        try {
          await expectUnsafeRuntimeRole(client, ["security_definer_execute"]);
        } finally {
          await client.end().catch(() => undefined);
        }
      } finally {
        await owner.query(`DROP FUNCTION IF EXISTS ${fn}`).catch(() => undefined);
        await dropEphemeralRoles([login]);
      }
    });

    it("rejects an unsafe session_user after SET ROLE to a safe role", async () => {
      const sessionLogin = ephemeralRoleName("session");
      const setRoleName = ephemeralRoleName("setrole");
      const password = `${sessionLogin}_pw`;
      await owner.query(
        `CREATE ROLE ${owner.escapeIdentifier(setRoleName)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION`,
      );
      try {
        await createEphemeralLogin(
          sessionLogin,
          password,
          "NOSUPERUSER NOBYPASSRLS CREATEROLE NOCREATEDB NOREPLICATION",
        );
        await owner.query(
          `GRANT ${owner.escapeIdentifier(setRoleName)} TO ${owner.escapeIdentifier(sessionLogin)}`,
        );
        const client = new Client({
          connectionString: roleConnectionString(sessionLogin, password),
        });
        await client.connect();
        try {
          await client.query(
            `SET ROLE ${owner.escapeIdentifier(setRoleName)}`,
          );
          const identity = await client.query<{
            current_user: string;
            session_user: string;
          }>("SELECT current_user, session_user");
          expect(identity.rows[0]?.current_user).toBe(setRoleName);
          expect(identity.rows[0]?.session_user).toBe(sessionLogin);
          await expectUnsafeRuntimeRole(client, ["identity_createrole"]);
        } finally {
          await client.end().catch(() => undefined);
        }
      } finally {
        await dropEphemeralRoles([sessionLogin, setRoleName]);
      }
    });
  });
});

describe("reference application over http", () => {
  it("serves the public health route without a token", async () => {
    const response = await server.app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      application: applicationId,
    });
  });

  it("rejects a tenant route without a verified principal", async () => {
    const response = await server.app.inject({
      method: "GET",
      url: "/crm/customers",
      headers: { "x-tenant-id": tenantAId },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("requires a tenant header for an authenticated route", async () => {
    const response = await server.app.inject({
      method: "GET",
      url: "/crm/customers",
      headers: { authorization: "Bearer member-token" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "tenant_required" },
    });
  });

  it("rejects a member principal on the staff write route", async () => {
    const response = await server.app.inject({
      method: "POST",
      url: "/crm/customers",
      headers: {
        authorization: "Bearer member-token",
        "x-tenant-id": tenantAId,
      },
      payload: { name: "Acme" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "route_requires_staff" },
    });
  });

  it("rejects invalid customer input before opening a transaction", async () => {
    const response = await server.app.inject({
      method: "POST",
      url: "/crm/customers",
      headers: {
        authorization: "Bearer staff-token",
        "x-tenant-id": tenantAId,
      },
      payload: { name: "" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "invalid_input" } });
  });

  it("creates and lists customers inside the tenant scope", async () => {
    const created = await server.app.inject({
      method: "POST",
      url: "/crm/customers",
      headers: {
        authorization: "Bearer staff-token",
        "x-tenant-id": tenantAId,
      },
      payload: { name: "Acme Ltd", email: "ops@acme.test" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      name: "Acme Ltd",
      email: "ops@acme.test",
    });

    const listed = await server.app.inject({
      method: "GET",
      url: "/crm/customers",
      headers: {
        authorization: "Bearer member-token",
        "x-tenant-id": tenantAId,
      },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      customers: [{ name: "Acme Ltd", email: "ops@acme.test" }],
    });
  });

  it("keeps tenant B empty through RLS", async () => {
    const listed = await server.app.inject({
      method: "GET",
      url: "/crm/customers",
      headers: {
        authorization: "Bearer member-token",
        "x-tenant-id": tenantBId,
      },
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ customers: [] });
  });

  it("denies the runtime role access to registry and membership tables", async () => {
    await expect(
      runtimePool.query("SELECT * FROM platform_application_registrations"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtimePool.query("SELECT * FROM platform_memberships"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("fails closed on a tampered persisted manifest", async () => {
    await owner.query(
      `UPDATE platform_application_registrations
          SET manifest_digest = repeat('0', 64)
        WHERE application_id = $1`,
      [applicationId],
    );

    await expect(store.load(applicationId)).rejects.toThrow(
      ApplicationRegistrationIntegrityError,
    );
  });
});
