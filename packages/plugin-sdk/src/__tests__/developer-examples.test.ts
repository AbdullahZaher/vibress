import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Phase 16: Developer Platform Usability & Contract Verification", () => {
  const examplesDir = path.resolve(__dirname, "../../../../docs/developer/examples");

  it("1. Starter theme manifest is valid and adheres to Theme SDK specification", () => {
    const themeJsonPath = path.join(examplesDir, "starter-theme/theme.json");
    expect(fs.existsSync(themeJsonPath)).toBe(true);

    const theme = JSON.parse(fs.readFileSync(themeJsonPath, "utf8"));
    expect(theme.id).toBe("starter-minimal");
    expect(theme.version).toBe("1.0.0");
    expect(theme.settingsSchema).toBeDefined();
    expect(theme.settingsSchema.version).toBe(1);
    expect(Array.isArray(theme.settingsSchema.fields)).toBe(true);
  });

  it("2. Sample plugin manifest is valid and adheres to Plugin SDK specification", () => {
    const manifestPath = path.join(examplesDir, "sample-plugin/manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.id).toBe("sample-seo-enhancer");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.capabilities).toContain("content:read");
    expect(manifest.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("3. Sample plugin source imports ONLY public @vibress/plugin-sdk contracts and zero private internals", () => {
    const pluginSourcePath = path.join(examplesDir, "sample-plugin/index.ts");
    expect(fs.existsSync(pluginSourcePath)).toBe(true);

    const code = fs.readFileSync(pluginSourcePath, "utf8");

    // Prohibit private internal package imports
    const privateInternalPackages = [
      "@vibress/database",
      "@vibress/auth",
      "@vibress/config",
      "@vibress/observability",
      "@vibress/cache",
      "fastify",
      "pg",
      "drizzle-orm",
    ];

    for (const pkg of privateInternalPackages) {
      expect(code).not.toContain(pkg);
    }

    // Must import only public SDK
    expect(code).toContain("@vibress/plugin-sdk");
  });
});
