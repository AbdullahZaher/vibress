import {
  ExtensionAdminBridgeReadRequestSchema,
  ExtensionAdminBridgeReadResponseSchema,
  ExtensionAdminBridgeWriteRequestSchema,
} from "@vibress/api-contracts";

type Scalar = string | number | boolean;
const MAX_REQUESTS_PER_MINUTE = 30;
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_WRITES_PER_MINUTE = 5;

/**
 * Transfer a private MessagePort only into the Host-owned, approved document.
 * No window-level message responder, open-ended URL proxy or ambient Staff
 * credential crosses the opaque-origin iframe boundary. Optional writes must
 * target only the Host-linked route and require Host-owned user confirmation.
 */
export function connectAdminExtensionReadBridge(
  frame: HTMLIFrameElement,
  locale: string,
  isCurrent: () => boolean,
  readLinkedView: () => Promise<Record<string, Scalar>>,
  writeLinkedView?: (body: Readonly<Record<string, Scalar>>) => Promise<Record<string, Scalar>>,
  confirmWrite?: () => boolean,
): () => void {
  const target = frame.contentWindow;
  if (!target || !isCurrent()) return () => undefined;
  const channel = new MessageChannel();
  let closed = false;
  let active = 0;
  let periodStart = Date.now();
  let requestsInPeriod = 0;
  let writesInPeriod = 0;
  let writeActive = false;
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
    const read = ExtensionAdminBridgeReadRequestSchema.safeParse(event.data);
    const write = ExtensionAdminBridgeWriteRequestSchema.safeParse(event.data);
    if (!read.success && !write.success) return;
    // An older read-only iframe must retain the original silent-reject
    // contract for unsupported writes. Do not reserve a request ID or
    // disclose a new response type when the Host has no write capability.
    if (write.success && (!writeLinkedView || !confirmWrite)) return;
    const requestId = write.success ? write.data.requestId
      : read.success ? read.data.requestId : "";
    if (!requestId) return;
    if (usedIds.has(requestId)) {
      respond(requestId, { ok: false, error: "DENIED" });
      return;
    }
    usedIds.add(requestId);
    const now = Date.now();
    if (now - periodStart >= 60_000) {
      periodStart = now;
      requestsInPeriod = 0;
      writesInPeriod = 0;
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
    if (write.success) {
      // The opaque frame cannot manufacture a trusted user gesture. Require
      // a Host-controlled confirmation for EVERY write; never proxy credentials
      // or use plugin-supplied paths. One confirmation can be open at a time.
      if (!writeLinkedView || !confirmWrite || writeActive ||
          ++writesInPeriod > MAX_WRITES_PER_MINUTE) {
        respond(requestId, { ok: false, error: "DENIED" });
        return;
      }
      writeActive = true;
      active++;
      let consent: boolean;
      try {
        consent = confirmWrite();
      } catch {
        consent = false;
      }
      if (!consent || !isCurrent() || closed) {
        respond(requestId, { ok: false, error: "DENIED" });
        active--;
        writeActive = false;
        return;
      }
      void writeLinkedView(write.data.body).then((data) => {
        respond(requestId, { ok: true, data });
      }).catch(() => {
        respond(requestId, { ok: false, error: "UNAVAILABLE" });
      }).finally(() => {
        active--;
        writeActive = false;
      });
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
      capabilities: writeLinkedView && confirmWrite
        ? ["linked-view.read", "linked-view.write"] : ["linked-view.read"],
    }, "*", [channel.port2]);
  } catch {
    close();
  }
  return close;
}
