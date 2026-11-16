import {
  applicationDefinitionDigest,
  type ApplicationDefinition,
  type InstallationId,
} from "@vibress/platform-kernel";
import {
  InstallationMismatchError,
  PostgresApplicationRegistryStore,
  type ApplicationRegistrationRecord,
  type InstallationRegistrationRecord,
  type RegistryQueryable,
} from "./platform-application-registry";

export class DeploymentVerificationError extends Error {
  constructor(reason: string) {
    super(`Deployment verification failed: ${reason}`);
    this.name = "DeploymentVerificationError";
  }
}

export interface VerifyDeploymentIdentityOptions {
  readonly client: RegistryQueryable;
  readonly application: ApplicationDefinition;
  readonly installationId: InstallationId;
  readonly environment: string;
  readonly artifactDigest: string;
}

export interface VerifiedDeploymentIdentity {
  readonly registration: ApplicationRegistrationRecord;
  readonly installation: InstallationRegistrationRecord;
}

/**
 * Read-only startup proof that this process is the deployment the operator
 * provisioned. It never creates, repairs or updates registry or installation
 * state; the verifier role must not hold write privileges.
 */
export async function verifyDeploymentIdentity(
  options: VerifyDeploymentIdentityOptions,
): Promise<VerifiedDeploymentIdentity> {
  const expectedArtifact = options.artifactDigest.trim();
  if (expectedArtifact === "") {
    throw new DeploymentVerificationError(
      "a deployed artifact digest is required",
    );
  }

  const store = new PostgresApplicationRegistryStore(options.client);
  let installation: InstallationRegistrationRecord;
  try {
    installation = await store.verifyInstallation(
      options.installationId,
      options.application.id,
    );
  } catch (error) {
    if (error instanceof InstallationMismatchError) {
      throw new DeploymentVerificationError(error.message);
    }
    throw new DeploymentVerificationError(
      error instanceof Error ? error.message : "installation lookup failed",
    );
  }

  if (installation.environment !== options.environment) {
    throw new DeploymentVerificationError(
      `installation '${options.installationId}' is registered for environment '${installation.environment}', expected '${options.environment}'`,
    );
  }
  if (installation.artifactDigest !== expectedArtifact) {
    throw new DeploymentVerificationError(
      `installation '${options.installationId}' is pinned to artifact '${installation.artifactDigest ?? "none"}', but this process is artifact '${expectedArtifact}'`,
    );
  }

  const registration = await store.load(options.application.id);
  if (!registration) {
    throw new DeploymentVerificationError(
      `application '${options.application.id}' has no persisted registration`,
    );
  }
  const deployedDigest = applicationDefinitionDigest(options.application);
  if (registration.manifestDigest !== deployedDigest) {
    throw new DeploymentVerificationError(
      `application '${options.application.id}' is registered with manifest ${registration.manifestDigest}, but the deployed code is ${deployedDigest}`,
    );
  }

  return { registration, installation };
}
