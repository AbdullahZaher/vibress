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
  });
});
