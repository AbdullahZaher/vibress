import { pgTable, text, timestamp, integer, index, uniqueIndex, jsonb, boolean } from 'drizzle-orm/pg-core';
import { users } from './users';

export const settings = pgTable('settings', {
  id: text('id').primaryKey(),
  namespace: text('namespace').notNull(),
  key: text('key').notNull(),
  value: jsonb('value'),
  valueType: text('value_type').notNull().default('string'),
  classification: text('classification').notNull().default('staff-visible'),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    uniqueNsKeyIdx: uniqueIndex('settings_namespace_key_idx').on(table.namespace, table.key),
    nsIdx: index('settings_namespace_idx').on(table.namespace),
  };
});

export type SettingRow = typeof settings.$inferSelect;
export type NewSettingRow = typeof settings.$inferInsert;

export const redirects = pgTable('redirects', {
  id: text('id').primaryKey(),
  source: text('source').notNull().unique(),
  destination: text('destination').notNull(),
  statusCode: integer('status_code').notNull().default(301),
  enabled: boolean('enabled').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RedirectRow = typeof redirects.$inferSelect;
export type NewRedirectRow = typeof redirects.$inferInsert;

export const importExportJobs = pgTable('import_export_jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  status: text('status').notNull().default('pending'),
  requestedBy: text('requested_by').references(() => users.id, { onDelete: 'set null' }),
  progress: integer('progress').notNull().default(0),
  errorSummary: text('error_summary'),
  artifactKey: text('artifact_key'),
  artifactExpiresAt: timestamp('artifact_expires_at', { withTimezone: true }),
  summary: jsonb('summary'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => {
  return {
    statusIdx: index('import_export_jobs_status_idx').on(table.status),
    typeIdx: index('import_export_jobs_type_idx').on(table.type),
  };
});

export type ImportExportJobRow = typeof importExportJobs.$inferSelect;
export type NewImportExportJobRow = typeof importExportJobs.$inferInsert;
