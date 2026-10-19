/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeSettingsEditor, toColorPickerHex } from "../ThemeSettingsEditor";
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
  it("shows short and transparent hexadecimal colors without changing stored values", () => {
    expect(toColorPickerHex("#abc")).toBe("#aabbcc");
    expect(toColorPickerHex("#abcd")).toBe("#aabbcc");
    expect(toColorPickerHex("#11223380")).toBe("#112233");
    expect(toColorPickerHex("#0a0b0c")).toBe("#0a0b0c");
    expect(toColorPickerHex("invalid")).toBe("#000000");
  });

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
    }, {
      themeVersion: "1.0.0",
      settingsSchemaVersion: 1,
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

  it("renders and updates color, number, and string inputs with accessible associations", async () => {
    const fullTheme: ApiThemeSummary = {
      manifest: {
        id: "nordic-pro",
        name: "Nordic Pro",
        version: "1.0.0",
        themeApi: 1,
        capabilities: [],
        settingsSchemaVersion: 1,
      },
      isActive: false,
      settingsSchema: {
        accentColor: { type: "color", label: "Accent Color", default: "#5e81ac" },
        itemsPerPage: {
          type: "number",
          label: "Items Per Page",
          default: 12,
          min: 1,
          max: 48,
          description: "Number of cards per page",
        },
        siteTagline: {
          type: "string",
          label: "Site Tagline",
          default: "Modern Publishing",
          maxLength: 60,
        },
      },
    };

    vi.mocked(getThemeApi).mockResolvedValue({
      ...fullTheme,
      settings: {
        accentColor: "#5e81ac",
        itemsPerPage: 12,
        siteTagline: "Modern Publishing",
      },
    });

    await act(async () => {
      root.render(
        <ThemeSettingsEditor
          theme={fullTheme}
          onBack={vi.fn()}
          onDirtyChange={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
    });

    const colorPicker = container.querySelector('input[type="color"]') as HTMLInputElement | null;
    const numberInput = container.querySelector('input[type="number"]') as HTMLInputElement | null;
    const textInput = container.querySelector('input[type="text"]') as HTMLInputElement | null;

    expect(colorPicker).not.toBeNull();
    expect(colorPicker?.value).toBe("#5e81ac");
    expect(numberInput).not.toBeNull();
    expect(numberInput?.value).toBe("12");
    expect(numberInput?.getAttribute("min")).toBe("1");
    expect(numberInput?.getAttribute("max")).toBe("48");
    expect(numberInput?.getAttribute("aria-describedby")).toBeTruthy();
    expect(textInput).not.toBeNull();
    expect(textInput?.value).toBe("Modern Publishing");
    expect(textInput?.getAttribute("maxlength")).toBe("60");

    // Change number input
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      if (numberInput && nativeSetter) {
        nativeSetter.call(numberInput, "24");
        numberInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Save Settings"),
    );
    expect(save?.disabled).toBe(false);
  });

  it("handles save failures gracefully and displays an accessible alert", async () => {
    vi.mocked(updateThemeSettingsApi).mockRejectedValue(new Error("Network timeout saving settings"));

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

    const preset = container.querySelector("select") as HTMLSelectElement | null;
    await act(async () => {
      if (preset) {
        preset.value = "sunshine";
        preset.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Save Settings"),
    );
    await act(async () => {
      save?.click();
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Network timeout saving settings");
  });

  it("focuses heading on mount for keyboard and screen reader accessibility", async () => {
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

    const heading = container.querySelector("h4");
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);
  });
});
