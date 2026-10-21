import {
  ExtensionAdminBridgeReadRequestSchema,
  ExtensionAdminBridgeReadResponseSchema,
} from "@vibress/api-contracts";

type Scalar = string | number | boolean;
const MAX_REQUESTS_PER_MINUTE = 30;
const MAX_CONCURRENT_REQUESTS = 4;

/**
 * Transfer a private MessagePort only into the Host-owned, approved document.
 * No window-level message responder, open-ended URL proxy, write method or
 * ambient Staff credential crosses the opaque-origin iframe boundary.
 */
export function connectAdminExtensionReadBridge(
  frame: HTMLIFrameElement,
  locale: string,
  isCurrent: () => boolean,
  readLinkedView: () => Promise<Record<string, Scalar>>,
): () => void {
  const target = frame.contentWindow;
  if (!target || !isCurrent()) return () => undefined;
  const channel = new MessageChannel();
  let closed = false;
  let active = 0;
  let periodStart = Date.now();
  let requestsInPeriod = 0;
  const usedIds = new Set<string>();

  function close() {
    if (closed) return;
    closed = true;
    channel.port1.onmessage = null;
    channel.port1.close();
    channel.port2.close();
    usedIds.clear();
  }

  function respond(
    requestId: string,
    result: { ok: true; data: Record<string, Scalar> } |
      { ok: false; error: "DENIED" | "UNAVAILABLE" | "RATE_LIMITED" },
  ) {
    if (closed || !isCurrent()) return;
    const response = ExtensionAdminBridgeReadResponseSchema.safeParse({
      type: "vibress:extension:response", version: 1, requestId, ...result,
    });
    if (!response.success) {
      close();
      return;
    }
    try {
      channel.port1.postMessage(response.data);
    } catch {
      close();
    }
  }

  channel.port1.onmessage = (event: MessageEvent<unknown>) => {
    if (closed || !isCurrent()) {
      close();
      return;
    }
    const parsed = ExtensionAdminBridgeReadRequestSchema.safeParse(event.data);
    if (!parsed.success) return;
    const { requestId } = parsed.data;
    if (usedIds.has(requestId)) {
      respond(requestId, { ok: false, error: "DENIED" });
      return;
    }
    usedIds.add(requestId);
    const now = Date.now();
    if (now - periodStart >= 60_000) {
      periodStart = now;
      requestsInPeriod = 0;
    }
    if (++requestsInPeriod > MAX_REQUESTS_PER_MINUTE ||
        active >= MAX_CONCURRENT_REQUESTS) {
      respond(requestId, { ok: false, error: "RATE_LIMITED" });
      return;
    }
    // IDs are bounded to prevent uncontrolled growth under long-lived frames.
    if (usedIds.size > 128) {
      respond(requestId, { ok: false, error: "RATE_LIMITED" });
      close();
      return;
    }
    active++;
    void readLinkedView().then((data) => {
      respond(requestId, { ok: true, data });
    }).catch(() => {
      respond(requestId, { ok: false, error: "UNAVAILABLE" });
    }).finally(() => {
      active--;
    });
  };

  try {
    target.postMessage({
      type: "vibress:extension:connect",
      version: 1,
      locale,
      capabilities: ["linked-view.read"],
    }, "*", [channel.port2]);
  } catch {
    close();
  }
  return close;
}
