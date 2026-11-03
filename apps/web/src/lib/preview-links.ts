/**
 * Preview-only navigation. Public pages never get these rewritten URLs.
 * The prefix is derived solely from the server-validated preview token.
 */
export interface PreviewNavigation {
  prefix: string;
  currentPath: string;
}

const PREVIEW_PREFIX = /^\/preview\/[a-f0-9]{64}$/i;
const SYSTEM_PATH = /^\/(?:admin|api|_next|portal|theme-assets|assets|content|health|preview|favicon\.ico|robots\.txt|sitemap\.xml)(?:\/|$|\?)/i;

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function toPreviewHref(
  href: string,
  navigation: PreviewNavigation | null,
): string {
  if (!navigation || !PREVIEW_PREFIX.test(navigation.prefix)) return href;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("?")) return href;
  // Never turn an external URL, custom protocol, or protocol-relative URL
  // into a bearer-token preview route.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ||
      trimmed.startsWith("//") || trimmed.includes("\\") ||
      hasControlCharacters(trimmed)) {
    return href;
  }

  try {
    const currentPath = navigation.currentPath.startsWith("/")
      ? navigation.currentPath : "/";
    const target = new URL(trimmed, new URL(currentPath, "https://preview.invalid"));
    if (target.origin !== "https://preview.invalid") return href;
    const pathname = target.pathname;
    if (SYSTEM_PATH.test(pathname) || pathname === navigation.prefix ||
        pathname.startsWith(navigation.prefix + "/")) return href;
    return navigation.prefix + pathname + target.search + target.hash;
  } catch {
    return href;
  }
}

/**
 * Rewrite only anchor href attributes in server-rendered Liquid or editorial
 * HTML. Do not touch asset URLs, scripts, link rels, forms, or other markup.
 */
export function rewritePreviewHtml(
  html: string,
  navigation: PreviewNavigation | null,
): string {
  if (!navigation) return html;
  return html.replace(
    /(<a\b[^>]*?\bhref\s*=\s*)(["'])([^"'<>]*)\2/gi,
    (_whole, before: string, quote: string, href: string) =>
      before + quote + toPreviewHref(href, navigation) + quote,
  );
}
