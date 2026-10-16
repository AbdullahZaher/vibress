import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BODY_LIMIT_BYTES,
  DOCUMENT_CONTENT_BODY_LIMIT_BYTES,
  IMPORT_EXPORT_BODY_LIMIT_BYTES,
  MEDIA_UPLOAD_BODY_LIMIT_BYTES,
  THEME_UPLOAD_BODY_LIMIT_BYTES,
} from "../../apps/api/src/constants/limits";

interface NginxLocationRule {
  type: "exact" | "regex" | "prefix";
  pattern: string | RegExp;
  clientMaxBodySizeBytes: number;
}

interface ParsedNginxConfig {
  globalClientMaxBodySizeBytes: number;
  locations: NginxLocationRule[];
}

function parseSizeToBytes(sizeStr: string): number {
  const match = sizeStr.trim().toLowerCase().match(/^(\d+)([kmg]?)$/);
  if (!match) {
    throw new Error(`Cannot parse size string: "${sizeStr}"`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "g":
      return value * 1024 * 1024 * 1024;
    case "m":
      return value * 1024 * 1024;
    case "k":
      return value * 1024;
    default:
      return value;
  }
}

function parseNginxLocations(filePath: string): ParsedNginxConfig {
  const content = fs.readFileSync(filePath, "utf-8");

  // Global default
  const globalMatch = content.match(/client_max_body_size\s+([^;]+);/);
  const globalClientMaxBodySizeBytes = globalMatch
    ? parseSizeToBytes(globalMatch[1])
    : parseSizeToBytes("1m");

  const locations: NginxLocationRule[] = [];

  // Match location blocks: location [modifier] [pattern] { [body] }
  // Handles:
  //   location = /path { ... }
  //   location ~ pattern { ... }
  //   location /path/ { ... }
  const locationRegex = /location\s+(=|~|\^~)?\s*([^{]+)\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = locationRegex.exec(content)) !== null) {
    const modifier = (match[1] || "").trim();
    const rawPattern = match[2].trim();
    const body = match[3];

    const bodySizeMatch = body.match(/client_max_body_size\s+([^;]+);/);
    const clientMaxBodySizeBytes = bodySizeMatch
      ? parseSizeToBytes(bodySizeMatch[1])
      : globalClientMaxBodySizeBytes;

    if (modifier === "=") {
      locations.push({
        type: "exact",
        pattern: rawPattern,
        clientMaxBodySizeBytes,
      });
    } else if (modifier === "~") {
      locations.push({
        type: "regex",
        pattern: new RegExp(rawPattern),
        clientMaxBodySizeBytes,
      });
    } else {
      locations.push({
        type: "prefix",
        pattern: rawPattern,
        clientMaxBodySizeBytes,
      });
    }
  }

  return {
    globalClientMaxBodySizeBytes,
    locations,
  };
}

function resolveNginxMaxBodySize(
  urlPath: string,
  config: ParsedNginxConfig,
): number {
  // 1. Exact match (=)
  for (const loc of config.locations) {
    if (loc.type === "exact" && loc.pattern === urlPath) {
      return loc.clientMaxBodySizeBytes;
    }
  }

  // 2. Regex match (~) in order of declaration
  for (const loc of config.locations) {
    if (loc.type === "regex" && (loc.pattern as RegExp).test(urlPath)) {
      return loc.clientMaxBodySizeBytes;
    }
  }

  // 3. Longest matching prefix
  let longestPrefixMatch: NginxLocationRule | null = null;
  for (const loc of config.locations) {
    if (loc.type === "prefix") {
      const prefix = loc.pattern as string;
      if (urlPath.startsWith(prefix)) {
        if (!longestPrefixMatch || prefix.length > (longestPrefixMatch.pattern as string).length) {
          longestPrefixMatch = loc;
        }
      }
    }
  }

  if (longestPrefixMatch) {
    return longestPrefixMatch.clientMaxBodySizeBytes;
  }

  return config.globalClientMaxBodySizeBytes;
}

describe("Gateway Nginx & Fastify Body Limit Drift Verification", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const nginxDevPath = path.join(rootDir, "infrastructure/nginx/nginx.conf");
  const nginxProdPath = path.join(rootDir, "infrastructure/nginx/nginx.prod.conf");

  const highLimitRoutes: Array<{
    description: string;
    sampleUrl: string;
    expectedApiLimitBytes: number;
  }> = [
    {
      description: "Media upload endpoint",
      sampleUrl: "/api/admin/v1/media",
      expectedApiLimitBytes: MEDIA_UPLOAD_BODY_LIMIT_BYTES, // 500MB
    },
    {
      description: "Theme package upload endpoint",
      sampleUrl: "/api/admin/v1/themes/upload",
      expectedApiLimitBytes: THEME_UPLOAD_BODY_LIMIT_BYTES, // 50MB
    },
    {
      description: "Site content import validate endpoint",
      sampleUrl: "/api/admin/v1/imports/validate",
      expectedApiLimitBytes: IMPORT_EXPORT_BODY_LIMIT_BYTES, // 50MB
    },
    {
      description: "Site content import execute endpoint",
      sampleUrl: "/api/admin/v1/imports",
      expectedApiLimitBytes: IMPORT_EXPORT_BODY_LIMIT_BYTES, // 50MB
    },
    {
      description: "Posts create endpoint",
      sampleUrl: "/api/admin/v1/posts",
      expectedApiLimitBytes: DOCUMENT_CONTENT_BODY_LIMIT_BYTES, // 10MB
    },
    {
      description: "Posts update endpoint",
      sampleUrl: "/api/admin/v1/posts/550e8400-e29b-41d4-a716-446655440000",
      expectedApiLimitBytes: DOCUMENT_CONTENT_BODY_LIMIT_BYTES, // 10MB
    },
    {
      description: "Pages create endpoint",
      sampleUrl: "/api/admin/v1/pages",
      expectedApiLimitBytes: DOCUMENT_CONTENT_BODY_LIMIT_BYTES, // 10MB
    },
    {
      description: "Pages update endpoint",
      sampleUrl: "/api/admin/v1/pages/550e8400-e29b-41d4-a716-446655440000",
      expectedApiLimitBytes: DOCUMENT_CONTENT_BODY_LIMIT_BYTES, // 10MB
    },
    {
      description: "Newsletters create endpoint",
      sampleUrl: "/api/admin/v1/newsletters",
      expectedApiLimitBytes: DOCUMENT_CONTENT_BODY_LIMIT_BYTES, // 10MB
    },
    {
      description: "Newsletters update endpoint",
      sampleUrl: "/api/admin/v1/newsletters/550e8400-e29b-41d4-a716-446655440000",
      expectedApiLimitBytes: DOCUMENT_CONTENT_BODY_LIMIT_BYTES, // 10MB
    },
    {
      description: "Translations create endpoint",
      sampleUrl: "/api/admin/v1/translations",
      expectedApiLimitBytes: DOCUMENT_CONTENT_BODY_LIMIT_BYTES, // 10MB
    },
    {
      description: "Translations update endpoint",
      sampleUrl: "/api/admin/v1/translations/550e8400-e29b-41d4-a716-446655440000",
      expectedApiLimitBytes: DOCUMENT_CONTENT_BODY_LIMIT_BYTES, // 10MB
    },
    {
      description: "Translations bulk export endpoint",
      sampleUrl: "/api/admin/v1/translations/bulk-export",
      expectedApiLimitBytes: DOCUMENT_CONTENT_BODY_LIMIT_BYTES, // 10MB
    },
    {
      description: "Content model collection entries create endpoint",
      sampleUrl: "/api/admin/v1/content-models/articles/entries",
      expectedApiLimitBytes: DOCUMENT_CONTENT_BODY_LIMIT_BYTES, // 10MB
    },
    {
      description: "Content model collection entries update endpoint",
      sampleUrl: "/api/admin/v1/content-models/articles/entries/entry-12345",
      expectedApiLimitBytes: DOCUMENT_CONTENT_BODY_LIMIT_BYTES, // 10MB
    },
  ];

  for (const configPath of [nginxDevPath, nginxProdPath]) {
    const configName = path.basename(configPath);

    describe(`Nginx configuration: ${configName}`, () => {
      const parsed = parseNginxLocations(configPath);

      it("has a small global client_max_body_size (<= 2MB)", () => {
        expect(parsed.globalClientMaxBodySizeBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
      });

      it("ensures default API endpoints fall through to small body limit", () => {
        const loginMax = resolveNginxMaxBodySize("/api/admin/v1/auth/login", parsed);
        expect(loginMax).toBe(parsed.globalClientMaxBodySizeBytes);
        expect(loginMax).toBeLessThanOrEqual(2 * 1024 * 1024);

        const setupMax = resolveNginxMaxBodySize("/api/setup/v1/complete", parsed);
        expect(setupMax).toBe(parsed.globalClientMaxBodySizeBytes);
      });

      for (const route of highLimitRoutes) {
        it(`guarantees Nginx allows at least API limit for ${route.description} (${route.sampleUrl})`, () => {
          const nginxAllowedBytes = resolveNginxMaxBodySize(route.sampleUrl, parsed);
          expect(nginxAllowedBytes).toBeGreaterThanOrEqual(route.expectedApiLimitBytes);
        });
      }
    });
  }
});
