import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { getPublicExtensionPage } from "../public-extension-client";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const descriptor = {
  pluginId: "vibress-lms", viewId: "courses", routeId: "catalog",
  title: { en: "Courses", ar: "الدورات" },
};

describe("EXT-302A publication-safe public SSR projection", () => {
  beforeEach(() => {
    vi.mocked(headers).mockResolvedValue(new Headers({
      host: "publication-a.example",
      cookie: "staff_session=SECRET; vb_site_auth=public-proof; member_session=PRIVATE",
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("requests only the Host-admitted public route, no caching or private sessions", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(descriptor), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ title: "Courses", total: 3 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await getPublicExtensionPage("vibress-lms", "courses")).toEqual({
      ...descriptor, data: { title: "Courses", total: 3 },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [descriptorUrl, descriptorOptions] = fetchSpy.mock.calls[0]!;
    const [contentUrl, contentOptions] = fetchSpy.mock.calls[1]!;
    expect(String(descriptorUrl)).toContain("/extensions/vibress-lms/views/courses");
    expect(String(contentUrl)).toContain("/extensions/vibress-lms/v1/catalog");
    for (const options of [descriptorOptions, contentOptions]) {
      expect(options.cache).toBe("no-store");
      expect(options.headers["x-forwarded-host"]).toBe("publication-a.example");
      expect(options.headers.cookie).toBe("vb_site_auth=public-proof");
      expect(JSON.stringify(options)).not.toContain("SECRET");
      expect(JSON.stringify(options)).not.toContain("PRIVATE");
    }
  });

  it("fails closed on forged IDs, member data, invalid DTOs and missing views", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ...descriptor, routeId: "../admin",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(descriptor), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        title: "Courses", privilegedMemberEmail: { nested: "secret" },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await getPublicExtensionPage("../admin", "courses")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getPublicExtensionPage("vibress-lms", "courses")).toBeNull();
    expect(await getPublicExtensionPage("vibress-lms", "courses")).toBeNull();
    expect(await getPublicExtensionPage("vibress-lms", "courses")).toBeNull();
  });

  it("does not serve stale HTML or another tenant's fallback when backend is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("Unavailable", { status: 503 }),
    ));
    await expect(getPublicExtensionPage("vibress-lms", "courses"))
      .rejects.toThrow(/unavailable/);
  });
});
