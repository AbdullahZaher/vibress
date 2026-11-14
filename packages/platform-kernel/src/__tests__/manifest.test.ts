import { describe, expect, it } from "vitest";
import { defineAction, defineApplication, defineModule } from "../application";
import {
  APPLICATION_MANIFEST_SCHEMA_VERSION,
  applicationDefinitionDigest,
  applicationManifestDigest,
  InvalidApplicationManifestError,
  parseApplicationManifest,
  serializeApplicationManifest,
  toApplicationManifest,
} from "../manifest";

const noInput = (): null => null;

function crmApplication(overrides: { permission?: string } = {}) {
  return defineApplication({
    id: "customer-crm",
    name: "Customer CRM",
    version: "1.0.0",
    actions: {
      listCustomers: defineAction({
        name: "listCustomers",
        permission: overrides.permission ?? "customers.read",
        input: noInput,
        handler: async () => ({ rows: [] }),
      }),
      createCustomer: defineAction({
        name: "createCustomer",
        permission: "customers.create",
        input: noInput,
        handler: async () => ({ id: "generated" }),
      }),
    },
    http: [
      {
        method: "GET",
        path: "/customers",
        action: "listCustomers",
        auth: "member",
      },
      {
        method: "POST",
        path: "/customers",
        action: "createCustomer",
        auth: "staff",
      },
    ],
    web: {
      clientPackage: "@example/crm-web",
      publicRoutes: ["/"],
      authenticatedRoutes: ["/customers"],
    },
    modules: [
      defineModule({
        id: "crm-core",
        version: "1.0.0",
        kernelRange: "^1.2.0",
        actions: {
          ping: defineAction({
            name: "ping",
            permission: "crm.ping",
            input: noInput,
            handler: async () => "pong",
          }),
        },
        http: [
          { method: "GET", path: "/crm/ping", action: "ping", auth: "service" },
        ],
      }),
    ],
  });
}

describe("application manifest", () => {
  it("captures the definition without handler code", () => {
    const manifest = toApplicationManifest(crmApplication());

    expect(manifest.schemaVersion).toBe(APPLICATION_MANIFEST_SCHEMA_VERSION);
    expect(manifest.id).toBe("customer-crm");
    expect(manifest.actions).toEqual([
      { name: "createCustomer", permission: "customers.create" },
      { name: "listCustomers", permission: "customers.read" },
      // Module actions are flattened into the effective application actions.
      { name: "ping", permission: "crm.ping" },
    ]);
    expect(JSON.stringify(manifest)).not.toContain("function");
    expect(manifest.web?.clientPackage).toBe("@example/crm-web");
    expect(manifest.modules[0]?.id).toBe("crm-core");
  });

  it("keeps the digest stable across action declaration order", () => {
    const first = crmApplication();
    const reordered = defineApplication({
      id: first.id,
      name: first.name,
      version: first.version,
      actions: {
        createCustomer: first.actions.createCustomer!,
        listCustomers: first.actions.listCustomers!,
      },
      http: first.http.filter((route) => route.path !== "/crm/ping"),
      ...(first.web ? { web: first.web } : {}),
      ...(first.modules ? { modules: first.modules } : {}),
    });

    expect(applicationDefinitionDigest(reordered)).toBe(
      applicationDefinitionDigest(first),
    );
  });

  it("changes the digest when a permission or route changes", () => {
    const base = applicationDefinitionDigest(crmApplication());
    const changedPermission = applicationDefinitionDigest(
      crmApplication({ permission: "customers.read.all" }),
    );
    const changedRoute = applicationDefinitionDigest(
      defineApplication({
        id: "customer-crm",
        name: "Customer CRM",
        version: "1.0.0",
        actions: crmApplication().actions,
        http: [
          {
            method: "GET",
            path: "/customers",
            action: "listCustomers",
            auth: "staff",
          },
        ],
        modules: [],
      }),
    );

    expect(changedPermission).not.toBe(base);
    expect(changedRoute).not.toBe(base);
  });

  it("round-trips a serialized manifest and keeps its digest", () => {
    const manifest = toApplicationManifest(crmApplication());
    const restored = parseApplicationManifest(
      JSON.parse(serializeApplicationManifest(manifest)),
    );

    expect(applicationManifestDigest(restored)).toBe(
      applicationManifestDigest(manifest),
    );
    expect(restored).toEqual(manifest);
  });

  it("rejects persisted manifests that do not match the schema", () => {
    const manifest = toApplicationManifest(crmApplication());
    const tampered = JSON.parse(
      serializeApplicationManifest(manifest),
    ) as Record<string, unknown>;

    expect(() =>
      parseApplicationManifest({ ...tampered, schemaVersion: 99 }),
    ).toThrow(InvalidApplicationManifestError);
    expect(() =>
      parseApplicationManifest({
        ...tampered,
        http: [{ method: "TRACE", path: "/", action: "x", auth: "public" }],
      }),
    ).toThrow(InvalidApplicationManifestError);
    expect(() =>
      parseApplicationManifest({ ...tampered, web: { clientPackage: "" } }),
    ).toThrow(InvalidApplicationManifestError);
    expect(() => parseApplicationManifest(null)).toThrow(
      InvalidApplicationManifestError,
    );
  });
});
