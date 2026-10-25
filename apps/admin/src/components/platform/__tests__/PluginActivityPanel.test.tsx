/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { listPluginActivityApi } from "../../../lib/api";
import { PluginActivityPanel } from "../PluginActivityPanel";

vi.mock("../../../lib/admin-locale", () => ({
  useAdminLocale: () => ({
    tr: (s: string) => s,
    formatDate: (date: string) => date.slice(0, 10),
  }),
}));
vi.mock("../../../lib/api", () => ({ listPluginActivityApi: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("PLUG-OPS-06 operator-only plugin audit UI", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onError = vi.fn();
  const click = async (label: string) => {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find(item => item.textContent?.includes(label));
    if (!button) throw new Error("Missing button: " + label);
    await act(async () => { button.click(); });
  };
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
  const item = {
    action: "plugin.publication_secret_revoked" as const,
    createdAt: "2026-10-25T12:00:00.000Z",
  };

  it("loads bounded audited actions and pages without exposing raw identifiers", async () => {
    vi.mocked(listPluginActivityApi)
      .mockResolvedValueOnce({ items: [item], nextOffset: 25 })
      .mockResolvedValueOnce({ items: [
        { action: "plugin.event_replay_requested", createdAt: "2026-10-24T11:00:00.000Z" },
      ], nextOffset: null });
    await act(async () => root.render(
      <PluginActivityPanel pluginId="plugin-a" onError={onError} />,
    ));
    await click("Plugin audit history");
    expect(listPluginActivityApi).toHaveBeenCalledWith("plugin-a", 0);
    expect(container.textContent).toContain("Plugin secret revoked");
    expect(container.querySelector("time")?.getAttribute("datetime"))
      .toBe(item.createdAt);
    await click("Load more activity");
    expect(listPluginActivityApi).toHaveBeenCalledWith("plugin-a", 25);
    expect(container.textContent).toContain("Plugin event replay requested");
    expect(container.textContent).not.toContain("Load more activity");
  });

  it("clears in-flight history on publication switch and redacts raw errors", async () => {
    let resolveFetch: (value: { items: typeof item[]; nextOffset: null }) => void = () => {};
    vi.mocked(listPluginActivityApi).mockImplementationOnce(() => new Promise(resolve => {
      resolveFetch = resolve;
    }));
    await act(async () => root.render(
      <PluginActivityPanel pluginId="plugin-a" onError={onError} />,
    ));
    await click("Plugin audit history");
    await act(async () => {
      window.dispatchEvent(new Event("vibress:publication-changed"));
    });
    await act(async () => resolveFetch({ items: [item], nextOffset: null }));
    expect(container.textContent).not.toContain("Plugin secret revoked");
    expect(container.querySelector('[aria-expanded="false"]')).not.toBeNull();

    vi.mocked(listPluginActivityApi).mockRejectedValueOnce(
      new Error("operator private key / publication identity"),
    );
    await click("Plugin audit history");
    expect(onError).toHaveBeenCalledWith("Failed to load plugin activity");
    expect(JSON.stringify(onError.mock.calls)).not.toContain("private key");
  });
});
