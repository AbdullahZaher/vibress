import { Pool } from "pg";
import { PolicyEngine } from "@vibress/tenancy";
import { asInstallationId } from "@vibress/platform-kernel";
import {
  createReferenceApplication,
  REFERENCE_PERMISSIONS,
} from "./application";
import { startReferenceApplication } from "./start";
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
  const readerUrl = required("PLATFORM_MEMBERSHIP_READER_DATABASE_URL");
  if (new Set([ownerUrl, runtimeUrl, readerUrl]).size !== 3) {
    throw new Error(
      "DATABASE_URL, PLATFORM_RUNTIME_DATABASE_URL and PLATFORM_MEMBERSHIP_READER_DATABASE_URL must be distinct",
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
  const readerPool = new Pool({ connectionString: readerUrl, max: 4 });
  const runtimePool = new Pool({ connectionString: runtimeUrl, max: 8 });

  try {
    const { app, registration } = await startReferenceApplication({
      application,
      installationId,
      tokens,
      ownerPool,
      readerPool,
      runtimePool,
      environment: process.env.NODE_ENV ?? "development",
      host: HOST,
      port: PORT,
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
      ...(process.env.PLATFORM_REGISTRY_UPDATE === "1"
        ? { allowRegistryUpdate: true }
        : {}),
      ...(process.env.PLATFORM_REGISTRY_ACTOR?.trim()
        ? { registryActor: process.env.PLATFORM_REGISTRY_ACTOR.trim() }
        : {}),
      onUnexpectedError: (error) => {
        console.error("[platform-reference] action failed", error);
      },
    });

    console.log(
      `[platform-reference] ${application.id} listening on http://${HOST}:${PORT} (registration: ${registration.outcome})`,
    );

    const shutdown = async (signal: string): Promise<void> => {
      console.log(`[platform-reference] ${signal} received, shutting down`);
      await app.close();
      await readerPool.end();
      await runtimePool.end();
      process.exit(0);
    };
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));
  } catch (error) {
    await ownerPool.end().catch(() => undefined);
    await readerPool.end().catch(() => undefined);
    await runtimePool.end().catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  console.error("[platform-reference] failed to start", error);
  process.exit(1);
});
