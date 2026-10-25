/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listFailedPluginEventsApi, replayFailedPluginEventApi,
} from "../../../lib/api";
import { FailedPluginEventsPanel } from "../FailedPluginEventsPanel";

vi.mock("../../../lib/admin-locale", () => ({
  useAdminLocale: () => ({ tr: (value: string) => value }),
}));
vi.mock("../../../lib/api", () => ({
  listFailedPluginEventsApi: vi.fn(),
  replayFailedPluginEventApi: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const item = {
  eventId: "b87baf96-7459-4118-bd9f-152d70eb1cb0",
  jobId: "plugin-" + "a".repeat(64),
  attemptsMade: 5,
  status: "failed" as const,
};

describe("Operator failed plugin event UI", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onError = vi.fn();
  const buttons = () => Array.from(container.querySelectorAll("button"));
  const click = async (name: string) => {
    const button = buttons().find((b) => b.textContent?.includes(name));
    if (!button) throw new Error("Missing button: " + name);
    await act(async () => { button.click(); });
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listFailedPluginEventsApi).mockResolvedValue({
      items: [item], nextOffset: 1,
    });
    vi.mocked(replayFailedPluginEventApi).mockResolvedValue({
      ...item, status: "requeued",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("requires a second explicit confirmation before submitting a replay", async () => {
    await act(async () => root.render(
      <FailedPluginEventsPanel pluginId="plugin-a" onError={onError} />,
    ));
    await click("Failed plugin events");
    expect(listFailedPluginEventsApi).toHaveBeenCalledWith("plugin-a", 0);
    expect(container.textContent).toContain(item.eventId);
    expect(container.textContent).not.toContain("private-post");
    await click("Review replay");
    expect(replayFailedPluginEventApi).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("may run the same operation again");
    await click("Confirm replay");
    expect(replayFailedPluginEventApi).toHaveBeenCalledOnce();
    expect(replayFailedPluginEventApi).toHaveBeenCalledWith(
      "plugin-a", item.eventId,
    );
    expect(container.textContent).not.toContain(item.eventId);
  });

  it("redacts secret-bearing API errors from both failed-event reads and replays", async () => {
    vi.mocked(listFailedPluginEventsApi).mockRejectedValueOnce(
      new Error("/operator/secret-key.pem private payload"),
    );
    await act(async () => root.render(
      <FailedPluginEventsPanel pluginId="plugin-a" onError={onError} />,
    ));
    await click("Failed plugin events");
    expect(onError).toHaveBeenCalledWith("Failed to load plugin events");
    expect(JSON.stringify(onError.mock.calls)).not.toContain("secret-key.pem");

    vi.mocked(listFailedPluginEventsApi).mockResolvedValueOnce({
      items: [item], nextOffset: 1,
    });
    await click("Failed plugin events");
    await click("Failed plugin events");
    await click("Review replay");
    vi.mocked(replayFailedPluginEventApi).mockRejectedValueOnce(
      new Error("private Redis credential"),
    );
    await click("Confirm replay");
    expect(onError).toHaveBeenCalledWith("Plugin event replay failed");
    expect(JSON.stringify(onError.mock.calls)).not.toContain("private Redis credential");
  });

  it("drops loaded event IDs and closes the view on publication change", async () => {
    await act(async () => root.render(
      <FailedPluginEventsPanel pluginId="plugin-a" onError={onError} />,
    ));
    await click("Failed plugin events");
    expect(container.textContent).toContain(item.eventId);
    await act(async () => {
      window.dispatchEvent(new Event("vibress:publication-changed"));
    });
    expect(container.textContent).not.toContain(item.eventId);
    expect(container.querySelector('[aria-expanded="false"]')).not.toBeNull();
  });
});
