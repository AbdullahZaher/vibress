import {
  InstalledTheme,
  InstalledThemeRepository,
  ThemeStatus,
} from "../domain/installed-theme";
import {
  getDb,
  installedThemes,
  themeSettings,
  InstalledThemeRow,
} from "@vibress/database";
import { ThemeManifest, ThemeSettingsSchema } from "@vibress/theme-core";
import { eq, and, desc } from "drizzle-orm";
import crypto from "node:crypto";

export class DrizzleInstalledThemeRepository implements InstalledThemeRepository {
  private mapToDomain(row: InstalledThemeRow): InstalledTheme {
    return {
      id: row.id,
      publicationId: row.publicationId,
      themeId: row.themeId,
      name: row.name,
      version: row.version,
      themeApiVersion: row.themeApiVersion,
      description: row.description,
      author: row.author,
      previewImage: row.previewImage,
      manifest: row.manifestJson as ThemeManifest,
      settingsSchema: row.settingsSchemaJson as ThemeSettingsSchema,
      storagePath: row.storagePath,
      status: row.status as ThemeStatus,
      isBuiltIn: row.isBuiltIn,
      installedAt: row.installedAt,
      updatedAt: row.updatedAt,
    };
  }

  async listAll(publicationId?: string): Promise<InstalledTheme[]> {
    const db = getDb();
    let query = db
      .select()
      .from(installedThemes);
    if (publicationId) {
      query = query.where(eq(installedThemes.publicationId, publicationId)) as any;
    }
    const rows = await query.orderBy(desc(installedThemes.updatedAt));
    return rows.map((r) => this.mapToDomain(r));
  }

  async findById(id: string, publicationId?: string): Promise<InstalledTheme | null> {
    const db = getDb();
    const conditions = [eq(installedThemes.id, id)];
    if (publicationId) conditions.push(eq(installedThemes.publicationId, publicationId));
    const rows = await db
      .select()
      .from(installedThemes)
      .where(and(...conditions))
      .limit(1);
    if (!rows[0]) return null;
    return this.mapToDomain(rows[0]);
  }

  async findByThemeId(themeId: string, publicationId?: string): Promise<InstalledTheme | null> {
    const db = getDb();
    const conditions = [eq(installedThemes.themeId, themeId)];
    if (publicationId) conditions.push(eq(installedThemes.publicationId, publicationId));
    // Return latest version or active version
    const rows = await db
      .select()
      .from(installedThemes)
      .where(and(...conditions))
      .orderBy(desc(installedThemes.updatedAt))
      .limit(1);
    if (!rows[0]) return null;
    return this.mapToDomain(rows[0]);
  }

  async findByThemeIdAndVersion(
    themeId: string,
    version: string,
    publicationId?: string,
  ): Promise<InstalledTheme | null> {
    const db = getDb();
    const conditions = [
      eq(installedThemes.themeId, themeId),
      eq(installedThemes.version, version),
    ];
    if (publicationId) conditions.push(eq(installedThemes.publicationId, publicationId));
    const rows = await db
      .select()
      .from(installedThemes)
      .where(and(...conditions))
      .limit(1);
    if (!rows[0]) return null;
    return this.mapToDomain(rows[0]);
  }

  async listVersions(themeId: string, publicationId?: string): Promise<InstalledTheme[]> {
    const db = getDb();
    const conditions = [eq(installedThemes.themeId, themeId)];
    if (publicationId) conditions.push(eq(installedThemes.publicationId, publicationId));
    const rows = await db
      .select()
      .from(installedThemes)
      .where(and(...conditions))
      .orderBy(desc(installedThemes.version));
    return rows.map((r) => this.mapToDomain(r));
  }

  async create(theme: InstalledTheme, publicationId?: string): Promise<InstalledTheme> {
    const db = getDb();
    const id = theme.id || crypto.randomUUID();
    const pubId = publicationId || theme.publicationId || "pub_default";
    const [row] = await db
      .insert(installedThemes)
      .values({
        id,
        publicationId: pubId,
        themeId: theme.themeId,
        name: theme.name,
        version: theme.version,
        themeApiVersion: theme.themeApiVersion,
        description: theme.description ?? null,
        author: theme.author ?? null,
        previewImage: theme.previewImage ?? null,
        manifestJson: theme.manifest,
        settingsSchemaJson: theme.settingsSchema,
        storagePath: theme.storagePath,
        status: theme.status,
        isBuiltIn: theme.isBuiltIn,
        installedAt: theme.installedAt || new Date(),
        updatedAt: theme.updatedAt || new Date(),
      })
      .returning();
    if (!row) throw new Error("Failed to insert installed theme");
    return this.mapToDomain(row);
  }

  async update(theme: InstalledTheme, publicationId?: string): Promise<InstalledTheme> {
    const db = getDb();
    const pubId = publicationId || theme.publicationId || "pub_default";
    const conditions = [
      eq(installedThemes.themeId, theme.themeId),
      eq(installedThemes.version, theme.version),
      eq(installedThemes.publicationId, pubId),
    ];
    const [row] = await db
      .update(installedThemes)
      .set({
        name: theme.name,
        themeApiVersion: theme.themeApiVersion,
        description: theme.description ?? null,
        author: theme.author ?? null,
        previewImage: theme.previewImage ?? null,
        manifestJson: theme.manifest,
        settingsSchemaJson: theme.settingsSchema,
        storagePath: theme.storagePath,
        status: theme.status,
        isBuiltIn: theme.isBuiltIn,
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    if (!row) throw new Error("Failed to update installed theme");
    return this.mapToDomain(row);
  }

  async delete(themeId: string, publicationId?: string): Promise<void> {
    const db = getDb();
    const conditions = [eq(installedThemes.themeId, themeId)];
    if (publicationId) conditions.push(eq(installedThemes.publicationId, publicationId));
    await db
      .delete(installedThemes)
      .where(and(...conditions));
    await db
      .delete(themeSettings)
      .where(eq(themeSettings.themeId, themeId));
  }

  async deleteVersion(themeId: string, version: string, publicationId?: string): Promise<void> {
    const db = getDb();
    const conditions = [
      eq(installedThemes.themeId, themeId),
      eq(installedThemes.version, version),
    ];
    if (publicationId) conditions.push(eq(installedThemes.publicationId, publicationId));
    await db
      .delete(installedThemes)
      .where(and(...conditions));
  }

  async getThemeSettings(themeId: string, _publicationId?: string): Promise<Record<string, unknown> | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(themeSettings)
      .where(eq(themeSettings.themeId, themeId))
      .limit(1);
    if (!rows[0]) return null;
    return rows[0].settingsJson as Record<string, unknown>;
  }

  async saveThemeSettings(
    themeId: string,
    settings: Record<string, unknown>,
    _publicationId?: string,
  ): Promise<void> {
    const db = getDb();
    const existing = await this.getThemeSettings(themeId);
    if (existing) {
      await db
        .update(themeSettings)
        .set({
          settingsJson: settings,
          updatedAt: new Date(),
        })
        .where(eq(themeSettings.themeId, themeId));
    } else {
      await db.insert(themeSettings).values({
        id: crypto.randomUUID(),
        themeId,
        settingsJson: settings,
        updatedAt: new Date(),
      });
    }
  }
}
