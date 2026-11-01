import { useState, useMemo, useCallback } from "react";
import { SETTINGS_REGISTRY, SettingPillarMeta } from "../settings.registry";
import { useAdminLocale } from "../../../lib/admin-locale";

const ARABIC_KEYWORDS: Record<string, string[]> = {
  "publication-info": ["اسم الموقع", "عنوان الموقع", "الوصف", "هوية"],
  "localization": ["اللغة", "اللغات", "المنطقة الزمنية", "التوقيت"],
  "metadata-social": ["محركات البحث", "سيو", "الظهور", "المعاينة"],
  "site-privacy": ["الخصوصية", "كلمة المرور", "الحماية"],
  "staff-overview": ["الموظفون", "الصلاحيات", "الفريق"],
  "design-branding": ["التصميم", "الشعار", "العلامة", "الألوان"],
  "navigation-manager": ["التنقل", "القوائم", "الترويسة", "التذييل"],
  "social-links": ["التواصل الاجتماعي", "الروابط", "حسابات"],
  "themes-manager": ["القوالب", "المظاهر", "الثيمات"],
  "announcement-bar": ["الإعلانات", "التنبيهات", "شريط الإعلان"],
  "portal-access": ["التسجيل", "الدخول", "الأعضاء"],
  "subscription-tiers": ["الاشتراكات", "الخطط", "الدفع"],
  "offers-promotions": ["العروض", "الخصومات", "الكوبونات"],
  "newsletters-config": ["النشرات البريدية", "البريد", "الرسائل"],
  "analytics-tracking": ["التحليلات", "التتبع", "الإحصائيات"],
  "community-discussions": ["التعليقات", "المناقشات", "المجتمع"],
  "recommendations-card": ["التوصيات", "الاقتراحات"],
  "content-models": ["نماذج المحتوى", "الحقول"],
  "code-injection": ["الأكواد", "الشيفرة"],
  "integrations-platform": ["التكاملات", "الربط", "الويب هوك"],
  "system-diagnostics": ["حالة النظام", "التشخيص"],
  "import-export": ["الاستيراد", "التصدير", "نسخ"],
  "audit-logs": ["سجل التدقيق", "السجلات"],
  "danger-zone": ["منطقة الخطر", "الصيانة"],
};

export function useSettingsSearch() {
  const { tr } = useAdminLocale();
  const [query, setQuery] = useState("");
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(
    null,
  );

  const totalCardsCount = useMemo(() => {
    return SETTINGS_REGISTRY.reduce((acc, p) => acc + p.cards.length, 0);
  }, []);

  const filteredPillars = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return SETTINGS_REGISTRY;
    }

    const matchedPillars: SettingPillarMeta[] = [];

    for (const pillar of SETTINGS_REGISTRY) {
      const pillarMatches =
        [pillar.title, pillar.description, tr(pillar.title), tr(pillar.description)]
          .some(value => value.toLowerCase().includes(q));

      const matchedCards = pillar.cards.filter((card) => {
        if (pillarMatches) return true;
        if (card.title.toLowerCase().includes(q)) return true;
        if (card.description.toLowerCase().includes(q)) return true;
        if ([tr(card.title), tr(card.description), ...(ARABIC_KEYWORDS[card.id] ?? [])]
          .some(value => value.toLowerCase().includes(q))) return true;
        if (card.keywords.some((kw) => kw.toLowerCase().includes(q)))
          return true;
        return false;
      });

      if (matchedCards.length > 0) {
        matchedPillars.push({
          ...pillar,
          cards: matchedCards,
        });
      }
    }

    return matchedPillars;
  }, [query, tr]);

  const matchingCardsCount = useMemo(() => {
    return filteredPillars.reduce((acc, p) => acc + p.cards.length, 0);
  }, [filteredPillars]);

  const highlightCard = useCallback((cardId: string) => {
    setHighlightedCardId(cardId);
    setTimeout(() => {
      setHighlightedCardId(null);
    }, 2000);
  }, []);

  return {
    query,
    setQuery,
    filteredPillars,
    matchingCardsCount,
    totalCardsCount,
    highlightedCardId,
    highlightCard,
  };
}
