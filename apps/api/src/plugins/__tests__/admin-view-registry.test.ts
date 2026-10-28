import { describe, expect, it } from "vitest";
import type { PluginModule } from "@vibress/plugin-sdk";
import { admitAdminViews } from "../admin-view-registry";
import { ExtensionAdminNavigationResponseSchema } from "@vibress/api-contracts";

const label = { en: "Courses", ar: "الدورات" };
function moduleWithView(): PluginModule {
  return {
    activate() {},
    routes: [{
      id: "courses", audience: "admin", method: "GET", permission: "plugins.read",
      response: { fields: { total: "number" } },
      handle: () => ({ total: 2 }),
    }],
    adminViews: [{ id: "courses", routeId: "courses", title: label }],
    adminNavigation: [{ viewId: "courses", label, permission: "plugins.read" }],
  };
}

describe("EXT-301A Admin view admission", () => {
  it("keeps SDK v1 modules without contributions compatible", () => {
    expect(admitAdminViews({ activate() {} })).toEqual([]);
  });

  it("admits a linked, localized, read-only Host GET route", () => {
    expect(admitAdminViews(moduleWithView())).toEqual([{
      viewId: "courses", routeId: "courses", title: label, label, permission: "plugins.read",
    }]);
  });

  it("rejects orphan, unknown and duplicate navigation or view IDs", () => {
    const good = moduleWithView();
    expect(admitAdminViews({ ...good, adminNavigation: undefined })).toBeNull();
    expect(admitAdminViews({ ...good, adminNavigation: [{ viewId: "other", label, permission: "plugins.read" }] })).toBeNull();
    expect(admitAdminViews({ ...good, adminNavigation: [good.adminNavigation![0]!, good.adminNavigation![0]!] })).toBeNull();
    expect(admitAdminViews({ ...good, adminViews: [good.adminViews![0]!, good.adminViews![0]!] })).toBeNull();
  });

  it("admits bounded optional read selectors but rejects required/authority selectors", () => {
    const good = moduleWithView();
    expect(admitAdminViews({ ...good,
      routes: [{ ...good.routes![0]!, query: { fields: { courseId: "string", cursor: "string" } } }],
    })).not.toBeNull();
    expect(admitAdminViews({ ...good,
      routes: [{ ...good.routes![0]!,
        query: { fields: { courseId: "string" }, required: ["courseId"] } }],
    })).toBeNull();
    expect(admitAdminViews({ ...good,
      routes: [{ ...good.routes![0]!, query: { fields: { publicationId: "string" } } }],
    })).toBeNull();
  });

  it("fails closed on mismatched permissions, wrong audience, POST, or duplicate routes", () => {
    const good = moduleWithView();
    expect(admitAdminViews({
      ...good, adminNavigation: [{ viewId: "courses", label, permission: "plugins.manage" }],
    })).toBeNull();
    expect(admitAdminViews({
      ...good, routes: [{ ...good.routes![0]!, audience: "public", permission: undefined }],
    })).toBeNull();
    expect(admitAdminViews({
      ...good, routes: [{ ...good.routes![0]!, method: "POST" }],
    })).toBeNull();
    expect(admitAdminViews({
      ...good, routes: [good.routes![0]!, good.routes![0]!],
    })).toBeNull();
  });

  it("rejects paths, HTML-like IDs, oversized labels and missing Arabic translations", () => {
    const good = moduleWithView();
    expect(admitAdminViews({
      ...good, adminViews: [{ id: "../escape", routeId: "courses", title: label }],
      adminNavigation: [{ viewId: "../escape", label, permission: "plugins.read" }],
    })).toBeNull();
    expect(admitAdminViews({
      ...good, adminNavigation: [{ viewId: "courses", label: { en: "x".repeat(101), ar: "د" }, permission: "plugins.read" }],
    })).toBeNull();
    expect(admitAdminViews({
      ...good, adminNavigation: [{ viewId: "courses", label: { en: " ", ar: " " }, permission: "plugins.read" }],
    })).toBeNull();
  });

  it("allows an inert group, validates its bounds, and preserves permissions", () => {
    const valid = moduleWithView();
    const group = { id: "learning", label, icon: "book-open" as const };
    const admitted = admitAdminViews({ ...valid, adminNavigation: [
      { viewId: "courses", label, permission: "plugins.read", group },
    ] });
    expect(admitted?.[0]?.group).toEqual(group);
    expect(ExtensionAdminNavigationResponseSchema.safeParse({
      items: [{ pluginId: "courses", ...admitted?.[0] }],
    }).success).toBe(true);
    expect(ExtensionAdminNavigationResponseSchema.safeParse({
      items: [{ pluginId: "courses", ...admitted?.[0], group: { ...group, icon: "evil" } }],
    }).success).toBe(false);
    expect(admitAdminViews({ ...valid, adminNavigation: [
      { viewId: "courses", label, permission: "plugins.read", group: { ...group, id: "../evil" } },
    ] })).toBeNull();
    expect(admitAdminViews({ ...valid, adminNavigation: [
      { viewId: "courses", label, permission: "plugins.manage", group },
    ] })).toBeNull();
  });

  it("rejects conflicting names for one group in a plugin", () => {
    const good = moduleWithView();
    const firstRoute = good.routes?.[0];
    const firstView = good.adminViews?.[0];
    if (!firstRoute || !firstView) throw Error("Invalid fixture");
    expect(admitAdminViews({ ...good,
      routes: [firstRoute, { ...firstRoute, id: "other" }],
      adminViews: [firstView, { id: "other", routeId: "other", title: label }],
      adminNavigation: [
        { viewId: "courses", label, permission: "plugins.read",
          group: { id: "learning", label } },
        { viewId: "other", label, permission: "plugins.read",
          group: { id: "learning", label: { en: "Other", ar: "Other" } } },
      ],
    })).toBeNull();
  });

  it("rejects undeclared required fields in GET response schemas", () => {
    const good = moduleWithView();
    expect(admitAdminViews({
      ...good, routes: [{ ...good.routes![0]!,
        response: { fields: { total: "number" }, required: ["missing"] },
      }],
    })).toBeNull();
  });
  it("aligns the response cap with the maximum 64 operator modules × 8 pages", () => {
    const item = {
      pluginId: "courses", viewId: "courses", routeId: "courses",
      title: label, label, permission: "plugins.read",
    };
    expect(ExtensionAdminNavigationResponseSchema.safeParse({
      items: Array.from({ length: 512 }, () => item),
    }).success).toBe(true);
    expect(ExtensionAdminNavigationResponseSchema.safeParse({
      items: Array.from({ length: 513 }, () => item),
    }).success).toBe(false);
  });

});
