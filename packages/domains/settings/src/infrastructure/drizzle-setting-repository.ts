import { getDb, settings, SettingRow } from '@vibress/database';
import { eq, and } from 'drizzle-orm';
import { SettingRepository, SettingRecord, SettingValueType, SettingClassification } from '../domain/setting';

export class DrizzleSettingRepository implements SettingRepository {
  async get(namespace: string, key: string): Promise<SettingRecord | null> {
    const db = getDb();
    const rows = await db.select().from(settings).where(and(eq(settings.namespace, namespace), eq(settings.key, key))).limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async getMany(namespace: string): Promise<SettingRecord[]> {
    const db = getDb();
    const rows = await db.select().from(settings).where(eq(settings.namespace, namespace));
    return rows.map((r) => this.mapToDomain(r));
  }

  async set(record: { namespace: string; key: string; value: unknown; valueType: SettingValueType; classification: SettingClassification; updatedBy: string | null }): Promise<SettingRecord> {
    const db = getDb();
    const existing = await this.get(record.namespace, record.key);
    if (existing) {
      const [row] = await db
        .update(settings)
        .set({ value: record.value, valueType: record.valueType, classification: record.classification, updatedBy: record.updatedBy, updatedAt: new Date() })
        .where(and(eq(settings.namespace, record.namespace), eq(settings.key, record.key)))
        .returning();
      if (!row) throw new Error('Failed to update setting');
      return this.mapToDomain(row);
    }
    const [row] = await db
      .insert(settings)
      .values({
        id: `${record.namespace}.${record.key}`,
        namespace: record.namespace,
        key: record.key,
        value: record.value,
        valueType: record.valueType,
        classification: record.classification,
        updatedBy: record.updatedBy,
        updatedAt: new Date(),
        createdAt: new Date(),
      })
      .returning();
    if (!row) throw new Error('Failed to insert setting');
    return this.mapToDomain(row);
  }

  async delete(namespace: string, key: string): Promise<void> {
    const db = getDb();
    await db.delete(settings).where(and(eq(settings.namespace, namespace), eq(settings.key, key)));
  }

  private mapToDomain(row: SettingRow): SettingRecord {
    return {
      id: row.id,
      namespace: row.namespace,
      key: row.key,
      value: row.value as unknown,
      valueType: row.valueType as SettingValueType,
      classification: row.classification as SettingClassification,
      updatedBy: row.updatedBy || null,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    };
  }
}
