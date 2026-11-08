export function getSafeRedirectUrl(target: string | null | undefined, fallback = "/"): string {
  if (!target || typeof target !== "string") return fallback;
  const trimmed = target.trim();
  // Must be a relative path starting with '/' and NOT protocol-relative ('//' or '/\')
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }
  // Reject control chars, newlines, tabs
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code <= 31 || (code >= 127 && code <= 159)) {
      return fallback;
    }
  }
  try {
    const parsed = new URL(trimmed, "http://localhost");
    if (parsed.origin !== "http://localhost") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
