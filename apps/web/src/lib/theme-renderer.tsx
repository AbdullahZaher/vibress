import React from "react";
import fs from "node:fs";
import path from "node:path";
import {
  createLiquidThemeEngine,
  mapSiteToViewModel,
  ThemeViewModelContext,
} from "@vibress/theme-core";
import { getDirection, isRtl, getLocalePrefix, defaultLocaleRegistry, type Direction } from "@vibress/i18n";
import { publishedAlternateLanguageUrls, getPublicSiteUrl } from "./seo-helpers";
import { getTheme, getFallbackTheme } from "../themes/registry";
import { ThemeSiteSettings } from "./theme-host";
import { LiquidCommentsHydrator } from "../components/comments/LiquidCommentsHydrator";

const themeFilesCache = new Map<string, { files: Map<string, string>; loadedAt: number }>();
const CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 60 * 1000 : 0;

function findThemeDirectory(
  themeId: string,
  version: string,
  publicationId = "pub_default",
  legacyStorage = false,
): string | null {
  if (
    !themeId ||
    !/^[a-z0-9-]{1,64}$/.test(themeId) ||
    !version ||
    !/^\d+(\.\d+)*(-[a-zA-Z0-9.]+)?$/.test(version) ||
    version.includes("..") ||
    !publicationId ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(publicationId) ||
    publicationId === ".." ||
    publicationId === "."
  ) {
    return null;
  }

  const cleanId = themeId;
  const cleanVersion = version;
  const cleanPublicationId = publicationId;

  const explicitRoot = process.env.THEME_STORAGE_ROOT || process.env.CONTENT_DIR;

  const scopedRoots =
    publicationId === "pub_default"
      ? []
      : [
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
        ];

  // Legacy global roots remain read-only fallbacks for pre-isolation installs.
  const legacyRoots = [
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
    path.join(process.cwd(), "content", "theme-starter"),
    path.join(process.cwd(), "..", "..", "content", "theme-starter"),
    path.join(process.cwd(), "..", "api", "content", "theme-starter"),
    path.join(process.cwd(), "apps", "api", "content", "theme-starter"),
  ];

  // Never read global legacy templates without an authoritative installed-
  // theme reference for this publication. Keep the default publication path.
  const allowedLegacyRoots = publicationId === "pub_default" || legacyStorage
    ? legacyRoots
    : [];
  for (const candidate of [...scopedRoots, ...allowedLegacyRoots]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
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

import { DefaultCollectionView, DefaultCollectionEntryView } from "../components/collections/DefaultCollectionViews";

export interface RenderThemeOptions {
  themeId: string;
  themeVersion?: string;
  isBuiltIn?: boolean;
  settings: Record<string, unknown>;
  site: ThemeSiteSettings;
}

export async function renderThemeTemplate(
  templateName:
    | "home"
    | "post"
    | "page"
    | "tag"
    | "author"
    | "archive"
    | "404"
    | "collection"
    | "collection-entry",
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
      case "collection":
        return (
          <DefaultCollectionView
            model={context.collection?.model || { name: "Collection", slug: "" }}
            entries={context.collection?.entries || []}
            site={context.site || mapSiteToViewModel(site)}
            settings={settings}
            pagination={
              context.pagination
                ? {
                    limit: context.pagination.limit,
                    offset: 0,
                    count: context.collection?.entries?.length || 0,
                  }
                : undefined
            }
          />
        );
      case "collection-entry":
        return (
          <DefaultCollectionEntryView
            model={context.collection?.model || { name: "Collection", slug: "" }}
            entry={context.collection?.entry as any}
            site={context.site || mapSiteToViewModel(site)}
            settings={settings}
          />
        );
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
  const publicationId = site.publicationId;
  const cacheKey = `${publicationId || "unresolved"}:${themeId}@${themeVersion}`;
  let fileMap: Map<string, string>;

  const cached = themeFilesCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    fileMap = cached.files;
  } else {
    const themeDir = publicationId
      ? findThemeDirectory(
          themeId,
          themeVersion,
          publicationId,
          site.legacyThemeStorage === true &&
            site.legacyThemeId === themeId &&
            site.legacyThemeVersion === themeVersion,
        )
      : null;
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
  const primaryLocale = site.primaryLocale || activeLocale;
  const enabledLocales = site.enabledLocales?.length
    ? site.enabledLocales : [primaryLocale];
  const sourcePost = (context as { post?: { slug?: string } }).post;
  const sourcePage = (context as { page?: { slug?: string } }).page;
  const isContent = Boolean(sourcePost?.slug || sourcePage?.slug);
  const pathPart = sourcePost?.slug
    ? `/posts/${encodeURIComponent(sourcePost.slug)}`
    : sourcePage?.slug ? `/pages/${encodeURIComponent(sourcePage.slug)}` : "/";
  const primaryPrefix = getLocalePrefix(activeLocale, primaryLocale, enabledLocales);
  const currentUrl = `${primaryPrefix}${pathPart === "/" ? "" : pathPart}` || "/";

  // A switcher must never offer an unpublished or disabled translation.
  // Homepage variants may be linked directly; content items must be
  // confirmed by the publication-scoped public API.
  const published = isContent
    ? await publishedAlternateLanguageUrls(
      sourcePost?.slug ? "post" : "page", sourcePost?.slug || sourcePage?.slug || "",
      activeLocale,
    )
    : {};
  const siteUrl = getPublicSiteUrl();
  const available = enabledLocales.flatMap((code) => {
    let url: string | undefined;
    if (isContent) {
      const absolute = published[code];
      url = absolute?.startsWith(siteUrl) ? absolute.slice(siteUrl.length) || "/" : undefined;
    } else if (pathPart === "/") {
      url = getLocalePrefix(code, primaryLocale, enabledLocales) || "/";
    }
    if (!url) return [];
    const def = defaultLocaleRegistry.get(code);
    return [{
      code,
      name: def?.englishName || code,
      nativeName: def?.nativeName || code,
      direction: getDirection(code),
      url,
      isCurrent: code === activeLocale,
    }];
  });
  const currentLang = activeLocale.split("-")[0] || activeLocale;

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
      availableLocales: available,
      currentUrl,
    },
  };

  try {
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
        {templateName === "post" && context.post && (
          <LiquidCommentsHydrator
            postId={context.post.id}
            postSlug={context.post.slug}
            initialCount={context.post.commentCount ?? context.post.comment_count}
            commentsEnabled={site.commentsEnabled !== false}
            commentAccess={(site.comments?.commentAccess || (site as any).commentAccess || "public") as any}
            locale={activeLocale}
          />
        )}
      </div>
    );
  } catch (renderErr) {
    if (templateName === "collection") {
      return (
        <DefaultCollectionView
          model={context.collection?.model || { name: "Collection", slug: "" }}
          entries={context.collection?.entries || []}
          site={context.site || mapSiteToViewModel(site)}
          settings={settings}
          pagination={
            context.pagination
              ? {
                  limit: context.pagination.limit,
                  offset: 0,
                  count: context.collection?.entries?.length || 0,
                }
              : undefined
          }
        />
      );
    } else if (templateName === "collection-entry" && context.collection?.entry) {
      return (
        <DefaultCollectionEntryView
          model={context.collection?.model || { name: "Collection", slug: "" }}
          entry={context.collection.entry}
          site={context.site || mapSiteToViewModel(site)}
          settings={settings}
        />
      );
    }
    throw renderErr;
  }
}
