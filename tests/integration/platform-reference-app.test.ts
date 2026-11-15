// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Client, Pool, type PoolClient } from "pg";
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
  InstallationChangeInputError,
  InstallationMismatchError,
  InstallationUpdateRequiredError,
  PostgresApplicationRegistryStore,
  RegistryActorRequiredError,
  UnexpectedApplicationRegistrationError,
  type InstallationRegistrationRecord,
  type InstallationUpdateInput,
} from "../../packages/database/src/platform-application-registry";
import {
  assertValidRuntimePrivilegeContract,
  REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
  type PlatformRuntimePrivilegeContract,
  type RuntimeFunctionGrant,
} from "../../packages/database/src/platform-runtime-privilege-contract";
import {
  DeploymentVerificationError,
  verifyDeploymentIdentity,
} from "../../packages/database/src/platform-deployment-verification";
import {
  assertSafePlatformRuntimeRole,
  provisionPlatformRuntimeRole,
  UnsafePlatformRuntimeRoleError,
  type PlatformRuntimeRoleViolationCode,
} from "../../packages/database/src/platform-runtime-role";
import {
  assertSafePlatformMembershipReaderRole,
  provisionPlatformMembershipReaderRole,
} from "../../packages/database/src/platform-membership-reader";
import {
  assertSafePlatformDeploymentVerifierRole,
  provisionPlatformDeploymentVerifierRole,
} from "../../packages/database/src/platform-deployment-verifier";
import { PolicyEngine } from "@vibress/tenancy";
import {
  createReferenceApplication,
  REFERENCE_PERMISSIONS,
} from "../../apps/platform-reference/src/application";
import {
  startReferenceApplication,
  type StartedReferenceApplication,
} from "../../apps/platform-reference/src/start";
import { provisionReferenceApplication } from "../../apps/platform-reference/src/registration";
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
const auditApplicationId = "reference-crm-audit";
const unauditedApplicationId = "reference-crm-unaudited";
const tenantAId = "reference-tenant-a";
const tenantBId = "reference-tenant-b";
const roleName = `reference_rt_${Date.now().toString(36)}`;
const rolePassword = `reference_${Date.now().toString(36)}`;
const readerRoleName = `reference_rd_${Date.now().toString(36)}`;
const readerRolePassword = `reference_rd_${Date.now().toString(36)}`;
const verifierRoleName = `reference_vf_${Date.now().toString(36)}`;
const verifierRolePassword = `reference_vf_${Date.now().toString(36)}`;
const artifactDigest = "b".repeat(64);

const installationId = asInstallationId("reference-installation");

const readPermission = REFERENCE_PERMISSIONS.readCustomers;
const createPermission = REFERENCE_PERMISSIONS.createCustomer;

let owner: Client;
let ownerPool: Pool;
let verifierPool: Pool;
let readerPool: Pool;
let runtimePool: Pool;
let store: PostgresApplicationRegistryStore;
let application: ApplicationDefinition;
let server: StartedReferenceApplication;
let databaseName: string;
let roleSequence = 0;

async function applyPlatformMigrations(client: Client): Promise<void> {
  for (const file of [
    "0054_platform_tenant_rls.sql",
    "0056_platform_application_registry.sql",
    "0057_platform_registry_change_audit.sql",
    "0058_platform_installation_audit.sql",
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

async function deleteApplications(ids: readonly string[]): Promise<void> {
  await owner.query(
    "DELETE FROM platform_installation_changes WHERE application_id = ANY($1)",
    [ids],
  );
  await owner.query(
    "DELETE FROM platform_installations WHERE application_id = ANY($1)",
    [ids],
  );
  await owner.query(
    "DELETE FROM platform_application_registry_changes WHERE application_id = ANY($1)",
    [ids],
  );
  await owner.query("DELETE FROM platform_applications WHERE id = ANY($1)", [
    ids,
  ]);
}

async function deleteInstallation(id: InstallationRegistrationRecord["id"]): Promise<void> {
  await owner
    .query("DELETE FROM platform_installation_changes WHERE installation_id = $1", [id])
    .catch(() => undefined);
  await owner
    .query("DELETE FROM platform_installations WHERE id = $1", [id])
    .catch(() => undefined);
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
  await expectUnsafeRole(
    () =>
      assertSafePlatformRuntimeRole(client, {
        profile: "runtime",
        privilegeContract: REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
      }),
    expectedCodes,
  );
}

async function expectUnsafeReaderRole(
  client: Client,
  expectedCodes: readonly PlatformRuntimeRoleViolationCode[],
): Promise<void> {
  await expectUnsafeRole(
    () => assertSafePlatformMembershipReaderRole(client),
    expectedCodes,
  );
}

async function expectUnsafeVerifierRole(
  client: Client,
  expectedCodes: readonly PlatformRuntimeRoleViolationCode[],
): Promise<void> {
  await expectUnsafeRole(
    () => assertSafePlatformDeploymentVerifierRole(client),
    expectedCodes,
  );
}

async function expectUnsafeRole(
  assertion: () => Promise<unknown>,
  expectedCodes: readonly PlatformRuntimeRoleViolationCode[],
): Promise<void> {
  const error = await assertion().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(UnsafePlatformRuntimeRoleError);
  const violations = (error as UnsafePlatformRuntimeRoleError).violations;
  expect(violations.map((violation) => violation.code)).toEqual(
    expect.arrayContaining([...expectedCodes]),
  );
}

async function expectUnsafeRuntimeContractGrant(
  setup: (login: string) => Promise<void>,
  cleanup: (login: string) => Promise<void>,
  expectedCodes: readonly PlatformRuntimeRoleViolationCode[],
): Promise<void> {
  const login = ephemeralRoleName("contract");
  const password = `${login}_pw`;
  try {
    await createEphemeralLogin(login, password);
    await setup(login);
    const client = new Client({
      connectionString: roleConnectionString(login, password),
    });
    await client.connect();
    try {
      await expectUnsafeRuntimeRole(client, expectedCodes);
    } finally {
      await client.end().catch(() => undefined);
    }
  } finally {
    await cleanup(login).catch(() => undefined);
    await dropEphemeralRoles([login]);
  }
}

function contractWithFunctions(
  functions: readonly RuntimeFunctionGrant[],
  schemas: readonly string[] = ["public"],
): PlatformRuntimePrivilegeContract {
  return {
    version: 2,
    profile: "function-signature-contract-test",
    schemas,
    relations: [],
    sequences: [],
    functions,
  };
}

async function withContractRuntime<T>(
  contract: PlatformRuntimePrivilegeContract,
  run: (client: Client, login: string) => Promise<T>,
): Promise<T> {
  const login = ephemeralRoleName("fncontract");
  const password = `${login}_pw`;
  try {
    await createEphemeralLogin(login, password);
    await provisionPlatformRuntimeRole(
      owner,
      { roleName: login, password },
      contract,
    );
    const client = new Client({
      connectionString: roleConnectionString(login, password),
    });
    await client.connect();
    try {
      return await run(client, login);
    } finally {
      await client.end().catch(() => undefined);
    }
  } finally {
    await dropEphemeralRoles([login]);
  }
}

type QueryFault = (
  text: string,
  client: PoolClient,
) => Promise<Error | null> | Error | null;

/**
 * Wraps one checked-out owner connection so a named command can fail. The
 * recorded release argument proves whether the implementation destroyed the
 * connection (`true`) or returned it to the pool (`undefined`).
 */
async function faultyOwnerPool(
  fault: QueryFault,
): Promise<{
  pool: Pool;
  releases: Array<boolean | Error | undefined>;
}> {
  const realClient = await ownerPool.connect();
  // A terminated backend emits a transport-level 'error' event on the checked-out
  // client; without a listener pg raises it as an uncaught exception. The
  // awaited query rejection is what the implementation must handle.
  realClient.on("error", () => undefined);
  const releases: Array<boolean | Error | undefined> = [];
  const wrapped = {
    query: async (text: string, values?: unknown[]) => {
      const error = await fault(text, realClient);
      if (error) throw error;
      return (
        realClient.query as unknown as (
          statement: string,
          parameters?: unknown[],
        ) => Promise<unknown>
      )(text, values);
    },
    release: (mode?: boolean | Error) => {
      releases.push(mode);
      realClient.release(mode);
    },
  };
  return {
    pool: { connect: async () => wrapped } as unknown as Pool,
    releases,
  };
}

beforeAll(async () => {
  owner = new Client({ connectionString: DATABASE_URL });
  await owner.connect();
  databaseName = (
    await owner.query<{ name: string }>("SELECT current_database() AS name")
  ).rows[0]!.name;
  await applyPlatformMigrations(owner);
  await provisionPlatformRuntimeRole(
    owner,
    {
      roleName,
      password: rolePassword,
    },
    REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
  );
  await provisionPlatformMembershipReaderRole(owner, {
    roleName: readerRoleName,
    password: readerRolePassword,
  });
  await provisionPlatformDeploymentVerifierRole(owner, {
    roleName: verifierRoleName,
    password: verifierRolePassword,
  });

  ownerPool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  const runtimeUrl = new URL(DATABASE_URL);
  runtimeUrl.username = roleName;
  runtimeUrl.password = rolePassword;
  runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 2 });
  const readerUrl = new URL(DATABASE_URL);
  readerUrl.username = readerRoleName;
  readerUrl.password = readerRolePassword;
  readerPool = new Pool({ connectionString: readerUrl.toString(), max: 2 });
  const verifierUrl = new URL(DATABASE_URL);
  verifierUrl.username = verifierRoleName;
  verifierUrl.password = verifierRolePassword;
  verifierPool = new Pool({ connectionString: verifierUrl.toString(), max: 1 });

  // A fixed identity keeps repeated runs deterministic; the cascade removes the
  // registration, tenants, memberships and customer rows. Audit rows restrict
  // application deletion, so they are removed first by the helper.
  await deleteApplications([
    applicationId,
    otherApplicationId,
    auditApplicationId,
    unauditedApplicationId,
  ]);

  application = createReferenceApplication({ id: applicationId });
  store = new PostgresApplicationRegistryStore(ownerPool);
  await store.sync(application, { actor: "integration-test" });
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

  await provisionReferenceApplication({
    ownerPool,
    application,
    installationId,
    environment: "integration-test",
    artifactDigest,
    actor: "integration-test",
    changeReason: "integration-test boot",
  });

  server = await startReferenceApplication({
    application,
    installationId,
    tokens: ReferenceTokenDirectory.fromJson(application.id, tokenJson()),
    verifierPool,
    readerPool,
    runtimePool,
    environment: "integration-test",
    artifactDigest,
    runtimePrivilegeContract: REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
    host: "127.0.0.1",
    port: 0,
    policyVersion: "reference-crm-integration",
    policy: new PolicyEngine([
      { id: "allow-read", action: readPermission, effect: "allow" },
      { id: "allow-create", action: createPermission, effect: "allow" },
    ]),
  });
});

afterAll(async () => {
  await server?.app.close().catch(() => undefined);
  await verifierPool?.end().catch(() => undefined);
  await readerPool?.end().catch(() => undefined);
  await runtimePool?.end().catch(() => undefined);
  await ownerPool?.end().catch(() => undefined);
  if (owner) {
    await deleteApplications([
      applicationId,
      otherApplicationId,
      auditApplicationId,
      unauditedApplicationId,
    ]).catch(() => undefined);
    for (const name of [roleName, readerRoleName, verifierRoleName]) {
      const role = owner.escapeIdentifier(name);
      await owner.query(`DROP OWNED BY ${role}`).catch(() => undefined);
      await owner.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
    }
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
      actor: "integration-test",
    });
    expect(updated.outcome).toBe("updated");

    const restored = await store.sync(application, {
      allowUpdate: true,
      actor: "integration-test",
    });
    expect(restored.outcome).toBe("updated");
    await store.verifyDefinitions([application]);
  });

  it("detects a registration with no deployed definition", async () => {
    const other = createReferenceApplication({ id: otherApplicationId });
    await store.sync(other, { actor: "integration-test" });
    try {
      await expect(store.verifyDefinitions([application])).rejects.toThrow(
        UnexpectedApplicationRegistrationError,
      );
    } finally {
      await deleteApplications([otherApplicationId]);
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
    await store.sync(application, { actor: "integration-test" });
    await store.verifyDefinitions([application]);
  });

  it("creates an installation, audits it and detects application mismatch", async () => {
    const instId = asInstallationId("test-installation-crm");
    try {
      const record = await store.registerInstallation({
        id: instId,
        applicationId: application.id,
        environment: "test",
        artifactDigest: "digest-original",
        actor: "integration-test",
        reason: "create installation",
        deploymentReference: "release-1",
      });
      expect(record.id).toBe(instId);
      expect(record.applicationId).toBe(application.id);

      const verified = await store.verifyInstallation(instId, application.id);
      expect(verified.id).toBe(instId);

      await expect(
        store.verifyInstallation(instId, asInstallationId("other-app") as any),
      ).rejects.toThrow(InstallationMismatchError);

      const changes = await store.listInstallationChanges(instId);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        changeKind: "created",
        actor: "integration-test",
        reason: "create installation",
        deploymentReference: "release-1",
        previousEnvironment: null,
        newEnvironment: "test",
        previousArtifactDigest: null,
        newArtifactDigest: "digest-original",
      });
    } finally {
      await deleteInstallation(instId);
    }
  });

  it("is idempotent for an identical registration and writes one audit row", async () => {
    const instId = asInstallationId("test-installation-idempotent");
    try {
      const input = {
        id: instId,
        applicationId: application.id,
        environment: "test",
        artifactDigest: "digest-original",
        actor: "integration-test",
        reason: "create installation",
      } as const;
      await store.registerInstallation(input);
      await store.registerInstallation(input);
      expect(await store.listInstallationChanges(instId)).toHaveLength(1);
    } finally {
      await deleteInstallation(instId);
    }
  });

  it("requires an update instead of rewriting existing installation metadata", async () => {
    const instId = asInstallationId("test-installation-update-required");
    try {
      await store.registerInstallation({
        id: instId,
        applicationId: application.id,
        environment: "test",
        artifactDigest: "digest-original",
        actor: "integration-test",
        reason: "create installation",
      });

      await expect(
        store.registerInstallation({
          id: instId,
          applicationId: application.id,
          environment: "production",
          artifactDigest: "digest-new",
          actor: "integration-test",
          reason: "silent rewrite",
        }),
      ).rejects.toThrow(InstallationUpdateRequiredError);

      const persisted = await store.loadInstallation(instId);
      expect(persisted?.environment).toBe("test");
      expect(persisted?.artifactDigest).toBe("digest-original");
    } finally {
      await deleteInstallation(instId);
    }
  });

  it("rejects a conflicting installation bind without mutating the persisted record", async () => {
    const instId = asInstallationId("test-installation-conflict");
    const other = createReferenceApplication({ id: otherApplicationId });
    await store.sync(other, { actor: "integration-test" });
    try {
      await store.registerInstallation({
        id: instId,
        applicationId: application.id,
        environment: "test",
        artifactDigest: "digest-original",
        actor: "integration-test",
        reason: "create installation",
      });

      await expect(
        store.registerInstallation({
          id: instId,
          applicationId: other.id,
          environment: "production",
          artifactDigest: "digest-forged",
          actor: "integration-test",
          reason: "conflicting bind",
        }),
      ).rejects.toThrow(InstallationMismatchError);

      const persisted = await store.verifyInstallation(instId, application.id);
      expect(persisted.environment).toBe("test");
      expect(persisted.artifactDigest).toBe("digest-original");
      expect(await store.listInstallationChanges(instId)).toHaveLength(1);
    } finally {
      await deleteInstallation(instId);
      await deleteApplications([otherApplicationId]).catch(() => undefined);
    }
  });

  it("refuses to bind an installation whose application is not registered", async () => {
    const instId = asInstallationId("test-installation-orphan");
    const missing = asApplicationId("reference-crm-unregistered");

    await expect(
      store.registerInstallation({
        id: instId,
        applicationId: missing,
        environment: "test",
        artifactDigest: null,
        actor: "integration-test",
        reason: "orphan bind",
      }),
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

  it("lets exactly one of two concurrent conflicting creates win without overwriting it", async () => {
    const instId = asInstallationId("test-installation-race");
    const other = createReferenceApplication({ id: otherApplicationId });
    await store.sync(other, { actor: "integration-test" });
    try {
      const results = await Promise.allSettled([
        store.registerInstallation({
          id: instId,
          applicationId: application.id,
          environment: "env-a",
          artifactDigest: "digest-a",
          actor: "integration-test",
          reason: "race a",
        }),
        store.registerInstallation({
          id: instId,
          applicationId: other.id,
          environment: "env-b",
          artifactDigest: "digest-b",
          actor: "integration-test",
          reason: "race b",
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
      await deleteInstallation(instId);
      await deleteApplications([otherApplicationId]).catch(() => undefined);
    }
  });

  it("applies mandatory compare-and-swap to installation updates and audits them", async () => {
    const instId = asInstallationId("test-installation-cas");
    try {
      await store.registerInstallation({
        id: instId,
        applicationId: application.id,
        environment: "staging",
        artifactDigest: "digest-a",
        actor: "integration-test",
        reason: "initial staging deploy",
      });

      const updated = await store.updateInstallation({
        id: instId,
        applicationId: application.id,
        environment: "production",
        artifactDigest: "digest-b",
        actor: "release-operator",
        reason: "promote to production",
        deploymentReference: "release-42",
        expectedEnvironment: "staging",
        expectedArtifactDigest: "digest-a",
      });
      expect(updated.environment).toBe("production");
      expect(updated.artifactDigest).toBe("digest-b");

      await expect(
        store.updateInstallation({
          id: instId,
          applicationId: application.id,
          environment: "staging",
          artifactDigest: "digest-c",
          actor: "release-operator",
          reason: "stale rollback",
          expectedEnvironment: "staging",
          expectedArtifactDigest: "digest-a",
        }),
      ).rejects.toThrow(InstallationMismatchError);

      const persisted = await owner.query<{
        environment: string;
        artifact_digest: string;
      }>(
        `SELECT environment, artifact_digest FROM platform_installations WHERE id = $1`,
        [instId],
      );
      expect(persisted.rows[0]).toEqual({
        environment: "production",
        artifact_digest: "digest-b",
      });

      const changes = await store.listInstallationChanges(instId);
      expect(
        changes.map((change) => [change.changeKind, change.actor]),
      ).toEqual([
        ["created", "integration-test"],
        ["updated", "release-operator"],
      ]);
      expect(changes[1]).toMatchObject({
        previousEnvironment: "staging",
        newEnvironment: "production",
        previousArtifactDigest: "digest-a",
        newArtifactDigest: "digest-b",
        reason: "promote to production",
        deploymentReference: "release-42",
      });
    } finally {
      await deleteInstallation(instId);
    }
  });

  it("rejects installation changes without actor, reason or expected state", async () => {
    const instId = asInstallationId("test-installation-validation");
    try {
      await expect(
        store.registerInstallation({
          id: instId,
          applicationId: application.id,
          environment: "test",
          artifactDigest: null,
          actor: "   ",
          reason: "create installation",
        }),
      ).rejects.toThrow(InstallationChangeInputError);
      await expect(
        store.registerInstallation({
          id: instId,
          applicationId: application.id,
          environment: "test",
          artifactDigest: null,
          actor: "integration-test",
          reason: "",
        }),
      ).rejects.toThrow(InstallationChangeInputError);

      await store.registerInstallation({
        id: instId,
        applicationId: application.id,
        environment: "test",
        artifactDigest: null,
        actor: "integration-test",
        reason: "create installation",
      });

      const missingExpectedDigest: Omit<
        InstallationUpdateInput,
        "expectedArtifactDigest"
      > = {
        id: instId,
        applicationId: application.id,
        environment: "production",
        artifactDigest: "digest-new",
        actor: "integration-test",
        reason: "missing expected artifact",
        expectedEnvironment: "test",
      };
      await expect(
        store.updateInstallation(
          missingExpectedDigest as InstallationUpdateInput,
        ),
      ).rejects.toThrow(InstallationChangeInputError);
      await expect(
        store.updateInstallation({
          id: instId,
          applicationId: application.id,
          environment: "production",
          artifactDigest: "digest-new",
          actor: "integration-test",
          reason: "empty expected environment",
          expectedEnvironment: " ",
          expectedArtifactDigest: null,
        }),
      ).rejects.toThrow(InstallationChangeInputError);
    } finally {
      await deleteInstallation(instId);
    }
  });

  it("rejects an installation update against another application", async () => {
    const instId = asInstallationId("test-installation-owner");
    try {
      await store.registerInstallation({
        id: instId,
        applicationId: application.id,
        environment: "test",
        artifactDigest: "digest-a",
        actor: "integration-test",
        reason: "create installation",
      });
      await expect(
        store.updateInstallation({
          id: instId,
          applicationId: otherApplicationId,
          environment: "production",
          artifactDigest: "digest-b",
          actor: "integration-test",
          reason: "wrong owner",
          expectedEnvironment: "test",
          expectedArtifactDigest: "digest-a",
        }),
      ).rejects.toThrow(InstallationMismatchError);
    } finally {
      await deleteInstallation(instId);
    }
  });

  it("lets exactly one of two concurrent CAS updates win", async () => {
    const instId = asInstallationId("test-installation-update-race");
    try {
      await store.registerInstallation({
        id: instId,
        applicationId: application.id,
        environment: "env-a",
        artifactDigest: "digest-a",
        actor: "integration-test",
        reason: "create installation",
      });

      const results = await Promise.allSettled([
        store.updateInstallation({
          id: instId,
          applicationId: application.id,
          environment: "env-b",
          artifactDigest: "digest-b",
          actor: "release-a",
          reason: "race update a",
          expectedEnvironment: "env-a",
          expectedArtifactDigest: "digest-a",
        }),
        store.updateInstallation({
          id: instId,
          applicationId: application.id,
          environment: "env-c",
          artifactDigest: "digest-c",
          actor: "release-b",
          reason: "race update b",
          expectedEnvironment: "env-a",
          expectedArtifactDigest: "digest-a",
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
      const persisted = await store.loadInstallation(instId);
      expect(persisted?.environment).toBe(winner.environment);
      expect(persisted?.artifactDigest).toBe(winner.artifactDigest);
      expect(await store.listInstallationChanges(instId)).toHaveLength(2);
    } finally {
      await deleteInstallation(instId);
    }
  });
});

describe("atomic provisioning transaction", () => {
  const atomicInstallationId = asInstallationId("reference-atomic-install");
  const initialDigest = "1".repeat(64);
  const nextDigest = "2".repeat(64);

  async function snapshot(): Promise<Record<string, unknown>> {
    const result = await owner.query<Record<string, unknown>>(
      `SELECT
         (SELECT r.version || ':' || r.manifest_digest
            FROM platform_application_registrations r
           WHERE r.application_id = $1) AS registration,
         (SELECT i.environment || ':' || coalesce(i.artifact_digest, '')
            FROM platform_installations i
           WHERE i.id = $2) AS installation,
         (SELECT count(*)::text FROM platform_installation_changes
           WHERE installation_id = $2) AS installation_changes,
         (SELECT count(*)::text FROM platform_application_registry_changes
           WHERE application_id = $1) AS registry_changes`,
      [applicationId, atomicInstallationId],
    );
    return result.rows[0]!;
  }

  async function provision(
    overrides: Partial<Parameters<typeof provisionReferenceApplication>[0]> = {},
  ): Promise<void> {
    await provisionReferenceApplication({
      ownerPool,
      application: createReferenceApplication({ id: applicationId }),
      installationId: atomicInstallationId,
      environment: "staging",
      artifactDigest: initialDigest,
      actor: "release-operator",
      changeReason: "atomic provisioning test",
      ...overrides,
    });
  }

  it("rolls back manifest, installation and both audit streams when the installation CAS fails", async () => {
    await deleteInstallation(atomicInstallationId);
    try {
      await provision();
      const before = await snapshot();
      expect(before).toMatchObject({ installation_changes: "1" });

      await expect(
        provision({
          application: withVersion(
            createReferenceApplication({ id: applicationId }),
            "1.0.1",
          ),
          environment: "production",
          artifactDigest: nextDigest,
          allowRegistryUpdate: true,
          allowInstallationUpdate: true,
          expectedEnvironment: "staging",
          expectedArtifactDigest: "3".repeat(64),
        }),
      ).rejects.toThrow(InstallationMismatchError);

      expect(await snapshot()).toEqual(before);
      const persisted = await store.loadInstallation(atomicInstallationId);
      expect(persisted).toMatchObject({
        environment: "staging",
        artifactDigest: initialDigest,
      });
    } finally {
      await deleteInstallation(atomicInstallationId);
    }
  });

  it("rolls back the installation and manifest when the installation audit insert fails", async () => {
    await deleteInstallation(atomicInstallationId);
    const triggerFunction = ephemeralRoleName("auditfail");
    const triggerName = ephemeralRoleName("auditfail_trg");
    const fn = `public.${owner.escapeIdentifier(triggerFunction)}()`;
    try {
      const before = await snapshot();
      await owner.query(
        `CREATE FUNCTION ${fn} RETURNS trigger LANGUAGE plpgsql AS $$
           BEGIN RAISE EXCEPTION 'forced installation audit failure'; END $$`,
      );
      await owner.query(
        `CREATE TRIGGER ${owner.escapeIdentifier(triggerName)}
           BEFORE INSERT ON platform_installation_changes
           FOR EACH ROW EXECUTE FUNCTION ${fn}`,
      );

      await expect(provision()).rejects.toThrow(
        /forced installation audit failure/,
      );

      expect(await snapshot()).toEqual(before);
      const counts = await owner.query<Record<string, string>>(
        `SELECT
           (SELECT count(*)::text FROM platform_installations WHERE id = $1) AS installations,
           (SELECT count(*)::text FROM platform_installation_changes WHERE installation_id = $1) AS installation_changes`,
        [atomicInstallationId],
      );
      expect(counts.rows[0]).toEqual({
        installations: "0",
        installation_changes: "0",
      });
    } finally {
      await owner
        .query(
          `DROP TRIGGER IF EXISTS ${owner.escapeIdentifier(triggerName)} ON platform_installation_changes`,
        )
        .catch(() => undefined);
      await owner.query(`DROP FUNCTION IF EXISTS ${fn}`).catch(() => undefined);
      await deleteInstallation(atomicInstallationId);
    }
  });

  it("is idempotent when the same deployment is provisioned twice", async () => {
    await deleteInstallation(atomicInstallationId);
    try {
      await provision();
      const before = await snapshot();
      await provision();
      expect(await snapshot()).toEqual(before);
    } finally {
      await deleteInstallation(atomicInstallationId);
    }
  });

  it("serializes concurrent installations updates so only one CAS wins", async () => {
    await deleteInstallation(atomicInstallationId);
    try {
      await provision();
      const before = await snapshot();
      const outcomes = await Promise.allSettled([
        provision({
          environment: "production",
          artifactDigest: nextDigest,
          allowInstallationUpdate: true,
          expectedEnvironment: "staging",
          expectedArtifactDigest: initialDigest,
        }),
        provision({
          environment: "canary",
          artifactDigest: "4".repeat(64),
          allowInstallationUpdate: true,
          expectedEnvironment: "staging",
          expectedArtifactDigest: initialDigest,
        }),
      ]);

      const fulfilled = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<void> =>
          outcome.status === "fulfilled",
      );
      const rejected = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(InstallationMismatchError);

      const persisted = await store.loadInstallation(atomicInstallationId);
      expect(["production:2", "canary:4"]).toContain(
        `${persisted?.environment}:${persisted?.artifactDigest?.slice(0, 1)}`,
      );
      expect(
        await store.listInstallationChanges(atomicInstallationId),
      ).toHaveLength(2);
      const after = await snapshot();
      expect(after.registry_changes).toBe(before.registry_changes);
      expect(after.registration).toBe(before.registration);
    } finally {
      await deleteInstallation(atomicInstallationId);
    }
  });

  it("returns a reusable pooled connection after a successful commit", async () => {
    await deleteInstallation(atomicInstallationId);
    try {
      await provision();
      const persisted = await store.loadInstallation(atomicInstallationId);
      expect(persisted).toMatchObject({
        environment: "staging",
        artifactDigest: initialDigest,
      });
      const pooled = await ownerPool.query<{ ok: number }>("SELECT 1 AS ok");
      expect(pooled.rows[0]?.ok).toBe(1);
    } finally {
      await deleteInstallation(atomicInstallationId);
    }
  });

  it("rolls back a manifest registry failure and allows a retry", async () => {
    await deleteInstallation(atomicInstallationId);
    try {
      await provision();
      const before = await snapshot();
      await expect(
        provision({
          application: withVersion(
            createReferenceApplication({ id: applicationId }),
            "9.9.9",
          ),
        }),
      ).rejects.toThrow(ApplicationRegistrationDriftError);

      expect(await snapshot()).toEqual(before);
      const pooled = await ownerPool.query<{ ok: number }>("SELECT 1 AS ok");
      expect(pooled.rows[0]?.ok).toBe(1);

      await provision();
      expect(await snapshot()).toEqual(before);
    } finally {
      await deleteInstallation(atomicInstallationId);
    }
  });

  it("destroys the connection when BEGIN fails", async () => {
    await deleteInstallation(atomicInstallationId);
    try {
      await provision();
      const before = await snapshot();
      const { pool, releases } = await faultyOwnerPool((text) =>
        text === "BEGIN" ? new Error("simulated BEGIN failure") : null,
      );
      await expect(
        provision({ ownerPool: pool }),
      ).rejects.toThrow(/simulated BEGIN failure/);
      expect(releases).toEqual([true]);
      expect(await snapshot()).toEqual(before);
    } finally {
      await deleteInstallation(atomicInstallationId);
    }
  });

  it("destroys the connection when ROLLBACK fails", async () => {
    await deleteInstallation(atomicInstallationId);
    try {
      await provision();
      const before = await snapshot();
      const { pool, releases } = await faultyOwnerPool((text) =>
        text === "ROLLBACK" ? new Error("simulated ROLLBACK failure") : null,
      );
      await expect(
        provision({
          ownerPool: pool,
          environment: "production",
          artifactDigest: nextDigest,
          allowInstallationUpdate: true,
          expectedEnvironment: "staging",
          expectedArtifactDigest: "3".repeat(64),
        }),
      ).rejects.toBeInstanceOf(InstallationMismatchError);
      expect(releases).toEqual([true]);
      expect(await snapshot()).toEqual(before);
    } finally {
      await deleteInstallation(atomicInstallationId);
    }
  });

  it("destroys the connection when the backend is lost mid-provisioning", async () => {
    await deleteInstallation(atomicInstallationId);
    try {
      const before = await snapshot();
      const { pool, releases } = await faultyOwnerPool(async (text, client) => {
        if (text !== "COMMIT") return null;
        await client
          .query("SELECT pg_terminate_backend(pg_backend_pid())")
          .catch(() => undefined);
        return new Error("connection lost before commit");
      });
      await expect(provision({ ownerPool: pool })).rejects.toThrow(
        /connection lost before commit/,
      );
      expect(releases).toEqual([true]);
      expect(await snapshot()).toEqual(before);
    } finally {
      await deleteInstallation(atomicInstallationId);
    }
  });

  it("treats an unknown COMMIT outcome as unsafe and destroys the connection", async () => {
    await deleteInstallation(atomicInstallationId);
    try {
      const { pool, releases } = await faultyOwnerPool(async (text, client) => {
        if (text !== "COMMIT") return null;
        await client.query("COMMIT");
        return new Error("commit response lost");
      });
      await expect(provision({ ownerPool: pool })).rejects.toThrow(
        /commit response lost/,
      );
      expect(releases).toEqual([true]);
      // The server may have committed even though the client saw an error; the
      // guarantee is that this connection is never reused, not a guessed outcome.
      const persisted = await store.loadInstallation(atomicInstallationId);
      expect(persisted).toMatchObject({ environment: "staging" });
    } finally {
      await deleteInstallation(atomicInstallationId);
    }
  });
});

describe("registry change audit", () => {
  it("records created and updated mutations with actor, version and digests", async () => {
    const audited = createReferenceApplication({ id: auditApplicationId });
    await deleteApplications([auditApplicationId]);
    try {
      const created = await store.sync(audited, { actor: "release-bot" });
      expect(created.outcome).toBe("created");

      const unchanged = await store.sync(audited);
      expect(unchanged.outcome).toBe("unchanged");

      await expect(store.sync(withVersion(audited, "1.0.1"))).rejects.toThrow(
        ApplicationRegistrationDriftError,
      );

      const updated = await store.sync(withVersion(audited, "1.0.1"), {
        allowUpdate: true,
        actor: "release-owner",
      });
      expect(updated.outcome).toBe("updated");

      const changes = await store.listChanges(auditApplicationId);
      expect(
        changes.map((change) => [change.changeKind, change.actor]),
      ).toEqual([
        ["created", "release-bot"],
        ["updated", "release-owner"],
      ]);
      expect(changes[0]).toMatchObject({
        previousDigest: null,
        newDigest: created.digest,
        previousVersion: null,
        newVersion: audited.version,
      });
      expect(changes[1]).toMatchObject({
        previousDigest: created.digest,
        newDigest: updated.digest,
        previousVersion: audited.version,
        newVersion: "1.0.1",
      });
    } finally {
      await deleteApplications([auditApplicationId]);
    }
  });

  it("requires an actor for a new registration and writes nothing", async () => {
    const unaudited = createReferenceApplication({ id: unauditedApplicationId });
    await deleteApplications([unauditedApplicationId]);

    await expect(store.sync(unaudited)).rejects.toThrow(
      RegistryActorRequiredError,
    );

    const counts = await owner.query<{
      applications: string;
      registrations: string;
      changes: string;
    }>(
      `SELECT
         (SELECT count(*) FROM platform_applications WHERE id = $1)::text AS applications,
         (SELECT count(*) FROM platform_application_registrations WHERE application_id = $1)::text AS registrations,
         (SELECT count(*) FROM platform_application_registry_changes WHERE application_id = $1)::text AS changes`,
      [unauditedApplicationId],
    );
    expect(counts.rows[0]).toEqual({
      applications: "0",
      registrations: "0",
      changes: "0",
    });
  });

  it("refuses to delete an application while its audit history exists", async () => {
    const audited = createReferenceApplication({ id: auditApplicationId });
    await deleteApplications([auditApplicationId]);
    await store.sync(audited, { actor: "release-bot" });
    try {
      await expect(
        owner.query("DELETE FROM platform_applications WHERE id = $1", [
          auditApplicationId,
        ]),
      ).rejects.toMatchObject({ code: "23503" });
      expect((await store.listChanges(auditApplicationId)).length).toBe(1);
    } finally {
      await deleteApplications([auditApplicationId]);
    }
  });
});

describe("runtime role verification", () => {
  it("proves the runtime role is least-privilege and owns no platform objects", async () => {
    const roleAttrs = await assertSafePlatformRuntimeRole(runtimePool, {
      profile: "runtime",
      privilegeContract: REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
    });
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
      await expect(
        assertSafePlatformRuntimeRole(ownerPool, {
          profile: "runtime",
          privilegeContract: REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
        }),
      ).rejects.toThrow(UnsafePlatformRuntimeRoleError);
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

    it("rejects a NOINHERIT membership in an ordinary table-owning role", async () => {
      const login = ephemeralRoleName("member_noinherit");
      const tableOwner = ephemeralRoleName("table_owner");
      const tableName = ephemeralRoleName("owned_table");
      const password = `${login}_pw`;
      try {
        await owner.query(
          `CREATE ROLE ${owner.escapeIdentifier(tableOwner)} NOLOGIN`,
        );
        await owner.query(
          `CREATE TABLE public.${owner.escapeIdentifier(tableName)} (id integer)`,
        );
        await owner.query(
          `ALTER TABLE public.${owner.escapeIdentifier(tableName)} OWNER TO ${owner.escapeIdentifier(tableOwner)}`,
        );
        await createEphemeralLogin(login, password);
        // NOINHERIT hides the owner privileges from current_user, but the
        // login can still SET ROLE to the table owner.
        await owner.query(
          `GRANT ${owner.escapeIdentifier(tableOwner)} TO ${owner.escapeIdentifier(login)} WITH INHERIT FALSE`,
        );
        const client = new Client({
          connectionString: roleConnectionString(login, password),
        });
        await client.connect();
        try {
          await expectUnsafeRuntimeRole(client, ["unexpected_role_membership"]);
        } finally {
          await client.end().catch(() => undefined);
        }
      } finally {
        await dropEphemeralRoles([login, tableOwner]);
      }
    });

    it("rejects indirect membership in an ordinary role", async () => {
      const login = ephemeralRoleName("member_indirect");
      const middle = ephemeralRoleName("middle");
      const target = ephemeralRoleName("target");
      const password = `${login}_pw`;
      try {
        await owner.query(
          `CREATE ROLE ${owner.escapeIdentifier(middle)} NOLOGIN`,
        );
        await owner.query(
          `CREATE ROLE ${owner.escapeIdentifier(target)} NOLOGIN`,
        );
        await owner.query(
          `GRANT ${owner.escapeIdentifier(target)} TO ${owner.escapeIdentifier(middle)}`,
        );
        await createEphemeralLogin(login, password);
        await owner.query(
          `GRANT ${owner.escapeIdentifier(middle)} TO ${owner.escapeIdentifier(login)}`,
        );
        const client = new Client({
          connectionString: roleConnectionString(login, password),
        });
        await client.connect();
        try {
          await expectUnsafeRuntimeRole(client, ["unexpected_role_membership"]);
        } finally {
          await client.end().catch(() => undefined);
        }
      } finally {
        await dropEphemeralRoles([login, middle, target]);
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

    it("rejects SELECT on an unrelated CMS table", async () => {
      const table = ephemeralRoleName("cms_table");
      const relation = `public.${owner.escapeIdentifier(table)}`;
      await expectUnsafeRuntimeContractGrant(
        async (login) => {
          await owner.query(`CREATE TABLE ${relation} (id integer)`);
          await owner.query(
            `GRANT SELECT ON TABLE ${relation} TO ${owner.escapeIdentifier(login)}`,
          );
        },
        async () => {
          await owner.query(`DROP TABLE IF EXISTS ${relation}`);
        },
        ["unexpected_relation_privilege"],
      );
    });

    it("rejects UPDATE on an unrelated application table", async () => {
      const table = ephemeralRoleName("app_table");
      const relation = `public.${owner.escapeIdentifier(table)}`;
      await expectUnsafeRuntimeContractGrant(
        async (login) => {
          await owner.query(`CREATE TABLE ${relation} (id integer)`);
          await owner.query(
            `GRANT UPDATE ON TABLE ${relation} TO ${owner.escapeIdentifier(login)}`,
          );
        },
        async () => {
          await owner.query(`DROP TABLE IF EXISTS ${relation}`);
        },
        ["unexpected_relation_privilege"],
      );
    });

    it("rejects column-level grants outside the contract", async () => {
      const table = ephemeralRoleName("column_grant");
      const relation = `public.${owner.escapeIdentifier(table)}`;
      await expectUnsafeRuntimeContractGrant(
        async (login) => {
          await owner.query(
            `CREATE TABLE ${relation} (id integer, secret text)`,
          );
          await owner.query(
            `GRANT SELECT (secret) ON TABLE ${relation} TO ${owner.escapeIdentifier(login)}`,
          );
        },
        async () => {
          await owner.query(`DROP TABLE IF EXISTS ${relation}`);
        },
        ["unexpected_column_privilege"],
      );
    });

    it("rejects privileges inherited through PUBLIC", async () => {
      const table = ephemeralRoleName("public_grant");
      const relation = `public.${owner.escapeIdentifier(table)}`;
      await expectUnsafeRuntimeContractGrant(
        async () => {
          await owner.query(`CREATE TABLE ${relation} (id integer)`);
          await owner.query(`GRANT SELECT ON TABLE ${relation} TO PUBLIC`);
        },
        async () => {
          await owner.query(`DROP TABLE IF EXISTS ${relation}`);
        },
        ["unexpected_relation_privilege"],
      );
    });

    it("rejects USAGE on an unauthorized sequence", async () => {
      const sequence = ephemeralRoleName("seq");
      const relation = `public.${owner.escapeIdentifier(sequence)}`;
      await expectUnsafeRuntimeContractGrant(
        async (login) => {
          await owner.query(`CREATE SEQUENCE ${relation}`);
          await owner.query(
            `GRANT USAGE ON SEQUENCE ${relation} TO ${owner.escapeIdentifier(login)}`,
          );
        },
        async () => {
          await owner.query(`DROP SEQUENCE IF EXISTS ${relation}`);
        },
        ["unexpected_sequence_privilege"],
      );
    });

    it("rejects SELECT on a view outside the contract", async () => {
      const view = ephemeralRoleName("view");
      const relation = `public.${owner.escapeIdentifier(view)}`;
      await expectUnsafeRuntimeContractGrant(
        async (login) => {
          await owner.query(
            `CREATE VIEW ${relation} AS SELECT id FROM public.platform_crm_customers`,
          );
          await owner.query(
            `GRANT SELECT ON TABLE ${relation} TO ${owner.escapeIdentifier(login)}`,
          );
        },
        async () => {
          await owner.query(`DROP VIEW IF EXISTS ${relation}`);
        },
        ["unexpected_relation_privilege"],
      );
    });

    it("rejects a view that executes with its owner's privileges", async () => {
      const view = ephemeralRoleName("owner_view");
      const relation = `public.${owner.escapeIdentifier(view)}`;
      await expectUnsafeRuntimeContractGrant(
        async (login) => {
          await owner.query(
            `CREATE VIEW ${relation} AS
               SELECT id, application_id, environment, artifact_digest
               FROM public.platform_installations`,
          );
          await owner.query(
            `GRANT SELECT ON TABLE ${relation} TO ${owner.escapeIdentifier(login)}`,
          );
        },
        async () => {
          await owner.query(`DROP VIEW IF EXISTS ${relation}`);
        },
        ["unexpected_relation_privilege"],
      );
    });

    it("rejects privileges inherited through role membership", async () => {
      const grantor = ephemeralRoleName("grantor");
      const table = ephemeralRoleName("inherited");
      const relation = `public.${owner.escapeIdentifier(table)}`;
      await owner.query(
        `CREATE ROLE ${owner.escapeIdentifier(grantor)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION`,
      );
      try {
        await expectUnsafeRuntimeContractGrant(
          async (login) => {
            await owner.query(`CREATE TABLE ${relation} (id integer)`);
            await owner.query(
              `GRANT SELECT ON TABLE ${relation} TO ${owner.escapeIdentifier(grantor)}`,
            );
            await owner.query(
              `GRANT ${owner.escapeIdentifier(grantor)} TO ${owner.escapeIdentifier(login)}`,
            );
          },
          async () => {
            await owner.query(`DROP TABLE IF EXISTS ${relation}`);
          },
          ["unexpected_role_membership"],
        );
      } finally {
        await dropEphemeralRoles([grantor]);
      }
    });

    it("rejects EXECUTE on an unauthorized function", async () => {
      const functionName = ephemeralRoleName("contractfn");
      const fn = `public.${owner.escapeIdentifier(functionName)}()`;
      await expectUnsafeRuntimeContractGrant(
        async (login) => {
          await owner.query(
            `CREATE FUNCTION ${fn} RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
          );
          await owner.query(
            `GRANT EXECUTE ON FUNCTION ${fn} TO ${owner.escapeIdentifier(login)}`,
          );
        },
        async () => {
          await owner.query(`DROP FUNCTION IF EXISTS ${fn}`);
        },
        ["unexpected_function_execute"],
      );
    });

    it("rejects USAGE on a schema outside the contract", async () => {
      const schema = ephemeralRoleName("schema");
      await expectUnsafeRuntimeContractGrant(
        async (login) => {
          await owner.query(
            `CREATE SCHEMA ${owner.escapeIdentifier(schema)}`,
          );
          await owner.query(
            `GRANT USAGE ON SCHEMA ${owner.escapeIdentifier(schema)} TO ${owner.escapeIdentifier(login)}`,
          );
        },
        async () => {
          await owner.query(
            `DROP SCHEMA IF EXISTS ${owner.escapeIdentifier(schema)}`,
          );
        },
        ["unexpected_schema_privilege"],
      );
    });

    it("revokes a pre-existing unrelated grant during provisioning", async () => {
      const login = ephemeralRoleName("reprovision");
      const password = `${login}_pw`;
      const table = ephemeralRoleName("reprovision_table");
      const relation = `public.${owner.escapeIdentifier(table)}`;
      try {
        await createEphemeralLogin(login, password);
        await owner.query(`CREATE TABLE ${relation} (id integer)`);
        await owner.query(
          `GRANT SELECT ON TABLE ${relation} TO ${owner.escapeIdentifier(login)}`,
        );
        const before = await owner.query<{ allowed: boolean }>(
          "SELECT has_table_privilege($1, $2, 'SELECT') AS allowed",
          [login, relation],
        );
        expect(before.rows[0]?.allowed).toBe(true);

        await provisionPlatformRuntimeRole(
          owner,
          { roleName: login, password },
          REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
        );

        const after = await owner.query<{ allowed: boolean }>(
          "SELECT has_table_privilege($1, $2, 'SELECT') AS allowed",
          [login, relation],
        );
        expect(after.rows[0]?.allowed).toBe(false);

        const client = new Client({
          connectionString: roleConnectionString(login, password),
        });
        await client.connect();
        try {
          await assertSafePlatformRuntimeRole(client, {
            profile: "runtime",
            privilegeContract: REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
          });
        } finally {
          await client.end().catch(() => undefined);
        }
      } finally {
        await owner
          .query(`DROP TABLE IF EXISTS ${relation}`)
          .catch(() => undefined);
        await dropEphemeralRoles([login]);
      }
    });

    it("rejects a contract version or function identity that is not exact", () => {
      expect(() =>
        assertValidRuntimePrivilegeContract({
          ...REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
          version: 1,
        } as unknown as PlatformRuntimePrivilegeContract),
      ).toThrow(/Unsupported runtime privilege contract version/);
      expect(() =>
        assertValidRuntimePrivilegeContract(
          contractWithFunctions([
            { schema: "public", name: "missing_identity" } as RuntimeFunctionGrant,
          ]),
        ),
      ).toThrow(/invalid identity arguments/);
      expect(() =>
        assertValidRuntimePrivilegeContract(
          contractWithFunctions([
            {
              schema: "public",
              name: "padded",
              identityArguments: " integer",
            },
          ]),
        ),
      ).toThrow(/exact pg_get_function_identity_arguments value/);
    });

    it("authorizes one exact function signature", async () => {
      const functionName = ephemeralRoleName("exactfn");
      const fn = `public.${owner.escapeIdentifier(functionName)}(integer)`;
      const contract = contractWithFunctions([
        { schema: "public", name: functionName, identityArguments: "integer" },
      ]);
      try {
        await owner.query(
          `CREATE FUNCTION ${fn} RETURNS integer LANGUAGE sql AS 'SELECT $1'`,
        );
        await withContractRuntime(contract, async (client) => {
          await expect(
            assertSafePlatformRuntimeRole(client, {
              profile: "runtime",
              privilegeContract: contract,
            }),
          ).resolves.toMatchObject({ isSuperuser: false });
        });
      } finally {
        await owner.query(`DROP FUNCTION IF EXISTS ${fn}`).catch(() => undefined);
      }
    });

    it("authorizes two overloads of the same name explicitly", async () => {
      const functionName = ephemeralRoleName("twofns");
      const fnInteger = `public.${owner.escapeIdentifier(functionName)}(integer)`;
      const fnText = `public.${owner.escapeIdentifier(functionName)}(text)`;
      const contract = contractWithFunctions([
        { schema: "public", name: functionName, identityArguments: "integer" },
        { schema: "public", name: functionName, identityArguments: "text" },
      ]);
      try {
        await owner.query(
          `CREATE FUNCTION ${fnInteger} RETURNS integer LANGUAGE sql AS 'SELECT $1'`,
        );
        await owner.query(
          `CREATE FUNCTION ${fnText} RETURNS integer LANGUAGE sql AS 'SELECT length($1)'`,
        );
        await withContractRuntime(contract, async (client) => {
          await expect(
            assertSafePlatformRuntimeRole(client, {
              profile: "runtime",
              privilegeContract: contract,
            }),
          ).resolves.toMatchObject({ isSuperuser: false });
        });
      } finally {
        await owner
          .query(`DROP FUNCTION IF EXISTS ${fnInteger}, ${fnText}`)
          .catch(() => undefined);
      }
    });

    it("rejects an unauthorized overload of an authorized name", async () => {
      const functionName = ephemeralRoleName("overload");
      const fnInteger = `public.${owner.escapeIdentifier(functionName)}(integer)`;
      const fnText = `public.${owner.escapeIdentifier(functionName)}(text)`;
      const contract = contractWithFunctions([
        { schema: "public", name: functionName, identityArguments: "integer" },
      ]);
      try {
        await owner.query(
          `CREATE FUNCTION ${fnInteger} RETURNS integer LANGUAGE sql AS 'SELECT $1'`,
        );
        await owner.query(
          `CREATE FUNCTION ${fnText} RETURNS integer LANGUAGE sql AS 'SELECT length($1)'`,
        );
        await withContractRuntime(contract, async (client) => {
          await expectUnsafeRole(
            () =>
              assertSafePlatformRuntimeRole(client, {
                profile: "runtime",
                privilegeContract: contract,
              }),
            ["unexpected_function_execute"],
          );
        });
      } finally {
        await owner
          .query(`DROP FUNCTION IF EXISTS ${fnInteger}, ${fnText}`)
          .catch(() => undefined);
      }
    });

    it("detects an overload added after role provisioning", async () => {
      const functionName = ephemeralRoleName("lateoverload");
      const fnInteger = `public.${owner.escapeIdentifier(functionName)}(integer)`;
      const fnBoolean = `public.${owner.escapeIdentifier(functionName)}(boolean)`;
      const contract = contractWithFunctions([
        { schema: "public", name: functionName, identityArguments: "integer" },
      ]);
      try {
        await owner.query(
          `CREATE FUNCTION ${fnInteger} RETURNS integer LANGUAGE sql AS 'SELECT $1'`,
        );
        await withContractRuntime(contract, async (client) => {
          await owner.query(
            `CREATE FUNCTION ${fnBoolean} RETURNS integer LANGUAGE sql AS 'SELECT CASE WHEN $1 THEN 1 ELSE 0 END'`,
          );
          await expectUnsafeRole(
            () =>
              assertSafePlatformRuntimeRole(client, {
                profile: "runtime",
                privilegeContract: contract,
              }),
            ["unexpected_function_execute"],
          );
        });
      } finally {
        await owner
          .query(`DROP FUNCTION IF EXISTS ${fnInteger}, ${fnBoolean}`)
          .catch(() => undefined);
      }
    });

    it("rejects PUBLIC EXECUTE on an unrelated function", async () => {
      const functionName = ephemeralRoleName("publicfn");
      const fn = `public.${owner.escapeIdentifier(functionName)}(text)`;
      const contract = contractWithFunctions([]);
      try {
        await owner.query(
          `CREATE FUNCTION ${fn} RETURNS integer LANGUAGE sql AS 'SELECT length($1)'`,
        );
        await withContractRuntime(contract, async (client) => {
          await expectUnsafeRole(
            () =>
              assertSafePlatformRuntimeRole(client, {
                profile: "runtime",
                privilegeContract: contract,
              }),
            ["unexpected_function_execute"],
          );
        });
      } finally {
        await owner.query(`DROP FUNCTION IF EXISTS ${fn}`).catch(() => undefined);
      }
    });

    it("rejects an explicit grant on an unauthorized overload", async () => {
      const functionName = ephemeralRoleName("grantedoverload");
      const fnInteger = `public.${owner.escapeIdentifier(functionName)}(integer)`;
      const fnText = `public.${owner.escapeIdentifier(functionName)}(text)`;
      const contract = contractWithFunctions([
        { schema: "public", name: functionName, identityArguments: "integer" },
      ]);
      try {
        await owner.query(
          `CREATE FUNCTION ${fnInteger} RETURNS integer LANGUAGE sql AS 'SELECT $1'`,
        );
        await owner.query(
          `CREATE FUNCTION ${fnText} RETURNS integer LANGUAGE sql AS 'SELECT length($1)'`,
        );
        await withContractRuntime(contract, async (client, login) => {
          await owner.query(
            `GRANT EXECUTE ON FUNCTION ${fnText} TO ${owner.escapeIdentifier(login)}`,
          );
          await expectUnsafeRole(
            () =>
              assertSafePlatformRuntimeRole(client, {
                profile: "runtime",
                privilegeContract: contract,
              }),
            ["unexpected_function_execute"],
          );
        });
      } finally {
        await owner
          .query(`DROP FUNCTION IF EXISTS ${fnInteger}, ${fnText}`)
          .catch(() => undefined);
      }
    });

    it("rejects EXECUTE on an authorized-name SECURITY DEFINER function", async () => {
      const functionName = ephemeralRoleName("definercontract");
      const fn = `public.${owner.escapeIdentifier(functionName)}(integer)`;
      const contract = contractWithFunctions([
        { schema: "public", name: functionName, identityArguments: "integer" },
      ]);
      try {
        await owner.query(
          `CREATE FUNCTION ${fn} RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT $1'`,
        );
        await withContractRuntime(contract, async (client) => {
          await expectUnsafeRole(
            () =>
              assertSafePlatformRuntimeRole(client, {
                profile: "runtime",
                privilegeContract: contract,
              }),
            ["security_definer_execute"],
          );
        });
      } finally {
        await owner.query(`DROP FUNCTION IF EXISTS ${fn}`).catch(() => undefined);
      }
    });

    it("refuses to provision a contract whose exact signature does not exist", async () => {
      const functionName = ephemeralRoleName("missingfn");
      const fn = `public.${owner.escapeIdentifier(functionName)}(integer)`;
      const login = ephemeralRoleName("missingcontract");
      const password = `${login}_pw`;
      const contract = contractWithFunctions([
        { schema: "public", name: functionName, identityArguments: "bigint" },
      ]);
      try {
        await owner.query(
          `CREATE FUNCTION ${fn} RETURNS integer LANGUAGE sql AS 'SELECT $1'`,
        );
        await createEphemeralLogin(login, password);
        await expect(
          provisionPlatformRuntimeRole(
            owner,
            { roleName: login, password },
            contract,
          ),
        ).rejects.toThrow(/found 0 matching definitions/);
      } finally {
        await owner.query(`DROP FUNCTION IF EXISTS ${fn}`).catch(() => undefined);
        await dropEphemeralRoles([login]);
      }
    });

    it("detects a function signature change after provisioning", async () => {
      const functionName = ephemeralRoleName("replacedfn");
      const fnInteger = `public.${owner.escapeIdentifier(functionName)}(integer)`;
      const fnBigint = `public.${owner.escapeIdentifier(functionName)}(bigint)`;
      const contract = contractWithFunctions([
        { schema: "public", name: functionName, identityArguments: "integer" },
      ]);
      try {
        await owner.query(
          `CREATE FUNCTION ${fnInteger} RETURNS integer LANGUAGE sql AS 'SELECT $1'`,
        );
        await withContractRuntime(contract, async (client) => {
          await owner.query(`DROP FUNCTION ${fnInteger}`);
          await owner.query(
            `CREATE FUNCTION ${fnBigint} RETURNS bigint LANGUAGE sql AS 'SELECT $1'`,
          );
          await expectUnsafeRole(
            () =>
              assertSafePlatformRuntimeRole(client, {
                profile: "runtime",
                privilegeContract: contract,
              }),
            ["contract_function_missing", "unexpected_function_execute"],
          );
        });
      } finally {
        await owner
          .query(`DROP FUNCTION IF EXISTS ${fnInteger}, ${fnBigint}`)
          .catch(() => undefined);
      }
    });

    it("detects an authorized function that was removed", async () => {
      const functionName = ephemeralRoleName("removedfn");
      const fn = `public.${owner.escapeIdentifier(functionName)}(integer)`;
      const contract = contractWithFunctions([
        { schema: "public", name: functionName, identityArguments: "integer" },
      ]);
      try {
        await owner.query(
          `CREATE FUNCTION ${fn} RETURNS integer LANGUAGE sql AS 'SELECT $1'`,
        );
        await withContractRuntime(contract, async (client) => {
          await owner.query(`DROP FUNCTION ${fn}`);
          await expectUnsafeRole(
            () =>
              assertSafePlatformRuntimeRole(client, {
                profile: "runtime",
                privilegeContract: contract,
              }),
            ["contract_function_missing"],
          );
        });
      } finally {
        await owner.query(`DROP FUNCTION IF EXISTS ${fn}`).catch(() => undefined);
      }
    });
  });
});

describe("serving process privilege split", () => {
  it("refuses to start the serving process with an owner DATABASE_URL", async () => {
    const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
    const failure = (await promisify(execFile)(
      tsx,
      ["apps/platform-reference/src/main.ts"],
      {
        env: { ...process.env, DATABASE_URL },
      },
    ).catch((error: { code?: number; stderr?: string }) => error)) as {
      code?: number;
      stderr?: string;
    };
    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain("must not receive DATABASE_URL");
  });

  it("requires three distinct least-privilege connection identities", async () => {
    const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.PLATFORM_TEST_DATABASE_URL;
    env.PLATFORM_RUNTIME_DATABASE_URL = "postgresql://app:pw@127.0.0.1/db";
    env.PLATFORM_MEMBERSHIP_READER_DATABASE_URL =
      "postgresql://app:pw@127.0.0.1/db";
    env.PLATFORM_DEPLOYMENT_VERIFIER_DATABASE_URL =
      "postgresql://app:pw@127.0.0.1/db";

    const failure = (await promisify(execFile)(
      tsx,
      ["apps/platform-reference/src/main.ts"],
      { env },
    ).catch((error: { code?: number; stderr?: string }) => error)) as {
      code?: number;
      stderr?: string;
    };
    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain("must be distinct");
  });

  it("closes the verifier pool after the boot proof", async () => {
    expect(server.address).toMatch(/^http:\/\/127\.0\.0\.1:/);
    await expect(verifierPool.query("SELECT 1")).rejects.toThrow(
      /after calling end/i,
    );
  });

  it("validates the verifier as SELECT-only on deployment registry tables", async () => {
    const verifierUrl = new URL(DATABASE_URL);
    verifierUrl.username = verifierRoleName;
    verifierUrl.password = verifierRolePassword;
    const pool = new Pool({
      connectionString: verifierUrl.toString(),
      max: 1,
    });
    try {
      const attributes = await assertSafePlatformDeploymentVerifierRole(pool);
      expect(attributes.currentUser).toBe(verifierRoleName);
      expect(attributes.isSuperuser).toBe(false);
      expect(attributes.isBypassRls).toBe(false);
    } finally {
      await pool.end().catch(() => undefined);
    }
  });

  it("fails closed on installation environment, artifact and manifest drift", async () => {
    const verifierUrl = new URL(DATABASE_URL);
    verifierUrl.username = verifierRoleName;
    verifierUrl.password = verifierRolePassword;
    const pool = new Pool({
      connectionString: verifierUrl.toString(),
      max: 1,
    });
    try {
      const base = {
        client: pool,
        application,
        installationId,
        environment: "integration-test",
        artifactDigest,
      };

      await expect(
        verifyDeploymentIdentity({ ...base, environment: "production" }),
      ).rejects.toBeInstanceOf(DeploymentVerificationError);
      await expect(
        verifyDeploymentIdentity({
          ...base,
          artifactDigest: "f".repeat(64),
        }),
      ).rejects.toBeInstanceOf(DeploymentVerificationError);
      await expect(
        verifyDeploymentIdentity({
          ...base,
          application: createReferenceApplication({ id: otherApplicationId }),
        }),
      ).rejects.toBeInstanceOf(DeploymentVerificationError);
      await expect(
        verifyDeploymentIdentity({
          ...base,
          application: withVersion(application, "9.9.9"),
        }),
      ).rejects.toBeInstanceOf(DeploymentVerificationError);

      const verified = await verifyDeploymentIdentity(base);
      expect(verified.installation.environment).toBe("integration-test");
      expect(verified.installation.artifactDigest).toBe(artifactDigest);
    } finally {
      await pool.end().catch(() => undefined);
    }
  });

  it("denies the verifier writes and any read outside the deployment registry", async () => {
    const verifierUrl = new URL(DATABASE_URL);
    verifierUrl.username = verifierRoleName;
    verifierUrl.password = verifierRolePassword;
    const pool = new Pool({
      connectionString: verifierUrl.toString(),
      max: 1,
    });
    try {
      for (const statement of [
        `INSERT INTO platform_installations (id, application_id, environment, artifact_digest)
           VALUES ('intruder', 'intruder', 'production', 'digest')`,
        `UPDATE platform_installations SET environment = environment`,
        `DELETE FROM platform_installations`,
        `TRUNCATE platform_installations`,
        `INSERT INTO platform_application_registrations (application_id, manifest_digest, registered_at, updated_at)
           VALUES ('intruder', 'digest', now(), now())`,
        `UPDATE platform_application_registrations SET manifest_digest = manifest_digest`,
        `DELETE FROM platform_application_registrations`,
      ]) {
        await expect(pool.query(statement)).rejects.toMatchObject({
          code: "42501",
        });
      }

      for (const relation of [
        "platform_applications",
        "platform_application_registry_changes",
        "platform_memberships",
        "platform_crm_customers",
      ]) {
        await expect(
          pool.query(`SELECT * FROM ${relation}`),
        ).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await pool.end().catch(() => undefined);
    }
  });

  it("starts read-only without mutating the registry or installation", async () => {
    const beforeInstallation = await ownerPool.query(
      `SELECT application_id, environment, artifact_digest, created_at
         FROM platform_installations WHERE id = $1`,
      [installationId],
    );
    const beforeRegistration = await ownerPool.query(
      `SELECT manifest_digest, registered_at, updated_at
         FROM platform_application_registrations WHERE application_id = $1`,
      [applicationId],
    );

    const runtimeUrl = new URL(DATABASE_URL);
    runtimeUrl.username = roleName;
    runtimeUrl.password = rolePassword;
    const readerUrl = new URL(DATABASE_URL);
    readerUrl.username = readerRoleName;
    readerUrl.password = readerRolePassword;
    const verifierUrl = new URL(DATABASE_URL);
    verifierUrl.username = verifierRoleName;
    verifierUrl.password = verifierRolePassword;
    const secondRuntimePool = new Pool({
      connectionString: runtimeUrl.toString(),
      max: 1,
    });
    const secondReaderPool = new Pool({
      connectionString: readerUrl.toString(),
      max: 1,
    });
    const secondVerifierPool = new Pool({
      connectionString: verifierUrl.toString(),
      max: 1,
    });

    try {
      const started = await startReferenceApplication({
        application,
        installationId,
        tokens: ReferenceTokenDirectory.fromJson(application.id, tokenJson()),
        verifierPool: secondVerifierPool,
        readerPool: secondReaderPool,
        runtimePool: secondRuntimePool,
        environment: "integration-test",
        artifactDigest,
        runtimePrivilegeContract: REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
        host: "127.0.0.1",
        port: 0,
        policyVersion: "reference-crm-readonly-boot",
        policy: new PolicyEngine([]),
      });
      await started.app.close();

      const afterInstallation = await ownerPool.query(
        `SELECT application_id, environment, artifact_digest, created_at
           FROM platform_installations WHERE id = $1`,
        [installationId],
      );
      const afterRegistration = await ownerPool.query(
        `SELECT manifest_digest, registered_at, updated_at
           FROM platform_application_registrations WHERE application_id = $1`,
        [applicationId],
      );
      expect(afterInstallation.rows).toEqual(beforeInstallation.rows);
      expect(afterRegistration.rows).toEqual(beforeRegistration.rows);
    } finally {
      await secondReaderPool.end().catch(() => undefined);
      await secondRuntimePool.end().catch(() => undefined);
      await secondVerifierPool.end().catch(() => undefined);
    }
  });

  it("fails closed before serving on an artifact mismatch without mutation", async () => {
    const before = await ownerPool.query(
      `SELECT environment, artifact_digest FROM platform_installations WHERE id = $1`,
      [installationId],
    );
    const runtimeUrl = new URL(DATABASE_URL);
    runtimeUrl.username = roleName;
    runtimeUrl.password = rolePassword;
    const readerUrl = new URL(DATABASE_URL);
    readerUrl.username = readerRoleName;
    readerUrl.password = readerRolePassword;
    const verifierUrl = new URL(DATABASE_URL);
    verifierUrl.username = verifierRoleName;
    verifierUrl.password = verifierRolePassword;
    const badRuntimePool = new Pool({
      connectionString: runtimeUrl.toString(),
      max: 1,
    });
    const badReaderPool = new Pool({
      connectionString: readerUrl.toString(),
      max: 1,
    });
    const badVerifierPool = new Pool({
      connectionString: verifierUrl.toString(),
      max: 1,
    });

    try {
      await expect(
        startReferenceApplication({
          application,
          installationId,
          tokens: ReferenceTokenDirectory.fromJson(application.id, tokenJson()),
          verifierPool: badVerifierPool,
          readerPool: badReaderPool,
          runtimePool: badRuntimePool,
          environment: "integration-test",
          artifactDigest: "f".repeat(64),
          runtimePrivilegeContract: REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
          host: "127.0.0.1",
          port: 0,
          policyVersion: "reference-crm-bad-artifact",
          policy: new PolicyEngine([]),
        }),
      ).rejects.toBeInstanceOf(DeploymentVerificationError);

      const after = await ownerPool.query(
        `SELECT environment, artifact_digest FROM platform_installations WHERE id = $1`,
        [installationId],
      );
      expect(after.rows).toEqual(before.rows);
    } finally {
      await badReaderPool.end().catch(() => undefined);
      await badRuntimePool.end().catch(() => undefined);
      await badVerifierPool.end().catch(() => undefined);
    }
  });

  it("validates the reader as SELECT-only on the membership directory", async () => {
    const attributes = await assertSafePlatformMembershipReaderRole(readerPool);
    expect(attributes.currentUser).toBe(readerRoleName);

    const memberships = await readerPool.query<{ count: string }>(
      "SELECT count(*) AS count FROM platform_memberships WHERE application_id = $1",
      [applicationId],
    );
    expect(Number(memberships.rows[0]?.count)).toBeGreaterThan(0);
  });

  it("denies the reader writes on memberships and every other relation", async () => {
    await expect(
      readerPool.query(
        `INSERT INTO platform_memberships
           (application_id, tenant_id, principal_id, active, roles, permissions)
         VALUES ($1, $2, 'intruder', true, ARRAY[]::text[], ARRAY[]::text[])`,
        [applicationId, tenantAId],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      readerPool.query("UPDATE platform_memberships SET active = false"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      readerPool.query("DELETE FROM platform_memberships"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      readerPool.query("TRUNCATE platform_memberships"),
    ).rejects.toMatchObject({ code: "42501" });

    for (const relation of [
      "platform_applications",
      "platform_installations",
      "platform_tenants",
      "platform_application_registrations",
      "platform_crm_customers",
    ]) {
      await expect(
        readerPool.query(`SELECT * FROM ${relation}`),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("fails closed when the reader lacks SELECT on memberships", async () => {
    const login = ephemeralRoleName("reader_missing");
    const password = `${login}_pw`;
    try {
      await createEphemeralLogin(login, password);
      const client = new Client({
        connectionString: roleConnectionString(login, password),
      });
      await client.connect();
      try {
        await expectUnsafeReaderRole(client, ["membership_read_missing"]);
      } finally {
        await client.end().catch(() => undefined);
      }
    } finally {
      await dropEphemeralRoles([login]);
    }
  });

  it("fails closed when the reader can write memberships", async () => {
    const login = ephemeralRoleName("reader_write");
    const password = `${login}_pw`;
    try {
      await createEphemeralLogin(login, password);
      await owner.query(
        `GRANT SELECT, INSERT ON TABLE public.platform_memberships TO ${owner.escapeIdentifier(login)}`,
      );
      const client = new Client({
        connectionString: roleConnectionString(login, password),
      });
      await client.connect();
      try {
        await expectUnsafeReaderRole(client, ["membership_write_privilege"]);
      } finally {
        await client.end().catch(() => undefined);
      }
    } finally {
      await dropEphemeralRoles([login]);
    }
  });

  it("fails closed when the reader can read a registry or tenant relation", async () => {
    for (const relation of ["platform_applications", "platform_crm_customers"]) {
      const login = ephemeralRoleName("reader_extra");
      const password = `${login}_pw`;
      try {
        await createEphemeralLogin(login, password);
        await owner.query(
          `GRANT SELECT ON TABLE public.platform_memberships TO ${owner.escapeIdentifier(login)}`,
        );
        await owner.query(
          `GRANT SELECT ON TABLE public.${relation} TO ${owner.escapeIdentifier(login)}`,
        );
        const client = new Client({
          connectionString: roleConnectionString(login, password),
        });
        await client.connect();
        try {
          await expectUnsafeReaderRole(client, [
            "unexpected_relation_privilege",
          ]);
        } finally {
          await client.end().catch(() => undefined);
        }
      } finally {
        await dropEphemeralRoles([login]);
      }
    }
  });

  it("rejects unexpected SET-able memberships on the reader", async () => {
    const login = ephemeralRoleName("reader_member");
    const extra = ephemeralRoleName("reader_extra_role");
    const password = `${login}_pw`;
    try {
      await owner.query(`CREATE ROLE ${owner.escapeIdentifier(extra)} NOLOGIN`);
      await createEphemeralLogin(login, password);
      await owner.query(
        `GRANT SELECT ON TABLE public.platform_memberships TO ${owner.escapeIdentifier(login)}`,
      );
      await owner.query(
        `GRANT ${owner.escapeIdentifier(extra)} TO ${owner.escapeIdentifier(login)} WITH INHERIT FALSE`,
      );
      const client = new Client({
        connectionString: roleConnectionString(login, password),
      });
      await client.connect();
      try {
        await expectUnsafeReaderRole(client, ["unexpected_role_membership"]);
      } finally {
        await client.end().catch(() => undefined);
      }
    } finally {
      await dropEphemeralRoles([login, extra]);
    }
  });

  it("rejects verifier access to tenant relations and writes", async () => {
    const login = ephemeralRoleName("verifier_extra");
    const password = `${login}_pw`;
    try {
      await createEphemeralLogin(login, password);
      await owner.query(
        `GRANT SELECT ON TABLE public.platform_installations, public.platform_application_registrations TO ${owner.escapeIdentifier(login)}`,
      );
      await owner.query(
        `GRANT SELECT ON TABLE public.platform_crm_customers TO ${owner.escapeIdentifier(login)}`,
      );
      const client = new Client({
        connectionString: roleConnectionString(login, password),
      });
      await client.connect();
      try {
        await expectUnsafeVerifierRole(client, [
          "unexpected_relation_privilege",
        ]);
      } finally {
        await client.end().catch(() => undefined);
      }
    } finally {
      await dropEphemeralRoles([login]);
    }
  });

  it("rejects verifier writes on the installation registry", async () => {
    const login = ephemeralRoleName("verifier_write");
    const password = `${login}_pw`;
    try {
      await createEphemeralLogin(login, password);
      await owner.query(
        `GRANT SELECT, INSERT ON TABLE public.platform_installations TO ${owner.escapeIdentifier(login)}`,
      );
      await owner.query(
        `GRANT SELECT ON TABLE public.platform_application_registrations TO ${owner.escapeIdentifier(login)}`,
      );
      const client = new Client({
        connectionString: roleConnectionString(login, password),
      });
      await client.connect();
      try {
        await expectUnsafeVerifierRole(client, [
          "unexpected_relation_privilege",
        ]);
      } finally {
        await client.end().catch(() => undefined);
      }
    } finally {
      await dropEphemeralRoles([login]);
    }
  });

  it("refuses to boot with an unsafe reader role before verification", async () => {
    const login = ephemeralRoleName("reader_boot");
    const password = `${login}_pw`;
    try {
      await createEphemeralLogin(login, password);
      const unsafeReaderPool = new Pool({
        connectionString: roleConnectionString(login, password),
        max: 1,
      });
      const verifierUrl = new URL(DATABASE_URL);
      verifierUrl.username = verifierRoleName;
      verifierUrl.password = verifierRolePassword;
      const unusedVerifierPool = new Pool({
        connectionString: verifierUrl.toString(),
        max: 1,
      });
      try {
        const error = await startReferenceApplication({
          application,
          installationId: asInstallationId("test-installation-unsafe-reader"),
          tokens: ReferenceTokenDirectory.fromJson(application.id, tokenJson()),
          verifierPool: unusedVerifierPool,
          readerPool: unsafeReaderPool,
          runtimePool,
          environment: "test",
          artifactDigest,
          runtimePrivilegeContract: REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
          host: "127.0.0.1",
          port: 0,
          policyVersion: "reference-crm-unsafe-reader",
          policy: new PolicyEngine([]),
        }).then(
          () => null,
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(UnsafePlatformRuntimeRoleError);
        expect(
          (error as UnsafePlatformRuntimeRoleError).violations.map(
            (violation) => violation.code,
          ),
        ).toContain("membership_read_missing");
      } finally {
        await unsafeReaderPool.end().catch(() => undefined);
        await unusedVerifierPool.end().catch(() => undefined);
      }
    } finally {
      await dropEphemeralRoles([login]);
    }
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
