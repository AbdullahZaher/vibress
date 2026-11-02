import { describe, it, expect } from "vitest";
import {
  THEME_API_VERSION,
  validateThemeId,
  validateThemeManifest,
  validateThemeCompatibility,
  validateThemeSettings,
  validateThemeSettingsSchema,
  mergeThemeSettings,
  ThemeError,
  ThemeSettingsInvalidError,
} from "../theme-core";

describe("Theme Core — Validation", () => {
  it("accepts a valid manifest", () => {
    const manifest = validateThemeManifest({
      id: "vibress-default",
      name: "Vibress Default",
      version: "1.0.0",
      themeApi: 1,
    });
    expect(manifest.id).toBe("vibress-default");
    expect(manifest.themeApi).toBe(THEME_API_VERSION);
  });

  it("rejects invalid theme IDs", () => {
    expect(() => validateThemeId("../../evil")).toThrow(ThemeError);
    expect(() => validateThemeId("file:///etc/passwd")).toThrow(ThemeError);
    expect(() => validateThemeId("node:fs")).toThrow(ThemeError);
    expect(() => validateThemeId("UPPERCASE")).toThrow(ThemeError);
    expect(() => validateThemeId("with space")).toThrow(ThemeError);
  });

  it("rejects malformed manifest", () => {
    expect(() => validateThemeManifest({ id: "x", name: "X" })).toThrow(
      ThemeError,
    ); // missing version
    expect(() =>
      validateThemeManifest({ id: "x", name: "X", version: "not-semver" }),
    ).toThrow(ThemeError);
    expect(() =>
      validateThemeManifest({ id: "bad id", name: "X", version: "1.0.0" }),
    ).toThrow(ThemeError);
  });

  it("rejects incompatible theme API version", () => {
    const manifest = validateThemeManifest({
      id: "vibress-old",
      name: "Old",
      version: "1.0.0",
      themeApi: 999,
    });
    expect(() => validateThemeCompatibility(manifest)).toThrow(ThemeError);
  });

  it("validates settings and applies defaults", () => {
    const schema = {
      accentColor: { type: "color" as const, default: "#2563eb" },
      showAuthor: { type: "boolean" as const, default: true },
      contentWidth: {
        type: "number" as const,
        default: 800,
        min: 600,
        max: 1600,
      },
    };
    const result = validateThemeSettings(schema, {});
    expect(result.accentColor).toBe("#2563eb");
    expect(result.showAuthor).toBe(true);
    expect(result.contentWidth).toBe(800);
  });

  it("rejects invalid settings values", () => {
    const schema = {
      accentColor: { type: "color" as const, default: "#2563eb" },
      contentWidth: {
        type: "number" as const,
        default: 800,
        min: 600,
        max: 1600,
      },
    };
    expect(() =>
      validateThemeSettings(schema, { accentColor: "javascript:alert(1)" }),
    ).toThrow(ThemeError);
    expect(() =>
      validateThemeSettings(schema, { accentColor: "url(http://evil)" }),
    ).toThrow(ThemeError);
    // Reject unsupported color lengths (#12345 is 5 chars, #1234567 is 7 chars)
    expect(() =>
      validateThemeSettings(schema, { accentColor: "#12345" }),
    ).toThrow(ThemeError);
    expect(() =>
      validateThemeSettings(schema, { accentColor: "#1234567" }),
    ).toThrow(ThemeError);
    expect(() =>
      validateThemeSettings(schema, { accentColor: "#gggggg" }),
    ).toThrow(ThemeError);
    expect(() =>
      validateThemeSettings(schema, { accentColor: "" }),
    ).toThrow(ThemeError);
    // Reject non-finite numbers (Infinity, -Infinity, NaN)
    expect(() =>
      validateThemeSettings(schema, { contentWidth: Infinity }),
    ).toThrow(ThemeError);
    expect(() =>
      validateThemeSettings(schema, { contentWidth: -Infinity }),
    ).toThrow(ThemeError);
    expect(() =>
      validateThemeSettings(schema, { contentWidth: NaN }),
    ).toThrow(ThemeError);
    expect(() => validateThemeSettings(schema, { contentWidth: 9999 })).toThrow(
      ThemeError,
    );
    expect(() => validateThemeSettings(schema, { contentWidth: 500 })).toThrow(
      ThemeError,
    );
    expect(() =>
      validateThemeSettings(schema, { contentWidth: "wide" }),
    ).toThrow(ThemeError);
    expect(() => validateThemeSettings(schema, { unknownKey: "x" })).toThrow(
      ThemeError,
    );
  });

  it("validates exact hex color lengths and formats (#RGB, #RGBA, #RRGGBB, #RRGGBBAA)", () => {
    const schema = {
      color3: { type: "color" as const, default: "#123" },
      color4: { type: "color" as const, default: "#1234" },
      color6: { type: "color" as const, default: "#123456" },
      color8: { type: "color" as const, default: "#12345678" },
    };
    const valid = validateThemeSettings(schema, {
      color3: "#abc",
      color4: "#abcd",
      color6: "#abcdef",
      color8: "#abcdef12",
    });
    expect(valid.color3).toBe("#abc");
    expect(valid.color4).toBe("#abcd");
    expect(valid.color6).toBe("#abcdef");
    expect(valid.color8).toBe("#abcdef12");
  });

  it("enforces string minLength, maxLength, and non-empty select options", () => {
    const schema = {
      title: {
        type: "string" as const,
        default: "Hello",
        minLength: 3,
        maxLength: 10,
      },
      font: {
        type: "select" as const,
        default: "sans",
        options: ["sans", "serif", "mono"],
      },
    };
    // Valid values
    const res = validateThemeSettings(schema, { title: "Vibress", font: "serif" });
    expect(res.title).toBe("Vibress");
    expect(res.font).toBe("serif");

    // String too short
    expect(() => validateThemeSettings(schema, { title: "Hi" })).toThrow(ThemeError);
    // String too long
    expect(() => validateThemeSettings(schema, { title: "A very long title that exceeds max" })).toThrow(ThemeError);
    // Invalid select option
    expect(() => validateThemeSettings(schema, { font: "comic-sans" })).toThrow(ThemeError);
  });

  it("validates schema definitions and rejects invalid defaults or bounds", () => {
    // Color default with 5 hex digits
    expect(() =>
      validateThemeSettingsSchema({
        accent: { type: "color", default: "#12345" },
      }),
    ).toThrow(ThemeSettingsInvalidError);

    // Number default below min
    expect(() =>
      validateThemeSettingsSchema({
        width: { type: "number", default: 500, min: 600, max: 1200 },
      }),
    ).toThrow(ThemeSettingsInvalidError);

    // Number default is Infinity
    expect(() =>
      validateThemeSettingsSchema({
        width: { type: "number", default: Infinity, min: 0 },
      }),
    ).toThrow(ThemeSettingsInvalidError);

    // String default below minLength
    expect(() =>
      validateThemeSettingsSchema({
        text: { type: "string", default: "ab", minLength: 5 },
      }),
    ).toThrow(ThemeSettingsInvalidError);

    // Select default not in options
    expect(() =>
      validateThemeSettingsSchema({
        choice: { type: "select", default: "invalid", options: ["a", "b"] },
      }),
    ).toThrow(ThemeSettingsInvalidError);
  });

  it("merges stored settings with defaults and falls back on invalid stored values", () => {
    const schema = {
      accentColor: { type: "color" as const, default: "#000000" },
      footerText: {
        type: "string" as const,
        default: "default",
        maxLength: 100,
      },
    };
    const merged = mergeThemeSettings(schema, { accentColor: "#123456" });
    expect(merged.accentColor).toBe("#123456");
    expect(merged.footerText).toBe("default");

    // Invalid stored value → falls back to defaults
    const safe = mergeThemeSettings(schema, { accentColor: "javascript:evil" });
    expect(safe.accentColor).toBe("#000000");
  });
});
