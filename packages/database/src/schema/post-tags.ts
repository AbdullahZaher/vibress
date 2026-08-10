import { pgTable, text, integer, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';
import { posts } from './posts';
import { tags } from './tags';

export const postTags = pgTable('post_tags', {
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    pk: primaryKey({ columns: [table.postId, table.tagId] }),
    postIdIdx: index('post_tags_post_id_idx').on(table.postId),
    tagIdIdx: index('post_tags_tag_id_idx').on(table.tagId),
  };
});

export type PostTagRow = typeof postTags.$inferSelect;
export type NewPostTagRow = typeof postTags.$inferInsert;
