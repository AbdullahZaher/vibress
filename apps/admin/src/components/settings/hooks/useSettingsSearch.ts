import { useState, useMemo, useCallback } from "react";
import { useAdminLocale } from "../../../lib/admin-locale";
import { SETTINGS_REGISTRY, type SettingPillarMeta } from "../settings.registry";

const ARABIC_ALIASES: Record<string, string> = {
  general: "عام العامة الموقع",
  "publication-info": "عنوان وصف اسم الموقع المدونة",
  localization: "اللغة اللغات التوقيت المنطقة الزمنية تعريب",
  "metadata-social": "محركات البحث سيو تواصل اجتماعي مشاركة",
  "site-privacy": "الخصوصية خاص كلمة المرور حماية",
  "staff-overview": "الطاقم الفريق الموظفين الصلاحيات الادوار",
  site: "الموقع التصميم المظهر",
  "design-branding": "الشعار الهوية الالوان لون العلامة التجارية الايقونة",
  "navigation-manager": "القوائم الروابط التنقل الهيدر التذييل",
  "social-links": "التواصل الاجتماعي روابط حسابات",
  "themes-manager": "القوالب الثيمات المظهر السمات",
  "announcement-bar": "شريط الاعلان اعلان تنبيه",
  membership: "العضويات الاشتراكات الاعضاء",
  "portal-access": "التسجيل بوابة الاعضاء الوصول",
  "subscription-tiers": "خطط الاشتراك الباقات الدفع التسعير",
  "offers-promotions": "العروض التخفيضات كوبونات",
  growth: "النمو التسويق",
  "newsletters-config": "النشرات البريدية البريد الايميل",
  "analytics-tracking": "التحليلات الاحصائيات التتبع",
  "community-discussions": "التعليقات المناقشات المجتمع الاشراف",
  "recommendations-card": "التوصيات المدونات الاقتراحات",
  advanced: "متقدم النظام",
  "content-models": "نماذج المحتوى الحقول البيانات",
  "code-injection": "الكود الاكواد حقن شفرة",
  "integrations-platform": "التكاملات واجهة البرمجة واجهات الويب هوك",
  "system-diagnostics": "التشخيص صحة النظام الذاكرة الكاش",
  "import-export": "الاستيراد التصدير النسخ الاحتياطي",
  "audit-logs": "السجلات سجل التدقيق النشاط",
  "danger-zone": "منطقة الخطر الحذف اعادة التهيئة",
};

export const normalizeSettingsQuery = (value: string) =>
  value.toLocaleLowerCase().normalize("NFKC")
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();

export function filterSettingsRegistry(
  query: string,
  tr: (text: string) => string = (value) => value,
): SettingPillarMeta[] {
  const term = normalizeSettingsQuery(query);
  if (!term) return SETTINGS_REGISTRY;
  const matches = (text: string) => normalizeSettingsQuery(text).includes(term);
  return SETTINGS_REGISTRY.flatMap((pillar) => {
    const pillarMatch = [pillar.title, pillar.description, tr(pillar.title), tr(pillar.description), ARABIC_ALIASES[pillar.id] ?? ""].some(matches);
    const cards = pillar.cards.filter((card) => pillarMatch || [
      card.title, card.description, tr(card.title), tr(card.description),
      ARABIC_ALIASES[card.id] ?? "", ...card.keywords,
    ].some(matches));
    return cards.length ? [{ ...pillar, cards }] : [];
  });
}

export function useSettingsSearch() {
  const { tr } = useAdminLocale();
  const [query, setQuery] = useState("");
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null);
  const totalCardsCount = useMemo(() => SETTINGS_REGISTRY.reduce((sum, pillar) => sum + pillar.cards.length, 0), []);
  const filteredPillars = useMemo(() => filterSettingsRegistry(query, tr), [query, tr]);
  const matchingCardsCount = useMemo(
    () => filteredPillars.reduce((sum, pillar) => sum + pillar.cards.length, 0), [filteredPillars],
  );
  const highlightCard = useCallback((id: string) => {
    setHighlightedCardId(id);
    window.setTimeout(() => setHighlightedCardId((current) => current === id ? null : current), 2000);
  }, []);
  return { query, setQuery, filteredPillars, matchingCardsCount, totalCardsCount, highlightedCardId, highlightCard };
}
