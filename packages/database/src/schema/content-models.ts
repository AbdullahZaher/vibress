import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { publications } from "./publications";

export type ContentFieldType =
  | "text"
  | "short_text"
  | "long_text"
  | "rich_text"
  | "studio_doc"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "url"
  | "email"
  | "select"
  | "multi_select"
  | "media"
  | "taxonomy"
  | "relation"
  | "relation_list"
  | "json";

export interface ContentFieldDefinition {
  id: string;
  name: string;
  key: string;
  type: ContentFieldType;
  required?: boolean | undefined;
  description?: string | undefined;
  helpText?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  pattern?: string | undefined;
  unique?: boolean | undefined;
  localizable?: boolean | undefined;
  searchable?: boolean | undefined;
  filterable?: boolean | undefined;
  apiVisibility?: "public" | "authenticated" | "private" | undefined;
  options?: Array<{ label: string; value: string | number }> | undefined;
  relationModel?: string | undefined;
  defaultValue?: unknown | undefined;
}

export const contentModels = pgTable(
  "content_models",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    fields: jsonb("fields").notNull().default([]),
    settings: jsonb("settings").default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    publicationIdIdx: index("content_models_publication_id_idx").on(
      table.publicationId,
    ),
    publicationSlugIdx: uniqueIndex("content_models_publication_slug_idx").on(
      table.publicationId,
      table.slug,
    ),
    idPublicationIdx: uniqueIndex("content_models_id_publication_unique").on(
      table.id,
      table.publicationId,
    ),
  }),
);

export type ContentModelRow = typeof contentModels.$inferSelect;
export type NewContentModelRow = typeof contentModels.$inferInsert;

export const contentEntries = pgTable(
  "content_entries",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    data: jsonb("data").notNull().default({}),
    status: text("status").notNull().default("draft"), // "draft" | "published" | "archived"
    version: integer("version").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    publicationIdIdx: index("content_entries_publication_id_idx").on(
      table.publicationId,
    ),
    modelIdx: index("content_entries_model_idx").on(table.modelId),
    modelSlugActiveIdx: uniqueIndex("content_entries_model_slug_active_idx")
      .on(table.modelId, table.slug)
      .where(sql`"deleted_at" IS NULL`),
    statusIdx: index("content_entries_status_idx").on(table.status),
    publishedAtIdx: index("content_entries_published_at_idx").on(
      table.publishedAt,
    ),
    contentEntriesModelPublicationFk: foreignKey({
      columns: [table.modelId, table.publicationId],
      foreignColumns: [contentModels.id, contentModels.publicationId],
      name: "content_entries_model_publication_fk",
    }).onDelete("cascade"),
  }),
);

export type ContentEntryRow = typeof contentEntries.$inferSelect;
export type NewContentEntryRow = typeof contentEntries.$inferInsert;

