import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { resolveThemeHostState } from "../theme-host";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("../../themes/registry", () => ({
  getTheme: vi.fn(() => null),
  getFallbackTheme: vi.fn(() => ({
    settingsSchema: { accentColor: { default: "#000000" } },
  })),
}));

const previewToken = "a".repeat(64);

describe("theme preview settings isolation", () => {
  beforeEach(() => {
    vi.mocked(headers).mockResolvedValue(new Headers({
      host: "publication.example",
      "x-vibress-preview-token": previewToken,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("uses the authorized preview theme version and settings, not the active theme's", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          theme: {
            themeId: "vibress-default",
            themeVersion: "1.0.0",
            isBuiltIn: true,
            settings: { accentColor: "#aaaaaa" },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          themeId: "retro",
          themeVersion: "2.0.0",
          isBuiltIn: false,
          settings: { accentColor: "#bb1122" },
        }),
      });
    vi.stubGlobal("fetch", mockFetch);

    const preview = await resolveThemeHostState(true, "retro");
    expect(preview.isPreview).toBe(true);
    expect(preview.themeId).toBe("retro");
    expect(preview.themeVersion).toBe("2.0.0");
    expect(preview.isBuiltIn).toBe(false);
    expect(preview.settings.accentColor).toBe("#bb1122");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not trust a mismatched preview target", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          theme: { themeId: "vibress-default", themeVersion: "1.0.0", isBuiltIn: true, settings: { accentColor: "#aaaaaa" } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          themeId: "other-theme", themeVersion: "2.0.0", isBuiltIn: false, settings: { accentColor: "#bb1122" },
        }),
      }));
    const preview = await resolveThemeHostState(true, "retro");
    expect(preview.isPreview).toBe(false);
    expect(preview.themeId).toBe("vibress-default");
    expect(preview.settings.accentColor).toBe("#aaaaaa");
  });
});
