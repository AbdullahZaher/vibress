import { describe, expect, it } from "vitest";
import { SDK_VERSION, type PluginModule } from "@vibress/plugin-sdk";
import { ExtensionNativeDomainWorkflowV1Schema } from "@vibress/api-contracts";
import { admitNativeAdminPage } from "../../apps/api/src/plugins/native-admin-registry";
import { admitNativeDataRegistry } from "../../apps/api/src/plugins/native-data-registry";
import { admitNativeDomainWorkflow } from "../../apps/api/src/plugins/native-domain-workflow";

const label = { en: "Records", ar: "السجلات" };

/**
 * NUI-07 independent consumer: authored against the canonical public SDK.
 * The Host registries are imported only by this integration test, never by
 * the plugin fixture itself. No deployed operator release is implied.
 */
const independentPlugin: PluginModule = {
  activate() {},
  routes: [
    {
      id: "records", audience: "admin", method: "GET", permission: "plugins.manage",
      response: { fields: { total: "number" }, required: ["total"] },
      handle: () => ({ total: 0 }),
    },
    {
      id: "records", audience: "admin", method: "POST", permission: "plugins.manage",
      body: {
        fields: { recordId: "string", expectedVersion: "number",
          operation: "string", title_en: "string" },
        required: ["recordId", "expectedVersion", "operation", "title_en"],
      },
      response: {
        fields: { recordId: "string", version: "number",
          outcome: "string", status: "string" },
        required: ["recordId", "version", "outcome", "status"],
      },
      // Intentional inert fixture. Domain mutation requires real service logic.
      handle: () => ({ recordId: "fixture", version: 0,
        outcome: "invalid", status: "draft" }),
    },
  ],
  adminViews: [{ id: "overview", routeId: "records", title: label }],
  adminNavigation: [{ viewId: "overview", label, permission: "plugins.manage" }],
  adminPages: [{ schemaVersion: 1, viewId: "overview", title: label,
    components: [{ type: "stat", id: "total", label, field: "total" }] }],
  adminResources: [{ id: "record-list", viewId: "overview",
    modelKey: "records", fields: ["title_en", "status"] }],
  adminDomainWorkflows: [{ schemaVersion: 1,
    viewId: "overview", routeId: "records", resourceId: "record-list",
    idField: "recordId", versionField: "expectedVersion", operationField: "operation",
    operations: ["create", "save", "publish"],
    fields: [{ key: "title_en", label, maxLength: 180 }] }],
};

describe("NUI-07 independent consumer compatibility", () => {
  it("retains the supported SDK v1 ABI while consuming optional Native metadata", () => {
    expect(SDK_VERSION).toBe("1.0.0");
    expect(admitNativeAdminPage(independentPlugin, "overview").kind).toBe("admitted");
    expect(admitNativeDataRegistry(independentPlugin).kind).toBe("admitted");
    const workflow = admitNativeDomainWorkflow(independentPlugin, "overview");
    expect(workflow.kind).toBe("admitted");
    if (workflow.kind === "admitted") {
      expect(ExtensionNativeDomainWorkflowV1Schema.safeParse(workflow.workflow).success)
        .toBe(true);
    }
  });

  it("keeps legacy-only plugins valid with no Native contribution", () => {
    const legacy: PluginModule = {
      activate() {},
      routes: independentPlugin.routes?.slice(0, 1),
      adminViews: independentPlugin.adminViews,
      adminNavigation: independentPlugin.adminNavigation,
    };
    expect(admitNativeAdminPage(legacy, "overview").kind).toBe("absent");
    expect(admitNativeDataRegistry(legacy).kind).toBe("absent");
    expect(admitNativeDomainWorkflow(legacy, "overview").kind).toBe("absent");
  });

  it("rejects descriptors referencing foreign views or missing source resources", () => {
    const workflow = independentPlugin.adminDomainWorkflows?.[0];
    if (!workflow) throw Error("Missing public SDK fixture");
    expect(admitNativeDomainWorkflow({
      ...independentPlugin,
      adminDomainWorkflows: [{ ...workflow, viewId: "unknown" }],
    }, "overview").kind).toBe("invalid");
    expect(admitNativeDomainWorkflow({
      ...independentPlugin, adminResources: undefined,
    }, "overview").kind).toBe("invalid");
  });
});
