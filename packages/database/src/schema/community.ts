import { pgTable, text, timestamp, integer, boolean, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core';
import { members } from './members';
import { posts } from './posts';

export const comments = pgTable('comments', {
  id: text('id').primaryKey(),
  postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  memberId: text('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  body: text('body').notNull(),
  status: text('status').notNull().default('published'),
  likeCount: integer('like_count').notNull().default(0),
  replyCount: integer('reply_count').notNull().default(0),
  depth: integer('depth').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => {
  return {
    postIdx: index('comments_post_idx').on(table.postId),
    memberIdx: index('comments_member_idx').on(table.memberId),
    parentIdx: index('comments_parent_idx').on(table.parentId),
    statusIdx: index('comments_status_idx').on(table.status),
    postStatusIdx: index('comments_post_status_idx').on(table.postId, table.status),
  };
});

export type CommentRow = typeof comments.$inferSelect;
export type NewCommentRow = typeof comments.$inferInsert;

export const commentLikes = pgTable('comment_likes', {
  id: text('id').primaryKey(),
  commentId: text('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
  memberId: text('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    uniqueLikeIdx: uniqueIndex('comment_likes_member_comment_idx').on(table.memberId, table.commentId),
    commentIdx: index('comment_likes_comment_idx').on(table.commentId),
  };
});

export type CommentLikeRow = typeof commentLikes.$inferSelect;
export type NewCommentLikeRow = typeof commentLikes.$inferInsert;

export const commentReports = pgTable('comment_reports', {
  id: text('id').primaryKey(),
  commentId: text('comment_id').notNull().references(() => comments.id, { onDelete: 'cascade' }),
  reporterId: text('reporter_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('pending'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: text('resolved_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    commentIdx: index('comment_reports_comment_idx').on(table.commentId),
    statusIdx: index('comment_reports_status_idx').on(table.status),
    uniqueReporterCommentIdx: uniqueIndex('comment_reports_reporter_comment_idx').on(table.reporterId, table.commentId),
  };
});

export type CommentReportRow = typeof commentReports.$inferSelect;
export type NewCommentReportRow = typeof commentReports.$inferInsert;

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  recipientType: text('recipient_type').notNull().default('member'),
  recipientId: text('recipient_id').notNull(),
  type: text('type').notNull(),
  actorMemberId: text('actor_member_id').references(() => members.id, { onDelete: 'set null' }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  data: jsonb('data'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    recipientIdx: index('notifications_recipient_idx').on(table.recipientId, table.recipientType),
    recipientReadIdx: index('notifications_recipient_read_idx').on(table.recipientId, table.readAt),
  };
});

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;

export const recommendations = pgTable('recommendations', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  imageUrl: text('image_url'),
  faviconUrl: text('favicon_url'),
  status: text('status').notNull().default('active'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    statusIdx: index('recommendations_status_idx').on(table.status, table.sortOrder),
  };
});

export type RecommendationRow = typeof recommendations.$inferSelect;
export type NewRecommendationRow = typeof recommendations.$inferInsert;

export const recommendationEvents = pgTable('recommendation_events', {
  id: text('id').primaryKey(),
  recommendationId: text('recommendation_id').notNull().references(() => recommendations.id, { onDelete: 'cascade' }),
  memberId: text('member_id').references(() => members.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  sessionId: text('session_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => {
  return {
    recommendationIdx: index('recommendation_events_rec_idx').on(table.recommendationId),
    typeIdx: index('recommendation_events_type_idx').on(table.type),
  };
});

export type RecommendationEventRow = typeof recommendationEvents.$inferSelect;
export type NewRecommendationEventRow = typeof recommendationEvents.$inferInsert;
