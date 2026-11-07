export type DraftPersistenceStatus =
  | "durable"
  | "memory-only"
  | "quota-exceeded"
  | "unavailable"
  | "aborted"
  | "failed";

export interface OfflineDraftRecord {
  key: string;
  publicationId: string;
  userId: string;
  postId: string;
  epoch: number;
  baseVersion: number;
  content: unknown;
  title: string;
  updatedAt: number;
  durability?: "durable" | "memory-only" | undefined;
  /** Tab that last wrote this checkpoint; a tab may only delete checkpoints it wrote. */
  writerTabId?: string | undefined;
  /** Settings-drawer edits that must survive a browser crash alongside title/content. */
  metadata?: OfflineDraftMetadata | undefined;
}

export interface OfflineDraftMetadata {
  slug?: string | undefined;
  excerpt?: string | undefined;
  metaTitle?: string | undefined;
  metaDescription?: string | undefined;
  canonicalUrl?: string | undefined;
  tagIds?: string[] | undefined;
  featured?: boolean | undefined;
}

export interface SaveDraftResult {
  status: DraftPersistenceStatus;
  durable: boolean;
  record: OfflineDraftRecord;
  error?: string | undefined;
}

export type DraftSyncBroadcastMessage =
  | {
      type: "draft-saved";
      key: string;
      postId: string;
      publicationId: string;
      userId: string;
      baseVersion: number;
      updatedAt: number;
      tabId: string;
    }
  | {
      type: "server-synced";
      key: string;
      postId: string;
      publicationId: string;
      userId: string;
      serverVersion: number;
      updatedAt: number;
      tabId: string;
    };

const DB_NAME = "vibress_drafts";
const STORE_NAME = "drafts";
const USER_PUB_INDEX = "by_user_pub";
const DB_VERSION = 2;
const BROADCAST_CHANNEL_NAME = "vibress_draft_sync_v1";

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const domErr = err as { name?: string; code?: number; message?: string };
  return (
    domErr.name === "QuotaExceededError" ||
    domErr.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    domErr.code === 22 ||
    domErr.code === 1014 ||
    (typeof domErr.message === "string" &&
      domErr.message.toLowerCase().includes("quota"))
  );
}

export class IndexedDbDraftStore {
  private dbPromise: Promise<{
    db: IDBDatabase | null;
    failureStatus?: DraftPersistenceStatus;
    error?: string;
  }> | null = null;
  private memoryFallback = new Map<string, OfflineDraftRecord>();
  private readonly tabId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `tab_${Math.random().toString(36).slice(2)}`;

  public getTabId(): string {
    return this.tabId;
  }

  private buildKey(
    publicationId: string,
    userId: string,
    postId: string,
  ): string {
    return [publicationId, userId, postId]
      .map((segment) => encodeURIComponent(segment))
      .join(":");
  }

  public isIndexedDbSupported(): boolean {
    try {
      return (
        typeof window !== "undefined" &&
        window.indexedDB !== undefined &&
        window.indexedDB !== null &&
        typeof window.indexedDB.open === "function"
      );
    } catch {
      return false;
    }
  }

  private openDatabase(): Promise<{
    db: IDBDatabase | null;
    failureStatus?: DraftPersistenceStatus;
    error?: string;
  }> {
    if (!this.isIndexedDbSupported()) {
      return Promise.resolve({
        db: null,
        failureStatus: "memory-only",
        error: "IndexedDB is unavailable in this browser environment",
      });
    }

    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      try {
        const req = window.indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = () => {
          const db = req.result;
          let store: IDBObjectStore;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
          } else {
            store = req.transaction!.objectStore(STORE_NAME);
          }
          if (!store.indexNames.contains(USER_PUB_INDEX)) {
            store.createIndex(USER_PUB_INDEX, ["publicationId", "userId"], {
              unique: false,
            });
          }
        };

        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            try {
              db.close();
            } catch {
              // Ignore
            }
            this.dbPromise = null;
          };
          db.onclose = () => {
            this.dbPromise = null;
          };
          resolve({ db });
        };

        req.onerror = () => {
          const err = req.error;
          this.dbPromise = null;
          if (isQuotaError(err)) {
            resolve({
              db: null,
              failureStatus: "quota-exceeded",
              error: err?.message || "IndexedDB quota exceeded during open",
            });
            return;
          }
          resolve({
            db: null,
            failureStatus: "memory-only",
            error: err?.message || "IndexedDB open failed",
          });
        };

        req.onblocked = () => {
          this.dbPromise = null;
          resolve({
            db: null,
            failureStatus: "memory-only",
            error: "IndexedDB upgrade blocked by another open connection",
          });
        };
      } catch (err: unknown) {
        this.dbPromise = null;
        if (isQuotaError(err)) {
          resolve({
            db: null,
            failureStatus: "quota-exceeded",
            error: (err as Error)?.message || "IndexedDB quota exceeded",
          });
          return;
        }
        resolve({
          db: null,
          failureStatus: "memory-only",
          error: (err as Error)?.message || "IndexedDB unavailable",
        });
      }
    });

    return this.dbPromise;
  }

  private broadcast(msg: DraftSyncBroadcastMessage): void {
    if (typeof BroadcastChannel === "undefined") return;
    try {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channel.postMessage(msg);
      channel.close();
    } catch {
      // Ignore BroadcastChannel restrictions
    }
  }

  public subscribeToDraftEvents(
    listener: (msg: DraftSyncBroadcastMessage) => void,
  ): () => void {
    if (typeof BroadcastChannel === "undefined") {
      return () => {};
    }
    try {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      const handler = (event: MessageEvent<DraftSyncBroadcastMessage>) => {
        if (event.data && event.data.tabId !== this.tabId) {
          listener(event.data);
        }
      };
      channel.addEventListener("message", handler);
      return () => {
        channel.removeEventListener("message", handler);
        channel.close();
      };
    } catch {
      return () => {};
    }
  }

  public notifyServerSynced(params: {
    publicationId: string;
    userId: string;
    postId: string;
    serverVersion: number;
  }): void {
    const key = this.buildKey(
      params.publicationId,
      params.userId,
      params.postId,
    );
    this.broadcast({
      type: "server-synced",
      key,
      postId: params.postId,
      publicationId: params.publicationId,
      userId: params.userId,
      serverVersion: params.serverVersion,
      updatedAt: Date.now(),
      tabId: this.tabId,
    });
  }

  /**
   * Durably persists a draft checkpoint to IndexedDB.
   * Resolves ONLY on `tx.oncomplete` when IndexedDB commits to storage.
   * Never reports volatile memory fallback as `"durable"`.
   */
  async saveDraft(
    record: Omit<OfflineDraftRecord, "key" | "durability">,
  ): Promise<SaveDraftResult> {
    const key = this.buildKey(
      record.publicationId,
      record.userId,
      record.postId,
    );

    const opened = await this.openDatabase();
    if (!opened.db) {
      const fallbackRecord: OfflineDraftRecord = {
        ...record,
        key,
        durability: "memory-only",
      };
      const existingMem = this.memoryFallback.get(key);
      if (!existingMem || fallbackRecord.updatedAt >= existingMem.updatedAt) {
        this.memoryFallback.set(key, fallbackRecord);
      }
      const status = opened.failureStatus || "memory-only";
      return {
        status,
        durable: false,
        record: fallbackRecord,
        error: opened.error,
      };
    }

    const db = opened.db;

    return new Promise<SaveDraftResult>((resolve) => {
      let settled = false;
      const finish = (result: SaveDraftResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const durableRecord: OfflineDraftRecord = {
        ...record,
        key,
        durability: "durable",
        writerTabId: this.tabId,
      };
      const volatileRecord: OfflineDraftRecord = {
        ...record,
        key,
        durability: "memory-only",
        writerTabId: this.tabId,
      };

      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        let requestError: unknown = null;
        let finalSavedRecord = durableRecord;

        tx.oncomplete = () => {
          // Transaction durably committed — remove any stale volatile copy
          this.memoryFallback.delete(key);
          this.broadcast({
            type: "draft-saved",
            key,
            postId: record.postId,
            publicationId: record.publicationId,
            userId: record.userId,
            baseVersion: record.baseVersion,
            updatedAt: finalSavedRecord.updatedAt,
            tabId: this.tabId,
          });
          finish({
            status: "durable",
            durable: true,
            record: finalSavedRecord,
          });
        };

        tx.onabort = () => {
          const err = requestError || tx.error;
          this.memoryFallback.set(key, volatileRecord);
          if (isQuotaError(err)) {
            finish({
              status: "quota-exceeded",
              durable: false,
              record: volatileRecord,
              error:
                (err as Error)?.message ||
                "Browser storage quota exceeded while saving offline draft",
            });
            return;
          }
          finish({
            status: "aborted",
            durable: false,
            record: volatileRecord,
            error:
              (err as Error)?.message || "IndexedDB write transaction aborted",
          });
        };

        tx.onerror = () => {
          const err = requestError || tx.error;
          this.memoryFallback.set(key, volatileRecord);
          if (isQuotaError(err)) {
            finish({
              status: "quota-exceeded",
              durable: false,
              record: volatileRecord,
              error:
                (err as Error)?.message ||
                "Browser storage quota exceeded while saving offline draft",
            });
            return;
          }
          // In Chromium/WebKit, aborting a transaction with in-flight requests
          // dispatches an AbortError on the active request (bubbling to tx.onerror)
          // immediately before tx.onabort fires. Classify AbortError as "aborted".
          if (
            err &&
            typeof err === "object" &&
            (err as { name?: string }).name === "AbortError"
          ) {
            finish({
              status: "aborted",
              durable: false,
              record: volatileRecord,
              error:
                (err as Error)?.message || "IndexedDB write transaction aborted",
            });
            return;
          }
          finish({
            status: "failed",
            durable: false,
            record: volatileRecord,
            error: (err as Error)?.message || "IndexedDB write failed",
          });
        };

        const existingReq = store.get(key);
        existingReq.onsuccess = () => {
          const existing = existingReq.result as OfflineDraftRecord | undefined;
          // Monotonic guard: never overwrite a strictly newer draft checkpoint
          if (existing && existing.updatedAt > durableRecord.updatedAt) {
            finalSavedRecord = existing;
            return;
          }
          try {
            const putReq = store.put(durableRecord);
            putReq.onerror = () => {
              requestError = putReq.error;
            };
          } catch (putErr: unknown) {
            requestError = putErr;
            this.memoryFallback.set(key, volatileRecord);
            if (isQuotaError(putErr)) {
              try {
                tx.abort();
              } catch {
                // Transaction may already be inactive
              }
              finish({
                status: "quota-exceeded",
                durable: false,
                record: volatileRecord,
                error:
                  (putErr as Error)?.message ||
                  "Browser storage quota exceeded while saving offline draft",
              });
              return;
            }
            try {
              tx.abort();
            } catch {
              // Transaction may already be inactive
            }
            finish({
              status: "failed",
              durable: false,
              record: volatileRecord,
              error: (putErr as Error)?.message || "IndexedDB write failed",
            });
          }
        };
        existingReq.onerror = () => {
          requestError = existingReq.error;
        };
      } catch (err: unknown) {
        // Handle stale/corrupted DB handle
        this.dbPromise = null;
        this.memoryFallback.set(key, volatileRecord);
        if (isQuotaError(err)) {
          finish({
            status: "quota-exceeded",
            durable: false,
            record: volatileRecord,
            error: (err as Error)?.message || "IndexedDB quota exceeded",
          });
          return;
        }
        finish({
          status: "unavailable",
          durable: false,
          record: volatileRecord,
          error:
            (err as Error)?.message || "IndexedDB transaction unavailable",
        });
      }
    });
  }

  async getDraft(
    publicationId: string,
    userId: string,
    postId: string,
  ): Promise<OfflineDraftRecord | null> {
    const key = this.buildKey(publicationId, userId, postId);
    const memDraft = this.memoryFallback.get(key) || null;
    const opened = await this.openDatabase();
    if (!opened.db) {
      return memDraft;
    }

    const db = opened.db;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        let result: OfflineDraftRecord | null = null;
        req.onsuccess = () => {
          result = (req.result as OfflineDraftRecord) || null;
        };
        tx.oncomplete = () => {
          if (result && memDraft) {
            resolve(
              memDraft.updatedAt > result.updatedAt ? memDraft : result,
            );
          } else {
            resolve(result || memDraft);
          }
        };
        tx.onerror = () => resolve(memDraft);
        tx.onabort = () => resolve(memDraft);
      } catch {
        this.dbPromise = null;
        resolve(memDraft);
      }
    });
  }

  async deleteDraft(
    publicationId: string,
    userId: string,
    postId: string,
  ): Promise<boolean> {
    const key = this.buildKey(publicationId, userId, postId);
    this.memoryFallback.delete(key);

    const opened = await this.openDatabase();
    if (!opened.db) return false;

    const db = opened.db;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        this.dbPromise = null;
        resolve(false);
      }
    });
  }

  /**
   * Deletes a draft checkpoint ONLY when this tab wrote it and it is not newer than the
   * snapshot just acknowledged by the server. Atomic read-modify-delete inside a single
   * readwrite transaction so a sibling tab's unsynced checkpoint is never destroyed.
   */
  async deleteDraftIfSynced(
    publicationId: string,
    userId: string,
    postId: string,
    syncedSnapshotStartedAt: number,
  ): Promise<boolean> {
    const key = this.buildKey(publicationId, userId, postId);
    const mem = this.memoryFallback.get(key);
    if (
      mem &&
      (mem.writerTabId === undefined || mem.writerTabId === this.tabId) &&
      mem.updatedAt <= syncedSnapshotStartedAt
    ) {
      this.memoryFallback.delete(key);
    }

    const opened = await this.openDatabase();
    if (!opened.db) return false;

    const db = opened.db;
    return new Promise((resolve) => {
      let deleted = false;
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          const existing = getReq.result as OfflineDraftRecord | undefined;
          if (!existing) return;
          const ownedByThisTab =
            existing.writerTabId === undefined ||
            existing.writerTabId === this.tabId;
          if (ownedByThisTab && existing.updatedAt <= syncedSnapshotStartedAt) {
            store.delete(key);
            deleted = true;
          }
        };
        tx.oncomplete = () => resolve(deleted);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        this.dbPromise = null;
        resolve(false);
      }
    });
  }

  async listDraftsForUser(
    publicationId: string,
    userId: string,
  ): Promise<OfflineDraftRecord[]> {
    const opened = await this.openDatabase();
    if (!opened.db) {
      return Array.from(this.memoryFallback.values()).filter(
        (d) => d.publicationId === publicationId && d.userId === userId,
      );
    }

    const db = opened.db;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        let all: OfflineDraftRecord[] = [];
        req.onsuccess = () => {
          all = (req.result as OfflineDraftRecord[]) || [];
        };
        tx.oncomplete = () => {
          const merged = new Map<string, OfflineDraftRecord>();
          for (const d of all) {
            if (d.publicationId === publicationId && d.userId === userId) {
              merged.set(d.key, d);
            }
          }
          for (const d of this.memoryFallback.values()) {
            if (d.publicationId === publicationId && d.userId === userId) {
              const prev = merged.get(d.key);
              if (!prev || d.updatedAt > prev.updatedAt) {
                merged.set(d.key, d);
              }
            }
          }
          resolve(Array.from(merged.values()));
        };
        tx.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
      } catch {
        this.dbPromise = null;
        resolve([]);
      }
    });
  }

  async clearOtherUsersDrafts(activeUserId: string): Promise<void> {
    for (const [k, v] of this.memoryFallback.entries()) {
      if (v.userId !== activeUserId) {
        this.memoryFallback.delete(k);
      }
    }
    const opened = await this.openDatabase();
    if (!opened.db) return;

    const db = opened.db;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const all = (req.result as OfflineDraftRecord[]) || [];
          for (const rec of all) {
            if (rec.userId !== activeUserId) {
              store.delete(rec.key);
            }
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        this.dbPromise = null;
        resolve();
      }
    });
  }

  async clearAll(): Promise<void> {
    this.memoryFallback.clear();
    const opened = await this.openDatabase();
    if (!opened.db) return;

    const db = opened.db;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        this.dbPromise = null;
        resolve();
      }
    });
  }

  /** Closes any cached DB connection (useful for upgrade/corruption tests). */
  public async resetConnection(): Promise<void> {
    if (this.dbPromise) {
      const opened = await this.dbPromise;
      try {
        opened.db?.close();
      } catch {
        // Ignore
      }
      this.dbPromise = null;
    }
  }
}

export const indexedDbDraftStore = new IndexedDbDraftStore();
