import { describe, expect, it } from "vitest";
import type { PluginModule } from "@vibress/plugin-sdk";
import { pluginPhysicalModelDigest } from "@vibress/plugins";
import { admitNativeDataModel, admitNativeDataRegistry } from "../native-data-registry";
import { issueNativeCursor, readNativeCursor, nativeFilterHash } from "../native-data-cursor";

const label = { en: "Courses", ar: "Courses" };
const modelColumns = [{ name: "title_en", type: "text" as const, required: true },
  { name: "notes", type: "text" as const, required: false }];
const models = [{
  key: "courses", columns: modelColumns,
  schemaSha256: pluginPhysicalModelDigest(modelColumns),
  indexedTextFields: ["title_en"],
}];
const base: PluginModule = {
  activate() {},
  routes: [{ id: "courses", audience: "admin", method: "GET",
    permission: "plugins.manage", response: { fields: { total: "number" } },
    handle: () => ({ total: 1 }),
  }],
  adminViews: [{ id: "courses", routeId: "courses", title: label }],
  adminNavigation: [{ viewId: "courses", label, permission: "plugins.manage" }],
  adminPages: [{ schemaVersion: 1, viewId: "courses", title: label,
    components: [{ type: "stat", id: "total", field: "total", label }],
  }],
  adminResources: [{ id: "course-list", modelKey: "courses",
    fields: ["title_en"], textFilters: ["title_en"] }],
  adminActions: [{ id: "course-create", resourceId: "course-list", operation: "create" }],
};
describe("NUI-03 static registry", () => {
  it("accepts a linked Native contribution without granting a method", () => {
    expect(admitNativeDataRegistry(base).kind).toBe("admitted");
    expect(admitNativeDataModel(base.adminResources![0]!, models, true)).toBe(true);
  });
  it("rejects resources associated with a nonexistent Native page", () => {
    expect(admitNativeDataRegistry({ ...base, adminResources: [{
      id: "course-list", modelKey: "courses", viewId: "unknown", fields: ["title_en"],
    }] }).kind).toBe("invalid");
    expect(admitNativeDataRegistry({ ...base, adminResources: [{
      id: "course-list", modelKey: "courses", viewId: "courses", fields: ["title_en"],
    }] }).kind).toBe("admitted");
  });
  it("rejects a missing Native view, unknown field and unindexed filter", () => {
    expect(admitNativeDataRegistry({ ...base, adminPages: undefined }).kind).toBe("invalid");
    expect(admitNativeDataModel({ id: "list", modelKey: "courses", fields: ["secret"] }, models)).toBe(false);
    expect(admitNativeDataModel({ id: "list", modelKey: "courses", fields: ["notes"],
      textFilters: ["notes"] }, models)).toBe(false);
  });
  it("rejects action aliases and orphan IDs", () => {
    expect(admitNativeDataRegistry({ ...base, adminActions: [
      base.adminActions![0]!, { id: "alias", resourceId: "course-list", operation: "create" },
    ] }).kind).toBe("invalid");
    expect(admitNativeDataRegistry({ ...base, adminActions: [
      { id: "alias", resourceId: "unbound", operation: "update" },
    ] }).kind).toBe("invalid");
  });
  it("preserves legacy plugins without NUI-03 contributions", () => {
    expect(admitNativeDataRegistry({ activate() {} })).toEqual({ kind: "absent" });
  });
});
describe("NUI-03 publication-scoped authenticated cursors", () => {
  const secret = "a".repeat(64);
  const ctx = { pluginId: "plugin", publicationId: "pub-a", actorId: "staff",
    resourceId: "course-list", digest: "b".repeat(64),
    filterHash: nativeFilterHash("title_en", "hello") };
  it("verifies signature, filter, publication, actor and release digest", () => {
    const token = issueNativeCursor(ctx, "course1", secret, 1000);
    expect(token).not.toBeNull();
    expect(readNativeCursor(token!, ctx, secret, 1001)).toBe("course1");
    expect(readNativeCursor(token!, { ...ctx, publicationId: "pub-b" }, secret, 1001)).toBeNull();
    expect(readNativeCursor(token!, { ...ctx, actorId: "other" }, secret, 1001)).toBeNull();
    expect(readNativeCursor(token!, { ...ctx, filterHash: nativeFilterHash() }, secret, 1001)).toBeNull();
    expect(readNativeCursor(token!, { ...ctx, digest: "c".repeat(64) }, secret, 1001)).toBeNull();
    expect(readNativeCursor(token! + "x", ctx, secret, 1001)).toBeNull();
    expect(readNativeCursor(token!, ctx, secret, 901000)).toBeNull();
    expect(issueNativeCursor(ctx, "course1", null)).toBeNull();
  });
});
