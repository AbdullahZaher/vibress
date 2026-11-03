import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  middleware,
  _clearSiteSettingsCache,
  getValidatedFrameAncestors,
  sanitizeEmbedOrigin,
} from "../middleware";

describe("Web Edge Middleware Localization Routing (LOC-002 & LOC-003)", () => {
  const _originalFetch = global.fetch;

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

  it("applies frame-ancestors 'none' on standard routes and allows embedding on preview routes", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/admin/v1/themes/preview/valid-token")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ themeId: "vibress-default" }),
        });
      }
      if (url.includes("/api/content/v1/site")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "x-vibress-publication-id": "pub_test" }),
          json: () => Promise.resolve({
            site: { title: "Test Site", locale: "en", enabledLocales: ["en"] },
            security: { isPrivate: false },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
    global.fetch = fetchMock as any;

    // 1. Standard page request: must strictly prohibit embedding with frame-ancestors 'none'
    const standardReq = new NextRequest("http://localhost:7777/posts/post-1");
    const standardRes = await middleware(standardReq);
    const standardCsp = standardRes.headers.get("Content-Security-Policy") || "";
    expect(standardCsp).toContain("frame-ancestors 'none'");

    // 2. Valid preview route: must permit embedding by the admin iframe
    const previewReq = new NextRequest("http://localhost:7777/preview/valid-token");
    const previewRes = await middleware(previewReq);
    const previewCsp = previewRes.headers.get("Content-Security-Policy") || "";
    expect(previewCsp).toContain("frame-ancestors 'self'");
    expect(previewRes.headers.get("x-vibress-theme")).toBe("vibress-default");
  });


  it("keeps verified preview routes nested for post navigation", async () => {
    const token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ themeId: "vibress-default" }),
    }) as any;
    const req = new NextRequest("http://localhost:7777/preview/" + token + "/posts/example?x=1");
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
    expect(res.headers.get("x-middleware-rewrite")).toContain("/posts/example?x=1");
    // Private routing state is forwarded to Next.js, not exposed as response headers.
    expect(res.headers.get("x-vibress-preview-token")).toBeNull();
    expect(res.headers.get("x-vibress-preview-path")).toBeNull();
  });
  it("keeps query parameters and selected language in nested preview navigation", async () => {
    const token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/admin/v1/themes/preview/")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ themeId: "vibress-default" }) });
      }
      if (url.includes("/api/content/v1/site")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "x-vibress-publication-id": "pub_test" }),
          json: () => Promise.resolve({
            site: { title: "Test Site", locale: "en", enabledLocales: ["en", "ar"] },
            security: { isPrivate: false },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }) as any;

    const req = new NextRequest("http://localhost:7777/preview/" + token + "/ar/posts/hello?page=2");
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-rewrite")).toBe("http://localhost:7777/posts/hello?page=2");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
    // The prefix and language must remain private to the Next.js request.
    expect(res.headers.get("x-vibress-preview-token")).toBeNull();
    expect(res.headers.get("x-vibress-preview-path")).toBeNull();
  });

  describe("Production CSP & Iframe Embedding Security", () => {
    it("strictly returns frame-ancestors 'none' when allowEmbedding is false across any environment", () => {
      expect(getValidatedFrameAncestors(false, { NODE_ENV: "production" })).toBe("frame-ancestors 'none'");
      expect(getValidatedFrameAncestors(false, { NODE_ENV: "development" })).toBe("frame-ancestors 'none'");
      expect(getValidatedFrameAncestors(false, { NODE_ENV: "staging" })).toBe("frame-ancestors 'none'");
      expect(getValidatedFrameAncestors(false, { NODE_ENV: "production", ADMIN_ORIGIN: "https://admin.example.com" })).toBe("frame-ancestors 'none'");
    });

    it("restricts production same-origin embedding to 'self' without leaking dev localhost origins", () => {
      const prodCsp = getValidatedFrameAncestors(true, { NODE_ENV: "production" });
      expect(prodCsp).toBe("frame-ancestors 'self'");
      expect(prodCsp).not.toContain("localhost");
      expect(prodCsp).not.toContain("127.0.0.1");
      expect(prodCsp).not.toContain("7779");
      expect(prodCsp).not.toContain("3000");
    });

    it("correctly includes validated production cross-origin ADMIN_ORIGIN while excluding localhost", () => {
      const prodCsp = getValidatedFrameAncestors(true, {
        NODE_ENV: "production",
        ADMIN_ORIGIN: "https://admin.vibress.com",
      });
      expect(prodCsp).toBe("frame-ancestors 'self' https://admin.vibress.com");
      expect(prodCsp).not.toContain("localhost");
      expect(prodCsp).not.toContain("127.0.0.1");
    });

    it("supports multi-origin staging and production configurations via ALLOWED_PREVIEW_EMBED_ORIGINS", () => {
      const stagingCsp = getValidatedFrameAncestors(true, {
        NODE_ENV: "production",
        ALLOWED_PREVIEW_EMBED_ORIGINS: "https://staging.admin.vibress.com, https://admin.vibress.com",
      });
      expect(stagingCsp).toBe(
        "frame-ancestors 'self' https://staging.admin.vibress.com https://admin.vibress.com",
      );
    });

    it("strictly includes dev-only localhost origins when NODE_ENV is development or test", () => {
      const devCsp = getValidatedFrameAncestors(true, { NODE_ENV: "development" });
      expect(devCsp).toContain("'self'");
      expect(devCsp).toContain("http://localhost:7779");
      expect(devCsp).toContain("http://127.0.0.1:7779");
      expect(devCsp).toContain("http://localhost:7777");
      expect(devCsp).toContain("http://127.0.0.1:7777");
    });

    it("rejects malicious, unencrypted, or malformed origin injection attempts", () => {
      // 1. Unencrypted HTTP rejected in production for remote hosts
      expect(sanitizeEmbedOrigin("http://evil.com", true)).toBeNull();

      // 2. Header injection via semicolon or newline rejected
      expect(sanitizeEmbedOrigin("https://admin.vibress.com; script-src *", true)).toBeNull();
      expect(sanitizeEmbedOrigin("https://admin.vibress.com\r\nX-Injected: true", true)).toBeNull();

      // 3. Credentials or paths stripped/rejected
      expect(sanitizeEmbedOrigin("https://user:pass@admin.vibress.com/admin/path", true)).toBeNull();

      // 4. Wildcard origins rejected
      expect(sanitizeEmbedOrigin("https://*.vibress.com", true)).toBeNull();
      expect(sanitizeEmbedOrigin("*", true)).toBeNull();

      // 5. Dangerous protocols rejected
      expect(sanitizeEmbedOrigin("javascript:alert(1)", true)).toBeNull();
      expect(sanitizeEmbedOrigin("ftp://admin.vibress.com", true)).toBeNull();

      // 6. Valid HTTPS origin cleanly sanitized to canonical origin
      expect(sanitizeEmbedOrigin("https://admin.vibress.com/", true)).toBe("https://admin.vibress.com");
      expect(sanitizeEmbedOrigin("https://admin.vibress.com", true)).toBe("https://admin.vibress.com");
    });

    it("never includes untrusted third-party origins in the preview frame-ancestors directive", () => {
      const result = getValidatedFrameAncestors(true, {
        NODE_ENV: "production",
        ADMIN_ORIGIN: "https://trusted-admin.vibress.com",
      });
      expect(result).not.toContain("https://evil.com");
      expect(result).not.toContain("https://attacker.com");
      expect(result).toContain("https://trusted-admin.vibress.com");
      expect(result).toContain("'self'");
    });
  });
});
