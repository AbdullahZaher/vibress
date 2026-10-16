import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { getPublicationLocaleContextApi } from "./api/operations";
import { enDictionary, arDictionary } from "@vibress/i18n";

type AdminUiLocale = "en" | "ar";
interface AdminLocaleContext {
  locale: AdminUiLocale;
  setPublicationLanguage: (locale: string) => void;
  refresh: () => Promise<void>;
  tr: (english: string) => string;
}

const translations: Record<string, string> = {
  "Translation Matrix": "مصفوفة الترجمة",
  "Manage multilingual content coverage, editorial review workflows, and localization health.": "إدارة تغطية المحتوى متعدد اللغات والمراجعات التحريرية وصحة التوطين.",
  "Review Queue": "قائمة المراجعة",
  "Manage Locales": "إدارة اللغات",
  "Refresh matrix": "تحديث المصفوفة",
  "Source Content": "المحتوى الأصلي",
  "Posts & Pages published in": "المقالات والصفحات المنشورة بلغة",
  "Overall Coverage": "التغطية الإجمالية",
  "Stale (Outdated)": "ترجمات قديمة",
  "Source modified after translation": "تغير المحتوى الأصلي بعد الترجمة",
  "Awaiting Review": "بانتظار المراجعة",
  "Drafts & AI translations to approve": "مسودات وترجمات آلية بانتظار الموافقة",
  "Search content title or slug...": "ابحث عن عنوان المحتوى أو رابطه...",
  "All Content": "كل المحتوى",
  "All Statuses": "جميع الحالات",
  "Needs Review": "بحاجة إلى مراجعة",
  "Draft / In Progress": "مسودة / قيد التنفيذ",
  "Missing": "غير مترجم",
  "Submit for Review": "إرسال للمراجعة",
  "Clear Selection": "إلغاء التحديد",
  "Loading translation matrix...": "جارٍ تحميل مصفوفة الترجمة...",
  "Content Item": "عنصر المحتوى",
  "Editorial Review Queue": "قائمة المراجعة التحريرية",
  "Prioritized translation tasks: stale published content, review submissions, and missing coverage.": "مهام الترجمة حسب الأولوية: المحتوى القديم وطلبات المراجعة والترجمات الناقصة.",
  "Refresh Queue": "تحديث القائمة",
  "Stale Translations": "الترجمات التي تحتاج تحديثًا",
  "Live published content whose source was modified.": "محتوى منشور تغير أصله بعد الترجمة.",
  "AI translations & submitted drafts awaiting approval.": "الترجمات الآلية والمسودات المقدمة بانتظار الموافقة.",
  "Untranslated": "غير مترجم",
  "Published content without translation in active locales.": "محتوى منشور دون ترجمة إلى اللغات المفعّلة.",
  "Loading review queue...": "جارٍ تحميل قائمة المراجعة...",
  "All caught up!": "لا توجد مهام معلقة!",
  "No items currently require attention in this category.": "لا توجد عناصر تحتاج متابعة في هذا القسم حاليًا.",
  "AI Generated": "أنشئت بالذكاء الاصطناعي",
  "Approve": "موافقة",
  "Matrix": "المصفوفة",
  "Translation Workspace": "مساحة عمل الترجمة",
  "Save Draft": "حفظ المسودة",
  "Publish Translation": "نشر الترجمة",
  "Source content was modified after this translation was created.": "تغير المحتوى الأصلي بعد إنشاء هذه الترجمة.",
  "Modified fields:": "الحقول المعدلة:",
  "AI Translation Assistant": "مساعد الترجمة بالذكاء الاصطناعي",
  "Generates an editorial draft in": "ينشئ مسودة قابلة للمراجعة بلغة",
  "safely in 'Needs Review' status.": "ويضعها في حالة بحاجة إلى مراجعة.",
  "Auto (Failover)": "تلقائي (مع بديل احتياطي)",
  "Translating...": "جارٍ الترجمة...",
  "Translate Draft": "ترجمة المسودة",
  "Translated Title": "العنوان المترجم",
  "Localized Slug": "معرّف الرابط باللغة المختارة",
  "SEO & Meta Configuration": "إعدادات SEO والبيانات الوصفية",
  "Translation saved successfully.": "تم حفظ الترجمة.",
  "Submitted for review successfully.": "أُرسلت الترجمة للمراجعة.",
  "Translation approved.": "تمت الموافقة على الترجمة.",
  "Translation published successfully!": "تم نشر الترجمة بنجاح!",
  "Create New Post": "إنشاء مقال جديد",
  "Write a new blog article or story": "كتابة مقال أو قصة جديدة",
  "Create New Page": "إنشاء صفحة جديدة",
  "Create a standalone static page": "إنشاء صفحة ثابتة مستقلة",
  "Switch to Light Mode": "التبديل إلى الوضع الفاتح",
  "Switch to Dark Mode": "التبديل إلى الوضع الداكن",
  "Toggle interface visual theme": "تبديل مظهر واجهة الإدارة",
  "Open public website in a new tab": "فتح الموقع العام في علامة تبويب جديدة",
  "Analytics Dashboard": "لوحة التحليلات",
  "Overview of visitors, traffic, and growth": "نظرة عامة على الزوار والزيارات والنمو",
  "All Posts": "جميع المقالات",
  "Manage articles, stories, and publications": "إدارة المقالات والقصص والمحتوى المنشور",
  "Draft Posts": "مسودات المقالات",
  "View and edit unpublished drafts": "عرض المسودات غير المنشورة وتعديلها",
  "Scheduled Posts": "المقالات المجدولة",
  "Posts queued for automatic publication": "مقالات معدّة للنشر التلقائي",
  "Published Posts": "المقالات المنشورة",
  "Live posts visible on your website": "المقالات المنشورة على موقعك",
  "Manage static pages (About, Contact, Terms)": "إدارة الصفحات الثابتة كالتعريف والتواصل والشروط",
  "Tags Manager": "إدارة الوسوم",
  "Organize content with tags and categories": "تنظيم المحتوى بالوسوم والتصنيفات",
  "Upload and manage images, video, and audio files": "رفع الصور ومقاطع الفيديو والملفات الصوتية وإدارتها",
  "Members & Subscribers": "الأعضاء والمشتركون",
  "Manage registered members and email subscribers": "إدارة الأعضاء المسجلين ومشتركي البريد الإلكتروني",
  "Community & Comments": "المجتمع والتعليقات",
  "Moderate member discussions and comments": "الإشراف على مناقشات الأعضاء والتعليقات",
  "Site Settings (Themes & Storage)": "إعدادات الموقع (القوالب والتخزين)",
  "Customize themes, design styling, and asset storage": "تخصيص القوالب والمظهر وتخزين الوسائط",
  "Membership Settings (Tiers & Access)": "إعدادات العضوية (المستويات والوصول)",
  "Growth Settings (Newsletters & Analytics)": "إعدادات النمو (النشرات والتحليلات)",
  "Advanced Settings (Platform & Operations)": "الإعدادات المتقدمة (المنصة والعمليات)",
  "End your current admin session securely": "إنهاء جلسة الإدارة الحالية بأمان",
  "Content": "المحتوى",
  "Navigation": "التنقل",
  "Search commands, actions, settings...": "ابحث عن الأوامر والإجراءات والإعدادات...",
  "No matching commands found for": "لم يُعثر على أوامر مطابقة لـ",
  "Navigation:": "التنقل:",
  "Select:": "الاختيار:",
  "Vibress Fast Command Bar": "شريط أوامر Vibress السريعة",
  "Settings / Advanced": "الإعدادات / المتقدمة",
  "Define reusable content structures, fields, relations, and validation rules.": "تعريف هياكل المحتوى القابلة لإعادة الاستخدام والحقول والعلاقات وقواعد التحقق.",
  "Create Model": "إنشاء نموذج",
  "Entries": "الإدخالات",
  "Model": "النموذج",
  "API Slug": "معرّف واجهة API",
  "Fields": "الحقول",
  "Loading models…": "جارٍ تحميل النماذج…",
  "content models": "نماذج محتوى",
  "Search content models": "البحث في نماذج المحتوى",
  "Search models by name or slug": "البحث عن النماذج بالاسم أو معرّف الرابط",
  "Loading content models…": "جارٍ تحميل نماذج المحتوى…",
  "No content models yet": "لا توجد نماذج محتوى بعد",
  "No matching models": "لا توجد نماذج مطابقة",
  "Create your first custom content type to structure editorial entries.": "أنشئ أول نموذج محتوى مخصص لتنظيم المدخلات التحريرية.",
  "Try a different name, slug, or description.": "جرّب اسمًا أو معرّف رابط أو وصفًا مختلفًا.",
  "Delete": "حذف",
  "Back to content models": "العودة إلى نماذج المحتوى",
  "Filter collection entries": "تصفية مدخلات المجموعة",
  "Search entries": "البحث عن الإدخالات",
  "Search collection entries...": "ابحث عن مدخلات المحتوى...",
  "Filter publication status": "تصفية حالة النشر",
  "Sort entries": "ترتيب المدخلات",
  "Collection entries": "مدخلات المحتوى",
  "Collection entries pages": "صفحات مدخلات المحتوى",
  "New Entry": "إدخال جديد",
  "All statuses": "جميع الحالات",
  "Archived": "مؤرشف",
  "Newest created": "الأحدث إنشاءً",
  "Recently updated": "الأحدث تعديلًا",
  "Last Updated": "آخر تعديل",
  "Loading collection entries...": "جارٍ تحميل المدخلات...",
  "No matching entries": "لا توجد مدخلات مطابقة",
  "No Entries Yet": "لا توجد مدخلات بعد",
  "Adjust the search or filters to find other entries.": "غيّر البحث أو التصفية للعثور على مدخلات أخرى.",
  "Create your first entry in this structured content collection.": "أنشئ أول إدخال في مجموعة المحتوى المنظم.",
  "Create Entry": "إنشاء إدخال",
  "Edit Entry": "تعديل الإدخال",
  "Delete Entry": "حذف الإدخال",
  "Previous": "السابق",
  "Next": "التالي",
  "Page": "صفحة",
  "Access Restricted": "الوصول مقيّد",
  "You do not have the required permission": "ليست لديك الصلاحية المطلوبة",
  "to view this section.": "لعرض هذا القسم.",
  "You do not have sufficient permissions to access this administrative area.": "ليست لديك الصلاحيات الكافية للوصول إلى هذا القسم من الإدارة.",
  "Back to Dashboard": "العودة إلى لوحة التحكم",
  "Page Not Found": "الصفحة غير موجودة",
  "The route": "المسار",
  "does not exist in Vibress Admin.": "غير موجود في لوحة إدارة Vibress.",
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

  "Set your publication language code and operational timezone for scheduled posts.": "اضبط لغات الموقع ومنطقته الزمنية لجدولة المقالات.",
  "Unsaved changes": "تغييرات غير محفوظة",
  "field": "حقل",
  "fields": "حقول",
  "Discard": "تجاهل",
  "Saving...": "جارٍ الحفظ...",
  "Save (⌘S)": "حفظ (⌘S)",
  "Settings categories navigation": "التنقل بين أقسام الإعدادات",
  "Title & description": "العنوان والوصف",
  "Metadata & social cards": "بيانات التعريف وبطاقات المشاركة",
  "Make this site private": "جعل الموقع خاصًا",
  "Staff & permissions": "الفريق والصلاحيات",
  "Design & branding": "التصميم والهوية",
  "Navigation menus": "قوائم التنقل",
  "Announcement bar": "شريط الإعلانات",
  "Access & portal registration": "الوصول والتسجيل",
  "Membership tiers & Stripe billing": "مستويات العضوية وفوترة Stripe",
  "Offers & promotions": "العروض والحملات",
  "Email newsletters & delivery": "النشرات البريدية وإرسالها",
  "Analytics & tracking": "التحليلات والتتبع",
  "Comments & moderation": "التعليقات والإشراف",
  "Recommendations & blogroll": "التوصيات وروابط المدونات",
  "Code injection": "إضافة الأكواد",
  "Developer platform & integrations": "منصة المطورين والتكاملات",
  "System health & cache": "حالة النظام والتخزين المؤقت",
  "Import / export content": "استيراد وتصدير المحتوى",
  "Audit & activity log": "سجل التدقيق والأنشطة",
  "Danger zone": "العمليات الحساسة",
  "Unable to load publication posts": "تعذّر تحميل مقالات الموقع",
  "Try again": "إعادة المحاولة",
  "No posts found": "لا توجد مقالات",
  "Title": "العنوان",
  "Status": "الحالة",
  "Author": "الكاتب",
  "Updated": "آخر تحديث",
  "Actions": "الإجراءات",
  "Filter posts by title or slug...": "صفِّ المقالات حسب العنوان أو الرابط...",
  "Manage editorial articles, revisions, and publication schedules.": "إدارة المقالات والمراجعات ومواعيد النشر.",
  "Create Post": "إنشاء مقال",
  "All": "الكل",
  "Try adjusting your search query.": "جرّب تعديل عبارة البحث.",
  "Start creating your first article.": "ابدأ بإنشاء أول مقال.",
  "Unable to load static pages": "تعذّر تحميل الصفحات",
  "No pages found": "لا توجد صفحات",
  "Search pages by title or slug...": "ابحث في الصفحات حسب العنوان أو الرابط...",
  "Static Pages": "الصفحات الثابتة",
  "Manage standalone site pages, legal policies, and landing documents.": "إدارة صفحات الموقع والسياسات وصفحات الهبوط.",
  "Create Page": "إنشاء صفحة",
  "Start creating your first page.": "ابدأ بإنشاء أول صفحة.",
  "Name": "الاسم",
  "Slug": "الرابط المختصر",
  "Tags Management": "إدارة الوسوم",
  "Tag Name": "اسم الوسم",
  "Description (Optional)": "الوصف (اختياري)",
  "Cancel": "إلغاء",
  "Loading tags...": "جارٍ تحميل الوسوم...",
  "e.g. Technology": "مثال: التقنية",
  "Tag summary...": "وصف الوسم...",
  "Member": "عضو",
  "Joined": "تاريخ الانضمام",
  "No members found.": "لا يوجد أعضاء.",
  "Search by email or name...": "ابحث بالبريد الإلكتروني أو الاسم...",
  "Loading members list...": "جارٍ تحميل الأعضاء...",
  "All Members": "جميع الأعضاء",
  "Anonymous Member": "عضو مجهول",
  "Filter assets by filename...": "تصفية الوسائط باسم الملف...",
  "Post Title": "عنوان المقال",
  "Page Title": "عنوان الصفحة",
  "Loading article editor...": "جارٍ تحميل محرر المقال...",
  "Loading page editor...": "جارٍ تحميل محرر الصفحة...",
  "Back to Posts": "العودة للمقالات",
  "Back to Pages": "العودة للصفحات",
  "Draft": "مسودة",
  "active": "نشط",
  "disabled": "معطّل",
  "published": "منشور",
  "draft": "مسودة",
  "scheduled": "مجدول",
  "Language": "اللغة",
};

// Reuse already certified shared dictionaries for standard UI labels;
// the publication-specific Admin vocabulary overrides shared wording.
const sharedArabicByEnglish = new Map<string, string>(
  Object.entries(enDictionary).flatMap(([key, text]) =>
    arDictionary[key] ? [[text, arDictionary[key]!]] : [],
  ),
);

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
    // Authenticated staff may be editing a different publication than the
    // public host's default. Prefer the staff-scoped and permission-checked
    // configuration; use public site identity only on the login/setup shell.
    try {
      const config = await getPublicationLocaleContextApi();
      setLocale(normalize(config.primaryLocale));
      return;
    } catch {
      // Anonymous login, first-run setup, or staff without settings.read.
    }
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
    locale === "ar"
      ? translations[english] || sharedArabicByEnglish.get(english) || english
      : english, [locale]);
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
