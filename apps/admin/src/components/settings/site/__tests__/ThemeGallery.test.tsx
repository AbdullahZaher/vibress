/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ApiThemeSummary } from "../../../../lib/api";
import { ThemeGallery, safeThemePreviewImage } from "../ThemeGallery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const makeTheme = (id: string, isActive: boolean, previewImage?: string): ApiThemeSummary => ({
  manifest: {
    id, name: id === "vibress-default" ? "Vibress Default" : "Retro Creator",
    description: "Readable editorial presentation", version: "1.0.0",
    themeApi: 1, capabilities: [], settingsSchemaVersion: 1,
  },
  isActive,
  isBuiltIn: id === "vibress-default",
  previewImage,
  settingsSchema: {},
});
describe("Theme Studio Gallery", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  it("rejects unsafe preview protocols and preserves actual screenshot URLs", () => {
    expect(safeThemePreviewImage(makeTheme("a", false, "/media/theme.webp"))).toBe("/media/theme.webp");
    expect(safeThemePreviewImage(makeTheme("a", false, "https://example.com/theme.webp"))).toBe("https://example.com/theme.webp");
    expect(safeThemePreviewImage(makeTheme("a", false, "//example.com/tracker"))).toBeNull();
    expect(safeThemePreviewImage(makeTheme("a", false, "javascript:alert(1)"))).toBeNull();
    expect(safeThemePreviewImage(makeTheme("a", false))).toBeNull();
  });
  it("shows active status, actual screenshot, preview, publish and accessible customization", async () => {
    const onPreview = vi.fn(), onActivate = vi.fn(), onCustomize = vi.fn(), onDelete = vi.fn();
    await act(async () => root.render(
      <ThemeGallery themes={[
        makeTheme("retro-creator", false, "/theme/retro.webp"),
        makeTheme("vibress-default", true),
      ]} activeThemeId="vibress-default" activating={null} deleting={null}
      onPreview={onPreview} onActivate={onActivate} onCustomize={onCustomize} onDelete={onDelete} />,
    ));
    expect(host.querySelector('img[src="/theme/retro.webp"]')).not.toBeNull();
    expect(host.textContent).toContain("Screenshot not available");
    expect(host.textContent).toContain("Published");
    expect(host.querySelector('section[aria-label="Currently published theme"] article[data-theme-id="vibress-default"]')).not.toBeNull();
    expect(host.querySelector('section[aria-label="Other themes"] article[data-theme-id="retro-creator"]')).not.toBeNull();
    const preview = host.querySelector<HTMLButtonElement>('button[aria-label="Preview Retro Creator"]');
    const publish = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Publish");
    const customize = host.querySelector<HTMLButtonElement>('button[aria-label="Settings Retro Creator"]');
    await act(async () => { preview?.click(); publish?.click(); customize?.click(); });
    expect(onPreview).toHaveBeenCalledWith("retro-creator");
    expect(onActivate).toHaveBeenCalledWith("retro-creator");
    expect(onCustomize).toHaveBeenCalledTimes(1);
    expect(host.querySelector('button[title="Uninstall theme"]')).not.toBeNull();
  });
  it("filters by keyword without hiding the published theme in the unfiltered view", async () => {
    await act(async () => root.render(
      <ThemeGallery themes={[makeTheme("retro-creator", false), makeTheme("vibress-default", true)]}
        activeThemeId="vibress-default" activating={null} deleting={null} onPreview={vi.fn()}
        onActivate={vi.fn()} onCustomize={vi.fn()} onDelete={vi.fn()} />,
    ));
    expect(host.querySelectorAll("article")).toHaveLength(2);
    const customFilter = [...host.querySelectorAll("button")].find((button) => button.textContent === "Custom themes");
    await act(async () => { customFilter?.click(); });
    expect(host.querySelectorAll("article")).toHaveLength(1);
    expect(host.textContent).toContain("Retro Creator");
  });
});
