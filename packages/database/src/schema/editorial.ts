import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { posts } from "./posts";

export const editorialComments = pgTable(
  "editorial_comments",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    blockId: text("block_id"),
    status: text("status").notNull().default("open"), // "open" | "resolved"
    resolvedBy: text("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    postIdx: index("editorial_comments_post_idx").on(table.postId),
    authorIdx: index("editorial_comments_author_idx").on(table.authorId),
    statusIdx: index("editorial_comments_status_idx").on(table.status),
  }),
);

export type EditorialCommentRow = typeof editorialComments.$inferSelect;
export type NewEditorialCommentRow = typeof editorialComments.$inferInsert;

export const editorialSuggestions = pgTable(
  "editorial_suggestions",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    originalText: text("original_text").notNull(),
    suggestedText: text("suggested_text").notNull(),
    blockId: text("block_id"),
    status: text("status").notNull().default("pending"), // "pending" | "accepted" | "rejected"
    reviewedBy: text("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    postIdx: index("editorial_suggestions_post_idx").on(table.postId),
    authorIdx: index("editorial_suggestions_author_idx").on(table.authorId),
    statusIdx: index("editorial_suggestions_status_idx").on(table.status),
  }),
);

export type EditorialSuggestionRow = typeof editorialSuggestions.$inferSelect;
export type NewEditorialSuggestionRow = typeof editorialSuggestions.$inferInsert;

export const editorialAssignments = pgTable(
  "editorial_assignments",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    assigneeId: text("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewerIds: jsonb("reviewer_ids").default([]),
    dueDate: timestamp("due_date", { withTimezone: true }),
    editorialNotes: text("editorial_notes"),
    reviewStatus: text("review_status").notNull().default("pending"), // "pending" | "in_review" | "changes_requested" | "approved"
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniquePostIdx: uniqueIndex("editorial_assignments_post_idx").on(table.postId),
    assigneeIdx: index("editorial_assignments_assignee_idx").on(table.assigneeId),
  }),
);

export type EditorialAssignmentRow = typeof editorialAssignments.$inferSelect;
export type NewEditorialAssignmentRow = typeof editorialAssignments.$inferInsert;
