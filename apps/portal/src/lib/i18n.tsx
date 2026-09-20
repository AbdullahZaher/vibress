import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import {
  createTranslator,
  enDictionary,
  arDictionary,
  getDirection,
  isRtl,
  type Direction,
} from "@vibress/i18n";

interface I18nContextValue {
  locale: string;
  direction: Direction;
  isRtl: boolean;
  setLocale: (locale: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatDate: (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatCurrency: (amount: number, currency?: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "vibress_portal_locale";

function getInitialLocale(): string {
  if (typeof window === "undefined") return "en";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (saved === "en" || saved === "ar" || saved.startsWith("en-") || saved.startsWith("ar-"))) {
      return saved.startsWith("ar") ? "ar" : "en";
    }
    if (navigator.language && navigator.language.toLowerCase().startsWith("ar")) {
      return "ar";
    }
  } catch {
    // localStorage disabled
  }
  return "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<string>(getInitialLocale);

  const translator = useMemo(() => {
    return createTranslator({
      locale,
      fallbackLocale: "en",
      dictionary: {
        en: enDictionary,
        ar: arDictionary,
        "en-US": enDictionary,
        "ar-SA": arDictionary,
      },
    });
  }, [locale]);

  const direction = getDirection(locale);
  const rtl = isRtl(locale);

  const setLocale = (newLocale: string) => {
    const canonical = newLocale.startsWith("ar") ? "ar" : "en";
    setLocaleState(canonical);
    try {
      localStorage.setItem(STORAGE_KEY, canonical);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [locale, direction]);

  const value: I18nContextValue = {
    locale,
    direction,
    isRtl: rtl,
    setLocale,
    t: (key, params) => translator.t(key, params),
    formatDate: (date, opts) => translator.formatDate(date, opts),
    formatNumber: (val, opts) => translator.formatNumber(val, opts),
    formatCurrency: (amount, curr) => translator.formatCurrency(amount, curr),
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within an I18nProvider");
  }
  return ctx;
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useTranslation();

  return (
    <div className={`portal-lang-switcher ${className || ""}`} style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}>
      <button
        type="button"
        id="portal-lang-en"
        onClick={() => setLocale("en")}
        style={{
          background: locale === "en" ? "#2563eb" : "transparent",
          color: locale === "en" ? "#fff" : "inherit",
          border: "1px solid #d1d5db",
          borderRadius: "4px",
          padding: "4px 8px",
          fontSize: "12px",
          cursor: "pointer",
          fontWeight: locale === "en" ? 600 : 400,
        }}
        aria-label={t("portal.english")}
      >
        English
      </button>
      <button
        type="button"
        id="portal-lang-ar"
        onClick={() => setLocale("ar")}
        style={{
          background: locale === "ar" ? "#2563eb" : "transparent",
          color: locale === "ar" ? "#fff" : "inherit",
          border: "1px solid #d1d5db",
          borderRadius: "4px",
          padding: "4px 8px",
          fontSize: "12px",
          cursor: "pointer",
          fontWeight: locale === "ar" ? 600 : 400,
        }}
        aria-label={t("portal.arabic")}
      >
        العربية
      </button>
    </div>
  );
}
