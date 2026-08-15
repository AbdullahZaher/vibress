import { describe, it, expect } from "vitest";
import { matchRoutePattern, adminRoutes } from "../router";

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
  });
});
