export type Direction = "ltr" | "rtl";

export interface LocaleDefinition {
  code: string;
  language: string;
  region?: string | undefined;
  nativeName: string;
  englishName: string;
  direction: Direction;
  script: string;
  fallback: string[];
  dateLocale: string;
  numberLocale: string;
  calendar?: string | undefined;
}

const BUILT_IN_LOCALES: Record<string, LocaleDefinition> = {
  en: {
    code: "en",
    language: "en",
    nativeName: "English",
    englishName: "English",
    direction: "ltr",
    script: "Latn",
    fallback: ["en"],
    dateLocale: "en-US",
    numberLocale: "en-US",
  },
  "en-US": {
    code: "en-US",
    language: "en",
    region: "US",
    nativeName: "English (US)",
    englishName: "English (United States)",
    direction: "ltr",
    script: "Latn",
    fallback: ["en"],
    dateLocale: "en-US",
    numberLocale: "en-US",
  },
  "en-GB": {
    code: "en-GB",
    language: "en",
    region: "GB",
    nativeName: "English (UK)",
    englishName: "English (United Kingdom)",
    direction: "ltr",
    script: "Latn",
    fallback: ["en-US", "en"],
    dateLocale: "en-GB",
    numberLocale: "en-GB",
  },
  ar: {
    code: "ar",
    language: "ar",
    nativeName: "العربية",
    englishName: "Arabic",
    direction: "rtl",
    script: "Arab",
    fallback: ["en"],
    dateLocale: "ar",
    numberLocale: "ar",
  },
  "ar-SA": {
    code: "ar-SA",
    language: "ar",
    region: "SA",
    nativeName: "العربية (السعودية)",
    englishName: "Arabic (Saudi Arabia)",
    direction: "rtl",
    script: "Arab",
    fallback: ["ar", "en"],
    dateLocale: "ar-SA",
    numberLocale: "ar-SA",
    calendar: "islamic-umalqura",
  },
  "ar-EG": {
    code: "ar-EG",
    language: "ar",
    region: "EG",
    nativeName: "العربية (مصر)",
    englishName: "Arabic (Egypt)",
    direction: "rtl",
    script: "Arab",
    fallback: ["ar", "en"],
    dateLocale: "ar-EG",
    numberLocale: "ar-EG",
  },
  "fr-FR": {
    code: "fr-FR",
    language: "fr",
    region: "FR",
    nativeName: "Français",
    englishName: "French (France)",
    direction: "ltr",
    script: "Latn",
    fallback: ["fr", "en"],
    dateLocale: "fr-FR",
    numberLocale: "fr-FR",
  },
  "de-DE": {
    code: "de-DE",
    language: "de",
    region: "DE",
    nativeName: "Deutsch",
    englishName: "German (Germany)",
    direction: "ltr",
    script: "Latn",
    fallback: ["de", "en"],
    dateLocale: "de-DE",
    numberLocale: "de-DE",
  },
  "tr-TR": {
    code: "tr-TR",
    language: "tr",
    region: "TR",
    nativeName: "Türkçe",
    englishName: "Turkish (Turkey)",
    direction: "ltr",
    script: "Latn",
    fallback: ["tr", "en"],
    dateLocale: "tr-TR",
    numberLocale: "tr-TR",
  },
  "ur-PK": {
    code: "ur-PK",
    language: "ur",
    region: "PK",
    nativeName: "اردو (پاکستان)",
    englishName: "Urdu (Pakistan)",
    direction: "rtl",
    script: "Arab",
    fallback: ["ur", "en"],
    dateLocale: "ur-PK",
    numberLocale: "ur-PK",
  },
  "fa-IR": {
    code: "fa-IR",
    language: "fa",
    region: "IR",
    nativeName: "فارسی (ایران)",
    englishName: "Persian (Iran)",
    direction: "rtl",
    script: "Arab",
    fallback: ["fa", "en"],
    dateLocale: "fa-IR",
    numberLocale: "fa-IR",
  },
  "he-IL": {
    code: "he-IL",
    language: "he",
    region: "IL",
    nativeName: "עברית (ישראל)",
    englishName: "Hebrew (Israel)",
    direction: "rtl",
    script: "Hebr",
    fallback: ["he", "en"],
    dateLocale: "he-IL",
    numberLocale: "he-IL",
  },
};

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi"]);

export class LocaleRegistry {
  private locales: Map<string, LocaleDefinition>;

  constructor(customLocales: Record<string, LocaleDefinition> = {}) {
    this.locales = new Map(Object.entries({ ...BUILT_IN_LOCALES, ...customLocales }));
  }

  register(definition: LocaleDefinition): void {
    const canonical = this.canonicalize(definition.code);
    this.locales.set(canonical, { ...definition, code: canonical });
  }

  get(code: string): LocaleDefinition | undefined {
    if (!code) return undefined;
    const canonical = this.canonicalize(code);
    return this.locales.get(canonical);
  }

  has(code: string): boolean {
    if (!code) return false;
    return this.locales.has(this.canonicalize(code));
  }

  getAll(): LocaleDefinition[] {
    return Array.from(this.locales.values());
  }

  canonicalize(code: string): string {
    if (!code || typeof code !== "string") return "en";
    const cleaned = code.trim().replace(/_/g, "-");
    const parts = cleaned.split("-");
    if (parts.length === 1) {
      return parts[0]!.toLowerCase();
    }
    if (parts.length === 2) {
      return `${parts[0]!.toLowerCase()}-${parts[1]!.toUpperCase()}`;
    }
    // E.g. zh-Hans-CN
    return parts
      .map((part, index) => {
        if (index === 0) return part.toLowerCase();
        if (index === 1 && part.length === 4) {
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        }
        return part.toUpperCase();
      })
      .join("-");
  }

  getLanguage(code: string): string {
    const canonical = this.canonicalize(code);
    return canonical.split("-")[0] || "en";
  }

  getRegion(code: string): string | undefined {
    const canonical = this.canonicalize(code);
    const parts = canonical.split("-");
    return parts.length > 1 ? parts[parts.length - 1] : undefined;
  }

  getScript(code: string): string {
    const def = this.get(code);
    if (def?.script) return def.script;
    const lang = this.getLanguage(code);
    if (RTL_LANGUAGES.has(lang)) {
      return lang === "he" ? "Hebr" : "Arab";
    }
    return "Latn";
  }

  getDirection(code: string): Direction {
    const def = this.get(code);
    if (def?.direction) return def.direction;
    const lang = this.getLanguage(code);
    return RTL_LANGUAGES.has(lang) ? "rtl" : "ltr";
  }

  isRtl(code: string): boolean {
    return this.getDirection(code) === "rtl";
  }

  getFallbackChain(code: string, customFallback?: string[]): string[] {
    const canonical = this.canonicalize(code);
    const chain: string[] = [canonical];
    const def = this.get(canonical);

    if (def?.fallback) {
      for (const fb of def.fallback) {
        const cFb = this.canonicalize(fb);
        if (!chain.includes(cFb)) chain.push(cFb);
      }
    } else {
      const lang = this.getLanguage(canonical);
      if (lang !== canonical && !chain.includes(lang)) {
        chain.push(lang);
      }
      if (!chain.includes("en")) {
        chain.push("en");
      }
    }

    if (customFallback && customFallback.length > 0) {
      for (const fb of customFallback) {
        const cFb = this.canonicalize(fb);
        if (!chain.includes(cFb)) chain.push(cFb);
      }
    }

    return chain;
  }

  isValidLocale(code: string): boolean {
    if (!code || typeof code !== "string") return false;
    const pattern = /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/i;
    return pattern.test(code.trim());
  }
}

export const defaultLocaleRegistry = new LocaleRegistry();

export function canonicalizeLocale(code: string): string {
  return defaultLocaleRegistry.canonicalize(code);
}

export function getLanguage(code: string): string {
  return defaultLocaleRegistry.getLanguage(code);
}

export function getRegion(code: string): string | undefined {
  return defaultLocaleRegistry.getRegion(code);
}

export function getScript(code: string): string {
  return defaultLocaleRegistry.getScript(code);
}

export function getDirection(code: string): Direction {
  return defaultLocaleRegistry.getDirection(code);
}

export function isRtl(code: string): boolean {
  return defaultLocaleRegistry.isRtl(code);
}

export function getFallbackChain(code: string, customFallback?: string[]): string[] {
  return defaultLocaleRegistry.getFallbackChain(code, customFallback);
}

export function isValidLocale(code: string): boolean {
  return defaultLocaleRegistry.isValidLocale(code);
}

export function getLocaleDefinition(code: string): LocaleDefinition | undefined {
  return defaultLocaleRegistry.get(code);
}

export function getLocalePrefix(code?: string | null, defaultLocale = "en"): string {
  if (!code || typeof code !== "string") return "";
  const canonical = defaultLocaleRegistry.canonicalize(code);
  const canonicalDefault = defaultLocaleRegistry.canonicalize(defaultLocale);
  if (
    canonical === canonicalDefault ||
    canonical.startsWith("en") ||
    canonicalDefault.startsWith("en") && canonical.startsWith("en")
  ) {
    return "";
  }
  const lang = defaultLocaleRegistry.getLanguage(canonical);
  return `/${lang}`;
}
