import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { getThemeSiteSettings } from "../theme-host";
import { getPublicExtensionPage } from "../public-extension-client";
import PublicExtensionView, {
  generateMetadata,
} from "../../app/extensions/[pluginId]/[viewId]/page";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_PUBLIC_NOT_FOUND"); },
}));
vi.mock("../theme-host", () => ({
  getThemeSiteSettings: vi.fn(),
}));
vi.mock("../public-extension-client", () => ({
  getPublicExtensionPage: vi.fn(),
  isValidPublicHost: (host: string) => /^publication-[ab]\.example$/.test(host),
}));

const params = Promise.resolve({ pluginId: "vibress-lms", viewId: "courses" });
const view = {
  publicationId: "pub_a", pluginId: "vibress-lms",
  viewId: "courses", routeId: "catalog",
  title: { en: "Courses", ar: "الدورات" },
  data: { total: 3 },
};

function site(publicationId: string, url: string, locale = "en") {
  return {
    publicationId, url, locale, primaryLocale: "en",
    enabledLocales: ["en", "ar"], title: "Vibress", description: "Test publication",
    security: { isPrivate: false },
  };
}

describe("EXT-302A verified canonical and publication-scoped SSR", () => {
  beforeEach(() => {
    vi.mocked(headers).mockResolvedValue(new Headers({
      host: "publication-a.example",
      "x-forwarded-host": "publication-b.example",
    }));
    vi.mocked(getPublicExtensionPage).mockResolvedValue(view);
    vi.mocked(getThemeSiteSettings).mockResolvedValue(
      site("pub_a", "https://publication-a.example"),
    );
  });
  afterEach(() => vi.clearAllMocks());

  it("uses verified request publication domain, never global SITE_URL", async () => {
    const result = await generateMetadata({ params });
    expect(result.alternates?.canonical).toBe(
      "https://publication-a.example/extensions/vibress-lms/courses",
    );
    expect(result.openGraph && "url" in result.openGraph && result.openGraph.url).toBe(
      "https://publication-a.example/extensions/vibress-lms/courses",
    );
  });

  it("generates Arabic canonical independently for the second publication", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers({
      host: "publication-b.example",
      "x-forwarded-host": "publication-a.example",
    }));
    vi.mocked(getPublicExtensionPage).mockResolvedValue({
      ...view, publicationId: "pub_b",
    });
    vi.mocked(getThemeSiteSettings).mockResolvedValue(
      site("pub_b", "https://publication-b.example", "ar"),
    );
    const result = await generateMetadata({ params });
    expect(result.title).toBe("الدورات");
    expect(result.alternates?.canonical).toBe(
      "https://publication-b.example/ar/extensions/vibress-lms/courses",
    );
  });

  it("never renders a descriptor from another publication using stale settings", async () => {
    vi.mocked(getThemeSiteSettings).mockResolvedValue(
      site("pub_b", "https://publication-b.example"),
    );
    const metadata = await generateMetadata({ params });
    expect(metadata.robots).toEqual({ index: false, follow: false });
    await expect(PublicExtensionView({ params }))
      .rejects.toThrow("NEXT_PUBLIC_NOT_FOUND");
  });

  it("does not trust a configured external site URL as the publication canonical", async () => {
    vi.mocked(getThemeSiteSettings).mockResolvedValue(
      site("pub_a", "https://external-attacker.example"),
    );
    const metadata = await generateMetadata({ params });
    expect(metadata.alternates?.canonical).toBe(
      "https://publication-a.example/extensions/vibress-lms/courses",
    );
  });
});
