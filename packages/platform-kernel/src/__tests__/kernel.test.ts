import { describe, expect, it } from "vitest";
import {
  asApplicationId,
  asTenantId,
  InvalidPlatformIdentityError,
  LEGACY_PUBLICATION_FALLBACK,
} from "../identity";
import {
  defineAction,
  defineApplication,
  defineModule,
  defineRoute,
  isCompatibleKernel,
  InvalidApplicationDefinitionError,
} from "../application";
import {
  DuplicateApplicationError,
  InMemoryApplicationRegistry,
} from "../registry";

const textInput = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("expected non-empty string");
  }
  return value;
};

function crmApplication() {
  return defineApplication({
    id: "customer-crm",
    name: "Customer CRM",
    version: "1.0.0",
    actions: {
      listCustomers: defineAction({
        name: "listCustomers",
        permission: "customers.read",
        input: textInput,
        handler: async () => ({ rows: [] }),
      }),
      approveDeal: defineAction({
        name: "approveDeal",
        permission: "deals.approve",
        input: textInput,
        handler: async ({ input }) => ({ approved: input }),
      }),
    },
    http: [
      defineRoute({
        method: "POST",
        path: "/api/deals/:id/approve",
        action: "approveDeal",
        auth: "staff",
      }),
    ],
    web: {
      clientPackage: "@example/crm-web",
      publicRoutes: ["/"],
      authenticatedRoutes: ["/dashboard"],
    },
  });
}

describe("platform identities", () => {
  it("rejects the legacy publication fallback for application and tenant ids", () => {
    expect(() => asApplicationId(LEGACY_PUBLICATION_FALLBACK)).toThrow(
      InvalidPlatformIdentityError,
    );
    expect(() => asTenantId(LEGACY_PUBLICATION_FALLBACK)).toThrow(
      InvalidPlatformIdentityError,
    );
  });

  it("rejects identifiers that would need quoting", () => {
    expect(() => asApplicationId('bad"name')).toThrow(
      InvalidPlatformIdentityError,
    );
    expect(() => asTenantId("Tenant-A")).toThrow(InvalidPlatformIdentityError);
  });
});

describe("defineApplication", () => {
  it("accepts a publishing-independent application definition", () => {
    const app = crmApplication();
    expect(app.id).toBe("customer-crm");
    expect(Object.keys(app.actions).sort()).toEqual([
      "approveDeal",
      "listCustomers",
    ]);
    expect(app.http[0]?.path).toBe("/api/deals/:id/approve");
  });

  it("rejects duplicate routes", () => {
    expect(() =>
      defineApplication({
        id: "customer-crm",
        name: "Customer CRM",
        version: "1.0.0",
        actions: {
          approveDeal: defineAction({
            name: "approveDeal",
            permission: "deals.approve",
            input: textInput,
            handler: async () => null,
          }),
        },
        http: [
          { method: "POST", path: "/deals/:id/approve", action: "approveDeal", auth: "staff" },
          { method: "POST", path: "/deals/:id/approve", action: "approveDeal", auth: "staff" },
        ],
      }),
    ).toThrow(InvalidApplicationDefinitionError);
  });

  it("rejects routes that reference undeclared actions", () => {
    expect(() =>
      defineApplication({
        id: "customer-crm",
        name: "Customer CRM",
        version: "1.0.0",
        http: [
          { method: "GET", path: "/deals", action: "missingAction", auth: "staff" },
        ],
      }),
    ).toThrow(/unknown action/);
  });

  it("requires dotted permissions", () => {
    expect(() =>
      defineAction({
        name: "approveDeal",
        permission: "approve",
        input: textInput,
        handler: async () => null,
      }),
    ).toThrow(/dotted permission/);
  });

  it("rejects action key and name mismatches", () => {
    expect(() =>
      defineApplication({
        id: "customer-crm",
        name: "Customer CRM",
        version: "1.0.0",
        actions: {
          wrongKey: defineAction({
            name: "approveDeal",
            permission: "deals.approve",
            input: textInput,
            handler: async () => null,
          }),
        },
      }),
    ).toThrow(/does not match action name/);
  });
});

describe("module compatibility", () => {
  it("accepts compatible caret ranges and rejects incompatible majors", () => {
    expect(isCompatibleKernel("^1.2.0", "1.2.0")).toBe(true);
    expect(isCompatibleKernel("^1.2.0", "1.3.4")).toBe(true);
    expect(isCompatibleKernel("^1.2.0", "2.0.0")).toBe(false);
    expect(isCompatibleKernel(">=1.2.0", "1.2.1")).toBe(true);
    expect(isCompatibleKernel(">=1.3.0", "1.2.9")).toBe(false);
  });

  it("rejects a module that requires a newer kernel", () => {
    const module = defineModule({
      id: "inventory",
      version: "1.0.0",
      kernelRange: "^2.0.0",
    });
    const app = defineApplication({
      id: "customer-crm",
      name: "CRM",
      version: "1.0.0",
      modules: [module],
    });
    const registry = new InMemoryApplicationRegistry([], "1.2.0");
    expect(() => registry.register(app)).toThrow(/requires kernel/);
  });
});

describe("InMemoryApplicationRegistry", () => {
  it("resolves parameterized routes to their action", () => {
    const registry = new InMemoryApplicationRegistry([crmApplication()]);
    const resolution = registry.resolveRoute(
      "POST",
      "/api/deals/deal_123/approve",
    );
    expect(resolution?.action.name).toBe("approveDeal");
    expect(resolution?.pathParameters).toEqual({ id: "deal_123" });
    expect(
      registry.resolveRoute("POST", "/api/deals/deal_123/approve/extra"),
    ).toBeUndefined();
  });

  it("rejects duplicate application registration", () => {
    const registry = new InMemoryApplicationRegistry([crmApplication()]);
    expect(() => registry.register(crmApplication())).toThrow(
      DuplicateApplicationError,
    );
  });

  it("does not resolve actions across applications", () => {
    const registry = new InMemoryApplicationRegistry([crmApplication()]);
    expect(registry.resolveAction("customer-crm", "approveDeal")?.action.name).toBe(
      "approveDeal",
    );
    expect(registry.resolveAction("other-app", "approveDeal")).toBeUndefined();
  });
});
