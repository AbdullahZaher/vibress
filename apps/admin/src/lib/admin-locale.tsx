import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";

type AdminUiLocale = "en" | "ar";
interface AdminLocaleContext {
  locale: AdminUiLocale;
  setPublicationLanguage: (locale: string) => void;
  refresh: () => Promise<void>;
  tr: (english: string) => string;
}

const translations: Record<string, string> = {
  "Analytics": "التحليلات",
  "View site": "عرض الموقع",
  "Posts": "المقالات",
  "Drafts": "المسودات",
  "Scheduled": "المجدولة",
  "Published": "المنشورة",
  "Pages": "الصفحات",
  "Translations": "الترجمات",
  "Tags": "الوسوم",
  "Media Library": "مكتبة الوسائط",
  "Members": "الأعضاء",
  "Comments": "التعليقات",
  "Settings": "الإعدادات",
  "General settings": "الإعدادات العامة",
  "Site": "الموقع",
  "Membership": "العضوية",
  "Growth": "النمو",
  "Advanced": "المتقدمة",
  "Help": "المساعدة",
  "View Live Site": "عرض الموقع المنشور",
  "Advanced & Platform": "الإعدادات المتقدمة والمنصة",
  "Sign Out": "تسجيل الخروج",
  "Staff": "فريق العمل",
  "Publication Management Console": "لوحة إدارة الموقع",
  "Vibress Admin": "إدارة Vibress",
  "Sign In": "تسجيل الدخول",
  "Enter your email address to access your dashboard.": "أدخل بريدك الإلكتروني للوصول إلى لوحة التحكم.",
  "Email Address": "البريد الإلكتروني",
  "Password": "كلمة المرور",
  "Signing in...": "جارٍ تسجيل الدخول...",
  "Continue": "متابعة",
  "Session Secured": "الجلسة محمية",
  "Failed to login. Check credentials.": "تعذّر تسجيل الدخول. تحقق من بيانات الدخول.",
  "Toggle navigation menu": "إظهار أو إخفاء قائمة التنقل",
  "Open menu": "فتح القائمة",
  "Search": "بحث",
  "Create new post": "إنشاء مقال جديد",
  "Toggle theme": "تبديل المظهر",
  "New Post": "مقال جديد",
  "Edit Post": "تعديل المقال",
  "New Page": "صفحة جديدة",
  "Edit Page": "تعديل الصفحة",
  "Subscriptions": "الاشتراكات",
  "Newsletters": "النشرات البريدية",
  "Themes": "القوالب",
  "Billing": "الفوترة",
  "Storage": "التخزين",
  "Platform": "المنصة",
  "Operations": "العمليات",
  "Intelligence": "الذكاء والتحليلات",
  "Site timezone & language": "لغة الموقع والمنطقة الزمنية",
  "Close": "إغلاق",
  "Edit": "تعديل",
  "Site Timezone": "المنطقة الزمنية للموقع",
  "Used for post scheduling and date formatting.": "تُستخدم لجدولة المقالات وتنسيق التواريخ.",
  "Welcome": "مرحبًا",
  "Your site": "موقعك",
  "Your account": "حسابك",
  "Ready": "جاهز",
  "About your site": "معلومات موقعك",
  "Site name": "اسم الموقع",
  "Tagline": "الشعار النصي",
  "Description": "الوصف",
  "Default language": "اللغة الأساسية",
  "Primary language": "اللغة الأساسية",
  "Additional content languages": "لغات محتوى إضافية",
  "Back": "رجوع",
  "Install Vibress": "تثبيت Vibress",
  "Setting up Vibress…": "جارٍ إعداد Vibress…",
  "Vibress is ready.": "أصبح Vibress جاهزًا.",
  "Checking…": "جارٍ التحقق…",
  "Check": "تحقق",
  "Loading…": "جارٍ التحميل…",
  "Retry": "إعادة المحاولة",
  "Account menu": "قائمة الحساب",
  "Language": "اللغة",
};

function normalize(locale: string): AdminUiLocale {
  return locale.split("-")[0]?.toLowerCase() === "ar" ? "ar" : "en";
}

const Context = createContext<AdminLocaleContext | null>(null);

export function AdminLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AdminUiLocale>("en");
  const setPublicationLanguage = useCallback((value: string) => {
    setLocale(normalize(value));
  }, []);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/content/v1/site", {
        credentials: "same-origin", cache: "no-store",
      });
      if (!response.ok) return;
      const json: unknown = await response.json();
      if (json && typeof json === "object" && "site" in json &&
          json.site && typeof json.site === "object" &&
          "locale" in json.site && typeof json.site.locale === "string") {
        setLocale(normalize(json.site.locale));
      }
    } catch {
      // Setup or API outage: retain the current displayed language.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUpdate = () => { void refresh(); };
    window.addEventListener("vibress:locales-updated", onUpdate);
    return () => window.removeEventListener("vibress:locales-updated", onUpdate);
  }, [refresh]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const tr = useCallback((english: string) =>
    locale === "ar" ? translations[english] || english : english, [locale]);
  const value = useMemo(() => ({
    locale, setPublicationLanguage, refresh, tr,
  }), [locale, setPublicationLanguage, refresh, tr]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAdminLocale(): AdminLocaleContext {
  const context = useContext(Context);
  if (!context) throw new Error("Admin locale provider is missing");
  return context;
}
