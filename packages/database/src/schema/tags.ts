import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { publications } from "./publications";

export const tags = pgTable(
  "tags",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      publicationIdIdx: index("tags_publication_id_idx").on(table.publicationId),
      publicationSlugUnique: uniqueIndex("tags_publication_slug_unique").on(
        table.publicationId,
        table.slug,
      ),
      slugIdx: index("tags_slug_idx").on(table.slug),
    };
  },
);

export type TagRow = typeof tags.$inferSelect;
export type NewTagRow = typeof tags.$inferInsert;
