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
  createThemePreviewApi,
  activateThemeApi,
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

  it("embeds a validated preview URL instead of query-string theme selection", async () => {
    vi.mocked(createThemePreviewApi).mockResolvedValue({
      previewToken: "a".repeat(64),
      expiresAt: new Date().toISOString(),
      themeId: "retro-creator",
    });
    await act(async () => root.render(<ThemesManagerCard />));
    const open = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Change theme"),
    );
    await act(async () => { open?.click(); });
    const previewButton = document.querySelector<HTMLButtonElement>('[title="Preview theme in new tab"]');
    await act(async () => { previewButton?.click(); });
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Theme preview Retro Creator"]');
    expect(iframe?.getAttribute("src")).toBe("/preview/" + "a".repeat(64));
    const link = document.querySelector<HTMLAnchorElement>('a[href^="/preview/"]');
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("prompts for confirmation before discarding unsaved theme settings", async () => {
    // The theme manager uses the accessible confirmation dialog, not window.confirm.
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
    const backButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Back to themes"]',
    );
    expect(backButton).not.toBeNull();
    await act(async () => { backButton?.click(); });

    let confirmation = document.querySelector<HTMLElement>(".settings-confirmation-dialog");
    expect(confirmation?.textContent).toContain("Discard unsaved theme settings changes?");
    const cancel = Array.from(confirmation?.querySelectorAll("button") ?? []).find(
      button => button.textContent?.trim() === "Cancel",
    );
    await act(async () => { cancel?.click(); });
    expect(document.querySelector<HTMLSelectElement>("select")).not.toBeNull();

    // 2. Confirm discard -> returns to theme list
    await act(async () => { backButton?.click(); });
    confirmation = document.querySelector<HTMLElement>(".settings-confirmation-dialog");
    const proceed = Array.from(confirmation?.querySelectorAll("button") ?? []).find(
      button => button.textContent?.trim() === "Continue",
    );
    expect(proceed).toBeTruthy();
    await act(async () => { proceed?.click(); });
    expect(document.querySelector<HTMLSelectElement>("select")).toBeNull();
    expect(document.querySelector('button[aria-label="Settings Retro Creator"]')).not.toBeNull();
  });
  it("confirms before publishing a different theme and reports API errors without changing the active theme", async () => {
    vi.mocked(activateThemeApi).mockRejectedValue(new Error("Theme activation unavailable"));
    await act(async () => { root.render(<ThemesManagerCard />); });
    const open = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Change theme"),
    );
    await act(async () => { open?.click(); });
    const retro = Array.from(document.querySelectorAll("article")).find(
      (element) => element.textContent?.includes("Retro Creator"),
    );
    const publish = Array.from(retro?.querySelectorAll("button") || []).find(
      (button) => button.textContent?.trim() === "Publish",
    );
    expect(publish).toBeTruthy();
    await act(async () => { publish?.click(); });
    expect(activateThemeApi).not.toHaveBeenCalled();

    const confirmation = document.querySelector(".settings-confirmation-dialog");
    expect(confirmation?.textContent).toContain("Publish this theme to your live website?");
    const proceed = Array.from(confirmation?.querySelectorAll("button") || []).find(
      (button) => button.textContent?.includes("Publish theme"),
    );
    await act(async () => { proceed?.click(); });
    expect(activateThemeApi).toHaveBeenCalledWith("retro-creator");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Theme activation unavailable");
    expect(container.textContent).toContain("Vibress Default");
  });

  it("provides a user-controlled external preview link beside an in-studio preview", async () => {
    vi.mocked(createThemePreviewApi).mockResolvedValue({
      previewToken: "b".repeat(64),
      expiresAt: new Date().toISOString(),
      themeId: "retro-creator",
    });
    await act(async () => { root.render(<ThemesManagerCard />); });
    const open = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Change theme"),
    );
    await act(async () => { open?.click(); });
    const retro = Array.from(document.querySelectorAll("article")).find(
      (element) => element.textContent?.includes("Retro Creator"),
    );
    const preview = retro?.querySelector<HTMLButtonElement>('button[title="Preview theme in new tab"]');
    await act(async () => { preview?.click(); });
    const link = document.querySelector<HTMLAnchorElement>('a[href^="/preview/"]');
    expect(link?.getAttribute("href")).toBe("/preview/" + "b".repeat(64));
    expect(link?.textContent).toContain("Open preview");
    expect(document.querySelector('iframe[title="Theme preview Retro Creator"]')).not.toBeNull();
  });

});
