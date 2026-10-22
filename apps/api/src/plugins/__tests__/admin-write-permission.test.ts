import { describe, expect, it } from "vitest";
import { isExtensionAdminWritePermission } from "../admin-write-permission";

describe("EXT-301 Admin write permissions", () => {
  it("rejects read-only, absent and unknown permissions", () => {
    for (const permission of ["plugins.read", "posts.read", "admin", "", undefined]) {
      expect(isExtensionAdminWritePermission(permission)).toBe(false);
    }
  });
  it("allows only host-supported mutation permissions", () => {
    expect(isExtensionAdminWritePermission("plugins.manage")).toBe(true);
    expect(isExtensionAdminWritePermission("posts.edit")).toBe(true);
  });
});
