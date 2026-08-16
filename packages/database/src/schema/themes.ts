import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

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

export const installedThemes = pgTable(
  "installed_themes",
  {
    id: text("id").primaryKey(),
    themeId: text("theme_id").notNull().unique(),
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
