import React from "react";
import fs from "node:fs";
import path from "node:path";
import {
  createLiquidThemeEngine,
  mapSiteToViewModel,
  ThemeViewModelContext,
} from "@vibress/theme-core";
import { getDirection, isRtl, defaultLocaleRegistry, type Direction } from "@vibress/i18n";
import { getTheme, getFallbackTheme } from "../themes/registry";
import { ThemeSiteSettings } from "./theme-host";

const themeFilesCache = new Map<string, { files: Map<string, string>; loadedAt: number }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute in-memory cache

function findThemeDirectory(themeId: string, version: string): string | null {
  const cleanId = themeId.replace(/[^a-z0-9-]/g, "");
  const cleanVersion = version.replace(/[^0-9.]/g, "");

  const explicitRoot = process.env.THEME_STORAGE_ROOT || process.env.CONTENT_DIR;

  const candidates = [
    ...(explicitRoot ? [path.join(explicitRoot, cleanId, cleanVersion), path.join(explicitRoot, "themes", cleanId, cleanVersion)] : []),
    path.join(process.cwd(), "content", "themes", cleanId, cleanVersion),
    path.join(process.cwd(), "apps", "api", "content", "themes", cleanId, cleanVersion),
    path.join(process.cwd(), "..", "api", "content", "themes", cleanId, cleanVersion),
    path.join(process.cwd(), "..", "..", "content", "themes", cleanId, cleanVersion),
    path.join(process.cwd(), "..", "..", "apps", "api", "content", "themes", cleanId, cleanVersion),
    path.join(process.cwd(), "content", "theme-starter"),
    path.join(process.cwd(), "..", "..", "content", "theme-starter"),
    path.join(process.cwd(), "..", "api", "content", "theme-starter"),
    path.join(process.cwd(), "apps", "api", "content", "theme-starter"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      return p;
    }
  }
  return null;
}

function loadThemeFilesMap(themeDir: string): Map<string, string> {
  const fileMap = new Map<string, string>();

  function walk(dir: string, rel = "") {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(fullPath, relPath);
      } else if (e.isFile()) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          fileMap.set(relPath, content);
        } catch {
          // binary files not read as utf-8 strings
        }
      }
    }
  }

  walk(themeDir);
  return fileMap;
}

function cleanThemeHtml(html: string): string {
  // If template contains full html document, extract body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1]) {
    return bodyMatch[1].trim();
  }
  // Strip doctype and html/head tags if present
  return html
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .trim();
}

export interface RenderThemeOptions {
  themeId: string;
  themeVersion?: string;
  isBuiltIn?: boolean;
  settings: Record<string, unknown>;
  site: ThemeSiteSettings;
}

export async function renderThemeTemplate(
  templateName: "home" | "post" | "page" | "tag" | "author" | "archive" | "404",
  context: ThemeViewModelContext,
  options: RenderThemeOptions,
): Promise<React.ReactElement> {
  const { themeId, themeVersion = "1.0.0", isBuiltIn, settings, site } = options;

  // Built-in theme branch (React components)
  if (isBuiltIn || getTheme(themeId)) {
    const builtinTheme = getTheme(themeId) || getFallbackTheme();
    switch (templateName) {
      case "home":
        return builtinTheme.components.Home({
          posts: (context.posts || []) as any,
          tags: (context.tags || []) as any,
          pagination: {
            page: context.pagination?.page || 1,
            limit: context.pagination?.limit || 10,
            total: context.pagination?.total || 0,
            pages: context.pagination?.pages || 1,
          },
          site,
          settings,
        });
      case "post":
        return builtinTheme.components.Post({
          post: context.post as any,
          site,
          settings,
        });
      case "page":
        return builtinTheme.components.Page({
          page: context.page as any,
          site,
          settings,
        });
      case "tag":
        return builtinTheme.components.TagArchive({
          tag: context.tag as any,
          posts: (context.posts || []) as any,
          pagination: {
            page: context.pagination?.page || 1,
            limit: context.pagination?.limit || 10,
            total: context.pagination?.total || 0,
            pages: context.pagination?.pages || 1,
          },
          site,
          settings,
        });
      case "author":
        return builtinTheme.components.AuthorArchive({
          author: context.author as any,
          posts: (context.posts || []) as any,
          pagination: {
            page: context.pagination?.page || 1,
            limit: context.pagination?.limit || 10,
            total: context.pagination?.total || 0,
            pages: context.pagination?.pages || 1,
          },
          site,
          settings,
        });
      default:
        return builtinTheme.components.Home({
          posts: [],
          tags: [],
          pagination: { page: 1, limit: 10, total: 0, pages: 1 },
          site,
          settings,
        });
    }
  }

  // External Liquid Theme Branch
  const cacheKey = `${themeId}@${themeVersion}`;
  let fileMap: Map<string, string>;

  const cached = themeFilesCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    fileMap = cached.files;
  } else {
    const themeDir = findThemeDirectory(themeId, themeVersion);
    if (themeDir) {
      fileMap = loadThemeFilesMap(themeDir);
    } else {
      fileMap = new Map();
    }
    themeFilesCache.set(cacheKey, { files: fileMap, loadedAt: Date.now() });
  }

  if (fileMap.size === 0) {
    // Fallback to built-in default theme
    const fallbackTheme = getFallbackTheme();
    return fallbackTheme.components.Home({
      posts: [],
      tags: [],
      pagination: { page: 1, limit: 10, total: 0, pages: 1 },
      site,
      settings,
    });
  }

  const engine = createLiquidThemeEngine({
    files: fileMap,
    themeId,
    themeVersion,
  });

  const activeLocale = site.locale || "en";
  const post = (context as any).post;
  const page = (context as any).page;
  const rawPath = post ? `/posts/${post.slug}` : (page ? `/pages/${page.slug}` : "/");
  const enUrl = rawPath;
  const arUrl = rawPath === "/" ? "/ar" : `/ar${rawPath}`;

  const currentLang = activeLocale.split("-")[0] || "en";
  const isEn = activeLocale === "en" || activeLocale === "en-US";
  const isAr = activeLocale.startsWith("ar");

  const defaultLocales: {
    code: string;
    name: string;
    nativeName: string;
    direction: Direction;
    url: string;
    isCurrent: boolean;
  }[] = [
    { code: "en", name: "English", nativeName: "English", direction: "ltr", url: enUrl, isCurrent: isEn },
    { code: "ar-SA", name: "Arabic", nativeName: "العربية", direction: "rtl", url: arUrl, isCurrent: isAr },
  ];

  if (!isEn && !isAr) {
    const locDef = defaultLocaleRegistry.get(activeLocale);
    const locUrl = rawPath === "/" ? `/${currentLang}` : `/${currentLang}${rawPath}`;
    defaultLocales.push({
      code: activeLocale,
      name: locDef?.englishName || activeLocale,
      nativeName: locDef?.nativeName || activeLocale,
      direction: getDirection(activeLocale),
      url: locUrl,
      isCurrent: true,
    });
  }

  const currentUrl = isEn ? enUrl : (isAr ? arUrl : (rawPath === "/" ? `/${currentLang}` : `/${currentLang}${rawPath}`));

  const fullContext: ThemeViewModelContext = {
    ...context,
    site: context.site || mapSiteToViewModel(site),
    settings: { ...settings, ...(context.settings || {}) },
    locale: activeLocale,
    localeContext: context.localeContext || {
      locale: activeLocale,
      language: currentLang,
      direction: getDirection(activeLocale),
      isRTL: isRtl(activeLocale),
      availableLocales: defaultLocales,
      currentUrl,
    },
  };

  const rawHtml = await engine.renderFile(templateName, fullContext);
  const cleanHtml = cleanThemeHtml(rawHtml);

  // Check if theme has a primary stylesheet that should be linked
  let cssHref: string | null = null;
  const cssCandidates = [
    "assets/css/theme.css",
    "assets/theme.css",
    "assets/css/style.css",
    "assets/css/screen.css",
    "assets/css/main.css",
    "theme.css",
    "style.css",
  ];
  for (const candidate of cssCandidates) {
    if (fileMap.has(candidate)) {
      const cacheBuster = process.env.GIT_SHA || Date.now().toString();
      cssHref = `/theme-assets/${themeId}/${themeVersion}/${candidate}?v=${cacheBuster}`;
      break;
    }
  }

  return (
    <div className="vibress-liquid-theme-root" data-theme={themeId}>
      {cssHref && (
        <link rel="stylesheet" href={cssHref} />
      )}
      <div dangerouslySetInnerHTML={{ __html: cleanHtml }} />
    </div>
  );
}
