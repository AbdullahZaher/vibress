import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware, _clearSiteSettingsCache } from "../middleware";

describe("Web Edge Middleware Localization Routing (LOC-002 & LOC-003)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    _clearSiteSettingsCache();
  });

  function mockSiteApi(siteConfig: { locale: string; enabledLocales: string[]; isPrivate?: boolean }) {
    return vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/content/v1/site")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "x-vibress-publication-id": "pub_test" }),
          json: () => Promise.resolve({
            site: {
              title: "Test Site",
              locale: siteConfig.locale,
              enabledLocales: siteConfig.enabledLocales,
            },
            security: { isPrivate: siteConfig.isPrivate ?? false },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
  }

  it("does not reject hyphenated content slugs starting with language codes (LOC-002)", async () => {
    const fetchMock = mockSiteApi({ locale: "en", enabledLocales: ["en"] });
    global.fetch = fetchMock as any;

    const slugs = ["/fr-revolution", "/en-tips", "/ar-summit", "/de-briefing"];
    for (const slug of slugs) {
      const req = new NextRequest(`http://localhost:7777${slug}`);
      const res = await middleware(req);
      // Valid article slug must not be falsely rejected with 404
      expect(res.status).not.toBe(404);
    }
  });

  it("returns 404 when requesting a disabled language exact prefix", async () => {
    const fetchMock = mockSiteApi({ locale: "en", enabledLocales: ["en"] });
    global.fetch = fetchMock as any;

    const req = new NextRequest("http://localhost:7777/fr/posts/some-post");
    const res = await middleware(req);
    expect(res.status).toBe(404);
  });

  it("rewrites enabled language exact prefix with x-vibress-locale header", async () => {
    const fetchMock = mockSiteApi({ locale: "en", enabledLocales: ["en", "ar"] });
    global.fetch = fetchMock as any;

    const req = new NextRequest("http://localhost:7777/ar/posts/welcome");
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vibress-locale")).toBe("ar");
  });

  it("redirects primary language prefixed route to canonical unprefixed route", async () => {
    const fetchMock = mockSiteApi({ locale: "en", enabledLocales: ["en", "ar"] });
    global.fetch = fetchMock as any;

    const req = new NextRequest("http://localhost:7777/en/posts/welcome");
    const res = await middleware(req);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("http://localhost:7777/posts/welcome");
  });

  it("supports regional locale prefixes such as ar-SA when variants exist", async () => {
    const fetchMock = mockSiteApi({ locale: "en", enabledLocales: ["en", "ar-SA", "ar-EG"] });
    global.fetch = fetchMock as any;

    const req = new NextRequest("http://localhost:7777/ar-sa/posts/welcome");
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vibress-locale")).toBe("ar-SA");
  });

  it("deduplicates redundant site settings calls via in-memory cache (LOC-003)", async () => {
    const fetchMock = mockSiteApi({ locale: "en", enabledLocales: ["en", "ar"] });
    global.fetch = fetchMock as any;

    const req1 = new NextRequest("http://localhost:7777/posts/post-1");
    await middleware(req1);

    const siteCallsAfterFirstReq = fetchMock.mock.calls.filter((c: any) =>
      c[0].includes("/api/content/v1/site"),
    ).length;
    // Exactly 1 fetch to site settings performed (no redundant second fetch within the same request)
    expect(siteCallsAfterFirstReq).toBe(1);

    const req2 = new NextRequest("http://localhost:7777/posts/post-2");
    await middleware(req2);

    // Second request within cache TTL reuses cached data
    const siteCallsAfterSecondReq = fetchMock.mock.calls.filter((c: any) =>
      c[0].includes("/api/content/v1/site"),
    ).length;
    expect(siteCallsAfterSecondReq).toBe(1);
  });
});
