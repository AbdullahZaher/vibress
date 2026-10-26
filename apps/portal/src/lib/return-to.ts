const KEY = "vibress_return_to";

/**
 * Validates and sanitizes a return-to path against open redirect and XSS attacks.
 * Enforces:
 * 1. Must be relative (starts with a single forward slash, no backslashes, no control characters).
 * 2. Parses against window.location.origin to verify strict same-origin.
 * 3. Protocol must be http: or https: (rejects javascript:, data:, blob:, etc.).
 * 4. Must not redirect back into /portal or /admin app routes.
 */
function hasControlCharactersOrBackslash(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // ASCII control characters (0-31 and 127) or backslash (92)
    if ((code >= 0 && code <= 31) || code === 127 || code === 92) {
      return true;
    }
  }
  return false;
}

export function sanitizeReturnTo(
  candidate: unknown,
  baseOrigin: string = typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:7777",
): string | null {
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\")
  ) {
    return null;
  }
  // Reject control characters and backslashes
  if (hasControlCharactersOrBackslash(trimmed)) {
    return null;
  }
  try {
    const parsed = new URL(trimmed, baseOrigin);
    if (parsed.origin !== baseOrigin) return null;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const pathname = parsed.pathname.toLowerCase();
    if (
      pathname === "/portal" ||
      pathname.startsWith("/portal/") ||
      pathname === "/admin" ||
      pathname.startsWith("/admin/")
    ) {
      return null;
    }
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return null;
  }
}

/** Remember the page the user came from (same-origin only), so we can send them back after sign-in. */
export function captureReturnTo(): void {
  try {
    const searchParams = new URLSearchParams(window.location.search);
    let explicit = searchParams.get("return");
    if (!explicit && window.location.hash.includes("?")) {
      const hashQuery = window.location.hash.split("?")[1];
      if (hashQuery) {
        explicit = new URLSearchParams(hashQuery).get("return");
      }
    }
    const safeExplicit = sanitizeReturnTo(explicit);
    if (safeExplicit) {
      localStorage.setItem(KEY, safeExplicit);
      return;
    }

    if (!document.referrer) return;
    const ref = new URL(document.referrer);
    if (ref.origin !== window.location.origin) return;
    const path = ref.pathname + ref.search + ref.hash;
    const safeRef = sanitizeReturnTo(path);
    if (safeRef) {
      localStorage.setItem(KEY, safeRef);
    }
  } catch {
    // storage/URL unavailable: fall back to home
  }
}

/** Where to go after sign-in: a verified public destination or the member account. */
export function consumeReturnTo(): string {
  try {
    const value = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    const safe = sanitizeReturnTo(value);
    if (safe) return safe;
  } catch {
    // ignore
  }
  // The default post-verification destination is the member portal, not the
  // public homepage. This constant is Host-owned, not untrusted return input.
  return "/portal/#/account";
}
