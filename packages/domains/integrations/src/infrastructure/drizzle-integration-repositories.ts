import {
  getDb,
  integrations,
  IntegrationRow,
  apiKeys,
  ApiKeyRow,
} from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import {
  IntegrationRepository,
  ApiKeyRepository,
  ApiKeyRecord,
  CreateApiKeyData,
} from "../domain/repository";
import {
  Integration,
  CreateIntegrationData,
  UpdateIntegrationData,
} from "../domain/integration";

export class DrizzleIntegrationRepository implements IntegrationRepository {
  async create(data: CreateIntegrationData): Promise<Integration> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(integrations)
      .values({
        id: data.id || crypto.randomUUID(),
        key: data.key,
        type: data.type,
        name: data.name,
        status: "active",
        config: data.config || {},
        encryptedSecrets: data.secrets
          ? (data.secrets as unknown as Record<string, string>)
          : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("Failed to insert integration");
    return this.mapToDomain(row);
  }

  async findById(id: string): Promise<Integration | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(integrations)
      .where(eq(integrations.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByKey(key: string): Promise<Integration | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(integrations)
      .where(eq(integrations.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async update(id: string, data: UpdateIntegrationData): Promise<Integration> {
    const db = getDb();
    const payload: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) payload.name = data.name;
    if (data.status !== undefined) payload.status = data.status;
    if (data.config !== undefined) payload.config = data.config;
    if (data.secrets !== undefined) payload.encryptedSecrets = data.secrets;
    const [row] = await db
      .update(integrations)
      .set(payload)
      .where(eq(integrations.id, id))
      .returning();
    if (!row) throw new Error(`Integration not found: ${id}`);
    return this.mapToDomain(row);
  }

  async list(): Promise<Integration[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(integrations)
      .orderBy(integrations.createdAt);
    return rows.map((r) => this.mapToDomain(r));
  }

  private mapToDomain(row: IntegrationRow): Integration {
    return {
      id: row.id,
      key: row.key,
      type: row.type,
      name: row.name,
      status: row.status as Integration["status"],
      config: row.config as Record<string, unknown>,
      encryptedSecrets: row.encryptedSecrets as Record<string, string> | null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export class DrizzleApiKeyRepository implements ApiKeyRepository {
  async create(data: CreateApiKeyData): Promise<ApiKeyRecord> {
    const db = getDb();
    const [row] = await db
      .insert(apiKeys)
      .values({
        id: data.id || crypto.randomUUID(),
        name: data.name,
        prefix: data.prefix,
        keyHash: data.keyHash,
        scopes: data.scopes,
        integrationId: data.integrationId || null,
        expiresAt: data.expiresAt || null,
        createdAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("Failed to insert API key");
    return this.mapToDomain(row);
  }

  async findById(id: string): Promise<ApiKeyRecord | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByKeyHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async list(): Promise<ApiKeyRecord[]> {
    const db = getDb();
    const rows = await db.select().from(apiKeys).orderBy(apiKeys.createdAt);
    return rows.map((r) => this.mapToDomain(r));
  }

  async revoke(id: string): Promise<void> {
    const db = getDb();
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, id));
  }

  async touchLastUsed(id: string): Promise<void> {
    const db = getDb();
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, id));
  }

  private mapToDomain(row: ApiKeyRow): ApiKeyRecord {
    return {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      keyHash: row.keyHash,
      scopes: row.scopes as string[],
      integrationId: row.integrationId || null,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    };
  }
}
