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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Admin sidebar Plugins navigation", () => {
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

  it("shows Plugins above Settings with active selection and keyboard-usable navigation", async () => {
    const navigate = vi.fn();
    await act(async () => {
      root.render(<NavSettings
        currentPath="/admin/plugins"
        onNavigate={navigate}
        canReadPlugins
      />);
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const pluginIndex = buttons.findIndex((button) => button.textContent?.trim() === "Plugins");
    const settingsIndex = buttons.findIndex((button) => button.textContent?.trim() === "Settings");
    expect(pluginIndex).toBeGreaterThanOrEqual(0);
    expect(settingsIndex).toBeGreaterThan(pluginIndex);
    const button = buttons[pluginIndex];
    expect(button?.getAttribute("aria-current")).toBe("page");
    await act(async () => { button?.click(); });
    expect(navigate).toHaveBeenCalledWith("/admin/plugins");
  });

  it("hides Plugins from staff lacking plugins.read", async () => {
    await act(async () => {
      root.render(<NavSettings
        currentPath="/admin/settings/general"
        onNavigate={() => undefined}
        canReadPlugins={false}
      />);
    });
    expect(container.textContent).not.toContain("Plugins");
    expect(container.textContent).toContain("Settings");
  });
});
