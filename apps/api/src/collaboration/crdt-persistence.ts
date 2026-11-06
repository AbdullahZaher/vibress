import crypto from "node:crypto";
import * as Y from "yjs";
import { getRedisClient, buildPublicationCacheKey } from "@vibress/cache";

export type RestorationStatus =
  | "REQUESTED"
  | "IN_PROGRESS"
  | "COMMITTED"
  | "REQUIRES_RECOVERY"
  | "FAILED";

export interface RestorationStateRecord {
  status: RestorationStatus;
  epoch: number;
  targetEpoch?: number | undefined;
  generationId: string;
  revisionId?: string | undefined;
  preRestorePostVersion?: number | undefined;
  restoredPostVersion?: number | undefined;
  restoredContent?: unknown;
  revokedClientIds?: number[] | undefined;
  updatedAt: string;
  error?: string | undefined;
}

export interface PreparedRestorationIntent {
  previousEpoch: number;
  targetEpoch: number;
  generationId: string;
  preRestoreClientIds: number[];
  intentRecord: RestorationStateRecord;
}

export interface CommittedRestorationResult {
  epoch: number;
  generationId: string;
  snapshot: Uint8Array;
  revokedClientIds: number[];
  state: RestorationStateRecord;
}

export interface ReconciledCrdtState {
  epoch: number;
  generationId: string;
  revokedClientIds: number[];
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
  restoreState: RestorationStateRecord | null;
}

export class CrdtPersistenceError extends Error {
  public readonly code: string;
  public readonly causeError?: unknown;

  constructor(code: string, message: string, causeError?: unknown) {
    super(message);
    this.name = "CrdtPersistenceError";
    this.code = code;
    this.causeError = causeError;
  }
}

export type YjsBinaryValidationResult =
  | { valid: true; clientIds: number[] }
  | {
      valid: false;
      code: "MALFORMED" | "REVOKED_CLIENT";
      reason: string;
    };

/**
 * O(|update|) structural & DeleteSet validator for Yjs binary updates.
 * Rejects malformed binary frames, authored structs from revoked clients,
 * parent/origin dependencies on revoked clients, AND DeleteSet tombstones
 * targeting revoked pre-restoration client IDs.
 */
export function validateYjsUpdateBinary(
  update: Uint8Array,
  revokedClientIds?: ReadonlySet<number>,
): YjsBinaryValidationResult {
  if (!(update instanceof Uint8Array) || update.byteLength === 0) {
    return {
      valid: false,
      code: "MALFORMED",
      reason: "Bad Request: Empty or invalid Yjs CRDT update payload.",
    };
  }

  const referencedClientIds = new Set<number>();
  try {
    const decoded = Y.decodeUpdate(update) as unknown as {
      structs?: Array<{
        id?: { client?: number };
        origin?: { client?: number } | null;
        rightOrigin?: { client?: number } | null;
        parent?: { client?: number } | string | null;
        redone?: { client?: number } | null;
      }>;
      ds?: { clients?: Map<number, unknown> };
    };

    if (Array.isArray(decoded.structs)) {
      for (const struct of decoded.structs) {
        if (typeof struct.id?.client === "number") {
          referencedClientIds.add(struct.id.client);
        }
        if (typeof struct.origin?.client === "number") {
          referencedClientIds.add(struct.origin.client);
        }
        if (typeof struct.rightOrigin?.client === "number") {
          referencedClientIds.add(struct.rightOrigin.client);
        }
        if (
          struct.parent &&
          typeof struct.parent === "object" &&
          typeof struct.parent.client === "number"
        ) {
          referencedClientIds.add(struct.parent.client);
        }
        if (typeof struct.redone?.client === "number") {
          referencedClientIds.add(struct.redone.client);
        }
      }
    }

    if (decoded.ds?.clients instanceof Map) {
      for (const dsClientId of decoded.ds.clients.keys()) {
        if (typeof dsClientId === "number") {
          referencedClientIds.add(dsClientId);
        }
      }
    }
  } catch {
    return {
      valid: false,
      code: "MALFORMED",
      reason: "Bad Request: Malformed Yjs CRDT update payload.",
    };
  }

  if (revokedClientIds && revokedClientIds.size > 0) {
    for (const cid of referencedClientIds) {
      if (revokedClientIds.has(cid)) {
        return {
          valid: false,
          code: "REVOKED_CLIENT",
          reason:
            "Conflict: Document was restored to revision. Stale or replayed Yjs update rejected.",
        };
      }
    }
  }

  // Verify full Y.applyUpdate structural integrity in an empty O(|update|) sandbox
  const sandbox = new Y.Doc();
  try {
    Y.applyUpdate(sandbox, update);
    if (revokedClientIds && revokedClientIds.size > 0) {
      const pending = (
        sandbox.store as unknown as {
          pendingStructs?: { missing?: Map<number, number> } | null;
          pendingDs?: Uint8Array | null;
        }
      ).pendingStructs;
      if (pending?.missing) {
        for (const missingClientId of pending.missing.keys()) {
          if (revokedClientIds.has(missingClientId)) {
            sandbox.destroy();
            return {
              valid: false,
              code: "REVOKED_CLIENT",
              reason:
                "Conflict: Document was restored to revision. Update depends on pre-restore CRDT item.",
            };
          }
        }
      }
    }
  } catch {
    sandbox.destroy();
    return {
      valid: false,
      code: "MALFORMED",
      reason: "Bad Request: Invalid Yjs CRDT update payload.",
    };
  }
  sandbox.destroy();

  return { valid: true, clientIds: Array.from(referencedClientIds) };
}

export function extractClientIdsFromUpdate(update: Uint8Array): number[] {
  const validated = validateYjsUpdateBinary(update);
  if (validated.valid) {
    return validated.clientIds;
  }
  const ids = new Set<number>();
  try {
    const meta = Y.parseUpdateMeta(update);
    for (const clientId of meta.to.keys()) {
      ids.add(clientId);
    }
    for (const clientId of meta.from.keys()) {
      ids.add(clientId);
    }
  } catch {
    // Ignore malformed binary payload during metadata inspection
  }
  return Array.from(ids);
}

export function extractClientIdsFromDoc(ydoc: Y.Doc): number[] {
  try {
    const sv = Y.decodeStateVector(Y.encodeStateVector(ydoc));
    return Array.from(sv.keys());
  } catch {
    return [];
  }
}

export function createRestoredYjsSeedSnapshot(params: {
  epoch: number;
  generationId: string;
  canonicalDocument: unknown;
  restoredRevisionId?: string | undefined;
  restoredPostVersion?: number | undefined;
  avoidClientIds?: Iterable<number> | undefined;
}): Uint8Array {
  const avoid = new Set<number>(params.avoidClientIds ?? []);
  let seedDoc = new Y.Doc();
  let guard = 0;
  while (avoid.has(seedDoc.clientID) && guard < 16) {
    seedDoc.destroy();
    seedDoc = new Y.Doc();
    guard++;
  }

  const meta = seedDoc.getMap("__vibress_meta");
  meta.set("epoch", params.epoch);
  meta.set("generationId", params.generationId);
  meta.set("canonicalDocument", params.canonicalDocument ?? null);
  if (params.restoredRevisionId !== undefined) {
    meta.set("restoredRevisionId", params.restoredRevisionId);
  }
  if (params.restoredPostVersion !== undefined) {
    meta.set("restoredPostVersion", params.restoredPostVersion);
  }
  meta.set("restoredAt", new Date().toISOString());

  const encoded = Y.encodeStateAsUpdate(seedDoc);
  seedDoc.destroy();
  return encoded;
}

export interface RedisPipelineLike {
  del(...keys: string[]): this;
  set(key: string, value: string): this;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  rpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  multi(): RedisPipelineLike;
}

export class DurableCrdtPersistence {
  // In-memory fallback buffer for transient incremental edits only;
  // NEVER used to mask Redis failures during revision restoration.
  private inMemoryUpdates = new Map<string, Uint8Array[]>();
  private inMemorySnapshots = new Map<string, Uint8Array>();
  private inMemoryEpochs = new Map<string, number>();
  private inMemoryGenerations = new Map<string, string>();
  private inMemoryRevokedClients = new Map<string, Set<number>>();
  private inMemoryRestoreStates = new Map<string, RestorationStateRecord>();
  private warmKeys = new Set<string>();
  private abortPendingRecords = new Map<string, RestorationStateRecord>();
  private pendingRecoveryRecords = new Map<
    string,
    {
      targetEpoch: number;
      generationId: string;
      revisionId?: string | undefined;
      restoredPostVersion?: number | undefined;
      restoredContent: unknown;
      revokedClientIds: number[];
      error: string;
    }
  >();

  private redisProvider: () => RedisClientLike = () =>
    getRedisClient() as unknown as RedisClientLike;

  public setRedisProviderForTesting(provider: () => RedisClientLike): void {
    this.redisProvider = provider;
  }

  public resetRedisProvider(): void {
    this.redisProvider = () => getRedisClient() as unknown as RedisClientLike;
  }

  private getMemoryKey(publicationId: string, postId: string): string {
    return `${publicationId}:${postId}`;
  }

  private getUpdatesKey(publicationId: string, postId: string): string {
    return buildPublicationCacheKey(publicationId, "crdt:updates", postId);
  }

  private getSnapshotKey(publicationId: string, postId: string): string {
    return buildPublicationCacheKey(publicationId, "crdt:snapshot", postId);
  }

  private getEpochKey(publicationId: string, postId: string): string {
    return buildPublicationCacheKey(publicationId, "crdt:epoch", postId);
  }

  private getGenerationKey(publicationId: string, postId: string): string {
    return buildPublicationCacheKey(publicationId, "crdt:generation", postId);
  }

  private getRevokedClientsKey(publicationId: string, postId: string): string {
    return buildPublicationCacheKey(publicationId, "crdt:revoked_clients", postId);
  }

  private getRestoreStateKey(publicationId: string, postId: string): string {
    return buildPublicationCacheKey(publicationId, "crdt:restore_state", postId);
  }

  public mintGenerationId(epoch: number): string {
    return `gen_${epoch}_${crypto.randomUUID()}`;
  }

  async getEpoch(publicationId: string, postId: string): Promise<number> {
    const memoryKey = this.getMemoryKey(publicationId, postId);
    const pending = this.pendingRecoveryRecords.get(memoryKey);
    if (pending) {
      return pending.targetEpoch;
    }
    try {
      const redis = this.redisProvider();
      const key = this.getEpochKey(publicationId, postId);
      const val = await redis.get(key);
      if (val !== null && val !== undefined) {
        const parsed = parseInt(val, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          this.inMemoryEpochs.set(memoryKey, parsed);
          return parsed;
        }
      }
    } catch {
      // Fall back to in-memory epoch for read-only lookups when Redis is offline
    }
    return this.inMemoryEpochs.get(memoryKey) || 1;
  }

  async getEpochStrict(publicationId: string, postId: string): Promise<number> {
    const memoryKey = this.getMemoryKey(publicationId, postId);
    try {
      const redis = this.redisProvider();
      const val = await redis.get(this.getEpochKey(publicationId, postId));
      if (val !== null && val !== undefined) {
        const parsed = parseInt(val, 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
          const inMem = this.inMemoryEpochs.get(memoryKey) || 1;
          return Math.max(parsed, inMem);
        }
      }
      return this.inMemoryEpochs.get(memoryKey) || 1;
    } catch (err: unknown) {
      throw new CrdtPersistenceError(
        "CRDT_REDIS_UNAVAILABLE",
        `Failed to read authoritative CRDT epoch for post ${postId}: ${(err as Error)?.message || String(err)}`,
        err,
      );
    }
  }

  async getOrInitGenerationId(
    publicationId: string,
    postId: string,
    epoch: number,
  ): Promise<string> {
    const memoryKey = this.getMemoryKey(publicationId, postId);
    const pending = this.pendingRecoveryRecords.get(memoryKey);
    if (pending && pending.targetEpoch === epoch) {
      return pending.generationId;
    }
    try {
      const redis = this.redisProvider();
      const key = this.getGenerationKey(publicationId, postId);
      const existing = await redis.get(key);
      if (existing && existing.startsWith(`gen_${epoch}_`)) {
        this.inMemoryGenerations.set(memoryKey, existing);
        return existing;
      }
      const minted =
        this.inMemoryGenerations.get(memoryKey)?.startsWith(`gen_${epoch}_`)
          ? this.inMemoryGenerations.get(memoryKey)!
          : this.mintGenerationId(epoch);
      await redis.set(key, minted);
      this.inMemoryGenerations.set(memoryKey, minted);
      return minted;
    } catch {
      const cached = this.inMemoryGenerations.get(memoryKey);
      if (cached && cached.startsWith(`gen_${epoch}_`)) {
        return cached;
      }
      const minted = this.mintGenerationId(epoch);
      this.inMemoryGenerations.set(memoryKey, minted);
      return minted;
    }
  }

  async getRevokedClientIds(
    publicationId: string,
    postId: string,
  ): Promise<number[]> {
    const memoryKey = this.getMemoryKey(publicationId, postId);
    const combined = new Set<number>(this.inMemoryRevokedClients.get(memoryKey) ?? []);
    const pending = this.pendingRecoveryRecords.get(memoryKey);
    if (pending) {
      for (const id of pending.revokedClientIds) combined.add(id);
    }
    try {
      const redis = this.redisProvider();
      const raw = await redis.get(this.getRevokedClientsKey(publicationId, postId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (typeof id === "number" && Number.isFinite(id)) {
              combined.add(id);
            }
          }
        }
      }
    } catch {
      // Keep memory set if Redis read fails
    }
    this.inMemoryRevokedClients.set(memoryKey, combined);
    return Array.from(combined);
  }

  async getRestorationState(
    publicationId: string,
    postId: string,
  ): Promise<RestorationStateRecord | null> {
    const memoryKey = this.getMemoryKey(publicationId, postId);
    try {
      const redis = this.redisProvider();
      const raw = await redis.get(this.getRestoreStateKey(publicationId, postId));
      if (raw) {
        const parsed = JSON.parse(raw) as RestorationStateRecord;
        this.inMemoryRestoreStates.set(memoryKey, parsed);
        return parsed;
      }
    } catch {
      // Fallback to in-memory state if Redis unavailable
    }
    return this.inMemoryRestoreStates.get(memoryKey) || null;
  }

  hasPendingRecovery(publicationId: string, postId: string): boolean {
    return this.pendingRecoveryRecords.has(this.getMemoryKey(publicationId, postId));
  }

  async setEpoch(
    publicationId: string,
    postId: string,
    epoch: number,
  ): Promise<void> {
    const memoryKey = this.getMemoryKey(publicationId, postId);
    const redis = this.redisProvider();
    await redis.set(this.getEpochKey(publicationId, postId), epoch.toString());
    this.inMemoryEpochs.set(memoryKey, epoch);
  }

  /**
   * Phase 1 of Coordinated Restoration:
   * Verifies Redis durability availability, collects pre-restore CRDT client IDs for revocation,
   * and writes a durable IN_PROGRESS intent record before PostgreSQL commits.
   */
  async beginRestoration(
    publicationId: string,
    postId: string,
    options: {
      revisionId?: string | undefined;
      preRestorePostVersion?: number | undefined;
      minEpoch?: number | undefined;
      activeRoomClientIds?: number[] | undefined;
    } = {},
  ): Promise<PreparedRestorationIntent> {
    const memoryKey = this.getMemoryKey(publicationId, postId);
    const currentEpoch = await this.getEpochStrict(publicationId, postId);
    const pendingEpoch = this.pendingRecoveryRecords.get(memoryKey)?.targetEpoch ?? 0;
    const baseEpoch = Math.max(currentEpoch, pendingEpoch, options.minEpoch ?? 1);
    const targetEpoch = baseEpoch + 1;
    const generationId = this.mintGenerationId(targetEpoch);

    // Collect all Yjs client IDs that participated in prior epochs so they can never replay
    const clientIds = new Set<number>(options.activeRoomClientIds ?? []);
    const existingRevoked = await this.getRevokedClientIds(publicationId, postId);
    for (const id of existingRevoked) clientIds.add(id);

    try {
      const redis = this.redisProvider();
      const [snapB64, updateItems] = await Promise.all([
        redis.get(this.getSnapshotKey(publicationId, postId)),
        redis.lrange(this.getUpdatesKey(publicationId, postId), 0, -1),
      ]);
      if (snapB64) {
        const snapBytes = new Uint8Array(Buffer.from(snapB64, "base64"));
        for (const id of extractClientIdsFromUpdate(snapBytes)) clientIds.add(id);
      }
      if (updateItems) {
        for (const item of updateItems) {
          const bytes = new Uint8Array(Buffer.from(item, "base64"));
          for (const id of extractClientIdsFromUpdate(bytes)) clientIds.add(id);
        }
      }
      const preRestoreClientIds = Array.from(clientIds);
      const intentRecord: RestorationStateRecord = {
        status: "IN_PROGRESS",
        epoch: baseEpoch,
        targetEpoch,
        generationId,
        revisionId: options.revisionId,
        preRestorePostVersion: options.preRestorePostVersion,
        revokedClientIds: preRestoreClientIds,
        updatedAt: new Date().toISOString(),
      };
      await redis.set(
        this.getRestoreStateKey(publicationId, postId),
        JSON.stringify(intentRecord),
      );
      this.inMemoryRestoreStates.set(memoryKey, intentRecord);

      return {
        previousEpoch: baseEpoch,
        targetEpoch,
        generationId,
        preRestoreClientIds,
        intentRecord,
      };
    } catch (err: unknown) {
      if (err instanceof CrdtPersistenceError) throw err;
      throw new CrdtPersistenceError(
        "CRDT_PREFLIGHT_FAILED",
        `Failed to record restoration intent in Redis for post ${postId}: ${(err as Error)?.message || String(err)}`,
        err,
      );
    }
  }

  /**
   * Rolls back an IN_PROGRESS restoration intent when PostgreSQL fails before commit.
   */
  async abortRestoration(
    publicationId: string,
    postId: string,
    intent: PreparedRestorationIntent,
    reason: string,
  ): Promise<void> {
    const memoryKey = this.getMemoryKey(publicationId, postId);
    const failedRecord: RestorationStateRecord = {
      status: "FAILED",
      epoch: intent.previousEpoch,
      targetEpoch: intent.targetEpoch,
      generationId: intent.generationId,
      revisionId: intent.intentRecord.revisionId,
      preRestorePostVersion: intent.intentRecord.preRestorePostVersion,
      updatedAt: new Date().toISOString(),
      error: reason,
    };
    this.inMemoryRestoreStates.set(memoryKey, failedRecord);
    try {
      const redis = this.redisProvider();
      await redis.set(
        this.getRestoreStateKey(publicationId, postId),
        JSON.stringify(failedRecord),
      );
      this.abortPendingRecords.delete(memoryKey);
      this.warmKeys.add(memoryKey);
    } catch {
      // Queue durable abort flush so a stale IN_PROGRESS record in Redis can never
      // be mistakenly rolled forward if a later ordinary save increments post.version.
      this.abortPendingRecords.set(memoryKey, failedRecord);
    }
  }

  /**
   * Phase 2 of Coordinated Restoration:
   * Atomically purges old updates, writes the durable Yjs seed snapshot for the restored document,
   * advances epoch + generationId, persists revoked pre-restore client IDs, and marks COMMITTED.
   * Never swallows Redis errors — throws CrdtPersistenceError and records REQUIRES_RECOVERY on failure.
   */
  async commitRestoration(
    publicationId: string,
    postId: string,
    params: {
      targetEpoch: number;
      generationId: string;
      restoredContent: unknown;
      revisionId?: string | undefined;
      restoredPostVersion?: number | undefined;
      preRestoreClientIds?: number[] | undefined;
      additionalRevokedClientIds?: number[] | undefined;
      customSnapshot?: Uint8Array | undefined;
    },
  ): Promise<CommittedRestorationResult> {
    if (!Number.isInteger(params.targetEpoch) || params.targetEpoch < 1) {
      throw new CrdtPersistenceError(
        "CRDT_INVALID_EPOCH",
        `Invalid target epoch: ${params.targetEpoch}`,
      );
    }

    const memoryKey = this.getMemoryKey(publicationId, postId);
    const revokedSet = new Set<number>([
      ...(this.inMemoryRevokedClients.get(memoryKey) ?? []),
      ...(params.preRestoreClientIds ?? []),
      ...(params.additionalRevokedClientIds ?? []),
    ]);
    const revokedClientIds = Array.from(revokedSet);

    let seedSnapshot: Uint8Array;
    if (params.customSnapshot) {
      // Validate custom snapshot can be decoded by Yjs before committing
      const verifyDoc = new Y.Doc();
      try {
        Y.applyUpdate(verifyDoc, params.customSnapshot);
      } catch (err: unknown) {
        verifyDoc.destroy();
        throw new CrdtPersistenceError(
          "CRDT_INVALID_SNAPSHOT",
          `Provided restoration snapshot is not a valid Yjs update: ${(err as Error)?.message || String(err)}`,
          err,
        );
      }
      verifyDoc.destroy();
      seedSnapshot = params.customSnapshot;
    } else {
      seedSnapshot = createRestoredYjsSeedSnapshot({
        epoch: params.targetEpoch,
        generationId: params.generationId,
        canonicalDocument: params.restoredContent,
        restoredRevisionId: params.revisionId,
        restoredPostVersion: params.restoredPostVersion,
        avoidClientIds: revokedSet,
      });
    }

    const committedRecord: RestorationStateRecord = {
      status: "COMMITTED",
      epoch: params.targetEpoch,
      generationId: params.generationId,
      revisionId: params.revisionId,
      restoredPostVersion: params.restoredPostVersion,
      restoredContent: params.restoredContent,
      updatedAt: new Date().toISOString(),
    };

    const updatesKey = this.getUpdatesKey(publicationId, postId);
    const snapshotKey = this.getSnapshotKey(publicationId, postId);
    const epochKey = this.getEpochKey(publicationId, postId);
    const generationKey = this.getGenerationKey(publicationId, postId);
    const revokedClientsKey = this.getRevokedClientsKey(publicationId, postId);
    const restoreStateKey = this.getRestoreStateKey(publicationId, postId);

    try {
      const redis = this.redisProvider();
      const snapshotB64 = Buffer.from(seedSnapshot).toString("base64");
      const multi = redis.multi();
      multi.del(updatesKey);
      multi.del(snapshotKey);
      multi.set(snapshotKey, snapshotB64);
      multi.set(epochKey, params.targetEpoch.toString());
      multi.set(generationKey, params.generationId);
      multi.set(revokedClientsKey, JSON.stringify(revokedClientIds));
      multi.set(restoreStateKey, JSON.stringify(committedRecord));

      const execResults = await multi.exec();
      if (!execResults) {
        throw new CrdtPersistenceError(
          "CRDT_TRANSACTION_ABORTED",
          `Redis MULTI/EXEC returned null while committing restoration for post ${postId}`,
        );
      }
      for (let i = 0; i < execResults.length; i++) {
        const [cmdErr] = execResults[i]!;
        if (cmdErr) {
          throw new CrdtPersistenceError(
            "CRDT_TRANSACTION_STEP_FAILED",
            `Redis MULTI command #${i} failed for post ${postId}: ${cmdErr.message}`,
            cmdErr,
          );
        }
      }
    } catch (err: unknown) {
      const errMessage = (err as Error)?.message || String(err);
      const recoveryState: RestorationStateRecord = {
        status: "REQUIRES_RECOVERY",
        epoch: params.targetEpoch,
        targetEpoch: params.targetEpoch,
        generationId: params.generationId,
        revisionId: params.revisionId,
        restoredPostVersion: params.restoredPostVersion,
        restoredContent: params.restoredContent,
        revokedClientIds,
        updatedAt: new Date().toISOString(),
        error: errMessage,
      };
      this.inMemoryRestoreStates.set(memoryKey, recoveryState);
      this.inMemoryRevokedClients.set(memoryKey, revokedSet);
      this.pendingRecoveryRecords.set(memoryKey, {
        targetEpoch: params.targetEpoch,
        generationId: params.generationId,
        revisionId: params.revisionId,
        restoredPostVersion: params.restoredPostVersion,
        restoredContent: params.restoredContent,
        revokedClientIds,
        error: errMessage,
      });

      // Best-effort durable recovery marker if Redis partially responds
      try {
        const redis = this.redisProvider();
        await redis.set(restoreStateKey, JSON.stringify(recoveryState));
      } catch {
        // Ignore secondary error; primary error is propagated below
      }

      if (err instanceof CrdtPersistenceError) {
        throw err;
      }
      throw new CrdtPersistenceError(
        "CRDT_COMMIT_FAILED",
        `Failed to durably commit CRDT restoration for post ${postId}: ${errMessage}`,
        err,
      );
    }

    // Durable commit succeeded — now update in-memory mirrors atomically
    this.pendingRecoveryRecords.delete(memoryKey);
    this.abortPendingRecords.delete(memoryKey);
    this.warmKeys.add(memoryKey);
    this.inMemoryUpdates.set(memoryKey, []);
    this.inMemorySnapshots.set(memoryKey, seedSnapshot);
    this.inMemoryEpochs.set(memoryKey, params.targetEpoch);
    this.inMemoryGenerations.set(memoryKey, params.generationId);
    this.inMemoryRevokedClients.set(memoryKey, revokedSet);
    this.inMemoryRestoreStates.set(memoryKey, committedRecord);
    this.pruneBoundedInMemoryMaps();

    return {
      epoch: params.targetEpoch,
      generationId: params.generationId,
      snapshot: seedSnapshot,
      revokedClientIds,
      state: committedRecord,
    };
  }

  /**
   * Direct atomic reset entry point (used by RoomManager and direct callers).
   * Strictly propagates Redis persistence errors rather than silently downgrading.
   */
  async resetForRevisionRestore(
    publicationId: string,
    postId: string,
    newEpoch: number,
    snapshot?: Uint8Array,
    options?: {
      generationId?: string | undefined;
      restoredContent?: unknown;
      revisionId?: string | undefined;
      restoredPostVersion?: number | undefined;
      additionalRevokedClientIds?: number[] | undefined;
    },
  ): Promise<CommittedRestorationResult> {
    const preRestoreIds = new Set<number>(options?.additionalRevokedClientIds ?? []);
    const existingRevoked = await this.getRevokedClientIds(publicationId, postId);
    for (const id of existingRevoked) preRestoreIds.add(id);

    // Inspect existing Redis snapshot + updates to revoke all prior client IDs
    const redis = this.redisProvider();
    try {
      const [oldSnapB64, oldUpdates] = await Promise.all([
        redis.get(this.getSnapshotKey(publicationId, postId)),
        redis.lrange(this.getUpdatesKey(publicationId, postId), 0, -1),
      ]);
      if (oldSnapB64) {
        const bytes = new Uint8Array(Buffer.from(oldSnapB64, "base64"));
        for (const id of extractClientIdsFromUpdate(bytes)) preRestoreIds.add(id);
      }
      if (oldUpdates) {
        for (const u of oldUpdates) {
          const bytes = new Uint8Array(Buffer.from(u, "base64"));
          for (const id of extractClientIdsFromUpdate(bytes)) preRestoreIds.add(id);
        }
      }
    } catch (err: unknown) {
      throw new CrdtPersistenceError(
        "CRDT_REDIS_UNAVAILABLE",
        `Failed to inspect pre-restore CRDT state in Redis for post ${postId}: ${(err as Error)?.message || String(err)}`,
        err,
      );
    }

    const generationId = options?.generationId || this.mintGenerationId(newEpoch);
    return this.commitRestoration(publicationId, postId, {
      targetEpoch: newEpoch,
      generationId,
      restoredContent: options?.restoredContent ?? null,
      revisionId: options?.revisionId,
      restoredPostVersion: options?.restoredPostVersion,
      preRestoreClientIds: Array.from(preRestoreIds),
      customSnapshot: snapshot,
    });
  }

  private pruneBoundedInMemoryMaps(): void {
    const MAX_CACHED_ROOMS = 250;
    const evictOldest = <V>(map: Map<string, V>) => {
      while (map.size > MAX_CACHED_ROOMS) {
        const oldestKey = map.keys().next().value;
        if (oldestKey === undefined || this.pendingRecoveryRecords.has(oldestKey)) {
          break;
        }
        map.delete(oldestKey);
      }
    };
    evictOldest(this.inMemoryUpdates);
    evictOldest(this.inMemorySnapshots);
    evictOldest(this.inMemoryRestoreStates);
  }

  /**
   * Idempotent crash-recovery & partial-failure reconciliation against authoritative PostgreSQL post state.
   * - Rolls forward interrupted IN_PROGRESS or REQUIRES_RECOVERY states if PostgreSQL committed.
   * - Rolls back interrupted IN_PROGRESS states if PostgreSQL did not commit.
   * - Fails closed (503 CrdtPersistenceError) on cold-cache Redis read failures so a restarted replica
   *   never defaults to epoch = 1 while Redis is temporarily unreachable.
   */
  async reconcileWithDatabase(
    publicationId: string,
    postId: string,
    authoritativePost: { version: number; content: unknown },
    options?: { skipIfRestoreLocked?: boolean | undefined },
  ): Promise<ReconciledCrdtState> {
    const memoryKey = this.getMemoryKey(publicationId, postId);

    // Flush any pending abort record before inspecting durable IN_PROGRESS state
    const pendingAbort = this.abortPendingRecords.get(memoryKey);
    if (pendingAbort && !options?.skipIfRestoreLocked) {
      try {
        const redis = this.redisProvider();
        await redis.set(
          this.getRestoreStateKey(publicationId, postId),
          JSON.stringify(pendingAbort),
        );
        this.abortPendingRecords.delete(memoryKey);
        this.warmKeys.add(memoryKey);
      } catch (err: unknown) {
        if (!this.warmKeys.has(memoryKey)) {
          throw new CrdtPersistenceError(
            "CRDT_REDIS_UNAVAILABLE",
            `Cold-cache CRDT reconciliation failed for post ${postId}: ${(err as Error)?.message || String(err)}`,
            err,
          );
        }
      }
    }

    const pending = this.pendingRecoveryRecords.get(memoryKey);

    if (pending && !options?.skipIfRestoreLocked) {
      const committed = await this.commitRestoration(publicationId, postId, {
        targetEpoch: pending.targetEpoch,
        generationId: pending.generationId,
        restoredContent: authoritativePost.content,
        revisionId: pending.revisionId,
        restoredPostVersion: authoritativePost.version,
        preRestoreClientIds: pending.revokedClientIds,
      });
      return {
        epoch: committed.epoch,
        generationId: committed.generationId,
        revokedClientIds: committed.revokedClientIds,
        snapshot: committed.snapshot,
        updates: [],
        restoreState: committed.state,
      };
    }

    // Cold-cache precheck: after a server restart, do NOT default to epoch=1 if Redis is unreachable
    if (
      !this.warmKeys.has(memoryKey) &&
      !this.inMemoryEpochs.has(memoryKey) &&
      !this.pendingRecoveryRecords.has(memoryKey)
    ) {
      try {
        const redis = this.redisProvider();
        const [rawEpoch, rawRestore] = await Promise.all([
          redis.get(this.getEpochKey(publicationId, postId)),
          redis.get(this.getRestoreStateKey(publicationId, postId)),
        ]);
        if (rawEpoch !== null && rawEpoch !== undefined) {
          const parsed = parseInt(rawEpoch, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            this.inMemoryEpochs.set(memoryKey, parsed);
          }
        }
        if (rawRestore) {
          this.inMemoryRestoreStates.set(
            memoryKey,
            JSON.parse(rawRestore) as RestorationStateRecord,
          );
        }
        this.warmKeys.add(memoryKey);
      } catch (err: unknown) {
        throw new CrdtPersistenceError(
          "CRDT_REDIS_UNAVAILABLE",
          `Authoritative CRDT state in Redis is unreachable on cold start for post ${postId}: ${(err as Error)?.message || String(err)}`,
          err,
        );
      }
    }

    const restoreState = pendingAbort
      ? pendingAbort
      : await this.getRestorationState(publicationId, postId);
    if (restoreState && !options?.skipIfRestoreLocked) {
      if (restoreState.status === "REQUIRES_RECOVERY") {
        const targetEpoch = restoreState.targetEpoch ?? restoreState.epoch;
        const generationId =
          restoreState.generationId || this.mintGenerationId(targetEpoch);
        const preIds = new Set<number>([
          ...(await this.getRevokedClientIds(publicationId, postId)),
          ...(restoreState.revokedClientIds ?? []),
        ]);
        const existingSnap = await this.getSnapshot(publicationId, postId);
        if (existingSnap) {
          for (const id of extractClientIdsFromUpdate(existingSnap)) preIds.add(id);
        }
        const existingUpdates = await this.getIncrementalUpdatesOnly(publicationId, postId);
        for (const u of existingUpdates) {
          for (const id of extractClientIdsFromUpdate(u)) preIds.add(id);
        }
        const committed = await this.commitRestoration(publicationId, postId, {
          targetEpoch,
          generationId,
          restoredContent: authoritativePost.content,
          revisionId: restoreState.revisionId,
          restoredPostVersion: authoritativePost.version,
          preRestoreClientIds: Array.from(preIds),
        });
        return {
          epoch: committed.epoch,
          generationId: committed.generationId,
          revokedClientIds: committed.revokedClientIds,
          snapshot: committed.snapshot,
          updates: [],
          restoreState: committed.state,
        };
      }

      if (restoreState.status === "IN_PROGRESS") {
        const preVersion = restoreState.preRestorePostVersion;
        if (preVersion !== undefined && authoritativePost.version > preVersion) {
          // PostgreSQL committed the restoration before process crash — roll forward!
          const targetEpoch = restoreState.targetEpoch ?? restoreState.epoch + 1;
          const generationId =
            restoreState.generationId || this.mintGenerationId(targetEpoch);
          const preIds = new Set<number>([
            ...(await this.getRevokedClientIds(publicationId, postId)),
            ...(restoreState.revokedClientIds ?? []),
          ]);
          const existingSnap = await this.getSnapshot(publicationId, postId);
          if (existingSnap) {
            for (const id of extractClientIdsFromUpdate(existingSnap)) preIds.add(id);
          }
          const existingUpdates = await this.getIncrementalUpdatesOnly(publicationId, postId);
          for (const u of existingUpdates) {
            for (const id of extractClientIdsFromUpdate(u)) preIds.add(id);
          }
          const committed = await this.commitRestoration(publicationId, postId, {
            targetEpoch,
            generationId,
            restoredContent: authoritativePost.content,
            revisionId: restoreState.revisionId,
            restoredPostVersion: authoritativePost.version,
            preRestoreClientIds: Array.from(preIds),
          });
          return {
            epoch: committed.epoch,
            generationId: committed.generationId,
            revokedClientIds: committed.revokedClientIds,
            snapshot: committed.snapshot,
            updates: [],
            restoreState: committed.state,
          };
        } else {
          // PostgreSQL did NOT commit before process crash — roll back intent safely!
          await this.abortRestoration(
            publicationId,
            postId,
            {
              previousEpoch: restoreState.epoch,
              targetEpoch: restoreState.targetEpoch ?? restoreState.epoch + 1,
              generationId: restoreState.generationId,
              preRestoreClientIds: [],
              intentRecord: restoreState,
            },
            "Rolled back uncommitted IN_PROGRESS restoration after crash check",
          );
        }
      }
    }

    const epoch = await this.getEpoch(publicationId, postId);
    const generationId = await this.getOrInitGenerationId(publicationId, postId, epoch);
    const revokedClientIds = await this.getRevokedClientIds(publicationId, postId);
    const snapshot = await this.getSnapshot(publicationId, postId);
    const updates = await this.getIncrementalUpdatesOnly(publicationId, postId);
    const finalRestoreState = await this.getRestorationState(publicationId, postId);

    return {
      epoch,
      generationId,
      revokedClientIds,
      snapshot,
      updates,
      restoreState: finalRestoreState,
    };
  }

  async saveUpdate(
    publicationId: string,
    postId: string,
    update: Uint8Array,
  ): Promise<void> {
    const memoryKey = this.getMemoryKey(publicationId, postId);
    let memList = this.inMemoryUpdates.get(memoryKey);
    if (!memList) {
      memList = [];
      this.inMemoryUpdates.set(memoryKey, memList);
    }
    memList.push(update);
    if (memList.length > 100) {
      memList.shift();
    }
    this.pruneBoundedInMemoryMaps();

    try {
      const redis = this.redisProvider();
      const key = this.getUpdatesKey(publicationId, postId);
      const base64 = Buffer.from(update).toString("base64");
      await redis.rpush(key, base64);
      this.warmKeys.add(memoryKey);
    } catch (err: unknown) {
      console.warn(
        `[CRDT Persistence] Redis write failed for post ${postId}, using memory fallback:`,
        (err as Error).message,
      );
    }
  }

  private async getIncrementalUpdatesOnly(
    publicationId: string,
    postId: string,
  ): Promise<Uint8Array[]> {
    try {
      const redis = this.redisProvider();
      const key = this.getUpdatesKey(publicationId, postId);
      const items = await redis.lrange(key, 0, -1);
      if (items && items.length > 0) {
        return items.map((b64) => new Uint8Array(Buffer.from(b64, "base64")));
      }
      return [];
    } catch (err: unknown) {
      console.warn(
        `[CRDT Persistence] Redis read failed for post ${postId}, falling back to memory:`,
        (err as Error).message,
      );
    }

    const memoryKey = this.getMemoryKey(publicationId, postId);
    return this.inMemoryUpdates.get(memoryKey) || [];
  }

  async getUpdates(
    publicationId: string,
    postId: string,
  ): Promise<Uint8Array[]> {
    const [snapshot, incremental] = await Promise.all([
      this.getSnapshot(publicationId, postId),
      this.getIncrementalUpdatesOnly(publicationId, postId),
    ]);
    if (snapshot) {
      return [snapshot, ...incremental];
    }
    return incremental;
  }

  async getSnapshot(
    publicationId: string,
    postId: string,
  ): Promise<Uint8Array | null> {
    try {
      const redis = this.redisProvider();
      const key = this.getSnapshotKey(publicationId, postId);
      const b64 = await redis.get(key);
      if (b64) {
        return new Uint8Array(Buffer.from(b64, "base64"));
      }
      return null;
    } catch {
      // Fall back to memory
    }

    const memoryKey = this.getMemoryKey(publicationId, postId);
    return this.inMemorySnapshots.get(memoryKey) || null;
  }

  async saveSnapshot(
    publicationId: string,
    postId: string,
    snapshot: Uint8Array,
  ): Promise<void> {
    const memoryKey = this.getMemoryKey(publicationId, postId);
    this.inMemorySnapshots.set(memoryKey, snapshot);

    try {
      const redis = this.redisProvider();
      const key = this.getSnapshotKey(publicationId, postId);
      const b64 = Buffer.from(snapshot).toString("base64");
      await redis.set(key, b64);
    } catch (err: unknown) {
      console.warn(
        `[CRDT Persistence] Redis save snapshot failed for post ${postId}:`,
        (err as Error).message,
      );
    }
  }

  async compact(
    publicationId: string,
    postId: string,
    mergedSnapshot: Uint8Array,
  ): Promise<void> {
    const memoryKey = this.getMemoryKey(publicationId, postId);
    try {
      const redis = this.redisProvider();
      const snapshotKey = this.getSnapshotKey(publicationId, postId);
      const updatesKey = this.getUpdatesKey(publicationId, postId);
      const b64 = Buffer.from(mergedSnapshot).toString("base64");
      const multi = redis.multi();
      multi.set(snapshotKey, b64);
      multi.del(updatesKey);
      await multi.exec();
      this.inMemorySnapshots.set(memoryKey, mergedSnapshot);
      this.inMemoryUpdates.set(memoryKey, []);
    } catch (err: unknown) {
      console.warn(
        `[CRDT Persistence] Redis compact failed for post ${postId}:`,
        (err as Error).message,
      );
    }
  }

  async clear(publicationId: string, postId: string): Promise<void> {
    const memoryKey = this.getMemoryKey(publicationId, postId);
    this.inMemoryUpdates.delete(memoryKey);
    this.inMemorySnapshots.delete(memoryKey);

    try {
      const redis = this.redisProvider();
      const updatesKey = this.getUpdatesKey(publicationId, postId);
      const snapshotKey = this.getSnapshotKey(publicationId, postId);
      await redis.del(updatesKey, snapshotKey);
    } catch {
      // Best effort
    }
  }

  /** Clears all in-memory mirrors (simulates process restart in integration/fault tests). */
  public resetInMemoryStateForTesting(): void {
    this.inMemoryUpdates.clear();
    this.inMemorySnapshots.clear();
    this.inMemoryEpochs.clear();
    this.inMemoryGenerations.clear();
    this.inMemoryRevokedClients.clear();
    this.inMemoryRestoreStates.clear();
    this.warmKeys.clear();
    this.abortPendingRecords.clear();
    this.pendingRecoveryRecords.clear();
  }
}

export const crdtPersistence = new DurableCrdtPersistence();
