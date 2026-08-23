import { describe, it, expect } from "vitest";
import {
  LocaleRegistry,
  canonicalizeLocale,
  getLanguage,
  getRegion,
  getScript,
  getDirection,
  isRtl,
  getFallbackChain,
  isValidLocale,
  createTranslator,
  normalizeArabicText,
  isArabicText,
} from "../index";

describe("LocaleRegistry & Canonicalization", () => {
  it("canonicalizes various locale formats correctly", () => {
    expect(canonicalizeLocale("AR_sa")).toBe("ar-SA");
    expect(canonicalizeLocale("ar_SA")).toBe("ar-SA");
    expect(canonicalizeLocale("en_us")).toBe("en-US");
    expect(canonicalizeLocale("EN-us")).toBe("en-US");
    expect(canonicalizeLocale("fr_FR")).toBe("fr-FR");
    expect(canonicalizeLocale("de_de")).toBe("de-DE");
    expect(canonicalizeLocale("tr_tr")).toBe("tr-TR");
    expect(canonicalizeLocale("ur_pk")).toBe("ur-PK");
    expect(canonicalizeLocale("fa_ir")).toBe("fa-IR");
    expect(canonicalizeLocale("AR")).toBe("ar");
    expect(canonicalizeLocale("")).toBe("en");
  });

  it("extracts language, region, script and direction accurately", () => {
    expect(getLanguage("ar-SA")).toBe("ar");
    expect(getRegion("ar-SA")).toBe("SA");
    expect(getScript("ar-SA")).toBe("Arab");
    expect(getDirection("ar-SA")).toBe("rtl");
    expect(isRtl("ar-SA")).toBe(true);

    expect(getLanguage("en-US")).toBe("en");
    expect(getRegion("en-US")).toBe("US");
    expect(getScript("en-US")).toBe("Latn");
    expect(getDirection("en-US")).toBe("ltr");
    expect(isRtl("en-US")).toBe(false);

    expect(getDirection("ur-PK")).toBe("rtl");
    expect(getDirection("fa-IR")).toBe("rtl");
    expect(getDirection("he-IL")).toBe("rtl");
    expect(getDirection("fr-FR")).toBe("ltr");
  });

  it("builds fallback chains properly", () => {
    expect(getFallbackChain("ar-SA")).toEqual(["ar-SA", "ar", "en"]);
    expect(getFallbackChain("fr-FR")).toEqual(["fr-FR", "fr", "en"]);
    expect(getFallbackChain("en-US")).toEqual(["en-US", "en"]);
    expect(getFallbackChain("en")).toEqual(["en"]);
  });

  it("validates locale strings correctly", () => {
    expect(isValidLocale("en")).toBe(true);
    expect(isValidLocale("en-US")).toBe(true);
    expect(isValidLocale("ar-SA")).toBe(true);
    expect(isValidLocale("zh-Hans-CN")).toBe(true);
    expect(isValidLocale("")).toBe(false);
    expect(isValidLocale("invalid@@locale")).toBe(false);
  });

  it("allows custom locale definitions and registration", () => {
    const customRegistry = new LocaleRegistry();
    customRegistry.register({
      code: "es-MX",
      language: "es",
      region: "MX",
      nativeName: "Español (México)",
      englishName: "Spanish (Mexico)",
      direction: "ltr",
      script: "Latn",
      fallback: ["es", "en"],
      dateLocale: "es-MX",
      numberLocale: "es-MX",
    });

    expect(customRegistry.has("es-MX")).toBe(true);
    expect(customRegistry.get("es_mx")?.nativeName).toBe("Español (México)");
    expect(customRegistry.getDirection("es-MX")).toBe("ltr");
  });

  it("resolves translations with multi-level fallback chain", () => {
    const t = createTranslator({
      locale: "ar-SA",
      dictionary: {
        en: {
          "common.hello": "Hello",
          "common.only_in_en": "Only English",
        },
        ar: {
          "common.hello": "أهلاً",
          "common.general_ar": "عام عربي",
        },
        "ar-SA": {
          "common.hello": "أهلاً وسهلاً بك",
        },
      },
    });

    expect(t.t("common.hello")).toBe("أهلاً وسهلاً بك"); // Specific ar-SA
    expect(t.t("common.general_ar")).toBe("عام عربي"); // Fallback to ar
    expect(t.t("common.only_in_en")).toBe("Only English"); // Fallback to en
    expect(t.t("common.nonexistent")).toBe("common.nonexistent"); // Key fallback
  });

  it("normalizes Arabic text correctly for search and indexing", () => {
    // Normalizes Alef forms, Taa Marbuta, Alef Maksura, and strips Tashkeel and Tatweel
    expect(normalizeArabicText("الْمَمْلَكَةُ الْعَرَبِيَّةُ السَّعُودِيَّةُ")).toBe("المملكه العربيه السعوديه");
    expect(normalizeArabicText("إِسْتِرَاتِيجِيَّة")).toBe("استراتيجيه");
    expect(normalizeArabicText("مُوسَى")).toBe("موسي");
    expect(normalizeArabicText("تـــجـــربـــة")).toBe("تجربه");
    expect(isArabicText("مرحبا")).toBe(true);
    expect(isArabicText("Hello")).toBe(false);
  });
});

