import { describe, it, expect } from "vitest";
import { matchRoutePattern, adminRoutes, renderAdminRoute } from "../router";

describe("Admin Declarative Router", () => {
  it("matches static routes accurately", () => {
    const res = matchRoutePattern("/admin/posts", "/admin/posts", true);
    expect(res.matches).toBe(true);
    expect(res.params).toEqual({});
  });

  it("extracts dynamic parameters from route patterns", () => {
    const res = matchRoutePattern("/admin/posts/:postId", "/admin/posts/post-uuid-12345", true);
    expect(res.matches).toBe(true);
    expect(res.params).toEqual({ postId: "post-uuid-12345" });
  });

  it("handles trailing slashes gracefully", () => {
    const res = matchRoutePattern("/admin/pages", "/admin/pages/", true);
    expect(res.matches).toBe(true);
  });

  it("rejects non-matching routes when exact is true", () => {
    const res = matchRoutePattern("/admin/posts", "/admin/posts/non-matching-subroute", true);
    expect(res.matches).toBe(false);
  });

  it("supports prefix matching for nested route areas", () => {
    const res = matchRoutePattern("/admin/settings/site", "/admin/settings/site/themes", false);
    expect(res.matches).toBe(true);
  });

  it("registers all required core admin routes", () => {
    const patterns = adminRoutes.map((r) => r.pattern);
    expect(patterns).toContain("/admin");
    expect(patterns).toContain("/admin/posts");
    expect(patterns).toContain("/admin/posts/new");
    expect(patterns).toContain("/admin/posts/:postId");
    expect(patterns).toContain("/admin/pages");
    expect(patterns).toContain("/admin/pages/new");
    expect(patterns).toContain("/admin/pages/:pageId");
    expect(patterns).toContain("/admin/tags");
    expect(patterns).toContain("/admin/media");
    expect(patterns).toContain("/admin/members");
    expect(patterns).toContain("/admin/settings");
    expect(patterns).toContain("/admin/settings/localization");
    expect(patterns).toContain("/admin/translations");
    expect(patterns).toContain("/admin/translations/queue");
    expect(patterns).toContain("/admin/translations/:translationId");
    expect(patterns).toContain(
      "/admin/content/:contentType/:contentId/translate/:targetLocale",
    );
    expect(patterns).toContain("/admin/comments");
    expect(patterns).toContain("/admin/community");
    expect(patterns).not.toContain("/admin/network");
  });

  it("matches settings localization and language routes", () => {
    const locMatch = matchRoutePattern(
      "/admin/settings/localization",
      "/admin/settings/localization",
      false,
    );
    expect(locMatch.matches).toBe(true);

    const dynamicSectionMatch = matchRoutePattern(
      "/admin/settings/:section",
      "/admin/settings/localization",
      false,
    );
    expect(dynamicSectionMatch.matches).toBe(true);
    expect(dynamicSectionMatch.params).toEqual({ section: "localization" });
  });

  it("matches translation dynamic parameterized routes", () => {
    const trMatch = matchRoutePattern(
      "/admin/translations/:translationId",
      "/admin/translations/tr-uuid-9999",
      true,
    );
    expect(trMatch.matches).toBe(true);
    expect(trMatch.params).toEqual({ translationId: "tr-uuid-9999" });

    const createTrMatch = matchRoutePattern(
      "/admin/content/:contentType/:contentId/translate/:targetLocale",
      "/admin/content/post/post-123/translate/ar-SA",
      true,
    );
    expect(createTrMatch.matches).toBe(true);
    expect(createTrMatch.params).toEqual({
      contentType: "post",
      contentId: "post-123",
      targetLocale: "ar-SA",
    });
  });

  it("matches comments moderation route and requires comments.manage", () => {
    const route = adminRoutes.find((r) => r.pattern === "/admin/comments");
    expect(route).toBeDefined();
    expect(route?.requiredPermission).toBe("comments.manage");
    expect(route?.exact).toBe(true);

    const match = matchRoutePattern("/admin/comments", "/admin/comments", true);
    expect(match.matches).toBe(true);
  });

  it("enforces 403 PermissionDenied when actor lacks comments.manage", () => {
    const dummyUser = {
      id: "author-123",
      email: "author@example.com",
      name: "Author User",
      roles: ["author"],
      permissions: ["posts.read"],
    };

    // Case 1: Unauthorized (lacks comments.manage) -> returns PermissionDenied element
    const unauthorizedResult = renderAdminRoute({
      pathname: "/admin/comments",
      user: dummyUser,
      onNavigate: () => {},
      can: (perm) => perm === "posts.read",
    });

    expect(unauthorizedResult).toBeDefined();
    const element = unauthorizedResult as any;
    // RouteErrorBoundary wraps PermissionDenied
    expect(element.props?.children?.props?.requiredPermission).toBe("comments.manage");

    // Case 2: Authorized (possesses comments.manage) -> renders Suspense/CommentsModeration
    const authorizedResult = renderAdminRoute({
      pathname: "/admin/comments",
      user: dummyUser,
      onNavigate: () => {},
      can: (perm) => perm === "comments.manage",
    });

    expect(authorizedResult).toBeDefined();
    const authorizedElement = authorizedResult as any;
    expect(authorizedElement.props?.children?.props?.requiredPermission).toBeUndefined();
  });
});

