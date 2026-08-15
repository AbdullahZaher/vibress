import { arDictionary } from "./dictionaries/ar";
import { enDictionary } from "./dictionaries/en";

export type TranslationDictionary = Record<string, Record<string, string>>;

export interface TranslatorOptions {
  locale?: string | undefined;
  fallbackLocale?: string | undefined;
  dictionary?: TranslationDictionary | undefined;
}

export const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);

export function isRtl(locale: string): boolean {
  if (!locale) return false;
  const lang = locale.split("-")[0]?.toLowerCase() || "";
  return RTL_LOCALES.has(lang);
}

export function getDirection(locale: string): "rtl" | "ltr" {
  return isRtl(locale) ? "rtl" : "ltr";
}

export class Translator {
  private locale: string;
  private fallbackLocale: string;
  private dictionary: TranslationDictionary;

  constructor(options: TranslatorOptions = {}) {
    this.locale = options.locale || options.fallbackLocale || "en";
    this.fallbackLocale = options.fallbackLocale || "en";
    this.dictionary = options.dictionary || {
      ar: arDictionary,
      en: enDictionary,
    };
  }

  setDictionary(dictionary: TranslationDictionary): void {
    this.dictionary = dictionary;
  }

  setLocale(locale: string): void {
    this.locale = locale;
  }

  getLocale(): string {
    return this.locale;
  }

  isRtl(): boolean {
    return isRtl(this.locale);
  }

  getDirection(): "rtl" | "ltr" {
    return getDirection(this.locale);
  }

  translate(
    key: string,
    params?: Record<string, string | number>,
    locale: string = this.locale,
  ): string {
    const localeDict =
      this.dictionary[locale] || this.dictionary[this.fallbackLocale] || {};
    let template = localeDict[key] || key;

    if (params) {
      for (const [pKey, pVal] of Object.entries(params)) {
        const strVal = String(pVal);
        template = template
          .replace(new RegExp(`\\{\\{\\s*${pKey}\\s*\\}\\}`, "g"), strVal)
          .replace(new RegExp(`\\{${pKey}\\}`, "g"), strVal);
      }
    }

    return template;
  }

  t(
    key: string,
    params?: Record<string, string | number>,
    locale?: string,
  ): string {
    return this.translate(key, params, locale);
  }
}

export function createTranslator(options?: TranslatorOptions): Translator {
  return new Translator(options);
}

export function formatDate(
  date: Date | string | number,
  locale = "en",
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === "object" ? date : new Date(date);
  return new Intl.DateTimeFormat(locale, options || {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatHijriDate(
  date: Date | string | number,
  locale = "ar-SA",
): string {
  const d = typeof date === "object" ? date : new Date(date);
  return new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura`, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

export { arDictionary, enDictionary };
