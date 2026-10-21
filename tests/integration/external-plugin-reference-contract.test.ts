import { describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { resolve } from "node:path";
import { validateManifest, SDK_VERSION } from "@vibress/plugin-sdk";
import { manifest, plugin } from "../../examples/plugins/hello-public/src/index";

describe("EXT-304 independent public SDK reference", () => {
  it("passes the published manifest ABI and declares explicit Host-scoped surfaces", () => {
    const approved = validateManifest(manifest);
    expect(approved.vibressApiVersion).toBe(SDK_VERSION);
    expect(approved.capabilities).toContain("extension.routes.public");
    expect(approved.capabilities).toContain("extension.routes.admin");
    expect(plugin.publicViews?.[0]).toEqual({
      id: "overview", routeId: "summary",
      title: { en: "Hello extension", ar: "إضافة مرحباً" },
      publishedLocales: ["en", "ar"],
    });
    expect(plugin.adminNavigation?.[0]?.permission).toBe("plugins.read");
  });

  it("passes publication and locale only through the Host API scope", async () => {
    const route = plugin.routes?.find((item) => item.id === "summary");
    expect(route?.audience).toBe("public");
    expect(route?.method).toBe("GET");
    if (!route) throw new Error("Missing public route");
    const context = {
      publicationId: "publication-a", requestId: "request-a",
      principal: { kind: "anonymous" as const }, locale: "ar",
    };
    const result = await route.handle({ query: {}, body: {} }, context);
    expect(result).toEqual({ headline: "مرحباً بالعالم", count: 1 });
    const english = await route.handle({ query: {}, body: {} }, {
      ...context, locale: "en", publicationId: "publication-b",
    });
    expect(english).toEqual({ headline: "Hello, world", count: 1 });
  });

  it("preserves activation/deactivation ABI without private service dependencies", async () => {
    const logger = vi.fn();
    await plugin.activate({
      manifestId: manifest.id, name: manifest.name, version: manifest.version,
      settings: {}, getSecret: async () => null, log: logger,
    });
    expect(logger).toHaveBeenCalledOnce();
    await plugin.deactivate?.();
  });

  it("independently bundles the example to a deployable Node ESM artifact", async () => {
    const result = await build({
      entryPoints: [resolve(process.cwd(), "examples/plugins/hello-public/src/index.ts")],
      platform: "node", format: "esm", bundle: true, write: false,
      logLevel: "silent", target: "node24",
    });
    const output = result.outputFiles?.[0]?.text;
    expect(output).toBeTruthy();
    expect(output).toContain("Hello, world");
    expect(output).not.toMatch(/@vibress\/(?:database|security|domains|theme-core)/);
  });
});
