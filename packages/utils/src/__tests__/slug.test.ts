import { describe, it, expect } from 'vitest';
import { slugify, isReservedSlug, generateUniqueSlug } from '../slug';

describe('Slug Primitives', () => {
  it('slugifies titles with special characters and accents', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
    expect(slugify('  Crème Brûlée & Café  ')).toBe('creme-brulee-cafe');
    expect(slugify('---Multiple---Hyphens---')).toBe('multiple-hyphens');
  });

  it('detects reserved system slugs', () => {
    expect(isReservedSlug('admin')).toBe(true);
    expect(isReservedSlug('API')).toBe(true);
    expect(isReservedSlug('normal-post-slug')).toBe(false);
  });

  it('handles slug collisions and reserved slugs cleanly', async () => {
    const existing = new Set(['hello-world', 'hello-world-2']);

    const unique1 = await generateUniqueSlug('hello-world', async (s) => existing.has(s));
    expect(unique1).toBe('hello-world-3');

    const uniqueReserved = await generateUniqueSlug('admin', async (s) => existing.has(s));
    expect(uniqueReserved).toBe('admin-1');
  });
});
