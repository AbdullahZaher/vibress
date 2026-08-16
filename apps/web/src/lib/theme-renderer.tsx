import React from "react";
import fs from "node:fs";
import path from "node:path";
import {
  createLiquidThemeEngine,
  mapSiteToViewModel,
  ThemeViewModelContext,
} from "@vibress/theme-core";
import { getTheme, getFallbackTheme } from "../themes/registry";
import { ThemeSiteSettings } from "./theme-host";

function findThemeDirectory(themeId: string, version: string): string | null {
  const candidates = [
    path.join(process.cwd(), "content", "themes", themeId, version),
    path.join(process.cwd(), "..", "..", "content", "themes", themeId, version),
    path.join(process.cwd(), "content", "themes", themeId),
    path.join(process.cwd(), "..", "..", "content", "themes", themeId),
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
  const themeDir = findThemeDirectory(themeId, themeVersion);
  if (!themeDir) {
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

  const fileMap = loadThemeFilesMap(themeDir);
  const engine = createLiquidThemeEngine({
    files: fileMap,
    themeId,
    themeVersion,
  });

  const fullContext: ThemeViewModelContext = {
    ...context,
    site: context.site || mapSiteToViewModel(site),
    settings: { ...settings, ...(context.settings || {}) },
  };

  const renderedHtml = await engine.renderFile(templateName, fullContext);

  // Check if theme has an assets/css/theme.css or stylesheet that should be linked
  let cssHref: string | null = null;
  if (fileMap.has("assets/css/theme.css") || fileMap.has("assets/theme.css")) {
    const cssFile = fileMap.has("assets/css/theme.css")
      ? "assets/css/theme.css"
      : "assets/theme.css";
    cssHref = `/theme-assets/${themeId}/${themeVersion}/${cssFile}`;
  }

  return (
    <div className="vibress-liquid-theme-root" data-theme={themeId}>
      {cssHref && !renderedHtml.includes(cssHref) && (
        <link rel="stylesheet" href={cssHref} />
      )}
      <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
    </div>
  );
}
