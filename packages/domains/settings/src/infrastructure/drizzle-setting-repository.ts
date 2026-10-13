import { getDb, settings, SettingRow } from "@vibress/database";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  SettingRepository,
  SettingRecord,
  SettingValueType,
  SettingClassification,
} from "../domain/setting";

export class DrizzleSettingRepository implements SettingRepository {
  async get(
    namespace: string,
    key: string,
    publicationId = "pub_default",
  ): Promise<SettingRecord | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(settings)
      .where(
        and(
          eq(settings.publicationId, publicationId),
          eq(settings.namespace, namespace),
          eq(settings.key, key),
        ),
      )
      .limit(1);
    return rows[0] ? this.mapToDomain(rows[0]) : null;
  }

  async getMany(
    namespace: string,
    publicationId = "pub_default",
  ): Promise<SettingRecord[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(settings)
      .where(
        and(
          eq(settings.publicationId, publicationId),
          eq(settings.namespace, namespace),
        ),
      );
    return rows.map((row) => this.mapToDomain(row));
  }

  async set(record: {
    namespace: string;
    key: string;
    value: unknown;
    valueType: SettingValueType;
    classification: SettingClassification;
    updatedBy: string | null;
    publicationId?: string;
  }): Promise<SettingRecord> {
    const db = getDb();
    const publicationId = record.publicationId ?? "pub_default";
    const now = new Date();
    const [row] = await db
      .insert(settings)
      .values({
        id: randomUUID(),
        publicationId,
        namespace: record.namespace,
        key: record.key,
        value: record.value,
        valueType: record.valueType,
        classification: record.classification,
        updatedBy: record.updatedBy,
        updatedAt: now,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [settings.publicationId, settings.namespace, settings.key],
        set: {
          value: record.value,
          valueType: record.valueType,
          classification: record.classification,
          updatedBy: record.updatedBy,
          updatedAt: now,
        },
      })
      .returning();
    if (!row) throw new Error("Failed to save setting");
    return this.mapToDomain(row);
  }

  async delete(
    namespace: string,
    key: string,
    publicationId = "pub_default",
  ): Promise<void> {
    const db = getDb();
    await db
      .delete(settings)
      .where(
        and(
          eq(settings.publicationId, publicationId),
          eq(settings.namespace, namespace),
          eq(settings.key, key),
        ),
      );
  }

  private mapToDomain(row: SettingRow): SettingRecord {
    return {
      id: row.id,
      namespace: row.namespace,
      key: row.key,
      value: row.value,
      valueType: row.valueType as SettingValueType,
      classification: row.classification as SettingClassification,
      updatedBy: row.updatedBy ?? null,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    };
  }
}
