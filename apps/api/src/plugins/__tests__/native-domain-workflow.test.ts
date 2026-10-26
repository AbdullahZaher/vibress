import { describe, expect, it } from "vitest";
import type { PluginModule } from "@vibress/plugin-sdk";
import { admitNativeDomainWorkflow } from "../native-domain-workflow";

const label = { en: "Course", ar: "دورة" };
function plugin(): PluginModule {
  return {
    activate() {},
    routes: [
      { id: "courses", audience: "admin", method: "GET",
        permission: "plugins.manage", response: { fields: { total: "number" } },
        handle: () => ({ total: 1 }) },
      { id: "courses", audience: "admin", method: "POST", permission: "plugins.manage",
        body: { fields: {
          courseId: "string", expectedVersion: "number",
          operation: "string", title_en: "string",
        }, required: ["courseId", "expectedVersion", "operation", "title_en"] },
        response: { fields: { outcome: "string", courseId: "string",
          version: "number", status: "string" } },
        handle: () => ({ outcome: "created", courseId: "a-course", version: 1, status: "draft" }) },
    ],
    adminViews: [{ id: "course-overview", routeId: "courses", title: label }],
    adminNavigation: [{ viewId: "course-overview", label, permission: "plugins.manage" }],
    adminPages: [{ schemaVersion: 1, viewId: "course-overview", title: label,
      components: [{ type: "stat", id: "total", field: "total", label }] }],
    adminResources: [{ id: "course-records", viewId: "course-overview", modelKey: "courses",
      fields: ["status", "title_en"] }],
    adminDomainWorkflows: [{
      schemaVersion: 1, viewId: "course-overview", routeId: "courses", resourceId: "course-records",
      idField: "courseId", versionField: "expectedVersion", operationField: "operation",
      fields: [{ key: "title_en", label, maxLength: 180 }],
      operations: ["create", "save", "publish"],
    }],
  };
}
describe("NUI-05 paired Host domain workflow admission", () => {
  it("admits only a linked, permission-checked GET/POST pair", () => {
    const result = admitNativeDomainWorkflow(plugin(), "course-overview");
    expect(result.kind).toBe("admitted");
    if (result.kind === "admitted") expect(result.workflow.routeId).toBe("courses");
  });
  it("keeps old modules read-only and rejects unsupported view references", () => {
    expect(admitNativeDomainWorkflow({ ...plugin(), adminDomainWorkflows: undefined },
      "course-overview").kind).toBe("absent");
    expect(admitNativeDomainWorkflow(plugin(), "unrelated").kind).toBe("absent");
    expect(admitNativeDomainWorkflow({
      ...plugin(), adminDomainWorkflows: [{ ...plugin().adminDomainWorkflows![0]!, viewId: "foreign" }],
    }, "course-overview").kind).toBe("invalid");
  });
  it("rejects unauthorized, missing or incorrectly typed POST contracts", () => {
    const baseline = plugin(), post = baseline.routes![1]!;
    for (const bad of [
      { ...post, permission: "posts.read" as const },
      { ...post, method: "GET" as const },
      { ...post, body: undefined },
      { ...post, body: { ...post.body!, fields: { ...post.body!.fields, expectedVersion: "string" as const } } },
      { ...post, response: { fields: { outcome: "string" as const, version: "number" as const,
        status: "string" as const } } },
    ]) {
      expect(admitNativeDomainWorkflow({ ...baseline, routes: [baseline.routes![0]!, bad] },
        "course-overview").kind).toBe("invalid");
    }
  });
});
