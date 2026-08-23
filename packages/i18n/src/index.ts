import { arDictionary } from "./dictionaries/ar";
import { enDictionary } from "./dictionaries/en";
import {
  defaultLocaleRegistry,
  getDirection,
  isRtl,
  getFallbackChain,
  canonicalizeLocale,
  getLanguage,
  getRegion,
  getScript,
  isValidLocale,
  getLocaleDefinition,
  getLocalePrefix,
  LocaleRegistry,
  type LocaleDefinition,
  type Direction,
} from "./registry";
import {
  formatDate,
  formatHijriDate,
  formatNumber,
  formatCurrency,
  formatRelativeTime,
  formatList,
  formatPlural,
  type PluralForms,
} from "./formatters";
import { normalizeArabicText, isArabicText } from "./text-normalizer";
import {
  validateTranslationGovernance,
  extractInterpolationVariables,
  flattenDictionary,
  type GovernanceIssue,
  type GovernanceResult,
} from "./translation-governance";
import {
  generateTranslationCoverageReport,
  formatCoverageReportAsMarkdown,
  type LocaleCoverageSummary,
  type FullCoverageReport,
} from "./coverage-reporter";

export type TranslationDictionary = Record<string, Record<string, string>>;

export interface TranslatorOptions {
  locale?: string | undefined;
  fallbackLocale?: string | undefined;
  dictionary?: TranslationDictionary | undefined;
  registry?: LocaleRegistry | undefined;
}

export const RTL_LOCALES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi"]);

export class Translator {
  private locale: string;
  private fallbackLocale: string;
  private dictionary: TranslationDictionary;
  private registry: LocaleRegistry;

  constructor(options: TranslatorOptions | string = {}) {
    const opts: TranslatorOptions =
      typeof options === "string" ? { locale: options } : options;
    this.registry = opts.registry || defaultLocaleRegistry;
    const initialLocale = opts.locale || opts.fallbackLocale || "en";
    this.locale = this.registry.canonicalize(initialLocale);
    this.fallbackLocale = this.registry.canonicalize(
      opts.fallbackLocale || "en",
    );
    this.dictionary = opts.dictionary || {
      ar: arDictionary,
      "ar-SA": arDictionary,
      en: enDictionary,
      "en-US": enDictionary,
    };
  }

  setDictionary(dictionary: TranslationDictionary): void {
    this.dictionary = dictionary;
  }

  mergeDictionary(locale: string, translations: Record<string, string>): void {
    const cLocale = this.registry.canonicalize(locale);
    this.dictionary[cLocale] = {
      ...(this.dictionary[cLocale] || {}),
      ...translations,
    };
    const lang = this.registry.getLanguage(cLocale);
    if (lang && lang !== cLocale && !this.dictionary[lang]) {
      this.dictionary[lang] = this.dictionary[cLocale];
    }
  }

  setLocale(locale: string): void {
    this.locale = this.registry.canonicalize(locale);
  }

  getLocale(): string {
    return this.locale;
  }

  getFallbackLocale(): string {
    return this.fallbackLocale;
  }

  isRtl(): boolean {
    return this.registry.isRtl(this.locale);
  }

  getDirection(): Direction {
    return this.registry.getDirection(this.locale);
  }

  translate(
    key: string,
    params?: Record<string, string | number>,
    requestedLocale?: string,
  ): string {
    const target = requestedLocale
      ? this.registry.canonicalize(requestedLocale)
      : this.locale;

    const fallbackChain = this.registry.getFallbackChain(target, [this.fallbackLocale, "en"]);

    let template: string | undefined = undefined;
    for (const loc of fallbackChain) {
      const dict = this.dictionary[loc];
      if (dict && dict[key] !== undefined) {
        template = dict[key];
        break;
      }
    }

    if (template === undefined) {
      template = key;
    }

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

  plural(
    count: number,
    forms: PluralForms,
    locale?: string,
  ): string {
    return formatPlural(count, forms, locale || this.locale);
  }

  formatDate(
    date: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
    locale?: string,
  ): string {
    return formatDate(date, locale || this.locale, options);
  }

  formatNumber(
    value: number,
    options?: Intl.NumberFormatOptions,
    locale?: string,
  ): string {
    return formatNumber(value, locale || this.locale, options);
  }

  formatCurrency(
    amount: number,
    currency = "USD",
    options?: Omit<Intl.NumberFormatOptions, "style" | "currency">,
    locale?: string,
  ): string {
    return formatCurrency(amount, currency, locale || this.locale, options);
  }

  formatRelativeTime(
    date: Date | string | number,
    baseDate?: Date,
    locale?: string,
  ): string {
    return formatRelativeTime(date, locale || this.locale, baseDate);
  }
}

export function createTranslator(options?: TranslatorOptions): Translator {
  return new Translator(options);
}

export {
  // Registry & Helpers
  defaultLocaleRegistry,
  LocaleRegistry,
  canonicalizeLocale,
  getLanguage,
  getRegion,
  getScript,
  getDirection,
  isRtl,
  getFallbackChain,
  isValidLocale,
  getLocaleDefinition,
  getLocalePrefix,
  type LocaleDefinition,
  type Direction,

  // Formatters
  formatDate,
  formatHijriDate,
  formatNumber,
  formatCurrency,
  formatRelativeTime,
  formatList,
  formatPlural,
  type PluralForms,

  // Text Normalization
  normalizeArabicText,
  isArabicText,

  // Dictionaries
  arDictionary,
  enDictionary,

  // Governance & Coverage
  validateTranslationGovernance,
  extractInterpolationVariables,
  flattenDictionary,
  type GovernanceIssue,
  type GovernanceResult,
  generateTranslationCoverageReport,
  formatCoverageReportAsMarkdown,
  type LocaleCoverageSummary,
  type FullCoverageReport,
};
export * from "./translation-governance";
export * from "./coverage-reporter";
export * from "./translation-types";
export * from "./glossary";
