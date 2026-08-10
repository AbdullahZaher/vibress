import { pgTable, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const pages = pgTable('pages', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  excerpt: text('excerpt'),
  content: jsonb('content').notNull(),
  contentVersion: integer('content_version').notNull().default(1),
  status: text('status').notNull().default('draft'),
  visibility: text('visibility').notNull().default('public'),
  version: integer('version').notNull().default(1),
  primaryAuthorId: text('primary_author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdBy: text('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  updatedBy: text('updated_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  publishedBy: text('published_by').references(() => users.id, { onDelete: 'set null' }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  metaTitle: text('meta_title'),
  metaDescription: text('meta_description'),
  canonicalUrl: text('canonical_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => {
  return {
    slugIdx: index('pages_slug_idx').on(table.slug),
    statusIdx: index('pages_status_idx').on(table.status),
    publishedAtIdx: index('pages_published_at_idx').on(table.publishedAt),
    scheduledAtIdx: index('pages_scheduled_at_idx').on(table.scheduledAt),
    updatedAtIdx: index('pages_updated_at_idx').on(table.updatedAt),
  };
});

export type PageRow = typeof pages.$inferSelect;
export type NewPageRow = typeof pages.$inferInsert;
