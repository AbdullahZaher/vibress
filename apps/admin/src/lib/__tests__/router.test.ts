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
    expect(patterns).toContain("/admin/plugins");
    expect(patterns).toContain("/admin/settings/advanced/content-models");
    expect(patterns).toContain("/admin/settings/content-models");
    expect(patterns).toContain("/admin/settings/advanced/content-models/new");
    expect(patterns).toContain("/admin/settings/advanced/content-models/:modelId");
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
    expect(patterns).not.toContain("/admin/automations");
  });

  it("routes the Advanced Manage models action to the correct content model screen", () => {
    const targetPath = "/admin/settings/advanced/content-models";
    const firstMatch = adminRoutes.find((route) =>
      matchRoutePattern(route.pattern, targetPath, route.exact ?? false).matches,
    );
    expect(firstMatch?.pattern).toBe(targetPath);
    expect(firstMatch?.requiredPermission).toBe("posts.read");
    expect(firstMatch?.exact).toBe(true);
    expect(adminRoutes.find((route) => route.pattern === "/admin/settings/content-models")?.exact).toBe(true);
    expect(adminRoutes.find((route) => route.pattern === "/admin/settings/content-models/new")?.exact).toBe(true);
    expect(adminRoutes.find((route) => route.pattern === "/admin/settings/content-models/:modelId")?.exact).toBe(true);
  });

  it("scopes content model routes to settings and preserves old bookmarks", () => {
    const newRoute = adminRoutes.find((route) => route.pattern === "/admin/settings/advanced/content-models");
    const editRoute = adminRoutes.find((route) => route.pattern === "/admin/settings/advanced/content-models/:modelId");
    const legacyRoute = adminRoutes.find((route) => route.pattern === "/admin/models/:modelId");
    expect(newRoute?.requiredPermission).toBe("posts.read");
    expect(editRoute?.requiredPermission).toBe("settings.edit");
    expect(legacyRoute?.requiredPermission).toBe("settings.edit");
    expect(matchRoutePattern("/admin/settings/advanced/content-models/:modelId",
      "/admin/settings/advanced/content-models/book-1", true).params.modelId).toBe("book-1");
    expect(adminRoutes.find((route) => route.pattern === "/admin/settings/content-models/:modelId")?.requiredPermission).toBe("settings.edit");
  });

  it("routes plugins independently, requires plugins.read and keeps Settings platform alias", () => {
    const pluginsRoute = adminRoutes.find((route) => route.pattern === "/admin/plugins");
    expect(pluginsRoute?.exact).toBe(true);
    expect(pluginsRoute?.requiredPermission).toBe("plugins.read");
    expect(matchRoutePattern("/admin/plugins", "/admin/plugins", true).matches).toBe(true);
    const oldSettingsRoute = adminRoutes.find((route) => route.pattern === "/admin/settings/platform");
    expect(oldSettingsRoute).toBeDefined();
    expect(oldSettingsRoute?.pattern).toBe("/admin/settings/platform");
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

  it("allows read-only access to comments moderation with comments.read", () => {
    const route = adminRoutes.find((r) => r.pattern === "/admin/comments");
    expect(route).toBeDefined();
    expect(route?.requiredPermission).toBe("comments.read");
    expect(route?.exact).toBe(true);

    const match = matchRoutePattern("/admin/comments", "/admin/comments", true);
    expect(match.matches).toBe(true);
  });

  it("enforces 403 PermissionDenied when actor lacks comments.read", () => {
    const dummyUser = {
      id: "author-123",
      email: "author@example.com",
      name: "Author User",
      roles: ["author"],
      permissions: ["posts.read"],
    };

    // Case 1: Unauthorized (lacks comments.read) -> returns PermissionDenied element
    const unauthorizedResult = renderAdminRoute({
      pathname: "/admin/comments",
      user: dummyUser,
      onNavigate: () => {},
      can: (perm) => perm === "posts.read",
    });

    expect(unauthorizedResult).toBeDefined();
    const element = unauthorizedResult as any;
    // RouteErrorBoundary wraps PermissionDenied
    expect(element.props?.children?.props?.requiredPermission).toBe("comments.read");

    // Case 2: Reader with comments.read can view the moderation queue without mutation rights
    const authorizedResult = renderAdminRoute({
      pathname: "/admin/comments",
      user: dummyUser,
      onNavigate: () => {},
      can: (perm) => perm === "comments.read",
    });

    expect(authorizedResult).toBeDefined();
    const authorizedElement = authorizedResult as any;
    expect(authorizedElement.props?.children?.props?.requiredPermission).toBeUndefined();
    const readOnlyView = authorizedElement.props?.children?.props?.children;
    expect(readOnlyView?.props?.canModerate).toBe(false);

    const moderator = renderAdminRoute({
      pathname: "/admin/comments",
      user: dummyUser,
      onNavigate: () => {},
      can: (perm) => perm === "comments.read" || perm === "comments.moderate",
    }) as any;
    expect(moderator.props?.children?.props?.children?.props?.canModerate).toBe(true);
  });
});

