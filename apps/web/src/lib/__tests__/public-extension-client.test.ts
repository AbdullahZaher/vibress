import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { getPublicExtensionPage, getPublicExtensionIdentity } from "../public-extension-client";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const approved = {
  publicationId: "pub_a",
  pluginId: "vibress-lms", viewId: "courses", routeId: "catalog",
  title: { en: "Courses", ar: "الدورات" },
  data: { title: "Courses", total: 3 },
};

describe("EXT-302A publication-safe public SSR projection", () => {
  beforeEach(() => {
    vi.mocked(headers).mockResolvedValue(new Headers({
      host: "publication-a.example",
      "x-forwarded-host": "publication-b.example", // Untrusted browser input.
      "x-real-ip": "198.51.100.23", // Overwritten by the production gateway.
      cookie: "staff_session=SECRET; vb_site_auth=public-proof; member_session=PRIVATE",
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses one publication-scoped request, no caching or Staff/Member cookies", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(approved), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    expect(await getPublicExtensionPage("vibress-lms", "courses")).toEqual(approved);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("Expected a public API request");
    const [url, options] = call;
    expect(String(url)).toContain("/extensions/vibress-lms/views/courses/page");
    expect(options.cache).toBe("no-store");
    expect(options.headers["x-forwarded-host"]).toBe("publication-a.example");
    expect(options.headers["x-forwarded-for"]).toBe("198.51.100.23");
    expect(options.headers.cookie).toBe("vb_site_auth=public-proof");
    expect(JSON.stringify(options)).not.toContain("SECRET");
    expect(JSON.stringify(options)).not.toContain("PRIVATE");
    expect(JSON.stringify(options)).not.toContain("publication-b.example");
  });

  it("checks the lightweight bound identity without fetching the public catalog", async () => {
    const identity = {
      pluginId: "vibress-lms", viewId: "courses", routeId: "catalog",
      publicationId: "pub_a", locale: "ar-SA",
      publishedLocales: ["ar"], title: { en: "Courses", ar: "الدورات" },
    };
    const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify(identity), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    expect(await getPublicExtensionIdentity("vibress-lms", "courses", "ar-SA")).toEqual(identity);
    const call = spy.mock.calls[0];
    if (!call) throw new Error("Expected an identity request");
    expect(String(call[0])).toContain("/views/courses/identity?locale=ar-SA");
    expect(String(call[0])).not.toContain("/page");
    expect(call[1].headers.cookie).toBe("vb_site_auth=public-proof");
    expect(call[1].headers["x-forwarded-host"]).toBe("publication-a.example");
    expect(call[1].headers["x-forwarded-for"]).toBe("198.51.100.23");
    expect(JSON.stringify(call)).not.toContain("PRIVATE");
    expect(JSON.stringify(call)).not.toContain("SECRET");
  });

  it("rejects spoofed or invalid public view identities", async () => {
    const valid = {
      pluginId: "vibress-lms", viewId: "courses", routeId: "catalog",
      publicationId: "pub_a", locale: "en",
      title: { en: "Courses", ar: "الدورات" },
    };
    const spy = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...valid, publicationId: "" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...valid, pluginId: "another" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...valid, locale: "ar" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", spy);
    expect(await getPublicExtensionIdentity("../admin", "courses", "en")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    for (let i = 0; i < 4; i++) {
      expect(await getPublicExtensionIdentity("vibress-lms", "courses", "en")).toBeNull();
    }
  });

  it("fails closed on invalid IDs, nested/private data, wrong plugin and missing pages", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...approved, pluginId: "../admin",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...approved, data: { email: { nested: "private" } },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await getPublicExtensionPage("../admin", "courses")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getPublicExtensionPage("vibress-lms", "courses")).toBeNull();
    expect(await getPublicExtensionPage("vibress-lms", "courses")).toBeNull();
    expect(await getPublicExtensionPage("vibress-lms", "courses")).toBeNull();
  });

  it("does not forward spoofed or malformed client IPs to rate-limit enforcement", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers({
      host: "publication-a.example", "x-real-ip": "192.0.2.10, 192.0.2.11",
    }));
    const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify(approved), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    expect(await getPublicExtensionPage("vibress-lms", "courses")).not.toBeNull();
    const call = spy.mock.calls[0];
    if (!call) throw new Error("Expected a request");
    expect(call[1].headers["x-forwarded-for"]).toBeUndefined();
  });

  it("refuses missing Host authority, even when forwarded host is present", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers({
      "x-forwarded-host": "publication-b.example",
    }));
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(getPublicExtensionPage("vibress-lms", "courses")).rejects.toThrow(/hostname/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not serve stale responses when the backend is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("Unavailable", { status: 503 }),
    ));
    await expect(getPublicExtensionPage("vibress-lms", "courses"))
      .rejects.toThrow(/unavailable/);
  });
});
