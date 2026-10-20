/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NavSettings } from "../NavSettings";

vi.mock("../../../../lib/admin-locale", () => ({
  useAdminLocale: () => ({ tr: (key: string) => key }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Admin sidebar Plugins and Settings navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows Plugins consecutively above Settings with active selection and keyboard-usable navigation", async () => {
    const navigate = vi.fn();
    await act(async () => {
      root.render(
        <NavSettings
          currentPath="/admin/plugins"
          onNavigate={navigate}
          canReadPlugins
        />
      );
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const pluginIndex = buttons.findIndex((button) => button.textContent?.trim() === "Plugins");
    const settingsIndex = buttons.findIndex((button) => button.textContent?.trim() === "Settings");

    expect(pluginIndex).toBeGreaterThanOrEqual(0);
    // Consecutive: Settings directly follows Plugins with no separator between them
    expect(settingsIndex).toBe(pluginIndex + 1);

    const pluginButton = buttons[pluginIndex];
    expect(pluginButton?.getAttribute("aria-current")).toBe("page");
    await act(async () => {
      pluginButton?.click();
    });
    expect(navigate).toHaveBeenCalledWith("/admin/plugins");
  });

  it("renders Settings as a single clickable navigation item without expandable submenu", async () => {
    const navigate = vi.fn();
    await act(async () => {
      root.render(
        <NavSettings
          currentPath="/admin/posts"
          onNavigate={navigate}
          canReadPlugins
        />
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const settingsButton = buttons.find((button) => button.textContent?.trim() === "Settings");
    expect(settingsButton).toBeDefined();

    // Clicking Settings navigates directly to /admin/settings
    await act(async () => {
      settingsButton?.click();
    });
    expect(navigate).toHaveBeenCalledWith("/admin/settings");

    // Submenu sections are not rendered in the sidebar
    expect(container.textContent).not.toContain("General");
    expect(container.textContent).not.toContain("Membership");
    expect(container.textContent).not.toContain("Growth");
    expect(container.textContent).not.toContain("Advanced");
  });

  it("marks Settings as active when on /admin/settings or nested settings paths", async () => {
    await act(async () => {
      root.render(
        <NavSettings
          currentPath="/admin/settings"
          onNavigate={() => undefined}
          canReadPlugins
        />
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const settingsButton = buttons.find((button) => button.textContent?.trim() === "Settings");
    expect(settingsButton?.getAttribute("aria-current")).toBe("page");
  });

  it("marks Settings as active when on nested /admin/settings/site path", async () => {
    await act(async () => {
      root.render(
        <NavSettings
          currentPath="/admin/settings/site"
          onNavigate={() => undefined}
          canReadPlugins
        />
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const settingsButton = buttons.find((button) => button.textContent?.trim() === "Settings");
    expect(settingsButton?.getAttribute("aria-current")).toBe("page");
  });

  it("hides Plugins from staff lacking plugins.read while keeping Settings accessible", async () => {
    const navigate = vi.fn();
    await act(async () => {
      root.render(
        <NavSettings
          currentPath="/admin/settings"
          onNavigate={navigate}
          canReadPlugins={false}
        />
      );
    });
    expect(container.textContent).not.toContain("Plugins");
    expect(container.textContent).toContain("Settings");

    const settingsButton = container.querySelector("button");
    expect(settingsButton?.textContent?.trim()).toBe("Settings");
    await act(async () => {
      settingsButton?.click();
    });
    expect(navigate).toHaveBeenCalledWith("/admin/settings");
  });
});
