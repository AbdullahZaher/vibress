import { describe, it, expect } from "vitest";
import {
  normalizeArabicText,
  isArabicText,
  sanitizeSearchQuery,
} from "../index";

describe("Search 2.0 & Arabic Text Normalization", () => {
  it("detects Arabic text presence accurately", () => {
    expect(isArabicText("مرحبا بالعالم")).toBe(true);
    expect(isArabicText("Hello World")).toBe(false);
    expect(isArabicText("12345")).toBe(false);
    expect(isArabicText("Article عن الذكاء الاصطناعي")).toBe(true);
  });

  it("strips Arabic diacritics and tashkeel", () => {
    const textWithTashkeel = "مَرْحَبًا بِكُم فِي مَنَصَّةِ ڤايبرس";
    const normalized = normalizeArabicText(textWithTashkeel);
    expect(normalized).toBe("مرحبا بكم في منصه ڤايبرس");
  });

  it("normalizes Alef forms (إ, أ, آ, ٱ -> ا)", () => {
    expect(normalizeArabicText("إدارة")).toBe("اداره");
    expect(normalizeArabicText("أخبار")).toBe("اخبار");
    expect(normalizeArabicText("آراء")).toBe("اراء");
  });

  it("normalizes Taa Marbuta (ة -> ه) and Alef Maksura (ى -> ي)", () => {
    expect(normalizeArabicText("كتابة")).toBe("كتابه");
    expect(normalizeArabicText("على")).toBe("علي");
  });

  it("strips Tatweel (Kashida)", () => {
    expect(normalizeArabicText("مـــقـــال")).toBe("مقال");
  });

  it("sanitizes bounded query inputs and rejects pathological wildcards", () => {
    expect(sanitizeSearchQuery("   البحث السريع   ")).toBe("البحث السريع");
    expect(() => sanitizeSearchQuery("***%%%")).toThrow(/Invalid query/);
  });
});
