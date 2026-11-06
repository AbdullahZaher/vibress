/**
 * Typeahead queries are author-controlled text, not regular expressions.
 * Keep matching literal and deterministic across RTL/LTR inputs.
 * Ranks results by semantic relevance:
 * 1. Exact title match (100)
 * 2. Prefix title match (80)
 * 3. Exact card/action type match (75)
 * 4. Prefix card/action type match (65)
 * 5. Exact keyword match (60)
 * 6. Prefix keyword match (50)
 * 7. Word-boundary title match (35)
 * 8. Substring title match (25)
 * 9. Substring type match (20)
 * 10. Substring keyword match (15)
 */
export interface FilterableSlashOption {
  title: string;
  cardType?: string | undefined;
  actionType?: string | undefined;
  keywords?: string[] | undefined;
}

export function computeSlashOptionRelevance(
  option: FilterableSlashOption,
  needle: string,
): number {
  const title = option.title.toLowerCase();
  const cardType = option.cardType?.toLowerCase();
  const actionType = option.actionType?.toLowerCase();
  const keywords = option.keywords?.map((k) => k.toLowerCase()) ?? [];

  // Exact matches
  if (title === needle) return 100;
  if (title.startsWith(needle)) return 80;
  if (cardType === needle || actionType === needle) return 75;
  if (
    (cardType && cardType.startsWith(needle)) ||
    (actionType && actionType.startsWith(needle))
  ) {
    return 65;
  }
  if (keywords.includes(needle)) return 60;
  if (keywords.some((k) => k.startsWith(needle))) return 50;

  // Word boundary match in title (e.g. "Heading 1" matched by "1")
  const words = title.split(/\s+/);
  if (words.some((w) => w.startsWith(needle))) return 35;

  // Substring matches
  if (title.includes(needle)) return 25;
  if (
    (cardType && cardType.includes(needle)) ||
    (actionType && actionType.includes(needle))
  ) {
    return 20;
  }
  if (keywords.some((k) => k.includes(needle))) return 15;

  return 0;
}

export function filterSlashMenuOptions<T extends FilterableSlashOption>(
  options: T[],
  query: string | null,
): T[] {
  if (!query) return options;

  const needle = query.trim().toLowerCase();
  if (!needle) return options;

  const scored: Array<{ option: T; score: number; index: number }> = [];

  for (let i = 0; i < options.length; i++) {
    const option = options[i]!;
    const score = computeSlashOptionRelevance(option, needle);
    if (score > 0) {
      scored.push({ option, score, index: i });
    }
  }

  // Stable sort: higher score first, preserving original order on ties
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.index - b.index;
  });

  return scored.map((item) => item.option);
}
