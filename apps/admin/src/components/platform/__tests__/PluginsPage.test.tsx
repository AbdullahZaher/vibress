/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listPluginsApi } from "../../../lib/api";
import { PluginsPage } from "../PluginsPage";

vi.mock("../../../lib/api", () => ({ listPluginsApi: vi.fn() }));
vi.mock("../../../lib/admin-locale", () => {
  const tr = (value: string) => value;
  return { useAdminLocale: () => ({ tr }) };
});
vi.mock("../PluginsPanel", () => ({
  PluginsPanel: () => <div data-testid="installed-plugins" />,
}));
vi.mock("../TrustedPluginInstaller", () => ({
  TrustedPluginInstaller: ({ show }: { show?: string }) =>
    <div data-testid="trusted-plugin-installer" data-show={show ?? "all"} />,
}));
vi.mock("../FailedPluginEventsPanel", () => ({
  FailedPluginEventsPanel: ({ pluginId }: { pluginId: string }) =>
    <div data-testid="failed-plugin-events" data-plugin-id={pluginId} />,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Admin Add Plugin access", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  async function render() {
    await act(async () => { root.render(<PluginsPage />); });
  }

  it("keeps approved release sections operator-only and shows no fabricated audit feed", async () => {
    vi.mocked(listPluginsApi).mockResolvedValue({ plugins: [{
      id: "row-a", manifestId: "reviewed", name: "Reviewed", version: "1.0.0",
      vibressApiVersion: "1.0.0", description: null, capabilities: [],
      status: "active", publicationScoped: true, publicationEnabled: true,
    }], platformOperator: true });
    await render();
    const sections = [...container.querySelectorAll('nav[aria-label="Plugin sections"] button')];
    expect(sections.map((item) => item.textContent)).toEqual([
      "Installed plugins", "Available approved plugins", "Approved updates", "Plugin activity",
    ]);
    const click = async (name: string) => {
      const tab = sections.find((item) => item.textContent === name);
      await act(async () => { tab?.click(); });
    };
    await click("Available approved plugins");
    expect(container.querySelector('[data-testid="trusted-plugin-installer"]')
      ?.getAttribute("data-show")).toBe("new");
    expect(container.querySelector('[data-testid="installed-plugins"]')).toBeNull();
    await click("Approved updates");
    expect(container.querySelector('[data-testid="trusted-plugin-installer"]')
      ?.getAttribute("data-show")).toBe("updates");
    await click("Plugin activity");
    expect(container.textContent).toContain("it is not a complete audit history");
    expect(container.querySelector('[data-testid="failed-plugin-events"]')
      ?.getAttribute("data-plugin-id")).toBe("row-a");
    expect(container.querySelector('[data-testid="trusted-plugin-installer"]')).toBeNull();
  });

  it("resets operator-only activity views on publication switch and role loss", async () => {
    vi.mocked(listPluginsApi).mockResolvedValueOnce({ plugins: [{
      id: "row-a", manifestId: "reviewed", name: "Reviewed", version: "1.0.0",
      vibressApiVersion: "1.0.0", description: null, capabilities: [],
      status: "active", publicationScoped: true, publicationEnabled: true,
    }], platformOperator: true }).mockResolvedValueOnce({
      plugins: [], platformOperator: false,
    });
    await render();
    const activity = [...container.querySelectorAll("nav button")].find(
      (item) => item.textContent === "Plugin activity",
    );
    await act(async () => { activity?.click(); });
    expect(container.querySelector('[data-testid="failed-plugin-events"]')).not.toBeNull();
    await act(async () => { window.dispatchEvent(new Event("vibress:publication-changed")); });
    expect(container.querySelector('[data-testid="failed-plugin-events"]')).toBeNull();
    expect(container.textContent).not.toContain("Plugin activity");
    expect(container.querySelector('[data-testid="installed-plugins"]')).not.toBeNull();
  });

  it("does not expose Add Plugin to ordinary plugin readers", async () => {
    vi.mocked(listPluginsApi).mockResolvedValue({ plugins: [], platformOperator: false });
    await render();
    expect(container.textContent).toContain("Plugins");
    expect([...container.querySelectorAll("button")]
      .some((button) => button.textContent?.includes("Add Plugin"))).toBe(false);
    expect(container.querySelector('[data-testid="trusted-plugin-installer"]')).toBeNull();
  });

  it("exposes installer only to the platform operator and closes on publication switch", async () => {
    vi.mocked(listPluginsApi)
      .mockResolvedValueOnce({ plugins: [], platformOperator: true })
      .mockResolvedValueOnce({ plugins: [], platformOperator: false });
    await render();
    const addButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Add Plugin"));
    expect(addButton).toBeDefined();
    await act(async () => { addButton?.click(); });
    expect(container.querySelector('[data-testid="trusted-plugin-installer"]')).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event("vibress:publication-changed"));
    });
    expect(container.querySelector('[data-testid="trusted-plugin-installer"]')).toBeNull();
    expect([...container.querySelectorAll("button")]
      .some((button) => button.textContent?.includes("Add Plugin"))).toBe(false);
  });
});
