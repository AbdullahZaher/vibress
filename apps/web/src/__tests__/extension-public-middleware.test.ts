import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware, _clearSiteSettingsCache } from "../middleware";

function mockSiteApi(privateSite: boolean, locales = ["en", "ar"]) {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    if (!String(input).includes("/api/content/v1/site")) {
      return new Response("", { status: 404 });
    }
    return new Response(JSON.stringify({
      site: { locale: "en", enabledLocales: locales },
      security: { isPrivate: privateSite },
    }), {
      status: 200,
      headers: { "x-vibress-publication-id": "pub-real", "Content-Type": "application/json" },
    });
  }));
}

describe("EXT-302A public route Host middleware", () => {
  beforeEach(() => _clearSiteSettingsCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    _clearSiteSettingsCache();
  });

  it("routes enabled Arabic pages through locale-aware SSR", async () => {
    mockSiteApi(false);
    const response = await middleware(new NextRequest(
      "https://publication.example/ar/extensions/vibress-lms/courses",
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-vibress-locale")).toBe("ar");
  });

  it("rejects disabled locale prefixes before extension page rendering", async () => {
    mockSiteApi(false, ["en"]);
    const response = await middleware(new NextRequest(
      "https://publication.example/ar/extensions/vibress-lms/courses",
    ));
    expect(response.status).toBe(404);
  });

  it("enforces private-site gate for extension pages without a site-auth cookie", async () => {
    mockSiteApi(true);
    const response = await middleware(new NextRequest(
      "https://publication.example/extensions/vibress-lms/courses",
    ));
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = response.headers.get("location") || "";
    expect(location).toContain("/private");
    expect(location).toContain("extensions");
  });

  it("fails closed when publication privacy state cannot be resolved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const response = await middleware(new NextRequest(
      "https://unknown.example/extensions/vibress-lms/courses",
    ));
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get("location")).toContain("/private");
  });
});
