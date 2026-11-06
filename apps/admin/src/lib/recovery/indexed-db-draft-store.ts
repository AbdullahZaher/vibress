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
}

const DB_NAME = "vibress_drafts";
const STORE_NAME = "drafts";
const DB_VERSION = 1;

export class IndexedDbDraftStore {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private memoryFallback = new Map<string, OfflineDraftRecord>();

  private buildKey(publicationId: string, userId: string, postId: string): string {
    return `${publicationId}:${userId}:${postId}`;
  }

  private isSupported(): boolean {
    return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
  }

  private async getDb(): Promise<IDBDatabase | null> {
    if (!this.isSupported()) return null;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      try {
        const req = window.indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: "key" });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          console.warn("[IndexedDbDraftStore] Open failed, using memory fallback");
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  async saveDraft(record: Omit<OfflineDraftRecord, "key">): Promise<void> {
    const key = this.buildKey(record.publicationId, record.userId, record.postId);
    const fullRecord: OfflineDraftRecord = { ...record, key };

    const db = await this.getDb();
    if (!db) {
      this.memoryFallback.set(key, fullRecord);
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(fullRecord);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (err) {
        this.memoryFallback.set(key, fullRecord);
        resolve();
      }
    });
  }

  async getDraft(
    publicationId: string,
    userId: string,
    postId: string,
  ): Promise<OfflineDraftRecord | null> {
    const key = this.buildKey(publicationId, userId, postId);
    const db = await this.getDb();
    if (!db) {
      return this.memoryFallback.get(key) || null;
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve((req.result as OfflineDraftRecord) || null);
        req.onerror = () => resolve(this.memoryFallback.get(key) || null);
      } catch {
        resolve(this.memoryFallback.get(key) || null);
      }
    });
  }

  async deleteDraft(
    publicationId: string,
    userId: string,
    postId: string,
  ): Promise<void> {
    const key = this.buildKey(publicationId, userId, postId);
    this.memoryFallback.delete(key);

    const db = await this.getDb();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async listDraftsForUser(
    publicationId: string,
    userId: string,
  ): Promise<OfflineDraftRecord[]> {
    const db = await this.getDb();
    if (!db) {
      return Array.from(this.memoryFallback.values()).filter(
        (d) => d.publicationId === publicationId && d.userId === userId,
      );
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const all = (req.result as OfflineDraftRecord[]) || [];
          resolve(
            all.filter(
              (d) => d.publicationId === publicationId && d.userId === userId,
            ),
          );
        };
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  async clearAll(): Promise<void> {
    this.memoryFallback.clear();
    const db = await this.getDb();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

export const indexedDbDraftStore = new IndexedDbDraftStore();
