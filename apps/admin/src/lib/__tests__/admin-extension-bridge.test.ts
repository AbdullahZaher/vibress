import { afterEach, describe, expect, it, vi } from "vitest";
import { connectAdminExtensionReadBridge } from "../extensions/admin-bridge";

class TestPort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  other: TestPort | null = null;
  closed = false;

  postMessage(data: unknown) {
    if (!this.closed && !this.other?.closed) {
      queueMicrotask(() => this.other?.onmessage?.({ data }));
    }
  }
  close() { this.closed = true; this.onmessage = null; }
}

class TestMessageChannel {
  static latest: TestMessageChannel;
  port1 = new TestPort();
  port2 = new TestPort();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
    TestMessageChannel.latest = this;
  }
}

function setup(read = vi.fn(async () => ({ total: 7 }))) {
  vi.stubGlobal("MessageChannel", TestMessageChannel);
  const frame = document.createElement("iframe");
  document.body.append(frame);
  if (!frame.contentWindow) throw new Error("Expected test iframe Window");
  const posted = vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(() => undefined);
  let current = true;
  const disconnect = connectAdminExtensionReadBridge(
    frame, "ar", () => current, read,
  );
  const port = TestMessageChannel.latest.port2;
  const responses: unknown[] = [];
  port.onmessage = (event) => responses.push(event.data);
  return {
    posted, port, responses, read, disconnect,
    revoke: () => { current = false; },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("EXT-301B2B isolated read-only MessagePort", () => {
  it("transfers only a private port, locale and linked-view.read capability", async () => {
    const t = setup();
    expect(t.posted).toHaveBeenCalledWith({
      type: "vibress:extension:connect", version: 1,
      locale: "ar", capabilities: ["linked-view.read"],
    }, "*", [TestMessageChannel.latest.port2]);
    t.port.postMessage({
      type: "vibress:extension:read", version: 1, requestId: "request-1",
    });
    await vi.waitFor(() => expect(t.responses).toHaveLength(1));
    expect(t.responses[0]).toEqual({
      type: "vibress:extension:response", version: 1,
      requestId: "request-1", ok: true, data: { total: 7 },
    });
    expect(t.read).toHaveBeenCalledTimes(1);
    t.disconnect();
  });

  it("rejects arbitrary URLs, chosen tenants, write methods and forged extra fields", async () => {
    const t = setup();
    for (const request of [
      { type: "vibress:extension:read", version: 1, requestId: "r1", url: "/admin/users" },
      { type: "vibress:extension:read", version: 1, requestId: "r2", publicationId: "foreign" },
      { type: "vibress:extension:write", version: 1, requestId: "r3", body: { role: "owner" } },
      { type: "vibress:extension:read", version: 1, requestId: "../../escape" },
    ]) t.port.postMessage(request);
    await vi.waitFor(() => expect(t.read).toHaveBeenCalledTimes(0));
    expect(t.responses).toEqual([]);
    t.disconnect();
  });

  it("does not repeat an already-used request and caps the number of reads", async () => {
    const t = setup();
    for (let n = 0; n < 32; n++) {
      t.port.postMessage({
        type: "vibress:extension:read", version: 1, requestId: `req-${n}`,
      });
    }
    await vi.waitFor(() => expect(t.responses).toHaveLength(32));
    // Concurrent cap may reject earlier requests too; nothing can exceed 30.
    expect(t.read.mock.calls.length).toBeLessThanOrEqual(30);
    expect(t.responses.some((x) => (
      typeof x === "object" && x !== null && "error" in x && x.error === "RATE_LIMITED"
    ))).toBe(true);
    const calls = t.read.mock.calls.length;
    t.port.postMessage({
      type: "vibress:extension:read", version: 1, requestId: "req-0",
    });
    await vi.waitFor(() => expect(t.responses).toHaveLength(33));
    expect(t.read).toHaveBeenCalledTimes(calls);
    t.disconnect();
  });

  it("closes access on publication switch and does not return in-flight data", async () => {
    let finish: ((data: { total: number }) => void) | undefined;
    const read = vi.fn(() => new Promise<{ total: number }>((resolve) => {
      finish = resolve;
    }));
    const t = setup(read);
    t.port.postMessage({
      type: "vibress:extension:read", version: 1, requestId: "pending",
    });
    await vi.waitFor(() => expect(t.read).toHaveBeenCalledTimes(1));
    t.revoke();
    t.disconnect();
    finish?.({ total: 1 });
    await Promise.resolve();
    expect(t.responses).toEqual([]);
    expect(t.port.closed).toBe(true);
  });

  it("does not serialize host exception details to the plugin iframe", async () => {
    const t = setup(vi.fn(async (): Promise<{ total: number }> => {
      throw new Error("Private API session or filesystem path");
    }));
    t.port.postMessage({
      type: "vibress:extension:read", version: 1, requestId: "failed",
    });
    await vi.waitFor(() => expect(t.responses).toHaveLength(1));
    expect(t.responses[0]).toEqual({
      type: "vibress:extension:response", version: 1,
      requestId: "failed", ok: false, error: "UNAVAILABLE",
    });
    expect(JSON.stringify(t.responses)).not.toContain("filesystem");
    t.disconnect();
  });
});
