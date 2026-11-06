import * as Y from "yjs";
import { CollaborationUser, CollaborationProvider } from "./types";

export interface WebSocketCollaborationOptions {
  url: string;
  docId: string;
  user: CollaborationUser;
  authToken?: string | undefined;
  reconnectIntervalMs?: number | undefined;
  maxReconnectAttempts?: number | undefined;
  autoConnect?: boolean | undefined;
}

export class WebSocketCollaborationProvider implements CollaborationProvider {
  public doc: Y.Doc;
  private options: WebSocketCollaborationOptions;
  private ws: WebSocket | null = null;
  private localState: Record<string, unknown> | null = null;
  private remoteStates = new Map<number, Record<string, unknown>>();
  private awarenessListeners = new Map<
    string,
    Set<(...args: unknown[]) => void>
  >();
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private syncTimeout: ReturnType<typeof setTimeout> | null = null;
  private synced = false;
  private isDestroyed = false;
  private manualDisconnect = false;
  private isFencedOut = false;
  private handshakeAcked = false;
  private boundEpoch: number | null = null;
  private boundGenerationId: string | null = null;
  public currentEpoch = 1;
  public currentGenerationId: string | null = null;

  private readonly handleDocUpdate = (
    update: Uint8Array,
    origin: unknown,
  ): void => {
    if (
      origin !== this &&
      !this.isDestroyed &&
      !this.isFencedOut &&
      this.synced &&
      this.handshakeAcked &&
      this.ws &&
      this.ws.readyState === WebSocket.OPEN
    ) {
      this.ws.send(update);
    }
  };

  constructor(doc: Y.Doc, options: WebSocketCollaborationOptions) {
    this.doc = doc;
    this.options = options;

    this.localState = {
      user: {
        name: options.user.name,
        color: options.user.color,
      },
    };

    // Listen for local doc updates to send to server only after sync barrier completes
    this.doc.on("update", this.handleDocUpdate);

    // Note: Lexical's CollaborationPlugin invokes provider.connect() inside useEffect
    // AFTER registering observeDeep and sync listeners. Only auto-connect in constructor
    // if explicitly requested by standalone callers.
    if (options.autoConnect === true) {
      this.connect();
    }
  }

  get awareness(): any {
    return {
      getLocalState: () => this.localState,
      getStates: () => {
        const states = new Map<number, Record<string, unknown>>(
          this.remoteStates,
        );
        if (this.localState) {
          states.set(this.doc.clientID, this.localState);
        }
        return states;
      },
      on: (event: string, handler: (...args: unknown[]) => void) => {
        if (!this.awarenessListeners.has(event)) {
          this.awarenessListeners.set(event, new Set());
        }
        this.awarenessListeners.get(event)?.add(handler);
      },
      off: (event: string, handler: (...args: unknown[]) => void) => {
        this.awarenessListeners.get(event)?.delete(handler);
      },
      setLocalState: (state: Record<string, unknown> | null) => {
        this.localState = state;
        this.broadcastAwareness();
      },
      setLocalStateField: (field: string, value: unknown) => {
        if (field === "__proto__" || field === "constructor" || field === "prototype") {
          return;
        }
        this.localState = { ...(this.localState || {}), [field]: value };
        this.broadcastAwareness();
      },
    };
  }

  public emit(type: string, args: unknown[] = []): void {
    const handlers = this.awarenessListeners.get(type);
    if (handlers) {
      handlers.forEach((h) => h(...args));
    }
  }

  public on(type: string, cb: (...args: any[]) => void): void {
    if (!this.awarenessListeners.has(type)) {
      this.awarenessListeners.set(type, new Set());
    }
    this.awarenessListeners.get(type)?.add(cb);
  }

  public off(type: string, cb: (...args: any[]) => void): void {
    this.awarenessListeners.get(type)?.delete(cb);
  }

  public connect(): void {
    if (
      this.isDestroyed ||
      this.isFencedOut ||
      typeof WebSocket === "undefined"
    ) {
      return;
    }

    this.manualDisconnect = false;

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    try {
      const url = new URL(this.options.url);
      url.searchParams.set("docId", this.options.docId);
      if (this.options.authToken) {
        url.searchParams.set("token", this.options.authToken);
      }
      if (this.boundEpoch !== null) {
        url.searchParams.set("epoch", String(this.boundEpoch));
      }
      if (this.boundGenerationId !== null) {
        url.searchParams.set("generationId", this.boundGenerationId);
      }

      const socket = new WebSocket(url.toString());
      socket.binaryType = "arraybuffer";
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws !== socket) return;
        this.reconnectAttempts = 0;
        this.synced = false;
        this.handshakeAcked = false;
        this.broadcastAwareness();
        this.emit("status", [{ status: "connected" }]);
        if (this.syncTimeout) clearTimeout(this.syncTimeout);
        // UI-only sync indicator: never enables sending binary updates (handshakeAcked gates that).
        this.syncTimeout = setTimeout(() => {
          if (this.ws === socket && !this.synced && !this.isFencedOut) {
            this.synced = true;
            this.emit("sync", [true]);
          }
        }, 2500);
      };

      socket.onmessage = (event: MessageEvent) => {
        if (this.ws !== socket || this.isFencedOut) return;

        if (event.data instanceof ArrayBuffer) {
          const update = new Uint8Array(event.data);
          try {
            Y.applyUpdate(this.doc, update, this);
          } catch {
            // Malformed remote frame must never crash the editor session
          }
        } else if (typeof event.data === "string") {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed.type === "sync-init") {
              const incomingEpoch =
                typeof parsed.epoch === "number" ? parsed.epoch : 1;
              const incomingGen =
                typeof parsed.generationId === "string"
                  ? parsed.generationId
                  : null;

              // If this Y.Doc was previously bound to an older generation, refuse to merge
              // old Yjs items with the new generation and request a clean host re-mount!
              if (
                (this.boundEpoch !== null && incomingEpoch !== this.boundEpoch) ||
                (this.boundGenerationId !== null &&
                  incomingGen !== null &&
                  incomingGen !== this.boundGenerationId)
              ) {
                this.isFencedOut = true;
                this.synced = false;
                this.emit("restore", [
                  {
                    type: "restore",
                    epoch: incomingEpoch,
                    generationId: incomingGen,
                    content: parsed.restoredContent,
                  },
                ]);
                this.disconnect();
                return;
              }
              this.currentEpoch = incomingEpoch;
              if (incomingGen) {
                this.currentGenerationId = incomingGen;
              }
            } else if (parsed.type === "sync-done") {
              if (typeof parsed.epoch === "number") {
                this.currentEpoch = parsed.epoch;
                this.boundEpoch = parsed.epoch;
              }
              if (typeof parsed.generationId === "string") {
                this.currentGenerationId = parsed.generationId;
                this.boundGenerationId = parsed.generationId;
              }
              if (this.syncTimeout) {
                clearTimeout(this.syncTimeout);
                this.syncTimeout = null;
              }
              // Complete server-enforced generation handshake BEFORE enabling local writes
              if (
                socket.readyState === WebSocket.OPEN &&
                typeof parsed.generationId === "string" &&
                typeof parsed.challengeNonce === "string"
              ) {
                socket.send(
                  JSON.stringify({
                    type: "ack-sync",
                    epoch: this.currentEpoch,
                    generationId: parsed.generationId,
                    challengeNonce: parsed.challengeNonce,
                    clientId: this.doc.clientID,
                  }),
                );
                this.handshakeAcked = true;
              }
              this.synced = true;
              this.emit("sync", [true]);
              // Flush only the delta the server lacks (server state vector) so reconnect flushes
              // stay under the 64 KB frame cap for large documents.
              if (
                this.handshakeAcked &&
                socket.readyState === WebSocket.OPEN &&
                !this.isFencedOut
              ) {
                try {
                  let serverSv: Uint8Array | undefined;
                  if (typeof parsed.stateVector === "string") {
                    const bin = atob(parsed.stateVector);
                    serverSv = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) serverSv[i] = bin.charCodeAt(i);
                  }
                  const pendingLocal = serverSv
                    ? Y.encodeStateAsUpdate(this.doc, serverSv)
                    : Y.encodeStateAsUpdate(this.doc);
                  if (pendingLocal.length > 2) {
                    socket.send(pendingLocal);
                  }
                } catch {
                  // Ignore encoding error
                }
              }
            } else if (parsed.type === "restore") {
              // Server invalidated this generation due to revision restore.
              // Fence this provider permanently so old Y.Doc updates can never be sent,
              // and notify host to mount a fresh Y.Doc on the new generation.
              this.isFencedOut = true;
              this.synced = false;
              this.emit("restore", [parsed]);
              this.disconnect();
            } else if (parsed.type === "awareness" && typeof parsed.clientId === "number") {
              if (parsed.state === null) {
                this.remoteStates.delete(parsed.clientId);
                this.notifyAwarenessChange();
              } else if (parsed.state && typeof parsed.state === "object") {
                this.remoteStates.set(parsed.clientId, parsed.state);
                this.notifyAwarenessChange();
              }
            }
          } catch {
            // Ignore non-JSON control messages
          }
        }
      };

      socket.onclose = (event: CloseEvent) => {
        if (this.ws === socket) {
          this.ws = null;
        }
        if (this.syncTimeout) {
          clearTimeout(this.syncTimeout);
          this.syncTimeout = null;
        }
        this.synced = false;
        this.emit("status", [{ status: "disconnected" }]);
        this.emit("sync", [false]);

        if (event.code === 4409) {
          this.isFencedOut = true;
          this.emit("epoch-conflict", [{ code: event.code, reason: event.reason }]);
          return;
        }

        if (!this.manualDisconnect && !this.isDestroyed && !this.isFencedOut) {
          this.scheduleReconnect();
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    } catch {
      if (!this.manualDisconnect && !this.isDestroyed && !this.isFencedOut) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed || this.manualDisconnect || this.isFencedOut) return;
    const maxAttempts = this.options.maxReconnectAttempts || 10;
    if (this.reconnectAttempts >= maxAttempts) return;

    const baseDelay = this.options.reconnectIntervalMs || 1000;
    const delay = Math.min(
      baseDelay * Math.pow(1.5, this.reconnectAttempts),
      30000,
    );
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  private broadcastAwareness(): void {
    if (
      !this.isFencedOut &&
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      this.localState
    ) {
      this.ws.send(
        JSON.stringify({
          type: "awareness",
          clientId: this.doc.clientID,
          state: this.localState,
        }),
      );
    }
    this.notifyAwarenessChange();
  }

  private notifyAwarenessChange(): void {
    const handlers = this.awarenessListeners.get("change");
    if (handlers) {
      handlers.forEach((h) => h({ added: [], updated: [], removed: [] }));
    }
  }

  public disconnect(): void {
    this.manualDisconnect = true;
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }
    this.synced = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // Ignore
      }
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.doc.off("update", this.handleDocUpdate);
    this.disconnect();
    this.remoteStates.clear();
    this.awarenessListeners.clear();
  }
}
