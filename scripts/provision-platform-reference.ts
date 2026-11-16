#!/usr/bin/env tsx
/**
 * Operator-only registration/installation provisioning for the reference
 * application. This executable is the only platform path allowed to hold the
 * owner credential and mutate registry or installation state.
 *
 * Required:
 * - DATABASE_URL (owner/migration credential)
 * - PLATFORM_ENVIRONMENT
 * - PLATFORM_ARTIFACT_DIGEST
 * - PLATFORM_REGISTRY_ACTOR
 * - PLATFORM_CHANGE_REASON
 *
 * Optional:
 * - PLATFORM_REFERENCE_APP_ID (default reference-crm)
 * - PLATFORM_INSTALLATION_ID (default reference-installation)
 * - PLATFORM_CHANGE_REFERENCE (deployment/ticket reference)
 * - PLATFORM_REGISTRY_UPDATE=1 (authorize manifest drift update)
 * - PLATFORM_INSTALLATION_UPDATE=1 (authorize an installation update)
 * - PLATFORM_EXPECTED_ENVIRONMENT (installation update CAS)
 * - PLATFORM_EXPECTED_ARTIFACT_DIGEST (installation update CAS; empty = none)
 */
import { Pool } from "pg";
import { asInstallationId } from "@vibress/platform-kernel";
import { createReferenceApplication } from "../apps/platform-reference/src/application";
import { provisionReferenceApplication } from "../apps/platform-reference/src/registration";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

async function main(): Promise<void> {
  const databaseUrl = required("DATABASE_URL");
  const applicationId = optional("PLATFORM_REFERENCE_APP_ID");
  const application = createReferenceApplication(
    applicationId ? { id: applicationId } : {},
  );
  const expectedEnvironment = optional("PLATFORM_EXPECTED_ENVIRONMENT");
  const expectedArtifactDigest =
    process.env.PLATFORM_EXPECTED_ARTIFACT_DIGEST === undefined
      ? undefined
      : process.env.PLATFORM_EXPECTED_ARTIFACT_DIGEST.trim() || null;
  const changeReference = optional("PLATFORM_CHANGE_REFERENCE");
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const provisioned = await provisionReferenceApplication({
      ownerPool: pool,
      application,
      installationId: asInstallationId(
        optional("PLATFORM_INSTALLATION_ID") ?? "reference-installation",
      ),
      environment: required("PLATFORM_ENVIRONMENT"),
      artifactDigest: required("PLATFORM_ARTIFACT_DIGEST"),
      actor: required("PLATFORM_REGISTRY_ACTOR"),
      changeReason: required("PLATFORM_CHANGE_REASON"),
      ...(changeReference !== undefined
        ? { deploymentReference: changeReference }
        : {}),
      ...(process.env.PLATFORM_REGISTRY_UPDATE === "1"
        ? { allowRegistryUpdate: true }
        : {}),
      ...(process.env.PLATFORM_INSTALLATION_UPDATE === "1"
        ? { allowInstallationUpdate: true }
        : {}),
      ...(expectedEnvironment !== undefined
        ? { expectedEnvironment }
        : {}),
      ...(expectedArtifactDigest !== undefined
        ? { expectedArtifactDigest }
        : {}),
    });

    console.log(
      `Provisioned ${application.id} (${provisioned.registration.outcome}, manifest ${provisioned.registration.digest})`,
    );
    console.log(
      `Installation ${provisioned.installation.id}: application=${provisioned.installation.applicationId} environment=${provisioned.installation.environment} artifact=${provisioned.installation.artifactDigest}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    "[provision-platform-reference] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
