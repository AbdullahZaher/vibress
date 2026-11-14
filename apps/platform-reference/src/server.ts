import Fastify, { type FastifyInstance } from "fastify";
import {
  asTenantId,
  InMemoryApplicationRegistry,
  type ApplicationDefinition,
  type HttpMethod,
  type InstallationId,
  type TenantId,
} from "@vibress/platform-kernel";
import {
  RouteExecutor,
  type PolicyEngine,
  type TenantUnitOfWorkRunner,
} from "@vibress/tenancy";
import type { PlatformMembershipResolver } from "@vibress/database";
import type { ReferenceTokenDirectory } from "./token-directory";

export interface ReferenceServerOptions {
  readonly application: ApplicationDefinition;
  readonly membershipResolver: PlatformMembershipResolver;
  readonly unitOfWork: TenantUnitOfWorkRunner;
  readonly tokens: ReferenceTokenDirectory;
  readonly installationId: InstallationId;
  readonly policy: PolicyEngine;
  readonly policyVersion: string;
  readonly kernelVersion?: string;
  readonly onUnexpectedError?: (error: unknown) => void;
}

export interface ReferenceServer {
  readonly app: FastifyInstance;
  readonly executor: RouteExecutor;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  const token = value.trim();
  return token === "" ? null : token;
}

/**
 * Wires the serving process:
 * 1. build the in-memory registry from deployed code;
 * 2. serve every request through the kernel route executor.
 *
 * Persistence is an operator provisioning concern. The serving process only
 * verifies the provisioned identity read-only before this is called.
 */
export async function createReferenceServer(
  options: ReferenceServerOptions,
): Promise<ReferenceServer> {
  const registry = new InMemoryApplicationRegistry(
    [options.application],
    options.kernelVersion ?? "1.2.0",
  );
  const executor = new RouteExecutor({
    registry,
    policy: options.policy,
    unitOfWork: options.unitOfWork,
    scopeResolver: options.membershipResolver,
    policyVersion: options.policyVersion,
    ...(options.onUnexpectedError
      ? { onUnexpectedError: options.onUnexpectedError }
      : {}),
  });

  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  app.all("/*", async (request, reply) => {
    let tenantId: TenantId | null = null;
    const rawTenant = request.headers["x-tenant-id"];
    if (typeof rawTenant === "string" && rawTenant.trim() !== "") {
      try {
        tenantId = asTenantId(rawTenant.trim());
      } catch {
        return reply.status(400).send({
          error: {
            code: "invalid_tenant",
            message: "x-tenant-id is not a valid tenant identifier",
          },
        });
      }
    }

    const token = bearerToken(request.headers.authorization);
    const result = await executor.execute({
      method: request.method as HttpMethod,
      path: request.url,
      principal: token ? options.tokens.resolve(token) : null,
      tenantId,
      installationId: options.installationId,
      requestId: request.id,
      body: request.body,
    });
    return reply.status(result.status).send(result.body);
  });

  app.setErrorHandler((error, _request, reply) => {
    options.onUnexpectedError?.(error);
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 400) {
      return reply.status(400).send({
        error: {
          code: "invalid_request",
          message: "request could not be parsed",
        },
      });
    }
    return reply.status(500).send({
      error: { code: "internal_error", message: "the request failed" },
    });
  });

  return { app, executor };
}
