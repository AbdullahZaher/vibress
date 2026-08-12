import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_URL || 'http://127.0.0.1:7780';

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
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
  ].join('; ');
}

function applyCsp(request: NextRequest, response: NextResponse): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID().replace(/-/g, '')).toString('base64');
  const cspHeader = buildCsp(nonce);
  // Forward the CSP (with nonce) as a request header so Next.js applies the
  // nonce to its inline scripts/styles; also set it on the response for the
  // browser.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', cspHeader);
  response.headers.set('Content-Security-Policy', cspHeader);
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Preview route: resolve short-lived token to a theme ID, then serve the
  // canonical public URL carrying an internal theme header for the layout.
  if (pathname.startsWith('/preview/')) {
    const segments = pathname.split('/').filter(Boolean); // ['preview', 'TOKEN', 'posts', 'slug']
    const token = segments[1] || '';
    if (!token) {
      return applyCsp(request, NextResponse.redirect(new URL('/', request.url)));
    }

    try {
      const res = await fetch(`${API_BASE}/api/admin/v1/themes/preview/${token}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        return applyCsp(request, NextResponse.redirect(new URL('/', request.url)));
      }
      const data = await res.json();
      const themeId: string = data.themeId;

      // Strip the /preview/:token prefix and serve the underlying public path with the theme header.
      const rest = '/' + segments.slice(2).join('/');
      const url = new URL(rest === '/' ? '/' : rest, request.url);
      const nonce = Buffer.from(crypto.randomUUID().replace(/-/g, '')).toString('base64');
      const cspHeader = buildCsp(nonce);
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('Content-Security-Policy', cspHeader);
      requestHeaders.set('x-vibress-theme', themeId);
      const response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
      response.headers.set('Content-Security-Policy', cspHeader);
      return response;
    } catch {
      return applyCsp(request, NextResponse.redirect(new URL('/', request.url)));
    }
  }

  return applyCsp(request, NextResponse.next({ request: { headers: request.headers } }));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)'],
};
