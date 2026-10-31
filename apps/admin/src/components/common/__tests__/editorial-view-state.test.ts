/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { readEditorialViewState, saveEditorialViewState } from "../editorial-view-state";

describe("editorial publishing view persistence", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/admin");
  });

  it("restores search, status, sort and pagination when returning from an editor", () => {
    window.history.replaceState({}, "", "/admin/posts");
    const view = { status: "scheduled", search: "launch notes", page: 2, pageSize: 50, sortBy: "title" as const, sortOrder: "asc" as const };
    saveEditorialViewState("posts", view);
    expect(window.location.search).toContain("v_search=launch+notes");
    expect(readEditorialViewState("posts")).toEqual(view);
    window.history.pushState({}, "", "/admin/posts/42");
    window.history.pushState({}, "", "/admin/posts");
    expect(readEditorialViewState("posts")).toEqual(view);
  });

  it("does not let sidebar quick filters overwrite the main list state", () => {
    window.history.replaceState({}, "", "/admin/posts");
    saveEditorialViewState("posts", { status: "published", search: "issue", page: 1, pageSize: 25, sortBy: "updatedAt", sortOrder: "desc" });
    window.history.pushState({}, "", "/admin/posts/drafts");
    saveEditorialViewState("posts", { status: "draft", search: "", page: 0, pageSize: 25, sortBy: "title", sortOrder: "asc" });
    expect(readEditorialViewState("posts", "draft").status).toBe("draft");
    window.history.pushState({}, "", "/admin/posts");
    expect(readEditorialViewState("posts").search).toBe("issue");
  });

  it("validates malformed links and maintains distinct resource view states", () => {
    window.history.replaceState({}, "", "/admin/pages?v_page=-4&v_size=3&v_sort=garbage&v_status=deleted&v_search=hello");
    expect(readEditorialViewState("pages")).toMatchObject({
      status: "all", search: "hello", page: 0, pageSize: 25, sortBy: "updatedAt",
    });
    expect(readEditorialViewState("posts")).toMatchObject({ status: "all", page: 0 });
  });
});
