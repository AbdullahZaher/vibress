import * as Y from "yjs";
import { CollaborationUser, CollaborationProvider } from "./types";


export interface WebSocketCollaborationOptions {
  url: string;
  docId: string;
  user: CollaborationUser;
  authToken?: string | undefined;
  reconnectIntervalMs?: number | undefined;
  maxReconnectAttempts?: number | undefined;
}

export class WebSocketCollaborationProvider implements CollaborationProvider {
  public doc: Y.Doc;
  private options: WebSocketCollaborationOptions;
  private ws: WebSocket | null = null;
  private localState: Record<string, unknown> | null = null;
  private remoteStates = new Map<number, Record<string, unknown>>();
  private awarenessListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isDestroyed = false;

  constructor(doc: Y.Doc, options: WebSocketCollaborationOptions) {
    this.doc = doc;
    this.options = options;

    this.localState = {
      user: {
        name: options.user.name,
        color: options.user.color,
      },
    };

    // Listen for local doc updates to send to server
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== this && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(update);
      }
    });

    this.connect();
  }

  get awareness(): any {
    return {
      getLocalState: () => this.localState,
      getStates: () => {
        const states = new Map<number, Record<string, unknown>>(this.remoteStates);
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
        this.localState = { ...(this.localState || {}), [field]: value };
        this.broadcastAwareness();
      },
    };
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
    if (this.isDestroyed || typeof WebSocket === "undefined") return;

    try {
      const url = new URL(this.options.url);
      url.searchParams.set("docId", this.options.docId);
      if (this.options.authToken) {
        url.searchParams.set("token", this.options.authToken);
      }

      this.ws = new WebSocket(url.toString());
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.broadcastAwareness();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          const update = new Uint8Array(event.data);
          Y.applyUpdate(this.doc, update, this);
        } else if (typeof event.data === "string") {
          try {
            const parsed = JSON.parse(event.data);
            if (parsed.type === "awareness" && parsed.clientId && parsed.state) {
              this.remoteStates.set(parsed.clientId, parsed.state);
              this.notifyAwarenessChange();
            }
          } catch {
            // Ignore non-JSON control messages
          }
        }
      };

      this.ws.onclose = () => {
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch (err) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return;
    const maxAttempts = this.options.maxReconnectAttempts || 10;
    if (this.reconnectAttempts >= maxAttempts) return;

    const baseDelay = this.options.reconnectIntervalMs || 1000;
    const delay = Math.min(baseDelay * Math.pow(1.5, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private broadcastAwareness(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.localState) {
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
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.disconnect();
    this.remoteStates.clear();
    this.awarenessListeners.clear();
  }
}
