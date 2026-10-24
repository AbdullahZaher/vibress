/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AdminPlugin, activatePluginApi, deactivatePluginApi, setPluginPublicationStateApi,
} from "../../../lib/api";
import { PluginsPanel } from "../PluginsPanel";

vi.mock("../../../lib/api", () => ({
  activatePluginApi: vi.fn(),
  deactivatePluginApi: vi.fn(),
  setPluginPublicationStateApi: vi.fn(),
}));
vi.mock("../../../lib/admin-locale", () => ({
  useAdminLocale: () => ({ tr: (value: string) => value }),
}));
vi.mock("../ScopedPluginSettingsEditor", () => ({
  ScopedPluginSettingsEditor: () => <div data-testid="settings" />,
}));
vi.mock("../FailedPluginEventsPanel", () => ({
  FailedPluginEventsPanel: () => <div data-testid="events" />,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const plugin = (status: string, overrides: Partial<AdminPlugin> = {}): AdminPlugin => ({
  id: "db-1",
  manifestId: "trusted-plugin",
  name: "Trusted plugin",
  version: "1.0.0",
  vibressApiVersion: "1.0.0",
  description: null,
  capabilities: ["events.subscribe"],
  status,
  publicationScoped: true,
  publicationEnabled: false,
  hostCompatible: true,
  ...overrides,
});

describe("P0-4 plugin lifecycle status and recovery UX", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onError = vi.fn();
  const onChanged = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.resetAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(status: string, overrides: Partial<AdminPlugin> = {},
    operator = true) {
    await act(async () => {
      root.render(<PluginsPanel plugins={[plugin(status, overrides)]}
        platformOperator={operator} onError={onError} onChanged={onChanged} />);
    });
  }
  const button = (node: HTMLElement, label: string) =>
    [...node.querySelectorAll("button")].find((b) => b.textContent?.includes(label));

  it("distinguishes registered, active and publication-enabled states", async () => {
    await render("registered");
    expect(container.textContent).toContain("Registered, awaiting activation");
    expect(button(container, "Activate")?.disabled).toBe(false);
    expect(button(container, "Enable for this publication")?.disabled).toBe(true);

    await render("active", { publicationEnabled: true });
    expect(container.textContent).toContain("Globally active");
    expect(container.textContent).toContain("This publication: Enabled");
    expect(button(container, "Disable for this publication")?.disabled).toBe(false);
  });

  it("blocks activation during transitions, failures and ABI incompatibility", async () => {
    for (const status of ["activating", "deactivating"]) {
      await render(status);
      expect(button(container, "Activate")?.disabled).toBe(true);
      expect(button(container, "Enable for this publication")?.disabled).toBe(true);
    }
    await render("error");
    expect(container.textContent).toContain("Activation failed");
    expect(button(container, "Retry activation")?.disabled).toBe(false);
    await render("registered", { hostCompatible: false });
    expect(container.textContent).toContain("Incompatible Host API version");
    expect(button(container, "Activate")?.disabled).toBe(true);
  });

  it("shows dormant saved publication preference and permits revocation while inactive", async () => {
    await render("inactive", {
      publicationEnabled: false, publicationConfiguredEnabled: true,
    });
    expect(container.textContent).toContain("This publication: Disabled");
    expect(container.textContent).toContain("Saved site setting: Enabled");
    expect(button(container, "Disable for this publication")?.disabled).toBe(false);
    vi.mocked(setPluginPublicationStateApi).mockResolvedValue({ pluginId: "db-1",
      publicationId: "pub-a", enabled: false });
    await act(async () => { button(container, "Disable for this publication")?.click(); });
    expect(setPluginPublicationStateApi).toHaveBeenCalledWith("db-1", false);
  });

  it("still permits safe disable/deactivate when an active plugin becomes incompatible", async () => {
    await render("active", { publicationEnabled: true, hostCompatible: false });
    expect(button(container, "Disable for this publication")?.disabled).toBe(false);
    expect(button(container, "Deactivate")?.disabled).toBe(false);
  });

  it("does not display global lifecycle actions to non-operators", async () => {
    await render("active", { publicationEnabled: false }, false);
    expect(button(container, "Deactivate")).toBeUndefined();
    expect(button(container, "Enable for this publication")).toBeDefined();
  });

  it("redacts unexpected server errors during lifecycle action", async () => {
    vi.mocked(activatePluginApi).mockRejectedValue(new Error("/operator/private/key.pem"));
    await render("registered");
    await act(async () => { button(container, "Activate")?.click(); });
    expect(onError).toHaveBeenCalledWith("Plugin action failed");
    expect(onError).not.toHaveBeenCalledWith("/operator/private/key.pem");
    expect(deactivatePluginApi).not.toHaveBeenCalled();
    expect(setPluginPublicationStateApi).not.toHaveBeenCalled();
  });
  it("searches name, manifest ID and version without changing plugin permissions", async () => {
    await act(async () => {
      root.render(<PluginsPanel plugins={[
        plugin("active", { id: "a", name: "Alpha", manifestId: "alpha" }),
        plugin("registered", { id: "b", name: "Beta", manifestId: "beta-addon", version: "2.7.0" }),
      ]} platformOperator={false} onError={onError} onChanged={onChanged} />);
    });
    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    expect(search).not.toBeNull();
    expect(search.labels?.[0]?.textContent).toBe("Search installed plugins");
    await act(async () => {
      const setNativeValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value",
      )?.set;
      setNativeValue?.call(search, "beta-addon");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Beta");
    expect(container.textContent).not.toContain("Alpha");
    expect(button(container, "Activate")).toBeUndefined();
    expect(activatePluginApi).not.toHaveBeenCalled();
  });

  it("filters lifecycle states and distinguishes no matches from no installs", async () => {
    await act(async () => {
      root.render(<PluginsPanel plugins={[
        plugin("active", { id: "active", name: "Working" }),
        plugin("error", { id: "failed", name: "Broken" }),
        plugin("inactive", { id: "old", name: "Dormant" }),
        plugin("active", { id: "legacy", name: "Incompatible", hostCompatible: false }),
      ]} platformOperator onError={onError} onChanged={onChanged} />);
    });
    const selector = container.querySelector("select") as HTMLSelectElement;
    expect(selector.labels?.[0]?.textContent).toBe("Filter plugin status");
    await act(async () => {
      selector.value = "attention";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("Broken");
    expect(container.textContent).toContain("Incompatible");
    expect(container.textContent).not.toContain("Dormant");
    expect(container.textContent).not.toContain("Working");
    await act(async () => {
      selector.value = "inactive";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("Dormant");
    expect(container.textContent).not.toContain("Broken");
    await act(async () => {
      root.render(<PluginsPanel plugins={[plugin("active")]}
        platformOperator onError={onError} onChanged={onChanged} />);
    });
    expect(container.textContent).toContain("No plugins match your search or status filter.");
    await act(async () => {
      root.render(<PluginsPanel plugins={[]}
        platformOperator onError={onError} onChanged={onChanged} />);
    });
    expect(container.textContent).toContain("No platform plugins installed.");
  });

});
