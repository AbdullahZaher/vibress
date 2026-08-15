/**
 * Normalizes Arabic text for high-recall fuzzy and full-text search matching:
 * - Strips Tashkeel (diacritics: Fatha, Damma, Kasra, Sukun, Tanween, Shadda)
 * - Strips Tatweel (Kashida \u0640)
 * - Normalizes Alef forms: [إأآٱ] -> ا
 * - Normalizes Taa Marbuta: ة -> ه
 * - Normalizes Yaa / Alef Maksura: ى -> ي
 */
export function normalizeArabicText(text: string): string {
  if (!text) return "";

  return text
    // Remove diacritics (harakat / tashkeel)
    .replace(/[\u064B-\u065F\u0670]/g, "")
    // Remove tatweel (kashida)
    .replace(/\u0640/g, "")
    // Normalize Alef variants
    .replace(/[إأآٱ]/g, "ا")
    // Normalize Alef Maksura to Yaa
    .replace(/ى/g, "ي")
    // Normalize Taa Marbuta to Haa
    .replace(/ة/g, "ه");
}

export function isArabicText(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}
