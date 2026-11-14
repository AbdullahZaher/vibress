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
  if (process.env.DATABASE_URL?.trim()) {
    throw new Error(
      "The request-serving process must not receive DATABASE_URL; run the provisioning executable separately",
    );
  }

  const runtimeUrl = required("PLATFORM_RUNTIME_DATABASE_URL");
  const readerUrl = required("PLATFORM_MEMBERSHIP_READER_DATABASE_URL");
  const verifierUrl = required("PLATFORM_DEPLOYMENT_VERIFIER_DATABASE_URL");
  if (new Set([runtimeUrl, readerUrl, verifierUrl]).size !== 3) {
    throw new Error(
      "PLATFORM_RUNTIME_DATABASE_URL, PLATFORM_MEMBERSHIP_READER_DATABASE_URL and PLATFORM_DEPLOYMENT_VERIFIER_DATABASE_URL must be distinct",
    );
  }

  const application = createReferenceApplication();
  const installationId = asInstallationId(
    process.env.PLATFORM_INSTALLATION_ID ?? "reference-installation",
  );
  const environment = required("PLATFORM_ENVIRONMENT");
  const artifactDigest = required("PLATFORM_ARTIFACT_DIGEST");
  const tokens = ReferenceTokenDirectory.fromJson(
    application.id,
    process.env.PLATFORM_REFERENCE_TOKENS,
  );

  const readerPool = new Pool({ connectionString: readerUrl, max: 4 });
  const runtimePool = new Pool({ connectionString: runtimeUrl, max: 8 });
  const verifierPool = new Pool({ connectionString: verifierUrl, max: 1 });
  // The pools own their credentials; do not leave connection strings in the
  // environment for request handlers or diagnostics to read.
  delete process.env.PLATFORM_RUNTIME_DATABASE_URL;
  delete process.env.PLATFORM_MEMBERSHIP_READER_DATABASE_URL;
  delete process.env.PLATFORM_DEPLOYMENT_VERIFIER_DATABASE_URL;

  try {
    const { app, deployment } = await startReferenceApplication({
      application,
      installationId,
      tokens,
      verifierPool,
      readerPool,
      runtimePool,
      environment,
      artifactDigest,
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
      onUnexpectedError: (error) => {
        console.error("[platform-reference] action failed", error);
      },
    });

    console.log(
      `[platform-reference] ${application.id} listening on http://${HOST}:${PORT} (installation: ${deployment.installation.id}, environment: ${deployment.installation.environment})`,
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
    await readerPool.end().catch(() => undefined);
    await runtimePool.end().catch(() => undefined);
    await verifierPool.end().catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  console.error("[platform-reference] failed to start", error);
  process.exit(1);
});
