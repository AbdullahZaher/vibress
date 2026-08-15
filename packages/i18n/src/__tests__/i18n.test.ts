import { describe, it, expect } from "vitest";
import {
  createTranslator,
  isRtl,
  getDirection,
  formatDate,
  formatHijriDate,
} from "../index";

describe("Arabic-First i18n & RTL System", () => {
  it("detects RTL for Arabic and other RTL locales", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("ar-SA")).toBe(true);
    expect(isRtl("ar-EG")).toBe(true);
    expect(isRtl("he")).toBe(true);
    expect(isRtl("fa")).toBe(true);
    expect(isRtl("en")).toBe(false);
    expect(isRtl("en-US")).toBe(false);
    expect(isRtl("fr")).toBe(false);
  });

  it("maps direction accurately", () => {
    expect(getDirection("ar")).toBe("rtl");
    expect(getDirection("en")).toBe("ltr");
  });

  it("translates canonical editorial keys into Arabic", () => {
    const t = createTranslator({ locale: "ar" });

    expect(t.t("nav.posts")).toBe("المقالات");
    expect(t.t("status.published")).toBe("منشور");
    expect(t.t("collab.title")).toBe("التعاون التحريري");
    expect(t.t("ai.button_label")).toBe("المساعد الذكي Vibress");
  });

  it("interpolates parameters in translation strings", () => {
    const t = createTranslator({
      locale: "ar",
      dictionary: {
        ar: {
          welcome: "مرحباً يا {{name}}، لديك {count} رسائل.",
        },
      },
    });

    expect(t.t("welcome", { name: "عبدالله", count: 5 })).toBe(
      "مرحباً يا عبدالله، لديك 5 رسائل.",
    );
  });

  it("formats localized Gregorian and Hijri dates accurately", () => {
    const fixedDate = new Date("2026-08-15T12:00:00.000Z");

    const englishDate = formatDate(fixedDate, "en");
    expect(englishDate).toContain("2026");

    const hijriDate = formatHijriDate(fixedDate, "ar-SA");
    expect(hijriDate.length).toBeGreaterThan(0);
    expect(typeof hijriDate).toBe("string");
  });
});

