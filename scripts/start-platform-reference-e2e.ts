import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT } from "@vibress/database";
import { provisionPlatformRolesAtomically } from "./lib/provision-platform-roles-atomic";
import {
  asInstallationId,
  type TenantId,
} from "@vibress/platform-kernel";
import { PolicyEngine } from "@vibress/tenancy";
import {
  createReferenceApplication,
  REFERENCE_PERMISSIONS,
} from "../apps/platform-reference/src/application";
import { startReferenceApplication } from "../apps/platform-reference/src/start";
import { provisionReferenceApplication } from "../apps/platform-reference/src/registration";
import { ReferenceTokenDirectory } from "../apps/platform-reference/src/token-directory";
import {
  cleanupPlatformReferenceE2e,
  removeE2eState,
  writeE2eState,
  type PlatformReferenceE2eState,
} from "./lib/platform-reference-e2e";

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const HOST = "127.0.0.1";
const PORT = Number(process.env.PLATFORM_E2E_PORT ?? "7791");

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the reference-app E2E harness");
}

function roleUrl(role: string, password: string): string {
  const url = new URL(DATABASE_URL as string);
  url.username = role;
  url.password = password;
  return url.toString();
}

async function requireMigrated(client: Pool): Promise<void> {
  const result = await client.query<{ present: boolean }>(
    `SELECT
       to_regclass('public.platform_applications') IS NOT NULL
       AND to_regclass('public.platform_installations') IS NOT NULL
       AND to_regclass('public.platform_tenants') IS NOT NULL
       AND to_regclass('public.platform_crm_customers') IS NOT NULL
       AND to_regclass('public.platform_application_registrations') IS NOT NULL
       AND to_regclass('public.platform_application_registry_changes') IS NOT NULL
       AND to_regclass('public.platform_installation_changes') IS NOT NULL
       AND to_regclass('public.platform_memberships') IS NOT NULL
       AS present`,
  );
  if (!result.rows[0]?.present) {
    throw new Error(
      "Platform migrations are not applied to DATABASE_URL; run pnpm db:migrate first",
    );
  }
}

async function main(): Promise<void> {
  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const applicationId = `reference-e2e-${runId}`;
  const installationId = asInstallationId(`reference-e2e-install-${runId}`);
  const tenantAId = `reference-e2e-a-${runId}` as TenantId;
  const tenantBId = `reference-e2e-b-${runId}` as TenantId;
  const runtimeRole = `reference_e2e_rt_${runId}`;
  const readerRole = `reference_e2e_rd_${runId}`;
  const verifierRole = `reference_e2e_vf_${runId}`;
  const runtimePassword = randomUUID().replace(/-/g, "");
  const readerPassword = randomUUID().replace(/-/g, "");
  const verifierPassword = randomUUID().replace(/-/g, "");
  const artifactDigest = "e".repeat(64);
  const staffToken = `e2e-staff-${runId}`;
  const memberToken = `e2e-member-${runId}`;
  const tenantBToken = `e2e-tenant-b-${runId}`;

  const state: PlatformReferenceE2eState = {
    applicationId,
    installationId,
    tenantAId,
    tenantBId,
    staffToken,
    memberToken,
    tenantBToken,
    runtimeRole,
    readerRole,
    verifierRole,
  };

  const ownerPool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  let runtimePool: Pool | null = null;
  let readerPool: Pool | null = null;
  let verifierPool: Pool | null = null;
  let app: Awaited<ReturnType<typeof startReferenceApplication>>["app"] | null =
    null;

  try {
    await requireMigrated(ownerPool);

    const provisioning = await ownerPool.connect();
    let provisioningFailed = false;
    try {
      await provisionPlatformRolesAtomically(provisioning, {
        runtime: { roleName: runtimeRole, password: runtimePassword },
        reader: { roleName: readerRole, password: readerPassword },
        verifier: { roleName: verifierRole, password: verifierPassword },
      });
    } catch (error) {
      provisioningFailed = true;
      throw error;
    } finally {
      // Do not recycle a connection whose rollback/commit state is unknown.
      provisioning.release(provisioningFailed);
    }

    writeE2eState(state);

    runtimePool = new Pool({
      connectionString: roleUrl(runtimeRole, runtimePassword),
      max: 4,
    });
    readerPool = new Pool({
      connectionString: roleUrl(readerRole, readerPassword),
      max: 4,
    });
    verifierPool = new Pool({
      connectionString: roleUrl(verifierRole, verifierPassword),
      max: 1,
    });

    const application = createReferenceApplication({ id: applicationId });
    await provisionReferenceApplication({
      ownerPool,
      application,
      installationId,
      environment: "e2e",
      artifactDigest,
      actor: "playwright-reference-e2e",
      changeReason: "playwright reference-app harness",
      deploymentReference: `e2e-${runId}`,
    });

    for (const [tenantId, name] of [
      [tenantAId, "E2E Tenant A"],
      [tenantBId, "E2E Tenant B"],
    ] as const) {
      await ownerPool.query(
        `INSERT INTO platform_tenants (id, application_id, name) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [tenantId, applicationId, name],
      );
    }

    const read = REFERENCE_PERMISSIONS.readCustomers;
    const create = REFERENCE_PERMISSIONS.createCustomer;
    for (const membership of [
      {
        tenantId: tenantAId,
        principalId: "e2e-staff",
        roles: ["staff"],
        permissions: [read, create],
      },
      {
        tenantId: tenantAId,
        principalId: "e2e-member",
        roles: ["member"],
        permissions: [read],
      },
      {
        tenantId: tenantBId,
        principalId: "e2e-tenant-b",
        roles: ["member"],
        permissions: [read],
      },
    ]) {
      await ownerPool.query(
        `INSERT INTO platform_memberships
           (application_id, tenant_id, principal_id, active, roles, permissions)
         VALUES ($1, $2, $3, true, $4, $5)
         ON CONFLICT (application_id, tenant_id, principal_id) DO UPDATE
           SET active = true, roles = EXCLUDED.roles, permissions = EXCLUDED.permissions`,
        [
          applicationId,
          membership.tenantId,
          membership.principalId,
          membership.roles,
          membership.permissions,
        ],
      );
    }

    const tokens = ReferenceTokenDirectory.fromJson(
      application.id,
      JSON.stringify({
        [staffToken]: {
          id: "e2e-staff",
          kind: "staff",
          tenantIds: [tenantAId],
          roles: ["staff"],
          permissions: [read, create],
        },
        [memberToken]: {
          id: "e2e-member",
          kind: "end_user",
          tenantIds: [tenantAId],
          roles: ["member"],
          permissions: [read],
        },
        [tenantBToken]: {
          id: "e2e-tenant-b",
          kind: "end_user",
          tenantIds: [tenantBId],
          roles: ["member"],
          permissions: [read],
        },
      }),
    );

    await ownerPool.end();

    const started = await startReferenceApplication({
      application,
      installationId,
      tokens,
      verifierPool,
      readerPool,
      runtimePool,
      environment: "e2e",
      artifactDigest,
      runtimePrivilegeContract: REFERENCE_CRM_RUNTIME_PRIVILEGE_CONTRACT,
      host: HOST,
      port: PORT,
      policyVersion: "reference-crm-e2e-1.0.0",
      policy: new PolicyEngine([
        { id: "e2e-read", action: read, effect: "allow" },
        { id: "e2e-create", action: create, effect: "allow" },
      ]),
      onUnexpectedError: (error) => {
        console.error("[platform-reference-e2e] action failed", error);
      },
    });
    app = started.app;
    console.log(
      `[platform-reference-e2e] ${applicationId} listening on http://${HOST}:${PORT}`,
    );

    let shuttingDown = false;
    const shutdown = async (): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      try {
        if (app) await app.close();
      } finally {
        await Promise.allSettled([
          readerPool?.end() ?? Promise.resolve(),
          runtimePool?.end() ?? Promise.resolve(),
          verifierPool?.end() ?? Promise.resolve(),
        ]);
      }
      try {
        await cleanupPlatformReferenceE2e(DATABASE_URL as string, state);
        removeE2eState();
      } catch (error) {
        console.error(
          "[platform-reference-e2e] cleanup failed; global teardown will retry",
          error,
        );
      }
      process.exit(0);
    };
    process.once("SIGTERM", () => void shutdown());
    process.once("SIGINT", () => void shutdown());
  } catch (error) {
    await ownerPool.end().catch(() => undefined);
    await readerPool?.end().catch(() => undefined);
    await runtimePool?.end().catch(() => undefined);
    await verifierPool?.end().catch(() => undefined);
    if (app) await app.close().catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  console.error("[platform-reference-e2e] failed to start", error);
  process.exit(1);
});
