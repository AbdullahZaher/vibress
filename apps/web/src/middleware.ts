import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_URL || 'http://127.0.0.1:7780';

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Preview route: resolve short-lived token to a theme ID, then redirect to the
  // canonical public URL carrying an internal theme header for the layout.
  if (pathname.startsWith('/preview/')) {
    const segments = pathname.split('/').filter(Boolean); // ['preview', 'TOKEN', 'posts', 'slug']
    const token = segments[1] || '';
    if (!token) {
      return NextResponse.redirect(new URL('/', request.url));
    }

    try {
      const res = await fetch(`${API_BASE}/api/admin/v1/themes/preview/${token}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        return NextResponse.redirect(new URL('/', request.url));
      }
      const data = await res.json();
      const themeId: string = data.themeId;

      // Strip the /preview/:token prefix and serve the underlying public path with the theme header.
      const rest = '/' + segments.slice(2).join('/');
      const url = new URL(rest === '/' ? '/' : rest, request.url);
      const response = NextResponse.rewrite(url);
      response.headers.set('x-vibress-theme', themeId);
      return response;
    } catch {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/preview/:path*'],
};
