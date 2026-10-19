/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSettingsEditor } from "../ThemeSettingsEditor";
import {
  type ApiThemeSummary,
  getThemeApi,
  updateThemeSettingsApi,
} from "../../../../lib/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../../../lib/api", () => ({
  getThemeApi: vi.fn(),
  updateThemeSettingsApi: vi.fn(),
}));

const theme: ApiThemeSummary = {
  manifest: {
    id: "retro-creator",
    name: "Retro Creator",
    version: "1.0.0",
    themeApi: 1,
    capabilities: [],
    settingsSchemaVersion: 1,
  },
  isActive: false,
  settingsSchema: {
    designPreset: {
      type: "select",
      label: "Retro Theme Preset",
      default: "sunshine",
      options: [
        { label: "Sunshine 70s", value: "sunshine" },
        { label: "Neon Pop", value: "neon" },
      ],
    },
    showBio: { type: "boolean", label: "Display Bio", default: true },
  },
};

describe("ThemeSettingsEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(getThemeApi).mockResolvedValue({
      ...theme,
      settings: { designPreset: "neon", showBio: false },
    });
    vi.mocked(updateThemeSettingsApi).mockResolvedValue({
      theme: {
        themeId: theme.manifest.id,
        themeVersion: theme.manifest.version,
        settings: { designPreset: "sunshine", showBio: false },
        settingsSchemaVersion: 1,
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.resetAllMocks();
  });

  it("loads saved inactive values and saves edits without activating the theme", async () => {
    const onSaved = vi.fn();
    const onDirtyChange = vi.fn();
    await act(async () => {
      root.render(
        <ThemeSettingsEditor
          theme={theme}
          onBack={vi.fn()}
          onDirtyChange={onDirtyChange}
          onSaved={onSaved}
        />,
      );
    });

    const preset = container.querySelector("select") as HTMLSelectElement | null;
    const bio = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(preset?.value).toBe("neon");
    expect(bio?.checked).toBe(false);
    expect(container.textContent).toContain("Retro Theme Preset");

    await act(async () => {
      if (preset) {
        preset.value = "sunshine";
        preset.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Save Settings"),
    );
    expect(save?.disabled).toBe(false);
    await act(async () => {
      save?.click();
    });
    expect(updateThemeSettingsApi).toHaveBeenCalledWith("retro-creator", {
      designPreset: "sunshine",
      showBio: false,
    });
    expect(onSaved).toHaveBeenCalledWith({ designPreset: "sunshine", showBio: false });
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(save?.disabled).toBe(true);
  });

  it("keeps Save disabled for a theme without customizable fields", async () => {
    vi.mocked(getThemeApi).mockResolvedValue({
      ...theme,
      settingsSchema: {},
      settings: {},
    });
    await act(async () => {
      root.render(
        <ThemeSettingsEditor
          theme={theme}
          onBack={vi.fn()}
          onDirtyChange={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
    });
    expect(container.textContent).toContain("does not define any customizable fields");
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Save Settings"),
    );
    expect(save?.disabled).toBe(true);
  });
});
