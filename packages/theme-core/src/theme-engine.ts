import { Liquid, FS } from "liquidjs";
import { routes } from "./route-contract";
import {
  createTranslator,
  formatDate as i18nFormatDate,
  formatHijriDate as i18nFormatHijriDate,
  formatNumber as i18nFormatNumber,
  formatRelativeTime as i18nFormatRelativeTime,
  isRtl as i18nIsRtl,
  getDirection as i18nGetDirection,
  canonicalizeLocale,
  type TranslationDictionary,
} from "@vibress/i18n";

export interface ThemeTemplateFileMap {
  [path: string]: string;
}

export interface ThemeEngineOptions {
  themeId?: string;
  themeVersion?: string;
  files?: ThemeTemplateFileMap | Map<string, string>;
  cache?: boolean;
}

export class MemoryFileSystem implements FS {
  private files: Map<string, string>;

  constructor(files: ThemeTemplateFileMap | Map<string, string> = {}) {
    if (files instanceof Map) {
      this.files = new Map(files);
    } else {
      this.files = new Map(Object.entries(files));
    }
  }

  setFiles(files: ThemeTemplateFileMap | Map<string, string>): void {
    if (files instanceof Map) {
      this.files = new Map(files);
    } else {
      this.files = new Map(Object.entries(files));
    }
  }

  async exists(filepath: string): Promise<boolean> {
    return this.existsSync(filepath);
  }

  existsSync(filepath: string): boolean {
    const normalized = this.normalize(filepath);
    return this.files.has(normalized);
  }

  async readFile(filepath: string): Promise<string> {
    return this.readFileSync(filepath);
  }

  readFileSync(filepath: string): string {
    const normalized = this.normalize(filepath);
    const content = this.files.get(normalized);
    if (content === undefined) {
      throw new Error(`Template file not found in memory fs: ${filepath} (normalized: ${normalized})`);
    }
    return content;
  }

  resolve(root: string, file: string, ext?: string): string {
    let target = file;
    if (ext && !target.endsWith(ext) && !target.includes(".")) {
      target = `${target}${ext}`;
    }

    if (!target.startsWith("/") && root && root !== ".") {
      target = `${root.replace(/\/+$/, "")}/${target.replace(/^\/+/, "")}`;
    }

    const norm = this.normalize(target);
    // If not found in current prefix, try looking in templates/ or partials/
    if (this.files.has(norm)) {
      return norm;
    }
    if (this.files.has(`templates/${norm}`)) {
      return `templates/${norm}`;
    }
    if (this.files.has(`partials/${norm}`)) {
      return `partials/${norm}`;
    }

    return norm;
  }

  private normalize(p: string): string {
    return p.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  }

  dirname(filepath: string): string {
    const normalized = this.normalize(filepath);
    const lastSlash = normalized.lastIndexOf("/");
    return lastSlash === -1 ? "" : normalized.substring(0, lastSlash);
  }

  async contains(root: string, file: string): Promise<boolean> {
    const normalizedRoot = this.normalize(root);
    const normalizedFile = this.normalize(file);
    return normalizedFile.startsWith(normalizedRoot);
  }

  sep = "/";
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim();
}

function flattenDictionary(obj: Record<string, any>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof val === "string") {
      result[fullKey] = val;
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      Object.assign(result, flattenDictionary(val, fullKey));
    }
  }
  return result;
}

/**
 * Extracts and parses theme-level locale JSON files (e.g. locales/en.json, locales/ar.json).
 */
function extractThemeDictionaries(files: Map<string, string> | Record<string, string>): TranslationDictionary {
  const dict: TranslationDictionary = {};
  const entries = files instanceof Map ? Array.from(files.entries()) : Object.entries(files);

  for (const [filepath, content] of entries) {
    const norm = filepath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (norm.startsWith("locales/") && norm.endsWith(".json")) {
      const localeCode = norm.replace(/^locales\//, "").replace(/\.json$/, "");
      try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === "object") {
          const flat = flattenDictionary(parsed);
          const canonical = canonicalizeLocale(localeCode);
          dict[canonical] = flat;
          const lang = canonical.split("-")[0];
          if (lang && !dict[lang]) {
            dict[lang] = flat;
          }
        }
      } catch {
        // Ignore invalid locale JSON
      }
    }
  }

  return dict;
}

export function createLiquidThemeEngine(options: ThemeEngineOptions = {}): Liquid {
  const fileEntries = options.files || {};
  const memFs = new MemoryFileSystem(fileEntries);
  const themeDict = extractThemeDictionaries(fileEntries);
  const translator = createTranslator();

  // Load theme-specific translations into translator
  for (const [loc, dict] of Object.entries(themeDict)) {
    translator.mergeDictionary(loc, dict);
  }

  const liquid = new Liquid({
    fs: memFs,
    root: ["templates", "partials", ""],
    extname: ".liquid",
    cache: options.cache ?? false,
    strictFilters: false,
    strictVariables: false,
    trimTagLeft: false,
    trimTagRight: false,
    trimOutputLeft: false,
    trimOutputRight: false,
    dynamicPartials: true,
  });

  // Helper to extract active locale from liquid execution context
  function getContextLocale(ctx: any): string {
    if (ctx && typeof ctx.get === "function") {
      const loc = ctx.get(["locale"]) || ctx.get(["localeContext", "locale"]) || ctx.get(["site", "locale"]);
      if (typeof loc === "string" && loc.trim()) return loc;
    }
    if (ctx?.context && typeof ctx.context.get === "function") {
      const loc = ctx.context.get(["locale"]) || ctx.context.get(["localeContext", "locale"]) || ctx.context.get(["site", "locale"]);
      if (typeof loc === "string" && loc.trim()) return loc;
    }
    const env = ctx?.context?.environments || ctx?.environments || {};
    if (typeof env.locale === "string") return env.locale;
    if (env.localeContext?.locale) return env.localeContext.locale;
    if (env.site?.locale) return env.site.locale;
    return "en";
  }

  function parseLiquidFilterParams(args: any[]): Record<string, string | number> | undefined {
    if (!args || args.length === 0) return undefined;
    const result: Record<string, string | number> = {};
    for (const arg of args) {
      if (Array.isArray(arg) && arg.length === 2 && typeof arg[0] === "string") {
        result[arg[0]] = arg[1];
      } else if (arg && typeof arg === "object" && !Array.isArray(arg)) {
        Object.assign(result, arg);
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  // Custom filter: t / translate
  liquid.registerFilter("t", function (this: any, key: unknown, ...args: any[]) {
    if (!key || typeof key !== "string") return "";
    const activeLocale = getContextLocale(this);
    const parsedParams = parseLiquidFilterParams(args);
    return translator.translate(key, parsedParams, activeLocale);
  });

  liquid.registerFilter("translate", function (this: any, key: unknown, ...args: any[]) {
    if (!key || typeof key !== "string") return "";
    const activeLocale = getContextLocale(this);
    const parsedParams = parseLiquidFilterParams(args);
    return translator.translate(key, parsedParams, activeLocale);
  });

  // Custom filter: is_rtl
  liquid.registerFilter("is_rtl", function (this: any, locale?: unknown) {
    const targetLocale = typeof locale === "string" && locale.trim() !== ""
      ? locale
      : getContextLocale(this);
    return i18nIsRtl(targetLocale);
  });

  // Custom filter: direction
  liquid.registerFilter("direction", function (this: any, locale?: unknown) {
    const targetLocale = typeof locale === "string" && locale.trim() !== ""
      ? locale
      : getContextLocale(this);
    return i18nGetDirection(targetLocale);
  });

  // Custom filter: asset_url
  liquid.registerFilter("asset_url", function (this: any, input: unknown) {
    if (!input || typeof input !== "string") return "";
    const ctx = this?.context?.environments || {};
    const themeId = options.themeId || ctx.theme?.id || "unknown";
    const themeVersion = options.themeVersion || ctx.theme?.version || "1.0.0";
    return routes.themeAsset(themeId, themeVersion, input);
  });

  // Custom filter: post_url
  liquid.registerFilter("post_url", function (this: any, input: unknown, explicitLocale?: unknown) {
    if (!input || typeof input !== "string") return "/";
    const activeLocale = typeof explicitLocale === "string" ? explicitLocale : getContextLocale(this);
    return routes.post(input, activeLocale);
  });

  // Custom filter: tag_url
  liquid.registerFilter("tag_url", function (this: any, input: unknown, explicitLocale?: unknown) {
    if (!input || typeof input !== "string") return "/";
    const activeLocale = typeof explicitLocale === "string" ? explicitLocale : getContextLocale(this);
    return routes.tag(input, activeLocale);
  });

  // Custom filter: author_url
  liquid.registerFilter("author_url", function (this: any, input: unknown, explicitLocale?: unknown) {
    if (!input || typeof input !== "string") return "/";
    const activeLocale = typeof explicitLocale === "string" ? explicitLocale : getContextLocale(this);
    return routes.author(input, activeLocale);
  });

  // Custom filter: page_url
  liquid.registerFilter("page_url", function (this: any, input: unknown, explicitLocale?: unknown) {
    if (!input || typeof input !== "string") return "/";
    const activeLocale = typeof explicitLocale === "string" ? explicitLocale : getContextLocale(this);
    return routes.page(input, activeLocale);
  });

  // Custom filter: locale_url
  liquid.registerFilter("locale_url", function (this: any, path: unknown, targetLocale: unknown) {
    const loc = typeof targetLocale === "string" ? targetLocale : getContextLocale(this);
    const p = typeof path === "string" ? path : "/";
    if (p === "/" || p === "") {
      return routes.home(loc);
    }
    const clean = p.replace(/^\/+/, "");
    if (clean.startsWith("posts/")) {
      return routes.post(clean.replace(/^posts\//, ""), loc);
    }
    if (clean.startsWith("pages/")) {
      return routes.page(clean.replace(/^pages\//, ""), loc);
    }
    if (clean.startsWith("tags/")) {
      return routes.tag(clean.replace(/^tags\//, ""), loc);
    }
    if (clean.startsWith("authors/")) {
      return routes.author(clean.replace(/^authors\//, ""), loc);
    }
    return loc === "en" || loc === "en-US" ? `/${clean}` : `/${loc.toLowerCase()}/${clean}`;
  });

  // Custom filter: excerpt
  liquid.registerFilter("excerpt", function (input: unknown, length?: number) {
    if (!input || typeof input !== "string") return "";
    const clean = stripHtml(input);
    const max = typeof length === "number" && length > 0 ? length : 160;
    if (clean.length <= max) return clean;
    return `${clean.substring(0, max).trim()}...`;
  });

  // Custom filter: format_date (locale-aware)
  liquid.registerFilter("format_date", function (this: any, input: unknown, formatOrLocale?: string) {
    if (!input) return "";
    let d: Date;
    if (input instanceof Date) {
      d = input;
    } else if (typeof input === "string" || typeof input === "number") {
      d = new Date(input);
    } else {
      return "";
    }
    if (isNaN(d.getTime())) return "";

    const activeLocale = getContextLocale(this);
    const fmt = typeof formatOrLocale === "string" ? formatOrLocale.toLowerCase() : "medium";

    if (fmt === "iso" || fmt === "%y-%m-%d") {
      return d.toISOString().split("T")[0]!;
    }
    if (fmt === "year" || fmt === "%y") {
      return String(d.getFullYear());
    }
    if (fmt === "hijri") {
      return i18nFormatHijriDate(d, activeLocale);
    }

    return i18nFormatDate(d, activeLocale);
  });

  // Custom filter: format_number
  liquid.registerFilter("format_number", function (this: any, input: unknown) {
    const num = Number(input);
    if (isNaN(num)) return "";
    const activeLocale = getContextLocale(this);
    return i18nFormatNumber(num, activeLocale);
  });

  // Custom filter: format_relative_time
  liquid.registerFilter("format_relative_time", function (this: any, input: unknown) {
    if (!input) return "";
    const activeLocale = getContextLocale(this);
    return i18nFormatRelativeTime(input as any, activeLocale);
  });

  // Custom filter: pagination_url
  liquid.registerFilter("pagination_url", function (this: any, pageNumber: unknown) {
    const num = Number(pageNumber);
    const activeLocale = getContextLocale(this);
    if (!num || isNaN(num) || num <= 1) {
      return routes.home(activeLocale);
    }
    const home = routes.home(activeLocale);
    return home === "/" ? `/?page=${num}` : `${home}?page=${num}`;
  });

  // Custom tag: asset
  liquid.registerTag("asset", {
    parse(tagToken) {
      this.path = tagToken.args.trim().replace(/^['"]|['"]$/g, "");
    },
    render(ctx) {
      const themeId = options.themeId || (ctx.get(["theme", "id"]) as string) || "unknown";
      const themeVersion = options.themeVersion || (ctx.get(["theme", "version"]) as string) || "1.0.0";
      return routes.themeAsset(themeId, themeVersion, this.path);
    },
  });

  // Custom tag: route
  liquid.registerTag("route", {
    parse(tagToken) {
      const parts = tagToken.args.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
      this.routeName = parts[0] || "";
      this.param = parts[1] || "";
    },
    render(ctx) {
      const env = ctx.environments || {};
      const activeLocale = env.localeContext?.locale || env.site?.locale || "en";
      const paramVal = this.param ? (ctx.get([this.param]) as string) || this.param : "";
      switch (this.routeName) {
        case "post":
          return routes.post(paramVal, activeLocale);
        case "page":
          return routes.page(paramVal, activeLocale);
        case "tag":
          return routes.tag(paramVal, activeLocale);
        case "author":
          return routes.author(paramVal, activeLocale);
        case "home":
        default:
          return routes.home(activeLocale);
      }
    },
  });

  // Custom tag: t / translate
  liquid.registerTag("t", {
    parse(tagToken) {
      this.key = tagToken.args.trim().replace(/^['"]|['"]$/g, "");
    },
    render(ctx) {
      const env = ctx.environments || {};
      const activeLocale = env.localeContext?.locale || env.site?.locale || "en";
      return translator.translate(this.key, undefined, activeLocale);
    },
  });

  // Custom tag: locale_switcher
  liquid.registerTag("locale_switcher", {
    parse(_tagToken) {},
    render(ctx) {
      const env = ctx.environments || {};
      const availableLocales = env.availableLocales || env.localeContext?.availableLocales || [
        { code: "en", name: "English", nativeName: "English", direction: "ltr", url: "/", isCurrent: true },
        { code: "ar-SA", name: "Arabic", nativeName: "العربية", direction: "rtl", url: "/ar", isCurrent: false },
      ];

      const links = availableLocales.map((loc: any) => {
        const activeClass = loc.isCurrent ? ' class="is-active"' : "";
        const dirAttr = loc.direction ? ` dir="${loc.direction}"` : "";
        return `<a href="${loc.url}"${dirAttr}${activeClass} data-locale="${loc.code}">${loc.nativeName || loc.name}</a>`;
      }).join("\n  ");

      return `<nav class="vb-locale-switcher" aria-label="Language selection">\n  ${links}\n</nav>`;
    },
  });

  // Custom filter: collection_url
  liquid.registerFilter(
    "collection_url",
    function (this: any, modelSlug: unknown, entrySlugOrLocale?: unknown, explicitLocale?: unknown) {
      if (!modelSlug || typeof modelSlug !== "string") return "/";
      const activeLocale = getContextLocale(this);

      if (entrySlugOrLocale && typeof entrySlugOrLocale === "string") {
        // Check if second param is a locale code or entrySlug
        if (entrySlugOrLocale.length <= 5 && (entrySlugOrLocale.includes("-") || entrySlugOrLocale === "en" || entrySlugOrLocale === "ar")) {
          return routes.collection(modelSlug, entrySlugOrLocale);
        }
        const targetLocale = typeof explicitLocale === "string" ? explicitLocale : activeLocale;
        return routes.collectionEntry(modelSlug, entrySlugOrLocale, targetLocale);
      }

      return routes.collection(modelSlug, activeLocale);
    },
  );

  // Custom tag: comments
  liquid.registerTag("comments", {
    parse(tagToken) {
      const args = tagToken.args.trim();
      if (args) {
        const match = args.match(/post:\s*([^\s,]+)/);
        this.postVar = match ? match[1] : (args.startsWith("post") ? "post" : args);
      } else {
        this.postVar = "post";
      }
    },
    render(ctx) {
      const post = (this.postVar ? ctx.get([this.postVar]) : ctx.get(["post"])) || ctx.environments?.post;
      const site = ctx.get(["site"]) || ctx.environments?.site;

      if (!post || !post.id) {
        return "";
      }

      const commentAccess = site?.comments?.commentAccess || site?.commentAccess || "public";
      if (commentAccess === "disabled" || site?.commentsEnabled === false) {
        return "";
      }

      const postId = String(post.id).replace(/"/g, "&quot;");
      const postSlug = String(post.slug || "").replace(/"/g, "&quot;");
      const count = Number(post.commentCount ?? post.comment_count) || 0;
      const accessAttr = String(commentAccess).replace(/"/g, "&quot;");

      return `<section class="vb-comments-section" id="comments-container" aria-label="Comments">
  <div 
    class="vb-comments-mount"
    id="vb-comments-root"
    data-post-id="${postId}"
    data-post-slug="${postSlug}"
    data-comment-count="${count}"
    data-access="${accessAttr}"
  >
    <noscript>
      <p class="vb-comments-noscript">Please enable JavaScript to view and post comments.</p>
    </noscript>
  </div>
</section>`;
    },
  });

  // Custom tag: collection (exposes structured custom collection entries to template scope)
  liquid.registerTag("collection", {
    parse(tagToken) {
      const raw = tagToken.args.trim();
      // e.g. "products", limit: 6 as items  OR  "books" as items
      const asMatch = raw.match(/\s+as\s+([a-zA-Z0-9_]+)$/);
      this.targetVar = asMatch ? asMatch[1] : "items";
      const beforeAs = asMatch ? raw.substring(0, asMatch.index).trim() : raw;

      const limitMatch = beforeAs.match(/limit:\s*([0-9]+)/);
      this.limit = limitMatch ? parseInt(limitMatch[1]!, 10) : undefined;

      const modelMatch = beforeAs.match(/^['"]?([a-zA-Z0-9_-]+)['"]?/);
      this.modelSlug = modelMatch ? modelMatch[1] : "";
    },
    render(ctx, emitter) {
      const env = ctx.environments || {};
      const collections = env.collections || (ctx.get(["collections"]) as Record<string, any[]>) || {};
      let items = collections[this.modelSlug] || [];

      if (!Array.isArray(items) && env.collection?.entries && env.collection?.model?.slug === this.modelSlug) {
        items = env.collection.entries;
      }

      if (Array.isArray(items) && this.limit && this.limit > 0) {
        items = items.slice(0, this.limit);
      }

      // Expose to current context scope
      ctx.environments[this.targetVar] = items;
      return "";
    },
  });

  return liquid;
}

