export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isSafeUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();

  // Reject dangerous protocols
  if (
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('vbscript:') ||
    trimmed.startsWith('file:')
  ) {
    return false;
  }

  // Allow safe protocols or relative paths
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('data:image/')
  ) {
    return true;
  }

  // If no scheme present (e.g. "example.com"), treat as relative/safe unless it contains colon early
  const firstColon = trimmed.indexOf(':');
  if (firstColon === -1) return true;

  return false;
}

export function sanitizeUrl(url: string, fallback = '#'): string {
  if (!url || !isSafeUrl(url)) {
    return fallback;
  }
  return url.trim();
}

/**
 * Sanitize arbitrary HTML against the Studio allowlist.
 *
 * Implemented with a real HTML parser (parse5) — NOT a regex filter.
 * Safe semantic markup survives; script/event-handler/unsafe-URL vectors are
 * removed. See sanitize.ts for the full allowlist and URL rules.
 */
export function sanitizeHtml(html: string): string {
  return sanitizeStudioHtml(html);
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

import { sanitizeStudioHtml } from './sanitize';

export * from './markdown';
export * from './sanitize';
