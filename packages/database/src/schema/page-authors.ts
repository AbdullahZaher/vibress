import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { pages } from "./pages";
import { users } from "./users";

export const pageAuthors = pgTable(
  "page_authors",
  {
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
      pageIdIdx: index("page_authors_page_id_idx").on(table.pageId),
      userIdIdx: index("page_authors_user_id_idx").on(table.userId),
    };
  },
);

export type PageAuthorRow = typeof pageAuthors.$inferSelect;
export type NewPageAuthorRow = typeof pageAuthors.$inferInsert;
