import { describe, expect, it } from "vitest";
import type { PluginModule } from "@vibress/plugin-sdk";
import { admitNativeAdminPage } from "../native-admin-registry";

const label = { en: "Courses", ar: "Courses" };
function fixture(): PluginModule {
  return {
    activate() {},
    routes: [{
      id: "courses", audience: "admin", method: "GET",
      permission: "plugins.read",
      response: { fields: { total: "number", title: "string" } },
      handle: () => ({ total: 1, title: "Example" }),
    }],
    adminViews: [{ id: "courses", routeId: "courses", title: label }],
    adminNavigation: [{
      viewId: "courses", label, permission: "plugins.read",
    }],
    adminPages: [{
      schemaVersion: 1, viewId: "courses", title: label,
      components: [
        { type: "stat", id: "total", field: "total", label },
        { type: "field-list", id: "details",
          fields: [{ key: "title", label }] },
      ],
    }],
  };
}
describe("NUI-01 Host static native page admission", () => {
  it("preserves legacy modules without native declarations", () => {
    const module = fixture();
    expect(admitNativeAdminPage({ ...module, adminPages: undefined }, "courses"))
      .toEqual({ kind: "absent" });
  });
  it("admits an existing GET view with exact response field declarations", () => {
    const result = admitNativeAdminPage(fixture(), "courses");
    expect(result.kind).toBe("admitted");
    if (result.kind === "admitted") {
      expect(result.routeId).toBe("courses");
      expect(result.permission).toBe("plugins.read");
    }
  });
  it("rejects unknown fields, orphaned views and malformed declarations", () => {
    const module = fixture();
    const pages = module.adminPages ?? [];
    const first = pages[0];
    if (!first || first.components[0]?.type !== "stat") throw Error("Invalid fixture");
    expect(admitNativeAdminPage({ ...module, adminPages: [{
      ...first, components: [{ ...first.components[0], field: "publicationId" }],
    }] }, "courses").kind).toBe("invalid");
    expect(admitNativeAdminPage({ ...module, adminPages: [{
      ...first, viewId: "unlinked",
    }] }, "courses").kind).toBe("invalid");
    expect(admitNativeAdminPage({ ...module, adminPages: [{
      ...first, schemaVersion: 1, components: [],
    }] }, "courses").kind).toBe("invalid");
  });
  it("rejects permission mismatch and wrong-audience routes", () => {
    const module = fixture();
    const routes = module.routes ?? [];
    const route = routes[0];
    if (!route) throw Error("Invalid fixture");
    expect(admitNativeAdminPage({
      ...module, routes: [{ ...route, permission: "posts.read" }],
    }, "courses").kind).toBe("invalid");
    expect(admitNativeAdminPage({
      ...module, routes: [{ ...route, audience: "public", permission: undefined }],
    }, "courses").kind).toBe("invalid");
  });
});
