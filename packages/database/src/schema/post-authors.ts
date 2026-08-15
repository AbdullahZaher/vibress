import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { posts } from "./posts";
import { users } from "./users";

export const postAuthors = pgTable(
  "post_authors",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.postId, table.userId] }),
      postIdIdx: index("post_authors_post_id_idx").on(table.postId),
      userIdIdx: index("post_authors_user_id_idx").on(table.userId),
    };
  },
);

export type PostAuthorRow = typeof postAuthors.$inferSelect;
export type NewPostAuthorRow = typeof postAuthors.$inferInsert;
