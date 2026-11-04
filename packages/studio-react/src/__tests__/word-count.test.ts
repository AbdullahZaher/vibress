import { describe, it, expect } from 'vitest';

export function calculateWordCountStats(text: string): {
  words: number;
  characters: number;
  readingTimeMinutes: number;
} {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  const characters = text.length;
  const readingTimeMinutes = Math.max(1, Math.ceil(words / 200));

  return { words, characters, readingTimeMinutes };
}

describe('Editorial Word Count and Reading Time Calculation', () => {
  it('correctly calculates word count for standard English text', () => {
    const text = 'The double-edged sword of independence gives you freedom, but demands discipline.';
    const stats = calculateWordCountStats(text);
    expect(stats.words).toBe(11);
    expect(stats.characters).toBe(text.length);
    expect(stats.readingTimeMinutes).toBe(1);
  });

  it('correctly calculates word count for Arabic text', () => {
    const text = 'محرر الاستوديو يوفر تجربة كتابة هادئة ومتكاملة بدون تشتيت.';
    const stats = calculateWordCountStats(text);
    expect(stats.words).toBe(9);
    expect(stats.readingTimeMinutes).toBe(1);
  });

  it('calculates reading time for larger articles (Ghost 200 WPM standard)', () => {
    // 600 words should be 3 minutes reading time
    const words = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
    const stats = calculateWordCountStats(words);
    expect(stats.words).toBe(600);
    expect(stats.readingTimeMinutes).toBe(3);
  });

  it('handles empty and whitespace-only text gracefully', () => {
    expect(calculateWordCountStats('').words).toBe(0);
    expect(calculateWordCountStats('   \n\t  ').words).toBe(0);
    expect(calculateWordCountStats('').readingTimeMinutes).toBe(1);
  });
});

