import {
  ThemeConfiguration,
  ThemeConfigurationRepository,
} from "../domain/theme-configuration";
import {
  getDb,
  themeConfigurations,
  ThemeConfigurationRow,
} from "@vibress/database";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";

export class DrizzleThemeConfigurationRepository implements ThemeConfigurationRepository {
  private mapToDomain(row: ThemeConfigurationRow): ThemeConfiguration {
    return {
      id: row.id,
      themeId: row.themeId,
      themeVersion: row.themeVersion,
      settings: row.settingsJson as Record<string, unknown>,
      settingsSchemaVersion: row.settingsSchemaVersion,
      activatedBy: row.activatedBy,
      activatedAt: row.activatedAt,
      updatedAt: row.updatedAt,
    };
  }

  async getActive(): Promise<ThemeConfiguration | null> {
    const db = getDb();
    const rows = await db.select().from(themeConfigurations).limit(1);
    if (!rows[0]) return null;
    return this.mapToDomain(rows[0]);
  }

  async setActive(config: ThemeConfiguration): Promise<ThemeConfiguration> {
    const db = getDb();
    const existing = await db.select().from(themeConfigurations).limit(1);

    if (existing[0]) {
      const [row] = await db
        .update(themeConfigurations)
        .set({
          themeId: config.themeId,
          themeVersion: config.themeVersion,
          settingsJson: config.settings,
          settingsSchemaVersion: config.settingsSchemaVersion,
          activatedBy: config.activatedBy,
          activatedAt: config.activatedAt,
          updatedAt: new Date(),
        })
        .where(eq(themeConfigurations.id, existing[0].id))
        .returning();
      if (!row) throw new Error("Failed to update active theme configuration");
      return this.mapToDomain(row);
    }

    const [row] = await db
      .insert(themeConfigurations)
      .values({
        id: config.id || crypto.randomUUID(),
        themeId: config.themeId,
        themeVersion: config.themeVersion,
        settingsJson: config.settings,
        settingsSchemaVersion: config.settingsSchemaVersion,
        activatedBy: config.activatedBy,
        activatedAt: config.activatedAt,
        updatedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("Failed to insert active theme configuration");
    return this.mapToDomain(row);
  }
}
