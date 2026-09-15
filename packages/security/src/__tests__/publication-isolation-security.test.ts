import { describe, it, expect } from "vitest";
import {
  assertPublicationAccess,
  hasResourcePermission,
  PublicationAccessDeniedError,
  PublicationContext,
} from "../authorization";

describe("Publication Context & Security Isolation", () => {
  const ctxPubA: PublicationContext = {
    publicationId: "pub_A",
    workspaceId: "ws_A",
    actorId: "user_owner",
    actorType: "staff",
    role: "owner",
    permissions: ["posts.read", "posts.edit", "posts.delete"],
  };

  it("permits access when active publication matches target publication", () => {
    expect(() => assertPublicationAccess(ctxPubA, "pub_A")).not.toThrow();
  });

  it("rejects cross-publication access with PublicationAccessDeniedError", () => {
    expect(() => assertPublicationAccess(ctxPubA, "pub_B")).toThrow(
      PublicationAccessDeniedError,
    );
  });

  it("permits system operation to cross publication boundary when explicitly declared", () => {
    const systemCtx: PublicationContext = {
      publicationId: "pub_A",
      workspaceId: "ws_A",
      actorType: "system",
      isSystemOperation: true,
    };
    expect(() => assertPublicationAccess(systemCtx, "pub_B")).not.toThrow();
  });

  describe("hasResourcePermission cross-publication enforcement", () => {
    it("denies owner/administrator access to another publication resource", () => {
      // User is "owner" in pub_A, but target post belongs to pub_B
      const allowed = hasResourcePermission("posts.edit", {
        actorId: "user_owner",
        userRoles: ["owner"],
        userPermissions: ["posts.edit"],
        publicationId: "pub_A",
        resourcePublicationId: "pub_B",
        resourceOwnerId: "user_owner",
      });

      expect(allowed).toBe(false);
    });

    it("allows owner access within their own publication", () => {
      const allowed = hasResourcePermission("posts.edit", {
        actorId: "user_owner",
        userRoles: ["owner"],
        userPermissions: ["posts.edit"],
        publicationId: "pub_A",
        resourcePublicationId: "pub_A",
      });

      expect(allowed).toBe(true);
    });

    it("denies editor access to another publication even with edit.all capability", () => {
      const allowed = hasResourcePermission("posts.edit", {
        actorId: "user_editor",
        userRoles: ["editor"],
        userPermissions: ["posts.edit", "posts.edit.all"],
        publicationId: "pub_A",
        resourcePublicationId: "pub_B",
      });

      expect(allowed).toBe(false);
    });
  });
});
