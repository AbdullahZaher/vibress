import { describe, it, expect } from "vitest";
import {
  validateThemeManifest,
  validateThemeTemplateContract,
  validateThemeSettings,
} from "../theme-core";

describe("Theme Ecosystem & Contract Verification", () => {
  it("validates theme manifest format and semver", () => {
    const manifest = validateThemeManifest({
      id: "casper-modern",
      name: "Casper Modern",
      version: "1.0.0",
      themeApi: 1,
      capabilities: [],
    });

    expect(manifest.id).toBe("casper-modern");
    expect(manifest.version).toBe("1.0.0");
  });

  it("validates theme template contract requiring index, post, and page", () => {
    const valid = validateThemeTemplateContract([
      "index.liquid",
      "post.liquid",
      "page.liquid",
      "tag.liquid",
    ]);
    expect(valid.valid).toBe(true);
    expect(valid.missing).toHaveLength(0);

    const invalid = validateThemeTemplateContract([
      "index.liquid",
      "tag.liquid",
    ]);
    expect(invalid.valid).toBe(false);
    expect(invalid.missing).toContain("post");
    expect(invalid.missing).toContain("page");
  });

  it("validates and bounds theme settings inputs", () => {
    const schema = {
      accentColor: { type: "color" as const, default: "#6366f1" },
      showAuthorBio: { type: "boolean" as const, default: true },
      postsPerPage: { type: "number" as const, default: 10, min: 1, max: 50 },
    };

    const validated = validateThemeSettings(schema, {
      accentColor: "#3b82f6",
      postsPerPage: 15,
    });

    expect(validated.accentColor).toBe("#3b82f6");
    expect(validated.showAuthorBio).toBe(true);
    expect(validated.postsPerPage).toBe(15);
  });
});
