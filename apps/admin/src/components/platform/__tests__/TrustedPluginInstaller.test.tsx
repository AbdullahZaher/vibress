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
  signatureVerified: true,
  approvalId: `vibress-lms-pilot@1.0.0:${"a".repeat(64)}`,
  readiness: "verification_required" as const,
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
    expect(container.textContent).toContain("integrity verification required before registration");
    expect(container.textContent).toContain("Detached Ed25519 operator approval verified.");
    expect(container.textContent).toContain("signature verification is not sandbox isolation.");
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
    expect(registerOperatorTrustedPluginApi).toHaveBeenCalledWith(plugin.id, plugin.approvalId, false);
    expect(onRegistered).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows only the safe operator release summary and keeps acknowledgement required", async () => {
    const hash = "a".repeat(64);
    vi.mocked(listOperatorTrustedPluginsApi).mockResolvedValue({
      plugins: [{ ...plugin, release: {
        releaseId: `${plugin.id}@1.0.0:${hash}`,
        publisher: { id: "reviewed", name: "Trusted Publisher" },
        artifactSha256: hash,
        compatibility: {
          minVibressApiVersion: "1.0.0",
          maxVibressApiVersion: "1.0.0",
          sdkAbiVersion: "1.0.0",
        },
        hasSbom: true, hasProvenance: true, migrationPlanIds: ["0001_initial"],
      } }],
    });
    await render();
    expect(container.textContent).toContain("Trusted Publisher");
    expect(container.textContent).toContain("Host ABI");
    expect(container.textContent).toContain("SBOM pinned");
    expect(container.textContent).toContain("Migration plans");
    expect(container.textContent).not.toContain("/etc/vibress");
    await change(container.querySelector('input[type="radio"]') as HTMLInputElement);
    const confirm = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Register trusted plugin")) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("warns operators when approved releases are unsigned legacy lockfiles", async () => {
    vi.mocked(listOperatorTrustedPluginsApi).mockResolvedValue({
      plugins: [{ ...plugin, signatureVerified: false }],
    });
    await render();
    expect(container.textContent).toContain("Legacy unsigned operator approval");
    expect(container.textContent).not.toContain("Detached Ed25519 operator approval verified.");
  });

  it("refuses a registry entry without an immutable approval ID", async () => {
    vi.mocked(listOperatorTrustedPluginsApi).mockResolvedValue({
      plugins: [{ id: plugin.id, name: plugin.name, version: plugin.version,
        description: plugin.description, capabilities: plugin.capabilities,
        signatureVerified: plugin.signatureVerified, readiness: plugin.readiness }],
    });
    await render();
    expect(container.textContent).toContain("Immutable release identity unavailable");
    await change(container.querySelector('input[type="radio"]') as HTMLInputElement);
    await change(container.querySelector('input[type="checkbox"]') as HTMLInputElement);
    const register = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Register trusted plugin")) as HTMLButtonElement;
    expect(register.disabled).toBe(true);
    expect(registerOperatorTrustedPluginApi).not.toHaveBeenCalled();
  });

  it("does not allow blind registration when an older server omits capabilities", async () => {
    const legacy = {
      id: plugin.id, name: plugin.name, version: plugin.version,
      description: plugin.description, signatureVerified: true,
    };
    vi.mocked(listOperatorTrustedPluginsApi).mockResolvedValue({ plugins: [legacy] });
    await render();
    expect(container.textContent).toContain("Capabilities unavailable");
    await change(container.querySelector('input[type="radio"]') as HTMLInputElement);
    await change(container.querySelector('input[type="checkbox"]') as HTMLInputElement);
    const register = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Register trusted plugin")) as HTMLButtonElement;
    expect(register.disabled).toBe(true);
    expect(registerOperatorTrustedPluginApi).not.toHaveBeenCalled();
  });

  it("previews an inactive upgrade and requires explicit review of added capabilities", async () => {
    const update = { ...plugin, version: "2.0.0",
      approvalId: `${plugin.id}@2.0.0:${"b".repeat(64)}`,
      upgradeReview: { installedVersion: "1.0.0", installedStatus: "inactive",
        addedCapabilities: ["extension.routes.public"], removedCapabilities: [],
        metadataChanged: true },
    };
    vi.mocked(listOperatorTrustedPluginsApi).mockResolvedValue({ plugins: [update] });
    await act(async () => {
      root.render(<TrustedPluginInstaller installedIds={[plugin.id]}
        installedPlugins={[{ id: "db-1", manifestId: plugin.id, name: plugin.name,
          version: "1.0.0", vibressApiVersion: "1.0.0",
          description: null, capabilities: plugin.capabilities, status: "inactive" }]}
        onRegistered={onRegistered} onClose={onClose}/>);
    });
    expect(container.textContent).toContain("Added capabilities");
    expect(container.textContent).toContain("extension.routes.public");
    await change(container.querySelector('input[type="radio"]') as HTMLInputElement);
    await change(container.querySelector('input[type="checkbox"]') as HTMLInputElement);
    await click("Register reviewed update");
    expect(registerOperatorTrustedPluginApi).toHaveBeenCalledWith(
      plugin.id, update.approvalId, true,
    );
  });

  it("does not allow re-registration of an active upgrade from the UI", async () => {
    const update = { ...plugin, version: "2.0.0",
      approvalId: `${plugin.id}@2.0.0:${"b".repeat(64)}`,
      upgradeReview: { installedVersion: "1.0.0", installedStatus: "active",
        addedCapabilities: [], removedCapabilities: [], metadataChanged: true },
    };
    vi.mocked(listOperatorTrustedPluginsApi).mockResolvedValue({ plugins: [update] });
    await act(async () => {
      root.render(<TrustedPluginInstaller installedIds={[plugin.id]}
        installedPlugins={[{ id: "db-1", manifestId: plugin.id, name: plugin.name,
          version: "1.0.0", vibressApiVersion: "1.0.0",
          description: null, capabilities: plugin.capabilities, status: "active" }]}
        onRegistered={onRegistered} onClose={onClose}/>);
    });
    expect(container.textContent).toContain("Deactivate globally before registering");
    await change(container.querySelector('input[type="radio"]') as HTMLInputElement);
    await change(container.querySelector('input[type="checkbox"]') as HTMLInputElement);
    const submit = [...container.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Register reviewed update")) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("does not offer a blind version update when an older server omits upgrade review", async () => {
    vi.mocked(listOperatorTrustedPluginsApi).mockResolvedValue({ plugins: [{
      ...plugin, version: "2.0.0",
      approvalId: `${plugin.id}@2.0.0:${"b".repeat(64)}`,
    }] });
    await act(async () => {
      root.render(<TrustedPluginInstaller installedIds={[plugin.id]}
        installedPlugins={[{ id: "db-1", manifestId: plugin.id, name: plugin.name,
          version: "1.0.0", vibressApiVersion: "1.0.0",
          description: null, capabilities: plugin.capabilities, status: "inactive" }]}
        onRegistered={onRegistered} onClose={onClose}/>);
    });
    expect(container.textContent).toContain("No operator-approved plugins available.");
    expect(registerOperatorTrustedPluginApi).not.toHaveBeenCalled();
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
