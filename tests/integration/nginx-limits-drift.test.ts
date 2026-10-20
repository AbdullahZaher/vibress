import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import {
  DEFAULT_BODY_LIMIT_BYTES,
  DOCUMENT_CONTENT_BODY_LIMIT_BYTES,
  IMPORT_EXPORT_BODY_LIMIT_BYTES,
  MEDIA_UPLOAD_BODY_LIMIT_BYTES,
  THEME_UPLOAD_BODY_LIMIT_BYTES,
} from "../../apps/api/src/constants/limits";

export interface NginxLocationRule {
  type: "exact" | "preferential_prefix" | "regex" | "prefix";
  rawPattern: string;
  regexPattern?: RegExp;
  clientMaxBodySizeBytes: number;
}

export interface ParsedNginxConfig {
  globalClientMaxBodySizeBytes: number;
  locations: NginxLocationRule[];
}

export interface DerivedRouteLimit {
  file: string;
  plugin: string;
  method: string;
  rawPath: string;
  fullRoute: string;
  sampleUrl: string;
  bodyLimitBytes: number;
  bodyLimitIdentifier: string;
}

export function parseSizeToBytes(sizeStr: string): number {
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

export function parseNginxLocations(filePath: string): ParsedNginxConfig {
  const content = fs.readFileSync(filePath, "utf-8");

  // Global default
  const globalMatch = content.match(/client_max_body_size\s+([^;]+);/);
  const globalClientMaxBodySizeBytes = globalMatch
    ? parseSizeToBytes(globalMatch[1])
    : parseSizeToBytes("1m");

  const locations: NginxLocationRule[] = [];

  // Match location blocks: location [modifier] [pattern] { [body] }
  // Supports:
  //   location = /path { ... }
  //   location ^~ /path { ... }
  //   location ~ pattern { ... }
  //   location ~* pattern { ... }
  //   location /path/ { ... }
  const locationRegex = /location\s+(=|\^~|~\*|~)?\s*([^{]+)\{([^}]+)\}/g;
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
        rawPattern,
        clientMaxBodySizeBytes,
      });
    } else if (modifier === "^~") {
      locations.push({
        type: "preferential_prefix",
        rawPattern,
        clientMaxBodySizeBytes,
      });
    } else if (modifier === "~" || modifier === "~*") {
      locations.push({
        type: "regex",
        rawPattern,
        regexPattern: new RegExp(rawPattern, modifier === "~*" ? "i" : ""),
        clientMaxBodySizeBytes,
      });
    } else {
      locations.push({
        type: "prefix",
        rawPattern,
        clientMaxBodySizeBytes,
      });
    }
  }

  return {
    globalClientMaxBodySizeBytes,
    locations,
  };
}

/**
 * Resolves the client_max_body_size for urlPath following standard Nginx precedence:
 * 1. Exact match (= /path) -> terminates search immediately.
 * 2. Search all prefix locations: if longest matching prefix has ^~, terminates search.
 * 3. Regular expressions (~ or ~*) in sequential order -> first match terminates search.
 * 4. Fallback to longest matching standard prefix.
 * 5. Fallback to server-level default.
 */
export function resolveNginxMaxBodySize(
  urlPath: string,
  config: ParsedNginxConfig,
): { limit: number; matchedRule: string } {
  // 1. Exact match (=)
  for (const loc of config.locations) {
    if (loc.type === "exact" && loc.rawPattern === urlPath) {
      return { limit: loc.clientMaxBodySizeBytes, matchedRule: `= ${loc.rawPattern}` };
    }
  }

  // 2. Search all prefix locations for the longest match
  let longestPrefix: NginxLocationRule | null = null;
  for (const loc of config.locations) {
    if (loc.type === "prefix" || loc.type === "preferential_prefix") {
      if (urlPath.startsWith(loc.rawPattern)) {
        if (!longestPrefix || loc.rawPattern.length > longestPrefix.rawPattern.length) {
          longestPrefix = loc;
        }
      }
    }
  }

  // If the longest prefix match is marked with ^~, regex matching is skipped
  if (longestPrefix && longestPrefix.type === "preferential_prefix") {
    return {
      limit: longestPrefix.clientMaxBodySizeBytes,
      matchedRule: `^~ ${longestPrefix.rawPattern}`,
    };
  }

  // 3. Regular expression match (~ or ~*) in sequential order of declaration
  for (const loc of config.locations) {
    if (loc.type === "regex" && loc.regexPattern && loc.regexPattern.test(urlPath)) {
      return {
        limit: loc.clientMaxBodySizeBytes,
        matchedRule: `~ ${loc.rawPattern}`,
      };
    }
  }

  // 4. Fallback to longest matching standard prefix
  if (longestPrefix) {
    return {
      limit: longestPrefix.clientMaxBodySizeBytes,
      matchedRule: `prefix ${longestPrefix.rawPattern}`,
    };
  }

  // 5. Server default
  return {
    limit: config.globalClientMaxBodySizeBytes,
    matchedRule: "server default",
  };
}

/**
 * Dynamically derives all routes in apps/api/src/routes/*.ts that define a route-level bodyLimit.
 * Resolves the registration prefix from apps/api/src/main.ts and the byte limit from constants/limits.ts.
 */
export function deriveRoutesFromSource(rootDir: string): DerivedRouteLimit[] {
  const knownLimits: Record<string, number> = {
    DEFAULT_BODY_LIMIT_BYTES,
    DOCUMENT_CONTENT_BODY_LIMIT_BYTES,
    IMPORT_EXPORT_BODY_LIMIT_BYTES,
    MEDIA_UPLOAD_BODY_LIMIT_BYTES,
    THEME_UPLOAD_BODY_LIMIT_BYTES,
  };

  const mainPath = path.join(rootDir, "apps/api/src/main.ts");
  if (!fs.existsSync(mainPath)) {
    throw new Error(`Cannot locate main.ts at ${mainPath}`);
  }
  const mainSource = fs.readFileSync(mainPath, "utf-8");
  const mainAst = ts.createSourceFile(mainPath, mainSource, ts.ScriptTarget.Latest, true);

  // Map plugin function name to its registered prefix
  const pluginPrefixMap = new Map<string, string>();
  function findRegistrations(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isPropertyAccessExpression(expr) && expr.name.text === "register") {
        const args = node.arguments;
        if (args.length >= 1 && ts.isIdentifier(args[0])) {
          const pluginName = args[0].text;
          let prefix = "";
          if (args.length >= 2 && ts.isObjectLiteralExpression(args[1])) {
            for (const prop of args[1].properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                prop.name.text === "prefix" &&
                ts.isStringLiteral(prop.initializer)
              ) {
                prefix = prop.initializer.text;
              }
            }
          }
          pluginPrefixMap.set(pluginName, prefix);
        }
      }
    }
    ts.forEachChild(node, findRegistrations);
  }
  findRegistrations(mainAst);

  const routesDir = path.join(rootDir, "apps/api/src/routes");
  const routeFiles = fs.readdirSync(routesDir).filter((f) => f.endsWith(".ts"));
  const derivedRoutes: DerivedRouteLimit[] = [];

  for (const file of routeFiles) {
    const filePath = path.join(routesDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    if (!content.includes("bodyLimit")) continue;

    const ast = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

    function walk(node: ts.Node, currentPluginName: string | null) {
      let activePlugin = currentPluginName;
      if (ts.isFunctionDeclaration(node) && node.name) {
        activePlugin = node.name.text;
      }

      if (ts.isCallExpression(node)) {
        const expr = node.expression;
        if (ts.isPropertyAccessExpression(expr)) {
          const method = expr.name.text.toLowerCase();
          const httpMethods = ["get", "post", "put", "patch", "delete", "options", "head"];
          if (httpMethods.includes(method)) {
            const args = node.arguments;
            if (
              args.length >= 2 &&
              ts.isStringLiteral(args[0]) &&
              ts.isObjectLiteralExpression(args[1])
            ) {
              const routePath = args[0].text;
              let bodyLimitVal: number | null = null;
              let bodyLimitIdentifier: string | null = null;

              for (const prop of args[1].properties) {
                if (ts.isPropertyAssignment(prop) && prop.name.text === "bodyLimit") {
                  if (ts.isIdentifier(prop.initializer)) {
                    bodyLimitIdentifier = prop.initializer.text;
                    const val = knownLimits[bodyLimitIdentifier];
                    if (val === undefined) {
                      throw new Error(
                        `Unknown bodyLimit constant "${bodyLimitIdentifier}" in ${file} at route ${routePath}`,
                      );
                    }
                    bodyLimitVal = val;
                  } else if (ts.isNumericLiteral(prop.initializer)) {
                    bodyLimitIdentifier = prop.initializer.text;
                    bodyLimitVal = Number(prop.initializer.text);
                  } else {
                    throw new Error(
                      `Unsupported bodyLimit expression in ${file} at route ${routePath}`,
                    );
                  }
                }
              }

              if (bodyLimitVal !== null) {
                if (!activePlugin) {
                  throw new Error(
                    `Found bodyLimit route ${method.toUpperCase()} ${routePath} outside a named function in ${file}`,
                  );
                }
                const prefix = pluginPrefixMap.get(activePlugin);
                if (prefix === undefined) {
                  throw new Error(
                    `Plugin function "${activePlugin}" in ${file} is not registered in main.ts`,
                  );
                }

                const fullRoute = `${prefix}${routePath}`;
                // Replace path parameters with concrete sample values
                const sampleUrl = fullRoute
                  .replace(/:type\b/g, "posts")
                  .replace(/:modelSlug\b/g, "articles")
                  .replace(/:entryId\b/g, "entry-123")
                  .replace(/:id\b/g, "sample-id")
                  .replace(/:([a-zA-Z0-9_]+)\b/g, "sample-$1");

                derivedRoutes.push({
                  file,
                  plugin: activePlugin,
                  method: method.toUpperCase(),
                  rawPath: routePath,
                  fullRoute,
                  sampleUrl,
                  bodyLimitBytes: bodyLimitVal,
                  bodyLimitIdentifier: bodyLimitIdentifier ?? "CUSTOM",
                });
              }
            }
          }
        }
      }

      ts.forEachChild(node, (child) => walk(child, activePlugin));
    }

    walk(ast, null);
  }

  if (derivedRoutes.length === 0) {
    throw new Error("Failed to derive any bodyLimit routes from source");
  }

  return derivedRoutes;
}

describe("Gateway Nginx & Fastify Body Limit Drift Verification (Dynamic Source Scanner)", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const nginxDevPath = path.join(rootDir, "infrastructure/nginx/nginx.conf");
  const nginxProdPath = path.join(rootDir, "infrastructure/nginx/nginx.prod.conf");

  // Dynamically derive routes from TypeScript source files
  const derivedRoutes = deriveRoutesFromSource(rootDir);

  it("dynamically discovered routes with bodyLimit from source files", () => {
    expect(derivedRoutes.length).toBeGreaterThanOrEqual(15);
  });

  for (const configPath of [nginxDevPath, nginxProdPath]) {
    const configName = path.basename(configPath);

    describe(`Nginx configuration: ${configName}`, () => {
      const parsed = parseNginxLocations(configPath);

      it("routes collaboration upgrades before the document body-limit regex", () => {
        const raw = fs.readFileSync(configPath, "utf8");
        const route = raw.match(
          /location ~ \^\/api\/admin\/v1\/posts\/\[\^\/\]\+\/collaboration\/ws\$ \{([^}]+)\}/,
        );
        expect(route, "Dedicated post collaboration WebSocket location missing").not.toBeNull();
        const locationBody = route?.[1] ?? "";
        expect(locationBody).toContain("proxy_http_version 1.1;");
        expect(locationBody).toContain("proxy_set_header Upgrade $http_upgrade;");
        expect(locationBody).toContain('proxy_set_header Connection "upgrade";');
        expect(raw.indexOf(route?.[0] ?? "NOT_PRESENT")).toBeLessThan(
          raw.indexOf("location ~ ^/api/admin/v1/(posts|pages|"),
        );
        const wsPath = "/api/admin/v1/posts/123/collaboration/ws";
        expect(resolveNginxMaxBodySize(wsPath, parsed).matchedRule)
          .toBe("~ ^/api/admin/v1/posts/[^/]+/collaboration/ws$");
        expect(resolveNginxMaxBodySize(wsPath, parsed).limit).toBe(10 * 1024 * 1024);
      });

      it("has a small global client_max_body_size (<= 2MB)", () => {
        expect(parsed.globalClientMaxBodySizeBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
      });

      it("ensures default API endpoints fall through to small body limit", () => {
        const loginMax = resolveNginxMaxBodySize("/api/admin/v1/auth/login", parsed);
        expect(loginMax.limit).toBe(parsed.globalClientMaxBodySizeBytes);
        expect(loginMax.limit).toBeLessThanOrEqual(2 * 1024 * 1024);

        const setupMax = resolveNginxMaxBodySize("/api/setup/v1/complete", parsed);
        expect(setupMax.limit).toBe(parsed.globalClientMaxBodySizeBytes);
      });

      for (const route of derivedRoutes) {
        it(`guarantees Nginx allows >= Fastify bodyLimit for [${route.method}] ${route.sampleUrl} (${route.bodyLimitIdentifier}: ${route.bodyLimitBytes}B)`, () => {
          const res = resolveNginxMaxBodySize(route.sampleUrl, parsed);
          expect(
            res.limit,
            `Route ${route.method} ${route.sampleUrl} requires ${route.bodyLimitBytes} bytes but Nginx only allows ${res.limit} bytes (matched: ${res.matchedRule})`,
          ).toBeGreaterThanOrEqual(route.bodyLimitBytes);
        });
      }

      it("flags a route whose nginx location is missing or insufficient (negative self-test)", () => {
        // A hypothetical route requiring 50MB that has no special Nginx location block
        const unconfiguredUrl = "/api/admin/v1/unconfigured-custom-bulk-upload";
        const requiredLimit = 50 * 1024 * 1024; // 50MB
        const res = resolveNginxMaxBodySize(unconfiguredUrl, parsed);

        // Must resolve to the default 2MB limit (< 50MB), proving that missing locations fail
        expect(res.limit).toBe(parsed.globalClientMaxBodySizeBytes);
        expect(res.limit).toBeLessThan(requiredLimit);
      });
    });
  }
});
