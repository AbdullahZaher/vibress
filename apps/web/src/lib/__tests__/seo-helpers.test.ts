import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getPublicSiteUrl,
  buildPageMetadata,
  buildPostJsonLd,
  buildPageJsonLd,
} from "../seo-helpers";
import { PublicPostDetailDto, PublicPageDetailDto } from "@vibress/api-contracts";

describe("SEO Helpers — Canonical Architecture", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SITE_URL = "https://vibress.example.com";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("resolves public site url from environment without admin origin contamination", () => {
    expect(getPublicSiteUrl()).toBe("https://vibress.example.com");
  });

  it("builds default canonical url using public site URL and route path", () => {
    const meta = buildPageMetadata({
      title: "My Great Article",
      description: "Article excerpt",
      canonicalPath: "/posts/my-great-article",
    });

    expect(meta.alternates?.canonical).toBe("https://vibress.example.com/posts/my-great-article");
    expect(meta.openGraph?.url).toBe("https://vibress.example.com/posts/my-great-article");
  });

  it("supports explicit user canonical override when provided with full URL", () => {
    const meta = buildPageMetadata({
      title: "Syndicated Article",
      description: "Article excerpt",
      canonicalPath: "/posts/syndicated-article",
      canonicalOverride: "https://medium.com/@author/syndicated-article",
    });

    expect(meta.alternates?.canonical).toBe("https://medium.com/@author/syndicated-article");
    expect(meta.openGraph?.url).toBe("https://medium.com/@author/syndicated-article");
  });

  it("ignores empty or blank canonical override and falls back to default route path", () => {
    const meta = buildPageMetadata({
      title: "Standard Post",
      description: "Article excerpt",
      canonicalPath: "/posts/standard-post",
      canonicalOverride: "   ",
    });

    expect(meta.alternates?.canonical).toBe("https://vibress.example.com/posts/standard-post");
  });

  it("generates correct JSON-LD canonical URLs for posts and pages", () => {
    const author = { id: "author-1", name: "Jane Doe", slug: "jane-doe", bio: null };
    const mockPost: PublicPostDetailDto = {
      id: "post-1",
      title: "Test Post",
      slug: "test-post",
      excerpt: "Sample excerpt",
      content: { schema: "vibress-studio", version: 1, editor: { lexicalVersion: "0.13.1" }, root: { type: "root", children: [], version: 1 } },
      html: "<p>Sample</p>",
      publishedAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      primaryAuthor: author,
      authors: [author],
      tags: [],
      seo: {
        title: "SEO Title",
        description: "SEO Desc",
        canonicalUrl: "",
      },
    };

    const postJsonLd = buildPostJsonLd(mockPost);
    expect((postJsonLd.mainEntityOfPage as Record<string, unknown>)["@id"]).toBe(
      "https://vibress.example.com/posts/test-post",
    );

    const mockPage: PublicPageDetailDto = {
      id: "page-1",
      title: "About Us",
      slug: "about-us",
      excerpt: "About description",
      content: { schema: "vibress-studio", version: 1, editor: { lexicalVersion: "0.13.1" }, root: { type: "root", children: [], version: 1 } },
      html: "<p>About us</p>",
      publishedAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      seo: {
        title: "About Us",
        description: "About us SEO",
        canonicalUrl: "",
      },
    };

    const pageJsonLd = buildPageJsonLd(mockPage);
    expect(pageJsonLd.url).toBe("https://vibress.example.com/pages/about-us");
    expect((pageJsonLd.mainEntityOfPage as Record<string, unknown>)["@id"]).toBe(
      "https://vibress.example.com/pages/about-us",
    );
  });

  it("generates correct localized JSON-LD URLs when locale is a secondary enabled language", () => {
    const author = { id: "author-1", name: "Jane Doe", slug: "jane-doe", bio: null };
    const mockPost: PublicPostDetailDto = {
      id: "post-1",
      title: "Test Post FR",
      slug: "test-post",
      excerpt: "Sample excerpt",
      content: { schema: "vibress-studio", version: 1, editor: { lexicalVersion: "0.13.1" }, root: { type: "root", children: [], version: 1 } },
      html: "<p>Sample</p>",
      publishedAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      primaryAuthor: author,
      authors: [author],
      tags: [],
      seo: {
        title: "SEO Title FR",
        description: "SEO Desc FR",
        canonicalUrl: "",
      },
    };

    const postJsonLd = buildPostJsonLd(mockPost, "fr", {
      primaryLocale: "en",
      enabledLocales: ["en", "fr"],
    });

    expect(postJsonLd.url).toBe("https://vibress.example.com/fr/posts/test-post");
    expect((postJsonLd.mainEntityOfPage as Record<string, unknown>)["@id"]).toBe(
      "https://vibress.example.com/fr/posts/test-post",
    );
    expect(postJsonLd.inLanguage).toBe("fr");

    const mockPage: PublicPageDetailDto = {
      id: "page-1",
      title: "À propos",
      slug: "a-propos",
      excerpt: "Description",
      content: { schema: "vibress-studio", version: 1, editor: { lexicalVersion: "0.13.1" }, root: { type: "root", children: [], version: 1 } },
      html: "<p>À propos</p>",
      publishedAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      seo: {
        title: "À propos",
        description: "Description",
        canonicalUrl: "",
      },
    };

    const pageJsonLd = buildPageJsonLd(mockPage, "fr", {
      primaryLocale: "en",
      enabledLocales: ["en", "fr"],
    });

    expect(pageJsonLd.url).toBe("https://vibress.example.com/fr/pages/a-propos");
    expect((pageJsonLd.mainEntityOfPage as Record<string, unknown>)["@id"]).toBe(
      "https://vibress.example.com/fr/pages/a-propos",
    );
    expect(pageJsonLd.inLanguage).toBe("fr");
  });

  it("does not prefix JSON-LD URLs when locale is the primary locale in Arabic-only setup", () => {
    const author = { id: "author-1", name: "Ahmed", slug: "ahmed", bio: null };
    const mockPost: PublicPostDetailDto = {
      id: "post-1",
      title: "منشور تجريبي",
      slug: "arabic-post",
      excerpt: "مقتطف",
      content: { schema: "vibress-studio", version: 1, editor: { lexicalVersion: "0.13.1" }, root: { type: "root", children: [], version: 1 } },
      html: "<p>محتوى</p>",
      publishedAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      primaryAuthor: author,
      authors: [author],
      tags: [],
      seo: {
        title: "عنوان",
        description: "وصف",
        canonicalUrl: "",
      },
    };

    const postJsonLd = buildPostJsonLd(mockPost, "ar", {
      primaryLocale: "ar",
      enabledLocales: ["ar"],
    });

    expect(postJsonLd.url).toBe("https://vibress.example.com/posts/arabic-post");
    expect((postJsonLd.mainEntityOfPage as Record<string, unknown>)["@id"]).toBe(
      "https://vibress.example.com/posts/arabic-post",
    );
    expect(postJsonLd.inLanguage).toBe("ar");
  });
});
