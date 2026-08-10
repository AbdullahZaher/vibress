import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

function resolveThemeCssPath(themeFolder: string, fileName: string): string | null {
  const possiblePaths = [
    path.join(process.cwd(), 'src', 'themes', themeFolder, fileName),
    path.join(process.cwd(), 'apps', 'web', 'src', 'themes', themeFolder, fileName),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  if (!segments || segments.length < 2) {
    return new NextResponse('Not found', { status: 404 });
  }

  const themeId = segments[0] || '';
  const version = segments[1] || '';
  const fileName = segments[segments.length - 1] || '';

  // Trusted allowlist — no arbitrary file serving
  if (!/^[a-z0-9-]+$/.test(themeId) || !/^\d+\.\d+\.\d+$/.test(version)) {
    return new NextResponse('Not found', { status: 404 });
  }

  let css: string | null = null;

  try {
    if (themeId === 'vibress-default') {
      const targetFile = (fileName === 'default.css' || fileName === 'casper.css') ? 'casper.css' : fileName;
      const cssPath = resolveThemeCssPath('default', targetFile);
      if (cssPath) {
        css = fs.readFileSync(cssPath, 'utf-8');
      }
    } else if (themeId === 'vibress-minimal') {
      const targetFile = (fileName === 'minimal.css' || fileName === 'source.css') ? 'source.css' : fileName;
      const cssPath = resolveThemeCssPath('minimal', targetFile);
      if (cssPath) {
        css = fs.readFileSync(cssPath, 'utf-8');
      }
    }
  } catch (error) {
    console.error('Error reading theme CSS:', error);
  }

  if (!css) {
    return new NextResponse('CSS Not Found', { status: 404 });
  }

  return new NextResponse(css, {
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
