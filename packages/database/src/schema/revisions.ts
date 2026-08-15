import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const revisions = pgTable(
  "revisions",
  {
    id: text("id").primaryKey(),
    resourceType: text("resource_type").notNull(), // 'post' | 'page'
    resourceId: text("resource_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    excerpt: text("excerpt"),
    content: jsonb("content").notNull(),
    contentVersion: integer("content_version").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      resourceRevisionIdx: uniqueIndex("revisions_resource_revision_idx").on(
        table.resourceType,
        table.resourceId,
        table.revisionNumber,
      ),
      resourceIdIdx: index("revisions_resource_id_idx").on(
        table.resourceType,
        table.resourceId,
      ),
    };
  },
);

export type RevisionRow = typeof revisions.$inferSelect;
export type NewRevisionRow = typeof revisions.$inferInsert;
