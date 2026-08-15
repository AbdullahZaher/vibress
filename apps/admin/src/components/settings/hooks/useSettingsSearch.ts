import { useState, useMemo, useCallback } from "react";
import { SETTINGS_REGISTRY, SettingPillarMeta } from "../settings.registry";

export function useSettingsSearch() {
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
        pillar.title.toLowerCase().includes(q) ||
        pillar.description.toLowerCase().includes(q);

      const matchedCards = pillar.cards.filter((card) => {
        if (pillarMatches) return true;
        if (card.title.toLowerCase().includes(q)) return true;
        if (card.description.toLowerCase().includes(q)) return true;
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
  }, [query]);

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
