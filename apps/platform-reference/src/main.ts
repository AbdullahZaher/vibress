import { Pool } from "pg";
import {
  PlatformMembershipResolver,
  PostgresApplicationRegistryStore,
} from "@vibress/database";
import { PolicyEngine, TenantUnitOfWork } from "@vibress/tenancy";
import { asInstallationId } from "@vibress/platform-kernel";
import {
  createReferenceApplication,
  REFERENCE_PERMISSIONS,
} from "./application";
import { createReferenceServer } from "./server";
import { ReferenceTokenDirectory } from "./token-directory";

const HOST = process.env.PLATFORM_REFERENCE_HOST ?? "127.0.0.1";
const PORT = Number(process.env.PLATFORM_REFERENCE_PORT ?? "4100");
const POLICY_VERSION = "reference-crm-1.0.0";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main(): Promise<void> {
  const ownerUrl = required("DATABASE_URL");
  const runtimeUrl = required("PLATFORM_RUNTIME_DATABASE_URL");
  if (ownerUrl === runtimeUrl) {
    throw new Error(
      "PLATFORM_RUNTIME_DATABASE_URL must use the non-owner platform runtime role",
    );
  }

  const application = createReferenceApplication();
  const installationId = asInstallationId(
    process.env.PLATFORM_INSTALLATION_ID ?? "reference-installation",
  );
  const tokens = ReferenceTokenDirectory.fromJson(
    application.id,
    process.env.PLATFORM_REFERENCE_TOKENS,
  );
  const ownerPool = new Pool({ connectionString: ownerUrl, max: 4 });
  const runtimePool = new Pool({ connectionString: runtimeUrl, max: 8 });

  try {
    const server = await createReferenceServer({
      application,
      registryStore: new PostgresApplicationRegistryStore(ownerPool),
      membershipResolver: new PlatformMembershipResolver(ownerPool),
      unitOfWork: new TenantUnitOfWork(runtimePool),
      tokens,
      installationId,
      policyVersion: POLICY_VERSION,
      policy: new PolicyEngine([
        {
          id: "reference-crm-read",
          action: REFERENCE_PERMISSIONS.readCustomers,
          effect: "allow",
        },
        {
          id: "reference-crm-create",
          action: REFERENCE_PERMISSIONS.createCustomer,
          effect: "allow",
        },
      ]),
      allowRegistryUpdate: process.env.PLATFORM_REGISTRY_UPDATE === "1",
      onUnexpectedError: (error) => {
        console.error("[platform-reference] action failed", error);
      },
    });

    await server.app.listen({ host: HOST, port: PORT });
    console.log(
      `[platform-reference] ${application.id} listening on http://${HOST}:${PORT} (registration: ${server.registration.outcome})`,
    );

    const shutdown = async (signal: string): Promise<void> => {
      console.log(`[platform-reference] ${signal} received, shutting down`);
      await server.app.close();
      await ownerPool.end();
      await runtimePool.end();
      process.exit(0);
    };
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));
  } catch (error) {
    await ownerPool.end().catch(() => undefined);
    await runtimePool.end().catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  console.error("[platform-reference] failed to start", error);
  process.exit(1);
});
