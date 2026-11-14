import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  assertSafePlatformMembershipReaderRole,
  assertSafePlatformRuntimeRole,
  PlatformMembershipResolver,
  type RegistrySyncResult,
} from "@vibress/database";
import type {
  ApplicationDefinition,
  InstallationId,
} from "@vibress/platform-kernel";
import { TenantUnitOfWork, type PolicyEngine } from "@vibress/tenancy";
import { createReferenceServer } from "./server";
import { registerApplicationInstallation } from "./registration";
import type { ReferenceTokenDirectory } from "./token-directory";

export interface StartReferenceOptions {
  readonly application: ApplicationDefinition;
  readonly installationId: InstallationId;
  readonly tokens: ReferenceTokenDirectory;
  readonly policy: PolicyEngine;
  readonly policyVersion: string;
  readonly environment: string;
  /** Owner credentials. Closed by this function before the socket is bound. */
  readonly ownerPool: Pool;
  /** Membership directory reader: SELECT on platform_memberships only. */
  readonly readerPool: Pool;
  /** Tenant runtime role: RLS-bound DML, no registry access. */
  readonly runtimePool: Pool;
  readonly host: string;
  readonly port: number;
  readonly allowRegistryUpdate?: boolean;
  /** Operator identity recorded when the registry is created or updated. */
  readonly registryActor?: string;
  readonly onUnexpectedError?: (error: unknown) => void;
}

export interface StartedReferenceApplication {
  readonly app: FastifyInstance;
  readonly registration: RegistrySyncResult;
  readonly address: string;
}

/**
 * Runs the owner-only boot phase, closes the owner pool, and only then binds
 * the listening socket. The serving process keeps the reader and runtime pools
 * only, so no owner credential survives into request handling.
 */
export async function startReferenceApplication(
  options: StartReferenceOptions,
): Promise<StartedReferenceApplication> {
  const runtimeRole = await assertSafePlatformRuntimeRole(options.runtimePool);
  const readerRole = await assertSafePlatformMembershipReaderRole(
    options.readerPool,
  );

  const ownerUser = (
    await options.ownerPool.query<{ current_user: string }>(
      "SELECT current_user",
    )
  ).rows[0]?.current_user;
  if (!ownerUser) {
    throw new Error("Unable to resolve the DATABASE_URL identity");
  }
  if (ownerUser === runtimeRole.currentUser) {
    throw new Error(
      `DATABASE_URL and PLATFORM_RUNTIME_DATABASE_URL both authenticate as '${ownerUser}'. Runtime role must be a separate, non-owner role.`,
    );
  }
  if (ownerUser === readerRole.currentUser) {
    throw new Error(
      `DATABASE_URL and PLATFORM_MEMBERSHIP_READER_DATABASE_URL both authenticate as '${ownerUser}'. Reader role must be a separate, non-owner role.`,
    );
  }
  if (runtimeRole.currentUser === readerRole.currentUser) {
    throw new Error(
      "Runtime and membership reader connections must authenticate as different roles",
    );
  }

  const registration = await registerApplicationInstallation({
    ownerPool: options.ownerPool,
    application: options.application,
    installationId: options.installationId,
    environment: options.environment,
    ...(options.allowRegistryUpdate ? { allowRegistryUpdate: true } : {}),
    ...(options.registryActor ? { registryActor: options.registryActor } : {}),
  });

  await options.ownerPool.end();

  const server = await createReferenceServer({
    application: options.application,
    registration,
    membershipResolver: new PlatformMembershipResolver(options.readerPool),
    unitOfWork: new TenantUnitOfWork(options.runtimePool),
    tokens: options.tokens,
    installationId: options.installationId,
    policyVersion: options.policyVersion,
    policy: options.policy,
    ...(options.onUnexpectedError
      ? { onUnexpectedError: options.onUnexpectedError }
      : {}),
  });

  const address = await server.app.listen({
    host: options.host,
    port: options.port,
  });

  return { app: server.app, registration, address };
}
