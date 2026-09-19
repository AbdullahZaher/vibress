import type { WebSocket } from "ws";
import * as Y from "yjs";
import { crdtPersistence } from "./crdt-persistence";

export const MAX_CRDT_UPDATE_BYTES = 64 * 1024; // 64 KB
export const MAX_PEERS_PER_ROOM = 50;

export interface CollaborationPeer {
  id: string;
  userId: string;
  userName: string;
  socket: WebSocket;
}

export class CollaborationRoom {
  public publicationId: string;
  public postId: string;
  public peers = new Map<string, CollaborationPeer>();
  public ydoc: Y.Doc;
  private updateCountSinceCompact = 0;

  constructor(publicationId: string, postId: string) {
    this.publicationId = publicationId;
    this.postId = postId;
    this.ydoc = new Y.Doc();
  }

  addPeer(peer: CollaborationPeer): boolean {
    if (this.peers.size >= MAX_PEERS_PER_ROOM) {
      return false;
    }
    this.peers.set(peer.id, peer);
    return true;
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  get peerCount(): number {
    let active = 0;
    for (const [id, peer] of this.peers.entries()) {
      if (peer.socket.readyState === 1 /* OPEN */) {
        active++;
      } else {
        this.peers.delete(id);
      }
    }
    return active;
  }

  broadcastBinary(data: Uint8Array, senderPeerId?: string): void {
    for (const [id, peer] of this.peers.entries()) {
      if (id !== senderPeerId && peer.socket.readyState === 1 /* OPEN */) {
        try {
          peer.socket.send(data, { binary: true });
        } catch (err) {
          console.error(`[Room ${this.postId}] Error broadcasting to peer ${id}:`, err);
        }
      }
    }
  }

  broadcastString(message: string, senderPeerId?: string): void {
    for (const [id, peer] of this.peers.entries()) {
      if (id !== senderPeerId && peer.socket.readyState === 1 /* OPEN */) {
        try {
          peer.socket.send(message, { binary: false });
        } catch (err) {
          console.error(`[Room ${this.postId}] Error broadcasting text to peer ${id}:`, err);
        }
      }
    }
  }

  async recordUpdate(update: Uint8Array): Promise<void> {
    this.updateCountSinceCompact++;
    try {
      Y.applyUpdate(this.ydoc, update);
    } catch (err) {
      console.error(`[Room ${this.postId}] Error applying update to room ydoc:`, err);
    }
    await crdtPersistence.saveUpdate(this.publicationId, this.postId, update);
  }

  getCurrentStateUpdate(): Uint8Array | null {
    try {
      const state = Y.encodeStateAsUpdate(this.ydoc);
      if (state.length > 2) {
        return state;
      }
    } catch {
      // Fallback
    }
    return null;
  }
}

export class RoomManager {
  private rooms = new Map<string, CollaborationRoom>();

  private getRoomKey(publicationId: string, postId: string): string {
    return `${publicationId}:${postId}`;
  }

  getOrCreateRoom(publicationId: string, postId: string): CollaborationRoom {
    const key = this.getRoomKey(publicationId, postId);
    let room = this.rooms.get(key);
    if (!room) {
      room = new CollaborationRoom(publicationId, postId);
      this.rooms.set(key, room);
    }
    return room;
  }

  getRoom(publicationId: string, postId: string): CollaborationRoom | undefined {
    return this.rooms.get(this.getRoomKey(publicationId, postId));
  }

  removePeer(publicationId: string, postId: string, peerId: string): void {
    const key = this.getRoomKey(publicationId, postId);
    const room = this.rooms.get(key);
    if (room) {
      room.removePeer(peerId);
      if (room.peerCount === 0) {
        this.rooms.delete(key);
      }
    }
  }

  getActiveRoomCount(): number {
    return this.rooms.size;
  }

  getActivePeerCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) {
      total += room.peerCount;
    }
    return total;
  }
}

export const roomManager = new RoomManager();
