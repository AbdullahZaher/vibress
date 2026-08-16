import { Liquid, FS } from "liquidjs";
import { routes } from "./route-contract";

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

export function createLiquidThemeEngine(options: ThemeEngineOptions = {}): Liquid {
  const memFs = new MemoryFileSystem(options.files || {});

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

  // Custom filter: asset_url
  liquid.registerFilter("asset_url", function (this: any, input: unknown) {
    if (!input || typeof input !== "string") return "";
    const ctx = this?.context?.environments || {};
    const themeId = options.themeId || ctx.theme?.id || "unknown";
    const themeVersion = options.themeVersion || ctx.theme?.version || "1.0.0";
    return routes.themeAsset(themeId, themeVersion, input);
  });

  // Custom filter: post_url
  liquid.registerFilter("post_url", function (input: unknown) {
    if (!input || typeof input !== "string") return "/";
    return routes.post(input);
  });

  // Custom filter: tag_url
  liquid.registerFilter("tag_url", function (input: unknown) {
    if (!input || typeof input !== "string") return "/";
    return routes.tag(input);
  });

  // Custom filter: author_url
  liquid.registerFilter("author_url", function (input: unknown) {
    if (!input || typeof input !== "string") return "/";
    return routes.author(input);
  });

  // Custom filter: page_url
  liquid.registerFilter("page_url", function (input: unknown) {
    if (!input || typeof input !== "string") return "/";
    return routes.page(input);
  });

  // Custom filter: excerpt
  liquid.registerFilter("excerpt", function (input: unknown, length?: number) {
    if (!input || typeof input !== "string") return "";
    const clean = stripHtml(input);
    const max = typeof length === "number" && length > 0 ? length : 160;
    if (clean.length <= max) return clean;
    return `${clean.substring(0, max).trim()}...`;
  });

  // Custom filter: format_date
  liquid.registerFilter("format_date", function (input: unknown, format?: string) {
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

    const fmt = typeof format === "string" ? format.toLowerCase() : "medium";
    if (fmt === "iso" || fmt === "%y-%m-%d") {
      return d.toISOString().split("T")[0]!;
    }
    if (fmt === "year" || fmt === "%y") {
      return String(d.getFullYear());
    }
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  });

  // Custom filter: pagination_url
  liquid.registerFilter("pagination_url", function (pageNumber: unknown) {
    const num = Number(pageNumber);
    if (!num || isNaN(num) || num <= 1) {
      return routes.home();
    }
    return `/?page=${num}`;
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
      const paramVal = this.param ? (ctx.get([this.param]) as string) || this.param : "";
      switch (this.routeName) {
        case "post":
          return routes.post(paramVal);
        case "page":
          return routes.page(paramVal);
        case "tag":
          return routes.tag(paramVal);
        case "author":
          return routes.author(paramVal);
        case "home":
        default:
          return routes.home();
      }
    },
  });

  return liquid;
}
