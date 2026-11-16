import type { Pool } from "pg";
import {
  InstallationUpdateRequiredError,
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
  /** Required operator identity for every registry and installation mutation. */
  readonly actor: string;
  /** Why this deployment changes the persisted registry or installation. */
  readonly changeReason: string;
  /** Change/deployment ticket recorded with installation changes. */
  readonly deploymentReference?: string;
  readonly allowRegistryUpdate?: boolean;
  /** Authorizes an installation update; still requires both CAS guards. */
  readonly allowInstallationUpdate?: boolean;
  /** Expected persisted environment when changing an existing installation. */
  readonly expectedEnvironment?: string;
  /** Expected persisted artifact when changing an installation (`null` = none). */
  readonly expectedArtifactDigest?: string | null;
}

export interface ProvisionedApplication {
  readonly registration: RegistrySyncResult;
  readonly installation: InstallationRegistrationRecord;
}

/**
 * Operator-only provisioning phase: persists the deployed manifest, verifies
 * the registry, creates or CAS-updates the installation and proves the
 * persisted result, all in one transaction. A failure after the manifest was
 * written rolls the manifest, installation and both audit streams back
 * together.
 *
 * It is invoked by the deployment/registration executable, never by the
 * long-lived request server.
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
  const reason = options.changeReason.trim();
  if (reason === "") {
    throw new Error("changeReason is required for provisioning");
  }

  const client = await options.ownerPool.connect();
  let beginSucceeded = false;
  let commitAttempted = false;
  let destroyConnection = false;
  try {
    await client.query("BEGIN");
    beginSucceeded = true;
    const store = new PostgresApplicationRegistryStore(client);

    const registration = await store.sync(options.application, {
      actor,
      ...(options.allowRegistryUpdate ? { allowUpdate: true } : {}),
    });
    await store.verifyDefinitions([options.application]);

    const existing = await store.loadInstallation(options.installationId);
    if (!existing) {
      await store.registerInstallation({
        id: options.installationId,
        applicationId: options.application.id,
        environment: options.environment,
        artifactDigest,
        actor,
        reason,
        deploymentReference: options.deploymentReference ?? null,
      });
    } else if (
      existing.applicationId !== options.application.id ||
      existing.environment !== options.environment ||
      existing.artifactDigest !== artifactDigest
    ) {
      if (!options.allowInstallationUpdate) {
        throw new InstallationUpdateRequiredError(
          String(options.installationId),
        );
      }
      if (
        options.expectedEnvironment === undefined ||
        options.expectedArtifactDigest === undefined
      ) {
        throw new Error(
          "an installation update requires both expectedEnvironment and expectedArtifactDigest (use null when no artifact is pinned)",
        );
      }
      await store.updateInstallation({
        id: options.installationId,
        applicationId: options.application.id,
        environment: options.environment,
        artifactDigest,
        actor,
        reason,
        deploymentReference: options.deploymentReference ?? null,
        expectedEnvironment: options.expectedEnvironment,
        expectedArtifactDigest: options.expectedArtifactDigest,
      });
    }

    const verified = await verifyDeploymentIdentity({
      client,
      application: options.application,
      installationId: options.installationId,
      environment: options.environment,
      artifactDigest,
    });

    commitAttempted = true;
    await client.query("COMMIT");
    return { registration, installation: verified.installation };
  } catch (error) {
    if (beginSucceeded) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection no longer has a known transaction state.
        destroyConnection = true;
      }
    } else {
      // BEGIN itself failed, so the session state is unknown.
      destroyConnection = true;
    }
    if (commitAttempted) {
      // A failed COMMIT may still have committed on the server. The outcome is
      // unknown, so the connection must never be reused.
      destroyConnection = true;
    }
    throw error;
  } finally {
    if (destroyConnection) {
      client.release(true);
    } else {
      client.release();
    }
  }
}
