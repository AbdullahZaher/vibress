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

  async getActive(publicationId = "pub_default"): Promise<ThemeConfiguration | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(themeConfigurations)
      .where(eq(themeConfigurations.publicationId, publicationId))
      .limit(1);
    if (!rows[0]) return null;
    return this.mapToDomain(rows[0]);
  }

  async setActive(
    config: ThemeConfiguration,
    publicationId = "pub_default",
  ): Promise<ThemeConfiguration> {
    const db = getDb();
    const [row] = await db
      .insert(themeConfigurations)
      .values({
        id: crypto.randomUUID(),
        publicationId,
        themeId: config.themeId,
        themeVersion: config.themeVersion,
        settingsJson: config.settings,
        settingsSchemaVersion: config.settingsSchemaVersion,
        activatedBy: config.activatedBy,
        activatedAt: config.activatedAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: themeConfigurations.publicationId,
        set: {
          themeId: config.themeId,
          themeVersion: config.themeVersion,
          settingsJson: config.settings,
          settingsSchemaVersion: config.settingsSchemaVersion,
          activatedBy: config.activatedBy,
          activatedAt: config.activatedAt,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error("Failed to save active theme configuration");
    return this.mapToDomain(row);
  }
}
