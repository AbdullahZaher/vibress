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
import { mediaAssets } from "./media";

export const posts = pgTable(
  "posts",
  {
    id: text("id").primaryKey(),
    publicationId: text("publication_id")
      .notNull()
      .references(() => publications.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    excerpt: text("excerpt"),
    content: jsonb("content").notNull(),
    contentVersion: integer("content_version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    visibility: text("visibility").notNull().default("public"),
    version: integer("version").notNull().default(1),
    featureImageId: text("feature_image_id"),
    featureImageAlt: text("feature_image_alt"),
    featureImageCaption: text("feature_image_caption"),
    primaryAuthorId: text("primary_author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedBy: text("published_by").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    canonicalUrl: text("canonical_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => {
    return {
      publicationIdIdx: index("posts_publication_id_idx").on(table.publicationId),
      publicationSlugActiveIdx: uniqueIndex("posts_publication_slug_active_idx")
        .on(table.publicationId, table.slug)
        .where(sql`"deleted_at" IS NULL`),
      slugIdx: index("posts_slug_idx").on(table.slug),
      statusIdx: index("posts_status_idx").on(table.status),
      publishedAtIdx: index("posts_published_at_idx").on(table.publishedAt),
      scheduledAtIdx: index("posts_scheduled_at_idx").on(table.scheduledAt),
      updatedAtIdx: index("posts_updated_at_idx").on(table.updatedAt),
      featureImageIdIdx: index("posts_feature_image_id_idx").on(table.featureImageId),
      postsFeatureImagePublicationFk: foreignKey({
        columns: [table.featureImageId, table.publicationId],
        foreignColumns: [mediaAssets.id, mediaAssets.publicationId],
        name: "posts_feature_image_publication_fk",
      }).onDelete("set null"),
    };
  },
);

export type PostRow = typeof posts.$inferSelect;
export type NewPostRow = typeof posts.$inferInsert;
