/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrustedPluginInstaller } from "../TrustedPluginInstaller";
import { listOperatorTrustedPluginsApi, registerOperatorTrustedPluginApi } from "../../../lib/api";

vi.mock("../../../lib/admin-locale", () => {
  const tr = (value: string) => value;
  return { useAdminLocale: () => ({ tr }) };
});
vi.mock("../../../lib/api", () => ({
  listOperatorTrustedPluginsApi: vi.fn(),
  registerOperatorTrustedPluginApi: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const plugin = {
  id: "vibress-lms-pilot",
  name: "Vibress LMS",
  version: "1.0.0",
  description: "Pilot LMS",
  capabilities: ["extension.routes.member", "extension.member_storage.write"],
};

describe("Operator-approved Add Plugin", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onRegistered = vi.fn(async () => undefined);
  const onClose = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listOperatorTrustedPluginsApi).mockResolvedValue({ plugins: [plugin] });
    vi.mocked(registerOperatorTrustedPluginApi).mockResolvedValue({
      plugin: { id: "db-1", manifestId: plugin.id, name: plugin.name, version: plugin.version,
        vibressApiVersion: "1.0.0", description: null, capabilities: plugin.capabilities, status: "registered" },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  async function render(installedIds: string[] = []) {
    await act(async () => {
      root.render(<TrustedPluginInstaller installedIds={installedIds}
        onRegistered={onRegistered} onClose={onClose} />);
    });
  }
  async function click(text: string) {
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
    if (!button) throw new Error("Missing button " + text);
    await act(async () => { button.click(); });
  }
  async function change(input: HTMLInputElement) {
    await act(async () => {
      input.click();
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("requires selection and explicit acknowledgement before registering", async () => {
    await render();
    expect(container.textContent).toContain("extension.member_storage.write");
    expect(container.textContent).toContain("They cannot be installed directly in Studio.");
    const registerButton = [...container.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Register trusted plugin"));
    expect(registerButton).toBeUndefined();
    await change(container.querySelector('input[type="radio"]') as HTMLInputElement);
    expect(registerOperatorTrustedPluginApi).not.toHaveBeenCalled();
    const confirm = [...container.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Register trusted plugin")) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await change(container.querySelector('input[type="checkbox"]') as HTMLInputElement);
    await click("Register trusted plugin");
    expect(registerOperatorTrustedPluginApi).toHaveBeenCalledOnce();
    expect(registerOperatorTrustedPluginApi).toHaveBeenCalledWith(plugin.id);
    expect(onRegistered).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not list already registered releases", async () => {
    await render([plugin.id]);
    expect(container.textContent).toContain("No operator-approved plugins available.");
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    expect(registerOperatorTrustedPluginApi).not.toHaveBeenCalled();
  });

  it("fails closed when the registry request fails", async () => {
    vi.mocked(listOperatorTrustedPluginsApi).mockRejectedValue(new Error("/operator/private/path"));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe("Unable to load approved plugins.");
    expect(container.textContent).not.toContain("/operator/private/path");
    expect(container.querySelector('input[type="radio"]')).toBeNull();
  });

  it("does not close or report success when registration fails", async () => {
    vi.mocked(registerOperatorTrustedPluginApi).mockRejectedValue(new Error("/private/key"));
    await render();
    await change(container.querySelector('input[type="radio"]') as HTMLInputElement);
    await change(container.querySelector('input[type="checkbox"]') as HTMLInputElement);
    await click("Register trusted plugin");
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe("Unable to register approved plugin.");
    expect(container.textContent).not.toContain("/private/key");
    expect(onRegistered).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
