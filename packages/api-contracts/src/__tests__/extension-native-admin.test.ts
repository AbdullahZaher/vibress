import { describe, expect, it } from "vitest";
import {
  ExtensionNativeAdminPageV1Schema,
  ExtensionNativeAdminPagesV1Schema,
} from "../extension-native-admin";

const label = { en: "Total courses", ar: "Total courses" };
const page = {
  schemaVersion: 1,
  viewId: "courses",
  title: label,
  components: [
    { type: "stat", id: "course-total", label, field: "total" },
    { type: "field-list", id: "course-fields", fields: [
      { key: "status", label },
      { key: "draftCount", label },
    ] },
  ],
};

describe("NUI-01 inert native Admin descriptors", () => {
  it("accepts bounded read-only metadata without requiring existing v1 callers to change", () => {
    expect(ExtensionNativeAdminPageV1Schema.safeParse(page).success).toBe(true);
    expect(ExtensionNativeAdminPagesV1Schema.safeParse([page]).success).toBe(true);
    expect(ExtensionNativeAdminPagesV1Schema.safeParse([]).success).toBe(true);
  });

  it("rejects executable props, injected links, HTML fields and unknown component kinds", () => {
    expect(ExtensionNativeAdminPageV1Schema.safeParse({
      ...page, onClick: "execute",
    }).success).toBe(false);
    expect(ExtensionNativeAdminPageV1Schema.safeParse({
      ...page, components: [{ ...page.components[0], url: "javascript:alert(1)" }],
    }).success).toBe(false);
    expect(ExtensionNativeAdminPageV1Schema.safeParse({
      ...page, components: [{ type: "iframe", id: "escape", src: "/api/admin/v1/secrets" }],
    }).success).toBe(false);
    expect(ExtensionNativeAdminPageV1Schema.safeParse({
      ...page, components: [{ ...page.components[0], field: "__proto__" }],
    }).success).toBe(false);
    expect(ExtensionNativeAdminPageV1Schema.safeParse({
      ...page, components: [{ ...page.components[0], html: "<img src=x onerror=alert(1)>" }],
    }).success).toBe(false);
  });

  it("fails closed for invalid schema versions, missing translations and duplicate IDs", () => {
    expect(ExtensionNativeAdminPageV1Schema.safeParse({
      ...page, schemaVersion: 2,
    }).success).toBe(false);
    expect(ExtensionNativeAdminPageV1Schema.safeParse({
      ...page, title: { en: "Courses" },
    }).success).toBe(false);
    expect(ExtensionNativeAdminPageV1Schema.safeParse({
      ...page, components: [
        page.components[0], { ...page.components[0], field: "another" },
      ],
    }).success).toBe(false);
    expect(ExtensionNativeAdminPagesV1Schema.safeParse([page, page]).success).toBe(false);
    expect(ExtensionNativeAdminPageV1Schema.safeParse({
      ...page, components: [{ type: "field-list", id: "fields", fields: [
        { key: "total", label }, { key: "total", label },
      ] }],
    }).success).toBe(false);
  });

  it("enforces document and component bounds", () => {
    expect(ExtensionNativeAdminPageV1Schema.safeParse({
      ...page, components: Array.from({ length: 13 }, (_, i) => ({
        type: "stat", id: `stat-${i}`, label, field: "total",
      })),
    }).success).toBe(false);
    expect(ExtensionNativeAdminPageV1Schema.safeParse({
      ...page, title: { en: "x".repeat(101), ar: "Valid" },
    }).success).toBe(false);
    expect(ExtensionNativeAdminPagesV1Schema.safeParse(Array.from(
      { length: 9 }, (_, i) => ({ ...page, viewId: `view-${i}` }),
    )).success).toBe(false);
  });

  it("treats hostile text as data rather than claiming that validation sanitizes content", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const parsed = ExtensionNativeAdminPageV1Schema.safeParse({
      ...page, title: { en: hostile, ar: hostile },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.title.en).toBe(hostile);
    // The future Host React renderer must still render it as escaped text.
  });
});
