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

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    storageProvider: text("storage_provider").notNull().default("local"),
    storageKey: text("storage_key").notNull().unique(),
    originalFilename: text("original_filename").notNull(),
    displayName: text("display_name").notNull(),
    mimeType: text("mime_type").notNull(),
    extension: text("extension").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksum: text("checksum").notNull(),
    assetType: text("asset_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    metadata: jsonb("metadata"),
    uploadedBy: text("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
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
      storageKeyIdx: index("media_assets_storage_key_idx").on(table.storageKey),
      createdAtIdx: index("media_assets_created_at_idx").on(table.createdAt),
      assetTypeIdx: index("media_assets_asset_type_idx").on(table.assetType),
      uploadedByIdx: index("media_assets_uploaded_by_idx").on(table.uploadedBy),
      checksumIdx: index("media_assets_checksum_idx").on(table.checksum),
    };
  },
);

export const mediaReferences = pgTable(
  "media_references",
  {
    id: text("id").primaryKey(),
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    fieldPath: text("field_path").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      mediaIdIdx: index("media_references_media_id_idx").on(table.mediaId),
      resourceIdx: index("media_references_resource_idx").on(
        table.resourceType,
        table.resourceId,
      ),
      uniqueRefIdx: uniqueIndex("media_references_unique_idx").on(
        table.mediaId,
        table.resourceType,
        table.resourceId,
        table.fieldPath,
      ),
    };
  },
);

export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type NewMediaAssetRow = typeof mediaAssets.$inferInsert;

export type MediaReferenceRow = typeof mediaReferences.$inferSelect;
export type NewMediaReferenceRow = typeof mediaReferences.$inferInsert;
