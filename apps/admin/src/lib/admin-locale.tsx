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
  "Filter settings...": "تصفية الإعدادات...",
  "Content Models": "نماذج المحتوى",
  "Publication identity, localization, social metadata, and team permissions.": "هوية الموقع واللغات وبيانات المشاركة وصلاحيات الفريق.",
  "Visual presentation, theme selection, navigation menus, and public announcement banners.": "المظهر واختيار القوالب وقوائم التنقل والإعلانات العامة.",
  "Reader subscriptions, member access levels, Stripe Connect payments, and promotional offers.": "اشتراكات القراء وصلاحيات الأعضاء والمدفوعات والعروض.",
  "Audience acquisition, email newsletter delivery, privacy-first analytics, and member discussions.": "تنمية الجمهور والنشرات البريدية والتحليلات والمناقشات.",
  "Code injection, developer APIs & webhooks, system maintenance, data import/export, and audit logs.": "حقن الأكواد وواجهات المطورين وصيانة النظام واستيراد البيانات وتصديرها وسجلات التدقيق.",
  "Define structured content types, fields, relations and their validation rules.": "تعريف أنواع المحتوى المنظم والحقول والعلاقات وقواعد التحقق.",
  "General Settings": "الإعدادات العامة",
  "Secured": "محمية",
  "General Settings": "الإعدادات العامة",
  "First-run setup": "الإعداد الأولي",
  "Setup key": "مفتاح التثبيت",
  "System readiness": "جاهزية النظام",
  "Welcome to Vibress. This instance has not been installed yet. Enter your setup key to begin, and we'll check that everything is ready.": "مرحبًا بك في Vibress. لم يُثبت النظام بعد. أدخل مفتاح التثبيت للتحقق من جاهزية الخدمات.",
  "Give your site a name and description. You can change these later from Settings.": "أدخل اسم موقعك ووصفه. يمكنك تعديلهما لاحقًا من الإعدادات.",
  "Only English and Arabic currently have primary Admin language support. The publication starts with this language alone.": "تدعم لوحة الإدارة حاليًا الإنجليزية والعربية كلغتين أساسيتين. يبدأ الموقع بهذه اللغة وحدها.",
  "Adding a second language enables Translation tools after setup. Content is never translated automatically.": "إضافة لغة ثانية تفعّل أدوات الترجمة بعد التثبيت. لن يُترجم المحتوى تلقائيًا.",
  "This will be the site owner with full administrative access. You'll sign in with these credentials.": "سيصبح هذا الحساب مالك الموقع، ويتمتع بصلاحيات الإدارة الكاملة. استخدم هذه البيانات للدخول.",
  "Create the owner account": "إنشاء حساب المالك",
  "My Vibress site": "موقعي على Vibress",
  "Short tagline": "وصف مختصر",
  "What is your site about?": "ما موضوع موقعك؟",
  "(optional)": "(اختياري)",
  "Email": "البريد الإلكتروني",
  "Full name": "الاسم الكامل",
  "Confirm password": "تأكيد كلمة المرور",
  "At least 12 characters.": "12 حرفًا على الأقل.",
  "Site name is required.": "اسم الموقع مطلوب.",
  "Site name must be 120 characters or fewer.": "يجب ألا يتجاوز اسم الموقع 120 حرفًا.",
  "Site description must be 500 characters or fewer.": "يجب ألا يتجاوز وصف الموقع 500 حرف.",
  "Tagline must be 200 characters or fewer.": "يجب ألا يتجاوز الشعار النصي 200 حرف.",
  "Full name is required.": "الاسم الكامل مطلوب.",
  "Enter a valid email address.": "أدخل بريدًا إلكترونيًا صالحًا.",
  "Password must be at least 12 characters.": "يجب ألا تقل كلمة المرور عن 12 حرفًا.",
  "Password must be 128 characters or fewer.": "يجب ألا تتجاوز كلمة المرور 128 حرفًا.",
  "Passwords do not match.": "كلمتا المرور غير متطابقتين.",
  "Installation failed. Please try again.": "فشل التثبيت. حاول مرة أخرى.",
  "Enter the setup key provided in your environment configuration.": "أدخل مفتاح التثبيت من إعدادات بيئة التشغيل.",
  "Invalid setup key. Check VIBRESS_SETUP_TOKEN in your environment.": "مفتاح التثبيت غير صحيح. تحقق من VIBRESS_SETUP_TOKEN في بيئة التشغيل.",
  "Could not reach the server. Is the API running?": "تعذّر الاتصال بالخادم. تحقق من تشغيل واجهة API.",

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
