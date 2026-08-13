import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  normalizeReferrerDomain,
  deriveVisitorHash,
  classifyBot,
  resolveDateRange,
  computePercentageChange,
  toUtcDay,
} from '../src/application/analytics-helpers';

describe('normalizePath', () => {
  it('strips query strings and fragments', () => {
    expect(normalizePath('/posts/hello?utm_source=x&token=abc')).toBe('/posts/hello');
    expect(normalizePath('/about?email=a@b.com#top')).toBe('/about');
  });

  it('normalizes slashes and trailing slashes', () => {
    expect(normalizePath('/posts/hello/')).toBe('/posts/hello');
    expect(normalizePath('//posts//hello')).toBe('/posts/hello');
    expect(normalizePath('/')).toBe('/');
  });

  it('ensures a leading slash and bounds length', () => {
    expect(normalizePath('posts/hello')).toBe('/posts/hello');
    expect(normalizePath(`/x${'a'.repeat(600)}`).length).toBeLessThanOrEqual(512);
  });
});

describe('normalizeReferrerDomain', () => {
  it('returns bare domains without query strings or paths', () => {
    expect(normalizeReferrerDomain('https://www.google.com/search?q=vibress')).toBe('google.com');
    expect(normalizeReferrerDomain('https://github.com/foo/bar?ref=x')).toBe('github.com');
  });

  it('returns null (Direct) only for a genuinely missing referrer', () => {
    expect(normalizeReferrerDomain(null)).toBeNull();
    expect(normalizeReferrerDomain(undefined)).toBeNull();
    expect(normalizeReferrerDomain('')).toBeNull();
  });

  it('marks same-site referrers as internal (never Direct)', () => {
    expect(normalizeReferrerDomain('https://localhost:7777/posts/x', 'http://localhost:7777')).toBe('internal');
    expect(normalizeReferrerDomain('https://example.com/post-a', 'https://example.com/post-b')).toBe('internal');
  });
});

describe('deriveVisitorHash', () => {
  it('is deterministic and 64-hex', () => {
    const a = deriveVisitorHash('anon-123', 'secret');
    const b = deriveVisitorHash('anon-123', 'secret');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different ids and never contains the raw id', () => {
    const h = deriveVisitorHash('raw-browser-id-xyz', 'secret');
    expect(h).not.toContain('raw-browser-id-xyz');
    expect(deriveVisitorHash('id-1', 'secret')).not.toBe(deriveVisitorHash('id-2', 'secret'));
  });
});

describe('classifyBot', () => {
  it('flags known crawlers and monitors', () => {
    expect(classifyBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(classifyBot('curl/8.7.1')).toBe(true);
    expect(classifyBot('python-requests/2.31')).toBe(true);
    expect(classifyBot('StatusCake-uptime-monitor')).toBe(true);
  });

  it('treats missing UA as non-human', () => {
    expect(classifyBot(null)).toBe(true);
    expect(classifyBot(undefined)).toBe(true);
  });

  it('allows a normal browser UA', () => {
    expect(classifyBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36')).toBe(false);
  });
});

describe('resolveDateRange', () => {
  const now = new Date('2026-08-10T12:00:00Z');

  it('resolves 7d with an immediately preceding 7-day window', () => {
    const r = resolveDateRange('7d', now);
    expect(r.range).toBe('7d');
    expect(toUtcDay(r.from)).toBe('2026-08-04');
    expect(toUtcDay(r.to)).toBe('2026-08-10');
    expect(toUtcDay(r.previousTo)).toBe('2026-08-03');
    expect(toUtcDay(r.previousFrom)).toBe('2026-07-28');
  });

  it('resolves 30d and 90d', () => {
    const r30 = resolveDateRange('30d', now);
    expect(toUtcDay(r30.from)).toBe('2026-07-12');
    const r90 = resolveDateRange('90d', now);
    expect(toUtcDay(r90.from)).toBe('2026-05-13');
  });

  it('does not support YTD (raw retention is 90 days)', () => {
    // YTD is intentionally unsupported: unique visitors come from raw events
    // retained for 90 days, so YTD accuracy and previous-year comparison are
    // impossible. Unknown values fall back to the 30d default.
    const r = resolveDateRange('ytd', now);
    expect(r.range).toBe('30d');
    expect(toUtcDay(r.from)).toBe('2026-07-12');
  });
});

describe('computePercentageChange', () => {
  it('computes (current - previous) / previous * 100', () => {
    expect(computePercentageChange(110, 100).percentage).toBe(10);
    expect(computePercentageChange(90, 100).percentage).toBe(-10);
  });

  it('previous = 0, current > 0 → null + isNew', () => {
    const r = computePercentageChange(5, 0);
    expect(r.percentage).toBeNull();
    expect(r.isNew).toBe(true);
  });

  it('previous = 0, current = 0 → 0, not new', () => {
    const r = computePercentageChange(0, 0);
    expect(r.percentage).toBe(0);
    expect(r.isNew).toBe(false);
  });
});
