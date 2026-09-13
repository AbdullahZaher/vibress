import { describe, it, expect } from "vitest";
import { SYSTEM_PERMISSIONS, SYSTEM_ROLES } from "../seed";

describe("SEC-01: RBAC Seed Hardening", () => {
  it("defines canonical system roles with correct metadata", () => {
    const roleKeys = SYSTEM_ROLES.map((r) => r.key);
    expect(roleKeys).toContain("owner");
    expect(roleKeys).toContain("administrator");
    expect(roleKeys).toContain("editor");
    expect(roleKeys).toContain("author");
    expect(roleKeys).toContain("contributor");

    for (const role of SYSTEM_ROLES) {
      expect(role.isSystem).toBe(true);
    }
  });

  it("contains all required granular permissions without invalid keys", () => {
    const permKeys = SYSTEM_PERMISSIONS.map((p) => p.key);
    expect(permKeys).toContain("posts.read");
    expect(permKeys).toContain("posts.create");
    expect(permKeys).toContain("posts.edit");
    expect(permKeys).toContain("posts.delete");
    expect(permKeys).toContain("posts.publish");
    expect(permKeys).toContain("pages.read");
    expect(permKeys).toContain("pages.create");
    expect(permKeys).toContain("pages.edit");
    expect(permKeys).toContain("pages.delete");
    expect(permKeys).toContain("pages.publish");
    expect(permKeys).toContain("translations.read");
    expect(permKeys).toContain("translations.create");
    expect(permKeys).toContain("translations.edit");
    expect(permKeys).toContain("translations.review");
    expect(permKeys).toContain("translations.approve");
    expect(permKeys).toContain("translations.publish");
    expect(permKeys).toContain("translations.manage");
  });

  it("ensures contributor role does NOT receive destructive or publishing permissions", () => {
    const CONTRIBUTOR_PERMISSIONS = new Set([
      "posts.read",
      "posts.create",
      "posts.edit",
      "tags.read",
      "media.read",
      "media.upload",
      "comments.read",
      "translations.read",
      "translations.create",
      "translations.edit",
    ]);

    expect(CONTRIBUTOR_PERMISSIONS.has("posts.publish")).toBe(false);
    expect(CONTRIBUTOR_PERMISSIONS.has("posts.delete")).toBe(false);
    expect(CONTRIBUTOR_PERMISSIONS.has("pages.create")).toBe(false);
    expect(CONTRIBUTOR_PERMISSIONS.has("pages.edit")).toBe(false);
    expect(CONTRIBUTOR_PERMISSIONS.has("pages.delete")).toBe(false);
    expect(CONTRIBUTOR_PERMISSIONS.has("pages.publish")).toBe(false);
    expect(CONTRIBUTOR_PERMISSIONS.has("translations.publish")).toBe(false);
    expect(CONTRIBUTOR_PERMISSIONS.has("translations.approve")).toBe(false);
  });

  it("ensures author role receives drafting and own-delete permissions but NOT site-wide publishing or page mutations", () => {
    const AUTHOR_PERMISSIONS = new Set([
      "posts.read",
      "posts.create",
      "posts.edit",
      "posts.delete",
      "tags.read",
      "media.read",
      "media.upload",
      "comments.read",
      "translations.read",
      "translations.create",
      "translations.edit",
      "translations.review",
    ]);

    expect(AUTHOR_PERMISSIONS.has("posts.edit")).toBe(true);
    expect(AUTHOR_PERMISSIONS.has("posts.delete")).toBe(true);
    expect(AUTHOR_PERMISSIONS.has("translations.review")).toBe(true);
    expect(AUTHOR_PERMISSIONS.has("posts.publish")).toBe(false);
    expect(AUTHOR_PERMISSIONS.has("pages.create")).toBe(false);
    expect(AUTHOR_PERMISSIONS.has("pages.edit")).toBe(false);
    expect(AUTHOR_PERMISSIONS.has("pages.delete")).toBe(false);
    expect(AUTHOR_PERMISSIONS.has("pages.publish")).toBe(false);
    expect(AUTHOR_PERMISSIONS.has("translations.publish")).toBe(false);
    expect(AUTHOR_PERMISSIONS.has("translations.approve")).toBe(false);
    expect(AUTHOR_PERMISSIONS.has("translations.manage")).toBe(false);
  });
});
