export type TranslationDictionary = Record<string, Record<string, string>>;

export interface TranslatorOptions {
  locale?: string;
  fallbackLocale?: string;
  dictionary?: TranslationDictionary;
}

export class Translator {
  private locale: string;
  private fallbackLocale: string;
  private dictionary: TranslationDictionary;

  constructor(options: TranslatorOptions = {}) {
    this.locale = options.locale || options.fallbackLocale || "en";
    this.fallbackLocale = options.fallbackLocale || "en";
    this.dictionary = options.dictionary || {};
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
