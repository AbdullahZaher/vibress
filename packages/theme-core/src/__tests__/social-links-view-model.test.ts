import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { mapSiteToViewModel } from "../view-models";
import { createLiquidThemeEngine } from "../theme-engine";

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

describe("Social Links in View Models & Liquid Theme Engine", () => {
  const base = { title: "Publication", locale: "en" };

  it("keeps old themes compatible with absent social profiles", () => {
    expect(mapSiteToViewModel(base).socialLinks).toEqual([]);
  });

  it("exposes ordered social links to Liquid views and RTL locale", () => {
    const socialLinks = [
      { id: "1", platform: "x", label: "X", url: "https://x.com/example", iconUrl: "/social-icons/x.svg" },
      { id: "2", platform: "github", label: "GitHub", url: "https://github.com/example", iconUrl: "/social-icons/github.svg" },
    ];
    const result = mapSiteToViewModel({ ...base, locale: "ar", socialLinks });
    expect(result.direction).toBe("rtl");
    expect(result.socialLinks).toEqual(socialLinks);
  });

  describe("Starter Theme Footer Social Links", () => {
    const starterDir = path.resolve(__dirname, "../../../../content/theme-starter");
    const starterFiles = loadDirectoryFiles(starterDir);

    it("renders dynamic social links when configured", async () => {
      const engine = createLiquidThemeEngine({
        themeId: "vibress-starter-theme",
        themeVersion: "1.0.0",
        files: starterFiles,
      });

      const mockSite = mapSiteToViewModel({
        title: "Starter Publication",
        locale: "en",
        socialLinks: [
          { id: "1", platform: "x", label: "Follow on X", url: "https://x.com/starter", iconUrl: "/social-icons/x.svg" },
          { id: "2", platform: "youtube", label: "Watch on YouTube", url: "https://youtube.com/@starter", iconUrl: "/social-icons/youtube.svg" },
        ],
      });

      const rendered = await engine.renderFile("partials/footer.liquid", { site: mockSite });
      expect(rendered).toContain('class="theme-social-links"');
      expect(rendered).toContain('aria-label="Social media links"');
      expect(rendered).toContain('href="https://x.com/starter"');
      expect(rendered).toContain('href="https://youtube.com/@starter"');
      expect(rendered).toContain('src="/social-icons/x.svg"');
      expect(rendered).toContain('src="/social-icons/youtube.svg"');
      expect(rendered).toContain('target="_blank"');
      expect(rendered).toContain('rel="noopener noreferrer"');
    });

    it("renders Arabic aria-label for RTL locale", async () => {
      const engine = createLiquidThemeEngine({
        themeId: "vibress-starter-theme",
        themeVersion: "1.0.0",
        files: starterFiles,
      });

      const mockSite = mapSiteToViewModel({
        title: "مدونة فايبرس",
        locale: "ar",
        socialLinks: [
          { id: "1", platform: "github", label: "GitHub", url: "https://github.com/vibress", iconUrl: "/social-icons/github.svg" },
        ],
      });

      const rendered = await engine.renderFile("partials/footer.liquid", { site: mockSite });
      expect(rendered).toContain('aria-label="روابط التواصل الاجتماعي"');
    });

    it("hides social links section completely when no links are configured", async () => {
      const engine = createLiquidThemeEngine({
        themeId: "vibress-starter-theme",
        themeVersion: "1.0.0",
        files: starterFiles,
      });

      const mockSite = mapSiteToViewModel({
        title: "Clean Publication",
        locale: "en",
        socialLinks: [],
      });

      const rendered = await engine.renderFile("partials/footer.liquid", { site: mockSite });
      expect(rendered).not.toContain("theme-social-links");
      expect(rendered).not.toContain("facebook.com");
      expect(rendered).not.toContain("twitter.com");
    });
  });

  describe("Morrowe Magazine Theme Footer Social Links", () => {
    const morroweDir = path.resolve(__dirname, "../../../../content/morrowe-magazine");
    const morroweFiles = loadDirectoryFiles(morroweDir);

    it("renders dynamic social links in brand section", async () => {
      const engine = createLiquidThemeEngine({
        themeId: "morrowe-magazine",
        themeVersion: "1.1.0",
        files: morroweFiles,
      });

      const mockSite = mapSiteToViewModel({
        title: "Morrowe Magazine",
        locale: "en",
        socialLinks: [
          { id: "1", platform: "instagram", label: "Instagram", url: "https://instagram.com/morrowe", iconUrl: "/social-icons/instagram.svg" },
          { id: "2", platform: "linkedin", label: "LinkedIn", url: "https://linkedin.com/company/morrowe", iconUrl: "/social-icons/linkedin.svg" },
        ],
      });

      const rendered = await engine.renderFile("partials/footer.liquid", { site: mockSite });
      expect(rendered).toContain('class="mr-footer-social-links"');
      expect(rendered).toContain('aria-label="Social media links"');
      expect(rendered).toContain('href="https://instagram.com/morrowe"');
      expect(rendered).toContain('href="https://linkedin.com/company/morrowe"');
      expect(rendered).toContain('src="/social-icons/instagram.svg"');
      expect(rendered).toContain('src="/social-icons/linkedin.svg"');
    });

    it("hides social links section when empty", async () => {
      const engine = createLiquidThemeEngine({
        themeId: "morrowe-magazine",
        themeVersion: "1.1.0",
        files: morroweFiles,
      });

      const mockSite = mapSiteToViewModel({
        title: "Morrowe Magazine",
        locale: "en",
        socialLinks: [],
      });

      const rendered = await engine.renderFile("partials/footer.liquid", { site: mockSite });
      expect(rendered).not.toContain("mr-footer-social-links");
      expect(rendered).not.toContain("facebook.com");
      expect(rendered).not.toContain("twitter.com");
    });
  });

  describe("Vibress Links Theme Header & Footer Social Links", () => {
    const linksDir = path.resolve(__dirname, "../../../../content/themes/vibress-links/1.0.0");
    const linksFiles = loadDirectoryFiles(linksDir);

    it("renders dynamic social strip in profile header before links if theme exists", async () => {
      if (linksFiles.size === 0) {
        return;
      }
      const engine = createLiquidThemeEngine({
        themeId: "vibress-links",
        themeVersion: "1.0.0",
        files: linksFiles,
      });

      const mockSite = mapSiteToViewModel({
        title: "My Profile",
        locale: "en",
        socialLinks: [
          { id: "1", platform: "instagram", label: "Instagram", url: "https://instagram.com/vibress", iconUrl: "/social-icons/instagram.svg" },
          { id: "2", platform: "x", label: "X", url: "https://x.com/vibress", iconUrl: "/social-icons/x.svg" },
        ],
      });

      const headerRendered = await engine.renderFile("partials/profile-header.liquid", { site: mockSite, settings: { showSocialLinks: true } });
      expect(headerRendered).toContain('class="social-links-strip"');
      expect(headerRendered).toContain('aria-label="Social profiles"');
      expect(headerRendered).toContain('href="https://instagram.com/vibress"');
      expect(headerRendered).toContain('href="https://x.com/vibress"');
      expect(headerRendered).toContain('src="/social-icons/instagram.svg"');
      expect(headerRendered).toContain('src="/social-icons/x.svg"');

      // Test home.liquid structure: header social links occur before primary-links-section
      const homeRendered = await engine.renderFile("templates/home.liquid", { site: mockSite, settings: { showSocialLinks: true } });
      const socialIndex = homeRendered.indexOf('class="social-links-strip"');
      const primaryLinksIndex = homeRendered.indexOf('class="primary-links-section"');
      expect(socialIndex).toBeGreaterThan(-1);
      expect(primaryLinksIndex).toBeGreaterThan(-1);
      expect(socialIndex).toBeLessThan(primaryLinksIndex);
    });

    it("renders Arabic RTL label in profile header when locale is ar", async () => {
      if (linksFiles.size === 0) {
        return;
      }
      const engine = createLiquidThemeEngine({
        themeId: "vibress-links",
        themeVersion: "1.0.0",
        files: linksFiles,
      });

      const mockSite = mapSiteToViewModel({
        title: "الملف الشخصي",
        locale: "ar",
        socialLinks: [
          { id: "1", platform: "x", label: "إكس", url: "https://x.com/vibress", iconUrl: "/social-icons/x.svg" },
        ],
      });

      const headerRendered = await engine.renderFile("partials/profile-header.liquid", { site: mockSite, settings: {} });
      expect(headerRendered).toContain('aria-label="روابط التواصل الاجتماعي"');
    });

    it("does not render social links strip in footer (shows only in header)", async () => {
      if (linksFiles.size === 0) {
        return;
      }
      const engine = createLiquidThemeEngine({
        themeId: "vibress-links",
        themeVersion: "1.0.0",
        files: linksFiles,
      });

      const mockSite = mapSiteToViewModel({
        title: "My Profile",
        locale: "en",
        socialLinks: [
          { id: "1", platform: "threads", label: "Threads", url: "https://threads.net/@vibress", iconUrl: "/social-icons/threads.svg" },
          { id: "2", platform: "bluesky", label: "Bluesky", url: "https://bsky.app/profile/vibress.bsky.social", iconUrl: "/social-icons/bluesky.svg" },
        ],
      });

      const rendered = await engine.renderFile("partials/footer.liquid", { site: mockSite, settings: {} });
      expect(rendered).not.toContain("footer-social-links-strip");
      expect(rendered).not.toContain("social-links-strip");
    });

    it("hides social links strip when empty or disabled", async () => {
      if (linksFiles.size === 0) {
        return;
      }
      const engine = createLiquidThemeEngine({
        themeId: "vibress-links",
        themeVersion: "1.0.0",
        files: linksFiles,
      });

      const mockSite = mapSiteToViewModel({
        title: "My Profile",
        locale: "en",
        socialLinks: [],
      });

      const headerRendered = await engine.renderFile("partials/profile-header.liquid", { site: mockSite, settings: {} });
      expect(headerRendered).not.toContain("social-links-strip");

      const footerRendered = await engine.renderFile("partials/footer.liquid", { site: mockSite, settings: {} });
      expect(footerRendered).not.toContain("footer-social-links-strip");
      expect(footerRendered).not.toContain("facebook.com");
      expect(footerRendered).not.toContain("twitter.com");

      // Test showSocialLinks: false
      const mockSiteWithLinks = mapSiteToViewModel({
        title: "My Profile",
        locale: "en",
        socialLinks: [
          { id: "1", platform: "x", label: "X", url: "https://x.com/vibress", iconUrl: "/social-icons/x.svg" },
        ],
      });
      const disabledHeader = await engine.renderFile("partials/profile-header.liquid", { site: mockSiteWithLinks, settings: { showSocialLinks: false } });
      expect(disabledHeader).not.toContain("social-links-strip");
    });

    it("renders site.tagline inside status badge and site.description in bio without duplication", async () => {
      if (linksFiles.size === 0) {
        return;
      }
      const engine = createLiquidThemeEngine({
        themeId: "vibress-links",
        themeVersion: "1.0.0",
        files: linksFiles,
      });

      const mockSite = mapSiteToViewModel({
        title: "Vibress Creator",
        tagline: "Available for collaborations",
        description: "Publishing Platform.",
        locale: "en",
        socialLinks: [],
      });

      const headerRendered = await engine.renderFile("partials/profile-header.liquid", {
        site: mockSite,
        settings: { showStatusBadge: true, showBio: true },
      });

      // Status badge renders site.tagline
      expect(headerRendered).toContain('class="profile-status-badge"');
      expect(headerRendered).toContain('class="status-badge-text">Available for collaborations</span>');

      // Bio renders site.description
      expect(headerRendered).toContain('class="profile-bio">Publishing Platform.</p>');

      // profile-tagline is NOT rendered redundantly when status badge is active
      expect(headerRendered).not.toContain('class="profile-tagline"');
    });
  });
});
