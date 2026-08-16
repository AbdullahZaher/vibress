import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validateAndExtractThemeZip } from "../zip-validator";
import { createLiquidThemeEngine } from "../theme-engine";

describe("Starter Theme Contract Validation", () => {
  it("validates and extracts official vibress-theme-starter.zip without errors", async () => {
    const zipPath = path.resolve(__dirname, "../../../../content/vibress-theme-starter.zip");
    expect(fs.existsSync(zipPath)).toBe(true);

    const zipBuffer = fs.readFileSync(zipPath);
    const extracted = await validateAndExtractThemeZip(zipBuffer);

    expect(extracted.manifest.id).toBe("vibress-starter-theme");
    expect(extracted.manifest.version).toBe("1.0.0");
    expect(extracted.manifest.themeApi).toBe(1);
    expect(extracted.previewImageBuffer).toBeDefined();
    expect(extracted.files.has("theme.json")).toBe(true);
    expect(extracted.files.has("settings.json")).toBe(true);
    expect(extracted.files.has("templates/home.liquid")).toBe(true);
    expect(extracted.files.has("templates/post.liquid")).toBe(true);
    expect(extracted.files.has("templates/page.liquid")).toBe(true);
    expect(extracted.files.has("templates/tag.liquid")).toBe(true);
    expect(extracted.files.has("templates/author.liquid")).toBe(true);
    expect(extracted.files.has("assets/css/theme.css")).toBe(true);
    // Ensure no forbidden JS assets in the package
    for (const fileName of extracted.files.keys()) {
      expect(fileName.endsWith(".js")).toBe(false);
      expect(fileName.endsWith(".mjs")).toBe(false);
      expect(fileName.endsWith(".cjs")).toBe(false);
      expect(fileName.endsWith(".ts")).toBe(false);
    }
  });

  it("renders starter theme home template using Liquid engine without runtime errors", async () => {
    const zipPath = path.resolve(__dirname, "../../../../content/vibress-theme-starter.zip");
    const zipBuffer = fs.readFileSync(zipPath);
    const extracted = await validateAndExtractThemeZip(zipBuffer);

    const textFiles = new Map<string, string>();
    for (const [k, v] of extracted.files.entries()) {
      if (typeof v === "string") {
        textFiles.set(k, v);
      } else if (Buffer.isBuffer(v)) {
        textFiles.set(k, v.toString("utf-8"));
      }
    }

    const engine = createLiquidThemeEngine({
      files: textFiles,
      themeId: extracted.manifest.id,
      themeVersion: extracted.manifest.version,
    });

    const rendered = await engine.renderFile("home", {
      site: {
        title: "Test Publication",
        description: "A test publication",
        url: "https://example.com",
        locale: "en",
        primaryNav: [{ label: "Home", url: "/" }],
        secondaryNav: [{ label: "About", url: "/pages/about" }],
      },
      settings: {
        accentColor: "#6366f1",
        typographyFamily: "sans",
        showPublicationDate: true,
        showAuthorAvatars: true,
        postsPerPage: 10,
        heroHeadline: "Welcome to our publication",
      },
      posts: [
        {
          id: "1",
          title: "First Post",
          slug: "first-post",
          excerpt: "Excerpt of the post",
          html: "<p>Hello world</p>",
          publishedAt: "2026-08-16T12:00:00Z",
          readingTimeMinutes: 3,
          featured: true,
          url: "/posts/first-post",
          featureImage: { url: "https://example.com/img.jpg", alt: "Image" },
          primaryAuthor: { name: "Author", url: "/authors/author" },
          tags: [{ id: "t1", name: "Tech", slug: "tech", url: "/tags/tech" }],
        },
      ],
      pagination: {
        page: 1,
        pages: 1,
        total: 1,
        limit: 10,
        prev: null,
        next: null,
      },
    });

    expect(rendered).toContain("Test Publication");
    expect(rendered).toContain("First Post");
    expect(rendered).toContain("Welcome to our publication");
  });

  it("renders post, page, tag, and author templates without runtime errors", async () => {
    const zipPath = path.resolve(__dirname, "../../../../content/vibress-theme-starter.zip");
    const zipBuffer = fs.readFileSync(zipPath);
    const extracted = await validateAndExtractThemeZip(zipBuffer);

    const textFiles = new Map<string, string>();
    for (const [k, v] of extracted.files.entries()) {
      if (typeof v === "string") {
        textFiles.set(k, v);
      } else if (Buffer.isBuffer(v)) {
        textFiles.set(k, v.toString("utf-8"));
      }
    }

    const engine = createLiquidThemeEngine({
      files: textFiles,
      themeId: extracted.manifest.id,
      themeVersion: extracted.manifest.version,
    });

    const commonSite = {
      title: "Test Publication",
      description: "A test publication",
      url: "https://example.com",
      locale: "en",
    };

    // Post template
    const renderedPost = await engine.renderFile("post", {
      site: commonSite,
      settings: { accentColor: "#6366f1" },
      post: {
        id: "p1",
        title: "Deep Dive Article",
        slug: "deep-dive",
        html: "<p>Comprehensive guide to Vibress themes.</p>",
        publishedAt: "2026-08-16T12:00:00Z",
        readingTimeMinutes: 5,
        primaryAuthor: { name: "Sarah Connor", url: "/authors/sarah" },
        tags: [{ name: "Engineering", slug: "engineering", url: "/tags/engineering" }],
      },
    });
    expect(renderedPost).toContain("Deep Dive Article");
    expect(renderedPost).toContain("Comprehensive guide to Vibress themes.");

    // Page template
    const renderedPage = await engine.renderFile("page", {
      site: commonSite,
      settings: { accentColor: "#6366f1" },
      page: {
        id: "page1",
        title: "About Us",
        slug: "about",
        html: "<p>We build independent publishing tools.</p>",
      },
    });
    expect(renderedPage).toContain("About Us");
    expect(renderedPage).toContain("We build independent publishing tools.");

    // Tag template
    const renderedTag = await engine.renderFile("tag", {
      site: commonSite,
      settings: { accentColor: "#6366f1" },
      tag: {
        id: "tag1",
        name: "Engineering",
        slug: "engineering",
        description: "Articles about software engineering",
      },
      posts: [],
      pagination: { page: 1, pages: 1, total: 0, limit: 10, prev: null, next: null },
    });
    expect(renderedTag).toContain("Engineering");

    // Author template
    const renderedAuthor = await engine.renderFile("author", {
      site: commonSite,
      settings: { accentColor: "#6366f1" },
      author: {
        id: "a1",
        name: "Sarah Connor",
        slug: "sarah",
        bio: "Lead Systems Engineer",
      },
      posts: [],
      pagination: { page: 1, pages: 1, total: 0, limit: 10, prev: null, next: null },
    });
    expect(renderedAuthor).toContain("Sarah Connor");
  });
});
