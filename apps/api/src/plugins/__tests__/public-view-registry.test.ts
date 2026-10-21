import { describe, expect, it } from "vitest";
import type { PluginApiRoute, PluginModule } from "@vibress/plugin-sdk";
import { admitPublicViews } from "../public-view-registry";

const route: PluginApiRoute = {
  id: "catalog",
  audience: "public",
  method: "GET",
  response: { fields: { total: "number" } },
  handle: () => ({ total: 3 }),
};
const publicView = {
  id: "courses", routeId: "catalog",
  title: { en: "Courses", ar: "الدورات" },
};
const moduleWith = (partial: Partial<PluginModule> = {}): PluginModule => ({
  activate() {},
  routes: [route],
  publicViews: [publicView],
  ...partial,
});

describe("EXT-302A public Host view admission", () => {
  it("adopts only explicit public GET views without activating plugin handlers", () => {
    const callback = () => { throw new Error("Must not call plugin"); };
    const result = admitPublicViews(moduleWith({ activate: callback }));
    expect(result).toEqual([{
      viewId: "courses", routeId: "catalog",
      title: publicView.title,
    }]);
    expect(admitPublicViews(moduleWith({ publicViews: undefined }))).toEqual([]);
  });

  it("refuses member/admin routes and any route taking query or body", () => {
    for (const modified of [
      { ...route, audience: "member" as const },
      { ...route, audience: "admin" as const, permission: "plugins.read" as const },
      { ...route, method: "POST" as const },
      { ...route, query: { fields: { lang: "string" as const } } },
      { ...route, body: { fields: {} } },
    ]) {
      expect(admitPublicViews(moduleWith({ routes: [modified] }))).toBeNull();
    }
  });

  it("rejects non-admitted, duplicated, malformed or ambiguous metadata", () => {
    expect(admitPublicViews(moduleWith({ publicViews: [{ ...publicView, routeId: "missing" }] }))).toBeNull();
    expect(admitPublicViews(moduleWith({ publicViews: [publicView, publicView] }))).toBeNull();
    expect(admitPublicViews(moduleWith({ routes: [route, route] }))).toBeNull();
    expect(admitPublicViews(moduleWith({
      publicViews: [{ ...publicView, id: "../courses" }],
    }))).toBeNull();
    expect(admitPublicViews(moduleWith({
      publicViews: [{ ...publicView, title: { en: "", ar: "الدورات" } }],
    }))).toBeNull();
    expect(admitPublicViews(moduleWith({ routes: Array.from({ length: 33 }, () => route) }))).toBeNull();
    expect(admitPublicViews(moduleWith({ publicViews: [] }))).toBeNull();
  });

  it("admits only explicitly published, unique locale variants", () => {
    expect(admitPublicViews(moduleWith({
      publicViews: [{ ...publicView, publishedLocales: ["en", "ar"] }],
    }))).toEqual([{
      viewId: "courses", routeId: "catalog", title: publicView.title,
      publishedLocales: ["en", "ar"],
    }]);
    expect(admitPublicViews(moduleWith({
      publicViews: [{ ...publicView, publishedLocales: ["en", "EN"] }],
    }))).toBeNull();
    expect(admitPublicViews(moduleWith({
      publicViews: [{ ...publicView, publishedLocales: [] }],
    }))).toBeNull();
    expect(admitPublicViews(moduleWith({
      publicViews: [{ ...publicView, publishedLocales: ["../private"] }],
    }))).toBeNull();
  });

  it("rejects response schemas referencing fields not declared by the route", () => {
    expect(admitPublicViews(moduleWith({
      routes: [{ ...route, response: { fields: { total: "number" }, required: ["missing"] } }],
    }))).toBeNull();
  });
});
