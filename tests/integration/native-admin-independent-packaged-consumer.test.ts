import { describe, expect, it } from "vitest";
import { SDK_VERSION, type PluginModule } from "../../packages/plugin-sdk/dist/index.js";
import {
  ExtensionNativeAdminPageV1Schema,
  ExtensionNativeDomainWorkflowV1Schema,
} from "@vibress/api-contracts";
import { admitNativeAdminPage } from "../../apps/api/src/plugins/native-admin-registry";
import { admitNativeDataRegistry } from "../../apps/api/src/plugins/native-data-registry";
import { admitNativeDomainWorkflow } from "../../apps/api/src/plugins/native-domain-workflow";

const label = { en: "Independent Records", ar: "السجلات المستقلة" };

/**
 * NUI-07 Packaged SDK Consumer Acceptance:
 * Validates that an external plugin author importing ONLY the built /dist artifact
 * of @vibress/plugin-sdk can successfully construct conforming native descriptors,
 * without accessing any internal Host packages or private APIs.
 */
const packagedExternalPlugin: PluginModule = {
  activate() {},
  routes: [
    {
      id: "catalog",
      audience: "admin",
      method: "GET",
      permission: "plugins.manage",
      response: { fields: { count: "number" }, required: ["count"] },
      handle: () => ({ count: 5 }),
    },
    {
      id: "catalog",
      audience: "admin",
      method: "POST",
      permission: "plugins.manage",
      body: {
        fields: {
          recordId: "string",
          expectedVersion: "number",
          operation: "string",
          title_en: "string",
        },
        required: ["recordId", "expectedVersion", "operation", "title_en"],
      },
      response: {
        fields: {
          recordId: "string",
          version: "number",
          outcome: "string",
          status: "string",
        },
        required: ["recordId", "version", "outcome", "status"],
      },
      handle: () => ({
        recordId: "item-1",
        version: 1,
        outcome: "created",
        status: "draft",
      }),
    },
  ],
  adminViews: [{ id: "catalog-view", routeId: "catalog", title: label }],
  adminNavigation: [{ viewId: "catalog-view", label, permission: "plugins.manage" }],
  adminPages: [
    {
      schemaVersion: 1,
      viewId: "catalog-view",
      title: label,
      components: [
        { type: "stat", id: "count", label, field: "count" },
      ],
    },
  ],
  adminResources: [
    {
      id: "catalog-items",
      viewId: "catalog-view",
      modelKey: "catalog_items",
      fields: ["title_en", "status"],
      textFilters: ["status"],
    },
  ],
  adminDomainWorkflows: [
    {
      schemaVersion: 1,
      viewId: "catalog-view",
      routeId: "catalog",
      resourceId: "catalog-items",
      idField: "recordId",
      versionField: "expectedVersion",
      operationField: "operation",
      operations: ["create", "save", "publish"],
      fields: [{ key: "title_en", label, maxLength: 120 }],
    },
  ],
};

describe("NUI-07 Packaged SDK Consumer and Contract Conformance", () => {
  it("exports stable SDK_VERSION = '1.0.0' from the compiled package entrypoint", () => {
    expect(SDK_VERSION).toBe("1.0.0");
  });

  it("admits a packaged external plugin conforming to public SDK contracts", () => {
    const pageOutcome = admitNativeAdminPage(packagedExternalPlugin, "catalog-view");
    expect(pageOutcome.kind).toBe("admitted");
    if (pageOutcome.kind === "admitted") {
      const parsed = ExtensionNativeAdminPageV1Schema.safeParse(pageOutcome.page);
      expect(parsed.success).toBe(true);
    }

    const dataOutcome = admitNativeDataRegistry(packagedExternalPlugin);
    expect(dataOutcome.kind).toBe("admitted");

    const workflowOutcome = admitNativeDomainWorkflow(packagedExternalPlugin, "catalog-view");
    expect(workflowOutcome.kind).toBe("admitted");
    if (workflowOutcome.kind === "admitted") {
      const parsed = ExtensionNativeDomainWorkflowV1Schema.safeParse(workflowOutcome.workflow);
      expect(parsed.success).toBe(true);
    }
  });

  it("admits legacy plugins without Native declarations as absent without failure", () => {
    const legacyPlugin: PluginModule = {
      activate() {},
      routes: packagedExternalPlugin.routes?.slice(0, 1),
      adminViews: packagedExternalPlugin.adminViews,
      adminNavigation: packagedExternalPlugin.adminNavigation,
    };

    expect(admitNativeAdminPage(legacyPlugin, "catalog-view").kind).toBe("absent");
    expect(admitNativeDataRegistry(legacyPlugin).kind).toBe("absent");
    expect(admitNativeDomainWorkflow(legacyPlugin, "catalog-view").kind).toBe("absent");
  });

  it("fails closed when external plugin attempts to bind a workflow to an undeclared view", () => {
    const workflow = packagedExternalPlugin.adminDomainWorkflows?.[0];
    if (!workflow) throw new Error("Missing workflow fixture");

    const corruptedPlugin: PluginModule = {
      ...packagedExternalPlugin,
      adminDomainWorkflows: [
        {
          ...workflow,
          viewId: "nonexistent-view-id",
        },
      ],
    };

    const outcome = admitNativeDomainWorkflow(corruptedPlugin, "catalog-view");
    expect(outcome.kind).toBe("invalid");
  });

  it("fails closed when external plugin specifies an unapproved component type", () => {
    const page = packagedExternalPlugin.adminPages?.[0];
    if (!page) throw new Error("Missing page fixture");

    const corruptedPlugin: PluginModule = {
      ...packagedExternalPlugin,
      adminPages: [
        {
          ...page,
          components: [
            // @ts-expect-error Testing runtime schema defense against invalid component type
            { type: "arbitrary-iframe-inject", id: "bad", label, field: "count" },
          ],
        },
      ],
    };

    const outcome = admitNativeAdminPage(corruptedPlugin, "catalog-view");
    expect(outcome.kind).toBe("invalid");
  });
});
