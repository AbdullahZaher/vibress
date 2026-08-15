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

function applyCsp(request: NextRequest, response: NextResponse): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID().replace(/-/g, "")).toString(
    "base64",
  );
  const cspHeader = buildCsp(nonce);
  // Forward the CSP (with nonce) as a request header so Next.js applies the
  // nonce to its inline scripts/styles; also set it on the response for the
  // browser.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", cspHeader);
  response.headers.set("Content-Security-Policy", cspHeader);
  return response;
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
  ): Promise<boolean> {
    if (!token || typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return false;

    const timestampStr = parts[1];
    const signature = parts[2];
    if (!timestampStr || !signature || !/^[a-f0-9]{64}$/i.test(signature))
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
        enc.encode(`v1:${timestampStr}`),
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
    const hasSiteAuth = await verifySiteAuth(
      request.cookies.get("vb_site_auth")?.value,
    );
    if (!hasSiteAuth) {
      try {
        const siteRes = await fetch(`${API_BASE}/api/content/v1/site`, {
          cache: "no-store",
        });
        if (siteRes.ok) {
          const siteData = await siteRes.json();
          if (siteData.security?.isPrivate) {
            const privateUrl = new URL("/private", request.url);
            privateUrl.searchParams.set("r", pathname);
            return applyCsp(request, NextResponse.redirect(privateUrl));
          }
        }
      } catch {
        // fail-open if API is unreachable
      }
    }
  }

  // Preview route: resolve short-lived token to a theme ID, then serve the
  // canonical public URL carrying an internal theme header for the layout.
  if (pathname.startsWith("/preview/")) {
    const segments = pathname.split("/").filter(Boolean); // ['preview', 'TOKEN', 'posts', 'slug']
    const token = segments[1] || "";
    if (!token) {
      return applyCsp(
        request,
        NextResponse.redirect(new URL("/", request.url)),
      );
    }

    try {
      const res = await fetch(
        `${API_BASE}/api/admin/v1/themes/preview/${token}`,
        {
          cache: "no-store",
        },
      );
      if (!res.ok) {
        return applyCsp(
          request,
          NextResponse.redirect(new URL("/", request.url)),
        );
      }
      const data = await res.json();
      const themeId: string = data.themeId;

      // Strip the /preview/:token prefix and serve the underlying public path with the theme header.
      const rest = "/" + segments.slice(2).join("/");
      const url = new URL(rest === "/" ? "/" : rest, request.url);
      const nonce = Buffer.from(crypto.randomUUID().replace(/-/g, "")).toString(
        "base64",
      );
      const cspHeader = buildCsp(nonce);
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("Content-Security-Policy", cspHeader);
      requestHeaders.set("x-vibress-theme", themeId);
      const response = NextResponse.rewrite(url, {
        request: { headers: requestHeaders },
      });
      response.headers.set("Content-Security-Policy", cspHeader);
      return response;
    } catch {
      return applyCsp(
        request,
        NextResponse.redirect(new URL("/", request.url)),
      );
    }
  }

  return applyCsp(
    request,
    NextResponse.next({ request: { headers: request.headers } }),
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)",
  ],
};
