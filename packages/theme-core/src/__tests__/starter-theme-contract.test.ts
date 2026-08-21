import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validateAndExtractThemeZip } from "../zip-validator";
import { createLiquidThemeEngine } from "../theme-engine";
import type {
  SiteViewModel,
  PostViewModel,
  PageViewModel,
  TagViewModel,
  AuthorViewModel,
  PaginationViewModel,
} from "../view-models";

describe("Starter Theme Contract & Consistency Test", () => {
  const starterZipPath = path.resolve(
    __dirname,
    "../../../../VIBRESS_THEME_DESIGNER_PACKAGE/vibress-theme-starter.zip",
  );

  const mockSite: SiteViewModel = {
    title: "Vibress Chronicle",
    description: "Publishing the modern open web",
    tagline: "Speed, Security, Freedom",
    url: "https://vibress.org",
    locale: "en",
    direction: "ltr",
    timezone: "UTC",
    accentColor: "#6366f1",
    logo: "/media/logo.svg",
    navigation: {
      primary: [
        { label: "Articles", url: "/posts" },
        { label: "About", url: "/pages/about" },
      ],
      secondary: [
        { label: "Privacy Policy", url: "/pages/privacy" },
        { label: "Terms of Service", url: "/pages/terms" },
      ],
    },
  };

  const mockAuthor: AuthorViewModel = {
    id: "usr_100",
    name: "Eleanor Vance",
    slug: "eleanor-vance",
    bio: "Senior investigative reporter covering technology and society.",
    avatar: "/media/avatars/eleanor.webp",
    url: "/authors/eleanor-vance",
  };

  const mockTag: TagViewModel = {
    id: "tag_200",
    name: "Technology",
    slug: "technology",
    description: "Articles exploring modern computing and web systems.",
    url: "/tags/technology",
  };

  const mockPost: PostViewModel = {
    id: "post_300",
    title: "Zero-Rebuild Theme Architecture",
    slug: "zero-rebuild-theme-architecture",
    excerpt: "How server-side Liquid templates enable instant styling updates.",
    html: "<p>Vibress executes themes at runtime without frontend builds.</p>",
    publishedAt: "2026-08-17T12:00:00.000Z",
    readingTimeMinutes: 5,
    featured: true,
    featureImage: {
      url: "/media/featured-cover.webp",
      alt: "Clean code on laptop screen",
      caption: "Photo by Studio",
    },
    primaryAuthor: mockAuthor,
    authors: [mockAuthor],
    tags: [mockTag],
    url: "/posts/zero-rebuild-theme-architecture",
    seo: {
      title: "Zero-Rebuild Theme Architecture — Vibress",
      description: "How server-side Liquid templates enable instant styling updates.",
    },
  };

  const mockPage: PageViewModel = {
    id: "page_400",
    title: "About Our Publication",
    slug: "about-us",
    excerpt: "Independent journalism and engineering reflections.",
    html: "<p>We are a community of independent writers and software craftsmen.</p>",
    publishedAt: "2026-01-01T00:00:00.000Z",
    featureImage: {
      url: "/media/about-cover.webp",
      alt: "Editorial team workspace",
    },
    primaryAuthor: mockAuthor,
    url: "/pages/about-us",
    seo: {
      title: "About Us — Vibress",
      description: "Independent journalism and engineering reflections.",
    },
  };

  const mockPagination: PaginationViewModel = {
    page: 1,
    limit: 10,
    total: 25,
    pages: 3,
    previous: null,
    next: 2,
    hasPrevious: false,
    hasNext: true,
  };

  const mockSettings = {
    accentColor: "#6366f1",
    typographyFamily: "sans",
    showPublicationDate: true,
    showAuthorAvatars: true,
    heroHeadline: "Ideas, Stories & Publications",
  };

  it("successfully passes zip-validator security, quota, and manifest checks", async () => {
    const zipBuffer = fs.readFileSync(starterZipPath);
    const result = await validateAndExtractThemeZip(zipBuffer);

    expect(result.manifest.id).toBe("vibress-starter-theme");
    expect(result.manifest.version).toBe("1.0.0");
    expect(result.manifest.themeApi).toBe(1);
    expect(result.files.has("theme.json")).toBe(true);
    expect(result.files.has("preview.webp")).toBe(true);
    expect(result.files.has("templates/home.liquid")).toBe(true);
    expect(result.files.has("templates/post.liquid")).toBe(true);
    expect(result.files.has("templates/page.liquid")).toBe(true);
    expect(result.files.has("templates/tag.liquid")).toBe(true);
    expect(result.files.has("templates/author.liquid")).toBe(true);
    expect(result.files.has("partials/header.liquid")).toBe(true);
    expect(result.files.has("partials/footer.liquid")).toBe(true);
    expect(result.files.has("partials/pagination.liquid")).toBe(true);
  });

  it("renders home.liquid cleanly with ViewModel contract without undefined errors", async () => {
    const zipBuffer = fs.readFileSync(starterZipPath);
    const { files, manifest } = await validateAndExtractThemeZip(zipBuffer);

    const stringFiles = new Map<string, string>();
    for (const [p, buf] of files.entries()) {
      stringFiles.set(p, buf.toString("utf-8"));
    }

    const engine = createLiquidThemeEngine({
      themeId: manifest.id,
      themeVersion: manifest.version,
      files: stringFiles,
    });

    const rendered = await engine.renderFile("templates/home.liquid", {
      site: mockSite,
      posts: [mockPost],
      tags: [mockTag],
      pagination: mockPagination,
      settings: mockSettings,
    });

    expect(rendered).toContain("Vibress Chronicle");
    expect(rendered).toContain("Ideas, Stories &amp; Publications");
    expect(rendered).toContain("Articles");
    expect(rendered).toContain("/posts");
    expect(rendered).toContain("Zero-Rebuild Theme Architecture");
    expect(rendered).toContain("#Technology");
    expect(rendered).toContain("Eleanor Vance");
    expect(rendered).toContain("Older Articles &rarr;");
  });

  it("renders post.liquid cleanly with ViewModel contract", async () => {
    const zipBuffer = fs.readFileSync(starterZipPath);
    const { files, manifest } = await validateAndExtractThemeZip(zipBuffer);

    const stringFiles = new Map<string, string>();
    for (const [p, buf] of files.entries()) {
      stringFiles.set(p, buf.toString("utf-8"));
    }

    const engine = createLiquidThemeEngine({
      themeId: manifest.id,
      themeVersion: manifest.version,
      files: stringFiles,
    });

    const rendered = await engine.renderFile("templates/post.liquid", {
      site: mockSite,
      post: mockPost,
      settings: mockSettings,
    });

    expect(rendered).toContain("Zero-Rebuild Theme Architecture");
    expect(rendered).toContain("Vibress executes themes at runtime without frontend builds.");
    expect(rendered).toContain("Eleanor Vance");
    expect(rendered).toContain("Senior investigative reporter");
    expect(rendered).toContain("#Technology");
    expect(rendered).toContain("Clean code on laptop screen");
  });

  it("renders page.liquid cleanly with ViewModel contract", async () => {
    const zipBuffer = fs.readFileSync(starterZipPath);
    const { files, manifest } = await validateAndExtractThemeZip(zipBuffer);

    const stringFiles = new Map<string, string>();
    for (const [p, buf] of files.entries()) {
      stringFiles.set(p, buf.toString("utf-8"));
    }

    const engine = createLiquidThemeEngine({
      themeId: manifest.id,
      themeVersion: manifest.version,
      files: stringFiles,
    });

    const rendered = await engine.renderFile("templates/page.liquid", {
      site: mockSite,
      page: mockPage,
      settings: mockSettings,
    });

    expect(rendered).toContain("About Our Publication");
    expect(rendered).toContain("We are a community of independent writers and software craftsmen.");
  });

  it("renders tag.liquid archive template cleanly", async () => {
    const zipBuffer = fs.readFileSync(starterZipPath);
    const { files, manifest } = await validateAndExtractThemeZip(zipBuffer);

    const stringFiles = new Map<string, string>();
    for (const [p, buf] of files.entries()) {
      stringFiles.set(p, buf.toString("utf-8"));
    }

    const engine = createLiquidThemeEngine({
      themeId: manifest.id,
      themeVersion: manifest.version,
      files: stringFiles,
    });

    const rendered = await engine.renderFile("templates/tag.liquid", {
      site: mockSite,
      tag: mockTag,
      posts: [mockPost],
      pagination: mockPagination,
      settings: mockSettings,
    });

    expect(rendered).toContain("#Technology");
    expect(rendered).toContain("Articles exploring modern computing and web systems.");
    expect(rendered).toContain("Zero-Rebuild Theme Architecture");
  });

  it("renders author.liquid archive template cleanly", async () => {
    const zipBuffer = fs.readFileSync(starterZipPath);
    const { files, manifest } = await validateAndExtractThemeZip(zipBuffer);

    const stringFiles = new Map<string, string>();
    for (const [p, buf] of files.entries()) {
      stringFiles.set(p, buf.toString("utf-8"));
    }

    const engine = createLiquidThemeEngine({
      themeId: manifest.id,
      themeVersion: manifest.version,
      files: stringFiles,
    });

    const rendered = await engine.renderFile("templates/author.liquid", {
      site: mockSite,
      author: mockAuthor,
      posts: [mockPost],
      pagination: mockPagination,
      settings: mockSettings,
    });

    expect(rendered).toContain("Eleanor Vance");
    expect(rendered).toContain("Senior investigative reporter covering technology and society.");
    expect(rendered).toContain("Zero-Rebuild Theme Architecture");
  });
});
