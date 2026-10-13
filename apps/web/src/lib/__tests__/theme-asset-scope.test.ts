import { describe, expect, it } from "vitest";
import {
  isPublicExternalThemeAssetPath,
  shouldAllowLegacyThemeFallback,
} from "../theme-asset-scope";

describe("theme asset publication scope", () => {
  it("exposes only presentation assets for external themes", () => {
    expect(isPublicExternalThemeAssetPath("assets/css/theme.css")).toBe(true);
    expect(isPublicExternalThemeAssetPath("assets/fonts/site.woff2")).toBe(true);
    expect(isPublicExternalThemeAssetPath("preview.webp")).toBe(true);
    expect(isPublicExternalThemeAssetPath("images/preview.svg")).toBe(true);

    expect(isPublicExternalThemeAssetPath("templates/home.liquid")).toBe(false);
    expect(isPublicExternalThemeAssetPath("theme.json")).toBe(false);
    expect(isPublicExternalThemeAssetPath("settings.json")).toBe(false);
    expect(isPublicExternalThemeAssetPath("README.md")).toBe(false);
  });

  it("allows legacy fallback only for the resolved publication active theme", () => {
    expect(shouldAllowLegacyThemeFallback(null, "theme-a", "1.0.0")).toBe(false);
    expect(
      shouldAllowLegacyThemeFallback(
        {
          publicationId: "pub_default",
          activeThemeId: "different-theme",
          activeThemeVersion: "9.9.9",
        },
        "theme-a",
        "1.0.0",
      ),
    ).toBe(true);

    const scope = {
      publicationId: "pub_alpha",
      activeThemeId: "theme-a",
      activeThemeVersion: "1.0.0",
      legacyStorage: true,
    };
    // A matching active theme is insufficient without its DB-backed legacy reference.
    expect(
      shouldAllowLegacyThemeFallback(
        { ...scope, legacyStorage: false },
        "theme-a",
        "1.0.0",
      ),
    ).toBe(false);
    expect(
      shouldAllowLegacyThemeFallback(
        { ...scope, legacyStorage: undefined },
        "theme-a",
        "1.0.0",
      ),
    ).toBe(false);
    expect(shouldAllowLegacyThemeFallback(scope, "theme-a", "1.0.0")).toBe(true);
    expect(shouldAllowLegacyThemeFallback(scope, "theme-b", "1.0.0")).toBe(false);
    expect(shouldAllowLegacyThemeFallback(scope, "theme-a", "2.0.0")).toBe(false);
    // A missing asset in an installed scoped package must not borrow the
    // same path from the legacy global theme directory.
    expect(
      shouldAllowLegacyThemeFallback(scope, "theme-a", "1.0.0", true),
    ).toBe(false);
    expect(
      shouldAllowLegacyThemeFallback(scope, "theme-a", "1.0.0", false),
    ).toBe(true);
  });
});
