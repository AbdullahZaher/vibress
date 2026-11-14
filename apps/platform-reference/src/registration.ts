import type { Pool } from "pg";
import {
  PostgresApplicationRegistryStore,
  verifyDeploymentIdentity,
  type InstallationRegistrationRecord,
  type RegistrySyncResult,
} from "@vibress/database";
import type {
  ApplicationDefinition,
  InstallationId,
} from "@vibress/platform-kernel";

export interface ApplicationProvisioningOptions {
  /** Owner credentials. This process must be separate from the server. */
  readonly ownerPool: Pool;
  readonly application: ApplicationDefinition;
  readonly installationId: InstallationId;
  readonly environment: string;
  /** Digest assigned by the deployment/build pipeline for this artifact. */
  readonly artifactDigest: string;
  /** Required operator identity for every registry mutation. */
  readonly actor: string;
  readonly allowRegistryUpdate?: boolean;
  /** Optional compare-and-swap guards for an authorized update. */
  readonly expectedEnvironment?: string;
  readonly expectedArtifactDigest?: string;
}

export interface ProvisionedApplication {
  readonly registration: RegistrySyncResult;
  readonly installation: InstallationRegistrationRecord;
}

/**
 * Operator-only provisioning phase: persists the deployed manifest, verifies
 * the registry, binds the installation and proves the persisted result. It is
 * invoked by the deployment/registration executable, never by the long-lived
 * request server.
 */
export async function provisionReferenceApplication(
  options: ApplicationProvisioningOptions,
): Promise<ProvisionedApplication> {
  const artifactDigest = options.artifactDigest.trim();
  if (artifactDigest === "") {
    throw new Error("artifactDigest is required for provisioning");
  }
  const actor = options.actor.trim();
  if (actor === "") {
    throw new Error("actor is required for provisioning");
  }

  const store = new PostgresApplicationRegistryStore(options.ownerPool);
  const registration = await store.sync(options.application, {
    actor,
    ...(options.allowRegistryUpdate ? { allowUpdate: true } : {}),
  });
  await store.verifyDefinitions([options.application]);
  await store.syncInstallation({
    id: options.installationId,
    applicationId: options.application.id,
    environment: options.environment,
    artifactDigest,
    ...(options.expectedEnvironment !== undefined
      ? { expectedEnvironment: options.expectedEnvironment }
      : {}),
    ...(options.expectedArtifactDigest !== undefined
      ? { expectedArtifactDigest: options.expectedArtifactDigest }
      : {}),
  });

  const verified = await verifyDeploymentIdentity({
    client: options.ownerPool,
    application: options.application,
    installationId: options.installationId,
    environment: options.environment,
    artifactDigest,
  });

  return { registration, installation: verified.installation };
}
