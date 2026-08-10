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

export function sanitizeHtml(html: string): string {
  if (!html) return '';

  // Remove script tags and their contents
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove inline event handlers like onclick, onerror
  clean = clean.replace(/\s*on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // Neutralize javascript: URLs in href/src
  clean = clean.replace(/(href|src)\s*=\s*["']?\s*javascript:[^"'>\s]*/gi, '$1="#"');

  return clean;
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

export * from './markdown';
