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
import { pages } from "./pages";
import { users } from "./users";
import { publicationMemberships } from "./publications";

export const pageAuthors = pgTable(
  "page_authors",
  {
    publicationId: text("publication_id").notNull(),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
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
      pk: primaryKey({ columns: [table.pageId, table.userId] }),
      publicationIdIdx: index("page_authors_publication_id_idx").on(
        table.publicationId,
      ),
      publicationUserIdx: index("page_authors_publication_user_idx").on(
        table.publicationId,
        table.userId,
      ),
      pagePublicationFk: foreignKey({
        columns: [table.pageId, table.publicationId],
        foreignColumns: [pages.id, pages.publicationId],
        name: "page_authors_page_publication_fk",
      }).onDelete("cascade"),
      membershipFk: foreignKey({
        columns: [table.publicationId, table.userId],
        foreignColumns: [
          publicationMemberships.publicationId,
          publicationMemberships.userId,
        ],
        name: "page_authors_membership_fk",
      }).onDelete("restrict"),
      pageIdIdx: index("page_authors_page_id_idx").on(table.pageId),
      userIdIdx: index("page_authors_user_id_idx").on(table.userId),
    };
  },
);

export type PageAuthorRow = typeof pageAuthors.$inferSelect;
export type NewPageAuthorRow = typeof pageAuthors.$inferInsert;
