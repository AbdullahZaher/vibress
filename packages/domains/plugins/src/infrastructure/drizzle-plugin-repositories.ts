import { getDb, plugins, PluginRow, pluginSettings, PluginSettingRow } from '@vibress/database';
import { eq, and } from 'drizzle-orm';
import crypto from 'node:crypto';
import { PluginRepository, PluginSettingRepository, Plugin, PluginSetting, RegisterPluginData, PluginStatus } from '../domain/plugin';

export class DrizzlePluginRepository implements PluginRepository {
  async create(data: RegisterPluginData): Promise<Plugin> {
    const db = getDb();
    const now = new Date();
    const [row] = await db
      .insert(plugins)
      .values({
        id: data.id || crypto.randomUUID(),
        manifestId: data.manifestId,
        name: data.name,
        version: data.version,
        vibressApiVersion: data.vibressApiVersion,
        description: data.description || null,
        entrypoint: data.entrypoint,
        capabilities: data.capabilities,
        hooks: data.hooks || [],
        settingsSchema: data.settingsSchema || {},
        status: 'registered',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error('Failed to insert plugin');
    return this.mapToDomain(row);
  }

  async findById(id: string): Promise<Plugin | null> {
    const db = getDb();
    const rows = await db.select().from(plugins).where(eq(plugins.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByManifestId(manifestId: string): Promise<Plugin | null> {
    const db = getDb();
    const rows = await db.select().from(plugins).where(eq(plugins.manifestId, manifestId)).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async updateStatus(id: string, status: PluginStatus): Promise<Plugin> {
    const db = getDb();
    const [row] = await db.update(plugins).set({ status, updatedAt: new Date() }).where(eq(plugins.id, id)).returning();
    if (!row) throw new Error(`Plugin not found: ${id}`);
    return this.mapToDomain(row);
  }

  async updateMetadata(id: string, data: Partial<RegisterPluginData>): Promise<Plugin> {
    const db = getDb();
    const payload: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) payload.name = data.name;
    if (data.version !== undefined) payload.version = data.version;
    if (data.description !== undefined) payload.description = data.description;
    if (data.entrypoint !== undefined) payload.entrypoint = data.entrypoint;
    if (data.capabilities !== undefined) payload.capabilities = data.capabilities;
    if (data.hooks !== undefined) payload.hooks = data.hooks;
    if (data.settingsSchema !== undefined) payload.settingsSchema = data.settingsSchema;
    const [row] = await db.update(plugins).set(payload).where(eq(plugins.id, id)).returning();
    if (!row) throw new Error(`Plugin not found: ${id}`);
    return this.mapToDomain(row);
  }

  async list(): Promise<Plugin[]> {
    const db = getDb();
    const rows = await db.select().from(plugins).orderBy(plugins.createdAt);
    return rows.map((r) => this.mapToDomain(r));
  }

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db.delete(plugins).where(eq(plugins.id, id));
  }

  private mapToDomain(row: PluginRow): Plugin {
    return {
      id: row.id,
      manifestId: row.manifestId,
      name: row.name,
      version: row.version,
      vibressApiVersion: row.vibressApiVersion,
      description: row.description || null,
      entrypoint: row.entrypoint,
      capabilities: row.capabilities as string[],
      hooks: row.hooks as string[],
      settingsSchema: row.settingsSchema as Record<string, unknown>,
      status: row.status as PluginStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export class DrizzlePluginSettingRepository implements PluginSettingRepository {
  async set(pluginId: string, key: string, value: string | null, encryptedValue: string | null, isSecret: boolean): Promise<void> {
    const db = getDb();
    const existing = await db
      .select()
      .from(pluginSettings)
      .where(and(eq(pluginSettings.pluginId, pluginId), eq(pluginSettings.key, key)))
      .limit(1);

    if (existing[0]) {
      await db
        .update(pluginSettings)
        .set({ value, encryptedValue, isSecret, updatedAt: new Date() })
        .where(eq(pluginSettings.id, existing[0].id));
    } else {
      await db.insert(pluginSettings).values({
        id: crypto.randomUUID(),
        pluginId,
        key,
        value,
        encryptedValue,
        isSecret,
        updatedAt: new Date(),
        createdAt: new Date(),
      });
    }
  }

  async listForPlugin(pluginId: string): Promise<PluginSetting[]> {
    const db = getDb();
    const rows = await db.select().from(pluginSettings).where(eq(pluginSettings.pluginId, pluginId));
    return rows.map((r) => this.mapToDomain(r));
  }

  async getSecret(pluginId: string, key: string): Promise<string | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(pluginSettings)
      .where(and(eq(pluginSettings.pluginId, pluginId), eq(pluginSettings.key, key)))
      .limit(1);
    const row = rows[0];
    if (!row || !row.encryptedValue) return null;
    return row.encryptedValue;
  }

  private mapToDomain(row: PluginSettingRow): PluginSetting {
    return {
      id: row.id,
      pluginId: row.pluginId,
      key: row.key,
      value: row.value,
      encryptedValue: row.encryptedValue,
      isSecret: row.isSecret,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    };
  }
}
