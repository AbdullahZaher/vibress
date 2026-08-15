import {
  getDb,
  storageConfigurations,
  uploadSessions,
} from "@vibress/database";
import { eq, desc, count } from "drizzle-orm";
import { StorageError } from "@vibress/storage-core";
import {
  StorageConfiguration,
  CreateStorageConfigurationData,
  UpdateStorageConfigurationData,
  UploadSession,
} from "../domain/storage-config";
import crypto from "node:crypto";

export class DrizzleStorageRepository {
  async listConfigurations(): Promise<StorageConfiguration[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(storageConfigurations)
      .orderBy(desc(storageConfigurations.createdAt));

    return rows.map((r) => this.mapConfigToDomain(r));
  }

  async findConfigurationById(
    id: string,
  ): Promise<StorageConfiguration | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(storageConfigurations)
      .where(eq(storageConfigurations.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return this.mapConfigToDomain(row);
  }

  async findActiveConfiguration(): Promise<StorageConfiguration | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(storageConfigurations)
      .where(eq(storageConfigurations.isActive, true))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return this.mapConfigToDomain(row);
  }

  async createConfiguration(
    data: CreateStorageConfigurationData & {
      encryptedCredentials?: string | null;
    },
  ): Promise<StorageConfiguration> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();

    const insertPayload = {
      id,
      name: data.name,
      providerType: data.providerType,
      endpoint: data.endpoint || null,
      region: data.region || null,
      bucket: data.bucket || null,
      publicBaseUrl: data.publicBaseUrl || null,
      forcePathStyle: data.forcePathStyle ?? false,
      encryptedCredentials: data.encryptedCredentials || null,
      encryptionVersion: 1,
      isActive: false,
      createdBy: data.createdBy || null,
      createdAt: now,
      updatedAt: now,
    };

    const rows = await db
      .insert(storageConfigurations)
      .values(insertPayload)
      .returning();
    const row = rows[0];
    if (!row) throw new Error("Failed to insert storage configuration");
    return this.mapConfigToDomain(row);
  }

  async updateConfiguration(
    id: string,
    data: UpdateStorageConfigurationData & {
      encryptedCredentials?: string | null;
    },
  ): Promise<StorageConfiguration> {
    const db = getDb();
    const now = new Date();

    const updatePayload: Record<string, unknown> = {
      updatedAt: now,
    };

    if (data.name !== undefined) updatePayload.name = data.name;
    if (data.providerType !== undefined)
      updatePayload.providerType = data.providerType;
    if (data.endpoint !== undefined) updatePayload.endpoint = data.endpoint;
    if (data.region !== undefined) updatePayload.region = data.region;
    if (data.bucket !== undefined) updatePayload.bucket = data.bucket;
    if (data.publicBaseUrl !== undefined)
      updatePayload.publicBaseUrl = data.publicBaseUrl;
    if (data.forcePathStyle !== undefined)
      updatePayload.forcePathStyle = data.forcePathStyle;
    if (data.encryptedCredentials !== undefined)
      updatePayload.encryptedCredentials = data.encryptedCredentials;

    const [row] = await db
      .update(storageConfigurations)
      .set(updatePayload)
      .where(eq(storageConfigurations.id, id))
      .returning();

    if (!row) throw new Error(`Storage configuration not found: ${id}`);
    return this.mapConfigToDomain(row);
  }

  async activateConfiguration(id: string): Promise<StorageConfiguration> {
    const db = getDb();
    const now = new Date();

    // Deactivate all first
    await db
      .update(storageConfigurations)
      .set({ isActive: false, updatedAt: now });

    // Activate target
    const [row] = await db
      .update(storageConfigurations)
      .set({ isActive: true, updatedAt: now })
      .where(eq(storageConfigurations.id, id))
      .returning();

    if (!row)
      throw new Error(`Storage configuration not found to activate: ${id}`);
    return this.mapConfigToDomain(row);
  }

  async deleteConfiguration(id: string): Promise<void> {
    const db = getDb();

    // Check if references exist in upload_sessions or media_assets
    const sessionCount = await db
      .select({ totalCount: count() })
      .from(uploadSessions)
      .where(eq(uploadSessions.storageConfigurationId, id));

    if ((sessionCount[0]?.totalCount || 0) > 0) {
      throw new StorageError(
        `Storage configuration '${id}' is in use by active upload sessions`,
        "STORAGE_PROVIDER_IN_USE",
      );
    }

    await db
      .delete(storageConfigurations)
      .where(eq(storageConfigurations.id, id));
  }

  // Upload Session methods
  async createUploadSession(data: {
    id?: string;
    actorId: string;
    storageConfigurationId?: string | null;
    storageKey: string;
    originalFilename: string;
    declaredMime: string;
    expectedSize: number;
    assetType: "image" | "video" | "audio" | "file";
    expiresAt: Date;
    multipartUploadId?: string | null;
  }): Promise<UploadSession> {
    const db = getDb();
    const id = data.id || crypto.randomUUID();
    const now = new Date();

    const insertPayload = {
      id,
      actorId: data.actorId,
      storageConfigurationId: data.storageConfigurationId || null,
      storageKey: data.storageKey,
      originalFilename: data.originalFilename,
      declaredMime: data.declaredMime,
      expectedSize: data.expectedSize,
      assetType: data.assetType,
      state: "pending",
      expiresAt: data.expiresAt,
      multipartUploadId: data.multipartUploadId || null,
      createdAt: now,
      updatedAt: now,
    };

    const rows = await db
      .insert(uploadSessions)
      .values(insertPayload)
      .returning();
    const row = rows[0];
    if (!row) throw new Error("Failed to insert upload session");
    return this.mapSessionToDomain(row);
  }

  async findUploadSessionById(id: string): Promise<UploadSession | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapSessionToDomain(row);
  }

  async updateUploadSessionState(
    id: string,
    state: "pending" | "uploaded" | "verified" | "failed",
  ): Promise<UploadSession> {
    const db = getDb();
    const now = new Date();

    const [row] = await db
      .update(uploadSessions)
      .set({ state, updatedAt: now })
      .where(eq(uploadSessions.id, id))
      .returning();

    if (!row) throw new Error(`Upload session not found: ${id}`);
    return this.mapSessionToDomain(row);
  }

  private mapConfigToDomain(
    row: typeof storageConfigurations.$inferSelect,
  ): StorageConfiguration {
    return {
      id: row.id,
      name: row.name,
      providerType: row.providerType,
      endpoint: row.endpoint,
      region: row.region,
      bucket: row.bucket,
      publicBaseUrl: row.publicBaseUrl,
      forcePathStyle: row.forcePathStyle,
      encryptedCredentials: row.encryptedCredentials,
      encryptionVersion: row.encryptionVersion,
      isActive: row.isActive,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapSessionToDomain(
    row: typeof uploadSessions.$inferSelect,
  ): UploadSession {
    return {
      id: row.id,
      actorId: row.actorId,
      storageConfigurationId: row.storageConfigurationId,
      storageKey: row.storageKey,
      originalFilename: row.originalFilename,
      declaredMime: row.declaredMime,
      expectedSize: row.expectedSize,
      assetType: row.assetType as UploadSession["assetType"],
      state: row.state as UploadSession["state"],
      expiresAt: row.expiresAt,
      multipartUploadId: row.multipartUploadId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
