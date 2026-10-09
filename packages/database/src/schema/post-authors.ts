import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { posts } from "./posts";
import { users } from "./users";
import { publicationMemberships } from "./publications";

export const postAuthors = pgTable(
  "post_authors",
  {
    publicationId: text("publication_id").notNull(),
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
      publicationIdIdx: index("post_authors_publication_id_idx").on(
        table.publicationId,
      ),
      publicationUserIdx: index("post_authors_publication_user_idx").on(
        table.publicationId,
        table.userId,
      ),
      postPublicationFk: foreignKey({
        columns: [table.postId, table.publicationId],
        foreignColumns: [posts.id, posts.publicationId],
        name: "post_authors_post_publication_fk",
      }).onDelete("cascade"),
      membershipFk: foreignKey({
        columns: [table.publicationId, table.userId],
        foreignColumns: [
          publicationMemberships.publicationId,
          publicationMemberships.userId,
        ],
        name: "post_authors_membership_fk",
      }).onDelete("no action"),
      postIdIdx: index("post_authors_post_id_idx").on(table.postId),
      userIdIdx: index("post_authors_user_id_idx").on(table.userId),
    };
  },
);

export type PostAuthorRow = typeof postAuthors.$inferSelect;
export type NewPostAuthorRow = typeof postAuthors.$inferInsert;
