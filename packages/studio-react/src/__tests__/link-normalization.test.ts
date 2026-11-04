import { describe, it, expect } from 'vitest';

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('/')
  ) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

describe('Floating Link Editor URL Normalization', () => {
  it('automatically adds https:// prefix when protocol is omitted', () => {
    expect(normalizeUrl('vibress.org')).toBe('https://vibress.org');
    expect(normalizeUrl('example.com/docs')).toBe('https://example.com/docs');
    expect(normalizeUrl('sub.domain.co.uk/path?q=1#anchor')).toBe('https://sub.domain.co.uk/path?q=1#anchor');
  });

  it('preserves existing valid protocols', () => {
    expect(normalizeUrl('https://vibress.org')).toBe('https://vibress.org');
    expect(normalizeUrl('http://insecure.test')).toBe('http://insecure.test');
    expect(normalizeUrl('mailto:author@vibress.org')).toBe('mailto:author@vibress.org');
    expect(normalizeUrl('tel:+1234567890')).toBe('tel:+1234567890');
    expect(normalizeUrl('#section-2')).toBe('#section-2');
    expect(normalizeUrl('/local-path')).toBe('/local-path');
  });

  it('handles empty and whitespace input gracefully', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('   ')).toBe('');
  });
});
