/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectAdminExtensionReadBridge } from "../admin-bridge";

interface PortStub {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}
class ChannelStub {
  readonly port1: PortStub = {
    onmessage: null, postMessage: vi.fn(), close: vi.fn(),
  };
  readonly port2: PortStub = {
    onmessage: null, postMessage: vi.fn(), close: vi.fn(),
  };
  static current: ChannelStub;
  constructor() { ChannelStub.current = this; }
}
const request = (type: "vibress:extension:read" | "vibress:extension:write",
  body?: Record<string, unknown>, requestId = "request-1") => ({
  type, version: 1, requestId, ...(body ? { body } : {}),
});
function deliver(data: unknown) {
  ChannelStub.current.port1.onmessage?.(new MessageEvent("message", { data }));
}

describe("EXT-301 bounded and confirmed Admin iframe write bridge", () => {
  let iframe: HTMLIFrameElement;
  beforeEach(() => {
    vi.stubGlobal("MessageChannel", ChannelStub);
    iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const target = iframe.contentWindow;
    if (!target) throw new Error("Missing iframe window");
    vi.spyOn(target, "postMessage").mockImplementation(() => undefined);
  });
  afterEach(() => {
    iframe.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("preserves legacy read-only API behavior by default", async () => {
    const read = vi.fn(async () => ({ count: 2 }));
    const close = connectAdminExtensionReadBridge(iframe, "ar", () => true, read);
    deliver(request("vibress:extension:write", { name: "course" }));
    expect(read).not.toHaveBeenCalled();
    deliver(request("vibress:extension:read"));
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(ChannelStub.current.port1.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, data: { count: 2 } }),
    );
    close();
  });

  it("does not issue POST without explicit Host-controlled confirmation", async () => {
    const write = vi.fn(async () => ({ saved: true }));
    const confirm = vi.fn(() => false);
    connectAdminExtensionReadBridge(iframe, "en", () => true,
      async () => ({}), write, confirm);
    deliver(request("vibress:extension:write", { title: "First" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
    expect(ChannelStub.current.port1.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "DENIED" }),
    );
  });

  it("allows a single verified scalar POST to the bound route after confirmation", async () => {
    const write = vi.fn(async () => ({ saved: true }));
    connectAdminExtensionReadBridge(iframe, "en", () => true,
      async () => ({}), write, () => true);
    deliver(request("vibress:extension:write", { title: "Course" }));
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith({ title: "Course" }));
    await vi.waitFor(() => expect(ChannelStub.current.port1.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, data: { saved: true } }),
    ));
    // The Host bridge rejects duplicate IDs even after completion.
    deliver(request("vibress:extension:write", { title: "Again" }));
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("rejects foreign authority selectors, nested values and closed frames", async () => {
    const write = vi.fn(async () => ({ saved: true }));
    let current = true;
    const close = connectAdminExtensionReadBridge(iframe, "ar", () => current,
      async () => ({}), write, () => true);
    deliver(request("vibress:extension:write", { publicationId: "other" }, "bad-tenant"));
    deliver(request("vibress:extension:write", { course: { id: "123" } }, "bad-object"));
    expect(write).not.toHaveBeenCalled();
    current = false;
    deliver(request("vibress:extension:write", { title: "Still here" }, "after-revoke"));
    expect(write).not.toHaveBeenCalled();
    close();
  });
});
