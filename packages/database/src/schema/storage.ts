import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const storageConfigurations = pgTable(
  "storage_configurations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    providerType: text("provider_type").notNull(),
    endpoint: text("endpoint"),
    region: text("region"),
    bucket: text("bucket"),
    publicBaseUrl: text("public_base_url"),
    forcePathStyle: boolean("force_path_style").notNull().default(false),
    encryptedCredentials: text("encrypted_credentials"),
    encryptionVersion: integer("encryption_version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(false),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      providerTypeIdx: index("storage_configurations_provider_type_idx").on(
        table.providerType,
      ),
      isActiveIdx: index("storage_configurations_is_active_idx").on(
        table.isActive,
      ),
    };
  },
);

export const uploadSessions = pgTable(
  "upload_sessions",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storageConfigurationId: text("storage_configuration_id").references(
      () => storageConfigurations.id,
      { onDelete: "set null" },
    ),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    declaredMime: text("declared_mime").notNull(),
    expectedSize: integer("expected_size").notNull(),
    assetType: text("asset_type").notNull(),
    state: text("state").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    multipartUploadId: text("multipart_upload_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      actorIdIdx: index("upload_sessions_actor_id_idx").on(table.actorId),
      storageKeyIdx: index("upload_sessions_storage_key_idx").on(
        table.storageKey,
      ),
      stateIdx: index("upload_sessions_state_idx").on(table.state),
      expiresAtIdx: index("upload_sessions_expires_at_idx").on(table.expiresAt),
    };
  },
);

export type StorageConfigurationRow = typeof storageConfigurations.$inferSelect;
export type NewStorageConfigurationRow =
  typeof storageConfigurations.$inferInsert;
export type UploadSessionRow = typeof uploadSessions.$inferSelect;
export type NewUploadSessionRow = typeof uploadSessions.$inferInsert;
