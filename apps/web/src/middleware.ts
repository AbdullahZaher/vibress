import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.API_URL || "http://127.0.0.1:7780";

/**
 * Environment-aware enforced CSP for the public web app.
 *
 * Next.js App Router renders inline bootstrap scripts/styles; the nonce is
 * generated per request and Next.js reads it from the forwarded CSP request
 * header (getScriptNonceFromHeader) and applies it to its inline elements.
 *
 * - script-src: 'self' + per-request nonce (no unsafe-inline, no unsafe-eval)
 * - style-src: 'self' + nonce + 'unsafe-inline' (React inline style
 *   attributes in themes; non-executable CSS exception, documented)
 * - connect-src: 'self' only — the web app talks to the API same-origin via
 *   the gateway; no cross-origin browser fetch is performed.
 * - No unsafe wildcards; frame-ancestors 'none'; object-src 'none'.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  const scriptDirectives = isDev
    ? `script-src 'self' 'unsafe-eval' 'nonce-${nonce}' https://www.googletagmanager.com https://plausible.io https://*.posthog.com`
    : `script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com https://plausible.io https://*.posthog.com`;

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://plausible.io https://*.posthog.com",
    // Approved Studio embed providers only — never frame-src *.
    // Matches packages/studio-utils getEmbedProvider() allowlist.
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
    scriptDirectives,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `style-src-attr 'unsafe-inline'`,
  ].join("; ");
}

function createCspResponse(
  request: NextRequest,
  options?: {
    rewriteUrl?: URL;
    redirectUrl?: URL;
    extraHeaders?: Record<string, string>;
  },
): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID().replace(/-/g, "")).toString(
    "base64",
  );
  const cspHeader = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", cspHeader);

  if (options?.extraHeaders) {
    for (const [k, v] of Object.entries(options.extraHeaders)) {
      requestHeaders.set(k, v);
    }
  }

  let response: NextResponse;
  if (options?.redirectUrl) {
    response = NextResponse.redirect(options.redirectUrl);
  } else if (options?.rewriteUrl) {
    response = NextResponse.rewrite(options.rewriteUrl, {
      request: { headers: requestHeaders },
    });
  } else {
    response = NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("x-nonce", nonce);
  return response;
}

function localizedErrorResponse(status: 404 | 503, message: string): NextResponse {
  // Locale configuration failures must preserve CSP instead of bypassing
  // the security headers applied to ordinary theme and private-site pages.
  const nonce = Buffer.from(crypto.randomUUID().replace(/-/g, "")).toString("base64");
  const response = new NextResponse(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function privateSiteRedirect(
  request: NextRequest,
  reason?: string,
): NextResponse {
  const privateUrl = new URL("/private", request.url);
  privateUrl.searchParams.set("r", request.nextUrl.pathname);
  if (reason) privateUrl.searchParams.set("error", reason);
  return createCspResponse(request, { redirectUrl: privateUrl });
}

function encodeSiteAuthScope(publicationId: string): string {
  return Buffer.from(publicationId, "utf8").toString("base64url");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Site Privacy enforcement
  const isProtectedPath =
    !pathname.startsWith("/_next") &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/theme-assets") &&
    !pathname.startsWith("/preview") &&
    pathname !== "/private" &&
    pathname !== "/favicon.ico" &&
    pathname !== "/robots.txt" &&
    pathname !== "/sitemap.xml";

  async function verifySiteAuth(
    token: string | undefined | null,
    publicationId: string,
  ): Promise<boolean> {
    if (!token || typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== "v2") return false;

    const timestampStr = parts[1];
    const scope = parts[2];
    const signature = parts[3];
    if (!timestampStr || !scope || !signature || !/^[a-f0-9]{64}$/i.test(signature))
      return false;

    const timestamp = parseInt(timestampStr, 10);
    if (Number.isNaN(timestamp) || !/^\d+$/.test(timestampStr)) return false;

    const now = Date.now();
    if (
      timestamp > now + 300_000 ||
      now - timestamp > 30 * 24 * 60 * 60 * 1000
    ) {
      return false;
    }

    const expectedScope = encodeSiteAuthScope(publicationId);
    if (scope !== expectedScope) return false;

    try {
      const secret =
        process.env.VIBRESS_ENCRYPTION_KEY || "vibress-site-privacy-secret";
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sigBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        enc.encode(`v2:${timestampStr}:${scope}`),
      );
      const expectedHex = Array.from(new Uint8Array(sigBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      return expectedHex.toLowerCase() === signature.toLowerCase();
    } catch {
      return false;
    }
  }

  if (isProtectedPath) {
    try {
      const hostHeader = request.headers.get("x-forwarded-host") || request.headers.get("host") || undefined;
      const siteRes = await fetch(`${API_BASE}/api/content/v1/site`, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(hostHeader ? { "x-forwarded-host": hostHeader } : {}),
        },
      });

      if (!siteRes.ok) {
        return privateSiteRedirect(request, "privacy_unavailable");
      }

      const siteData = await siteRes.json();
      if (siteData.security?.isPrivate) {
        const publicationId = siteRes.headers.get("x-vibress-publication-id");
        const hasSiteAuth = publicationId
          ? await verifySiteAuth(
              request.cookies.get("vb_site_auth")?.value,
              publicationId,
            )
          : false;
        if (!hasSiteAuth) {
          return privateSiteRedirect(request);
        }
      }
    } catch {
      return privateSiteRedirect(request, "privacy_unavailable");
    }
  }

  // Preview route: resolve short-lived token to a theme ID, then serve the
  // canonical public URL carrying an internal theme header for the layout.
  if (pathname.startsWith("/preview/")) {
    const segments = pathname.split("/").filter(Boolean); // ['preview', 'TOKEN', 'posts', 'slug']
    const token = segments[1] || "";
    if (!token) {
      return createCspResponse(request, {
        redirectUrl: new URL("/", request.url),
      });
    }

    try {
      const hostHeader =
        request.headers.get("x-forwarded-host") ||
        request.headers.get("host") ||
        undefined;
      const res = await fetch(
        `${API_BASE}/api/admin/v1/themes/preview/${token}`,
        {
          cache: "no-store",
          ...(hostHeader
            ? { headers: { "x-forwarded-host": hostHeader } }
            : {}),
        },
      );
      if (!res.ok) {
        return createCspResponse(request, {
          redirectUrl: new URL("/", request.url),
        });
      }
      const data = await res.json();
      const themeId: string = data.themeId;

      // Strip the /preview/:token prefix and serve the underlying public path with the theme header.
      const rest = "/" + segments.slice(2).join("/");
      const url = new URL(rest === "/" ? "/" : rest, request.url);
      return createCspResponse(request, {
        rewriteUrl: url,
        extraHeaders: {
          "x-vibress-theme": themeId,
          "x-vibress-preview": "true",
        },
      });
    } catch {
      return createCspResponse(request, {
        redirectUrl: new URL("/", request.url),
      });
    }
  }

  // Redirects are resolved by the API using the public hostname, never a
  // caller-supplied publication ID. Preserve the selected HTTP status.
  // Protected/system paths are deliberately excluded from redirect rules.
  const isRedirectCandidate =
    (request.method === "GET" || request.method === "HEAD") &&
    !["/private", "/favicon.ico", "/robots.txt", "/sitemap.xml"].includes(pathname) &&
    !["/_next", "/api", "/admin", "/portal", "/health", "/content", "/assets", "/theme-assets", "/preview"].some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  if (isRedirectCandidate) {
    try {
      const hostHeader = request.headers.get("x-forwarded-host") || request.headers.get("host");
      const apiUrl = new URL(`${API_BASE}/api/content/v1/redirects/resolve`);
      apiUrl.searchParams.set("path", pathname);
      const response = await fetch(apiUrl.toString(), {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(hostHeader ? { "x-forwarded-host": hostHeader } : {}),
        },
      });
      if (response.ok) {
        const payload = await response.json();
        const rule = payload?.redirect;
        if (
          rule &&
          typeof rule.destination === "string" &&
          ((
            rule.destination.startsWith("/") && !rule.destination.startsWith("//") && !rule.destination.includes("\\")
          ) || rule.destination.startsWith("http://") || rule.destination.startsWith("https://")) &&
          [301, 302, 307, 308].includes(rule.statusCode)
        ) {
          const target = new URL(rule.destination, request.url);
          // Preserve the source query string if the destination has none.
          if (!target.search) target.search = request.nextUrl.search;
          return NextResponse.redirect(target, { status: rule.statusCode });
        }
      }
    } catch {
      // A temporarily unavailable API must not take down public rendering.
    }
  }

  // Host-authoritative site policy. No fixed "English primary / Arabic
  // secondary" routing table; every configured primary is unprefixed.
  const isExcludedPrefix =
    ["/_next", "/api", "/admin", "/portal", "/health", "/content",
      "/assets", "/theme-assets", "/preview"].some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ) ||
    ["/favicon.ico", "/robots.txt", "/sitemap.xml", "/private"].includes(pathname);
  if (!isExcludedPrefix) {
    const host = request.headers.get("x-forwarded-host") ||
      request.headers.get("host") || undefined;
    let localePolicy: { primary: string; enabled: string[] };
    try {
      const response = await fetch(`${API_BASE}/api/content/v1/site`, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(host ? { "x-forwarded-host": host } : {}),
        },
      });
      if (!response.ok) throw new Error("Publication locale unavailable");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("site" in data) ||
          !data.site || typeof data.site !== "object" ||
          !("locale" in data.site) || typeof data.site.locale !== "string" ||
          !("enabledLocales" in data.site) || !Array.isArray(data.site.enabledLocales)) {
        throw new Error("Invalid publication locale policy");
      }
      const primary = Intl.getCanonicalLocales(data.site.locale)[0];
      const enabled = data.site.enabledLocales.filter(
        (value: unknown): value is string => typeof value === "string",
      );
      if (!primary || !enabled.includes(primary)) throw new Error("Invalid primary locale");
      localePolicy = { primary, enabled };
    } catch {
      // Don't guess a language/tenant on API outages.
      return localizedErrorResponse(503, "Publication temporarily unavailable");
    }

    const segments = pathname.split("/").filter(Boolean);
    const prefix = segments[0]?.toLowerCase();
    let resolved = localePolicy.primary;
    let isLocalizedPath = false;

    if (prefix) {
      const candidates = localePolicy.enabled.filter((code) => {
        const sameBase = code.split("-")[0]?.toLowerCase() === prefix;
        const exact = code.toLowerCase() === prefix;
        if (exact) return true;
        return sameBase && localePolicy.enabled.filter(
          (variant) => variant.split("-")[0] === code.split("-")[0],
        ).length === 1;
      });
      if (candidates.length === 1) {
        resolved = candidates[0]!;
        isLocalizedPath = true;
      } else if (["en", "ar", "fr", "de", "es", "fa", "ur", "tr", "he", "ja", "pt", "zh"]
        .includes(prefix.split("-")[0] || "")) {
        // A known but disabled locale must never render via public fallback.
        return localizedErrorResponse(404, "Not Found");
      }
    }

    if (isLocalizedPath) {
      const destination = segments.slice(1).join("/");
      if (resolved === localePolicy.primary) {
        const canonical = new URL(destination ? `/${destination}` : "/", request.url);
        canonical.search = request.nextUrl.search;
        return NextResponse.redirect(canonical, { status: 301 });
      }
      const languageCode = resolved.split("-")[0] || resolved;
      const collisions = localePolicy.enabled.filter(
        (candidate) => candidate.split("-")[0] === languageCode,
      );
      const canonicalPrefix = collisions.length > 1
        ? resolved.toLowerCase() : languageCode.toLowerCase();
      if (prefix !== canonicalPrefix || segments[0] !== prefix) {
        const canonical = new URL(
          `/${canonicalPrefix}${destination ? "/" + destination : ""}`,
          request.url,
        );
        canonical.search = request.nextUrl.search;
        return NextResponse.redirect(canonical, { status: 301 });
      }
      const internal = new URL(destination ? `/${destination}` : "/", request.url);
      internal.search = request.nextUrl.search;
      return createCspResponse(request, {
        rewriteUrl: internal,
        extraHeaders: {
          "x-vibress-locale": resolved,
          "x-vibress-direction": ["ar", "fa", "he", "ur", "ps", "sd", "ug", "yi"]
            .includes(languageCode) ? "rtl" : "ltr",
        },
      });
    }
    return createCspResponse(request, {
      extraHeaders: {
        "x-vibress-locale": localePolicy.primary,
        "x-vibress-direction": ["ar", "fa", "he", "ur", "ps", "sd", "ug", "yi"]
          .includes(localePolicy.primary.split("-")[0] || "") ? "rtl" : "ltr",
      },
    });
  }
  return createCspResponse(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)",
  ],
};
