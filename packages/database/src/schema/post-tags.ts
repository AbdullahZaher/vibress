import {
  pgTable,
  text,
  integer,
  timestamp,
  primaryKey,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { posts } from "./posts";
import { tags } from "./tags";

export const postTags = pgTable(
  "post_tags",
  {
    publicationId: text("publication_id").notNull(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.postId, table.tagId] }),
      publicationIdIdx: index("post_tags_publication_id_idx").on(
        table.publicationId,
      ),
      postPublicationFk: foreignKey({
        columns: [table.postId, table.publicationId],
        foreignColumns: [posts.id, posts.publicationId],
        name: "post_tags_post_publication_fk",
      }).onDelete("cascade"),
      tagPublicationFk: foreignKey({
        columns: [table.tagId, table.publicationId],
        foreignColumns: [tags.id, tags.publicationId],
        name: "post_tags_tag_publication_fk",
      }).onDelete("cascade"),
      postIdIdx: index("post_tags_post_id_idx").on(table.postId),
      tagIdIdx: index("post_tags_tag_id_idx").on(table.tagId),
    };
  },
);

export type PostTagRow = typeof postTags.$inferSelect;
export type NewPostTagRow = typeof postTags.$inferInsert;
