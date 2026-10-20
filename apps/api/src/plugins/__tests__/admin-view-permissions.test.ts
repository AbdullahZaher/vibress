import { describe, expect, it } from "vitest";
import { canAccessExtensionAdminRoute as can } from "../admin-view-permissions";

const permissions = ["plugins.read", "plugins.manage", "posts.read", "posts.edit"];
describe("EXT-301 publication-bound Staff authorization", () => {
  it("does not elevate local author/contributor membership using global owner role", () => {
    for (const role of ["author", "contributor", null, undefined, "unknown"]) {
      expect(can(permissions, ["owner"], role, "plugins.manage")).toBe(false);
      expect(can(permissions, ["owner"], role, "plugins.read")).toBe(false);
      expect(can(permissions, ["owner"], role, "posts.edit")).toBe(false);
    }
  });
  it("restricts generic editing to editor+ and plugin management to admin+", () => {
    expect(can(permissions, ["owner"], "editor", "posts.edit")).toBe(true);
    expect(can(permissions, ["owner"], "editor", "plugins.read")).toBe(true);
    expect(can(permissions, ["owner"], "editor", "plugins.manage")).toBe(false);
    expect(can(permissions, ["owner"], "author", "posts.read")).toBe(true);
    expect(can(permissions, ["owner"], "contributor", "posts.read")).toBe(true);
    expect(can(permissions, ["owner"], "admin", "plugins.manage")).toBe(true);
  });
  it("requires global permission independently of local role", () => {
    expect(can(["posts.read"], ["editor"], "admin", "plugins.manage")).toBe(false);
    expect(can(["posts.read"], ["editor"], "editor", "posts.read")).toBe(true);
    expect(can(undefined, ["owner"], "owner", "posts.read")).toBe(false);
    expect(can(permissions, undefined, "owner", "posts.read")).toBe(false);
  });
});
