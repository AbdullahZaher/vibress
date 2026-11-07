import type { WebSocket } from "ws";
import * as Y from "yjs";
import {
  crdtPersistence,
  CrdtPersistenceError,
  extractClientIdsFromDoc,
  extractClientIdsFromUpdate,
  validateYjsUpdateBinary,
} from "./crdt-persistence";

export const MAX_CRDT_UPDATE_BYTES = 64 * 1024; // 64 KB
export const MAX_AWARENESS_FRAME_BYTES = 4 * 1024; // 4 KB
export const MAX_PEERS_PER_ROOM = 50;

export interface CollaborationPeer {
  id: string;
  userId: string;
  userName: string;
  socket: WebSocket;
  epoch: number;
  generationId: string;
  challengeNonce: string;
  fenced: boolean;
  handshakeComplete: boolean;
  canEdit?: boolean | undefined;
  clientId?: number | undefined;
}

export type UpdateValidationResult =
  | { allowed: true }
  | { allowed: false; closeCode: number; reason: string };

export class CollaborationRoom {
  public publicationId: string;
  public postId: string;
  public epoch: number = 1;
  public generationId: string;
  public peers = new Map<string, CollaborationPeer>();
  public ydoc: Y.Doc;
  public revokedClientIds = new Set<number>();
  public restorationBarrierActive = false;
  public requiresRecovery = false;
  public restoredContent: unknown = null;
  private hydrated = false;
  private updateCountSinceCompact = 0;
  /** Serialize persistence/compaction so concurrent socket and HTTP writes cannot race. */
  private pendingWrite: Promise<void> = Promise.resolve();

  public isHydrated(): boolean {
    return this.hydrated;
  }

  public getStateVector(): Uint8Array {
    return Y.encodeStateVector(this.ydoc);
  }

  constructor(
    publicationId: string,
    postId: string,
    epoch: number = 1,
    generationId?: string,
  ) {
    this.publicationId = publicationId;
    this.postId = postId;
    this.epoch = epoch;
    this.generationId =
      generationId || crdtPersistence.mintGenerationId(epoch);
    this.ydoc = new Y.Doc();
  }

  public beginRestorationBarrier(): number[] {
    this.restorationBarrierActive = true;
    return extractClientIdsFromDoc(this.ydoc);
  }

  public abortRestorationBarrier(): void {
    if (!this.requiresRecovery) {
      this.restorationBarrierActive = false;
    }
  }

  public markRequiresRecovery(
    targetEpoch: number,
    generationId: string,
    docContent: unknown,
    revokedIds: Iterable<number> = [],
  ): void {
    this.requiresRecovery = true;
    this.restorationBarrierActive = true;
    this.hydrated = false;
    for (const id of extractClientIdsFromDoc(this.ydoc)) {
      this.revokedClientIds.add(id);
    }
    for (const id of revokedIds) {
      this.revokedClientIds.add(id);
    }
    this.epoch = targetEpoch;
    this.generationId = generationId;
    this.restoredContent = docContent;
    try {
      this.ydoc.destroy();
    } catch {
      // Ignore
    }
    this.ydoc = new Y.Doc();
    for (const peer of this.peers.values()) {
      peer.fenced = true;
      peer.handshakeComplete = false;
    }
  }

  public applyCommittedRestoration(params: {
    epoch: number;
    generationId: string;
    snapshot: Uint8Array;
    docContent: unknown;
    title?: string | undefined;
    postVersion?: number | undefined;
    revokedClientIds?: Iterable<number> | undefined;
  }): void {
    for (const id of extractClientIdsFromDoc(this.ydoc)) {
      this.revokedClientIds.add(id);
    }
    if (params.revokedClientIds) {
      for (const id of params.revokedClientIds) {
        this.revokedClientIds.add(id);
      }
    }

    // Permanently fence every pre-existing socket; old sockets may NEVER publish on the new generation
    for (const peer of this.peers.values()) {
      peer.fenced = true;
      peer.handshakeComplete = false;
    }

    this.epoch = params.epoch;
    this.generationId = params.generationId;
    this.restoredContent = params.docContent;
    this.updateCountSinceCompact = 0;

    try {
      this.ydoc.destroy();
    } catch {
      // Ignore
    }
    this.ydoc = new Y.Doc();
    Y.applyUpdate(this.ydoc, params.snapshot);

    this.requiresRecovery = false;
    this.restorationBarrierActive = false;
    this.hydrated = true;

    const message = JSON.stringify({
      type: "restore",
      epoch: this.epoch,
      generationId: this.generationId,
      content: params.docContent,
      ...(params.title !== undefined ? { title: params.title } : {}),
      ...(params.postVersion !== undefined ? { version: params.postVersion } : {}),
    });
    this.broadcastString(message);
  }

  /**
   * Legacy helper kept for internal/unit callers; delegates to durable snapshot initialization.
   */
  resetWithDocument(
    epoch: number,
    docContent: unknown,
    generationId?: string,
    snapshot?: Uint8Array,
    revokedClientIds?: Iterable<number>,
  ): void {
    const nextGen = generationId || crdtPersistence.mintGenerationId(epoch);
    let seedSnapshot = snapshot;
    if (!seedSnapshot) {
      const seedDoc = new Y.Doc();
      const meta = seedDoc.getMap("__vibress_meta");
      meta.set("epoch", epoch);
      meta.set("generationId", nextGen);
      meta.set("canonicalDocument", docContent ?? null);
      meta.set("restoredAt", new Date().toISOString());
      seedSnapshot = Y.encodeStateAsUpdate(seedDoc);
      seedDoc.destroy();
    }
    this.applyCommittedRestoration({
      epoch,
      generationId: nextGen,
      snapshot: seedSnapshot,
      docContent,
      revokedClientIds,
    });
  }

  public hydrateFromDurableState(params: {
    epoch: number;
    generationId: string;
    revokedClientIds: Iterable<number>;
    snapshot: Uint8Array | null;
    updates: Uint8Array[];
    restoredContent?: unknown;
    restoreStatus?: string | undefined;
  }): void {
    for (const id of params.revokedClientIds) {
      this.revokedClientIds.add(id);
    }

    if (
      params.restoreStatus === "REQUIRES_RECOVERY" ||
      params.restoreStatus === "IN_PROGRESS"
    ) {
      this.restorationBarrierActive = true;
      if (params.restoreStatus === "REQUIRES_RECOVERY") {
        this.requiresRecovery = true;
      }
      return;
    }

    // Monotonic generation guard (P0-2): never regress room.epoch or overwrite an active
    // restoration barrier with a stale snapshot captured during an async preValidation race.
    if (
      this.restorationBarrierActive ||
      this.requiresRecovery ||
      params.epoch < this.epoch
    ) {
      return;
    }

    // Live room on the same generation already holds authoritative in-memory Yjs state
    if (
      params.epoch === this.epoch &&
      params.generationId === this.generationId &&
      this.hydrated
    ) {
      return;
    }

    const generationChanged =
      this.epoch !== params.epoch || this.generationId !== params.generationId;

    this.epoch = params.epoch;
    this.generationId = params.generationId;
    if (params.restoredContent !== undefined) {
      this.restoredContent = params.restoredContent;
    }
    if (generationChanged) {
      try {
        this.ydoc.destroy();
      } catch {
        // Ignore
      }
      this.ydoc = new Y.Doc();
    }
    if (params.snapshot) {
      try {
        Y.applyUpdate(this.ydoc, params.snapshot);
      } catch (err) {
        console.warn(`[Room ${this.postId}] Failed to hydrate snapshot:`, err);
      }
    }
    for (const update of params.updates) {
      try {
        Y.applyUpdate(this.ydoc, update);
      } catch (err) {
        console.warn(`[Room ${this.postId}] Failed to hydrate update:`, err);
      }
    }
    this.hydrated = true;
  }

  public validateIncomingUpdate(
    peer: CollaborationPeer,
    update: Uint8Array,
  ): UpdateValidationResult {
    if (this.restorationBarrierActive || this.requiresRecovery) {
      return {
        allowed: false,
        closeCode: 4409,
        reason:
          "Conflict: Document was restored to revision. Synchronization barrier is active.",
      };
    }

    if (
      peer.fenced ||
      peer.epoch !== this.epoch ||
      peer.generationId !== this.generationId
    ) {
      return {
        allowed: false,
        closeCode: 4409,
        reason:
          "Conflict: Document was restored to revision. Client must sync to current epoch.",
      };
    }

    // Once any restoration has occurred (epoch >= 2), peers MUST complete the
    // challenge-bound sync handshake before publishing binary updates.
    if (this.epoch >= 2 && !peer.handshakeComplete) {
      return {
        allowed: false,
        closeCode: 4409,
        reason:
          "Conflict: Document was restored to revision. Client must complete generation handshake.",
      };
    }

    const binaryCheck = validateYjsUpdateBinary(update, this.revokedClientIds);
    if (!binaryCheck.valid) {
      return {
        allowed: false,
        closeCode: binaryCheck.code === "MALFORMED" ? 4400 : 4409,
        reason: binaryCheck.reason,
      };
    }

    return { allowed: true };
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
      if (
        id !== senderPeerId &&
        !peer.fenced &&
        peer.epoch === this.epoch &&
        peer.generationId === this.generationId &&
        peer.socket.readyState === 1 /* OPEN */
      ) {
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

  public async waitForPendingUpdates(): Promise<void> {
    await this.pendingWrite;
  }

  async recordUpdate(
    update: Uint8Array,
    expectedGeneration: { epoch: number; generationId: string } = {
      epoch: this.epoch,
      generationId: this.generationId,
    },
  ): Promise<void> {
    const persistAndApply = async (): Promise<void> => {
      const isCurrent = () =>
        !this.restorationBarrierActive &&
        !this.requiresRecovery &&
        this.epoch === expectedGeneration.epoch &&
        this.generationId === expectedGeneration.generationId;
      if (!isCurrent()) {
        throw new CrdtPersistenceError(
          "CRDT_EPOCH_CONFLICT",
          "Collaboration generation changed while queuing an update",
        );
      }
      // Apply and broadcast only AFTER Redis accepts the update.
      await crdtPersistence.saveUpdate(this.publicationId, this.postId, update);
      if (!isCurrent()) {
        // A restoration barrier can begin during a Redis round trip. The
        // restoration waits for this queue before replacing the old log.
        throw new CrdtPersistenceError(
          "CRDT_EPOCH_CONFLICT",
          "Collaboration generation changed while persisting an update",
        );
      }
      Y.applyUpdate(this.ydoc, update);
      this.updateCountSinceCompact++;
      if (this.updateCountSinceCompact >= 50) {
        const merged = Y.encodeStateAsUpdate(this.ydoc);
        await crdtPersistence.compact(this.publicationId, this.postId, merged);
        this.updateCountSinceCompact = 0;
      }
    };
    const result = this.pendingWrite.then(persistAndApply);
    // The queue stays usable after a rejected operation, but the caller sees
    // the original error and must not acknowledge or broadcast the update.
    this.pendingWrite = result.then(() => undefined, () => undefined);
    return result;
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

  /** Extracts all known Yjs client IDs from this room's current ydoc + update payload. */
  public collectActiveClientIds(extraUpdates: Uint8Array[] = []): number[] {
    const ids = new Set<number>(extractClientIdsFromDoc(this.ydoc));
    for (const u of extraUpdates) {
      for (const id of extractClientIdsFromUpdate(u)) {
        ids.add(id);
      }
    }
    return Array.from(ids);
  }
}

export class RoomManager {
  private rooms = new Map<string, CollaborationRoom>();
  private restoreLocks = new Map<string, Promise<void>>();

  private getRoomKey(publicationId: string, postId: string): string {
    return `${publicationId}:${postId}`;
  }

  public isRestoreLocked(publicationId: string, postId: string): boolean {
    return this.restoreLocks.has(this.getRoomKey(publicationId, postId));
  }

  /**
   * Serializes concurrent revision restoration operations per (publicationId, postId)
   * so epochs and PostgreSQL/Redis commits remain strictly monotonic.
   */
  public async withRestoreLock<T>(
    publicationId: string,
    postId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = this.getRoomKey(publicationId, postId);
    const previous = this.restoreLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => gate);
    this.restoreLocks.set(key, chained);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.restoreLocks.get(key) === chained) {
        this.restoreLocks.delete(key);
      }
    }
  }

  getOrCreateRoom(
    publicationId: string,
    postId: string,
    epoch: number = 1,
    generationId?: string,
  ): CollaborationRoom {
    const key = this.getRoomKey(publicationId, postId);
    let room = this.rooms.get(key);
    if (!room) {
      room = new CollaborationRoom(publicationId, postId, epoch, generationId);
      this.rooms.set(key, room);
    }
    return room;
  }

  async resetRoomWithDocument(
    publicationId: string,
    postId: string,
    epoch: number,
    docContent: unknown,
    options?: {
      revisionId?: string | undefined;
      restoredPostVersion?: number | undefined;
      generationId?: string | undefined;
    },
  ): Promise<CollaborationRoom> {
    const key = this.getRoomKey(publicationId, postId);
    const existingRoom = this.rooms.get(key);
    const activeRoomClientIds = existingRoom
      ? existingRoom.beginRestorationBarrier()
      : [];

    try {
      await existingRoom?.waitForPendingUpdates();
      const committed = await crdtPersistence.resetForRevisionRestore(
        publicationId,
        postId,
        epoch,
        undefined,
        {
          generationId: options?.generationId,
          restoredContent: docContent,
          revisionId: options?.revisionId,
          restoredPostVersion: options?.restoredPostVersion,
          additionalRevokedClientIds: activeRoomClientIds,
        },
      );

      let room = this.rooms.get(key);
      if (!room) {
        room = new CollaborationRoom(
          publicationId,
          postId,
          committed.epoch,
          committed.generationId,
        );
        this.rooms.set(key, room);
      }
      room.applyCommittedRestoration({
        epoch: committed.epoch,
        generationId: committed.generationId,
        snapshot: committed.snapshot,
        docContent,
        revokedClientIds: committed.revokedClientIds,
      });
      return room;
    } catch (err) {
      if (existingRoom) {
        existingRoom.markRequiresRecovery(
          epoch,
          options?.generationId || crdtPersistence.mintGenerationId(epoch),
          docContent,
          activeRoomClientIds,
        );
      }
      throw err;
    }
  }

  /**
   * Executes a full two-phase coordinated restoration across Redis intent log,
   * PostgreSQL transaction, durable Yjs seed snapshot commit, and live room fencing.
   */
  async executeCoordinatedRestore<
    TPost extends { version: number; content: unknown; title?: string },
  >(params: {
    publicationId: string;
    postId: string;
    revisionId: string;
    preRestorePostVersion?: number | undefined;
    loadPreRestoreVersion?: (() => Promise<number>) | undefined;
    executeDbRestore: () => Promise<TPost>;
  }): Promise<{ post: TPost; epoch: number; generationId: string }> {
    return this.withRestoreLock(params.publicationId, params.postId, async () => {
      const authoritativePreVersion = params.loadPreRestoreVersion
        ? await params.loadPreRestoreVersion()
        : params.preRestorePostVersion;
      const key = this.getRoomKey(params.publicationId, params.postId);
      const existingRoom = this.rooms.get(key);
      const activeRoomClientIds = existingRoom
        ? existingRoom.beginRestorationBarrier()
        : [];

      let intent;
      try {
        await existingRoom?.waitForPendingUpdates();
        intent = await crdtPersistence.beginRestoration(
          params.publicationId,
          params.postId,
          {
            revisionId: params.revisionId,
            preRestorePostVersion: authoritativePreVersion,
            minEpoch: existingRoom?.epoch ?? 1,
            activeRoomClientIds,
          },
        );
      } catch (err) {
        existingRoom?.abortRestorationBarrier();
        throw err;
      }

      let restoredPost: TPost;
      try {
        restoredPost = await params.executeDbRestore();
      } catch (dbErr: unknown) {
        await crdtPersistence.abortRestoration(
          params.publicationId,
          params.postId,
          intent,
          (dbErr as Error)?.message || String(dbErr),
        );
        existingRoom?.abortRestorationBarrier();
        throw dbErr;
      }

      try {
        const committed = await crdtPersistence.commitRestoration(
          params.publicationId,
          params.postId,
          {
            targetEpoch: intent.targetEpoch,
            generationId: intent.generationId,
            restoredContent: restoredPost.content,
            revisionId: params.revisionId,
            restoredPostVersion: restoredPost.version,
            preRestoreClientIds: intent.preRestoreClientIds,
            additionalRevokedClientIds: activeRoomClientIds,
          },
        );

        let room = this.rooms.get(key);
        if (!room) {
          room = new CollaborationRoom(
            params.publicationId,
            params.postId,
            committed.epoch,
            committed.generationId,
          );
          this.rooms.set(key, room);
        }
        room.applyCommittedRestoration({
          epoch: committed.epoch,
          generationId: committed.generationId,
          snapshot: committed.snapshot,
          docContent: restoredPost.content,
          title: restoredPost.title,
          postVersion: restoredPost.version,
          revokedClientIds: committed.revokedClientIds,
        });

        return {
          post: restoredPost,
          epoch: committed.epoch,
          generationId: committed.generationId,
        };
      } catch (commitErr) {
        let room = this.rooms.get(key);
        if (!room) {
          room = new CollaborationRoom(
            params.publicationId,
            params.postId,
            intent.targetEpoch,
            intent.generationId,
          );
          this.rooms.set(key, room);
        }
        room.markRequiresRecovery(
          intent.targetEpoch,
          intent.generationId,
          restoredPost.content,
          [...intent.preRestoreClientIds, ...activeRoomClientIds],
        );
        throw commitErr;
      }
    });
  }

  getRoom(publicationId: string, postId: string): CollaborationRoom | undefined {
    return this.rooms.get(this.getRoomKey(publicationId, postId));
  }

  removePeer(publicationId: string, postId: string, peerId: string): void {
    const key = this.getRoomKey(publicationId, postId);
    const room = this.rooms.get(key);
    if (room) {
      room.removePeer(peerId);
      if (
        room.peerCount === 0 &&
        !room.requiresRecovery &&
        !room.restorationBarrierActive
      ) {
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

  /** Clears all in-memory rooms (simulates collaboration server restart in tests). */
  public clearAllRoomsForTesting(): void {
    for (const room of this.rooms.values()) {
      for (const peer of room.peers.values()) {
        try {
          peer.socket.close(1012, "Service Restart");
        } catch {
          // Ignore
        }
      }
      try {
        room.ydoc.destroy();
      } catch {
        // Ignore
      }
    }
    this.rooms.clear();
    this.restoreLocks.clear();
  }
}

export const roomManager = new RoomManager();
