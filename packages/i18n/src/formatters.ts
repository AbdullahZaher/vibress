import { defaultLocaleRegistry } from "./registry";

export interface PluralForms {
  zero?: string | undefined;
  one: string;
  two?: string | undefined;
  few?: string | undefined;
  many?: string | undefined;
  other: string;
}

export function formatDate(
  date: Date | string | number,
  locale = "en",
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!date) return "";
  const d = typeof date === "object" && date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";

  const canonical = defaultLocaleRegistry.canonicalize(locale);
  const def = defaultLocaleRegistry.get(canonical);
  const targetLocale = def?.dateLocale || canonical;

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  };

  try {
    return new Intl.DateTimeFormat(targetLocale, options || defaultOptions).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", options || defaultOptions).format(d);
  }
}

export function formatHijriDate(
  date: Date | string | number,
  locale = "ar-SA",
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!date) return "";
  const d = typeof date === "object" && date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";

  const canonical = defaultLocaleRegistry.canonicalize(locale);
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
  };

  const tag = `${canonical}-u-ca-islamic-umalqura`;
  try {
    return new Intl.DateTimeFormat(tag, options || defaultOptions).format(d);
  } catch {
    try {
      return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", options || defaultOptions).format(d);
    } catch {
      return formatDate(d, locale, options);
    }
  }
}

export function formatNumber(
  value: number,
  locale = "en",
  options?: Intl.NumberFormatOptions,
): string {
  if (typeof value !== "number" || isNaN(value)) return "";
  const canonical = defaultLocaleRegistry.canonicalize(locale);
  const def = defaultLocaleRegistry.get(canonical);
  const targetLocale = def?.numberLocale || canonical;

  try {
    return new Intl.NumberFormat(targetLocale, options).format(value);
  } catch {
    return new Intl.NumberFormat("en-US", options).format(value);
  }
}

export function formatCurrency(
  amount: number,
  currency = "USD",
  locale = "en",
  options?: Omit<Intl.NumberFormatOptions, "style" | "currency">,
): string {
  if (typeof amount !== "number" || isNaN(amount)) return "";
  const canonical = defaultLocaleRegistry.canonicalize(locale);
  const def = defaultLocaleRegistry.get(canonical);
  const targetLocale = def?.numberLocale || canonical;

  const combinedOptions: Intl.NumberFormatOptions = {
    style: "currency",
    currency: currency.toUpperCase(),
    ...options,
  };

  try {
    return new Intl.NumberFormat(targetLocale, combinedOptions).format(amount);
  } catch {
    return new Intl.NumberFormat("en-US", combinedOptions).format(amount);
  }
}

export function formatRelativeTime(
  date: Date | string | number,
  locale = "en",
  baseDate: Date | string = new Date(),
): string {
  if (date === undefined || date === null) return "";

  // Support direct value + unit formatting: e.g. formatRelativeTime(-3, "day", "ar-SA")
  const knownUnits = new Set([
    "second",
    "minute",
    "hour",
    "day",
    "week",
    "month",
    "year",
    "seconds",
    "minutes",
    "hours",
    "days",
    "weeks",
    "months",
    "years",
  ]);
  if (typeof date === "number" && knownUnits.has(locale.toLowerCase())) {
    const unit = locale.toLowerCase().replace(/s$/, "") as Intl.RelativeTimeFormatUnit;
    const targetLocale =
      typeof baseDate === "string"
        ? defaultLocaleRegistry.canonicalize(baseDate)
        : "en";
    try {
      const rtf = new Intl.RelativeTimeFormat(targetLocale, {
        numeric: "auto",
      });
      return rtf.format(date, unit);
    } catch {
      return `${date} ${unit}`;
    }
  }

  const d =
    typeof date === "object" && date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";

  const canonical = defaultLocaleRegistry.canonicalize(locale);
  const now =
    typeof baseDate === "object" && baseDate instanceof Date
      ? baseDate
      : new Date();
  const diffInSeconds = Math.round((d.getTime() - now.getTime()) / 1000);

  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(canonical, { numeric: "auto" });
  } catch {
    rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  }

  const absDiff = Math.abs(diffInSeconds);

  if (absDiff < 60) {
    return rtf.format(diffInSeconds, "second");
  }
  const diffInMinutes = Math.round(diffInSeconds / 60);
  if (Math.abs(diffInMinutes) < 60) {
    return rtf.format(diffInMinutes, "minute");
  }
  const diffInHours = Math.round(diffInMinutes / 60);
  if (Math.abs(diffInHours) < 24) {
    return rtf.format(diffInHours, "hour");
  }
  const diffInDays = Math.round(diffInHours / 24);
  if (Math.abs(diffInDays) < 30) {
    return rtf.format(diffInDays, "day");
  }
  const diffInMonths = Math.round(diffInDays / 30);
  if (Math.abs(diffInMonths) < 12) {
    return rtf.format(diffInMonths, "month");
  }
  const diffInYears = Math.round(diffInDays / 365);
  return rtf.format(diffInYears, "year");
}

export function formatList(
  items: string[],
  locale = "en",
  options?: Intl.ListFormatOptions,
): string {
  if (!items || items.length === 0) return "";
  const canonical = defaultLocaleRegistry.canonicalize(locale);

  try {
    if (typeof Intl.ListFormat !== "undefined") {
      return new Intl.ListFormat(canonical, options || { style: "long", type: "conjunction" }).format(items);
    }
  } catch {
    // Fallback
  }
  return items.join(", ");
}

export function formatPlural(
  count: number,
  forms: PluralForms,
  locale = "en",
): string {
  const canonical = defaultLocaleRegistry.canonicalize(locale);
  let rule: Intl.LDMLPluralRule;

  try {
    const pr = new Intl.PluralRules(canonical);
    rule = pr.select(count);
  } catch {
    rule = count === 1 ? "one" : "other";
  }

  let template = forms.other;
  if (rule === "zero" && forms.zero !== undefined) {
    template = forms.zero;
  } else if (rule === "one" && forms.one !== undefined) {
    template = forms.one;
  } else if (rule === "two" && forms.two !== undefined) {
    template = forms.two;
  } else if (rule === "few" && forms.few !== undefined) {
    template = forms.few;
  } else if (rule === "many" && forms.many !== undefined) {
    template = forms.many;
  }

  return template
    .replace(/\{\{\s*count\s*\}\}/g, String(count))
    .replace(/\{count\}/g, String(count));
}
