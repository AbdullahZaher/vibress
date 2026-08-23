import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatHijriDate,
  formatNumber,
  formatCurrency,
  formatRelativeTime,
  formatList,
  formatPlural,
} from "../index";

describe("i18n Formatters", () => {
  it("formats dates in multiple locales", () => {
    const fixed = new Date("2026-08-22T10:00:00.000Z");
    const en = formatDate(fixed, "en");
    expect(en).toContain("2026");

    const ar = formatDate(fixed, "ar-SA");
    expect(ar.length).toBeGreaterThan(0);

    const fr = formatDate(fixed, "fr-FR");
    expect(fr).toContain("2026");
  });

  it("formats Hijri dates with Umm al-Qura calendar", () => {
    const fixed = new Date("2026-08-22T10:00:00.000Z");
    const hijri = formatHijriDate(fixed, "ar-SA");
    expect(hijri.length).toBeGreaterThan(0);
    expect(typeof hijri).toBe("string");
  });

  it("formats numbers and currencies correctly", () => {
    const num = 1234567.89;
    const enNum = formatNumber(num, "en-US");
    expect(enNum).toBe("1,234,567.89");

    const usd = formatCurrency(50, "USD", "en-US");
    expect(usd).toContain("$50");

    const sar = formatCurrency(100, "SAR", "ar-SA");
    expect(sar.length).toBeGreaterThan(0);
  });

  it("formats relative times", () => {
    const now = new Date("2026-08-22T12:00:00.000Z");
    const fiveMinAgo = new Date("2026-08-22T11:55:00.000Z");

    const relEn = formatRelativeTime(fiveMinAgo, "en", now);
    expect(relEn).toBe("5 minutes ago");

    const relAr = formatRelativeTime(fiveMinAgo, "ar", now);
    expect(relAr.length).toBeGreaterThan(0);
  });

  it("formats lists localized with conjunctions", () => {
    const items = ["Apple", "Banana", "Orange"];
    const enList = formatList(items, "en");
    expect(enList).toContain("Apple, Banana, and Orange");
  });

  it("formats plurals with Arabic 6-form plural rules and English 2-form rules", () => {
    const englishForms = {
      one: "1 post",
      other: "{count} posts",
    };

    expect(formatPlural(1, englishForms, "en")).toBe("1 post");
    expect(formatPlural(5, englishForms, "en")).toBe("5 posts");

    const arabicForms = {
      zero: "لا توجد مقالات",
      one: "مقال واحد",
      two: "مقالان",
      few: "{count} مقالات",
      many: "{count} مقالاً",
      other: "{count} مقال",
    };

    expect(formatPlural(0, arabicForms, "ar")).toBe("لا توجد مقالات");
    expect(formatPlural(1, arabicForms, "ar")).toBe("مقال واحد");
    expect(formatPlural(2, arabicForms, "ar")).toBe("مقالان");
    expect(formatPlural(3, arabicForms, "ar")).toBe("3 مقالات");
    expect(formatPlural(15, arabicForms, "ar")).toBe("15 مقالاً");
    expect(formatPlural(100, arabicForms, "ar")).toBe("100 مقال");
  });
});
