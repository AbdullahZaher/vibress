import { pgTable, text, timestamp, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';

export const posts = pgTable('posts', {
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
    slugIdx: index('posts_slug_idx').on(table.slug),
    statusIdx: index('posts_status_idx').on(table.status),
    publishedAtIdx: index('posts_published_at_idx').on(table.publishedAt),
    scheduledAtIdx: index('posts_scheduled_at_idx').on(table.scheduledAt),
    updatedAtIdx: index('posts_updated_at_idx').on(table.updatedAt),
  };
});

export type PostRow = typeof posts.$inferSelect;
export type NewPostRow = typeof posts.$inferInsert;
