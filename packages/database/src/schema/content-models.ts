import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";

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
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
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
    slugIdx: uniqueIndex("content_models_slug_idx").on(table.slug),
  }),
);

export type ContentModelRow = typeof contentModels.$inferSelect;
export type NewContentModelRow = typeof contentModels.$inferInsert;

export const contentEntries = pgTable(
  "content_entries",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => contentModels.id, { onDelete: "cascade" }),
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
    modelSlugIdx: uniqueIndex("content_entries_model_slug_idx").on(
      table.modelId,
      table.slug,
    ),
    modelIdx: index("content_entries_model_idx").on(table.modelId),
    statusIdx: index("content_entries_status_idx").on(table.status),
    publishedAtIdx: index("content_entries_published_at_idx").on(
      table.publishedAt,
    ),
  }),
);

export type ContentEntryRow = typeof contentEntries.$inferSelect;
export type NewContentEntryRow = typeof contentEntries.$inferInsert;
