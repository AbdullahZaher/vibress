import { describe, expect, it } from "vitest";
import {
  asApplicationId,
  asInstallationId,
  asPrincipalId,
  asTenantId,
  defineAction,
  defineApplication,
  InMemoryApplicationRegistry,
  type VerifiedPrincipal,
} from "@vibress/platform-kernel";
import {
  PolicyEngine,
  type MembershipRecord,
  type ScopedTransaction,
  type ScopeResolver,
  type TenantUnitOfWorkRunner,
  type VerifiedScope,
} from "../index";
import { RouteExecutor, RouteExecutorConfigurationError } from "../executor";
import { TenantTransactionRollbackOnlyError } from "../unit-of-work";

const appId = asApplicationId("reference-crm");
const otherAppId = asApplicationId("other-app");
const tenant = asTenantId("tenant-one");
const otherTenant = asTenantId("tenant-two");
const installationId = asInstallationId("installation-one");

const emptyInput = (): null => null;
const createInput = (value: unknown): { name: string } => {
  if (typeof value !== "object" || value === null) {
    throw new Error("body must be an object");
  }
  const name = (value as Record<string, unknown>).name;
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("name is required");
  }
  return { name };
};

const application = defineApplication({
  id: appId,
  name: "Reference CRM",
  version: "1.0.0",
  actions: {
    getCustomer: defineAction({
      name: "getCustomer",
      permission: "customers.read",
      input: emptyInput,
      handler: async ({ context, pathParameters }) => ({
        tenant: context.tenantId,
        principal: context.principal?.id ?? null,
        pathParameters,
      }),
    }),
    createCustomer: defineAction({
      name: "createCustomer",
      permission: "customers.create",
      input: createInput,
      handler: async ({ context, input, transaction }) => {
        await transaction.query("SELECT 1");
        return { created: input.name, tenant: context.tenantId };
      },
    }),
    health: defineAction({
      name: "health",
      permission: "platform.health",
      input: emptyInput,
      handler: async () => ({ status: "ok" }),
    }),
    healthProbe: defineAction({
      name: "healthProbe",
      permission: "platform.health",
      input: emptyInput,
      handler: async ({ transaction }) => transaction.query("SELECT 1"),
    }),
  },
  http: [
    {
      method: "GET",
      path: "/customers/:customerId",
      action: "getCustomer",
      auth: "member",
    },
    {
      method: "POST",
      path: "/customers",
      action: "createCustomer",
      auth: "staff",
    },
    { method: "GET", path: "/health", action: "health", auth: "public" },
    {
      method: "GET",
      path: "/health/probe",
      action: "healthProbe",
      auth: "public",
    },
  ],
});

const registry = new InMemoryApplicationRegistry([application]);

class RecordingUnitOfWork implements TenantUnitOfWorkRunner {
  readonly scopes: VerifiedScope[] = [];
  failure: Error | null = null;

  async run<T>(
    scope: VerifiedScope,
    work: (transaction: ScopedTransaction) => Promise<T>,
  ): Promise<T> {
    this.scopes.push(scope);
    if (this.failure) throw this.failure;
    const transaction: ScopedTransaction = {
      scope,
      query: async <TRow = unknown>() => ({ rows: [] as TRow[], rowCount: 0 }),
      markRollbackOnly: () => {},
    };
    return work(transaction);
  }
}

const membership: MembershipRecord = {
  applicationId: appId,
  tenantId: tenant,
  principalId: asPrincipalId("principal-one"),
  active: true,
  roles: ["member"],
  permissions: ["customers.read", "customers.create"],
};

function scopeResolver(
  record: MembershipRecord | null = membership,
): ScopeResolver {
  return {
    resolve: async (principalId, applicationId) =>
      record ? { ...record, principalId, applicationId } : null,
  };
}

function principal(
  overrides: Partial<VerifiedPrincipal> = {},
): VerifiedPrincipal {
  return {
    id: asPrincipalId("principal-one"),
    kind: "end_user",
    applicationId: appId,
    tenantIds: [tenant],
    roles: ["member"],
    permissions: ["customers.read"],
    ...overrides,
  };
}

const allowCustomers = new PolicyEngine([
  { id: "allow-customers", action: "customers.*", effect: "allow" },
]);

function executor(
  options: {
    unitOfWork?: RecordingUnitOfWork;
    resolver?: ScopeResolver | null;
    policy?: PolicyEngine;
    onUnexpectedError?: (error: unknown) => void;
  } = {},
): {
  executor: RouteExecutor;
  unitOfWork: RecordingUnitOfWork;
} {
  const unitOfWork = options.unitOfWork ?? new RecordingUnitOfWork();
  return {
    unitOfWork,
    executor: new RouteExecutor({
      registry,
      policy: options.policy ?? allowCustomers,
      unitOfWork,
      scopeResolver: options.resolver ?? scopeResolver(),
      policyVersion: "policy-2026-11-14",
      ...(options.onUnexpectedError
        ? { onUnexpectedError: options.onUnexpectedError }
        : {}),
    }),
  };
}

function request(
  overrides: Partial<Parameters<RouteExecutor["execute"]>[0]> = {},
): Parameters<RouteExecutor["execute"]>[0] {
  return {
    method: "GET",
    path: "/customers/customer-42",
    principal: principal(),
    tenantId: tenant,
    installationId,
    requestId: "req-1",
    ...overrides,
  };
}

describe("route executor", () => {
  it("requires a policy version at construction", () => {
    expect(
      () =>
        new RouteExecutor({
          registry,
          policy: allowCustomers,
          unitOfWork: new RecordingUnitOfWork(),
          scopeResolver: scopeResolver(),
          policyVersion: "  ",
        }),
    ).toThrow(RouteExecutorConfigurationError);
  });

  it("returns 404 for an unregistered route", async () => {
    const { executor: routeExecutor, unitOfWork } = executor();
    const response = await routeExecutor.execute(
      request({ method: "DELETE", path: "/customers/customer-42" }),
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "route_not_found",
        message: "no registered route matches the request",
      },
    });
    expect(unitOfWork.scopes).toEqual([]);
  });

  it("rejects an unauthenticated member route", async () => {
    const { executor: routeExecutor, unitOfWork } = executor();
    const response = await routeExecutor.execute(request({ principal: null }));

    expect(response.status).toBe(401);
    expect(unitOfWork.scopes).toEqual([]);
  });

  it("rejects a staff principal on a member route", async () => {
    const { executor: routeExecutor } = executor();
    const response = await routeExecutor.execute(
      request({ principal: principal({ kind: "staff" }) }),
    );

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: { code: "route_requires_member" },
    });
  });

  it("rejects a principal from another application", async () => {
    const { executor: routeExecutor } = executor();
    const response = await routeExecutor.execute(
      request({ principal: principal({ applicationId: otherAppId }) }),
    );

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: { code: "principal_application_mismatch" },
    });
  });

  it("requires a tenant for an authenticated route", async () => {
    const { executor: routeExecutor } = executor();
    const response = await routeExecutor.execute(request({ tenantId: null }));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: "tenant_required" } });
  });

  it("denies by default when no allow rule exists", async () => {
    const { executor: routeExecutor, unitOfWork } = executor({
      policy: new PolicyEngine([]),
    });
    const response = await routeExecutor.execute(request());

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: "policy_denied" } });
    expect(unitOfWork.scopes).toEqual([]);
  });

  it("executes an authorized action inside the tenant unit of work", async () => {
    const { executor: routeExecutor, unitOfWork } = executor();
    const response = await routeExecutor.execute(request());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      tenant,
      principal: "principal-one",
      pathParameters: { customerId: "customer-42" },
    });
    expect(unitOfWork.scopes).toHaveLength(1);
    expect(unitOfWork.scopes[0]?.tenantId).toBe(tenant);
    expect(unitOfWork.scopes[0]?.authorization.policyVersion).toBe(
      "policy-2026-11-14",
    );
  });

  it("runs staff write actions with parsed input", async () => {
    const { executor: routeExecutor } = executor();
    const response = await routeExecutor.execute(
      request({
        method: "POST",
        path: "/customers",
        principal: principal({
          kind: "staff",
          permissions: ["customers.create"],
        }),
        body: { name: "Acme" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ created: "Acme", tenant });
  });

  it("denies when the tenant membership does not grant the action", async () => {
    const { executor: routeExecutor, unitOfWork } = executor({
      resolver: scopeResolver({
        ...membership,
        permissions: ["customers.read"],
      }),
    });
    const response = await routeExecutor.execute(
      request({
        method: "POST",
        path: "/customers",
        principal: principal({
          kind: "staff",
          permissions: ["customers.create"],
        }),
        body: { name: "Acme" },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: "policy_denied" } });
    expect(unitOfWork.scopes).toEqual([]);
  });

  it("returns 400 before opening a transaction for invalid input", async () => {
    const { executor: routeExecutor, unitOfWork } = executor();
    const response = await routeExecutor.execute(
      request({
        method: "POST",
        path: "/customers",
        principal: principal({
          kind: "staff",
          permissions: ["customers.create"],
        }),
        body: { name: "" },
      }),
    );

    expect(response.status).toBe(400);
    expect(unitOfWork.scopes).toEqual([]);
  });

  it("denies the scope when no active membership exists", async () => {
    const { executor: routeExecutor, unitOfWork } = executor({
      resolver: scopeResolver(null),
    });
    const response = await routeExecutor.execute(request());

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: "scope_denied" } });
    expect(unitOfWork.scopes).toEqual([]);
  });

  it("denies a membership that does not entitle the requested tenant", async () => {
    const { executor: routeExecutor } = executor({
      resolver: scopeResolver({ ...membership, tenantId: otherTenant }),
    });
    const response = await routeExecutor.execute(request());

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: "scope_denied" } });
  });

  it("runs public actions without a principal or tenant transaction", async () => {
    const { executor: routeExecutor, unitOfWork } = executor();
    const response = await routeExecutor.execute(
      request({
        method: "GET",
        path: "/health",
        principal: null,
        tenantId: null,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(unitOfWork.scopes).toEqual([]);
  });

  it("denies database access from a public action", async () => {
    const { executor: routeExecutor } = executor();
    const response = await routeExecutor.execute(
      request({
        method: "GET",
        path: "/health/probe",
        principal: null,
        tenantId: null,
      }),
    );

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: { code: "public_action_database_access_denied" },
    });
  });

  it("maps a rollback-only transaction to 409", async () => {
    const unitOfWork = new RecordingUnitOfWork();
    unitOfWork.failure = new TenantTransactionRollbackOnlyError(
      "nested failure",
    );
    const { executor: routeExecutor } = executor({ unitOfWork });
    const response = await routeExecutor.execute(request());

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: { code: "transaction_rolled_back" },
    });
  });

  it("reports unexpected failures without leaking internals", async () => {
    const unitOfWork = new RecordingUnitOfWork();
    unitOfWork.failure = new Error("connection reset by peer");
    let observed: unknown;
    const { executor: routeExecutor } = executor({
      unitOfWork,
      onUnexpectedError: (error) => {
        observed = error;
      },
    });
    const response = await routeExecutor.execute(request());

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: "internal_error", message: "the action failed" },
    });
    expect(observed).toBeInstanceOf(Error);
  });
});
