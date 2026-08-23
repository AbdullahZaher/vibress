import {
  createTranslator,
  Translator,
  arDictionary,
  enDictionary,
  type TranslationDictionary,
} from "@vibress/i18n";

export const webDictionary: TranslationDictionary = {
  en: {
    ...enDictionary,
    "nav.home": "Home",
    "nav.about": "About",
    "nav.signin": "Sign in",
    "nav.subscribe": "Subscribe",
    "search.label": "Search",
    "search.thisSite": "Search this site",
    "menu.toggle": "Toggle menu",
    "modal.close": "Close",
    "modal.nameLabel": "Name",
    "modal.emailLabel": "Email",
    "modal.namePlaceholder": "Jamie Larson",
    "modal.emailPlaceholder": "jamie@example.com",
    "modal.submit": "Sign up",
    "modal.successTitle": "Thank you for subscribing!",
    "modal.successBody": "Check your email inbox to confirm your subscription.",
    "modal.alreadyMember": "Already a member?",
    "subscribe.button": "Subscribe",
    "subscribe.buttonSuccess": "Subscribed!",
    "subscribe.emailLabel": "Email address",
    "home.heroFallback": "Thoughts, stories and ideas.",
    "home.latest": "Latest",
    "home.empty": "No published posts available yet.",
    "home.by": "By",
    "home.newer": "Newer Posts",
    "home.older": "Older Posts",
    "home.pageInfo": "Page {page} of {pages}",
    "home.latestWriting": "Latest Writing",
    "home.emptyShort": "No published posts yet.",
    "home.olderArticles": "Older Articles",
    "home.newerArticles": "Newer Articles",
    "home.tagEmpty": "No published posts under this tag.",
    "home.authorEmpty": "No published posts by this author.",
    "archive.by": "by",
    "archive.previous": "Previous",
    "archive.next": "Next",
    "post.readMore": "Read more",
    "post.readTime": "{minutes} min read",
    "post.share": "Share",
    "post.in": "in",
    "social.twitter": "Twitter",
    "social.facebook": "Facebook",
  },
  ar: {
    ...arDictionary,
    "nav.home": "الرئيسية",
    "nav.about": "عن الموقع",
    "nav.signin": "تسجيل الدخول",
    "nav.subscribe": "اشتراك",
    "search.label": "بحث",
    "search.thisSite": "البحث في هذا الموقع",
    "menu.toggle": "تبديل القائمة",
    "modal.close": "إغلاق",
    "modal.nameLabel": "الاسم",
    "modal.emailLabel": "البريد الإلكتروني",
    "modal.namePlaceholder": "عبدالله محمد",
    "modal.emailPlaceholder": "abdullah@example.com",
    "modal.submit": "اشتراك",
    "modal.successTitle": "شكراً لاشتراكك!",
    "modal.successBody": "يرجى التحقق من بريدك الإلكتروني لتأكيد الاشتراك.",
    "modal.alreadyMember": "هل أنت عضو بالفعل؟",
    "subscribe.button": "اشتراك",
    "subscribe.buttonSuccess": "تم الاشتراك!",
    "subscribe.emailLabel": "عنوان البريد الإلكتروني",
    "home.heroFallback": "أفكار وقصص ورؤى ملهمة.",
    "home.latest": "أحدث المقالات",
    "home.empty": "لا توجد مقالات منشورة بعد.",
    "home.by": "بواسطة",
    "home.newer": "مقالات أحدث",
    "home.older": "مقالات أقدم",
    "home.pageInfo": "صفحة {page} من {pages}",
    "home.latestWriting": "أحدث ما كُتب",
    "home.emptyShort": "لا توجد مقالات منشورة حتى الآن.",
    "home.olderArticles": "مقالات سابقة",
    "home.newerArticles": "مقالات أحدث",
    "home.tagEmpty": "لا توجد منشورات تحت هذا الوسم.",
    "home.authorEmpty": "لا توجد منشورات لهذا الكاتب.",
    "archive.by": "بواسطة",
    "archive.previous": "السابق",
    "archive.next": "التالي",
    "post.readMore": "اقرأ المزيد",
    "post.readTime": "{minutes} دقيقة قراءة",
    "post.share": "مشاركة",
    "post.in": "في",
    "social.twitter": "تويتر",
    "social.facebook": "فيسبوك",
  },
};

webDictionary["ar-SA"] = webDictionary.ar || {};
webDictionary["en-US"] = webDictionary.en || {};

export function createWebTranslator(locale?: string): Translator {
  return createTranslator({
    locale: locale || process.env.SITE_LOCALE || "en",
    fallbackLocale: "en",
    dictionary: webDictionary,
  });
}

const defaultTranslator = createWebTranslator("en");

export function t(
  key: string,
  params?: Record<string, string | number>,
  locale?: string,
): string {
  if (locale) {
    return createWebTranslator(locale).t(key, params);
  }
  return defaultTranslator.t(key, params);
}
