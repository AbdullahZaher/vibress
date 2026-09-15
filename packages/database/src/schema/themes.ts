import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { publications } from "./publications";

export const themeConfigurations = pgTable(
  "theme_configurations",
  {
    id: text("id").primaryKey(),
    themeId: text("theme_id").notNull(),
    themeVersion: text("theme_version").notNull(),
    settingsJson: jsonb("settings_json").notNull().default({}),
    settingsSchemaVersion: integer("settings_schema_version")
      .notNull()
      .default(1),
    activatedBy: text("activated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    activatedAt: timestamp("activated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      themeIdIdx: index("theme_configurations_theme_id_idx").on(table.themeId),
    };
  },
);

export type ThemeConfigurationRow = typeof themeConfigurations.$inferSelect;
export type NewThemeConfigurationRow = typeof themeConfigurations.$inferInsert;

export const themeSettings = pgTable(
  "theme_settings",
  {
    id: text("id").primaryKey(),
    themeId: text("theme_id").notNull().unique(),
    settingsJson: jsonb("settings_json").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      themeSettingsThemeIdIdx: index("theme_settings_theme_id_idx").on(
        table.themeId,
      ),
    };
  },
);

export type ThemeSettingsRow = typeof themeSettings.$inferSelect;
export type NewThemeSettingsRow = typeof themeSettings.$inferInsert;

export const installedThemes = pgTable(
  "installed_themes",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    themeId: text("theme_id").notNull(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    themeApiVersion: integer("theme_api_version").notNull().default(1),
    description: text("description"),
    author: text("author"),
    previewImage: text("preview_image"),
    manifestJson: jsonb("manifest_json").notNull(),
    settingsSchemaJson: jsonb("settings_schema_json").notNull().default({}),
    storagePath: text("storage_path").notNull(),
    status: text("status").notNull().default("installed"),
    isBuiltIn: boolean("is_built_in").notNull().default(false),
    installedAt: timestamp("installed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      pubVersionUniqueIdx: uniqueIndex(
        "installed_themes_pub_version_unique_idx",
      ).on(table.publicationId, table.themeId, table.version),
      installedThemesThemeIdIdx: index("installed_themes_theme_id_idx").on(
        table.themeId,
      ),
      installedThemesStatusIdx: index("installed_themes_status_idx").on(
        table.status,
      ),
    };
  },
);

export type InstalledThemeRow = typeof installedThemes.$inferSelect;
export type NewInstalledThemeRow = typeof installedThemes.$inferInsert;
