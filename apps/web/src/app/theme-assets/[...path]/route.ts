import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

function getMimeType(fileName: string): string {
  if (fileName.endsWith('.css')) return 'text/css; charset=utf-8';
  if (fileName.endsWith('.js') || fileName.endsWith('.mjs')) return 'application/javascript; charset=utf-8';
  if (fileName.endsWith('.woff2')) return 'font/woff2';
  if (fileName.endsWith('.woff')) return 'font/woff';
  if (fileName.endsWith('.png')) return 'image/png';
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg';
  if (fileName.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function resolveThemeAssetPath(themeId: string, version: string, fileName: string): string | null {
  const themeFolder = themeId.replace(/^vibress-/, '');
  
  // Normalize filenames for legacy/alternate alias paths
  let resolvedFile = fileName;
  if (themeId === 'vibress-default' && (fileName === 'default.css' || fileName === 'casper.css')) {
    resolvedFile = 'casper.css';
  } else if (themeId === 'vibress-minimal' && (fileName === 'minimal.css' || fileName === 'source.css')) {
    resolvedFile = 'source.css';
  } else if (themeId === 'vibress-molten' && (fileName === 'molten.css' || fileName === 'screen.css')) {
    resolvedFile = 'screen.css';
  }

  const possiblePaths = [
    path.join(process.cwd(), 'src', 'themes', themeFolder, resolvedFile),
    path.join(process.cwd(), 'apps', 'web', 'src', 'themes', themeFolder, resolvedFile),
    path.join(process.cwd(), 'public', 'theme-assets', themeId, version, resolvedFile),
    path.join(process.cwd(), 'apps', 'web', 'public', 'theme-assets', themeId, version, resolvedFile),
    path.join(process.cwd(), 'public', 'theme-assets', themeId, resolvedFile),
    path.join(process.cwd(), 'apps', 'web', 'public', 'theme-assets', themeId, resolvedFile),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
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

  // Trusted allowlist — no path traversal
  if (!/^[a-z0-9-]+$/.test(themeId) || !/^\d+\.\d+\.\d+$/.test(version) || fileName.includes('..')) {
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    const assetPath = resolveThemeAssetPath(themeId, version, fileName);
    if (!assetPath) {
      return new NextResponse('Asset Not Found', { status: 404 });
    }

    const mimeType = getMimeType(fileName);
    const isText = mimeType.startsWith('text/') || mimeType.includes('javascript') || mimeType.includes('svg');
    let responseBody: BodyInit;

    if (isText) {
      let text = fs.readFileSync(assetPath, 'utf-8');
      if (fileName.endsWith('.css')) {
        const sharedCardsPath = [
          path.join(process.cwd(), 'src', 'themes', 'shared', 'studio-cards.css'),
          path.join(process.cwd(), 'apps', 'web', 'src', 'themes', 'shared', 'studio-cards.css'),
        ].find(p => fs.existsSync(p));

        if (sharedCardsPath) {
          const sharedCardsCss = fs.readFileSync(sharedCardsPath, 'utf-8');
          text = `${text}\n\n${sharedCardsCss}`;
        }
      }
      responseBody = text;
    } else {
      const buffer = fs.readFileSync(assetPath);
      responseBody = new Uint8Array(buffer);
    }

    return new NextResponse(responseBody, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('Error reading theme asset:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
