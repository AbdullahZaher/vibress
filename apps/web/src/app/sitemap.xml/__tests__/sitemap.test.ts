import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGetPosts,
  mockGetPages,
  mockGetTags,
  mockGetAuthors,
  mockGetThemeSiteSettings,
} = vi.hoisted(() => ({
  mockGetPosts: vi.fn(),
  mockGetPages: vi.fn(),
  mockGetTags: vi.fn(),
  mockGetAuthors: vi.fn(),
  mockGetThemeSiteSettings: vi.fn(),
}));

vi.mock("../../../lib/content-api-client", () => ({
  ContentApiClient: {
    getPosts: (...args: any[]) => mockGetPosts(...args),
    getPages: (...args: any[]) => mockGetPages(...args),
    getTags: (...args: any[]) => mockGetTags(...args),
    getAuthors: (...args: any[]) => mockGetAuthors(...args),
  },
}));

vi.mock("../../../lib/site-settings", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/site-settings")>("../../../lib/site-settings");
  return {
    ...actual,
    getThemeSiteSettings: () => mockGetThemeSiteSettings(),
  };
});

import { GET } from "../route";

describe("Sitemap XML Route — Multilingual & Taxonomy Validation (LOC-008)", () => {
  beforeEach(() => {
    process.env.SITE_URL = "https://vibress.example.com";
    vi.clearAllMocks();

    mockGetTags.mockResolvedValue([
      { id: "tag-1", name: "Engineering", slug: "engineering" },
    ]);
    mockGetAuthors.mockResolvedValue([
      { id: "author-1", name: "Alice", slug: "alice" },
    ]);
  });

  it("returns 503 when publication metadata is unavailable", async () => {
    mockGetThemeSiteSettings.mockResolvedValue({ publicationId: null });
    const res = await GET();
    expect(res.status).toBe(503);
  });

  it("generates correct single-language sitemap without fabricated prefixes", async () => {
    mockGetThemeSiteSettings.mockResolvedValue({
      publicationId: "pub-1",
      locale: "en",
      primaryLocale: "en",
      enabledLocales: ["en"],
    });

    mockGetPosts.mockResolvedValue({
      posts: [
        { id: "post-1", slug: "welcome", updatedAt: "2026-08-15T00:00:00.000Z" },
      ],
      pagination: { total: 1, page: 1, limit: 100, pages: 1 },
    });

    mockGetPages.mockResolvedValue({
      pages: [
        { id: "page-1", slug: "about", updatedAt: "2026-08-15T00:00:00.000Z" },
      ],
      pagination: { total: 1, page: 1, limit: 100, pages: 1 },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const xml = await res.text();

    expect(xml).toContain("<loc>https://vibress.example.com/</loc>");
    expect(xml).toContain("<loc>https://vibress.example.com/posts/welcome</loc>");
    expect(xml).toContain("<loc>https://vibress.example.com/pages/about</loc>");
    expect(xml).toContain("<loc>https://vibress.example.com/tags/engineering</loc>");
    expect(xml).toContain("<loc>https://vibress.example.com/authors/alice</loc>");

    // No secondary prefixes or alternate tags in single-locale mode
    expect(xml).not.toContain('hreflang="');
    expect(xml).not.toContain("/en/");
  });

  it("generates localized homepage alternates and preserves primary-only taxonomy routes in multilingual mode", async () => {
    mockGetThemeSiteSettings.mockResolvedValue({
      publicationId: "pub-1",
      locale: "en",
      primaryLocale: "en",
      enabledLocales: ["en", "ar"],
    });

    // English posts and pages
    mockGetPosts.mockImplementation(async ({ locale }: { locale: string }) => {
      if (locale === "en") {
        return {
          posts: [
            { id: "post-1", slug: "tech-trends", updatedAt: "2026-08-15T00:00:00.000Z" },
          ],
          pagination: { total: 1, page: 1, limit: 100, pages: 1 },
        };
      }
      if (locale === "ar") {
        return {
          posts: [
            { id: "post-1", slug: "tech-trends-ar", updatedAt: "2026-08-16T00:00:00.000Z" },
          ],
          pagination: { total: 1, page: 1, limit: 100, pages: 1 },
        };
      }
      return { posts: [], pagination: { total: 0, page: 1, limit: 100, pages: 0 } };
    });

    mockGetPages.mockResolvedValue({
      pages: [],
      pagination: { total: 0, page: 1, limit: 100, pages: 0 },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const xml = await res.text();

    // Check homepage has both primary and secondary with alternate hreflangs
    expect(xml).toContain("<loc>https://vibress.example.com/</loc>");
    expect(xml).toContain("<loc>https://vibress.example.com/ar/</loc>");
    expect(xml).toContain('hreflang="en" href="https://vibress.example.com/"');
    expect(xml).toContain('hreflang="ar" href="https://vibress.example.com/ar/"');
    expect(xml).toContain('hreflang="x-default" href="https://vibress.example.com/"');

    // Posts should have alternates
    expect(xml).toContain("<loc>https://vibress.example.com/posts/tech-trends</loc>");
    expect(xml).toContain("<loc>https://vibress.example.com/ar/posts/tech-trends-ar</loc>");

    // Tags and Authors MUST NOT have fabricated /ar/ prefixed routes
    expect(xml).toContain("<loc>https://vibress.example.com/tags/engineering</loc>");
    expect(xml).toContain("<loc>https://vibress.example.com/authors/alice</loc>");
    expect(xml).not.toContain("https://vibress.example.com/ar/tags/");
    expect(xml).not.toContain("https://vibress.example.com/ar/authors/");
  });
});
