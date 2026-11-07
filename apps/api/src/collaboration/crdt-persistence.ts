import { getRedisClient, buildPublicationCacheKey } from "@vibress/cache";

export class DurableCrdtPersistence {
  // In-memory fallback buffer in case Redis is disabled or temporarily offline
  private inMemoryUpdates = new Map<string, Uint8Array[]>();
  private inMemorySnapshots = new Map<string, Uint8Array>();
  private inMemoryEpochs = new Map<string, number>();

  private getUpdatesKey(publicationId: string, postId: string): string {
    return buildPublicationCacheKey(publicationId, "crdt:updates", postId);
  }

  private getSnapshotKey(publicationId: string, postId: string): string {
    return buildPublicationCacheKey(publicationId, "crdt:snapshot", postId);
  }

  private getEpochKey(publicationId: string, postId: string): string {
    return buildPublicationCacheKey(publicationId, "crdt:epoch", postId);
  }

  async getEpoch(publicationId: string, postId: string): Promise<number> {
    try {
      const redis = getRedisClient();
      const key = this.getEpochKey(publicationId, postId);
      const val = await redis.get(key);
      if (val !== null && val !== undefined) {
        const parsed = parseInt(val, 10);
        if (!Number.isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch {
      // Memory fallback
    }
    const memoryKey = `${publicationId}:${postId}`;
    return this.inMemoryEpochs.get(memoryKey) || 1;
  }

  async setEpoch(
    publicationId: string,
    postId: string,
    epoch: number,
  ): Promise<void> {
    const memoryKey = `${publicationId}:${postId}`;
    this.inMemoryEpochs.set(memoryKey, epoch);
    try {
      const redis = getRedisClient();
      const key = this.getEpochKey(publicationId, postId);
      await redis.set(key, epoch.toString());
    } catch (err: unknown) {
      console.warn(`[CRDT Persistence] Redis save epoch failed for post ${postId}:`, (err as Error).message);
    }
  }

  async resetForRevisionRestore(
    publicationId: string,
    postId: string,
    newEpoch: number,
    snapshot?: Uint8Array,
  ): Promise<void> {
    const memoryKey = `${publicationId}:${postId}`;
    this.inMemoryUpdates.set(memoryKey, []);
    this.inMemoryEpochs.set(memoryKey, newEpoch);
    if (snapshot) {
      this.inMemorySnapshots.set(memoryKey, snapshot);
    } else {
      this.inMemorySnapshots.delete(memoryKey);
    }

    try {
      const redis = getRedisClient();
      const updatesKey = this.getUpdatesKey(publicationId, postId);
      const snapshotKey = this.getSnapshotKey(publicationId, postId);
      const epochKey = this.getEpochKey(publicationId, postId);
      await redis.del(updatesKey);
      if (snapshot) {
        const b64 = Buffer.from(snapshot).toString("base64");
        await redis.set(snapshotKey, b64);
      } else {
        await redis.del(snapshotKey);
      }
      await redis.set(epochKey, newEpoch.toString());
    } catch (err: unknown) {
      console.warn(`[CRDT Persistence] Redis resetForRevisionRestore failed for post ${postId}:`, (err as Error).message);
    }
  }

  async saveUpdate(
    publicationId: string,
    postId: string,
    update: Uint8Array,
  ): Promise<void> {
    const memoryKey = `${publicationId}:${postId}`;
    if (!this.inMemoryUpdates.has(memoryKey)) {
      this.inMemoryUpdates.set(memoryKey, []);
    }
    this.inMemoryUpdates.get(memoryKey)!.push(update);

    try {
      const redis = getRedisClient();
      const key = this.getUpdatesKey(publicationId, postId);
      const base64 = Buffer.from(update).toString("base64");
      await redis.rpush(key, base64);
    } catch (err: unknown) {
      // Fallback in memory is preserved
      console.warn(`[CRDT Persistence] Redis write failed for post ${postId}, using memory fallback:`, (err as Error).message);
    }
  }

  async getUpdates(
    publicationId: string,
    postId: string,
  ): Promise<Uint8Array[]> {
    try {
      const redis = getRedisClient();
      const key = this.getUpdatesKey(publicationId, postId);
      const items = await redis.lrange(key, 0, -1);
      if (items && items.length > 0) {
        return items.map((b64) => new Uint8Array(Buffer.from(b64, "base64")));
      }
      return [];
    } catch (err: unknown) {
      console.warn(`[CRDT Persistence] Redis read failed for post ${postId}, falling back to memory:`, (err as Error).message);
    }

    const memoryKey = `${publicationId}:${postId}`;
    return this.inMemoryUpdates.get(memoryKey) || [];
  }

  async getSnapshot(
    publicationId: string,
    postId: string,
  ): Promise<Uint8Array | null> {
    try {
      const redis = getRedisClient();
      const key = this.getSnapshotKey(publicationId, postId);
      const b64 = await redis.get(key);
      if (b64) {
        return new Uint8Array(Buffer.from(b64, "base64"));
      }
      return null;
    } catch {
      // Fall back to memory
    }

    const memoryKey = `${publicationId}:${postId}`;
    return this.inMemorySnapshots.get(memoryKey) || null;
  }

  async saveSnapshot(
    publicationId: string,
    postId: string,
    snapshot: Uint8Array,
  ): Promise<void> {
    const memoryKey = `${publicationId}:${postId}`;
    this.inMemorySnapshots.set(memoryKey, snapshot);

    try {
      const redis = getRedisClient();
      const key = this.getSnapshotKey(publicationId, postId);
      const b64 = Buffer.from(snapshot).toString("base64");
      await redis.set(key, b64);
    } catch (err: unknown) {
      console.warn(`[CRDT Persistence] Redis save snapshot failed for post ${postId}:`, (err as Error).message);
    }
  }

  async compact(
    publicationId: string,
    postId: string,
    mergedSnapshot: Uint8Array,
  ): Promise<void> {
    await this.saveSnapshot(publicationId, postId, mergedSnapshot);

    const memoryKey = `${publicationId}:${postId}`;
    this.inMemoryUpdates.set(memoryKey, []);

    try {
      const redis = getRedisClient();
      const updatesKey = this.getUpdatesKey(publicationId, postId);
      await redis.del(updatesKey);
    } catch (err: unknown) {
      console.warn(`[CRDT Persistence] Redis compact trim failed for post ${postId}:`, (err as Error).message);
    }
  }

  async clear(publicationId: string, postId: string): Promise<void> {
    const memoryKey = `${publicationId}:${postId}`;
    this.inMemoryUpdates.delete(memoryKey);
    this.inMemorySnapshots.delete(memoryKey);

    try {
      const redis = getRedisClient();
      const updatesKey = this.getUpdatesKey(publicationId, postId);
      const snapshotKey = this.getSnapshotKey(publicationId, postId);
      await redis.del(updatesKey, snapshotKey);
    } catch {
      // Best effort
    }
  }
}

export const crdtPersistence = new DurableCrdtPersistence();
