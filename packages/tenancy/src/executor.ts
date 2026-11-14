import type {
  ActionTransaction,
  ApplicationDefinition,
  ApplicationRegistry,
  HttpMethod,
  InstallationId,
  PrincipalKind,
  RequestContext,
  RouteAuth,
  TenantId,
  VerifiedPrincipal,
} from "@vibress/platform-kernel";
import { hasPermission, type PolicyEngine } from "./policy";
import {
  resolveVerifiedScope,
  ScopeVerificationError,
  type ScopeResolver,
  type VerifiedScope,
} from "./scope";
import {
  TenantTransactionRollbackOnlyError,
  TenantScopeMutationError,
  type TenantUnitOfWorkRunner,
} from "./unit-of-work";

export interface RouteExecutionRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly principal: VerifiedPrincipal | null;
  readonly tenantId: TenantId | null;
  readonly installationId: InstallationId;
  readonly requestId: string;
  readonly body?: unknown;
}

export interface RouteExecutionResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface RouteExecutorOptions {
  readonly registry: ApplicationRegistry;
  readonly policy: PolicyEngine;
  readonly unitOfWork: TenantUnitOfWorkRunner;
  readonly scopeResolver: ScopeResolver | null;
  readonly policyVersion: string;
  readonly onUnexpectedError?: (error: unknown) => void;
}

export class RouteExecutorConfigurationError extends Error {
  constructor(reason: string) {
    super(`Route executor is misconfigured: ${reason}`);
    this.name = "RouteExecutorConfigurationError";
  }
}

export class PublicActionTransactionError extends Error {
  constructor() {
    super(
      "unauthenticated public actions cannot access tenant-scoped database state",
    );
    this.name = "PublicActionTransactionError";
  }
}

const ROUTE_PRINCIPAL_KINDS = {
  member: "end_user",
  staff: "staff",
  service: "service",
} as const satisfies Record<Exclude<RouteAuth, "public">, PrincipalKind>;

/**
 * Unauthenticated routes execute without a tenant scope. Their actions are
 * structurally denied database access instead of receiving an unscoped
 * connection, so a public action cannot read tenant data by accident.
 */
const PUBLIC_ACTION_TRANSACTION: ActionTransaction = Object.freeze({
  query: async <TRow = unknown>(): Promise<{
    rows: TRow[];
    rowCount: number | null;
  }> => {
    throw new PublicActionTransactionError();
  },
});

function failure(
  status: number,
  code: string,
  message: string,
): RouteExecutionResponse {
  return { status, body: { error: { code, message } } };
}

type Resolution = NonNullable<ReturnType<ApplicationRegistry["resolveRoute"]>>;

type AuthorizedRequest =
  | {
      readonly kind: "authenticated";
      readonly principal: VerifiedPrincipal;
      readonly tenantId: TenantId;
    }
  | { readonly kind: "public" }
  | { readonly kind: "rejected"; readonly response: RouteExecutionResponse };

/**
 * Framework-agnostic adapter that turns a resolved HTTP route into an action
 * execution: route-kind authentication, default-deny policy, verified tenant
 * scope, tenant transaction, then the developer-owned handler.
 */
export class RouteExecutor {
  readonly #options: RouteExecutorOptions;

  constructor(options: RouteExecutorOptions) {
    if (options.policyVersion.trim() === "") {
      throw new RouteExecutorConfigurationError(
        "policyVersion must record the policy snapshot in force",
      );
    }
    this.#options = options;
  }

  async execute(
    request: RouteExecutionRequest,
  ): Promise<RouteExecutionResponse> {
    const resolution = this.#options.registry.resolveRoute(
      request.method,
      request.path,
    );
    if (!resolution) {
      return failure(
        404,
        "route_not_found",
        "no registered route matches the request",
      );
    }

    try {
      return await this.#executeResolved(resolution, request);
    } catch (error) {
      return this.#mapError(error);
    }
  }

  async #executeResolved(
    resolution: Resolution,
    request: RouteExecutionRequest,
  ): Promise<RouteExecutionResponse> {
    const { application, action, pathParameters } = resolution;
    const authorized = this.#authorize(
      application,
      resolution.route.auth,
      request,
    );
    if (authorized.kind === "rejected") return authorized.response;

    let input: unknown;
    try {
      input = action.input(request.body ?? null);
    } catch {
      return failure(400, "invalid_input", "request body is invalid");
    }

    const baseContext = {
      requestId: request.requestId,
      applicationId: application.id,
      installationId: request.installationId,
      surface: "http" as const,
    };

    if (authorized.kind === "public") {
      const context: RequestContext = {
        ...baseContext,
        tenantId: null,
        principal: null,
      };
      const body = await action.handler({
        context,
        input,
        transaction: PUBLIC_ACTION_TRANSACTION,
        pathParameters,
      });
      return { status: 200, body };
    }

    const scope = await this.#resolveScope(
      application,
      authorized.principal,
      authorized.tenantId,
    );

    // A tenant membership is the authorization snapshot for tenant-owned
    // actions: the token's grant alone is not enough to act inside a tenant.
    if (!hasPermission(scope.authorization.permissions, action.permission)) {
      return failure(
        403,
        "policy_denied",
        `tenant membership does not grant ${action.permission}`,
      );
    }

    const decision = this.#options.policy.decide({
      principal: authorized.principal,
      action: action.permission,
      scopeTenantId: scope.tenantId,
    });
    if (decision.effect !== "allow") {
      return failure(403, "policy_denied", decision.reason);
    }

    const context: RequestContext = {
      ...baseContext,
      tenantId: scope.tenantId,
      principal: authorized.principal,
    };
    const body = await this.#options.unitOfWork.run(scope, (transaction) =>
      action.handler({ context, input, transaction, pathParameters }),
    );
    return { status: 200, body };
  }

  #authorize(
    application: ApplicationDefinition,
    auth: RouteAuth,
    request: RouteExecutionRequest,
  ): AuthorizedRequest {
    if (auth === "public") return { kind: "public" };

    const principal = request.principal;
    if (!principal) {
      return {
        kind: "rejected",
        response: failure(
          401,
          "authentication_required",
          `route requires ${auth} authentication`,
        ),
      };
    }
    if (principal.applicationId !== application.id) {
      return {
        kind: "rejected",
        response: failure(
          403,
          "principal_application_mismatch",
          "principal does not belong to the resolved application",
        ),
      };
    }
    if (principal.kind !== ROUTE_PRINCIPAL_KINDS[auth]) {
      return {
        kind: "rejected",
        response: failure(
          403,
          `route_requires_${auth}`,
          `route requires a ${auth} principal`,
        ),
      };
    }
    if (!request.tenantId) {
      return {
        kind: "rejected",
        response: failure(
          400,
          "tenant_required",
          `route requires a tenant for ${auth} execution`,
        ),
      };
    }
    return { kind: "authenticated", principal, tenantId: request.tenantId };
  }

  async #resolveScope(
    application: ApplicationDefinition,
    principal: VerifiedPrincipal,
    tenantId: TenantId,
  ): Promise<VerifiedScope> {
    const resolver = this.#options.scopeResolver;
    if (!resolver) {
      throw new RouteExecutorConfigurationError(
        "authenticated routes require a scope resolver",
      );
    }
    try {
      return await resolveVerifiedScope(resolver, {
        applicationId: application.id,
        tenantId,
        principal,
        policyVersion: this.#options.policyVersion,
      });
    } catch (error) {
      if (error instanceof ScopeVerificationError) {
        throw new ScopeDeniedError(error.message);
      }
      throw error;
    }
  }

  #mapError(error: unknown): RouteExecutionResponse {
    if (error instanceof ScopeDeniedError) {
      return failure(403, "scope_denied", error.message);
    }
    if (error instanceof PublicActionTransactionError) {
      return failure(
        403,
        "public_action_database_access_denied",
        error.message,
      );
    }
    if (error instanceof TenantScopeMutationError) {
      return failure(403, "scope_mutation_denied", error.message);
    }
    if (error instanceof TenantTransactionRollbackOnlyError) {
      return failure(409, "transaction_rolled_back", error.message);
    }
    this.#options.onUnexpectedError?.(error);
    return failure(500, "internal_error", "the action failed");
  }
}

class ScopeDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeDeniedError";
  }
}
