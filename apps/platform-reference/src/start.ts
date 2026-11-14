import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  assertSafePlatformDeploymentVerifierRole,
  assertSafePlatformMembershipReaderRole,
  assertSafePlatformRuntimeRole,
  PlatformMembershipResolver,
  verifyDeploymentIdentity,
  type PlatformRuntimePrivilegeContract,
  type VerifiedDeploymentIdentity,
} from "@vibress/database";
import type {
  ApplicationDefinition,
  InstallationId,
} from "@vibress/platform-kernel";
import { TenantUnitOfWork, type PolicyEngine } from "@vibress/tenancy";
import { createReferenceServer } from "./server";
import type { ReferenceTokenDirectory } from "./token-directory";

export interface StartReferenceOptions {
  readonly application: ApplicationDefinition;
  readonly installationId: InstallationId;
  readonly tokens: ReferenceTokenDirectory;
  readonly policy: PolicyEngine;
  readonly policyVersion: string;
  readonly environment: string;
  /** Digest assigned by the deployment/build pipeline for this artifact. */
  readonly artifactDigest: string;
  /**
   * Exact database authority this runtime profile may hold. The boot assertion
   * rejects any effective privilege outside the contract.
   */
  readonly runtimePrivilegeContract: PlatformRuntimePrivilegeContract;
  /** Read-only verifier. Closed after the boot proof completes. */
  readonly verifierPool: Pool;
  /** Membership directory reader: SELECT on platform_memberships only. */
  readonly readerPool: Pool;
  /** Tenant runtime role: RLS-bound DML, no registry access. */
  readonly runtimePool: Pool;
  readonly host: string;
  readonly port: number;
  readonly onUnexpectedError?: (error: unknown) => void;
}

export interface StartedReferenceApplication {
  readonly app: FastifyInstance;
  readonly deployment: VerifiedDeploymentIdentity;
  readonly address: string;
}

/**
 * Boots the serving process without any owner credential:
 * 1. asserts the least-privilege runtime, reader and verifier roles;
 * 2. verifies the provisioned installation, environment, artifact and
 *    manifest digest read-only;
 * 3. closes the verifier pool and binds the listener using runtime + reader.
 *
 * Registry and installation writes belong to the separate provisioning
 * executable and cannot occur here.
 */
export async function startReferenceApplication(
  options: StartReferenceOptions,
): Promise<StartedReferenceApplication> {
  const runtimeRole = await assertSafePlatformRuntimeRole(options.runtimePool, {
    profile: "runtime",
    privilegeContract: options.runtimePrivilegeContract,
  });
  const readerRole = await assertSafePlatformMembershipReaderRole(
    options.readerPool,
  );
  const verifierRole = await assertSafePlatformDeploymentVerifierRole(
    options.verifierPool,
  );

  const identityNames = [
    runtimeRole.currentUser,
    readerRole.currentUser,
    verifierRole.currentUser,
  ];
  if (new Set(identityNames).size !== identityNames.length) {
    throw new Error(
      "Runtime, membership reader and deployment verifier connections must authenticate as three different roles",
    );
  }

  let deployment: VerifiedDeploymentIdentity;
  try {
    deployment = await verifyDeploymentIdentity({
      client: options.verifierPool,
      application: options.application,
      installationId: options.installationId,
      environment: options.environment,
      artifactDigest: options.artifactDigest,
    });
  } finally {
    await options.verifierPool.end().catch(() => undefined);
  }

  const server = await createReferenceServer({
    application: options.application,
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

  return { app: server.app, deployment, address };
}
