/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ThemeSettingsEditor,
  isValidHexColor,
  themeSettingCategory,
  toColorPickerHex,
  validateThemeSetting,
} from "../ThemeSettingsEditor";
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
  it("groups text and visibility fields under Content, not Layout", () => {
    expect(themeSettingCategory("footerText")).toBe("Content");
    expect(themeSettingCategory("showRelatedPosts")).toBe("Content");
    expect(themeSettingCategory("siteTagline")).toBe("Content");
    expect(themeSettingCategory("headerStyle")).toBe("Layout");
    expect(themeSettingCategory("contentWidth")).toBe("Layout");
    expect(themeSettingCategory("accentColor")).toBe("Colors");
    expect(themeSettingCategory("titleFont")).toBe("Typography");
  });
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
    expect(container.querySelector('section[aria-label="Content"]')?.textContent).toContain("Display Bio");
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
    expect(container.textContent).toContain("Unsaved changes");
    await act(async () => {
      save?.click();
    });
    expect(container.textContent).toContain("All changes saved");
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
    const colorHexInput = container.querySelector('input[aria-label*="hex value"]') as HTMLInputElement | null;
    const numberInput = container.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    const textInput = container.querySelector('input[maxlength="60"]') as HTMLInputElement | null;

    expect(colorPicker).not.toBeNull();
    expect(colorPicker?.value).toBe("#5e81ac");
    expect(colorHexInput?.value).toBe("#5e81ac");
    expect(numberInput).not.toBeNull();
    expect(numberInput?.value).toBe("12");
    expect(numberInput?.getAttribute("min")).toBe("1");
    expect(numberInput?.getAttribute("max")).toBe("48");
    expect(numberInput?.getAttribute("type")).toBe("text");
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

  it("validates theme setting values against schemas accurately", () => {
    expect(isValidHexColor("#abc")).toBe(true);
    expect(isValidHexColor("#abcd")).toBe(true);
    expect(isValidHexColor("#aabbcc")).toBe(true);
    expect(isValidHexColor("#aabbccdd")).toBe(true);
    expect(isValidHexColor("invalid")).toBe(false);
    expect(isValidHexColor("#12")).toBe(false);
    expect(isValidHexColor("#12345")).toBe(false);
    expect(isValidHexColor("#1234567")).toBe(false);
    expect(isValidHexColor("#123456789")).toBe(false);

    const tr = (s: string) => s;
    // Color
    expect(validateThemeSetting({ type: "color", default: "#abc" }, "#abc", tr)).toBeNull();
    expect(validateThemeSetting({ type: "color", default: "#abcd" }, "#abcd", tr)).toBeNull();
    expect(validateThemeSetting({ type: "color", default: "#aabbcc" }, "#aabbcc", tr)).toBeNull();
    expect(validateThemeSetting({ type: "color", default: "#aabbccdd" }, "#aabbccdd", tr)).toBeNull();
    expect(validateThemeSetting({ type: "color", default: "#111" }, "not-a-color", tr)).toContain("Invalid HEX format");
    expect(validateThemeSetting({ type: "color", default: "#111" }, "#12", tr)).toContain("Invalid HEX format");
    expect(validateThemeSetting({ type: "color", default: "#111" }, "#12345", tr)).toContain("Invalid HEX format");
    expect(validateThemeSetting({ type: "color", default: "#111" }, "#1234567", tr)).toContain("Invalid HEX format");
    expect(validateThemeSetting({ type: "color", default: "#111" }, "#123456789", tr)).toContain("Invalid HEX format");
    // Empty color validation
    expect(validateThemeSetting({ type: "color", default: "#111" }, "", tr)).toContain("A valid HEX color is required.");
    expect(validateThemeSetting({ type: "color", default: "#111" }, "   ", tr)).toContain("A valid HEX color is required.");
    expect(validateThemeSetting({ type: "color", default: "#111", optional: true } as any, "", tr)).toBeNull();

    // Number
    expect(validateThemeSetting({ type: "number", min: 5, max: 20 }, 10, tr)).toBeNull();
    expect(validateThemeSetting({ type: "number", min: 5, max: 20 }, 5, tr)).toBeNull();
    expect(validateThemeSetting({ type: "number", min: 5, max: 20 }, 20, tr)).toBeNull();
    expect(validateThemeSetting({ type: "number", min: 5, max: 20 }, 4, tr)).toContain("Value must be at least 5");
    expect(validateThemeSetting({ type: "number", min: 5, max: 20 }, 25, tr)).toContain("Value must be at most 20");
    expect(validateThemeSetting({ type: "number" }, "abc", tr)).toContain("Please enter a valid number.");
    expect(validateThemeSetting({ type: "number", default: 10 }, "", tr)).toContain("Please enter a valid number.");
    expect(validateThemeSetting({ type: "number", default: 10 }, Infinity, tr)).toContain("Please enter a valid number.");
    expect(validateThemeSetting({ type: "number", default: 10, optional: true } as any, "", tr)).toBeNull();

    // String
    expect(validateThemeSetting({ type: "string", maxLength: 10 }, "hello", tr)).toBeNull();
    expect(validateThemeSetting({ type: "string", maxLength: 10 }, "", tr)).toBeNull();
    expect(validateThemeSetting({ type: "string", maxLength: 4 }, "hello world", tr)).toContain("Maximum length is 4");
    expect(validateThemeSetting({ type: "string", minLength: 3 } as any, "hi", tr)).toContain("Minimum length is 3");
    expect(validateThemeSetting({ type: "string", minLength: 3 } as any, "hey", tr)).toBeNull();

    // Select
    expect(validateThemeSetting({ type: "select", options: ["light", "dark"] }, "dark", tr)).toBeNull();
    expect(validateThemeSetting({ type: "select", options: ["light", "dark"] }, "sepia", tr)).toContain("Please select a valid option.");
  });

  it("handles clearing a number input with aria-invalid, error feedback, and disabled save", async () => {
    const numTheme: ApiThemeSummary = {
      manifest: {
        id: "num-test",
        name: "Number Test Theme",
        version: "1.0.0",
        themeApi: 1,
        capabilities: [],
        settingsSchemaVersion: 1,
      },
      isActive: false,
      settingsSchema: {
        itemsCount: { type: "number", label: "Items Count", default: 10, min: 1, max: 50 },
      },
    };

    vi.mocked(getThemeApi).mockResolvedValue({
      ...numTheme,
      settings: { itemsCount: 10 },
    });

    await act(async () => {
      root.render(
        <ThemeSettingsEditor
          theme={numTheme}
          onBack={vi.fn()}
          onDirtyChange={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
    });

    const numberInput = container.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;
    expect(numberInput?.value).toBe("10");
    expect(numberInput?.getAttribute("aria-invalid")).toBeNull();

    // Clear the number input
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      if (numberInput && nativeSetter) {
        nativeSetter.call(numberInput, "");
        numberInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(numberInput?.getAttribute("aria-invalid")).toBe("true");
    const errorEl = container.querySelector(`p[role="alert"]`);
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain("Please enter a valid number.");

    // Save must be disabled
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Save Settings"),
    );
    expect(save?.disabled).toBe(true);

    // Type a number out of range
    await act(async () => {
      if (numberInput && nativeSetter) {
        nativeSetter.call(numberInput, "99");
        numberInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(errorEl?.textContent).toContain("Value must be at most 50");
    expect(save?.disabled).toBe(true);

    // Intermediate edits must not be coerced to NaN or truncated while typing.
    await act(async () => {
      if (numberInput && nativeSetter) {
        nativeSetter.call(numberInput, "-");
        numberInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(numberInput?.value).toBe("-");
    expect(save?.disabled).toBe(true);
    await act(async () => {
      if (numberInput && nativeSetter) {
        nativeSetter.call(numberInput, "1.");
        numberInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(numberInput?.value).toBe("1.");

    // Restore to a valid number
    await act(async () => {
      if (numberInput && nativeSetter) {
        nativeSetter.call(numberInput, "25");
        numberInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(numberInput?.getAttribute("aria-invalid")).toBeNull();
    expect(container.querySelector(`p[role="alert"]`)).toBeNull();
    expect(save?.disabled).toBe(false);
  });

  it("handles color input validation with aria-invalid, error description, and preserves swatch on invalid input", async () => {
    const colorTheme: ApiThemeSummary = {
      manifest: {
        id: "color-test",
        name: "Color Test Theme",
        version: "1.0.0",
        themeApi: 1,
        capabilities: [],
        settingsSchemaVersion: 1,
      },
      isActive: false,
      settingsSchema: {
        brandColor: { type: "color", label: "Brand Color", default: "#336699" },
      },
    };

    vi.mocked(getThemeApi).mockResolvedValue({
      ...colorTheme,
      settings: { brandColor: "#336699" },
    });

    await act(async () => {
      root.render(
        <ThemeSettingsEditor
          theme={colorTheme}
          onBack={vi.fn()}
          onDirtyChange={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
    });

    const textInput = container.querySelector('input[type="text"]') as HTMLInputElement | null;
    expect(textInput?.value).toBe("#336699");
    expect(textInput?.getAttribute("aria-invalid")).toBeNull();

    // Type invalid color
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      if (textInput && nativeSetter) {
        nativeSetter.call(textInput, "#invalid");
        textInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(textInput?.getAttribute("aria-invalid")).toBe("true");
    const errorId = textInput?.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    const errorEl = container.querySelector(`p[role="alert"]`);
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain("Invalid HEX format");

    // Save button must be disabled
    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Save Settings"),
    );
    expect(save?.disabled).toBe(true);
    expect(container.textContent).toContain("Fix validation errors before saving.");

    // Color swatch in overview panel should NOT be black #000000; it preserves #336699
    const swatch = container.querySelector('aside section div[aria-hidden="true"]') as HTMLDivElement | null;
    expect(swatch?.style.backgroundColor).toBe("rgb(51, 102, 153)");

    // Discarding changes resets the input and removes error
    const discard = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Discard changes"),
    );
    await act(async () => {
      discard?.click();
    });
    expect(textInput?.value).toBe("#336699");
    expect(textInput?.getAttribute("aria-invalid")).toBeNull();
    expect(container.querySelector(`p[role="alert"]`)).toBeNull();
  });

  it("preserves alpha channel when selecting a color via native color picker", async () => {
    const alphaTheme: ApiThemeSummary = {
      manifest: {
        id: "alpha-test",
        name: "Alpha Test Theme",
        version: "1.0.0",
        themeApi: 1,
        capabilities: [],
        settingsSchemaVersion: 1,
      },
      isActive: false,
      settingsSchema: {
        accentColor8: { type: "color", label: "Accent 8", default: "#11223380" },
        accentColor4: { type: "color", label: "Accent 4", default: "#123c" },
      },
    };

    vi.mocked(getThemeApi).mockResolvedValue({
      ...alphaTheme,
      settings: {
        accentColor8: "#11223380",
        accentColor4: "#123c",
      },
    });

    await act(async () => {
      root.render(
        <ThemeSettingsEditor
          theme={alphaTheme}
          onBack={vi.fn()}
          onDirtyChange={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
    });

    const colorPickers = container.querySelectorAll('input[type="color"]');
    const textInputs = container.querySelectorAll('input[type="text"]');
    expect(colorPickers.length).toBe(2);
    expect(textInputs.length).toBe(2);

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    // Change picker for 8-digit hex: should keep "80" alpha suffix
    await act(async () => {
      const picker1 = colorPickers[0] as HTMLInputElement;
      if (picker1 && nativeSetter) {
        nativeSetter.call(picker1, "#ff0000");
        picker1.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect((textInputs[0] as HTMLInputElement).value).toBe("#ff000080");

    // Change picker for 4-digit hex: should keep "cc" alpha suffix
    await act(async () => {
      const picker2 = colorPickers[1] as HTMLInputElement;
      if (picker2 && nativeSetter) {
        nativeSetter.call(picker2, "#00ff00");
        picker2.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect((textInputs[1] as HTMLInputElement).value).toBe("#00ff00cc");
  });
});
