import { describe, it, expect } from "vitest";
import {
  selectWhatsNewItem,
  sanitizeWhatsNewItems,
  WhatsNewItem,
} from "../whats-new";

describe("WhatsNew Selection & Sanitization", () => {
  const baseItem: WhatsNewItem = {
    id: "item-1",
    title: "Item 1",
    description: "Description 1",
    publishedAt: "2026-09-01T00:00:00Z",
  };

  describe("sanitizeWhatsNewItems", () => {
    it("filters out invalid items and keeps valid items", () => {
      const raw = [
        {
          id: "valid-1",
          title: "Valid 1",
          description: "Desc 1",
          publishedAt: "2026-09-01T00:00:00Z",
        },
        {
          id: "", // Invalid: empty id
          title: "Invalid",
          description: "Desc",
          publishedAt: "2026-09-01T00:00:00Z",
        },
        {
          id: "valid-2",
          title: "Valid 2",
          description: "Desc 2",
          publishedAt: "2026-09-02T00:00:00Z",
        },
      ];

      const sanitized = sanitizeWhatsNewItems(raw);
      expect(sanitized).toHaveLength(2);
      expect(sanitized[0]?.id).toBe("valid-1");
      expect(sanitized[1]?.id).toBe("valid-2");
    });
  });

  describe("selectWhatsNewItem", () => {
    const fixedNow = new Date("2026-09-13T12:00:00Z");

    it("returns single item when only one is provided", () => {
      const selected = selectWhatsNewItem({
        items: [baseItem],
        currentVersion: "1.0.0",
        now: fixedNow,
      });

      expect(selected).toEqual(baseItem);
    });

    it("returns the newest item when multiple eligible items exist", () => {
      const older: WhatsNewItem = {
        id: "older",
        title: "Older",
        description: "Older desc",
        publishedAt: "2026-09-01T00:00:00Z",
      };
      const newer: WhatsNewItem = {
        id: "newer",
        title: "Newer",
        description: "Newer desc",
        publishedAt: "2026-09-10T00:00:00Z",
      };

      const selected = selectWhatsNewItem({
        items: [older, newer],
        currentVersion: "1.0.0",
        now: fixedNow,
      });

      expect(selected?.id).toBe("newer");
    });

    it("uses deterministic id ASC as tie breaker when publishedAt matches", () => {
      const itemB: WhatsNewItem = {
        id: "b-item",
        title: "Item B",
        description: "Desc",
        publishedAt: "2026-09-10T00:00:00Z",
      };
      const itemA: WhatsNewItem = {
        id: "a-item",
        title: "Item A",
        description: "Desc",
        publishedAt: "2026-09-10T00:00:00Z",
      };

      const selected = selectWhatsNewItem({
        items: [itemB, itemA],
        currentVersion: "1.0.0",
        now: fixedNow,
      });

      expect(selected?.id).toBe("a-item");
    });

    it("excludes future-dated items", () => {
      const future: WhatsNewItem = {
        id: "future",
        title: "Future",
        description: "Desc",
        publishedAt: "2026-09-20T00:00:00Z",
      };
      const past: WhatsNewItem = {
        id: "past",
        title: "Past",
        description: "Desc",
        publishedAt: "2026-09-05T00:00:00Z",
      };

      const selected = selectWhatsNewItem({
        items: [future, past],
        currentVersion: "1.0.0",
        now: fixedNow,
      });

      expect(selected?.id).toBe("past");
    });

    it("excludes items with incompatible minVersion", () => {
      const itemRequiresV2: WhatsNewItem = {
        id: "v2-only",
        title: "V2 Feature",
        description: "Desc",
        publishedAt: "2026-09-10T00:00:00Z",
        minVersion: "2.0.0",
      };
      const itemV1: WhatsNewItem = {
        id: "v1-feature",
        title: "V1 Feature",
        description: "Desc",
        publishedAt: "2026-09-01T00:00:00Z",
        minVersion: "1.0.0",
      };

      const selected = selectWhatsNewItem({
        items: [itemRequiresV2, itemV1],
        currentVersion: "1.0.0",
        now: fixedNow,
      });

      expect(selected?.id).toBe("v1-feature");
    });

    it("excludes items with incompatible maxVersion", () => {
      const legacyItem: WhatsNewItem = {
        id: "legacy",
        title: "Legacy Feature",
        description: "Desc",
        publishedAt: "2026-09-10T00:00:00Z",
        maxVersion: "0.9.9",
      };

      const selected = selectWhatsNewItem({
        items: [legacyItem],
        currentVersion: "1.0.0",
        now: fixedNow,
      });

      expect(selected).toBeNull();
    });

    it("excludes dismissed items", () => {
      const item1: WhatsNewItem = {
        id: "item-1",
        title: "Item 1",
        description: "Desc 1",
        publishedAt: "2026-09-10T00:00:00Z",
      };
      const item2: WhatsNewItem = {
        id: "item-2",
        title: "Item 2",
        description: "Desc 2",
        publishedAt: "2026-09-05T00:00:00Z",
      };

      // item-1 is dismissed
      const selected = selectWhatsNewItem({
        items: [item1, item2],
        currentVersion: "1.0.0",
        now: fixedNow,
        dismissedIds: ["item-1"],
      });

      expect(selected?.id).toBe("item-2");
    });

    it("returns null if all items are dismissed or ineligible", () => {
      const selected = selectWhatsNewItem({
        items: [baseItem],
        currentVersion: "1.0.0",
        now: fixedNow,
        dismissedIds: ["item-1"],
      });

      expect(selected).toBeNull();
    });
  });
});
