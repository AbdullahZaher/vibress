import { pgTable, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const themeConfigurations = pgTable('theme_configurations', {
  id: text('id').primaryKey(),
  themeId: text('theme_id').notNull(),
  themeVersion: text('theme_version').notNull(),
  settingsJson: jsonb('settings_json').notNull().default({}),
  settingsSchemaVersion: integer('settings_schema_version').notNull().default(1),
  activatedBy: text('activated_by').references(() => users.id, { onDelete: 'set null' }),
  activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    themeIdIdx: index('theme_configurations_theme_id_idx').on(table.themeId),
  };
});

export type ThemeConfigurationRow = typeof themeConfigurations.$inferSelect;
export type NewThemeConfigurationRow = typeof themeConfigurations.$inferInsert;
