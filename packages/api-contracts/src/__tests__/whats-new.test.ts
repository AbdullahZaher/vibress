import { describe, it, expect } from "vitest";
import {
  WhatsNewItemSchema,
  WhatsNewFeedSchema,
  isSafeWhatsNewUrl,
} from "../whats-new";

describe("WhatsNew Schema and URL Validation", () => {
  describe("isSafeWhatsNewUrl", () => {
    it("accepts safe relative application paths", () => {
      expect(isSafeWhatsNewUrl("/admin/analytics")).toBe(true);
      expect(isSafeWhatsNewUrl("/admin/posts/new")).toBe(true);
      expect(isSafeWhatsNewUrl("/admin")).toBe(true);
    });

    it("accepts safe HTTPS external URLs", () => {
      expect(isSafeWhatsNewUrl("https://vibress.org/docs")).toBe(true);
      expect(isSafeWhatsNewUrl("https://github.com/vibress")).toBe(true);
    });

    it("rejects dangerous protocols", () => {
      expect(isSafeWhatsNewUrl("javascript:alert(1)")).toBe(false);
      expect(isSafeWhatsNewUrl("JAVASCRIPT:evil()")).toBe(false);
      expect(isSafeWhatsNewUrl("data:text/html,<script>alert(1)</script>")).toBe(
        false,
      );
      expect(isSafeWhatsNewUrl("vbscript:msgbox")).toBe(false);
      expect(isSafeWhatsNewUrl("file:///etc/passwd")).toBe(false);
      expect(isSafeWhatsNewUrl("ftp://example.com")).toBe(false);
    });

    it("rejects protocol-relative and malformed URLs", () => {
      expect(isSafeWhatsNewUrl("//evil.com")).toBe(false);
      expect(isSafeWhatsNewUrl("htt p://invalid")).toBe(false);
    });

    it("accepts null/undefined/empty string as optional", () => {
      expect(isSafeWhatsNewUrl(null)).toBe(true);
      expect(isSafeWhatsNewUrl(undefined)).toBe(true);
      expect(isSafeWhatsNewUrl("")).toBe(true);
    });
  });

  describe("WhatsNewItemSchema", () => {
    it("validates a fully specified valid item", () => {
      const item = {
        id: "analytics-email-sequences",
        title: "Analytics for email sequences",
        description: "Understand how your automated emails are performing.",
        icon: "sparkles",
        url: "/admin/analytics/email-sequences",
        publishedAt: "2026-09-13T00:00:00Z",
        minVersion: "1.0.0",
        maxVersion: "2.0.0",
      };

      const result = WhatsNewItemSchema.safeParse(item);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe("analytics-email-sequences");
        expect(result.data.title).toBe("Analytics for email sequences");
      }
    });

    it("validates an item with minimal required fields", () => {
      const item = {
        id: "simple-feature",
        title: "Simple Feature",
        description: "A brand new feature.",
        publishedAt: "2026-09-13T12:00:00Z",
      };

      const result = WhatsNewItemSchema.safeParse(item);
      expect(result.success).toBe(true);
    });

    it("rejects items missing required fields", () => {
      expect(
        WhatsNewItemSchema.safeParse({
          id: "",
          title: "Title",
          description: "Desc",
          publishedAt: "2026-09-13T00:00:00Z",
        }).success,
      ).toBe(false);

      expect(
        WhatsNewItemSchema.safeParse({
          id: "1",
          title: "",
          description: "Desc",
          publishedAt: "2026-09-13T00:00:00Z",
        }).success,
      ).toBe(false);

      expect(
        WhatsNewItemSchema.safeParse({
          id: "1",
          title: "Title",
          description: "",
          publishedAt: "2026-09-13T00:00:00Z",
        }).success,
      ).toBe(false);
    });

    it("rejects items with invalid publishedAt date", () => {
      const result = WhatsNewItemSchema.safeParse({
        id: "test",
        title: "Test",
        description: "Desc",
        publishedAt: "not-a-date",
      });
      expect(result.success).toBe(false);
    });

    it("rejects items with invalid semver bounds", () => {
      const result = WhatsNewItemSchema.safeParse({
        id: "test",
        title: "Test",
        description: "Desc",
        publishedAt: "2026-09-13T00:00:00Z",
        minVersion: "not.a.version",
      });
      expect(result.success).toBe(false);
    });

    it("rejects items with dangerous URLs", () => {
      const result = WhatsNewItemSchema.safeParse({
        id: "test",
        title: "Test",
        description: "Desc",
        publishedAt: "2026-09-13T00:00:00Z",
        url: "javascript:alert(1)",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("WhatsNewFeedSchema", () => {
    it("validates valid top level feed format", () => {
      const feed = {
        version: 1,
        items: [
          {
            id: "1",
            title: "T",
            description: "D",
            publishedAt: "2026-09-13T00:00:00Z",
          },
        ],
      };
      expect(WhatsNewFeedSchema.safeParse(feed).success).toBe(true);
    });

    it("rejects invalid feed format", () => {
      expect(WhatsNewFeedSchema.safeParse({ version: 0, items: [] }).success).toBe(
        false,
      );
      expect(WhatsNewFeedSchema.safeParse({ version: 1 }).success).toBe(false);
      expect(WhatsNewFeedSchema.safeParse({ version: 1, items: "not-array" }).success).toBe(
        false,
      );
    });
  });
});
