import { Doc, applyUpdate, encodeStateAsUpdate } from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import { Provider } from "@lexical/yjs";
import { CollaborationUser } from "./types";

// Global hub coordinating in-memory document CRDT synchronization across instances / tabs
const documentHubs = new Map<string, Set<MemoryCollaborationProvider>>();

export class MemoryCollaborationProvider implements Provider {
  readonly doc: Doc;
  readonly rawAwareness: Awareness;
  private readonly documentId: string;
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private isConnected = false;

  constructor(documentId: string, doc?: Doc, user?: CollaborationUser) {
    this.documentId = documentId;
    this.doc = doc || new Doc();
    this.rawAwareness = new Awareness(this.doc);

    if (user) {
      this.rawAwareness.setLocalStateField("user", {
        name: user.name,
        color: user.color,
        avatar: user.avatar,
      });
    }

    this.doc.on("update", this.handleDocUpdate);
    this.rawAwareness.on("update", this.handleAwarenessUpdate);
  }

  get awareness(): any {
    return {
      getLocalState: () => this.rawAwareness.getLocalState(),
      getStates: () => this.rawAwareness.getStates(),
      off: (type: "update", cb: () => void) => {
        this.rawAwareness.off(type, cb);
      },
      on: (type: "update", cb: () => void) => {
        this.rawAwareness.on(type, cb);
      },
      setLocalState: (arg0: any) => {
        this.rawAwareness.setLocalState(arg0);
      },
      setLocalStateField: (field: string, value: unknown) => {
        this.rawAwareness.setLocalStateField(field, value);
      },
    };
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return; // Ignore self-originated update broadcasts

    const peers = documentHubs.get(this.documentId);
    if (!peers) return;

    for (const peer of peers) {
      if (peer !== this && peer.isConnected) {
        applyUpdate(peer.doc, update, this);
      }
    }
  };

  private handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return;

    const changedClients = added.concat(updated, removed);
    const update = encodeAwarenessUpdate(this.rawAwareness, changedClients);

    const peers = documentHubs.get(this.documentId);
    if (!peers) return;

    for (const peer of peers) {
      if (peer !== this && peer.isConnected) {
        applyAwarenessUpdate(peer.rawAwareness, update, this);
      }
    }
  };

  connect(): void {
    if (this.isConnected) return;
    this.isConnected = true;

    if (!documentHubs.has(this.documentId)) {
      documentHubs.set(this.documentId, new Set());
    }
    const peers = documentHubs.get(this.documentId)!;
    peers.add(this);

    // Synchronize initial state from existing connected peers
    for (const peer of peers) {
      if (peer !== this && peer.isConnected) {
        const stateUpdate = encodeStateAsUpdate(peer.doc);
        applyUpdate(this.doc, stateUpdate, this);

        // Sync initial awareness
        const awarenessUpdate = encodeAwarenessUpdate(
          peer.rawAwareness,
          Array.from(peer.rawAwareness.getStates().keys()),
        );
        applyAwarenessUpdate(this.rawAwareness, awarenessUpdate, this);
        break;
      }
    }

    this.emit("status", { status: "connected" });
    this.emit("sync", true);
  }

  disconnect(): void {
    if (!this.isConnected) return;
    this.isConnected = false;

    const peers = documentHubs.get(this.documentId);
    if (peers) {
      peers.delete(this);
      if (peers.size === 0) {
        documentHubs.delete(this.documentId);
      }
    }

    this.emit("status", { status: "disconnected" });
  }

  destroy(): void {
    this.disconnect();
    this.doc.off("update", this.handleDocUpdate);
    this.rawAwareness.off("update", this.handleAwarenessUpdate);
    this.doc.destroy();
    this.rawAwareness.destroy();
    this.listeners.clear();
  }

  on(event: string, listener: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  off(event: string, listener: (...args: any[]) => void): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  private emit(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) {
        fn(...args);
      }
    }
  }
}

export function createMemoryCollaborationProvider(
  id: string,
  user: CollaborationUser,
  yjsDocMap: Map<string, Doc>,
): MemoryCollaborationProvider {
  let doc = yjsDocMap.get(id);
  if (!doc) {
    doc = new Doc();
    yjsDocMap.set(id, doc);
  }

  const provider = new MemoryCollaborationProvider(id, doc, user);
  provider.connect();
  return provider;
}
