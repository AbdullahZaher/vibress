import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const API_BASE = process.env.API_URL || "http://127.0.0.1:7780";
const PUBLICATION_SCOPE_TTL_MS = 60_000;
const publicationScopeCache = new Map<
  string,
  { publicationId: string; expiresAt: number }
>();

async function resolveRequestPublicationId(
  request: NextRequest,
): Promise<string | null> {
  const hostHeader =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "";
  if (!hostHeader) return null;

  const cached = publicationScopeCache.get(hostHeader);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.publicationId;
  }

  try {
    const response = await fetch(`${API_BASE}/api/content/v1/site`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "x-forwarded-host": hostHeader,
      },
    });
    if (!response.ok) return null;

    const publicationId = response.headers.get("x-vibress-publication-id");
    if (
      !publicationId ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(publicationId)
    ) {
      return null;
    }

    publicationScopeCache.set(hostHeader, {
      publicationId,
      expiresAt: Date.now() + PUBLICATION_SCOPE_TTL_MS,
    });
    return publicationId;
  } catch {
    return null;
  }
}

function getMimeType(fileName: string): string {
  if (fileName.endsWith(".css")) return "text/css; charset=utf-8";
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs"))
    return "application/javascript; charset=utf-8";
  if (fileName.endsWith(".woff2")) return "font/woff2";
  if (fileName.endsWith(".woff")) return "font/woff";
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg"))
    return "image/jpeg";
  if (fileName.endsWith(".webp")) return "image/webp";
  if (fileName.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function resolveThemeAssetPath(
  themeId: string,
  version: string,
  relativePath: string,
  publicationId: string | null,
): string | null {
  const cleanId = themeId.replace(/[^a-z0-9-]/g, "");
  const cleanVersion = version.replace(/[^0-9.]/g, "");
  const fileName = path.basename(relativePath);

  const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const explicitRoot = process.env.THEME_STORAGE_ROOT || process.env.CONTENT_DIR;
  const cleanPublicationId =
    publicationId?.replace(/[^a-zA-Z0-9_-]/g, "") || "";

  const scopedExternalRoots =
    publicationId && publicationId !== "pub_default"
      ? [
          ...(explicitRoot
            ? [
                path.join(
                  explicitRoot,
                  "publications",
                  cleanPublicationId,
                  cleanId,
                  cleanVersion,
                ),
                path.join(
                  explicitRoot,
                  "themes",
                  "publications",
                  cleanPublicationId,
                  cleanId,
                  cleanVersion,
                ),
              ]
            : []),
          path.join(
            process.cwd(),
            "content",
            "themes",
            "publications",
            cleanPublicationId,
            cleanId,
            cleanVersion,
          ),
          path.join(
            process.cwd(),
            "apps",
            "api",
            "content",
            "themes",
            "publications",
            cleanPublicationId,
            cleanId,
            cleanVersion,
          ),
          path.join(
            process.cwd(),
            "..",
            "api",
            "content",
            "themes",
            "publications",
            cleanPublicationId,
            cleanId,
            cleanVersion,
          ),
          path.join(
            process.cwd(),
            "..",
            "..",
            "content",
            "themes",
            "publications",
            cleanPublicationId,
            cleanId,
            cleanVersion,
          ),
        ]
      : [];

  // Legacy global roots are only considered after the request host has been
  // resolved to a publication. This preserves old installs without allowing
  // an unresolved host to probe another tenant's external theme files.
  const legacyExternalRoots = publicationId
    ? [
        ...(explicitRoot
          ? [
              path.join(explicitRoot, cleanId, cleanVersion),
              path.join(explicitRoot, "themes", cleanId, cleanVersion),
              path.join(explicitRoot, cleanId),
            ]
          : []),
        path.join(process.cwd(), "content", "themes", cleanId, cleanVersion),
        path.join(
          process.cwd(),
          "apps",
          "api",
          "content",
          "themes",
          cleanId,
          cleanVersion,
        ),
        path.join(
          process.cwd(),
          "..",
          "api",
          "content",
          "themes",
          cleanId,
          cleanVersion,
        ),
        path.join(
          process.cwd(),
          "..",
          "..",
          "content",
          "themes",
          cleanId,
          cleanVersion,
        ),
        path.join(
          process.cwd(),
          "..",
          "..",
          "apps",
          "api",
          "content",
          "themes",
          cleanId,
          cleanVersion,
        ),
        path.join(process.cwd(), "content", cleanId),
        path.join(process.cwd(), "..", "..", "content", cleanId),
        path.join(process.cwd(), "..", "api", "content", cleanId),
        path.join(process.cwd(), "apps", "api", "content", cleanId),
      ]
    : [];

  for (const themeRoot of [
    ...scopedExternalRoots,
    ...legacyExternalRoots,
  ]) {
    const candidates = [
      path.join(themeRoot, cleanRel),
      path.join(themeRoot, "assets", cleanRel),
      path.join(themeRoot, fileName),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }

  // Built-in themes are system-wide and do not contain tenant-owned files.
  const themeFolder = cleanId.replace(/^vibress-/, "");
  let resolvedFile = fileName;
  if (
    cleanId === "vibress-default" &&
    (fileName === "default.css" || fileName === "casper.css")
  ) {
    resolvedFile = "casper.css";
  } else if (
    cleanId === "vibress-minimal" &&
    (fileName === "minimal.css" || fileName === "source.css")
  ) {
    resolvedFile = "source.css";
  } else if (
    cleanId === "vibress-molten" &&
    (fileName === "molten.css" || fileName === "screen.css")
  ) {
    resolvedFile = "screen.css";
  }

  const builtinPaths = [
    path.join(process.cwd(), "src", "themes", themeFolder, resolvedFile),
    path.join(
      process.cwd(),
      "apps",
      "web",
      "src",
      "themes",
      themeFolder,
      resolvedFile,
    ),
    path.join(
      process.cwd(),
      "public",
      "theme-assets",
      cleanId,
      cleanVersion,
      resolvedFile,
    ),
    path.join(
      process.cwd(),
      "apps",
      "web",
      "public",
      "theme-assets",
      cleanId,
      cleanVersion,
      resolvedFile,
    ),
    path.join(process.cwd(), "public", "theme-assets", cleanId, resolvedFile),
    path.join(
      process.cwd(),
      "apps",
      "web",
      "public",
      "theme-assets",
      cleanId,
      resolvedFile,
    ),
  ];

  for (const candidate of builtinPaths) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  if (!segments || segments.length < 2) {
    return new NextResponse("Not found", { 
      status: 404,
      headers: { "Cache-Control": "no-cache, no-store, must-revalidate" }
    });
  }

  const themeId = segments[0] || "";
  const version = segments[1] || "";
  const relativePath = segments.slice(2).join("/") || segments[segments.length - 1] || "";
  const fileName = segments[segments.length - 1] || "";

  // Trusted allowlist — no path traversal
  if (
    !/^[a-z0-9-]+$/.test(themeId) ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    relativePath.includes("..") ||
    relativePath.includes("\0")
  ) {
    return new NextResponse("Not found", { 
      status: 404,
      headers: { "Cache-Control": "no-cache, no-store, must-revalidate" }
    });
  }

  try {
    const publicationId = await resolveRequestPublicationId(request);
    const assetPath = resolveThemeAssetPath(
      themeId,
      version,
      relativePath,
      publicationId,
    );
    if (!assetPath) {
      return new NextResponse("Asset Not Found", { 
        status: 404,
        headers: { "Cache-Control": "no-cache, no-store, must-revalidate" }
      });
    }

    const mimeType = getMimeType(fileName);
    const isText =
      mimeType.startsWith("text/") ||
      mimeType.includes("javascript") ||
      mimeType.includes("svg");
    let responseBody: BodyInit;

    if (isText) {
      let text = fs.readFileSync(assetPath, "utf-8");
      if (fileName.endsWith(".css")) {
        const sharedCardsPath = [
          path.join(
            process.cwd(),
            "src",
            "themes",
            "shared",
            "studio-cards.css",
          ),
          path.join(
            process.cwd(),
            "apps",
            "web",
            "src",
            "themes",
            "shared",
            "studio-cards.css",
          ),
        ].find((p) => fs.existsSync(p));

        if (sharedCardsPath) {
          const sharedCardsCss = fs.readFileSync(sharedCardsPath, "utf-8");
          text = `${text}\n\n${sharedCardsCss}`;
        }
      }
      responseBody = text;
    } else {
      const buffer = fs.readFileSync(assetPath);
      responseBody = new Uint8Array(buffer);
    }

    const cacheControl = process.env.NODE_ENV === "production"
      ? "public, max-age=3600, stale-while-revalidate=86400"
      : "no-cache, no-store, must-revalidate";

    return new NextResponse(responseBody, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": cacheControl,
      },
    });
  } catch (error) {
    console.error("Error reading theme asset:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
