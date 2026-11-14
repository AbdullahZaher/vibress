import type { Pool } from "pg";
import {
  PostgresApplicationRegistryStore,
  type RegistrySyncResult,
} from "@vibress/database";
import type {
  ApplicationDefinition,
  InstallationId,
} from "@vibress/platform-kernel";

export interface ApplicationRegistrationOptions {
  readonly ownerPool: Pool;
  readonly application: ApplicationDefinition;
  readonly installationId: InstallationId;
  readonly environment: string;
  readonly allowRegistryUpdate?: boolean;
  /** Operator identity recorded when the registry is created or updated. */
  readonly registryActor?: string;
}

/**
 * Owner-only boot phase: persists the deployed manifest, verifies the full
 * registry and binds this installation. Runs before the serving pools are
 * used; the caller must close the owner pool afterwards.
 */
export async function registerApplicationInstallation(
  options: ApplicationRegistrationOptions,
): Promise<RegistrySyncResult> {
  const store = new PostgresApplicationRegistryStore(options.ownerPool);
  const registration = await store.sync(options.application, {
    ...(options.allowRegistryUpdate ? { allowUpdate: true } : {}),
    ...(options.registryActor ? { actor: options.registryActor } : {}),
  });
  await store.verifyDefinitions([options.application]);
  await store.syncInstallation({
    id: options.installationId,
    applicationId: options.application.id,
    environment: options.environment,
  });
  return registration;
}
