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
  TrustedPluginInstaller: () => <div data-testid="trusted-plugin-installer" />,
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
