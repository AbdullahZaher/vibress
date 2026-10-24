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
    for (const status of ["activating", "deactivating", "error"]) {
      await render(status);
      expect(button(container, "Activate")?.disabled).toBe(true);
      expect(button(container, "Enable for this publication")?.disabled).toBe(true);
    }
    await render("error");
    expect(container.textContent).toContain("Recovery requires maintenance");
    await render("registered", { hostCompatible: false });
    expect(container.textContent).toContain("Incompatible Host API version");
    expect(button(container, "Activate")?.disabled).toBe(true);
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
});
