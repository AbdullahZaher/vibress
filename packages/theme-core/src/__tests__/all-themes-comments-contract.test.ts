import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { createLiquidThemeEngine } from "../theme-engine";
import { mapPostToViewModel } from "../view-models";
import { validateAndExtractThemeZip } from "../zip-validator";
import type {
  SiteViewModel,
  PostViewModel,
  TagViewModel,
  AuthorViewModel,
  PaginationViewModel,
} from "../view-models";

function loadDirectoryFiles(dir: string, prefix = ""): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(dir)) {
    return map;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const sub = loadDirectoryFiles(fullPath, relPath);
      for (const [k, v] of sub.entries()) {
        map.set(k, v);
      }
    } else if (entry.isFile()) {
      map.set(relPath, fs.readFileSync(fullPath, "utf-8"));
    }
  }
  return map;
}

describe("All Themes Comments Contract & Integration Verification", () => {
  const mockSite: SiteViewModel = {
    title: "Vibress Review",
    description: "Modern publishing on open web standards",
    tagline: "Speed, Security, Freedom",
    url: "https://vibress.org",
    locale: "en",
    direction: "ltr",
    timezone: "UTC",
    accentColor: "#6366f1",
    navigation: {
      primary: [{ label: "Home", url: "/" }],
      secondary: [],
    },
    comments_enabled: true,
  };

  const mockSiteAr: SiteViewModel = {
    title: "مجلة فايبرس",
    description: "منصة النشر الحديثة المستقلة",
    tagline: "سرعة، أمان، وحرية",
    url: "https://vibress.org/ar",
    locale: "ar",
    direction: "rtl",
    timezone: "UTC",
    accentColor: "#D8F75A",
    navigation: {
      primary: [{ label: "الرئيسية", url: "/ar" }],
      secondary: [],
    },
    comments_enabled: true,
  };

  const mockAuthor: AuthorViewModel = {
    id: "usr_100",
    name: "Eleanor Vance",
    slug: "eleanor-vance",
    url: "/authors/eleanor-vance",
  };

  const mockTag: TagViewModel = {
    id: "tag_200",
    name: "Architecture",
    slug: "architecture",
    url: "/tags/architecture",
  };

  const mockPost: PostViewModel = {
    id: "post_comment_test_123",
    title: "The Architecture of Native Comments in Vibress",
    slug: "the-architecture-of-native-comments-in-vibress",
    excerpt: "Deep dive into publication isolation and zero N+1 batched queries.",
    html: "<p>Comments are first class citizens in the theme runtime.</p>",
    publishedAt: "2026-09-18T12:00:00.000Z",
    readingTimeMinutes: 6,
    featured: true,
    commentCount: 42,
    comment_count: 42,
    primaryAuthor: mockAuthor,
    authors: [mockAuthor],
    tags: [mockTag],
    url: "/posts/the-architecture-of-native-comments-in-vibress",
    seo: {
      title: "The Architecture of Native Comments in Vibress",
      description: "Deep dive into publication isolation.",
    },
  };

  const mockPagination: PaginationViewModel = {
    page: 1,
    limit: 10,
    total: 1,
    pages: 1,
    previous: null,
    next: null,
    hasPrevious: false,
    hasNext: false,
  };

  describe("1. PostViewModel Contract & Symmetrical Aliases", () => {
    it("maps commentCount and comment_count accurately from post entity", () => {
      const rawPost = {
        id: "post_raw_99",
        title: "Test Post",
        slug: "test-post",
        html: "<p>Content</p>",
        commentCount: 17,
        primaryAuthor: mockAuthor,
        authors: [mockAuthor],
        tags: [mockTag],
      };

      const vm = mapPostToViewModel(rawPost);

      expect(vm.commentCount).toBe(17);
      expect(vm.comment_count).toBe(17);
      expect(vm.commentCount).toBe(vm.comment_count);
    });

    it("defaults commentCount and comment_count to 0 if undefined", () => {
      const rawPost = {
        id: "post_raw_100",
        title: "Test Post Without Comments",
        slug: "test-post-without-comments",
        html: "<p>Content</p>",
      };

      const vm = mapPostToViewModel(rawPost);
      expect(vm.commentCount).toBe(0);
      expect(vm.comment_count).toBe(0);
    });
  });

  describe("2. Starter Theme Comments Integration", () => {
    const starterDir = path.resolve(__dirname, "../../../../content/theme-starter");
    const starterFiles = loadDirectoryFiles(starterDir);

    it("renders post.liquid with official {% comments %} mount and comment count", async () => {
      const engine = createLiquidThemeEngine({
        themeId: "vibress-starter-theme",
        themeVersion: "1.0.0",
        files: starterFiles,
      });

      const html = await engine.renderFile("templates/post.liquid", {
        site: mockSite,
        post: mockPost,
        settings: { showPublicationDate: true },
      });

      expect(html).toContain('id="comments-container"');
      expect(html).toContain('id="vb-comments-root"');
      expect(html).toContain('data-post-id="post_comment_test_123"');
      expect(html).toContain('data-comment-count="42"');
      expect(html).toContain("article-comments-count");
      expect(html).toContain("42");
    });

    it("renders home.liquid with post card comment count badge", async () => {
      const engine = createLiquidThemeEngine({
        themeId: "vibress-starter-theme",
        themeVersion: "1.0.0",
        files: starterFiles,
      });

      const html = await engine.renderFile("templates/home.liquid", {
        site: mockSite,
        posts: [mockPost],
        tags: [mockTag],
        pagination: mockPagination,
        settings: { showPublicationDate: true },
      });

      expect(html).toContain("post-card-comments");
      expect(html).toContain("42");
    });

    it("renders Arabic RTL starter post with proper direction and localized strings", async () => {
      const engine = createLiquidThemeEngine({
        themeId: "vibress-starter-theme",
        themeVersion: "1.0.0",
        files: starterFiles,
      });

      const html = await engine.renderFile("templates/post.liquid", {
        site: mockSiteAr,
        post: mockPost,
        locale: "ar",
        settings: { showPublicationDate: true },
      });

      expect(html).toContain('dir="rtl"');
      expect(html).toContain("تعليقات");
      expect(html).toContain('id="vb-comments-root"');
    });
  });

  describe("3. Morrowe Magazine Theme Comments Integration", () => {
    const morroweDir = path.resolve(__dirname, "../../../../content/morrowe-magazine");
    const morroweFiles = loadDirectoryFiles(morroweDir);

    it("renders post.liquid with official {% comments %} mount and magazine styling", async () => {
      const engine = createLiquidThemeEngine({
        themeId: "morrowe-magazine",
        themeVersion: "1.1.0",
        files: morroweFiles,
      });

      const html = await engine.renderFile("templates/post.liquid", {
        site: mockSite,
        post: mockPost,
        settings: { colorMode: "auto", displayStyle: "serif", accentColor: "#D8F75A" },
      });

      expect(html).toContain('id="comments"');
      expect(html).toContain("mr-comments-wrap");
      expect(html).toContain("vb-comments-section");
      expect(html).toContain('id="vb-comments-root"');
      expect(html).toContain('data-post-id="post_comment_test_123"');
      expect(html).toContain("mr-article-comments-link");
      expect(html).toContain("42");
    });

    it("renders home.liquid with comment count on lead story and feature stories", async () => {
      const engine = createLiquidThemeEngine({
        themeId: "morrowe-magazine",
        themeVersion: "1.1.0",
        files: morroweFiles,
      });

      const html = await engine.renderFile("templates/home.liquid", {
        site: mockSite,
        posts: [mockPost, { ...mockPost, id: "post_2" }, { ...mockPost, id: "post_3" }],
        tags: [mockTag],
        pagination: mockPagination,
        settings: { colorMode: "auto", displayStyle: "serif", accentColor: "#D8F75A" },
      });

      expect(html).toContain("mr-byline-comments");
      expect(html).toContain("42");
    });

    it("renders Arabic RTL Morrowe Magazine post cleanly", async () => {
      const engine = createLiquidThemeEngine({
        themeId: "morrowe-magazine",
        themeVersion: "1.1.0",
        files: morroweFiles,
      });

      const html = await engine.renderFile("templates/post.liquid", {
        site: mockSiteAr,
        post: mockPost,
        locale: "ar",
        settings: { colorMode: "auto", displayStyle: "serif", accentColor: "#D8F75A" },
      });

      expect(html).toContain('dir="rtl"');
      expect(html).toContain("النقاش والتعليقات");
      expect(html).toContain('id="vb-comments-root"');
    });
  });

  describe("4. ZIP Archives Verification", () => {
    it("validates that Starter Theme ZIP extracts cleanly and contains comments template", async () => {
      const starterZip = path.resolve(__dirname, "../../../../content/vibress-theme-starter.zip");
      expect(fs.existsSync(starterZip)).toBe(true);

      const buffer = fs.readFileSync(starterZip);
      const res = await validateAndExtractThemeZip(buffer);
      expect(res.manifest.id).toBe("vibress-starter-theme");
      const postLiquid = res.files.get("templates/post.liquid")?.toString("utf-8");
      expect(postLiquid).toContain("{% comments %}");
      expect(postLiquid).toContain("comment_count");
    });

    it("validates that Morrowe Magazine ZIP extracts cleanly and contains comments template", async () => {
      const morroweZip = path.resolve(__dirname, "../../../../content/MORROWE_VIBRESS_MAGAZINE_v1.1.0.zip");
      expect(fs.existsSync(morroweZip)).toBe(true);

      const buffer = fs.readFileSync(morroweZip);
      const res = await validateAndExtractThemeZip(buffer);
      expect(res.manifest.id).toBe("morrowe-magazine");
      const postLiquid = res.files.get("templates/post.liquid")?.toString("utf-8");
      expect(postLiquid).toContain("{% comments %}");
      expect(postLiquid).toContain("comment_count");
    });
  });

  describe("5. Site View Model Comments Properties", () => {
    it("maps commentsEnabled, comments_enabled, commentAccess correctly", async () => {
      const { mapSiteToViewModel } = await import("../view-models");
      const mapped = mapSiteToViewModel({
        title: "Test Site",
        comments: { commentAccess: "public" },
      });
      expect(mapped.commentsEnabled).toBe(true);
      expect(mapped.comments_enabled).toBe(true);
      expect(mapped.commentAccess).toBe("public");
      expect(mapped.comment_access).toBe("public");

      const disabled = mapSiteToViewModel({
        title: "Disabled Site",
        comments: { commentAccess: "disabled" },
      });
      expect(disabled.commentsEnabled).toBe(false);
      expect(disabled.comments_enabled).toBe(false);
      expect(disabled.commentAccess).toBe("disabled");
    });
  });
});
