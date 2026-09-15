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
import { publications } from "./publications";

export type TranslationStatus =
  | "untranslated"
  | "draft"
  | "in_progress"
  | "translated"
  | "needs_review"
  | "approved"
  | "published"
  | "stale";

export const contentTranslations = pgTable(
  "content_translations",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    translationGroupId: text("translation_group_id"),
    contentType: text("content_type").notNull(), // "post" | "page" | "content_entry" | "tag"
    contentId: text("content_id").notNull(),
    sourceLocale: text("source_locale").notNull().default("en"),
    targetLocale: text("target_locale").notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    excerpt: text("excerpt"),
    content: jsonb("content").notNull().default({}),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    status: text("status").notNull().default("untranslated"), // TranslationStatus
    translationProvider: text("translation_provider").default("human"), // "human" | "ai" | "imported"
    assignedTranslatorId: text("assigned_translator_id").references(() => users.id, {
      onDelete: "set null",
    }),
    translationDueDate: timestamp("translation_due_date", { withTimezone: true }),
    sourceVersionAtTranslation: integer("source_version_at_translation").default(1),
    sourceUpdatedAtTranslation: timestamp("source_updated_at_translation", { withTimezone: true }),
    translatedAt: timestamp("translated_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    contentTargetLocaleIdx: uniqueIndex("content_translations_content_target_idx").on(
      table.contentType,
      table.contentId,
      table.targetLocale,
    ),
    pubLocaleSlugIdx: uniqueIndex("content_translations_pub_locale_slug_idx").on(
      table.publicationId,
      table.targetLocale,
      table.slug,
    ),
    translationGroupIdx: index("content_translations_group_idx").on(table.translationGroupId),
    statusIdx: index("content_translations_status_idx").on(table.status),
    translatorIdx: index("content_translations_translator_idx").on(table.assignedTranslatorId),
  }),
);

export type ContentTranslationRow = typeof contentTranslations.$inferSelect;
export type NewContentTranslationRow = typeof contentTranslations.$inferInsert;
