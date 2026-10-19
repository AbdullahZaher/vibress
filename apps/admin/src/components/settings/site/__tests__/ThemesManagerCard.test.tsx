/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemesManagerCard } from "../ThemesManagerCard";
import {
  type ApiThemeSummary,
  listThemesApi,
  getActiveThemeApi,
  getThemeApi,
} from "../../../../lib/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../../../lib/api", () => ({
  listThemesApi: vi.fn(),
  getActiveThemeApi: vi.fn(),
  getThemeApi: vi.fn(),
  activateThemeApi: vi.fn(),
  createThemePreviewApi: vi.fn(),
  uploadThemeApi: vi.fn(),
  deleteThemeApi: vi.fn(),
  updateThemeSettingsApi: vi.fn(),
}));

const customTheme: ApiThemeSummary = {
  manifest: {
    id: "retro-creator",
    name: "Retro Creator",
    version: "1.0.0",
    themeApi: 1,
    capabilities: [],
    settingsSchemaVersion: 1,
  },
  isActive: false,
  isBuiltIn: false,
  settingsSchema: {
    designPreset: { type: "select", default: "sunshine", options: ["sunshine", "neon"] },
  },
};

const activeTheme: ApiThemeSummary = {
  manifest: {
    id: "vibress-default",
    name: "Vibress Default",
    version: "1.0.0",
    themeApi: 1,
    capabilities: [],
    settingsSchemaVersion: 1,
  },
  isActive: true,
  isBuiltIn: true,
  settingsSchema: {},
};

describe("ThemesManagerCard", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(listThemesApi).mockResolvedValue({ themes: [customTheme, activeTheme] });
    vi.mocked(getActiveThemeApi).mockResolvedValue({
      themeId: "vibress-default",
      themeVersion: "1.0.0",
      settings: {},
      settingsSchemaVersion: 1,
    });
    vi.mocked(getThemeApi).mockResolvedValue({
      ...customTheme,
      settings: { designPreset: "neon" },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.resetAllMocks();
  });

  it("places Settings immediately before Delete and opens an inactive theme editor", async () => {
    await act(async () => root.render(<ThemesManagerCard />));
    const open = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Change theme"),
    );
    expect(open).toBeDefined();
    await act(async () => { open?.click(); });

    const settings = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Settings Retro Creator"]',
    );
    const remove = document.querySelector<HTMLButtonElement>(
      'button[title="Uninstall theme"]',
    );
    expect(settings).not.toBeNull();
    expect(remove).not.toBeNull();
    expect(settings?.nextElementSibling).toBe(remove);

    await act(async () => { settings?.click(); });
    expect(getThemeApi).toHaveBeenCalledWith("retro-creator");
    expect(document.querySelector<HTMLSelectElement>("select")?.value).toBe("neon");
  });

  it("keeps keyboard focus inside the drawer and restores the opener after closing", async () => {
    await act(async () => root.render(<ThemesManagerCard />));
    const opener = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Change theme"),
    );
    expect(opener).toBeDefined();
    await act(async () => { opener?.focus(); opener?.click(); });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Themes Manager"]');
    const close = dialog?.querySelector<HTMLButtonElement>('[aria-label="Close themes drawer"]');
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(close);

    const controls = Array.from(dialog?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") || []);
    const last = controls[controls.length - 1];
    expect(last).toBeDefined();
    await act(async () => {
      last?.focus();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(controls[0]);

    await act(async () => { close?.click(); });
    expect(document.querySelector('[role="dialog"][aria-label="Themes Manager"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("prompts for confirmation before discarding unsaved theme settings", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    await act(async () => root.render(<ThemesManagerCard />));
    const open = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Change theme"),
    );
    await act(async () => { open?.click(); });

    const settings = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Settings Retro Creator"]',
    );
    await act(async () => { settings?.click(); });

    const select = document.querySelector<HTMLSelectElement>("select");
    expect(select).not.toBeNull();
    await act(async () => {
      if (select) {
        select.value = "sunshine";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    // 1. Cancel discard -> stays in editor
    confirmSpy.mockReturnValueOnce(false);
    const backButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Back to themes"]',
    );
    expect(backButton).not.toBeNull();
    await act(async () => { backButton?.click(); });

    expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved theme settings changes?");
    expect(document.querySelector<HTMLSelectElement>("select")).not.toBeNull();

    // 2. Confirm discard -> returns to theme list
    confirmSpy.mockReturnValueOnce(true);
    await act(async () => { backButton?.click(); });
    expect(document.querySelector<HTMLSelectElement>("select")).toBeNull();
    expect(document.querySelector('button[aria-label="Settings Retro Creator"]')).not.toBeNull();
  });
});
